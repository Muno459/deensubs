// Step 5: metadata creation — AI title + description from the transcript.
//
// The prompt includes 20+ subtitle lines (not a tiny sample): titles and
// descriptions written from two or three lines miss what the lecture is
// actually about.

import { llmChat } from './translate';
import type { Cue, ScribeEnv } from './types';

export type VideoMetadata = {
  title: string;
  title_ar: string;
  description: string;
  slug: string;
};

/** Pick a representative sample: at least ~30 cues spread across the talk. */
function sampleCues(cues: Cue[]): Cue[] {
  if (cues.length <= 40) return cues;
  const picked: Cue[] = cues.slice(0, 15); // opening sets the topic
  const rest = cues.slice(15);
  const step = Math.max(1, Math.floor(rest.length / 20));
  for (let i = 0; i < rest.length; i += step) picked.push(rest[i]);
  return picked.slice(0, 45);
}

export async function generateMetadata(
  env: ScribeEnv,
  jobId: string,
  cues: Cue[],
  languageCode: string
): Promise<VideoMetadata> {
  const sample = sampleCues(cues);
  const lines = sample.map((c) => `- ${c.text}${c.source ? `  [${c.source}]` : ''}`).join('\n');

  const messages = (extra = '') => [
      {
        role: 'system',
        content: `You write metadata for Islamic lecture videos on DeenSubs (Arabic lectures with English subtitles). Answer with ONE JSON object only — no markdown, no bold, no code fences, no text before or after the JSON.${extra}
{"title": "...", "title_ar": "...", "description": "...", "slug": "..."}

Rules:
- title: natural English, specific to the actual content (60-90 chars). Name the topic and, if identifiable from the transcript, the speaker. No clickbait, no quotes around it.
- title_ar: faithful Arabic title.
- description: 2-3 sentences (200-400 chars) summarizing what is actually discussed — concrete points, not generic praise.
- slug: lowercase-hyphenated from the English title, max 60 chars, a-z0-9- only.
- Keep Islamic honorifics: Allah ﷻ, the Prophet Muhammad ﷺ.`,
      },
      {
        role: 'user',
        content: `Source language: ${languageCode}\n\nSubtitle lines from across the lecture (${sample.length} of ${cues.length} cues):\n${lines}`,
      },
  ];

  function tryParse(raw: string): VideoMetadata | null {
    // Tolerate markdown wrapping (**...**, fences) and leading/trailing prose
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      const obj = JSON.parse(raw.slice(start, end + 1));
      const meta: VideoMetadata = {
        title: String(obj.title || '').slice(0, 200),
        title_ar: String(obj.title_ar || '').slice(0, 200),
        description: String(obj.description || '').slice(0, 1000),
        slug: String(obj.slug || '')
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 60),
      };
      return meta.title ? meta : null;
    } catch {
      return null;
    }
  }

  let meta: VideoMetadata | null = null;
  let raw = '';
  for (let attempt = 0; attempt < 3 && !meta; attempt++) {
    raw = await llmChat(
      env,
      messages(attempt > 0 ? ' Your previous answer was not valid JSON — output ONLY the raw JSON object.' : ''),
      2000
    );
    meta = tryParse(raw);
  }
  if (!meta) throw new Error('metadata JSON unparseable after retries: ' + raw.slice(0, 150));

  await env.MEDIA_BUCKET.put(`scribe/${jobId}/meta.json`, JSON.stringify(meta, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });
  return meta;
}

export type Chapter = { t: number; title: string };

/** Segment the lecture into chapters with timestamps (for player markers). */
export async function generateChapters(env: ScribeEnv, cues: Cue[]): Promise<Chapter[]> {
  if (cues.length < 20) return []; // too short to chapter
  const lines = cues.map((c) => `${Math.round(c.start)}s: ${c.text}`).join('\n');
  const raw = await llmChat(
    env,
    [
      {
        role: 'system',
        content: `Segment this lecture transcript into 3-10 chapters. Answer with ONLY a JSON array, no markdown:
[{"t": startSeconds, "title": "Short chapter title"}]
Rules: first chapter at t=0; titles 3-8 words, specific to what is discussed; chapters at real topic shifts, minimum 60 seconds apart.`,
      },
      { role: 'user', content: lines.slice(0, 24000) },
    ],
    1500
  );
  try {
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    const arr = JSON.parse(raw.slice(start, end + 1));
    return (Array.isArray(arr) ? arr : [])
      .filter((c: any) => typeof c.t === 'number' && c.title)
      .map((c: any) => ({ t: Math.max(0, Math.round(c.t)), title: String(c.title).slice(0, 80) }))
      .slice(0, 12);
  } catch {
    return [];
  }
}
