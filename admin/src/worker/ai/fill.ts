// AI form-fill: one endpoint that drafts every manual field in the admin.
// Server-side context enrichment (cues, catalog, schema) keeps client calls tiny.

import { llmChat } from '../scribe/translate';

const MODEL = 'ag/claude-sonnet-4-6';

function parseJson(raw: string): any {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI returned no JSON');
  return JSON.parse(m[0]);
}

function slugify(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

async function ask(env: any, system: string, user: string, maxTokens = 900): Promise<any> {
  const raw = await llmChat(env, [
    { role: 'system', content: system + ' Respond with a single JSON object only — no markdown, no commentary.' },
    { role: 'user', content: user },
  ], maxTokens, MODEL);
  return parseJson(raw);
}

async function catalogContext(env: any): Promise<string> {
  const [cats, sch] = await Promise.all([
    env.DB.prepare('SELECT id, name FROM categories ORDER BY name').all(),
    env.DB.prepare('SELECT id, name FROM scholars ORDER BY name').all(),
  ]);
  return `Categories: ${JSON.stringify(cats.results)}\nScholars: ${JSON.stringify(sch.results)}`;
}

/** Sample ~30 cue texts spread across the whole talk (per metadata guidance: 20+ lines). */
function sampleCues(cues: any[], n = 30): string {
  if (!cues.length) return '';
  const step = Math.max(1, Math.floor(cues.length / n));
  const picks: string[] = [];
  for (let i = 0; i < cues.length && picks.length < n; i += step) picks.push(cues[i].text);
  return picks.join('\n');
}

export async function aiFill(env: any, kind: string, payload: any): Promise<any> {
  switch (kind) {
    case 'playlist-suggest': {
      const vids: any = await env.DB.prepare(
        `SELECT v.id, v.title, v.duration, s.name AS scholar,
                (SELECT COUNT(*) FROM playlist_videos pv WHERE pv.video_id = v.id) AS in_pl
         FROM videos v LEFT JOIN scholars s ON s.id = v.scholar_id ORDER BY v.created_at`
      ).all();
      const lines = (vids.results as any[])
        .map((v) => `${v.id} | ${Math.round((v.duration || 0) / 60)}min | ${v.scholar || '?'} | ${v.title}${v.in_pl ? ' [already in a playlist]' : ''}`)
        .join('\n');
      return ask(env,
        'You curate an Islamic lecture library. Group the catalog into NEW playlists: coherent series (same book, commentary arc, usually one scholar) or strong thematic collections. Prefer videos not already in a playlist; never mix unrelated one-offs just to fill. Return {"playlists": [{"title": "...", "description": "one sentence", "video_ids": [ids in watch order]}]} with 2-8 playlists, each 3+ videos, ONLY ids from the list. Playlist titles must not include the scholar name.',
        `Catalog (id | length | scholar | title):\n${lines}\n\nReturn the JSON.`, 3200);
    }
    case 'playlist-split': {
      const pl: any = await env.DB.prepare('SELECT id, title FROM playlists WHERE id = ?').bind(payload.playlist_id).first();
      if (!pl) throw new Error('playlist not found');
      const vids: any = await env.DB.prepare(
        `SELECT v.id, v.title FROM playlist_videos pv JOIN videos v ON v.id = pv.video_id
         WHERE pv.playlist_id = ? ORDER BY pv.position ASC`
      ).bind(pl.id).all();
      const lines = (vids.results as any[]).map((v, i) => `${i + 1}. ${v.id} | ${v.title}`).join('\n');
      return ask(env,
        'Segment ONE long playlist into several smaller stand-alone playlists (flat, never nested): sequential arcs of a series or coherent sub-topics. Every video lands in exactly one segment; original order is preserved inside each. Return {"playlists": [{"title": "...", "description": "one sentence", "video_ids": [...]}]} with 2-6 segments of 2+ videos, ONLY ids from the list.',
        `Playlist "${pl.title}" in order (position. id | title):\n${lines}\n\nReturn the JSON.`, 2600);
    }
    case 'publish': {
      const job: any = await env.DB.prepare('SELECT * FROM scribe_jobs WHERE id = ?').bind(payload.jobId).first();
      if (!job) throw new Error('Job not found');
      let sample = '';
      const obj = await env.MEDIA_BUCKET.get(`scribe/${payload.jobId}/cues.json`);
      if (obj) sample = sampleCues(await obj.json());
      const out = await ask(env,
        'You fill a publish form for an Islamic lecture video. Fields: title (clear, dignified, no clickbait), title_ar (natural Arabic, not transliteration), description (2-3 English sentences, what the viewer will learn), slug (lowercase-hyphens), category_id and scholar_id chosen ONLY from the provided lists (null when nothing fits — never invent; match the scholar only if the transcript or title names them).',
        `${await catalogContext(env)}\n\nCurrent title: ${job.title || ''}\nCurrent description: ${job.description || ''}\nChannel: ${job.channel || ''}\n\nSubtitle sample:\n${sample}\n\nReturn {"title","title_ar","description","slug","category_id","scholar_id"}.`);
      out.slug = slugify(out.slug || out.title);
      return out;
    }
    case 'video': {
      const v = payload.video || {};
      let sample = '';
      if (v.srt_key) {
        const obj = await env.MEDIA_BUCKET.get(v.srt_key);
        if (obj) sample = (await obj.text()).replace(/\d+\n[\d:,]+ --> [\d:,]+\n/g, '').slice(0, 2500);
      }
      const out = await ask(env,
        'You complete a video catalog form for an Islamic content platform. Improve/fill: title, title_ar (natural Arabic), description (2-3 English sentences), slug, source (speaker/channel if evident, else empty), category_id and scholar_id ONLY from the provided lists (null when unsure — never invent).',
        `${await catalogContext(env)}\n\nExisting form: ${JSON.stringify({ title: v.title, title_ar: v.title_ar, description: v.description, source: v.source })}\n\nSubtitles sample:\n${sample}\n\nReturn {"title","title_ar","description","slug","source","category_id","scholar_id"}.`);
      out.slug = slugify(out.slug || out.title);
      return out;
    }
    case 'category': {
      const cats = await env.DB.prepare('SELECT name, color FROM categories').all();
      return ask(env,
        'You complete a content-category form. Given a category name (or topic idea), return a polished English name, natural Arabic name, and a tasteful muted hex color distinct from the existing ones (dark-UI friendly, no neon).',
        `Existing categories: ${JSON.stringify(cats.results)}\nInput name/topic: ${payload.name || ''}\n\nReturn {"name","name_ar","color"}.`);
    }
    case 'scholar': {
      const out = await ask(env,
        'You draft a scholar profile for an Islamic content platform. Given a (possibly rough) name, return: name (properly formatted English transliteration with the Sheikh honorific, e.g. "Sheikh Salih al-Fawzan"), slug, a short title line (role/affiliation IF widely known — empty string when not certain), and a 2-3 sentence bio draft. Never fabricate specifics: when unsure of facts, keep the bio generic about their known field and say nothing unverifiable.',
        `Scholar name: ${payload.name || ''}\n\nReturn {"name","slug","title","bio"}.`);
      out.slug = slugify(out.slug || out.name || payload.name);
      return out;
    }
    case 'playlist': {
      let titles: string[] = Array.isArray(payload.videoTitles) ? payload.videoTitles.slice(0, 30) : [];
      if (!titles.length && payload.playlistId) {
        const rows = await env.DB.prepare('SELECT v.title FROM playlist_videos pv JOIN videos v ON v.id = pv.video_id WHERE pv.playlist_id = ? ORDER BY pv.position LIMIT 30').bind(payload.playlistId).all();
        titles = (rows.results as any[]).map((r) => r.title);
      }
      return ask(env,
        'You name a playlist (series) for an Islamic content platform whose audience reads English. Return: title (concise series title in ENGLISH — translate naturally if the hint is Arabic, never transliterate), title_ar (natural Arabic title), and description (1-2 English sentences saying what the series covers and, if the speaker is evident from the channel or titles, who it is by).',
        `Topic hint from user: ${payload.title || ''}\nChannel: ${payload.channel || ''}\nVideos in the playlist:\n${titles.join('\n') || '(none yet — use the topic hint)'}\n\nReturn {"title","title_ar","description"}.`);
    }
    case 'clip_hook': {
      return ask(env,
        'You write a hook title pinned on a vertical clip for social media. The winning formula: 4-8 words, curiosity or stakes up front, dignified (no vulgar clickbait), Title Case, no emoji, no quotes.',
        `Clip transcript:\n${(payload.text || '').slice(0, 1500)}\n\nReturn {"hook"}.`);
    }
    case 'sql': {
      let schema = '';
      if (payload.engine === 'ae') {
        schema = "Workers Analytics Engine SQL API (ClickHouse-like). Dataset: deensubs_analytics. Columns: blob1..blob20 (strings), double1..double20 (numbers), timestamp, index1. Use SELECT with toStartOfInterval/toDateTime as needed.";
      } else {
        const t = await env.DB.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%' AND sql IS NOT NULL").all();
        schema = (t.results as any[]).map((r) => r.sql).join('\n').slice(0, 7000);
      }
      const out = await ask(env,
        'You write a single read-only SQL query (SELECT only, never mutate) answering the admin\'s question against the given schema. Prefer explicit column lists and sensible LIMITs.',
        `Schema:\n${schema}\n\nQuestion: ${payload.question || ''}\n\nReturn {"sql"}.`, 700);
      if (!/^\s*(SELECT|WITH)\b/i.test(out.sql || '')) throw new Error('AI produced a non-SELECT query — rejected');
      return out;
    }
    default:
      throw new Error('Unknown fill kind: ' + kind);
  }
}
