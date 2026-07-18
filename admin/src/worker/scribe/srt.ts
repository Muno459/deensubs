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

/** Wrap text into at most two lines of ~42 chars, splitting near the middle. */
export function wrapCueText(text: string, maxLine = 42): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLine) return clean;
  const words = clean.split(' ');
  // Find the split point closest to the middle
  let best = 0;
  let bestDist = Infinity;
  let len = 0;
  const half = clean.length / 2;
  for (let i = 0; i < words.length - 1; i++) {
    len += words[i].length + 1;
    const dist = Math.abs(len - half);
    if (dist < bestDist) { bestDist = dist; best = i; }
  }
  const l1 = words.slice(0, best + 1).join(' ');
  const l2 = words.slice(best + 1).join(' ');
  return l1 + '\n' + l2;
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
