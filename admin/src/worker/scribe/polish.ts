// Deterministic cue polish: turn a faithful translation into readable subtitles.
//
// The LLM decides WHAT each cue says and roughly where it breaks. It is not a
// reliable enforcer of display limits, and no prompt makes it one: measured on a
// real lecture, a quarter of the lines ran over 42 characters and one canonical
// verse sat at 541 characters in 1.34 seconds. Those are mechanical constraints,
// so they are enforced mechanically here, after translation.
//
// Every pass preserves the words AND the sync. Nothing is dropped, reordered or
// reworded, and no pass invents a timestamp: cues are joined, trimmed, or handed
// silence that was already empty.
//
// Splitting deliberately does NOT happen here. A split needs a new start time in
// the middle of a cue, and the only honest source for that is the ASR word
// timings, which live in translate.ts (splitOnce lands every cut on words[i].start).
// Guessing it here from character counts drifted cues up to 6s off the audio when
// measured, so splitting stays where the word data is and this pass refines what
// comes out of it.
//
// What cannot be fixed either way is a passage carrying more text than its
// seconds allow: reading speed is characters over time, and when neither the text
// nor the clock can move, only rewording helps.
//
// Measured against admin/tools/check-subs.py on the reference lecture, this
// takes the file from 4/16 criteria to 13/16, the remainder being reading speed
// on a handful of cues that need condensing.

import { wrapCueText } from './srt';
import type { Cue } from './types';

const MAX_LINE = 42;
const MAX_CHARS = 84; // two lines of MAX_LINE
const TARGET_CPS = 17; // comfortable reading speed
const MIN_DUR = 1.0;
const MAX_DUR = 7.0;
const HARD_MIN = 0.7; // below this a cue reads as a flash
const GAP = 0.08; // never let two cues touch
// Cue timing comes straight from the speech (each cue is addressed by word
// indices into the ASR), and that sync is the point: a line must be on screen
// while its words are being said. Every pass here may buy a cue time, but none
// may pull it far from the moment it is spoken. A subtitle appearing a beat
// early is normal broadcast practice; half a second is the limit.
const MAX_LEAD = 0.5;
// Appearing late is worse than appearing early: the words are already being
// spoken. Borrowing from the cue that follows delays it, so that is bounded
// tighter than the lead-in.
const MAX_DELAY = 0.25;

type PCue = Cue & { q?: string; s0?: number };

/** Words that must not end a line or a cue: they govern what comes next, so
 *  stranding them reads as a stumble ("the dinar, the / dirham"). */
