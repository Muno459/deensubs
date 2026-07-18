// ASS subtitle authoring for the Clip Studio renderer.
//
// The winning short-form formula, encoded: rapid-fire caption groups of
// 2-4 words that pop in sync with speech (timing distributed from the cue
// timings), a hook title pinned to the top for the whole clip, high
// contrast type sized for phones, everything inside the safe area.

import type { Cue } from './types';

export type ClipStyle = 'bold' | 'accent' | 'minimal';
/** Old rows stored 'gold'; it maps to the teal accent preset. */
export function normalizeStyle(s: string): ClipStyle {
  return s === 'gold' ? 'accent' : (['bold', 'accent', 'minimal'].includes(s) ? (s as ClipStyle) : 'bold');
}

const PLAY_W = 1080;
const PLAY_H = 1920;

function assTime(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

function esc(text: string): string {
  return text.replace(/\{/g, '(').replace(/\}/g, ')').replace(/\n/g, ' ');
}

const hasArabic = (t: string) => /[؀-ۿ]/.test(t);

/** Split cue text into caption groups of ~2-4 words, timed by char share. */
function groupCue(cue: Cue, clipStart: number): { start: number; end: number; text: string }[] {
  const words = cue.text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const groups: string[][] = [];
  let g: string[] = [];
  for (const w of words) {
    g.push(w);
    const chars = g.join(' ').length;
    if (g.length >= 4 || (g.length >= 2 && chars > 18)) {
      groups.push(g);
      g = [];
    }
  }
  if (g.length) groups.push(g);

  const s0 = cue.start - clipStart;
  const dur = Math.max(0.4, cue.end - cue.start);
  const totalChars = groups.reduce((a, gr) => a + gr.join(' ').length, 0) || 1;
  const out: { start: number; end: number; text: string }[] = [];
  let t = s0;
  for (const gr of groups) {
    const share = (gr.join(' ').length / totalChars) * dur;
    out.push({ start: t, end: t + share, text: gr.join(' ') });
    t += share;
  }
  return out;
}

export function buildClipAss(opts: {
  cues: Cue[]; // cues overlapping the clip range, absolute times
  start: number;
  end: number;
  hook: string;
  style: ClipStyle;
}): string {
  const { cues, start, end, hook, style } = opts;
  const dur = end - start;
  const arabic = cues.some((c) => hasArabic(c.text));
  const capFont = arabic ? 'Noto Naskh Arabic' : 'Geist';

  // Style presets — Fontsize is in PlayRes units (1080x1920)
  const styles: Record<ClipStyle, { caption: string; title: string; upper: boolean }> = {
    bold: {
      caption: `Style: Caption,${capFont},92,&H00FFFFFF,&H00A2B345,&H00000000,&H96000000,-1,0,0,0,100,100,1,0,1,9,3,2,60,60,560,1`,
      title: `Style: Title,Geist,58,&H00FFFFFF,&H00FFFFFF,&H00000000,&HB4000000,-1,0,0,0,100,100,0,0,3,0,14,8,70,70,110,1`,
      upper: true,
    },
    accent: {
      caption: `Style: Caption,${capFont},80,&H00DFEAEC,&H00BFCF6E,&H00000000,&H8C000000,-1,0,0,0,100,100,0.5,0,1,7,2,2,70,70,560,1`,
      title: `Style: Title,Geist,54,&H00A2B345,&H00FFFFFF,&H00000000,&HB4000000,-1,0,0,0,100,100,0.5,0,3,0,12,8,70,70,110,1`,
      upper: false,
    },
    minimal: {
      caption: `Style: Caption,${capFont},72,&H00FFFFFF,&H00FFFFFF,&H00000000,&H78000000,0,0,0,0,100,100,0.3,0,1,5,1,2,80,80,560,1`,
      title: `Style: Title,Geist,50,&H00FFFFFF,&H00FFFFFF,&H00000000,&HB4000000,0,0,0,0,100,100,0.3,0,3,0,10,8,80,80,110,1`,
      upper: false,
    },
  };
  const preset = styles[style] || styles.bold;

  const events: string[] = [];

  // Hook title, pinned top, whole clip (alignment 8 = top center)
  if (hook.trim()) {
    events.push(
      `Dialogue: 1,${assTime(0.15)},${assTime(Math.max(0.5, dur - 0.1))},Title,,0,0,0,,{\\fad(220,180)}${esc(hook.trim())}`
    );
  }

  // Rapid caption groups
  for (const cue of cues) {
    const s = Math.max(cue.start, start);
    const e = Math.min(cue.end, end);
    if (e - s < 0.15) continue;
    const clamped: Cue = { ...cue, start: s, end: e };
    for (const grp of groupCue(clamped, start)) {
      if (grp.end <= 0 || grp.start >= dur) continue;
      const text = preset.upper && !hasArabic(grp.text) ? grp.text.toUpperCase() : grp.text;
      events.push(
        `Dialogue: 0,${assTime(Math.max(0, grp.start))},${assTime(Math.min(dur, grp.end + 0.05))},Caption,,0,0,0,,{\\fad(50,30)}${esc(text)}`
      );
    }
  }

  return `[Script Info]
Title: DeenSubs Clip
ScriptType: v4.00+
PlayResX: ${PLAY_W}
PlayResY: ${PLAY_H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${preset.caption}
${preset.title}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join('\n')}
`;
}
