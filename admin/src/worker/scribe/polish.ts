// Deterministic cue polish: turn a faithful translation into readable subtitles.
//
// The LLM decides WHAT each cue says and roughly where it breaks. It is not a
// reliable enforcer of display limits, and no prompt makes it one: measured on a
// real lecture, a quarter of the lines ran over 42 characters and one canonical
// verse sat at 541 characters in 1.34 seconds. Those are mechanical constraints,
// so they are enforced mechanically here, after translation.
//
// TIMING IS NOT ONE OF THOSE CONSTRAINTS. Cue times come from ASR word indices,
// which is the only reason they line up with the speaker's mouth, and this pass
// holds two invariants over them:
//
//   1. A cue starts on the word it belongs to. Its start is words[w0].start and
//      nothing here moves it, not to buy reading time, not to lead in.
//   2. A cue never gives up the span where its words are spoken. It ends no
//      earlier than words[w1].end.
//
// Extra screen time therefore comes from ONE place: silence that was already
// empty between this cue's last word and the next cue's first. That is the whole
// budget. There is no borrowing from a neighbour.
//
// An earlier version broke both. It leaned a start up to half a second early to
// win reading time and let a 7-second display cap truncate a 9.6-second span of
// speech. On the reference lecture that left 44% of cues off their word boundary
// (worst 2.27s) and 33 seconds of the talk with the speaker audible and nothing
// on screen — while passing all sixteen acceptance criteria, none of which
// looked at sync. check-subs.py now measures both directly.
//
// Where a cue must be cut here (a verse too long to display, residue the word-
// accurate splitter in translate.ts could not break), the cut is proposed by
// character share and then MOVED ONTO A REAL WORD START, so every piece still
// begins on something the speaker says. Which word is an approximation; that it
// is a word is not.
//
// What cannot be fixed either way is a passage carrying more text than its
// seconds allow: reading speed is characters over time, and when the text cannot
// move and the clock must not, only rewording helps. That is condenseDense.

import { wrapCueText } from './srt';
import type { Cue } from './types';

const MAX_LINE = 42;
const MAX_CHARS = 84; // two lines of MAX_LINE
const TARGET_CPS = 17; // comfortable reading speed
const MIN_DUR = 1.0;
// A display convention, not a fact about the audio: it caps how long a cue may
// linger in SILENCE. It never shortens the stretch where the words are spoken.
const MAX_DUR = 7.0;
const HARD_MIN = 0.7; // below this a cue reads as a flash
const GAP = 0.08; // never let two cues touch, unless the speech is continuous
// How far past its recitation a verse may spread into following silence. A
// canonical translation cannot be shortened, so when only part of the verse was
// recited, time is the only thing that can give.
const VERSE_GRAB = 12.0;

/** `s0`/`e0` are the speech span: where this cue's words start and stop being
 *  spoken. `w` is the word-index range they came from, kept so a later pass can
 *  still cut on a real word. */
type Word = { start: number; end: number };
type PCue = Cue & { q?: string; s0?: number; e0?: number; w?: [number, number] };

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
const speechEnd = (c: PCue) => Math.max(c.e0 ?? c.end, c.start + 0.001);

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

/**
 * Lay pieces across a cue's span.
 *
 * Each cut is proposed where the character share falls, then moved onto the
 * nearest word start inside the cue. That word is where the piece begins to be
 * spoken, so the piece gets a real anchor instead of a number derived from how
 * long the English happens to be. Without word data the proportional time is
 * used as-is — approximate, and the reason `words` is threaded in from both
 * callers rather than left optional in practice.
 */
