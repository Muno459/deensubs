// Step 3: segment + translate in one LLM pass (port of Scribe's pipeline v2).
//
// The idea carried over from the desktop app: every subtitle cue is
// addressed by WORD INDICES into the ASR output, so timing comes directly
// from speech — zero drift, no alignment pass. The LLM sees numbered words
// with timestamps, gap markers, and speaker changes, and answers with
// JSONL cues {"w":[first,last],"t":"translation"}.

import type { Cue, ScribeEnv, Word } from './types';
import { findQuranQuotes, citeQuote, type QuranQuote } from './quran';

export type CleanWord = { i: number; text: string; start: number; end: number; speaker: string; chars?: { start: number; end: number }[] };

// Display limits. A cue must fit two 42-char lines, and must be readable in the
// time it is on screen. Splitting used to trigger on DURATION alone, which made
// a short-but-text-heavy cue unreachable: a whole canonical verse pinned to a
// 1.3s recitation span stayed one 541-character cue at ~400 CPS.
const MAX_CUE_CHARS = 84; // 2 lines x 42
const TARGET_CPS = 17;
// Splitting divides the cue's TIME as well as its text, so it only helps when
// every piece still gets long enough to be read. A canonical verse pinned to a
// 1s recitation span has no time to divide: cutting it produced 0.04s slivers at
// 800+ CPS, strictly worse than the one dense cue it came from. Below this,
// leave the cue whole and let the reading-speed pass borrow following silence.
const MIN_PIECE_SEC = 1.2;

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
    const ch = (w as any).characters;
    out.push({ i: out.length, text, start: w.start, end: w.end, speaker: w.speaker_id || '',
      chars: Array.isArray(ch) && ch.length ? ch.map((x: any) => ({ start: x.start, end: x.end })) : undefined });
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
- Each cue: ideally 1.5-7 seconds of speech, translation at most 2 lines x 42 characters (~84 chars). NEVER exceed 84 characters — split into another cue instead.

