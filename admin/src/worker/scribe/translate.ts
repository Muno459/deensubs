// Step 3: segment + translate in one LLM pass (port of Scribe's pipeline v2).
//
// The idea carried over from the desktop app: every subtitle cue is
// addressed by WORD INDICES into the ASR output, so timing comes directly
// from speech — zero drift, no alignment pass. The LLM sees numbered words
// with timestamps, gap markers, and speaker changes, and answers with
// JSONL cues {"w":[first,last],"t":"translation"}.

import type { Cue, ScribeEnv, Word } from './types';
import { findQuranQuotes, citeQuote, type QuranQuote } from './quran';

export type CleanWord = { i: number; text: string; start: number; end: number; speaker: string };

const WINDOW_SIZE = 180; // words per LLM call — bigger windows = fewer calls; hole-filling catches drops
const WINDOW_LOOKAHEAD = 30; // stretch to a natural boundary
const CONCURRENCY = 16; // gemini flash sustains this fine; 6 made a 2.5h lecture translate in ~40 min

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

const SYSTEM_PROMPT = (targetLang: string) => `You are an expert subtitle translator for Islamic lectures. You receive numbered words from speech recognition and produce subtitle cues with translations.

OUTPUT FORMAT — one JSON object per line, nothing else:
{"w":[FIRST_WORD_INDEX,LAST_WORD_INDEX],"t":"translation of those words"}

RULES:
- Cover EVERY word index exactly once, in order, with no gaps and no overlaps.
- Segment at natural boundaries: sentence ends, pauses (marked [GAP]), speaker changes (marked [SPEAKER]).
- Each cue: ideally 4-16 source words, translation at most 2 lines x 42 characters (~84 chars).
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
    lines.push(`${w.i} ${w.text}`);
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
export async function llmChat(env: ScribeEnv, messages: any[], maxTokens = 4000, model?: string): Promise<string> {
  const base = (env.SCRIBE_LLM_URL || '').replace(/\/$/, '');
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.SCRIBE_LLM_KEY },
    body: JSON.stringify({
      model: model || env.SCRIBE_LLM_MODEL || 'ag/gemini-3.5-flash-low',
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

// Escalation + QA model: bulk runs on cheap gemini, sonnet handles the hard parts
const STRONG_MODEL = 'ag/claude-sonnet-4-6';
const QA_MODEL = 'ag/claude-opus-4-6-thinking'; // touch-ups deserve the best; plain opus-4-6 404s on the router

/** Uncovered index ranges within [lo,hi] given parsed cues. */
function computeHoles(cues: { w: [number, number] }[], lo: number, hi: number): [number, number][] {
  const sorted = [...cues].sort((a, b) => a.w[0] - b.w[0]);
  const holes: [number, number][] = [];
  let cursor = lo;
  for (const c of sorted) {
    if (c.w[0] > cursor) holes.push([cursor, c.w[0] - 1]);
    cursor = Math.max(cursor, c.w[1] + 1);
  }
  if (cursor <= hi) holes.push([cursor, hi]);
  return holes;
}

/** Attach tiny uncovered ranges to the nearest cue (minimal timing shift). */
function attachSmallHoles(cues: { w: [number, number]; t: string }[], lo: number, hi: number) {
  cues.sort((a, b) => a.w[0] - b.w[0]);
  for (const [a, b] of computeHoles(cues, lo, hi)) {
    let best: { w: [number, number] } | null = null;
    let bestDist = Infinity;
    for (const c of cues) {
      const dist = c.w[1] < a ? a - c.w[1] : c.w[0] > b ? c.w[0] - b : 0;
      if (dist < bestDist) { bestDist = dist; best = c; }
    }
    if (!best) continue;
    best.w[0] = Math.min(best.w[0], a);
    best.w[1] = Math.max(best.w[1], b);
  }
}

/** Translate one window: model ladder, then targeted hole-filling.
 * Never emits source text as translation; timing anchors stay honest. */
async function translateWindow(
  env: ScribeEnv,
  targetLang: string,
  win: CleanWord[],
  prevTail: string
): Promise<{ w: [number, number]; t: string }[]> {
  const lo = win[0].i;
  const hi = win[win.length - 1].i;
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT(targetLang) },
    { role: 'user', content: windowPrompt(win, prevTail) },
  ];

  // Ladder: primary twice, then the strong model
  let cues: { w: [number, number]; t: string }[] = [];
  for (const model of [undefined, undefined, STRONG_MODEL]) {
    try {
      cues = parseCues(await llmChat(env, messages, 8000, model), win);
      if (cues.length) break;
    } catch {}
  }
  if (!cues.length) throw new Error(`window ${lo}-${hi} failed on all models`);

  // Hole-filling: translate what the model skipped instead of stretching timing
  for (let round = 0; round < 2; round++) {
    const holes = computeHoles(cues, lo, hi).filter(([a, b]) => b - a + 1 >= 3);
    if (!holes.length) break;
    for (const [a, b] of holes) {
      const sub = win.filter((w) => w.i >= a && w.i <= b);
      if (sub.length < 3) continue;
      try {
        const more = parseCues(
          await llmChat(env, [
            { role: 'system', content: SYSTEM_PROMPT(targetLang) },
            { role: 'user', content: windowPrompt(sub, cues[cues.length - 1]?.t || prevTail) },
          ], 3000, round === 0 ? undefined : STRONG_MODEL),
          sub as CleanWord[]
        );
        if (more.length) cues.push(...more);
      } catch {}
    }
  }
  attachSmallHoles(cues, lo, hi);
  return cues.sort((a, b) => a.w[0] - b.w[0]);
}

export async function translateWords(
  env: ScribeEnv,
  allWords: Word[],
  targetLang: string
): Promise<Cue[]> {
  const words = cleanWords(allWords);
  if (!words.length) throw new Error('No speech words found in ASR result');
  type WCue = Cue & { w: [number, number] };

  // Quranic quotes → LOCKED cues with canonical Uthmani text + Saheeh
  // International translation and citation. The LLM never sees these spans.
  let quotes: QuranQuote[] = [];
  try { quotes = await findQuranQuotes(env, words); } catch {}
  const lockedCues: WCue[] = [];
  for (const qt of quotes) {
    const cite = citeQuote(qt.verses);
    qt.verses.forEach((v, vi) => {
      const first = words[v.wStart];
      const last = words[v.wEnd];
      if (!first || !last) return;
      lockedCues.push({
        start: first.start,
        end: Math.max(last.end, first.start + 0.6),
        text: `“${v.en}”` + (vi === qt.verses.length - 1 ? ` (Quran ${cite})` : ''),
        source: v.ar,
        w: [v.wStart, v.wEnd],
        q: v.key,
      });
    });
  }

  // LLM windows cover only the unlocked ranges
  const lockedSpans = quotes.map((q) => [q.wStart, q.wEnd] as [number, number]).sort((a, b) => a[0] - b[0]);
  const freeRanges: [number, number][] = [];
  let cursor = 0;
  for (const [a, b] of lockedSpans) {
    if (a > cursor) freeRanges.push([cursor, a - 1]);
    cursor = Math.max(cursor, b + 1);
  }
  if (cursor < words.length) freeRanges.push([cursor, words.length - 1]);
  const windows = freeRanges.flatMap(([a, b]) => makeWindows(words.slice(a, b + 1)));

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

  // Stitch windows → cues with exact word-derived timing (keep word spans
  // internally so long cues can be SPLIT at real word boundaries, never
  // truncated into silent gaps)
  let cues: WCue[] = [];
  for (let i = 0; i < windows.length; i++) {
    for (const c of results[i]) {
      const first = words[c.w[0]];
      const last = words[c.w[1]];
      if (!first || !last) continue;
      cues.push({
        start: first.start,
        end: Math.max(last.end, first.start + 0.6),
        text: c.t,
        source: words.slice(c.w[0], c.w[1] + 1).map((w) => w.text).join(' '),
        w: [c.w[0], c.w[1]],
      });
    }
  }
  cues.push(...lockedCues);
  cues.sort((a, b) => a.start - b.start);

  // Split cues longer than ~8.5s at sentence/clause boundaries, timing the
  // split at the proportional source-word boundary
  const splitLocked = (cue: WCue): WCue[] => {
    const dur = cue.end - cue.start;
    if (dur <= 12 || cue.w[1] - cue.w[0] < 4) return [cue];
    const text = cue.text;
    const marks = [...text.matchAll(/[.!?؟…,;:—]\s+/g)].map((m) => m.index! + m[0].length);
    if (!marks.length) return [cue];
    const mid = text.length / 2;
    const splitAt = marks.reduce((p, c) => (Math.abs(c - mid) < Math.abs(p - mid) ? c : p));
    if (splitAt < 10 || text.length - splitAt < 10) return [cue];
    const share = splitAt / text.length;
    const wSplit = Math.max(cue.w[0] + 1, Math.min(cue.w[1], cue.w[0] + Math.round((cue.w[1] - cue.w[0]) * share)));
    const srcWords = cue.source.split(' ');
    const sSplit = Math.max(1, Math.min(srcWords.length - 1, Math.round(srcWords.length * share)));
    const a: WCue = { ...cue, end: words[wSplit - 1].end, w: [cue.w[0], wSplit - 1], text: text.slice(0, splitAt).trim(), source: srcWords.slice(0, sSplit).join(' ') };
    const b: WCue = { ...cue, start: words[wSplit].start, w: [wSplit, cue.w[1]], text: text.slice(splitAt).trim(), source: srcWords.slice(sSplit).join(' ') };
    return [...splitLocked(a), ...splitLocked(b)];
  };
  const splitOnce = (cue: WCue): WCue[] => {
    if (cue.q) return splitLocked(cue);
    const dur = cue.end - cue.start;
    if (dur <= 8.5 || cue.w[1] - cue.w[0] < 4) return [cue];
    const text = cue.text;
    const marks = [...text.matchAll(/[.!?؟…,;:]\s+/g)].map((m) => m.index! + m[0].length);
    const mid = text.length / 2;
    let splitAt = marks.length ? marks.reduce((p, c) => (Math.abs(c - mid) < Math.abs(p - mid) ? c : p)) : -1;
    if (splitAt < 8 || text.length - splitAt < 8) {
      const sp = [...text.matchAll(/\s+/g)].map((m) => m.index!);
      if (!sp.length) return [cue];
      splitAt = sp.reduce((p, c) => (Math.abs(c - mid) < Math.abs(p - mid) ? c : p)) + 1;
    }
    const share = splitAt / text.length;
    const wSplit = Math.max(cue.w[0] + 1, Math.min(cue.w[1], cue.w[0] + Math.round((cue.w[1] - cue.w[0]) * share)));
    const a: WCue = {
      start: cue.start, end: words[wSplit - 1].end, w: [cue.w[0], wSplit - 1],
      text: text.slice(0, splitAt).trim(),
      source: words.slice(cue.w[0], wSplit).map((w) => w.text).join(' '),
    };
    const b: WCue = {
      start: words[wSplit].start, end: cue.end, w: [wSplit, cue.w[1]],
      text: text.slice(splitAt).trim(),
      source: words.slice(wSplit, cue.w[1] + 1).map((w) => w.text).join(' '),
    };
    return [...splitOnce(a), ...splitOnce(b)];
  };
  cues = cues.flatMap(splitOnce);

  // Netflix-style post pass: ordered, non-overlapping, breathable
  cues.sort((a, b) => a.start - b.start);
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    const next = cues[i + 1];
    if (next && cue.end > next.start - 0.08) cue.end = Math.max(cue.start + 0.4, next.start - 0.08);
    if (next && cue.end > next.start) cue.end = next.start; // hard floor: never overlap
    if (cue.end - cue.start < 1.0) {
      const limit = next ? next.start - 0.08 : cue.end + 1.0;
      cue.end = Math.min(cue.start + 1.2, Math.max(cue.end, limit));
    }
  }
  // Reading-speed relief: dense cues linger into following silence (target ≤17 CPS)
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    const next = cues[i + 1];
    const dur = cue.end - cue.start;
    if (cue.text.length / dur > 17) {
      const need = cue.start + cue.text.length / 17;
      const limit = next ? next.start - 0.08 : cue.end + 2.0;
      cue.end = Math.max(cue.end, Math.min(need, limit, cue.end + 3.0));
    }
  }
  return cues.filter((c) => c.end > c.start && c.text.trim()).map(({ w, ...c }) => c);
}

/** Netflix-grade QA repair: strong model reviews source ↔ translation in
 * batches and fixes mistranslation, dropped content, over-long lines, and
 * reading-speed violations. Returns the repaired cue list. */
/** Pick the cues worth an expensive model's attention: mechanical smells
 * plus a cross-lingual embedding screen. Reviewing everything blanket-style
 * spent ~10x the tokens confirming cues that were already fine. */
async function suspiciousCues(env: ScribeEnv, cues: Cue[]): Promise<Set<number>> {
  const flagged = new Set<number>();
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    if ((c as any).q) continue; // canonical verse cue — locked
    const dur = Math.max(0.3, c.end - c.start);
    if (c.text.length / dur > 20) flagged.add(i); // CPS violation
    if (c.text.length > 90) flagged.add(i);
    if (/[؀-ۿ]/.test(c.text)) flagged.add(i); // Arabic leakage
    if (i > 0 && c.text === cues[i - 1].text) flagged.add(i); // repetition
    if (c.source && /الله/.test(c.source) && !/allah/i.test(c.text)) flagged.add(i);
  }
  // Embedding screen: low source↔translation similarity = likely mistranslation
  try {
    const ai = (env as any).AI;
    const cand = cues.map((c, i) => ({ c, i }))
      .filter(({ c, i }) => !(c as any).q && !flagged.has(i) && c.source && c.source.length >= 8 && c.text.length >= 8);
    const EB = 45;
    for (let i = 0; i < cand.length; i += EB) {
      const batch = cand.slice(i, i + EB);
      const [src, trn] = await Promise.all([
        ai.run('@cf/baai/bge-m3', { text: batch.map(({ c }) => c.source.slice(0, 480)) }),
        ai.run('@cf/baai/bge-m3', { text: batch.map(({ c }) => c.text.slice(0, 480)) }),
      ]);
      for (let j = 0; j < batch.length; j++) {
        const a = src?.data?.[j];
        const b = trn?.data?.[j];
        if (!a || !b) continue;
        let dot = 0, na = 0, nb = 0;
        for (let k = 0; k < a.length; k++) {
          dot += a[k] * b[k]; na += a[k] * a[k]; nb += b[k] * b[k];
        }
        if (dot / Math.sqrt(na * nb) < 0.6) flagged.add(batch[j].i);
      }
    }
  } catch {} // screen is best-effort; mechanical flags still stand
  // context: the neighbor on each side of every flagged cue
  const withNeighbors = new Set<number>();
  for (const i of flagged) {
    for (const n of [i - 1, i, i + 1]) {
      if (n >= 0 && n < cues.length && !(cues[n] as any).q) withNeighbors.add(n);
    }
  }
  return withNeighbors;
}

export async function qaPass(env: ScribeEnv, cues: Cue[], targetLang: string): Promise<{ cues: Cue[]; fixes: number }> {
  const BATCH = 40;
  let fixes = 0;
  const out = [...cues];
  const review = [...(await suspiciousCues(env, out))].sort((a, b) => a - b);
  const jobs: Promise<void>[] = [];
  const runBatch = async (offset: number) => {
    const batch = review.slice(offset, offset + BATCH);
    const lines = batch.map((idx) => {
      const c = out[idx];
      const dur = Math.max(0.3, c.end - c.start);
      const cps = Math.round(c.text.length / dur);
      const flag = cps > 20 ? ` [CPS ${cps} TOO FAST — condense]` : '';
      return `${idx}\nSRC: ${c.source}\nTRN: ${c.text}${flag}`;
    }).join('\n\n');
    if (!lines) return;
    try {
      const raw = await llmChat(env, [
        { role: 'system', content: `You are a Netflix-standard subtitle QA reviewer for Islamic lectures (${targetLang} target). Review source↔translation pairs. Output ONLY JSONL fixes for cues that need them (mistranslation, dropped meaning, awkward phrasing, CPS violations to condense, honorific mistakes):
{"i": cueNumber, "t": "corrected translation"}
Rules: max ~84 chars, keep honorifics (Allah ﷻ, Prophet ﷺ, RA/AS/RH), keep transliterations (fiqh, Sharia...), Quran quotes in established translation wording. If a cue is fine, output nothing for it. No commentary.` },
        { role: 'user', content: lines },
      ], 8000, QA_MODEL);
      for (const line of raw.split('\n')) {
        const t = line.trim().replace(/^```(json)?|```$/g, '').trim();
        if (!t.startsWith('{')) continue;
        try {
          const f = JSON.parse(t);
          if (typeof f.i === 'number' && typeof f.t === 'string' && out[f.i] && !(out[f.i] as any).q && f.t.trim()) {
            out[f.i] = { ...out[f.i], text: f.t.trim() };
            fixes++;
          }
        } catch {}
      }
    } catch {}
  };
  for (let i = 0; i < review.length; i += BATCH * 8) {
    const group = [];
    for (let j = i; j < Math.min(i + BATCH * 8, review.length); j += BATCH) group.push(runBatch(j));
    await Promise.all(group);
  }
  return { cues: out, fixes };
}
