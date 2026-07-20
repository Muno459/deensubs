// The AUDIOBOOK pipeline — fully separate from the video subtitle path.
//
// Audio-only jobs produce a karaoke transcript, not subtitles: prose phrases
// meant for READING alongside audio in the Apple-Podcasts-style player. So
// there is no CPS, no 2x42 line cap, no display-duration rules — and the
// word-index spans are KEPT in the serialized cues, because they ARE the
// product: every English unit maps to the span of timed Arabic words that
// activates it.
//
// Shares only the low-level machinery with translate.ts (word cleaning,
// windowing, the LLM client, Quran verse locking); prompts, QA and output
// shape are its own. translate.ts (video) is never touched by this file.

import type { Cue, ScribeEnv, Word } from './types';
import { cleanWords, makeWindows, llmChat, type CleanWord } from './translate';
import { findQuranQuotes, citeQuote } from './quran';

export type AudioCue = Cue & { w: [number, number] };

const CONCURRENCY = 16;
const STRONG_MODEL = 'ag/claude-sonnet-4-6';
const QA_MODEL = 'ag/claude-opus-4-6-thinking';

const SYSTEM_PROMPT = (targetLang: string) => `You are an expert translator producing a READING transcript of an Islamic audio lecture for a karaoke-style player. You receive numbered words from speech recognition and answer with translation units.

OUTPUT FORMAT — one JSON object per line, nothing else:
{"w":[FIRST_WORD_INDEX,LAST_WORD_INDEX],"t":"translation of those words"}

RULES:
- Cover EVERY word index exactly once, in order, with no gaps and no overlaps.
- Each unit is a natural prose phrase or clause of roughly 4-16 source words — segment at sentence and clause boundaries, pauses (marked [GAP]) and speaker changes (marked [SPEAKER]). The reader follows these units as they light up with the audio.
- Write flowing, book-quality ${targetLang} prose with full punctuation. Units read as continuous text when concatenated.
- Translate ALL meaningful content faithfully — never paraphrase away or condense meaning.
- Clean speech artifacts: drop stutters, false starts, and filler sounds (their word indices still belong to the unit covering that span).
- Islamic honorifics: Allah ﷻ, the Prophet Muhammad ﷺ, companions (RA), earlier prophets (AS), scholars (RH).
- Keep as transliterations (do not translate): fatwa, mufti, Sharia, fiqh, usul al-fiqh, ifta, Haramain, madhhab, and similar established terms.
- Quranic verses: use established translation wording, wrapped in quotes.
- No markdown, no commentary, no code fences — only JSONL lines.`;

// No timestamps in the prompt: unit timing comes from the word spans on our
// side, and GAP markers carry the segmentation signal — the numbers were
// pure token weight.
function windowPrompt(win: CleanWord[], prevTail: string): string {
  const lines: string[] = [];
  if (prevTail) lines.push(`Previous unit for context (already translated, do NOT repeat): ${prevTail}`, '');
  lines.push('Words:');
  let lastSpeaker = win[0]?.speaker || '';
  for (let k = 0; k < win.length; k++) {
    const w = win[k];
    if (k > 0 && w.start - win[k - 1].end >= 0.4) lines.push('[GAP]');
    if (w.speaker !== lastSpeaker && w.speaker) {
      lines.push(`[SPEAKER ${w.speaker}]`);
      lastSpeaker = w.speaker;
    }
    lines.push(`${w.i} ${w.text}`);
  }
  return lines.join('\n');
}