function respan(c: PCue, pieces: string[], words?: Word[]): PCue[] {
  if (pieces.length <= 1) return [{ ...c, text: pieces[0] ?? c.text }];
  const total = pieces.reduce((n, p) => n + p.length, 0) || 1;
  const span = dur(c);
  const proposed: number[] = [];
  let acc = 0;
  for (let i = 0; i < pieces.length - 1; i++) {
    acc += pieces[i].length;
    proposed.push(c.start + (span * acc) / total);
  }

  // Move each cut onto a real word start, keeping them ordered and leaving at
  // least one word for every piece that still has to be placed.
  //
  // A partly recited verse still carries the WHOLE canonical translation, so
  // there are routinely more pieces than there are words to hang them on. When
  // that happens the words run out partway through: everything up to that point
  // still gets a real anchor, and only the tail — text the speaker never said,
  // which therefore has no word to start on — is placed proportionally. Giving
  // up on the whole cue the moment one cut had nowhere to go was what left five
  // pieces of verse 65:2 floating off their words.
  const cut: (number | null)[] = new Array(pieces.length - 1).fill(null);
  if (words && c.w) {
    let after = c.w[0];
    for (let i = 0; i < cut.length; i++) {
      const last = c.w[1] - (cut.length - 1 - i);
      let best = -1;
      let bestD = Infinity;
      for (let k = after + 1; k <= last; k++) {
        const d = Math.abs(words[k].start - proposed[i]);
        if (d < bestD) { bestD = d; best = k; }
      }
      if (best < 0) break; // out of words; the rest fall back
      cut[i] = best;
      after = best;
    }
  }

  // Piece boundaries as times, forced to increase so nothing inverts.
  const bound: number[] = [c.start];
  for (let i = 0; i < cut.length; i++) {
    const k = cut[i];
    const t = k != null && words ? words[k].start : proposed[i];
    bound.push(Math.max(t, bound[i] + 0.05));
  }

  const last = pieces.length - 1;
  return pieces.map((p, i) => {
    const start = bound[i];
    const spoken = i === last
      ? speechEnd(c)
      : (cut[i] != null && words ? words[cut[i]! - 1].end : bound[i + 1]);
    const end = i === last ? Math.max(c.end, spoken) : bound[i + 1];
    const w0 = i === 0 ? c.w?.[0] : cut[i - 1] ?? undefined;
    const w1 = i === last ? c.w?.[1] : (cut[i] != null ? cut[i]! - 1 : undefined);
    return {
      ...c, start, end: Math.max(end, start + 0.001), text: p, s0: start,
      e0: Math.max(Math.min(spoken, end), start + 0.001),
      w: w0 != null && w1 != null && w1 >= w0 ? [w0, w1] as [number, number] : undefined,
    };
  });
}

/** Is this line simply part of the verse, worded slightly differently? Used to
 *  tell the translator's own rendering of a recited verse apart from speech the
 *  speaker made in the middle of reciting it. */
function partOf(text: string, canonical: string): boolean {
  const words = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
  const w = words(text);
  if (!w.length) return true;
  const inCanon = new Set(words(canonical));
  return w.filter((x) => inCanon.has(x)).length / w.length >= 0.6;
}

/** One presentation per recitation, laid out legibly.
 *
 *  Fuzzy matching emits the same verse two or three times over a few seconds and
 *  every match carries the FULL canonical translation, so the verse gets shown
 *  repeatedly, each copy crammed into a fraction of the recitation. Cluster all
 *  cues of a verse that sit near each other, take the longest text (that is the
 *  complete canonical wording), and spread it across the whole window.
 *
 *  The canonical English does not map word-for-word onto the Arabic being
 *  recited, so the guarantee for a verse is that it is on screen while it is
 *  recited. Its internal cuts still land on word starts like everything else. */
/** The full wording a run of verse cues carries between them.
 *
 *  Two things land in the same run and they need opposite treatment. Fuzzy
 *  matching emits the SAME verse two or three times, each carrying the whole
 *  canonical translation, and those must collapse to one. But translate.ts also
 *  splits a long verse into halves, and those are complementary: "And remember
 *  Him, as He has guided you, for indeed," followed by "you were before that
 *  among those astray." Taking the longest text (which is what this did) kept
 *  the second and deleted the first, truncating scripture and leaving the words
 *  of the discarded half with nothing on screen.
 *
 *  So a cue joins the assembled text unless it is already represented in it. */
function assembleVerse(run: PCue[]): string {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const parts: string[] = [];
  for (const c of run) {
    const n = norm(c.text);
    if (!n) continue;
    const at = parts.findIndex((p) => {
      const q = norm(p);
      return q.includes(n) || n.includes(q);
    });
    if (at >= 0) { if (c.text.length > parts[at].length) parts[at] = c.text; }
    else parts.push(c.text);
  }
  return parts.join(' ').trim();
}