SEGMENT ON MEANING AND DELIVERY, NOT ON LENGTH. Every cue must be a self-contained unit a viewer can read in one glance. Judge a boundary by all of these together, not by character count:
- Where the speaker pauses or draws breath ([GAP] markers, and the audio itself when you are given it). This is the strongest signal.
- Where the grammar closes: end at a clause or sentence boundary, never mid-clause dangling into the next cue.
- NEVER end a cue on a word that governs what follows: an article (a, the), preposition (of, in, to, for, with, from, by), conjunction (and, or, but), auxiliary (is, was, has), or a relative (that, which, who). Move that word to the next cue.
- Keep together what cannot be understood apart: a verb and its object, a name and its title, a number and its unit, a quotation and the verb introducing it.
- DO NOT OVER-SEGMENT. Fewer, complete cues read better than many small ones. Use the full 84 characters when the thought fills them; only cut earlier when the sentence genuinely breaks there. If a piece would be under ~25 characters or under ~1.5 seconds, merge it into the neighbouring cue instead of emitting it alone.
- Every word index appears in exactly ONE cue, and no word of the translation may appear at the end of one cue and again at the start of the next. Never repeat a word across a boundary.
- Translate to ${targetLang}. Translate ALL meaningful content faithfully — never paraphrase away or condense meaning.
- Clean speech artifacts: drop stutters, false starts, and filler sounds from the translation (their word indices still belong to the cue covering that span).
- Islamic honorifics: Allah ﷻ, the Prophet Muhammad ﷺ, companions (RA), earlier prophets (AS), scholars (RH).
- Keep as transliterations (do not translate): fatwa, mufti, Sharia, fiqh, usul al-fiqh, ifta, Haramain, madhhab, and similar established terms.
- Quranic verses: use established translation wording, wrapped in quotes.
- Proper nouns and Arabic terms: standard English transliteration.
- No markdown, no commentary, no code fences — only JSONL lines.`;

function windowPrompt(win: CleanWord[], prevTail: string, verseContext?: string): string {
  const lines: string[] = [];
  // A verse recited just before this passage is almost always its subject: the
  // speaker recites, then explains. The verse itself is a locked cue the model
  // never translates, but without it here the explanation loses its referent.
  if (verseContext) {
    lines.push(`The speaker has just recited this Quran passage, and the words below explain it. Use it to resolve pronouns and references. Do NOT translate or repeat it: ${verseContext}`, '');
  }
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

// Real per-model pricing (USD per 1M tokens), cache-aware. First match wins,
// so specific patterns sit above generic ones. Gemini 3.1 Pro is tiered by
// per-request prompt size; Sonnet 5 is at its introductory price through
// 2026-08-31 ($3/$15 after — bump then). Cache storage-per-hour cannot be
// metered from usage objects and is excluded.
const PRICES: {
  match: RegExp; in: number; out: number; cacheRead: number; cacheWrite: number;
  over200k?: { in: number; out: number; cacheRead: number };
}[] = [
  { match: /gemini.*flash/i, in: 1.5, out: 9, cacheRead: 0.15, cacheWrite: 1.5 },
  { match: /gemini.*pro/i, in: 2, out: 12, cacheRead: 0.2, cacheWrite: 2, over200k: { in: 4, out: 18, cacheRead: 0.4 } },
  { match: /fable|mythos/i, in: 10, out: 50, cacheRead: 1, cacheWrite: 12.5 },
  { match: /opus-4[.-]?1\b|opus-4\b/i, in: 15, out: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  { match: /opus/i, in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  { match: /sonnet-?5/i, in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  { match: /sonnet/i, in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  { match: /haiku-?3/i, in: 0.8, out: 4, cacheRead: 0.08, cacheWrite: 1 },
  { match: /haiku/i, in: 1, out: 5, cacheRead: 0.1, cacheWrite: 1.25 },
];

/** Price one usage object (OpenAI- or Anthropic-shaped, both read defensively). */
function priceUsage(model: string, u: any): number {
  const p = PRICES.find((r) => r.match.test(model));
  if (!p || !u) return 0;
  const prompt = u.prompt_tokens ?? u.input_tokens ?? 0;
  const out = u.completion_tokens ?? u.output_tokens ?? 0;
  const cached = u.prompt_tokens_details?.cached_tokens ?? u.cache_read_input_tokens ?? 0;
  const cacheW = u.cache_creation_input_tokens ?? 0;
  const tier = p.over200k && prompt > 200_000 ? p.over200k : p;
  const fresh = Math.max(0, prompt - cached - cacheW);
  return (fresh * tier.in + cached * tier.cacheRead + cacheW * p.cacheWrite + out * tier.out) / 1e6;
}

// Token + cost accumulators (per workflow step; read+reset via takeUsage/takeCost)
let usageTokens = 0;
let usageCost = 0;
export function takeCost(): number {
  const c = usageCost;
  usageCost = 0;
  return Math.round(c * 1e6) / 1e6;
}
export function takeUsage(): number {
  const t = usageTokens;
  usageTokens = 0;
  return t;
}

/** Parse an SSE chat stream ("data: {...}" lines) into the full content. */
function parseSse(text: string, model: string): string {
  let out = '';
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (payload === '[DONE]') break;
    try {
      const obj = JSON.parse(payload);
      out += obj.choices?.[0]?.delta?.content ?? obj.choices?.[0]?.message?.content ?? '';
      if (obj.usage?.total_tokens) {
        usageTokens += obj.usage.total_tokens;
        usageCost += priceUsage(model, obj.usage);
      }
    } catch {}
  }
  return out;
}

/**
 * Chat call against the router. Some router providers (agent-backed models)
 * answer with an SSE stream even when stream:false is sent, so both shapes
 * are handled.
 */
/** Audio-in-the-loop: cut this window's slice of the source recording as a
 * small 16 kHz mono mp3 and shape it as an OpenAI-style input_audio content
 * part, so Gemini HEARS the passage while translating. Returns null on any
 * failure — callers always degrade to today's text-only request. */
export type AudioOpts = { jobId: string; sourceUrl: string };
export async function windowAudio(env: ScribeEnv, opts: AudioOpts, startSec: number, endSec: number): Promise<any | null> {
  try {
    const start = Math.max(0, startSec - 1);
    const dur = Math.min(480, endSec - start + 2);
    if (!(dur > 2)) return null;
    const { containerCall } = await import('./asr');
    const res = await containerCall(env, 'aclip-' + opts.jobId, '/audioclip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: opts.sourceUrl, start, dur }),
    });
    if (!res.ok) return null;
    const { b64 } = (await res.json()) as any;
    if (!b64 || b64.length > 4_000_000) return null;
    return { type: 'input_audio', input_audio: { data: b64, format: 'mp3' } };
  } catch {
    return null;
  }
}

/** Appended to the system prompt ONLY when the window's audio is attached.
 *  Where a cue should break is a question about speech, not about text, and the
 *  model can hear the answer: breaths and held pauses mark real boundaries that
 *  punctuation and word timings only approximate. So when audio is present it
 *  outranks the textual heuristics for cut placement. */
export const AUDIO_NOTE = `
- You are ALSO given the actual audio of this passage (it begins at the first listed word). The numbered words stay the authoritative transcript, but the AUDIO is the authority on WHERE TO CUT.
- Put cue boundaries where the speaker actually breaks: a breath, a held pause, the voice falling to close a thought or lifting to open a new one. Never cut while the speaker is still mid-flow just because the text reached its character budget; end the cue earlier, at the last real break.
- Equally, do not invent a break the speaker did not make. If they run a phrase straight through, keep it in one cue.
- A phrase delivered in one continuous breath belongs in one cue. If it is too long for one cue, split it at the speaker's own internal pause, never at the midpoint of the text.
- Keep an emphasised or stressed word together with the phrase it belongs to.
- Recitation (Quran, hadith, du'a) is phrased by the reciter's stops, which do not line up with English sentence punctuation. Follow what you hear.
- The [GAP] markers are a rough hint derived from timings. Trust the audio over them.`;

export async function llmChat(env: ScribeEnv, messages: any[], maxTokens = 4000, model?: string): Promise<string> {
  const base = (env.SCRIBE_LLM_URL || '').replace(/\/$/, '');
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.SCRIBE_LLM_KEY },
    body: JSON.stringify({
      model: model || env.SCRIBE_LLM_MODEL || 'ag/gemini-3.6-flash-tiered',
      messages,
      temperature: 0.4,
      max_tokens: maxTokens,
      stream: false,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 200)}`);

  const effModel = model || env.SCRIBE_LLM_MODEL || 'ag/gemini-3.6-flash-tiered';
  let content = '';
  if (text.trimStart().startsWith('data:')) {
    content = parseSse(text, effModel);
  } else {
    try {
      const data: any = JSON.parse(text);
      content = data.choices?.[0]?.message?.content || '';
      if (data.usage?.total_tokens) {
        usageTokens += data.usage.total_tokens;
        usageCost += priceUsage(effModel, data.usage);
      }
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
  prevTail: string,
  audio?: any | null,
  verseContext?: string
): Promise<{ w: [number, number]; t: string }[]> {
  const lo = win[0].i;
  const hi = win[win.length - 1].i;
  const userText = windowPrompt(win, prevTail, verseContext);

  // Ladder: primary twice, then the strong model. Audio rides only on the
  // primary (Gemini) attempts — the strong fallback sends the exact
  // text-only request the pipeline always sent.
  let cues: { w: [number, number]; t: string }[] = [];
  for (const model of [undefined, undefined, STRONG_MODEL]) {
    const withAudio = !!audio && model === undefined;
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT(targetLang) + (withAudio ? AUDIO_NOTE : '') },
      { role: 'user', content: withAudio ? [{ type: 'text', text: userText }, audio] : userText },
    ];
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
  targetLang: string,
  audioOpts?: AudioOpts
): Promise<Cue[]> {
  const words = cleanWords(allWords);
  if (!words.length) throw new Error('No speech words found in ASR result');
  type WCue = Cue & { w: [number, number] };

  // Quranic quotes → LOCKED cues with canonical Uthmani text + Saheeh
  // International translation and citation. The LLM never sees these spans.
  let quotes: QuranQuote[] = [];
  try { quotes = await findQuranQuotes(env, words); } catch {}

  // A verse recited over several seconds, or broken by an ASR error mid-way,
  // can match as two or three separate quotes — and each match carries the FULL
  // canonical translation, so the whole verse gets shown repeatedly, each copy
  // crammed into a fraction of its recitation (541 chars in 1.3s = 400 CPS).
  // Merge adjacent quotes that are the SAME single verse so the text appears
  // once, spanning the whole recitation; splitLocked then breaks it into
  // readable pieces. Multi-verse quotes (distinct keys) are left untouched.
  quotes.sort((a, b) => a.wStart - b.wStart);
  const mergedQ: QuranQuote[] = [];
  for (const q of quotes) {
    const p = mergedQ[mergedQ.length - 1];
    if (p && p.verses.length === 1 && q.verses.length === 1
        && p.verses[0].key === q.verses[0].key && q.wStart - p.wEnd <= 8) {
      p.wEnd = Math.max(p.wEnd, q.wEnd);
      p.verses[0].wEnd = Math.max(p.verses[0].wEnd, q.verses[0].wEnd);
      p.matched += q.matched;
    } else {
      mergedQ.push(q);
    }
  }
  quotes = mergedQ;

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
  // The verse recited immediately before a range is context for the passage
  // that follows it, so tag the first window of that range with it.
  const verseBefore = new Map<number, string>();
  for (const q of quotes) {
    const cite = citeQuote(q.verses);
    verseBefore.set(q.wEnd + 1, `${q.verses.map((v) => `“${v.en}”`).join(' ')} (Quran ${cite})`.slice(0, 1200));
  }
  const windows: CleanWord[][] = [];
  const windowVerse: (string | undefined)[] = [];
  for (const [a, b] of freeRanges) {
    makeWindows(words.slice(a, b + 1)).forEach((w, i) => {
      windows.push(w);
      windowVerse.push(i === 0 ? verseBefore.get(a) : undefined);
    });
  }

  // Windows are independent (context tail is best-effort), so run in batches
  const results: { w: [number, number]; t: string }[][] = new Array(windows.length);
  for (let i = 0; i < windows.length; i += CONCURRENCY) {
    const batch = windows.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(
      batch.map(async (win, j) => {
        const prev = windows[i + j - 1];
        const prevTail = prev ? prev.slice(-12).map((w) => w.text).join(' ') : '';
        const audio = audioOpts
          ? await windowAudio(env, audioOpts, win[0].start, win[win.length - 1].end)
          : null;
        return translateWindow(env, targetLang, win, prevTail, audio, windowVerse[i + j]);
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
    if ((dur <= 12 && cue.text.length <= MAX_CUE_CHARS) || cue.w[1] - cue.w[0] < 2) return [cue];
    if (dur < MIN_PIECE_SEC * 2) return [cue]; // no time to divide
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
    // Too long to read in two lines, or too long on screen, is worth splitting
    // — but only where the sentence actually allows it (see below).
    if ((dur <= 8.5 && cue.text.length <= MAX_CUE_CHARS) || cue.w[1] - cue.w[0] < 2) return [cue];
    if (dur < MIN_PIECE_SEC * 2) return [cue]; // no time to divide
    const text = cue.text;
    const marks = [...text.matchAll(/[.!?؟…,;:]\s+/g)].map((m) => m.index! + m[0].length);
    const mid = text.length / 2;
    const splitAt = marks.length ? marks.reduce((p, c) => (Math.abs(c - mid) < Math.abs(p - mid) ? c : p)) : -1;
    // No syntactic boundary means any cut lands mid-clause. Splitting at the
    // nearest bare space (what this used to do) manufactures exactly the
    // dangling fragments the segmentation rules exist to prevent, so a cue with
    // nowhere clean to break is left alone.
    if (splitAt < 8 || text.length - splitAt < 8) return [cue];
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
    if (cue.text.length / dur > TARGET_CPS) {
      const need = cue.start + cue.text.length / TARGET_CPS;
      const limit = next ? next.start - 0.08 : cue.end + 2.0;
      // A locked verse carries canonical wording that cannot be condensed and,
      // when only part of it was recited, far more text than its span can hold.
      // Time is the only lever left, so let it take whatever silence follows
      // instead of the 3s a normal cue may borrow. `limit` still forbids
      // overlapping the next cue either way.
      const grab = cue.q ? 12.0 : 3.0;
      cue.end = Math.max(cue.end, Math.min(need, limit, cue.end + grab));
    }
  }
  // Splitting above lands every cut on a real word boundary, so the timing stays
  // tied to the speech. What is left is display polish the model is not reliable
  // at: joining cues too brief to read, dropping a word written twice across a
  // seam, and handing dense cues the silence beside them. It moves no cue more
  // than half a second from where its words are spoken.
  const { polishCues } = await import('./polish');
  return polishCues(cues.filter((c) => c.end > c.start && c.text.trim()).map(({ w, ...c }) => c));
}

/**
 * Tighten the few cues still too dense to read, after timing has done all it can.
 *
 * Reading speed is characters over seconds. Once a cue has taken every spare
 * moment beside it and its neighbours have none to give, the only remaining
 * lever is wording. Measured on a real lecture that is a handful of cues and
 * about 1.5% of the characters, so this is a small, targeted call rather than
 * another pass over the whole file.
 *
 * Verses are never touched: their wording is canonical. Nothing is dropped
 * either, only said in fewer words, and a rewrite is rejected unless it is
 * genuinely shorter.
 */
export async function condenseDense(env: ScribeEnv, cues: Cue[], targetLang: string): Promise<{ cues: Cue[]; fixed: number }> {
  const OVER = 20; // leaves headroom under the 21 CPS target
  const out = [...cues];
  const todo = out
    .map((c, i) => ({ i, c }))
    .filter(({ c }) => !(c as any).q && c.text.length / Math.max(0.3, c.end - c.start) > OVER);
  if (!todo.length) return { cues: out, fixed: 0 };

  let fixed = 0;
  const BATCH = 25;
  for (let k = 0; k < todo.length; k += BATCH) {
    const batch = todo.slice(k, k + BATCH);
    const lines = batch
      .map(({ i, c }) => `${i}\tmax ${Math.max(12, Math.round((c.end - c.start) * TARGET_CPS))} chars\t${c.text}`)
      .join('\n');
    try {
      const raw = await llmChat(env, [
        { role: 'system', content: `You tighten subtitle lines for an Islamic lecture so they can be read in the time they are on screen. Target language: ${targetLang}. Keep the meaning, the register and every honorific (Allah ﷻ, the Prophet ﷺ, RA/AS/RH) exactly as they are. Keep transliterations (Tawhid, Sunnah, fiqh, Sharia). Do not add or remove content: say the same thing in fewer words. Return ONLY JSONL, one object per line: {"i": <id>, "t": "<shortened line>"}. Omit any line you cannot shorten without losing meaning.` },
        { role: 'user', content: lines },
      ], 4000, STRONG_MODEL);
      for (const line of raw.split('\n')) {
        const t = line.trim().replace(/^```(json)?|```$/g, '').trim();
        if (!t.startsWith('{')) continue;
        try {
          const f = JSON.parse(t);
          const txt = typeof f.t === 'string' ? f.t.trim() : '';
          if (typeof f.i === 'number' && out[f.i] && !(out[f.i] as any).q
              && txt && txt.length < out[f.i].text.length) {
            out[f.i] = { ...out[f.i], text: txt };
            fixed++;
          }
        } catch { /* skip a malformed line */ }
      }
    } catch { /* a failed batch just leaves those cues as they were */ }
  }
  return { cues: out, fixed };
}

/** Netflix-grade QA repair: strong model reviews source ↔ translation in
 * batches and fixes mistranslation, dropped content, over-long lines, and
 * reading-speed violations. Returns the repaired cue list. */
export async function qaPass(env: ScribeEnv, cues: Cue[], targetLang: string): Promise<{ cues: Cue[]; fixes: number }> {
  const BATCH = 40;
  let fixes = 0;
  const out = [...cues];
  const jobs: Promise<void>[] = [];
  const runBatch = async (offset: number) => {
    const batch = out.slice(offset, offset + BATCH);
    const lines = batch.map((c, i) => {
      if ((c as any).q) return null; // canonical verse cue — locked
      const dur = Math.max(0.3, c.end - c.start);
      const cps = Math.round(c.text.length / dur);
      const flag = cps > 20 ? ` [CPS ${cps} TOO FAST — condense]` : '';
      return `${offset + i}\nSRC: ${c.source}\nTRN: ${c.text}${flag}`;
    }).filter(Boolean).join('\n\n');
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
  for (let i = 0; i < out.length; i += BATCH * 8) {
    const group = [];
    for (let j = i; j < Math.min(i + BATCH * 8, out.length); j += BATCH) group.push(runBatch(j));
    await Promise.all(group);
  }
  return { cues: out, fixes };
}