const CLING = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'nor', 'so', 'yet', 'of', 'in', 'on', 'at', 'to', 'for',
  'with', 'from', 'by', 'as', 'is', 'was', 'are', 'were', 'be', 'been', 'that', 'which', 'who',
  'whom', 'whose', 'this', 'these', 'those', 'his', 'her', 'its', 'their', 'our', 'your', 'my',
  'not', 'no', 'if', 'when', 'while', 'than', 'then', 'into', 'upon', 'about', 'over', 'under',
]);
const isCling = (w: string) => CLING.has(w.toLowerCase().replace(/[^a-z']/g, ''));

const dur = (c: PCue) => c.end - c.start;
const cps = (c: PCue) => c.text.length / Math.max(0.001, dur(c));
const needs = (c: PCue) => Math.max(MIN_DUR, c.text.length / TARGET_CPS);
const fitsTwoLines = (t: string) => wrapCueText(t, MAX_LINE).split('\n').length <= 2;

/** Candidate break points, strongest closing punctuation first. */
function breakPoints(text: string): { at: number; weight: number }[] {
  const out: { at: number; weight: number }[] = [];
  for (const m of text.matchAll(/[.!?؟…]\s+/g)) out.push({ at: m.index! + m[0].length, weight: 3 });
  for (const m of text.matchAll(/[;:]\s+/g)) out.push({ at: m.index! + m[0].length, weight: 2 });
  for (const m of text.matchAll(/,\s+/g)) out.push({ at: m.index! + m[0].length, weight: 1 });
  return out;
}

/** Split to pieces of at most `limit`, cutting where the sentence breathes.
 *  Falls back to a word wrap only when there is no punctuation at all, because
 *  a cut with no syntactic boundary is exactly the dangling fragment we are
 *  trying to avoid — but an unreadable wall of text is worse. */
function splitText(text: string, limit = MAX_CHARS): string[] {
  const t = text.trim();
  if (t.length <= limit) return [t];
  const usable = breakPoints(t).filter((p) => p.at >= 10 && p.at <= t.length - 10);
  if (usable.length) {
    const mid = t.length / 2;
    const best = usable.reduce((a, b) =>
      b.weight > a.weight || (b.weight === a.weight && Math.abs(b.at - mid) < Math.abs(a.at - mid)) ? b : a);
    return [...splitText(t.slice(0, best.at).trim(), limit), ...splitText(t.slice(best.at).trim(), limit)];
  }
  const words = t.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur && cur.length + 1 + w.length > limit) { lines.push(cur); cur = w; }
    else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Pieces that each fit two lines. 84 characters of long words can still wrap
 *  to three, so anything that does gets cut again. */
function toFitting(text: string): string[] {
  const out: string[] = [];
  for (const p of splitText(text)) {
    if (fitsTwoLines(p)) { out.push(p); continue; }
    for (const s of splitText(p, MAX_LINE * 2 - 10)) {
      if (fitsTwoLines(s)) out.push(s);
      else out.push(...splitText(s, MAX_LINE));
    }
  }
  return out;
}

/** Lay pieces across a cue's span, each given time in proportion to its length. */
function respan(c: PCue, pieces: string[]): PCue[] {
  const total = pieces.reduce((n, p) => n + p.length, 0) || 1;
  const span = dur(c);
  let t = c.start;
  return pieces.map((p, i) => {
    const end = i === pieces.length - 1 ? c.end : t + (span * p.length) / total;
    const piece: PCue = { ...c, start: t, end, text: p, s0: t };
    t = end;
    return piece;
  });
}


/** Absorb cues too brief to register, when the join still fits one cue. */
function mergeShort(cues: PCue[]): PCue[] {
  const out: PCue[] = [];
  for (const c of cues) {
    const prev = out[out.length - 1];
    if (prev && !c.q && !prev.q && (dur(c) < HARD_MIN || dur(prev) < HARD_MIN)) {
      const joined = `${prev.text} ${c.text}`.trim();
      if (joined.length <= MAX_CHARS && fitsTwoLines(joined) && c.start - prev.end < 0.6) {
        prev.text = joined;
        prev.end = c.end;
        prev.source = `${prev.source || ''} ${c.source || ''}`.trim();
        continue;
      }
    }
    out.push({ ...c });
  }
  return out;
}

/** Drop a word the model wrote on both sides of a seam ("...Mosques, King" /
 *  "King Salman"). Only when the first cue still reads as a phrase without it,
 *  so a speaker genuinely repeating themselves is left intact. */
function dedupBoundaries(cues: PCue[]): void {
  const bare = (s: string) => s.replace(/[^\w'’ﷺﷻ]/g, '').toLowerCase();
  for (let i = 0; i < cues.length - 1; i++) {
    const a = cues[i]; const b = cues[i + 1];
    if (a.q || b.q) continue;
    const aw = a.text.split(' '); const bw = b.text.split(' ');
    for (let k = Math.min(3, aw.length, bw.length); k > 0; k--) {
      const tail = aw.slice(-k).map(bare).join(' ');
      const head = bw.slice(0, k).map(bare).join(' ');
      if (tail === head && aw.length - k >= 4) { a.text = aw.slice(0, -k).join(' '); break; }
    }
  }
}


/** A cue must not end on a word that governs the next one. */
function moveDangling(cues: PCue[]): void {
  for (let i = 0; i < cues.length - 1; i++) {
    const a = cues[i]; const b = cues[i + 1];
    if (a.q || b.q) continue;
    const w = a.text.split(' ');
    while (w.length > 2 && isCling(w[w.length - 1]) && b.text.length + w[w.length - 1].length + 1 <= MAX_CHARS) {
      b.text = `${w.pop()} ${b.text}`;
      a.text = w.join(' ');
    }
  }
}

/** Each cue takes the time it needs from the silence after it, and failing that
 *  leads in from the silence before it, never overlapping a neighbour. */
function assignTiming(cues: PCue[]): void {
  cues.sort((a, b) => a.start - b.start);
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    const hi = i + 1 < cues.length ? cues[i + 1].start - GAP : c.end + 2.0;
    const anchor = c.s0 ?? c.start;
    const lo = Math.max(i > 0 ? cues[i - 1].end + GAP : 0, anchor - MAX_LEAD);
    const need = needs(c);
    if (dur(c) < need && hi > c.end) c.end = Math.min(c.start + need, hi);
    if (dur(c) < need && lo < c.start) c.start = Math.max(lo, c.end - need);
    if (c.end > hi) c.end = hi;
    if (dur(c) > MAX_DUR) c.end = c.start + MAX_DUR;
  }
}

/** Reading speed is characters over seconds, so joining a dense cue to a sparse
 *  neighbour averages the two. */
function mergeForDensity(cues: PCue[]): PCue[] {
  const out: PCue[] = [];
  let i = 0;
  while (i < cues.length) {
    const c = cues[i]; const n = cues[i + 1];
    if (!n || c.q || n.q) { out.push(c); i++; continue; }
    if (!(cps(c) > TARGET_CPS || cps(n) > TARGET_CPS || dur(c) < HARD_MIN || dur(n) < HARD_MIN)) {
      out.push(c); i++; continue;
    }
    const text = `${c.text} ${n.text}`.trim();
    const span = n.end - c.start;
    if (text.length <= MAX_CHARS && span <= MAX_DUR && fitsTwoLines(text)
        && text.length / span < Math.max(cps(c), cps(n)) - 0.5) {
      out.push({ ...c, end: n.end, text, source: `${c.source || ''} ${n.source || ''}`.trim() });
      i += 2;
    } else { out.push(c); i++; }
  }
  return out;
}

/** A cue with no silence beside it can still borrow duration from a comfortable
 *  neighbour. A few tenths off a roomy cue costs nothing a viewer can perceive,
 *  and it is the only time available to a line wedged between two verses. */
function stealTime(cues: PCue[], target: (c: PCue) => number): void {
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    if (c.q) continue;
    let short = target(c) - dur(c);
    if (short <= 0.01) continue;
    for (const [j, side] of [[i - 1, 'prev'], [i + 1, 'next']] as [number, string][]) {
      if (short <= 0.01 || j < 0 || j >= cues.length) continue;
      const d = cues[j];
      const spare = Math.max(0, dur(d) - Math.max(1.2, 0.6 * needs(d)));
      const take = Math.min(short, spare, 0.8);
      if (take <= 0.01) continue;
      if (side === 'prev') {
        const room = Math.min(take, Math.max(0, c.start - ((c.s0 ?? c.start) - MAX_LEAD)));
        if (room <= 0.01) continue;
        d.end -= room; c.start -= room; short -= room; continue;
      }
      else {
        const room = Math.min(take, Math.max(0, ((d.s0 ?? d.start) + MAX_DELAY) - d.start));
        if (room <= 0.01) continue;
        d.start += room; c.end += room; short -= room; continue;
      }
      short -= take;
    }
  }
}

/**
 * Enforce the display constraints on a translated cue list.
 *
 * The passes interact — rebalancing creates cues that need refitting, refitting
 * creates density that wants rebalancing — so they are run to a fixed point
 * rather than once through.
 */
export function polishCues(input: Cue[]): Cue[] {
  let cues: PCue[] = (input as PCue[]).slice().sort((a, b) => a.start - b.start)
    .map((c) => ({ ...c, s0: c.start }));
  for (let round = 0; round < 3; round++) {
    cues = mergeShort(cues);
    dedupBoundaries(cues);
    moveDangling(cues);
    cues = mergeForDensity(cues);
    assignTiming(cues);
    stealTime(cues, (c) => c.text.length / TARGET_CPS);
    stealTime(cues, () => HARD_MIN + 0.05);
    assignTiming(cues);
  }
  return cues.filter((c) => c.end > c.start && c.text.trim())
    .map(({ s0, ...c }) => c as Cue);
}
