// Step 3: segment + translate in one LLM pass (port of Scribe's pipeline v2).
//
// The idea carried over from the desktop app: every subtitle cue is
// addressed by WORD INDICES into the ASR output, so timing comes directly
// from speech — zero drift, no alignment pass. The LLM sees numbered words
// with timestamps, gap markers, and speaker changes, and answers with
// JSONL cues {"w":[first,last],"t":"translation"}.

import type { Cue, ScribeEnv, Word } from './types';
import { findQuranQuotes, citeQuote, type QuranQuote, type QuoteVerse } from './quran';

export type CleanWord = { i: number; text: string; start: number; end: number; speaker: string; chars?: { start: number; end: number }[] };

// Display limits. A cue must fit two 42-char lines, and must be readable in the
// time it is on screen. Splitting used to trigger on DURATION alone, which made
// a short-but-text-heavy cue unreachable: a whole canonical verse pinned to a
// 1.3s recitation span stayed one 541-character cue at ~400 CPS.
const MAX_LINE = 42;
const MAX_CUE_CHARS = 84; // 2 lines x 42
const TARGET_CPS = 17;
// Splitting divides the cue's TIME as well as its text, so it only helps when
// every piece still gets long enough to be read. A canonical verse pinned to a
// 1s recitation span has no time to divide: cutting it produced 0.04s slivers at
// 800+ CPS, strictly worse than the one dense cue it came from. Below this,
// leave the cue whole and let the reading-speed pass borrow following silence.
/** How much of a verse must actually have been recited before its canonical
 *  translation is shown. Below this the speaker quoted a clause, not the verse,
 *  and the official text would be far more words than the seconds can hold. */
const MIN_VERSE_COVER = 0.6;
const MIN_PIECE_SEC = 1.2;

const WINDOW_SIZE = 180; // words per LLM call — bigger windows = fewer calls; hole-filling catches drops
const WINDOW_LOOKAHEAD = 30; // stretch to a natural boundary
const CONCURRENCY = 16; // gemini flash sustains this fine; 6 made a 2.5h lecture translate in ~40 min

/** Cue text on one line. The model writes its own line break, and both repair
 *  prompts are line-delimited, so it has to be flattened on the way in. */
const flat = (t: string) => t.replace(/\s*\n\s*/g, ' ').trim();

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

