// Quran quote detection + canonical restoration.
//
// The worst failure mode for this platform is misrendering the Quran: ASR
// transcribes recitation phonetically (imperfectly), then an LLM improvises
// a translation of the mangled transcription. Instead, the transcript is
// fuzzy-matched against the full Quran; matched spans become LOCKED cues
// carrying the exact Uthmani text and the Saheeh International translation
// with a citation. The LLM never touches them.
//
// Corpus: R2 quran/corpus.json — [{k:"2:255", ar:uthmani, m:matching-text, en}]
// (built from api.quran.com uthmani + uthmani_simple + translation 20).

import type { ScribeEnv } from './types';
import type { CleanWord } from './translate';

type Verse = { k: string; ar: string; m: string; en: string };
export type QuoteVerse = { key: string; ar: string; en: string; wStart: number; wEnd: number };
export type QuranQuote = { wStart: number; wEnd: number; matched: number; verses: QuoteVerse[] };

const DIACRITICS = /[ً-ٰٟـۖ-ۭ]/g;

/** Normalize Arabic for matching: strip diacritics, unify hamza/alef/yaa/taa forms. */
export function normAr(w: string): string {
  return w
    .replace(DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ء/g, '')
    .replace(/[^ء-ي]/g, '');
}

type Index = { toks: string[]; vmap: number[]; verses: Verse[]; tri: Map<string, number[]> };
let cachedIndex: Index | null = null;

async function loadIndex(env: ScribeEnv): Promise<Index> {
  if (cachedIndex) return cachedIndex;
  const obj = await env.MEDIA_BUCKET.get('quran/corpus.json');
  if (!obj) throw new Error('quran corpus missing from R2 (quran/corpus.json)');
  const verses: Verse[] = await obj.json();
  const toks: string[] = [];
  const vmap: number[] = [];
  verses.forEach((v, vi) => {
    for (const t of v.m.split(' ')) {
      const n = normAr(t);
      if (n) {
        toks.push(n);
        vmap.push(vi);
      }
    }
  });
  const tri = new Map<string, number[]>();
  for (let i = 0; i < toks.length - 2; i++) {
    const k = toks[i] + '|' + toks[i + 1] + '|' + toks[i + 2];
    const arr = tri.get(k);
    if (arr) arr.push(i);
    else tri.set(k, [i]);
  }
  cachedIndex = { toks, vmap, verses, tri };
  return cachedIndex;
}

const MIN_MATCH = 5; // matched words to accept a quote (filters everyday phrases)

/** Find Quranic quotes in the transcript. Greedy trigram-seeded extension with
 * a small mismatch budget (ASR insertions/drops/substitutions). ~ms runtime. */
export async function findQuranQuotes(env: ScribeEnv, words: CleanWord[]): Promise<QuranQuote[]> {
  const { toks, vmap, verses, tri } = await loadIndex(env);
  const t = words.map((w) => normAr(w.text));
  const quotes: QuranQuote[] = [];
  let p = 0;
  while (p < t.length - 2) {
    if (!t[p]) {
      p++;
      continue;
    }
    const key = t[p] + '|' + t[p + 1] + '|' + t[p + 2];
    let best: { matched: number; align: [number, number][] } | null = null;
    for (const cpos of tri.get(key) || []) {
      let ti = p;
      let ci = cpos;
      let matched = 0;
      let budget = 2;
      const align: [number, number][] = [];
      while (ti < t.length && ci < toks.length) {
        if (t[ti] === toks[ci]) {
          align.push([ti, ci]);
          matched++;
          ti++;
          ci++;
          if (matched % 8 === 0) budget++;
        } else if (budget > 0 && ti + 1 < t.length && t[ti + 1] === toks[ci]) {
          budget--;
          ti++; // ASR inserted a word
        } else if (budget > 0 && ci + 1 < toks.length && t[ti] === toks[ci + 1]) {
          budget--;
          ci++; // ASR dropped a word
        } else if (budget > 0 && ti + 1 < t.length && ci + 1 < toks.length && t[ti + 1] === toks[ci + 1]) {
          budget--;
          align.push([ti, ci]);
          ti++;
          ci++; // substitution (misheard word)
        } else {
          break;
        }
      }
      if (matched >= MIN_MATCH && (!best || matched > best.matched)) best = { matched, align };
    }
    if (best) {
      // Group alignment by verse → per-ayah transcript spans
      const byVerse = new Map<number, { first: number; last: number }>();
      for (const [wi, ci] of best.align) {
        const vi = vmap[ci];
        const cur = byVerse.get(vi);
        if (!cur) byVerse.set(vi, { first: wi, last: wi });
        else cur.last = wi;
      }
      const vlist = [...byVerse.entries()].sort((a, b) => a[0] - b[0]);
      quotes.push({
        wStart: best.align[0][0],
        wEnd: best.align[best.align.length - 1][0],
        matched: best.matched,
        verses: vlist.map(([vi, span]) => ({
          key: verses[vi].k,
          ar: verses[vi].ar,
          en: verses[vi].en,
          wStart: span.first,
          wEnd: span.last,
        })),
      });
      p = best.align[best.align.length - 1][0] + 1;
    } else {
      p++;
    }
  }
  return quotes;
}

/** Citation for a contiguous quote: "2:255", "49:9-12", or comma list. */
export function citeQuote(vs: QuoteVerse[]): string {
  if (vs.length === 1) return vs[0].key;
  const surahs = new Set(vs.map((v) => v.key.split(':')[0]));
  if (surahs.size === 1) {
    const ayat = vs.map((v) => parseInt(v.key.split(':')[1]));
    const consecutive = ayat.every((a, i) => i === 0 || a === ayat[i - 1] + 1);
    if (consecutive) return `${vs[0].key}-${ayat[ayat.length - 1]}`;
  }
  return vs.map((v) => v.key).join(', ');
}