function rebuildVerses(cues: PCue[], words?: Word[]): PCue[] {
  const groups = new Map<string, PCue[]>();
  for (const c of cues) if (c.q) (groups.get(c.q) ?? groups.set(c.q, []).get(c.q)!).push(c);

  const blocks: PCue[] = [];
  // The whole recitation window and everything it says, kept before the block is
  // cut into displayable pieces. A duplicate has to be judged against the entire
  // verse: tested against the pieces instead, a restatement of the opening words
  // matches the piece it does not sit inside and misses the one it does.
  const windows: { start: number; end: number; text: string }[] = [];
  for (const [q, items] of groups) {
    items.sort((a, b) => a.start - b.start);
    let run: PCue[] = [items[0]];
    const flush = () => {
      const start = Math.min(...run.map((c) => c.start));
      const end = Math.max(...run.map((c) => speechEnd(c)));
      const full = assembleVerse(run);
      const cite = run.map((c) => c.text).join(' ').match(/\(Quran [^)]+\)/);
      const text = cite && !full.includes(cite[0]) ? `${full} ${cite[0]}` : full;
      const spans = run.map((c) => c.w).filter(Boolean) as [number, number][];
      const w = spans.length
        ? [Math.min(...spans.map((s) => s[0])), Math.max(...spans.map((s) => s[1]))] as [number, number]
        : undefined;
      // A verse recited in part still carries its whole canonical translation,
      // so the recitation window is routinely far too short to read it in: verse
      // 18:28 came out as pieces of a tenth of a second. Spread the block across
      // the silence that follows as well, up to what it needs and never into the
      // next cue. `e0` stays at the recitation, so this only ever claims time
      // nobody was speaking.
      const after = cues.reduce(
        (min, x) => (x.start > end + 0.01 && !run.includes(x) ? Math.min(min, x.start) : min),
        Infinity);
      const room = Math.min(
        Number.isFinite(after) ? after - GAP : end + VERSE_GRAB,
        start + text.length / TARGET_CPS,
        end + VERSE_GRAB);
      const block: PCue = { ...run[0], start, end: Math.max(end, room), text, q, s0: start, e0: end, w };
      windows.push({ start, end, text });
      blocks.push(...respan(block, toFitting(text), words));
    };
    for (const c of items.slice(1)) {
      // Only join matches that are genuinely one recitation. A wide window
      // swallows whatever the speaker said between two recitations of the same
      // verse, which both loses that speech and squeezes its neighbours.
      const gap = c.start - run[run.length - 1].end;
      const canon = assembleVerse(run);
      const between = cues.filter((x) => !x.q
        && x.start >= run[run.length - 1].end - 0.01 && x.end <= c.start + 0.01);
      const allVerse = between.every((x) => partOf(x.text, canon));
      // Two matches of the same verse seconds apart are one recitation, whatever
      // sits between them: at that range it is the model's own partial rendering
      // of the words being recited, not something the speaker stopped to say.
      // Further apart, the containment test has to prove it before they join.
      if (gap <= 4 || (gap <= 14 && allVerse)) run.push(c);
      else { flush(); run = [c]; }
    }
    flush();
  }

  // A free cue inside a verse window is only the verse mis-attributed to the
  // free-text translator when it actually says the verse. Real speech that
  // happens to fall in the window is kept.
  //
  // Only the START has to fall inside the block. Requiring the whole cue to be
  // contained let a duplicate through whenever it ran a moment past the end of
  // the recitation: it then began on the very word the verse begins on, and two
  // cues cannot share a start, so one of them collapsed to a 1ms flash.
  const kept = cues.filter((c) => !c.q && !windows.some((b) =>
    b.start - 0.01 <= c.start && c.start < b.end - 0.01 && partOf(c.text, b.text)));
  return [...kept, ...blocks].sort((a, b) => a.start - b.start);
}

/** Split whatever still breaks the display limits. translate.ts does the bulk of
 *  the splitting on word timings; this catches the residue it could not cut. */
