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
import { cleanWords, makeWindows, llmChat, windowAudio, type AudioOpts, type CleanWord } from './translate';
import { findQuranQuotes, citeQuote } from './quran';

export type AudioCue = Cue & { w: [number, number] };

const CONCURRENCY = 16;
// One model everywhere, per the operator's standing instruction — and it is
// also the fast one: the claude fallbacks made QA the longest step of a job.
const STRONG_MODEL = 'ag/gemini-3.6-flash-tiered';
const QA_MODEL = 'ag/gemini-3.6-flash-tiered';

const SYSTEM_PROMPT = (targetLang: string) => `You are an expert translator producing a READING transcript of an Islamic audio lecture for a karaoke-style player. You receive numbered words from speech recognition and answer with translation units.

OUTPUT FORMAT — one JSON object per line, nothing else:
{"w":[FIRST_WORD_INDEX,LAST_WORD_INDEX],"a":"FIRST_ARABIC_WORD","z":"LAST_ARABIC_WORD","t":"translation of those words"}

RULES:
- "a" and "z" must EXACTLY copy the Arabic word at FIRST_WORD_INDEX and LAST_WORD_INDEX — they verify your numbers.
- Cover EVERY word index exactly once, in order, with no gaps and no overlaps.
- Each unit is a natural prose phrase or clause of roughly 4-16 source words — segment at sentence and clause boundaries, pauses (marked [GAP]) and speaker changes (marked [SPEAKER]). The reader follows these units as they light up with the audio.
- Write flowing, book-quality ${targetLang} prose with full punctuation. Units read as continuous text when concatenated.
- Readers follow the audio word by word, so keep the Arabic clause order whenever natural ${targetLang} allows ("Thus says the Imam..." for a verb-first Arabic sentence) — but never sacrifice fluent, correct prose for it.
- Translate ALL meaningful content faithfully — never paraphrase away or condense meaning.
- Clean speech artifacts: drop stutters, false starts, and filler sounds (their word indices still belong to the unit covering that span).
- Islamic honorifics: Allah ﷻ, the Prophet Muhammad ﷺ, companions (RA), earlier prophets (AS), scholars (RH).
- Keep as transliterations (do not translate): fatwa, mufti, Sharia, fiqh, usul al-fiqh, ifta, Haramain, madhhab, and similar established terms.
- Quranic verses and hadith quotations: use established translation wording, wrapped in quotes and *italicized* with single asterisks.
- Italicize ONLY Quranic verses, hadith, and book titles; never ordinary reported speech or names.
- Never use em-dashes or en-dashes; write with commas, colons, semicolons, or parentheses instead.
- Nested quotations use single quotes inside double quotes — never two double quotes in a row.
- **Bold** (double asterisks) sparingly for a key term being defined or emphasized by the speaker.
- No other markdown, no commentary, no code fences — only JSONL lines.`;

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
      // Echo verification: the model copies the Arabic word at each boundary
      // ("a"/"z"). If the copy doesn't match the claimed index but DOES match
      // a word within ±4, the number was off — snap to where the word is.
      // (Measured: echo output had 0/31 misattributed spans vs 3.2% without.)
      const at = (j: number) => win[j - lo]?.text;
      const echoFix = (idx: number, echo: any): number => {
        if (typeof echo !== 'string' || !echo.trim()) return idx;
        const e = echo.trim();
        if (at(idx) === e) return idx;
        for (let off = 1; off <= 4; off++) {
          if (at(idx - off) === e) return idx - off;
          if (at(idx + off) === e) return idx + off;
        }
        return idx;
      };
      a = echoFix(a, obj.a);
      b = Math.max(a, echoFix(b, obj.z));
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

/** Appended to the system prompt ONLY when the window's audio is attached. */
const AUDIO_NOTE_AB =
  '\n- You are ALSO given the actual audio of this passage (it begins at the first listed word). LISTEN to it: let what you hear — pauses, breath, cadence, recitation vs commentary, speaker changes — decide unit boundaries together with the [GAP]/[SPEAKER] markers, and let tone and emphasis inform your wording. The numbered words remain the authoritative transcript.';

