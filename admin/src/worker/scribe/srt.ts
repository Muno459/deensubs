// Step 4: render cues to SRT (translated + original language).

import type { Cue } from './types';

function ts(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const f = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(f, 3)}`;
}

// Words a line should not END on: breaking here strands a function word away
// from what it governs ("the dinar, the / dirham"), which reads badly even
// though the character split looked balanced.
const CLING = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'nor', 'so', 'yet', 'of', 'in', 'on', 'at', 'to', 'for',
  'with', 'from', 'by', 'as', 'is', 'was', 'are', 'were', 'be', 'been', 'that', 'which', 'who',
  'whom', 'whose', 'this', 'these', 'those', 'his', 'her', 'its', 'their', 'our', 'your', 'my',
  'not', 'no', 'if', 'when', 'while', 'than', 'then', 'into', 'upon', 'about', 'over', 'under',
]);

const isCling = (w: string) => CLING.has(w.toLowerCase().replace(/[^a-z']/g, ''));

/** Greedy word wrap, used only when the text cannot fit two lines (which means
 *  the cue should have been split upstream). Still better than one giant line.
 *  Backs off a word rather than ending a line on a function word. */
function greedyWrap(words: string[], maxLine: number): string {
  const lines: string[] = [];
  let cur: string[] = [];
  const flush = () => {
    // Never end a line on a word that governs the next one, as long as doing
    // so leaves something on the line.
    while (cur.length > 1 && isCling(cur[cur.length - 1])) words.unshift(cur.pop()!);
    lines.push(cur.join(' '));
    cur = [];
  };
  while (words.length) {
    const w = words.shift()!;
    const len = cur.reduce((n, x) => n + x.length + 1, -1);
    if (cur.length && len + 1 + w.length > maxLine) { words.unshift(w); flush(); continue; }
    cur.push(w);
  }
  if (cur.length) lines.push(cur.join(' '));
  return lines.join('\n');
}

/** Wrap into at most two lines of `maxLine` chars, breaking where the sentence
 *  actually breathes rather than at the raw character midpoint: punctuation
 *  first, then a balanced break that does not strand a function word. */
export function wrapCueText(text: string, maxLine = 42): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLine) return clean;
  const words = clean.split(' ');

  const half = clean.length / 2;
  let best = -1;
  let bestScore = -Infinity;
  let len = 0;
  for (let i = 0; i < words.length - 1; i++) {
    len += words[i].length + (i ? 1 : 0);
    const l1 = len;
    const l2 = clean.length - len - 1;
    if (l1 > maxLine || l2 > maxLine) continue; // both halves must fit
    // Balance is the baseline; punctuation earns a big bonus, a stranded
    // function word a big penalty.
    let score = -Math.abs(l1 - half) / half;
    if (/[.!?:;,—…]$/.test(words[i])) score += 1.0;
    // Breaking after a word that governs the next one reads as a stumble, so it
    // has to lose to any alternative that fits, however lopsided that split is.
    if (isCling(words[i])) score -= 4.0;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  if (best < 0) return greedyWrap(words, maxLine); // cannot fit two lines
  return words.slice(0, best + 1).join(' ') + '\n' + words.slice(best + 1).join(' ');
}

export function renderSrt(cues: Cue[], field: 'text' | 'source'): string {
  const blocks: string[] = [];
  let n = 1;
  for (const c of cues) {
    const body = field === 'text' ? wrapCueText(c.text) : wrapCueText(c.source);
    if (!body.trim()) continue;
    blocks.push(`${n++}\n${ts(c.start)} --> ${ts(c.end)}\n${body}`);
  }
  return blocks.join('\n\n') + '\n';
}