// Kept deliberately short. Every readability rule that used to live here — line
// breaks, characters per second, how a cue must open, how Arabic chains clauses
// — was piled on over time, and measured, the model stopped being able to obey
// the ONE thing only it can do: return a cue for every word. On a 185-word
// window it came back with a numbered list instead of JSON, or eleven cues
// covering 95 words. Everything it skips is then glued onto a neighbouring cue
// and never translated, which is where the 87-second cue came from.
//
// So this asks for coverage, faithfulness and sensible boundaries, and nothing
// else. Readability is repaired afterwards by refitCues, one cue at a time,
// where the model has attention to spare for it.
// Modelled on the scribe pipeline, which does the same job without a repair
// layer. Two ideas carry it: the model returns the two LINES it wants shown, so
// nothing here has to wrap text; and the constraints are stated as self-checks
// the model can apply while writing, rather than as detectors that find faults
// afterwards and hand them back.
const SYSTEM_PROMPT = (targetLang: string) => `You are a professional subtitle translator into ${targetLang}. You receive numbered Arabic words with timestamps and speaker labels. You segment AND translate in one pass, the way a human subtitler does.

FOR EACH CUE output one compact JSON line:
{"w":[0,5],"l1":"We praise Allah ﷻ","l2":"for this blessed gathering."}
{"w":[6,12],"l1":"And this purposeful seminar."}

w = [first, last] word index, inclusive. l1 = line 1, l2 = line 2 (optional).

SEGMENTING
- Each cue is consecutive words forming one subtitle. Aim for 1-7 seconds.
- Cut at natural boundaries: sentence ends, clause breaks, pauses. [PAUSE] and [BREAK] mark where he stops — prefer cutting there.
- Never cut mid-phrase, or between a name and its honorific. Never split across speakers ([SPEAKER]).
- Every word index in the assigned range appears in exactly one cue. No gaps, no overlaps. A skipped range reaches the viewer untranslated.

TRANSLATING
- End each cue on terminal punctuation (. ? !), not on a comma. A cue is read on its own, so it has to finish a thought.
- Translate ALL meaningful content: every idea, name, number, title. Do not paraphrase or condense. Three ideas in the Arabic are three in the translation.
- Each line at most 42 characters. At most two lines.
- Clean up ASR artifacts: stutters, false starts, filler. Never drop meaningful content for brevity.

SELF-CHECK BEFORE YOU EMIT A CUE
- If a cue covers 7+ seconds and your translation is under 40 characters, you have skipped something. Re-read the words and say all of it.
- If a cue covers under 2 seconds and your translation is over 60 characters, nobody can read it. Use fewer words or move a clause to the next cue.

ISLAMIC CONVENTIONS
- Render these as symbols, do not translate the Arabic phrase:
    Allah ﷻ           ← سبحانه وتعالى، تبارك وتعالى، عز وجل، جل جلاله
    the Prophet ﷺ     ← صلى الله عليه وسلم، عليه الصلاة والسلام
    prophets (AS)     ← عليه السلام
    companions (RA)   ← رضي الله عنه/عنها/عنهم
    scholars (RH)     ← رحمه الله، رحمها الله
- Quranic verses: established translation wording, in quotes, kept in one cue where it fits.
- Transliterate rather than translate: fatwa, mufti, Sharia, fiqh, usul al-fiqh, madhhab, Tawhid, Sunnah, dhikr, taqwa.

Output compact JSONL only. No newlines inside a JSON object. No commentary, no code fences.`;