async function translateWindow(
  env: ScribeEnv,
  targetLang: string,
  win: CleanWord[],
  prevTail: string,
  audio?: any | null
): Promise<{ w: [number, number]; t: string }[]> {
  const lo = win[0].i;
  const hi = win[win.length - 1].i;
  const userText = windowPrompt(win, prevTail);
  let units: { w: [number, number]; t: string }[] = [];
  // Audio rides only on the primary (Gemini) attempts; the strong fallback
  // sends the plain text-only request.
  for (const model of [undefined, undefined, STRONG_MODEL]) {
    const withAudio = !!audio && model === undefined;
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT(targetLang) + (withAudio ? AUDIO_NOTE_AB : '') },
      { role: 'user', content: withAudio ? [{ type: 'text', text: userText }, audio] : userText },
    ];
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
export async function translateWordsAudiobook(env: ScribeEnv, allWords: Word[], targetLang: string, audioOpts?: AudioOpts): Promise<AudioCue[]> {
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
      batch.map(async (win, j) => {
        const prev = windows[i + j - 1];
        const prevTail = prev ? prev.slice(-12).map((w) => w.text).join(' ') : '';
        const audio = audioOpts
          ? await windowAudio(env, audioOpts, win[0].start, win[win.length - 1].end)
          : null;
        return translateWindow(env, targetLang, win, prevTail, audio);
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

/** ElevenLabs' native exports riding on the transcript response: the raw txt
 * (verbatim, their formatting) and their source-language segmentation. */
export function elevenFormats(asr: any): { txt?: string; segments?: { start: number; end: number }[] } {
  const out: { txt?: string; segments?: { start: number; end: number }[] } = {};
  for (const f of asr?.additional_formats || []) {
    let content: string | undefined = f?.content;
    if (content && f?.is_base64_encoded) {
      try {
        content = new TextDecoder().decode(Uint8Array.from(atob(content), (ch) => ch.charCodeAt(0)));
      } catch { content = undefined; }
    }
    if (!content) continue;
    if (f.requested_format === 'txt') out.txt = content;
    if (f.requested_format === 'segmented_json') {
      try {
        const j = JSON.parse(content);
        const raw = Array.isArray(j) ? j : j.segments || j.transcription_segments || [];
        // Segment times live in the per-segment word list, not at segment level
        const segs = raw
          .map((s: any) => {
            const ws = (s.words || []).filter((w: any) => isFinite(w?.start) && isFinite(w?.end));
            const start = Number(s.start ?? s.start_time ?? ws[0]?.start);
            const end = Number(s.end ?? s.end_time ?? ws[ws.length - 1]?.end);
            return { start, end };
          })
          .filter((s: any) => isFinite(s.start) && isFinite(s.end) && s.end > s.start);
        if (segs.length) out.segments = segs;
      } catch {}
    }
  }
  return out;
}

/** The karaoke document: one shared timed word array, English units as index
 * spans into it, paragraph + chapter grouping. Compact array form. When
 * ElevenLabs' native segments are provided they ARE the paragraph structure
 * (source-language, silence-based); the punctuation heuristic only serves
 * legacy jobs transcribed before exports were requested. */
export function buildTranscript(allWords: Word[], cues: AudioCue[], chaptersJson?: string | null,
  nativeSegments?: { start: number; end: number }[] | null): any {
  const words = cleanWords(allWords);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  // Character-timestamp warp: on long words (madd elongations, stretched
  // syllables) the sub-word fill should follow articulation, not linear
  // time. Stored per word as [q25,q50,q75] — percent of the duration at
  // which a quarter/half/three-quarters of the letters are complete — and
  // only where that differs meaningfully from linear.
  const curveOf = (w: CleanWord): [number, number, number] | null => {
    const ch = w.chars;
    const dur = w.end - w.start;
    if (!ch || ch.length < 4 || dur < 0.5) return null;
    const q = (f: number) => {
      const idx = Math.min(ch.length - 1, Math.max(0, Math.ceil(f * ch.length) - 1));
      return Math.round(Math.max(0, Math.min(1, (ch[idx].end - w.start) / dur)) * 100);
    };
    let a = q(0.25), b = q(0.5), c = q(0.75);
    b = Math.max(a, b); c = Math.max(b, c);
    if (Math.abs(a - 25) < 8 && Math.abs(b - 50) < 8 && Math.abs(c - 75) < 8) return null;
    return [a, b, c];
  };
  // LLM quote hygiene: collapse runs of double-quote glyphs (a citation
  // nested directly inside a spoken quotation) into one, preferring curly
  const dedupeQuotes = (s: string) =>
    s.replace(/["“”]{2,}/g, (m) => (m.includes('”') ? '”' : m.includes('“') ? '“' : '"'));
  const unitArr: [string, number, number][] = [];
  let paragraphs: [number, number][] = [];
  const ordered = [...cues].sort((a, b) => a.w[0] - b.w[0]);

  // Anchor snap: transliterated names exist in BOTH texts, so they can
  // verify unit boundaries. When a unit's opening name sits 1–3 Arabic
  // words BEFORE its span (LLM off-by-a-few attribution — measured on a
  // real book at ~11% of verifiable names), pull the boundary back and
  // shrink the neighbour. Conservative: max 3 words, never emptying a unit.
  const AR_MAP: Record<string, string> = Object.fromEntries(
    [...'اأإآبتثجحخدذرزسشصضطظعغفقكلمنهويىةءئؤ'].map((ch, i) =>
      [ch, ['a','a','a','a','b','t','t','j','h','k','d','d','r','z','s','s','s','d','t','z','','g','f','q','k','l','m','n','h','w','y','a','h','','',''][i]])
  );
  const skel = (t: string) => {
    let x = (t || '').toLowerCase().replace(/[\u064b-\u0652\u0670\u0640]/g, '');
    x = x.replace(/^\u0627\u0644/, '').replace(/^al[-'\u2019]?/, '');
    let o = '';
    for (const ch of x) o += AR_MAP[ch] !== undefined ? AR_MAP[ch] : ch;
    return o.replace(/[^a-z]/g, '').replace(/[aeiouwhy]/g, '');
  };
  const wsk = words.map((w) => skel(w.text));
  const skMatch = (es: string, k: number) => {
    const a = wsk[k];
    return a.length >= 2 && (a === es || (es.length > 2 && a.length > 2 && (a.includes(es) || es.includes(a))));
  };
  for (let ui = 0; ui < ordered.length; ui++) {
    const u = ordered[ui];
    const firstTok = (u.text || '').split(/\s+/).map(skel).find((x) => x.length >= 3);
    if (!firstTok) continue;
    if (skMatch(firstTok, u.w[0])) continue; // already right where it should be
    for (let off = 1; off <= 3; off++) {
      const k = u.w[0] - off;
      if (k < 0 || !skMatch(firstTok, k)) continue;
      const prev = ordered[ui - 1];
      if (prev) {
        if (k - 1 < prev.w[0]) break; // would empty the neighbour
        if (prev.w[1] >= k) prev.w[1] = k - 1;
      }
      u.w[0] = k;
      break;
    }
  }

  for (const c of ordered) unitArr.push([dedupeQuotes(c.text), c.w[0], c.w[1]]);

  // ---- Diarized speaker turns (computed FIRST: speaker changes are hard
  // block boundaries for the paragraph builder). Single-word flicker folds
  // back into its surroundings. ----
  const spk = words.map((w) => w.speaker || '');
  for (let k = 1; k < spk.length - 1; k++) {
    if (spk[k] !== spk[k - 1] && spk[k - 1] === spk[k + 1]) spk[k] = spk[k - 1];
  }
  const speakerIds = [...new Set(spk.filter(Boolean))];
  const turns: [number, number, number][] = [];
  if (speakerIds.length > 1) {
    let t0 = 0;
    for (let k = 1; k <= spk.length; k++) {
      if (k === spk.length || spk[k] !== spk[t0]) {
        turns.push([t0, k - 1, speakerIds.indexOf(spk[t0])]);
        t0 = k;
      }
    }
  }

  // ---- Paragraph blocks, production reading rhythm ----
  // Sentence integrity is absolute: a block only breaks after a unit that
  // ends a sentence and never before a lowercase continuation — except at
  // speaker changes, which always break. Within that, boundaries prefer
  // real pauses and ElevenLabs' acoustic segment edges, and blocks aim for
  // a 14–55 s rhythm with tiny fragments merged away.
  const turnOfWord = (w: number) => {
    if (!turns.length) return -1;
    let lo = 0, hi = turns.length - 1, ans = 0;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (turns[m][0] <= w) { ans = m; lo = m + 1; } else hi = m - 1; }
    return turns[ans][2];
  };
  const edges: number[] = (nativeSegments || []).map((g) => g.end).sort((a, b) => a - b);
  const nearNative = (t: number) => {
    let lo = 0, hi = edges.length - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (edges[m] < t) lo = m + 1; else hi = m - 1; }
    const c1 = edges[lo], c0 = edges[lo - 1];
    return (c1 !== undefined && Math.abs(c1 - t) <= 0.7) || (c0 !== undefined && Math.abs(c0 - t) <= 0.7);
  };
  const uStart = (k: number) => words[ordered[k].w[0]].start;
  const uEnd = (k: number) => words[ordered[k].w[1]].end;
  const endsSentence = (k: number) => /[.!?؟…"”)'\]]\s*$/.test((unitArr[k][0] || '').trim());
  const lowerNext = (k: number) =>
    k + 1 < ordered.length && /^[a-z]/.test((unitArr[k + 1][0] || '').trim().replace(/^[*"'“‘(\[]+/, ''));
  const gapAfter = (k: number) => (k + 1 < ordered.length ? Math.max(0, uStart(k + 1) - uEnd(k)) : 99);

  let s0 = 0, lastCand = -1, i = 0;
  while (i < ordered.length) {
    const last = i === ordered.length - 1;
    const turnBreak = !last && turnOfWord(ordered[i + 1].w[0]) !== turnOfWord(ordered[i].w[0]);
    const dur = uEnd(i) - uStart(s0);
    const cand = endsSentence(i) && !lowerNext(i);
    const strong = cand && (gapAfter(i) >= 0.55 || nearNative(uEnd(i)));
    if (last || turnBreak || (dur >= 14 && strong) || (dur >= 30 && cand)) {
      paragraphs.push([s0, i]); s0 = i + 1; lastCand = -1; i++;
      continue;
    }
    if (dur >= 55 && lastCand >= s0) { // run-on: rewind to the last sentence end
      paragraphs.push([s0, lastCand]); s0 = lastCand + 1; i = s0; lastCand = -1;
      continue;
    }
    if (dur >= 75) { paragraphs.push([s0, i]); s0 = i + 1; lastCand = -1; i++; continue; }
    if (cand) lastCand = i;
    i++;
  }
  // Tiny fragments read as noise: merge blocks under ~5 s into the previous
  // block, but never across a speaker change.
  const mergedP: [number, number][] = [];
  for (const p of paragraphs) {
    const prev = mergedP[mergedP.length - 1];
    const dur = uEnd(p[1]) - uStart(p[0]);
    const sameTurn = prev && turnOfWord(ordered[p[0]].w[0]) === turnOfWord(ordered[prev[1]].w[1]);
    if (prev && sameTurn && dur < 5) prev[1] = p[1];
    else mergedP.push([p[0], p[1]]);
  }
  paragraphs = mergedP;
  let chapters: [number, string][] = [];
  try {
    const ch = JSON.parse(chaptersJson || '[]');
    chapters = (Array.isArray(ch) ? ch : []).map((c: any) => [Math.round(c.start ?? c.t ?? 0), String(c.title || '')]);
  } catch {}

  return {
    v: 1,
    words: words.map((w) => {
      const cv = curveOf(w);
      return cv ? [w.text, r2(w.start), r2(w.end), cv] : [w.text, r2(w.start), r2(w.end)];
    }),
    units: unitArr,
    paragraphs,
    chapters,
    ...(turns.length ? { turns } : {}),
  };
}

/** LLM display labels for diarized voices, judged from each voice's own
 * (translated) words. Real names only when evident; otherwise honest role
 * labels. Generic "Speaker N" answers are rejected and retried once on the
 * strong model; the caller persists accepted names forever. */
export async function nameSpeakers(
  env: ScribeEnv,
  doc: any,
  context: { title?: string | null; channel?: string | null; scholar?: string | null }
): Promise<string[]> {
  const turns: [number, number, number][] = doc.turns || [];
  const n = 1 + Math.max(...turns.map((t) => t[2]));
  const fallback = Array.from({ length: n }, (_, i) => `Speaker ${i + 1}`);
  const turnOf = (w: number) => {
    let lo = 0, hi = turns.length - 1, ans = 0;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (turns[m][0] <= w) { ans = m; lo = m + 1; } else hi = m - 1; }
    return turns[ans][2];
  };
  const samples: string[][] = Array.from({ length: n }, () => []);
  for (const u of doc.units as [string, number, number][]) {
    const sIdx = turnOf(u[1]);
    if (samples[sIdx].join(' ').length < 1400) samples[sIdx].push(u[0].replace(/\*+/g, ''));
  }
  const body = samples
    .map((sa, i) => `VOICE ${i} says:\n${sa.slice(0, 8).map((t) => `- ${t}`).join('\n')}`)
    .join('\n\n');
  const messages = [
    {
      role: 'system',
      content:
        'You label the voices in an Islamic audio recording for its transcript. For each voice give a short English display label based on WHAT IT SAYS: use a real name or title ONLY if the quoted words make it evident (introduced or addressed by name); otherwise an honest descriptive role such as "Sheikh (main speaker)", "Reciter", "Questioner", "Student", "Host", "Announcer". NEVER answer with generic labels like "Speaker 1", "Voice 2", "Person A", or bare numbers — a role description is always possible. Reply with ONLY a JSON object: {"names": ["label for voice 0", ...]} — one label per voice, in order.',
    },
    {
      role: 'user',
      content: `Recording: ${context.title || 'untitled'}${context.channel ? ` — ${context.channel}` : ''}${context.scholar ? `\nFeatured scholar: ${context.scholar} — if one voice is evidently the main lecturer or commentator, label that voice with exactly this name.` : ''}\n\n${body}`,
    },
  ];
  const generic = (x: string) => /^\s*(speaker|voice|person)\b/i.test(x) || /^\s*\d+\s*$/.test(x);
  for (const model of [undefined, STRONG_MODEL]) {
    try {
      const raw = await llmChat(env, messages, 400, model);
      const m = raw.match(/\{[\s\S]*\}/);
      const names = m ? JSON.parse(m[0]).names : null;
      if (Array.isArray(names) && names.length === n
          && names.every((x: any) => typeof x === 'string' && x.trim() && !generic(x))) {
        return names.map((x: string) => x.trim().slice(0, 60));
      }
    } catch {}
  }
  return fallback;
}

/** ElevenLabs-style speaker transcript txt:
 *   HH:MM:SS,mmm --> HH:MM:SS,mmm [Label]
 *   turn text
 * `kind` picks the source words or the translated units as the text. */
export function buildSpeakerTxt(doc: any, kind: 'source' | 'translated'): string {
  const st = (s: number) => {
    const ms = Math.max(0, Math.round(s * 1000));
    const pad = (v: number, w = 2) => String(v).padStart(w, '0');
    return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
  };
  const words: [string, number, number][] = doc.words;
  const units: [string, number, number][] = doc.units;
  const turns: [number, number, number][] =
    doc.turns || (doc.paragraphs || []).map(([p0, p1]: [number, number]) => [units[p0][1], units[p1][2], 0]);
  const label = (s: number) => doc.speakers?.[s] || `Speaker ${s}`;
  const textFor = (w0: number, w1: number) =>
    kind === 'source'
      ? words.slice(w0, w1 + 1).map((w) => w[0]).join(' ')
      : units
          .filter((u) => u[1] >= w0 && u[1] <= w1)
          .map((u) => u[0].replace(/\*+/g, ''))
          .join(' ');
  const blocks: string[] = [];
  for (const [w0, w1, s] of turns) {
    const text = textFor(w0, w1).trim();
    if (!text) continue;
    blocks.push(`${st(words[w0][1])} --> ${st(words[w1][2])} [${label(s)}]\n${text}\n`);
  }
  return blocks.join('\n');
}

/* ── word alignment ───────────────────────────────────────────────────
   The karaoke cursor interpolates between anchors; transliteration only
   pins names, leaving whole units anchorless (proportional guessing put
   the cursor at "and" while the reciter said "companions"). One cheap
   LLM pass aligns content words per unit; the pairs ship in
   transcript.json and drive both the cursor and word tap-to-seek. */
export async function alignUnits(env: ScribeEnv, doc: any): Promise<number[][]> {
  const words: [string, number, number][] = doc.words || [];
  const units: [string, number, number][] = doc.units || [];
  // Complete word map, not sparse anchors: every Arabic word carries the
  // English words the reader finishes as it is spoken. Concatenating the
  // English fields must reproduce the translation exactly, so a shifted or
  // hallucinated map fails structurally instead of shipping. Stored per unit
  // as cumulative lit-through counts — the cursor jumps group by group and
  // interpolation (which smeared multi-word merges and VSO inversions) is
  // gone entirely.
  const SYS =
    'You map a translated transcript onto its Arabic source for a karaoke reader. For each unit you receive the Arabic words and the English translation. Reply in JSONL, one line per unit:\n' +
    '{"u":UNIT_ID,"m":[["ARABIC_WORD","english words"],...]}\n' +
    'Rules:\n' +
    '- "m" lists EVERY Arabic word of the unit, in order, each copied EXACTLY.\n' +
    '- Attach to each Arabic word the English words a reader should finish as that word is spoken. Concatenating all English fields MUST reproduce the English text exactly — same words, same order, nothing added or dropped. Use "" for an Arabic word that adds no new English words (e.g. merged honorifics).\n' +
    '- When word order differs between the languages, attach the displaced English words to the Arabic word at whose position the READER passes them (keep English order; never reorder English).\n' +
    '- A token that OPENS a quotation (like «"May») belongs to the first Arabic word INSIDE the quote, never to the word that introduces the quote.\n' +
    '- Inside Quranic quotes or any passage where word-by-word correspondence is unclear, distribute the English words roughly evenly across the Arabic words — the reader must advance steadily, never receive a long run on one word.\n' +
    'Every line MUST start with {"u". No commentary, no code fences.';
  // Tokenization contract shared with the player's splitEn: whitespace split
  // with asterisks stripped, then a further split AFTER em/en-dashes; the
  // translation glues words ("Zayd\u2014who") and the highlight can never be
  // finer than the tokens.
  const enWords = (i: number) => {
    const out: string[] = [];
    for (const rough of units[i][0].replace(/\*+/g, '').split(/\s+/)) {
      if (!rough) continue;
      let acc = '';
      for (const part of rough.split(/([\u2014\u2013])/)) {
        if (part === '\u2014' || part === '\u2013') { acc += part; out.push(acc); acc = ''; }
        else acc += part;
      }
      if (acc) out.push(acc);
    }
    return out;
  };
  const normAr = (w: string) =>
    (w || '').replace(/[\u064b-\u0652\u0670\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[^\u0600-\u06ff]/g, '');
  const normEn = (w: string) => (w || '').toLowerCase().replace(/[^a-z0-9']/g, '');
  const out: number[][] = units.map(() => []);
  const accept = (i: number, m: any): boolean => {
    const [, w0, w1] = units[i];
    const span = w1 - w0 + 1;
    if (!Array.isArray(m) || m.length !== span) return false;
    const flat: string[] = [];
    const flatG: number[] = [];
    for (let j = 0; j < span; j++) {
      const pair = m[j];
      if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || typeof pair[1] !== 'string') return false;
      if (normAr(pair[0]) !== normAr(words[w0 + j][0])) return false;
      for (const t of pair[1].split(/\s+/)) if (t) { flat.push(t); flatG.push(j); }
    }
    // Two-pointer walk instead of naive equality: the model may split tokens
    // the player keeps joined ("Allah\u2014abundant") or vice versa. Reference
    // tokenization (the player's whitespace split) always wins; each reference
    // token lands in the group of the model token that completes it.
    const ref = enWords(i);
    const rn = ref.map(normEn);
    const mn = flat.map(normEn);
    const endG: number[] = [];
    let ri = 0, mi = 0;
    while (ri < rn.length) {
      if (!rn[ri]) { endG[ri] = mi < flatG.length ? flatG[mi] : span - 1; ri++; continue; }
      while (mi < mn.length && !mn[mi]) mi++;
      if (mi >= mn.length) return false;
      if (rn[ri] === mn[mi]) { endG[ri] = flatG[mi]; ri++; mi++; continue; }
      if (rn[ri].startsWith(mn[mi])) {
        let acc = mn[mi], g = flatG[mi]; mi++;
        while (mi < mn.length && acc.length < rn[ri].length) { acc += mn[mi]; g = flatG[mi]; mi++; }
        if (acc !== rn[ri]) return false;
        endG[ri] = g; ri++; continue;
      }
      if (mn[mi].startsWith(rn[ri])) {
        let acc = rn[ri]; const g = flatG[mi];
        endG[ri] = g; ri++;
        while (ri < rn.length && acc.length < mn[mi].length) { acc += rn[ri]; endG[ri] = g; ri++; }
        if (acc !== mn[mi]) return false;
        mi++; continue;
      }
      return false;
    }
    while (mi < mn.length && !mn[mi]) mi++;
    if (mi !== mn.length) return false;
    const cum: number[] = [];
    for (let j = 0, c = 0; j < span; j++) {
      while (c < endG.length && endG[c] <= j) c++;
      cum.push(c);
    }
    out[i] = cum;
    return true;
  };
  const ask = async (ids: number[], model?: string) => {
    const lines = ids.map((i) => {
      const [, w0, w1] = units[i];
      const ar: string[] = [];
      for (let k = w0; k <= w1 && k < words.length; k++) ar.push(words[k][0]);
      return `UNIT ${i}\nAR: ${ar.join(' ')}\nEN: ${enWords(i).join(' ')}`;
    });
    const raw = await llmChat(env, [
      { role: 'system', content: SYS },
      { role: 'user', content: lines.join('\n\n') },
    ], 8000, model);
    const got = new Set<number>();
    for (const line of raw.split('\n')) {
      const mm = line.match(/\{.*\}/);
      if (!mm) continue;
      let o: any;
      try { o = JSON.parse(mm[0]); } catch { continue; }
      if (Number.isInteger(o.u) && ids.includes(o.u) && !got.has(o.u) && accept(o.u, o.m)) got.add(o.u);
    }
    return got;
  };
  const BATCH = 8;
  const ranges: number[][] = [];
  for (let lo = 0; lo < units.length; lo += BATCH) ranges.push(Array.from({ length: Math.min(BATCH, units.length - lo) }, (_, j) => lo + j));
  for (let g = 0; g < ranges.length; g += 6) {
    await Promise.all(ranges.slice(g, g + 6).map((ids) => ask(ids).catch(() => new Set())));
  }
  // rejected units retry solo, then once more on the strong model
  for (const model of [undefined, STRONG_MODEL]) {
    const failed = units.map((_, i) => i).filter((i) => !out[i].length && units[i][2] > units[i][1]);
    for (let g = 0; g < failed.length; g += 6) {
      await Promise.all(failed.slice(g, g + 6).map((i) => ask([i], model).catch(() => new Set())));
    }
  }
  // Deterministic repair: an Arabic word with an unambiguous transliterated
  // twin (names, loanwords) must own the English word — nudge group
  // boundaries up to 3 words so it does. Exact-skeleton or long-substring
  // matches only; the looser audit matcher false-flags too much to act on.
  // Each word contributes BOTH skeleton forms, article-stripped and raw:
  // stripping the leading al- blindly turned the divine name into a 1-char
  // skeleton, invisible to this pass in every prior rebuild.
  const SKMAP: Record<string, string> = { 'ا':'a','أ':'a','إ':'a','آ':'a','ب':'b','ت':'t','ث':'t','ج':'j','ح':'h','خ':'k','د':'d','ذ':'d','ر':'r','ز':'z','س':'s','ش':'s','ص':'s','ض':'d','ط':'t','ظ':'z','ع':'','غ':'g','ف':'f','ق':'q','ك':'k','ل':'l','م':'m','ن':'n','ه':'h','و':'w','ي':'y','ى':'a','ة':'h','ء':'','ئ':'','ؤ':'' };
  const sks = (t: string): string[] => {
    const base = (x: string) => {
      let o = '';
      for (const ch of x) o += SKMAP[ch] !== undefined ? SKMAP[ch] : ch;
      return o.replace(/[^a-z]/g, '').replace(/[aeiouwhy]/g, '');
    };
    const low = (t || '').toLowerCase().replace(/[\u064b-\u0652\u0670\u0640]/g, '');
    const forms = new Set<string>([base(low)]);
    const st = low.replace(/^ال/, '').replace(/^al[-'\u2019]?/, '');
    if (st !== low) forms.add(base(st));
    return [...forms].filter(Boolean);
  };
  const skMatch = (A: string[], E: string[], cap: boolean): boolean => {
    for (const a of A) for (const e of E) {
      if (a === e && (a.length >= 3 || (a.length === 2 && cap))) return true;
      if (a.length >= 4 && e.length >= 4 && (a.includes(e) || e.includes(a))) return true;
    }
    return false;
  };
  // Smoothing, two passes. (1) A giant group flanked by empty ones spreads
  // across the run. (2) Canonical Quran translations run 4-7x wordier than
  // the recited Arabic and the surplus piles up at unit edges — 20-word
  // walls at 20+ words/sec. In those wordy units (EN/AR >= 2.5) the curve
  // is clamped to within ±4 words of steady time-proportional reading; the
  // reader sweeps the quote at the reciter's pace. Prose units and their
  // name anchors are untouched (and the twin repair re-pins names after).
  for (let i = 0; i < units.length; i++) {
    const cum = out[i];
    if (cum.length < 2) continue;
    const size = (j: number) => cum[j] - (j ? cum[j - 1] : 0);
    for (let j = 0; j < cum.length; j++) {
      if (size(j) < 6) continue;
      let a = j, b = j;
      while (a > 0 && size(a - 1) === 0) a--;
      while (b + 1 < cum.length && size(b + 1) === 0) b++;
      if (a === b) continue;
      const lo = a ? cum[a - 1] : 0, hi = cum[b], n = b - a + 1;
      for (let m = 0; m < n - 1; m++) cum[a + m] = lo + Math.round(((m + 1) * (hi - lo)) / n);
    }
    const [, w0, w1] = units[i];
    const enLen = cum[cum.length - 1];
    if (enLen / cum.length >= 2.5) {
      const t0 = words[w0][1], t1 = Math.max(t0 + 0.1, words[w1][2]);
      for (let j = 0; j < cum.length - 1; j++) {
        const ideal = (enLen * (words[w0 + j][2] - t0)) / (t1 - t0);
        cum[j] = Math.max(Math.ceil(ideal) - 4, Math.min(Math.floor(ideal) + 4, cum[j]));
        if (j && cum[j] < cum[j - 1]) cum[j] = cum[j - 1];
        cum[j] = Math.max(0, Math.min(enLen, cum[j]));
      }
    }
  }
  for (let i = 0; i < units.length; i++) {
    const cum = out[i];
    if (!cum.length) continue;
    const [, w0, w1] = units[i];
    const span = w1 - w0 + 1;
    const parts = enWords(i);
    const esk = parts.map(sks);
    const used = new Set<number>();
    for (let k = 0; k < span; k++) {
      const aF = sks(words[w0 + k][0]);
      if (!aF.some((x) => x.length >= 2)) continue;
      // 2-consonant skeletons (Allah -> ll) are allowed only against
      // capitalized English words: the proper-noun signal rules out
      // collisions like "all" without any hardcoded vocabulary
      // 2-consonant matches (divine name = ll) only against capitalized
      // English words: the proper-noun signal rules out collisions like
      // "all" without any hardcoded vocabulary
      const cands = esk
        .map((eF, j) => ({ eF, j }))
        .filter(({ eF, j }) => !used.has(j) && skMatch(aF, eF, k > 0 && j > 0 && /^[A-Z]/.test(parts[j])));
      if (cands.length !== 1) continue;
      const j = cands[0].j;
      used.add(j);
      const lo = k ? cum[k - 1] : 0;
      if (lo <= j && j < cum[k]) continue;
      if (j >= cum[k] && j + 1 - cum[k] <= 3) {
        for (let m = k; m < span && cum[m] < j + 1; m++) cum[m] = j + 1;
      } else if (j < lo && lo - j <= 3) {
        for (let m = k - 1; m >= 0 && cum[m] > j; m--) cum[m] = j;
      }
    }
  }
  return out;
}
