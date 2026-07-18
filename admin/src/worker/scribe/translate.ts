// Step 3: segment + translate in one LLM pass (port of Scribe's pipeline v2).
//
// The idea carried over from the desktop app: every subtitle cue is
// addressed by WORD INDICES into the ASR output, so timing comes directly
// from speech — zero drift, no alignment pass. The LLM sees numbered words
// with timestamps, gap markers, and speaker changes, and answers with
// JSONL cues {"w":[first,last],"t":"translation"}.

import type { Cue, ScribeEnv, Word } from './types';

export type CleanWord = { i: number; text: string; start: number; end: number; speaker: string };

const WINDOW_SIZE = 100; // words per LLM call
const WINDOW_LOOKAHEAD = 30; // stretch to a natural boundary
const CONCURRENCY = 6;

export function cleanWords(words: Word[]): CleanWord[] {
  const out: CleanWord[] = [];
  for (const w of words) {
    const type = w.type || 'word';
    if (type !== 'word') continue;
    const text = (w.text || '').trim();
    if (!text) continue;
    out.push({ i: out.length, text, start: w.start, end: w.end, speaker: w.speaker_id || '' });
  }
  return out;
}

/** Split into windows, preferring cuts at speech gaps or strong punctuation. */
export function makeWindows(words: CleanWord[]): CleanWord[][] {
  const windows: CleanWord[][] = [];
  let pos = 0;
  while (pos < words.length) {
    let end = Math.min(pos + WINDOW_SIZE, words.length);
    if (end < words.length) {
      let best = end;
      for (let j = end; j < Math.min(end + WINDOW_LOOKAHEAD, words.length - 1); j++) {
        const gap = words[j + 1].start - words[j].end;
        if (gap >= 0.5) { best = j + 1; break; }
        if (/[.!?؟۔।。]$/.test(words[j].text)) { best = j + 1; break; }
      }
      end = best;
    }
    windows.push(words.slice(pos, end));
    pos = end;
  }
  return windows;
}

const SYSTEM_PROMPT = (targetLang: string) => `You are an expert subtitle translator for Islamic lectures. You receive numbered words with timestamps from speech recognition and produce subtitle cues with translations.

OUTPUT FORMAT — one JSON object per line, nothing else:
{"w":[FIRST_WORD_INDEX,LAST_WORD_INDEX],"t":"translation of those words"}

RULES:
- Cover EVERY word index exactly once, in order, with no gaps and no overlaps.
- Segment at natural boundaries: sentence ends, pauses (marked [GAP]), speaker changes (marked [SPEAKER]).
- Each cue: ideally 1.5-7 seconds of speech, translation at most 2 lines x 42 characters (~84 chars).
- Translate to ${targetLang}. Translate ALL meaningful content faithfully — never paraphrase away or condense meaning.
- Clean speech artifacts: drop stutters, false starts, and filler sounds from the translation (their word indices still belong to the cue covering that span).
- Islamic honorifics: Allah ﷻ, the Prophet Muhammad ﷺ, companions (RA), earlier prophets (AS), scholars (RH).
- Keep as transliterations (do not translate): fatwa, mufti, Sharia, fiqh, usul al-fiqh, ifta, Haramain, madhhab, and similar established terms.
- Quranic verses: use established translation wording, wrapped in quotes.
- Proper nouns and Arabic terms: standard English transliteration.
- No markdown, no commentary, no code fences — only JSONL lines.`;

function windowPrompt(win: CleanWord[], prevTail: string): string {
  const lines: string[] = [];
  if (prevTail) lines.push(`Previous cue for context (already translated, do NOT repeat): ${prevTail}`, '');
  lines.push('Words:');
  let lastSpeaker = win[0]?.speaker || '';
  for (let k = 0; k < win.length; k++) {
    const w = win[k];
    if (k > 0) {
      const gap = w.start - win[k - 1].end;
      if (gap >= 0.4) lines.push(`[GAP ${Math.round(gap * 1000)}ms]`);
    }
    if (w.speaker !== lastSpeaker && w.speaker) {
      lines.push(`[SPEAKER ${w.speaker}]`);
      lastSpeaker = w.speaker;
    }
    lines.push(`${w.i}\t${w.start.toFixed(2)}-${w.end.toFixed(2)}\t${w.text}`);
  }
  return lines.join('\n');
}

// Token usage accumulator (per workflow step; read+reset via takeUsage)
let usageTokens = 0;
export function takeUsage(): number {
  const t = usageTokens;
  usageTokens = 0;
  return t;
}

/** Parse an SSE chat stream ("data: {...}" lines) into the full content. */
function parseSse(text: string): string {
  let out = '';
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (payload === '[DONE]') break;
    try {
      const obj = JSON.parse(payload);
      out += obj.choices?.[0]?.delta?.content ?? obj.choices?.[0]?.message?.content ?? '';
      if (obj.usage?.total_tokens) usageTokens += obj.usage.total_tokens;
    } catch {}
  }
  return out;
}

/**
 * Chat call against the router. Some router providers (agent-backed models)
 * answer with an SSE stream even when stream:false is sent, so both shapes
 * are handled.
 */