function splitOversize(cues: PCue[], words?: Word[]): PCue[] {
  const out: PCue[] = [];
  for (const c of cues) {
    if (c.q || (c.text.length <= MAX_CHARS && fitsTwoLines(c.text)) || dur(c) < 2 * HARD_MIN) {
      out.push(c);
      continue;
    }
    const pieces = toFitting(c.text);
    out.push(...(pieces.length === 1 ? [c] : respan(c, pieces, words)));
  }
  return out;
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
        prev.e0 = Math.max(speechEnd(prev), speechEnd(c));
        if (prev.w && c.w) prev.w = [prev.w[0], c.w[1]];
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

/** A cue must not end on a word that governs the next one.
 *
 *  Moving it across the seam has to leave the next cue reading as a sentence.
 *  Pushing "is" onto a cue that already has its own verb produces "is Taqwa is
 *  mentioned", which is worse than the stranded word it was meant to fix, so a
 *  word that already sits at the head of the target is left where it is. */
function moveDangling(cues: PCue[]): void {
  for (let i = 0; i < cues.length - 1; i++) {
    const a = cues[i]; const b = cues[i + 1];
    if (a.q || b.q) continue;
    const w = a.text.split(' ');
    const bare = (s: string) => s.toLowerCase().replace(/[^a-z']/g, '');
    while (w.length > 2 && isCling(w[w.length - 1]) && b.text.length + w[w.length - 1].length + 1 <= MAX_CHARS) {
      const word = w[w.length - 1];
      if (b.text.split(' ').slice(0, 3).some((x) => bare(x) === bare(word))) break;
      b.text = `${w.pop()} ${b.text}`;
      a.text = w.join(' ');
    }
  }
}

/**
 * Place every cue on the clock.
 *
 * Starts are not negotiable — each cue returns to the word it belongs to, every
 * round, so no earlier pass can leave one drifted. Ends cover the speech first
 * and then take whatever silence runs up to the next cue. When the speech itself
 * runs right up to the next cue the two are allowed to touch rather than losing
 * the tail of a word to the gap.
 */
function assignTiming(cues: PCue[]): void {
  cues.sort((a, b) => (a.s0 ?? a.start) - (b.s0 ?? b.start));
  for (const c of cues) c.start = c.s0 ?? c.start;
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    const spoken = speechEnd(c);
    const next = i + 1 < cues.length ? cues[i + 1].start : Infinity;
    // Cover the speech, then extend into silence for readability; MAX_DUR trims
    // only that extension, never the speech.
    const want = Math.max(spoken, Math.min(c.start + needs(c), c.start + MAX_DUR));
    // A visible gap before the next cue, given up only where the speech itself
    // runs into it — losing the tail of a spoken word is the worse trade.
    const ceiling = Number.isFinite(next) ? next : spoken + 2.0;
    const preferred = Number.isFinite(next) ? Math.max(next - GAP, spoken) : ceiling;
    c.end = Math.max(c.start + 0.001, Math.min(want, preferred, ceiling));
  }
}

/** Two cues cannot begin on the same word, and starts are not ours to move, so
 *  one of them has no time to occupy. Rather than let it render as a flash, its
 *  words are handed to the cue that can actually be read — or dropped when it is
 *  only the model's own restatement of the verse it collided with. */
function absorbUnshowable(cues: PCue[]): PCue[] {
  const out: PCue[] = [];
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    const n = cues[i + 1];
    const collides = !!n && !c.q && dur(c) < 0.2 && n.start - c.start < 0.05;
    if (collides && n!.q) {
      if (partOf(c.text, n!.text)) continue; // duplicate of the verse
    } else if (collides) {
      n!.text = `${c.text} ${n!.text}`.trim();
      n!.s0 = c.s0 ?? c.start;
      n!.start = n!.s0;
      n!.e0 = Math.max(speechEnd(c), speechEnd(n!));
      n!.source = `${c.source || ''} ${n!.source || ''}`.trim();
      if (c.w && n!.w) n!.w = [c.w[0], n!.w[1]];
      continue;
    }
    out.push(c);
  }
  return out;
}

/** Reading speed is characters over seconds, so joining a dense cue to a sparse
 *  neighbour averages the two. The join keeps the first cue's start and the
 *  second's speech end, so it costs no sync. */
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
      out.push({
        ...c, end: n.end, text,
        e0: Math.max(speechEnd(c), speechEnd(n)),
        w: c.w && n.w ? [c.w[0], n.w[1]] as [number, number] : undefined,
        source: `${c.source || ''} ${n.source || ''}`.trim(),
      });
      i += 2;
    } else { out.push(c); i++; }
  }
  return out;
}

/**
 * Enforce the display constraints on a translated cue list.
 *
 * The passes interact — a merge creates text that needs refitting, refitting
 * creates cues that want merging — so they run to a fixed point rather than once
 * through. `words` is the ASR word list the cues were built from; pass it so
 * cuts land on word starts.
 */
export function polishCues(input: Cue[], words?: Word[]): Cue[] {
  let cues: PCue[] = (input as PCue[]).slice().sort((a, b) => a.start - b.start)
    .map((c) => ({ ...c, s0: c.start, e0: c.end }));
  cues = rebuildVerses(cues, words);
  for (let round = 0; round < 3; round++) {
    cues = splitOversize(cues, words);
    cues = mergeShort(cues);
    dedupBoundaries(cues);
    moveDangling(cues);
    cues = mergeForDensity(cues);
    assignTiming(cues);
    cues = absorbUnshowable(cues);
    assignTiming(cues);
  }
  return cues.filter((c) => c.end > c.start && c.text.trim())
    .map(({ s0, e0, ...c }) => c as Cue);
}