function parseUnits(raw: string, win: CleanWord[]): { w: [number, number]; t: string }[] {
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

function holes(units: { w: [number, number] }[], lo: number, hi: number): [number, number][] {
  const sorted = [...units].sort((a, b) => a.w[0] - b.w[0]);
  const out: [number, number][] = [];
  let cur = lo;
  for (const u of sorted) {
    if (u.w[0] > cur) out.push([cur, u.w[0] - 1]);
    cur = Math.max(cur, u.w[1] + 1);
  }
  if (cur <= hi) out.push([cur, hi]);
  return out;
}

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
  let units: { w: [number, number]; t: string }[] = [];
  for (const model of [undefined, undefined, STRONG_MODEL]) {
    try {
      units = parseUnits(await llmChat(env, messages, 8000, model), win);
      if (units.length) break;
    } catch {}
  }
  if (!units.length) throw new Error(`audiobook window ${lo}-${hi} failed on all models`);

  // Hole-filling: translate skipped spans instead of losing content
  for (let round = 0; round < 2; round++) {
    const gaps = holes(units, lo, hi).filter(([a, b]) => b - a + 1 >= 3);
    if (!gaps.length) break;
    for (const [a, b] of gaps) {
      const sub = win.filter((w) => w.i >= a && w.i <= b);
      if (!sub.length) continue;
      try {
        const more = parseUnits(
          await llmChat(env, [
            { role: 'system', content: SYSTEM_PROMPT(targetLang) },
            { role: 'user', content: windowPrompt(sub, units[units.length - 1]?.t || prevTail) },
          ], 4000),
          sub
        );
        units.push(...more);
      } catch {}
    }
  }
  // tiny leftovers attach to the neighboring unit; bigger unfilled spans
  // become visible Arabic-source units rather than silently inflating a
  // neighbor's time span
  for (const [a, b] of holes(units, lo, hi)) {
    if (b - a + 1 <= 2) {
      let best: { w: [number, number]; t: string } | null = null;
      for (const u of units) {
        if (u.w[1] === a - 1) best = u;
      }
      if (best) best.w[1] = b;
      else {
        const after = units.find((u) => u.w[0] === b + 1);
        if (after) after.w[0] = a;
      }
    } else {
      const ar = win.filter((w) => w.i >= a && w.i <= b).map((w) => w.text).join(' ');
      units.push({ w: [a, b], t: ar });
    }
  }
  return units.sort((x, y) => x.w[0] - y.w[0]);
}

/** Audiobook translation: words → ordered prose units with word spans kept. */
export async function translateWordsAudiobook(env: ScribeEnv, allWords: Word[], targetLang: string): Promise<AudioCue[]> {
  const words = cleanWords(allWords);
  if (!words.length) throw new Error('No speech words found in ASR result');

  // Quran verse locking, identical to the video path: canonical wording,
  // never improvised by the LLM.
  let quotes: Awaited<ReturnType<typeof findQuranQuotes>> = [];
  try { quotes = await findQuranQuotes(env, words); } catch {}
  const locked: AudioCue[] = [];
  for (const qt of quotes) {
    const cite = citeQuote(qt.verses);
    qt.verses.forEach((v, vi) => {
      const first = words[v.wStart];
      const last = words[v.wEnd];
      if (!first || !last) return;
      locked.push({
        start: first.start,
        end: Math.max(last.end, first.start + 0.6),
        text: `“${v.en}”` + (vi === qt.verses.length - 1 ? ` (Quran ${cite})` : ''),
        source: v.ar,
        w: [v.wStart, v.wEnd],
        q: v.key,
      } as AudioCue);
    });
  }

  const lockedSpans = quotes.map((q) => [q.wStart, q.wEnd] as [number, number]).sort((a, b) => a[0] - b[0]);
  const free: [number, number][] = [];
  let cursor = 0;
  for (const [a, b] of lockedSpans) {
    if (a > cursor) free.push([cursor, a - 1]);
    cursor = Math.max(cursor, b + 1);
  }
  if (cursor < words.length) free.push([cursor, words.length - 1]);
  const windows = free.flatMap(([a, b]) => makeWindows(words.slice(a, b + 1)));

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
    settled.forEach((units, j) => (results[i + j] = units));
  }

  let cues: AudioCue[] = [];
  for (const units of results) {
    for (const u of units) {
      const first = words[u.w[0]];
      const last = words[u.w[1]];
      if (!first || !last) continue;
      cues.push({
        start: first.start,
        end: Math.max(last.end, first.start + 0.3),
        text: u.t,
        source: words.slice(u.w[0], u.w[1] + 1).map((w) => w.text).join(' '),
        w: [u.w[0], u.w[1]],
      });
    }
  }
  cues.push(...locked);
  cues.sort((a, b) => a.w[0] - b.w[0]);

  // Karaoke granularity: split only ABSURDLY long units at sentence marks
  // (word-proportional). No display-duration or reading-speed rules here —
  // the transcript is read at the listener's pace, not flashed.
  const split = (cue: AudioCue): AudioCue[] => {
    if ((cue as any).q) return [cue];
    const span = cue.w[1] - cue.w[0] + 1;
    const dur = (words[cue.w[1]]?.end ?? 0) - (words[cue.w[0]]?.start ?? 0);
    if (span <= 14 && dur <= 9) return [cue];
    if (span < 6) return [cue];
    const text = cue.text;
    const marks = [...text.matchAll(/[.!?؟…,;:]\s+/g)].map((m) => m.index! + m[0].length);
    if (!marks.length) return [cue];
    const mid = text.length / 2;
    const at = marks.reduce((p, c) => (Math.abs(c - mid) < Math.abs(p - mid) ? c : p));
    if (at < 12 || text.length - at < 12) return [cue];
    const share = at / text.length;
    const wSplit = Math.max(cue.w[0] + 1, Math.min(cue.w[1], cue.w[0] + Math.round(span * share)));
    const a: AudioCue = {
      ...cue, end: words[wSplit - 1].end, w: [cue.w[0], wSplit - 1],
      text: text.slice(0, at).trim(),
      source: words.slice(cue.w[0], wSplit).map((w) => w.text).join(' '),
    };
    const b: AudioCue = {
      ...cue, start: words[wSplit].start, w: [wSplit, cue.w[1]],
      text: text.slice(at).trim(),
      source: words.slice(wSplit, cue.w[1] + 1).map((w) => w.text).join(' '),
    };
    return [...split(a), ...split(b)];
  };
  cues = cues.flatMap(split);
  return cues.filter((c) => c.text.trim() && c.w[1] >= c.w[0]);
}