function windowPrompt(win: CleanWord[], prevTail: string, verseContext?: string): string {
  const lines: string[] = [];
  // A verse recited just before this passage is almost always its subject: the
  // speaker recites, then explains. The verse itself is a locked cue the model
  // never translates, but without it here the explanation loses its referent.
  if (verseContext) {
    // Two different notes arrive here. One is the verse just recited, which is
    // background and must not be repeated. The other is a verse recited only in
    // part INSIDE this window, which must be translated, in the wording given.
    lines.push(verseContext.includes('PARTLY RECITED BELOW')
      ? verseContext
      : `The speaker has just recited this Quran passage, and the words below explain it. Use it to resolve pronouns and references. Do NOT translate or repeat it: ${verseContext}`, '');
  }
  if (prevTail) lines.push(`Previous cue for context (already translated, do NOT repeat): ${prevTail}`, '');
  lines.push('Words:');
  let lastSpeaker = win[0]?.speaker || '';
  for (let k = 0; k < win.length; k++) {
    const w = win[k];
    if (k > 0) {
      // A1 grades the model on beginning cues after a pause of 0.15s or more,
      // but only gaps of 0.4s were ever shown to it — so most of the pauses it
      // is asked to cut on were invisible in its input. Both tiers are marked
      // now, named for what they are rather than as a number to be parsed.
      const gap = w.start - win[k - 1].end;
      if (gap >= 0.6) lines.push(`[BREAK ${Math.round(gap * 1000)}ms — he stops here]`);
      else if (gap >= 0.15) lines.push(`[PAUSE ${Math.round(gap * 1000)}ms]`);
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
- You are also given the audio of this passage, beginning at the first listed word. Use it to hear where sentences END: his voice falls and settles when a thought closes, and holds level when he is still going. End cues where it falls, not where the text reached a length.
- He speaks in breath groups; one breath group is one cue where it fits.
- His voice changes when he quotes the Qur'an, a hadith or a person. Start a cue where the quotation begins and close it where his normal voice returns.
- [BREAK] is where he stops, [PAUSE] a shorter hesitation. Both are read off the timings; trust the audio over them.`;

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
      // The model returns the two lines it wants shown; `t` stays accepted so an
      // older reply shape still parses.
      const l1 = typeof obj.l1 === 'string' ? obj.l1.trim() : '';
      const l2 = typeof obj.l2 === 'string' ? obj.l2.trim() : '';
      const joined = l1 && l2 ? `${l1}\n${l2}` : l1 || (typeof obj.t === 'string' ? obj.t : '');
      if (!Array.isArray(obj.w) || obj.w.length !== 2 || !joined) continue;
      obj.t = joined;
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
// One model does everything in this pipeline. The repair and QA passes used to
// reach for a slower, pricier one on the theory that touch-ups deserve the best;
// measured, that is what turned a two-and-a-half minute translate step into
// forty. Quality here is held by validation — a reply that does not tile the
// word range, fit its own seconds or cut at his pauses is discarded whichever
// model wrote it — so the fast model is the right one throughout.
const FLASH = 'ag/gemini-3.6-flash-tiered';
const STRONG_MODEL = FLASH;
const QA_MODEL = FLASH;

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
      const raw = await llmChat(env, messages, 8000, model);
      cues = parseCues(raw, win);
      const covered = cues.reduce((n, c) => n + (c.w[1] - c.w[0] + 1), 0);
      console.log(`win ${lo}-${hi}: ${win.length} words in, ${raw.length} chars back, `
        + `${cues.length} cues covering ${covered} words${model ? ' [fallback]' : ''}`
        + ` || RAW: ${raw.slice(0, 400).replace(/\n/g, ' ~ ')}`);
      if (cues.length) break;
    } catch (e: any) {
      console.log(`win ${lo}-${hi}: threw ${e?.message}`);
    }
  }
  if (!cues.length) throw new Error(`window ${lo}-${hi} failed on all models`);

  // Hole-filling: translate what the model skipped instead of stretching timing.
  // This is the pipeline's most important loop and it was the quietest. What it
  // leaves behind gets glued onto a neighbouring cue by word range with no text
  // added, so a stretch the model skipped becomes a cue that covers 87 seconds
  // and says one line — the speech is "covered" and never translated. Three
  // rounds, and a token budget that can actually answer a long hole.
  for (let round = 0; round < 3; round++) {
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
          ], 8000, round === 0 ? undefined : STRONG_MODEL),
          sub as CleanWord[]
        );
        if (more.length) cues.push(...more);
      } catch {}
    }
  }
  const left = computeHoles(cues, lo, hi).filter(([a, b]) => b - a + 1 >= 3);
  if (left.length) {
    const words = left.reduce((n, [a, b]) => n + (b - a + 1), 0);
    console.log(`window ${lo}-${hi}: ${left.length} holes unresolved after 3 rounds, ${words} words skipped`);
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

  // A verse only earns its canonical translation when it was actually recited.
  // Lecturers quote one famous clause of a long verse constantly, and locking
  // the whole official text onto those few seconds is unreadable: 65:2 arrived
  // as 376 characters over 3.6s, 104 CPS, and no amount of timing fixes that
  // because the text cannot be shortened. Below the threshold the words go back
  // to the translator like any other speech, and the citation is appended
  // afterwards so the reference is not lost.
  const lockedCues: WCue[] = [];
  const fragments: { wStart: number; wEnd: number; cite: string }[] = [];
  const lockedVerses: QuoteVerse[] = [];
  for (const qt of quotes) {
    const full = qt.verses.filter((v) => v.cover >= MIN_VERSE_COVER);
    for (const v of qt.verses) {
      if (v.cover < MIN_VERSE_COVER) fragments.push({ wStart: v.wStart, wEnd: v.wEnd, cite: v.key });
    }
    if (!full.length) continue;
    const cite = citeQuote(full);
    full.forEach((v, vi) => {
      const first = words[v.wStart];
      const last = words[v.wEnd];
      if (!first || !last) return;
      lockedVerses.push(v);
      lockedCues.push({
        start: first.start,
        end: Math.max(last.end, first.start + 0.6),
        text: `“${v.en}”` + (vi === full.length - 1 ? ` (Quran ${cite})` : ''),
        source: v.ar,
        w: [v.wStart, v.wEnd],
        q: v.key,
      });
    });
  }

  // LLM windows cover only the unlocked ranges. Spans come from the verses that
  // actually locked, so a fragment's words fall into a free range and get
  // translated instead of going out with no cue at all.
  const lockedSpans = lockedVerses.map((v) => [v.wStart, v.wEnd] as [number, number]).sort((a, b) => a[0] - b[0]);
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
  // A verse recited only in part is translated here like ordinary speech, and
  // the model has no way to know it is handling Qur'an: "ألا بذكر الله تطمئن
  // القلوب" came back as "Hearts find rest." The canonical wording of the whole
  // ayah travels with the window so the recited clause can be rendered in its
  // own register — and completely.
  const fragmentNote = (win: CleanWord[]): string | undefined => {
    const lo = win[0].i;
    const hi = win[win.length - 1].i;
    const hits = fragments.filter((f) => f.wEnd >= lo && f.wStart <= hi);
    if (!hits.length) return undefined;
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const f of hits) {
      if (seen.has(f.cite)) continue;
      seen.add(f.cite);
      const v = quotes.flatMap((q) => q.verses).find((x) => x.key === f.cite);
      if (v) lines.push(`Quran ${f.cite}: “${v.en}”`);
    }
    return lines.length ? lines.join('\n').slice(0, 1400) : undefined;
  };

  const windows: CleanWord[][] = [];
  const windowVerse: (string | undefined)[] = [];
  for (const [a, b] of freeRanges) {
    makeWindows(words.slice(a, b + 1)).forEach((w, i) => {
      windows.push(w);
      const before = i === 0 ? verseBefore.get(a) : undefined;
      const frag = fragmentNote(w);
      windowVerse.push([before, frag && `PARTLY RECITED BELOW — render the recited words in this wording, in full:\n${frag}`]
        .filter(Boolean).join('\n\n') || undefined);
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

  // A verse quoted in part was translated as ordinary speech, so the reference
  // has to be put back by hand. It goes on the last cue covering the quoted
  // words, which is where a reader expects a citation to sit.
  for (const f of fragments) {
    const hit = cues.filter((c) => !c.q && c.w[0] <= f.wEnd && c.w[1] >= f.wStart).pop();
    if (hit && !hit.text.includes('(Quran ')) hit.text = `${hit.text} (Quran ${f.cite})`;
  }

  // Split cues longer than ~8.5s at sentence/clause boundaries, timing the
  // split at the proportional source-word boundary
  const splitLocked = (cue: WCue): WCue[] => {
    const dur = cue.end - cue.start;
    // A verse is cut whenever it will not fit on screen, whatever its duration.
    // Gating that on 12 seconds left eleven canonical cues over the character
    // limit: the recitation was quick, the official translation was not.
    if (dur <= 12 && cue.text.length <= MAX_CUE_CHARS) return [cue];
    // A whole ayah recited quickly is long text over a short span — 1:7 came out
    // at 136 characters in 2.89s. Two cues of 68 read; one of 136 does not fit
    // the screen at all, so the comfortable minimum gives way when the text will
    // otherwise overflow. Below 1.2s there is no room for two cues either way.
    const mustFit = cue.text.length > MAX_CUE_CHARS;
    if (!mustFit && dur < MIN_PIECE_SEC * 2) return [cue];
    if (dur < 1.2) return [cue]; // no time to divide at all
    const text = cue.text;
    const marks = [...text.matchAll(/[.!?؟…,;:—]\s+/g)].map((m) => m.index! + m[0].length);
    // Canonical wording is continuous and cannot be reworded, so when it offers
    // no punctuation near the middle it is still better carried over two cues
    // than spilling off the screen. This fallback is for scripture only; the
    // model's own sentences are never cut here.
    const usable = marks.filter((m) => m >= 10 && text.length - m >= 10);
    let splitAt: number;
    if (usable.length) {
      const mid = text.length / 2;
      splitAt = usable.reduce((p, c) => (Math.abs(c - mid) < Math.abs(p - mid) ? c : p));
    } else {
      const sp = [...text.matchAll(/\s+/g)].map((m) => m.index! + m[0].length)
        .filter((m) => m >= 10 && text.length - m >= 10);
      if (!sp.length) return [cue];
      const mid = text.length / 2;
      splitAt = sp.reduce((p, c) => (Math.abs(c - mid) < Math.abs(p - mid) ? c : p));
    }
    const share = splitAt / text.length;
    const srcWords = cue.source.split(' ');
    const sSplit = Math.max(1, Math.min(srcWords.length - 1, Math.round(srcWords.length * share)));
    let a: WCue;
    let b: WCue;
    if (cue.w[1] > cue.w[0]) {
      const wSplit = Math.max(cue.w[0] + 1, Math.min(cue.w[1], cue.w[0] + Math.round((cue.w[1] - cue.w[0]) * share)));
      a = { ...cue, end: words[wSplit - 1].end, w: [cue.w[0], wSplit - 1], text: text.slice(0, splitAt).trim(), source: srcWords.slice(0, sSplit).join(' ') };
      b = { ...cue, start: words[wSplit].start, w: [wSplit, cue.w[1]], text: text.slice(splitAt).trim(), source: srcWords.slice(sSplit).join(' ') };
    } else {
      // One word of recitation carrying a long ayah: there is no second word to
      // cut on, so the span itself is divided by character share.
      const at = cue.start + dur * share;
      a = { ...cue, end: at, text: text.slice(0, splitAt).trim(), source: srcWords.slice(0, sSplit).join(' ') };
      b = { ...cue, start: at, text: text.slice(splitAt).trim(), source: srcWords.slice(sSplit).join(' ') };
    }
    return [...splitLocked(a), ...splitLocked(b)];
  };
  // Only canonical verses are cut here. Their text is inserted by us, the model
  // never sees it, and a fully recited verse is far longer than one cue can
  // hold. Everything the model wrote keeps the segmentation the model chose:
  // re-cutting it at commas is what produced cues opening "and a sun in broad
  // daylight." — a sentence sliced into boxes rather than a subtitle.
  cues = cues.flatMap((c) => (c.q ? splitLocked(c) : [c]));

  // Repair first, then time. The only display limit a prompt cannot carry on its
  // own is the character count — a model cannot count characters — so cues that
  // came back too long, reading as fragments, ending on a governing word, or
  // missing an honorific are measured here and handed BACK to the model. It
  // answers in word indices, so its pieces are timed by the audio exactly as the
  // originals were. Three rounds, because re-cutting a pair can leave one new
  // piece still reading as a continuation, and each round only looks at what is
  // still wrong.
  //
  // This has to happen BEFORE the timing passes below: a re-cut cue is rebuilt
  // from its word range, which would discard any silence an earlier pass had
  // given it to be readable in.
  // The fast model handles most of these; whatever it could not fix, or whose
  // answer failed validation, goes to the strong one on the last round. Running
  // everything through the strong model was what made this step cost more than
  // the translation it repairs.
  // Nothing re-cuts these. The word ranges the model chose are the timing, and
  // they are final here — readability is handled by reviewCues afterwards, which
  // rewrites wording and never touches a boundary.


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
  return cues.filter((c) => c.end > c.start && c.text.trim()).map(({ w, ...c }) => c);
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
/**
 * Re-cut the cues the model made too big, by asking the model to re-cut them.
 *
 * This is the one display limit a prompt cannot carry on its own: a language
 * model cannot count characters, and measured on a full lecture 12% of its cues
 * came back over 84 characters however plainly the limit was stated. The answer
 * is not to chop them here — cutting text at a comma is exactly what produced
 * "and a sun in broad daylight." — but to divide the labour. Code counts, and
 * hands back the number. The model re-cuts, and because it answers in WORD
 * INDICES the pieces are timed by the audio exactly as the original was; nothing
 * interpolates a timestamp.
 *
 * A reply is only accepted when its pieces tile the original word range exactly:
 * same first word, same last word, contiguous, in order. Anything else is
 * dropped and the cue is left as it was, because a cue that is too long is a
 * lesser fault than one that has lost its place in the audio.
 */
/**
 * Hand back to the model the cues it got wrong, and let it re-cut them.
 *
 * Two faults are found mechanically and repaired the same way.
 *
 * A cue that does not FIT. A language model cannot count characters, and
 * measured on a full lecture 12% of its cues came back over 84 however plainly
 * the limit was stated. Code counts and hands back the number.
 *
 * A cue that does not READ — one opening on a comma or a lowercase continuation
 * of the cue before it, which is a sentence sliced into boxes rather than a
 * subtitle. That one cannot be repaired alone, because the words have to go
 * somewhere: it is re-cut TOGETHER with its neighbour, over their combined word
 * range, so the model can move the boundary or reword both ends.
 *
 * What is never done here is cutting the text ourselves. Chopping at a comma is
 * what produced "and a sun in broad daylight." in the first place. The model
 * answers in WORD INDICES, so the pieces are timed by the audio exactly as the
 * original was and nothing interpolates a timestamp. A reply is accepted only
 * when its pieces tile the original range exactly — same first word, same last
 * word, contiguous, in order. Anything else is discarded and the cues left as
 * they were, a cue that reads poorly being a lesser fault than one that has lost
 * its place in the audio.
 */
/**
 * One pass over the finished cues: code measures, the model rewrites the text.
 *
 * This replaces a repair layer that had grown six detectors, five validation
 * rules and four rounds of re-cutting word ranges. Re-cutting is what made all
 * that necessary — once a pass may move a cue's boundaries it can also break its
 * sync, so every reply had to be proved to tile the original range, fit its own
 * seconds and land on a pause.
 *
 * So this pass does not touch boundaries. A cue's word range, and therefore its
 * timing, is fixed the moment translation returns it. All that can change is the
 * wording, which is the only thing a language model is actually better at than a
 * measurement. Anything it cannot fix stays as it is and shows up in the report.
 */
function cueFlags(text: string, seconds: number, arabic: string): string[] {
  const flat = text.replace(/\n/g, ' ').trim();
  const cps = flat.length / Math.max(0.3, seconds);
  const flags: string[] = [];
  if (cps > 30) flags.push(`CPS ${Math.round(cps)} — MUST fix`);
  else if (cps > 21) flags.push(`CPS ${Math.round(cps)}`);
  // Long on the clock and short on the page is the signature of dropped content.
  if (seconds > 3 && cps < 8) flags.push(`only ${flat.length} characters for ${seconds.toFixed(1)}s of speech — content missing`);
  if (/[,;:]$/.test(flat)) flags.push('ends on a comma');
  for (const [i, line] of text.split('\n').entries()) {
    if (line.trim().length > MAX_LINE) flags.push(`line ${i + 1} is ${line.trim().length} characters`);
  }
  if (text.split('\n').length > 2) flags.push('more than two lines');
  const last = flat.replace(/[.,!?;:"'\u201d\u2019]+$/, '').split(/\s+/).pop()?.toLowerCase() || '';
  if (DANGLERS.has(last)) flags.push(`ends on "${last}"`);
  if (/^[a-z,;:]/.test(flat)) flags.push('opens mid-sentence');
  if (arabic && /صلى الله عليه وسلم|عليه الصلاة والسلام/.test(arabic) && !/ﷺ|peace be upon him/i.test(text)) flags.push('honorific ﷺ dropped');
  if (arabic && /سبحانه وتعالى|تبارك وتعالى|عز وجل|جل جلاله/.test(arabic) && !/ﷻ|Glorified|Exalted|Almighty/i.test(text)) flags.push('honorific ﷻ dropped');
  return flags;
}

const DANGLERS = new Set(['the', 'a', 'an', 'of', 'in', 'and', 'or', 'but', 'with', 'for', 'to',
  'that', 'which', 'who', 'is', 'was', 'are', 'were', 'from', 'by', 'as', 'on', 'at', 'this', 'his',
  'her', 'their', 'its', 'not', 'if', 'when', 'while', 'then', 'into', 'upon']);

export async function reviewCues(
  env: ScribeEnv,
  cues: Cue[],
  targetLang: string
): Promise<{ cues: Cue[]; fixed: number }> {
  const out = [...cues];
  const flagged = out.map((c, i) => ({ i, c, flags: cueFlags(c.text, c.end - c.start, c.source || '') }))
    .filter((x) => x.flags.length && !x.c.q);
  if (!flagged.length) return { cues: out, fixed: 0 };

  let fixed = 0;
  const BATCH = 12;
  const runBatch = async (batch: typeof flagged) => {
    const body = batch.map(({ i, c, flags }) =>
      `Cue ${i} [${(c.end - c.start).toFixed(1)}s]\n  PROBLEM: ${flags.join('; ')}\n  AR: "${(c.source || '').replace(/\n/g, ' ')}"\n  EN: "${c.text.replace(/\n/g, ' | ')}"`
    ).join('\n\n');
    try {
      const raw = await llmChat(env, [
        { role: 'system', content: `You are a subtitle accuracy checker for ${targetLang} subtitles of an Islamic lecture. You receive cues with the problems found in them, and you rewrite the wording only. The timing is fixed and is not yours to change.

WHAT TO DO
- CONTENT MISSING: the Arabic says something the English does not. Put it back. Names, titles, honorific chains, numbers and lists are content.
- CPS over 30: must be fixed. Say the same thing in fewer words.
- CPS 21-30: use judgement; leave it if shortening would lose meaning.
- ENDS ON A COMMA, or OPENS MID-SENTENCE: rewrite so the cue reads as a sentence on its own.
- LINE TOO LONG or MORE THAN TWO LINES: rebreak between l1 and l2, or say it shorter.
- ENDS ON a preposition or conjunction: rephrase so it does not.
- HONORIFIC DROPPED: put ﷺ or ﷻ where the Arabic has it.

RULES
- Never drop words or honorifics (ﷺ ﷻ RA AS RH).
- Keep transliterations: fiqh, Sharia, Tawhid, Sunnah, dhikr, taqwa.
- Each line at most ${MAX_LINE} characters, at most two lines.
- You cannot split a cue or move its boundaries. If the text will not fit the seconds it has, say it in fewer words.

OUTPUT compact JSONL, one line per cue you change:
{"cue":5,"l1":"fixed line one","l2":"line two"}
{"cue":12,"skip":true}
Emit nothing else — no commentary, no code fences.` },
        { role: 'user', content: body },
      ], 8000);
      for (const line of raw.split('\n')) {
        const t = line.trim().replace(/^```(json)?|```$/g, '').trim();
        if (!t.startsWith('{')) continue;
        let f: any;
        try { f = JSON.parse(t); } catch { continue; }
        const idx = Number(f.cue);
        if (!Number.isInteger(idx) || !out[idx] || out[idx].q || f.skip) continue;
        const l1 = typeof f.l1 === 'string' ? f.l1.trim() : '';
        const l2 = typeof f.l2 === 'string' ? f.l2.trim() : '';
        const text = l1 && l2 ? `${l1}\n${l2}` : l1;
        if (!text) continue;
        out[idx] = { ...out[idx], text };
        fixed++;
      }
    } catch (err) {
      console.log('review batch failed (non-fatal):', (err as any)?.message);
    }
  };
  const jobs: (typeof flagged)[] = [];
  for (let k = 0; k < flagged.length; k += BATCH) jobs.push(flagged.slice(k, k + BATCH));
  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    await Promise.all(jobs.slice(i, i + CONCURRENCY).map(runBatch));
  }
  console.log(`review: ${flagged.length} cues flagged, ${fixed} rewritten`);
  return { cues: out, fixed };
}