export async function llmChat(env: ScribeEnv, messages: any[], maxTokens = 4000): Promise<string> {
  const base = (env.SCRIBE_LLM_URL || '').replace(/\/$/, '');
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.SCRIBE_LLM_KEY },
    body: JSON.stringify({
      model: env.SCRIBE_LLM_MODEL || 'ag/gemini-3.5-flash-low',
      messages,
      temperature: 0.4,
      max_tokens: maxTokens,
      stream: false,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 200)}`);

  let content = '';
  if (text.trimStart().startsWith('data:')) {
    content = parseSse(text);
  } else {
    try {
      const data: any = JSON.parse(text);
      content = data.choices?.[0]?.message?.content || '';
      if (data.usage?.total_tokens) usageTokens += data.usage.total_tokens;
    } catch {
      throw new Error('LLM returned unparseable response: ' + text.slice(0, 200));
    }
  }
  if (!content) throw new Error('LLM returned empty content: ' + text.slice(0, 200));
  return content;
}

/** Parse JSONL cue lines, clamped to the window's index range. */
function parseCues(raw: string, win: CleanWord[]): { w: [number, number]; t: string }[] {
  const lo = win[0].i;
  const hi = win[win.length - 1].i;
  const out: { w: [number, number]; t: string }[] = [];
  for (let line of raw.split('\n')) {
    line = line.trim().replace(/^```(json)?|```$/g, '').trim();
    if (!line.startsWith('{')) continue;
    try {
      const obj = JSON.parse(line);
      if (!Array.isArray(obj.w) || obj.w.length !== 2 || typeof obj.t !== 'string') continue;
      let [a, b] = obj.w.map((n: any) => Math.round(Number(n)));
      if (isNaN(a) || isNaN(b)) continue;
      a = Math.max(lo, Math.min(a, hi));
      b = Math.max(a, Math.min(b, hi));
      const t = obj.t.trim();
      if (t) out.push({ w: [a, b], t });
    } catch {}
  }
  return out;
}

/** Translate one window, with retries for unparseable output AND for
 * uncovered tails (models sometimes stop before the last words). */
async function translateWindow(
  env: ScribeEnv,
  targetLang: string,
  win: CleanWord[],
  prevTail: string
): Promise<{ w: [number, number]; t: string }[]> {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT(targetLang) },
    { role: 'user', content: windowPrompt(win, prevTail) },
  ];
  let cues = parseCues(await llmChat(env, messages), win);
  if (!cues.length) {
    cues = parseCues(await llmChat(env, messages), win); // one retry
  }
  if (!cues.length) {
    // Last resort: one cue for the whole window with joined source text
    return [{ w: [win[0].i, win[win.length - 1].i], t: win.map((w) => w.text).join(' ') }];
  }

  // Coverage check: if the model stopped early, translate the tail it missed
  const hi = win[win.length - 1].i;
  for (let round = 0; round < 2; round++) {
    const maxCovered = Math.max(...cues.map((c) => c.w[1]));
    if (maxCovered >= hi - 1) break;
    const rest = win.filter((w) => w.i > maxCovered);
    if (rest.length < 2) break;
    const tailPrev = cues[cues.length - 1]?.t || prevTail;
    const more = parseCues(
      await llmChat(env, [
        { role: 'system', content: SYSTEM_PROMPT(targetLang) },
        { role: 'user', content: windowPrompt(rest, tailPrev) },
      ]),
      rest as CleanWord[]
    );
    if (!more.length) break;
    cues = cues.concat(more);
  }
  return cues;
}

/** Fill index gaps between/around parsed cues so every word is covered. */
function fillCoverage(cues: { w: [number, number]; t: string }[], lo: number, hi: number) {
  cues.sort((a, b) => a.w[0] - b.w[0]);
  let cursor = lo;
  for (const c of cues) {
    if (c.w[0] > cursor) c.w[0] = cursor; // extend back over any gap
    c.w[1] = Math.max(c.w[1], c.w[0]);
    cursor = Math.max(cursor, c.w[1] + 1);
  }
  if (cues.length) cues[cues.length - 1].w[1] = Math.max(cues[cues.length - 1].w[1], hi);
}

export async function translateWords(
  env: ScribeEnv,
  allWords: Word[],
  targetLang: string
): Promise<Cue[]> {
  const words = cleanWords(allWords);
  if (!words.length) throw new Error('No speech words found in ASR result');
  const windows = makeWindows(words);

  // Windows are independent (context tail is best-effort), so run in batches
  const results: { w: [number, number]; t: string }[][] = new Array(windows.length);
  for (let i = 0; i < windows.length; i += CONCURRENCY) {
    const batch = windows.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(
      batch.map((win, j) => {
        const prev = windows[i + j - 1];
        const prevTail = prev ? prev.slice(-12).map((w) => w.text).join(' ') : '';
        return translateWindow(env, targetLang, win, prevTail);
      })
    );
    settled.forEach((cues, j) => (results[i + j] = cues));
  }

  // Stitch windows → final cues with exact word-derived timing
  const cues: Cue[] = [];
  for (let i = 0; i < windows.length; i++) {
    const win = windows[i];
    const winCues = results[i];
    fillCoverage(winCues, win[0].i, win[win.length - 1].i);
    for (const c of winCues) {
      const first = words[c.w[0]];
      const last = words[c.w[1]];
      if (!first || !last) continue;
      cues.push({
        start: first.start,
        end: Math.max(last.end, first.start + 0.6),
        text: c.t,
        source: words.slice(c.w[0], c.w[1] + 1).map((w) => w.text).join(' '),
      });
    }
  }

  // Post pass: keep cues ordered, non-overlapping, and readable
  cues.sort((a, b) => a.start - b.start);
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    const next = cues[i + 1];
    if (next && cue.end > next.start) cue.end = next.start; // no overlap
    // Extend very short cues into the following silence
    if (cue.end - cue.start < 1.0) {
      const limit = next ? next.start : cue.end + 1.0;
      cue.end = Math.min(cue.start + 1.2, limit);
    }
    // Cap runaway cues
    if (cue.end - cue.start > 10) cue.end = cue.start + 10;
  }
  return cues.filter((c) => c.end > c.start && c.text.trim());
}