/** Targeted QA for audiobook prose: only suspicious units go to the strong
 * model (there is no CPS or line-length in audio — those are display rules). */
export async function qaPassAudiobook(env: ScribeEnv, cues: AudioCue[], targetLang: string): Promise<{ cues: AudioCue[]; fixes: number }> {
  const out = [...cues];
  const flagged = new Set<number>();
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if ((c as any).q) continue;
    if (/[؀-ۿ]/.test(c.text)) flagged.add(i); // Arabic leakage
    if (i > 0 && c.text === out[i - 1].text) flagged.add(i); // repetition
    if (c.source && /الله/.test(c.source) && !/allah/i.test(c.text)) flagged.add(i);
  }
  // Cross-lingual embedding screen: low similarity = likely mistranslation
  try {
    const ai = (env as any).AI;
    const cand = out.map((c, i) => ({ c, i }))
      .filter(({ c, i }) => !(c as any).q && !flagged.has(i) && c.source && c.source.length >= 8 && c.text.length >= 8);
    for (let i = 0; i < cand.length; i += 45) {
      const batch = cand.slice(i, i + 45);
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
  } catch {}
  const review = new Set<number>();
  for (const i of flagged) {
    for (const n of [i - 1, i, i + 1]) {
      if (n >= 0 && n < out.length && !(out[n] as any).q) review.add(n);
    }
  }
  const idxs = [...review].sort((a, b) => a - b);
  let fixes = 0;
  const BATCH = 40;
  for (let i = 0; i < idxs.length; i += BATCH) {
    const batch = idxs.slice(i, i + BATCH);
    const lines = batch.map((idx) => `${idx}\nSRC: ${out[idx].source}\nTRN: ${out[idx].text}`).join('\n\n');
    try {
      const raw = await llmChat(env, [
        { role: 'system', content: `You are a literary reviewer for an Islamic audiobook transcript (${targetLang}). Review source↔translation pairs and output ONLY JSONL fixes for units that need them (mistranslation, dropped meaning, awkward prose, honorific mistakes):
{"i": unitNumber, "t": "corrected translation"}
Rules: flowing book-quality prose with full punctuation, keep honorifics (Allah ﷻ, Prophet ﷺ, RA/AS/RH), keep transliterations (fiqh, Sharia...), Quran quotes in established translation wording. If a unit is fine, output nothing for it. No commentary.` },
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
  }
  return { cues: out, fixes };
}

/** The karaoke document: one shared timed word array, English units as index
 * spans into it, paragraph + chapter grouping. Compact array form. */
export function buildTranscript(allWords: Word[], cues: AudioCue[], chaptersJson?: string | null): any {
  const words = cleanWords(allWords);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const unitArr: [string, number, number][] = [];
  const paragraphs: [number, number][] = [];
  const ordered = [...cues].sort((a, b) => a.w[0] - b.w[0]);
  let pStart = 0;
  for (let i = 0; i < ordered.length; i++) {
    const c = ordered[i];
    unitArr.push([c.text, c.w[0], c.w[1]]);
    const next = ordered[i + 1];
    const gap = next ? words[next.w[0]].start - words[c.w[1]].end : 99;
    const sentenceEnd = /[.!?؟”)]$/.test(c.text.trim());
    const paraLen = i - pStart + 1;
    if (!next || (gap >= 1.2 && sentenceEnd) || paraLen >= 14) {
      paragraphs.push([pStart, i]);
      pStart = i + 1;
    }
  }
  let chapters: [number, string][] = [];
  try {
    const ch = JSON.parse(chaptersJson || '[]');
    chapters = (Array.isArray(ch) ? ch : []).map((c: any) => [Math.round(c.start ?? c.t ?? 0), String(c.title || '')]);
  } catch {}
  return {
    v: 1,
    words: words.map((w) => [w.text, r2(w.start), r2(w.end)]),
    units: unitArr,
    paragraphs,
    chapters,
  };
}
