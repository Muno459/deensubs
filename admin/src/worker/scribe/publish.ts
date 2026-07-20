// Publish a finished Scribe job as a first-class video on the site.
//
// Everything lands in the canonical locations the site expects:
//   videos/{slug}.mp4         — media copied from the job
//   subs/{slug}.srt           — translated subtitles
//   subs/{slug}-ar.srt        — original-language subtitles (Arabic sources)
//   thumbs/{slug}.jpg         — frame extracted by the container (ffmpeg)
//   thumbs/{slug}-{320,480,640}w.webp — responsive variants, generated
//                               upfront and mirrored into MEDIA_KV
// then the videos row is inserted and the KV cache purged.

import type { ScribeEnv } from './types';
import { streamToR2 } from './download';

const CDN_BASE = 'https://cdn.deensubs.com';

export type PublishOptions = {
  title?: string;
  title_ar?: string;
  description?: string;
  slug?: string;
  category_id?: number | null;
  scholar_id?: number | null;
  thumb_ts?: number; // seconds into the video for the thumbnail frame
  thumb_key?: string; // OR a ready image key (AI-translated original / custom upload)
};

type PublishEnv = ScribeEnv & { CACHE: KVNamespace; MEDIA_KV: KVNamespace; AI?: Ai; VECTORIZE?: VectorizeIndex };

async function containerCall(env: PublishEnv, name: string, path: string, init?: RequestInit): Promise<Response> {
  const { getContainer } = await import('@cloudflare/containers');
  const container = getContainer(env.YTDLP as any, name);
  const auth = { Authorization: 'Bearer ' + (env.YTDLP_TOKEN || 'internal') };
  return container.fetch(new Request('http://ytdlp' + path, { ...init, headers: { ...auth, ...(init?.headers as any) } }));
}

/** Copy an R2 object via streaming multipart (O(n), constant memory). */
async function copyObject(env: PublishEnv, from: string, to: string): Promise<void> {
  const obj = await env.MEDIA_BUCKET.get(from);
  if (!obj) throw new Error('missing R2 object: ' + from);
  await streamToR2(env.MEDIA_BUCKET, to, obj.body, obj.httpMetadata?.contentType || 'application/octet-stream');
}

/** Ask the container for candidate thumbnail frames; store them under the job. */
export async function generateThumbCandidates(env: PublishEnv, jobId: string, refresh = false): Promise<{ key: string; ts: number }[]> {
  const manifestKey = `scribe/${jobId}/thumbs.json`;
  if (!refresh) {
    const m = await env.MEDIA_BUCKET.get(manifestKey);
    if (m) {
      const cached: { key: string; ts: number }[] = await m.json();
      if (cached.length) return cached;
    }
  }
  const job: any = await env.DB.prepare('SELECT * FROM scribe_jobs WHERE id = ?').bind(jobId).first();
  if (!job?.source_key) throw new Error('job has no source media');
  const dur = job.duration || 60;
  const timestamps = [0.15, 0.4, 0.7].map((p) => Math.max(1, Math.round(dur * p)));

  const start = await containerCall(env, jobId, '/thumbs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `${CDN_BASE}/${job.source_key}`, timestamps }),
  });
  if (!start.ok) throw new Error(`thumbs start failed: HTTP ${start.status}`);
  const { id } = (await start.json()) as { id: string };

  let info: any = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const st = await containerCall(env, jobId, `/jobs/${id}`);
    info = st.ok ? await st.json() : null;
    if (info?.status === 'done' || info?.status === 'error') break;
  }
  if (info?.status !== 'done') throw new Error('thumbs failed: ' + (info?.error || 'timeout'));

  const candidates: { key: string; ts: number }[] = [];
  for (let n = 0; n < timestamps.length; n++) {
    const name = `t${n}.jpg`;
    if (!(info.names || []).includes(name)) continue;
    const file = await containerCall(env, jobId, `/files/${id}?name=${name}`);
    if (!file.ok) continue;
    const key = `scribe/${jobId}/cand-${n}.jpg`;
    await env.MEDIA_BUCKET.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: 'image/jpeg' } });
    candidates.push({ key, ts: timestamps[n] });
  }
  containerCall(env, jobId, `/files/${id}`, { method: 'DELETE' }).catch(() => {});
  if (!candidates.length) throw new Error('no thumbnail candidates produced');
  await env.MEDIA_BUCKET.put(manifestKey, JSON.stringify(candidates), {
    httpMetadata: { contentType: 'application/json' },
  });
  return candidates;
}

/** Generate the responsive WebP variants the public site serves for a
 * thumbs/ image (site requests -{320,480,640}w; originals alone render as
 * broken thumbnails). No-op for non-thumbs keys or when variants exist. */
export async function bakeThumbVariants(env: PublishEnv, key: string): Promise<void> {
  const m = (key || '').match(/^(thumbs\/.+)\.(jpe?g|png|webp|gif|avif)$/i);
  if (!m) return;
  const base = m[1];
  if (await env.MEDIA_BUCKET.head(`${base}-640w.webp`)) return; // already baked

  const start = await containerCall(env, 'bake', '/thumbs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `${CDN_BASE}/${key}`, timestamps: [0], variants: true }),
  });
  if (!start.ok) throw new Error(`variant bake start failed: HTTP ${start.status}`);
  const { id } = (await start.json()) as { id: string };
  let info: any = null;
  for (let i = 0; i < 48; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const st = await containerCall(env, 'bake', `/jobs/${id}`);
    info = st.ok ? await st.json() : null;
    if (info?.status === 'done' || info?.status === 'error') break;
  }
  if (info?.status !== 'done') throw new Error('variant bake failed: ' + (info?.error || 'timeout'));
  for (const w of [320, 480, 640]) {
    const name = `t0-${w}w.webp`;
    if (!(info.names || []).includes(name)) continue;
    const file = await containerCall(env, 'bake', `/files/${id}?name=${name}`);
    if (!file.ok) continue;
    const bytes = await file.arrayBuffer();
    await env.MEDIA_BUCKET.put(`${base}-${w}w.webp`, bytes, { httpMetadata: { contentType: 'image/webp' } });
    await env.MEDIA_KV.put(`${base}-${w}w.webp`, bytes, { metadata: { ct: 'image/webp' } }).catch(() => {});
  }
  containerCall(env, 'bake', `/files/${id}`, { method: 'DELETE' }).catch(() => {});
}

export async function publishScribeJob(env: PublishEnv, jobId: string, opts: PublishOptions = {}, ctx?: { waitUntil(p: Promise<any>): void }) {
  const job: any = await env.DB.prepare('SELECT * FROM scribe_jobs WHERE id = ?').bind(jobId).first();
  if (!job) throw new Error('Job not found');
  if (job.status !== 'done') throw new Error(`Job status is ${job.status}, must be done`);
  // Audio-only jobs publish as AUDIOBOOKS: same catalog row, media='audio',
  // karaoke transcript instead of a video track.
  const isAudiobook = !job.full_video;
  const extMatch = (job.source_key || '').match(/\.(mp4|webm|mkv|mov)$/i);
  if (!isAudiobook && !extMatch) throw new Error(`Source is ${job.source_key} — run fetch-video first or publish as audiobook`);

  const title = opts.title || job.title || jobId;
  const slug = (opts.slug || title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  if (!slug) throw new Error('empty slug');
  const existing = await env.DB.prepare('SELECT id FROM videos WHERE slug = ?').bind(slug).first();
  if (existing) throw new Error(`slug already exists: ${slug}`);

  // 1. Reference the media in place (copying GBs through the worker was the
  // publish bottleneck; retention + delete exempt scribe keys referenced by
  // videos). Small subtitle files still get canonical copies.
  const videoKey = job.source_key as string;
  const srtKey = `subs/${slug}.srt`;
  if (job.srt_key) await copyObject(env, job.srt_key, srtKey);
  const isArabicSource = (job.language_code || '').startsWith('ar');
  const srtArKey = isArabicSource && job.srt_source_key ? `subs/${slug}-ar.srt` : null;
  if (srtArKey) await copyObject(env, job.srt_source_key, srtArKey);
  let langs: string[] = [];
  try { langs = JSON.parse(job.target_langs || '[]'); } catch {}
  for (const lang of langs.slice(1)) {
    await copyObject(env, `scribe/${jobId}/${lang}.srt`, `subs/${slug}.${lang}.srt`).catch(() => {});
  }

  // 1b. Audiobook: the karaoke transcript gets a canonical slug-stable copy
  if (isAudiobook) {
    await copyObject(env, `scribe/${jobId}/transcript.json`, `transcripts/${slug}.json`);
  }

  // 2. Thumbnail + responsive WebP variants, generated upfront. Source is
  // either a chosen video frame (thumb_ts) or a ready image (thumb_key —
  // the AI-translated original or a custom upload). Audiobooks cannot frame-
  // grab: artwork is the scholar's baked 1920x1080 stage card when one exists
  // (scholars/cards/{slug}.jpg — the site also renders it as the player
  // stage), else the chosen image or the channel's cover art.
  let scholarCard: string | null = null;
  if (isAudiobook && !opts.thumb_key && opts.scholar_id) {
    const sch: any = await env.DB.prepare('SELECT slug FROM scholars WHERE id = ?').bind(opts.scholar_id).first();
    if (sch?.slug && (await env.MEDIA_BUCKET.head(`scholars/cards/${sch.slug}.jpg`))) {
      scholarCard = `scholars/cards/${sch.slug}.jpg`;
    }
  }
  const fromImage = !!opts.thumb_key || isAudiobook;
  const thumbSrc = opts.thumb_key
    ? `${CDN_BASE}/${opts.thumb_key}`
    : isAudiobook
      ? (scholarCard ? `${CDN_BASE}/${scholarCard}` : (job.thumb_url as string))
      : `${CDN_BASE}/${job.source_key}`;
  if (isAudiobook && !thumbSrc) throw new Error('audiobook needs artwork: pick a scholar with a stage card or set a thumbnail image first');
  const ts = fromImage ? 0 : opts.thumb_ts ?? Math.max(1, Math.round((job.duration || 60) * 0.3));
  const start = await containerCall(env, jobId, '/thumbs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: thumbSrc, timestamps: [ts], variants: true }),
  });
  if (!start.ok) throw new Error(`thumbs start failed: HTTP ${start.status}`);
  const { id } = (await start.json()) as { id: string };
  let info: any = null;
  for (let i = 0; i < 48; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const st = await containerCall(env, jobId, `/jobs/${id}`);
    info = st.ok ? await st.json() : null;
    if (info?.status === 'done' || info?.status === 'error') break;
  }
  if (info?.status !== 'done') throw new Error('thumbnail generation failed: ' + (info?.error || 'timeout'));

  const thumbKey = `thumbs/${slug}.jpg`;
  const fileMap: Record<string, string> = { 't0.jpg': thumbKey };
  for (const w of [320, 480, 640]) fileMap[`t0-${w}w.webp`] = `thumbs/${slug}-${w}w.webp`;
  for (const [name, key] of Object.entries(fileMap)) {
    if (!(info.names || []).includes(name)) continue;
    const file = await containerCall(env, jobId, `/files/${id}?name=${name}`);
    if (!file.ok) continue;
    const bytes = await file.arrayBuffer();
    const ctype = name.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    await env.MEDIA_BUCKET.put(key, bytes, { httpMetadata: { contentType: ctype } });
    // Mirror WebP variants into MEDIA_KV — the site serves thumbnails from KV
    if (name.endsWith('.webp')) {
      await env.MEDIA_KV.put(key, bytes, { metadata: { ct: 'image/webp' } }).catch(() => {});
    }
  }
  containerCall(env, jobId, `/files/${id}`, { method: 'DELETE' }).catch(() => {});

  // 3. Insert the video row (with chapters + language list); media='audio'
  // marks audiobooks so the site renders the karaoke player
  await env.DB.prepare(
    'INSERT INTO videos (title, title_ar, slug, description, category_id, scholar_id, duration, video_key, srt_key, srt_ar_key, thumb_key, chapters, srt_langs, media) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(
    title,
    opts.title_ar ?? job.title_ar ?? null,
    slug,
    opts.description ?? job.description ?? null,
    opts.category_id ?? null,
    opts.scholar_id ?? null,
    Math.round(job.duration || 0),
    videoKey,
    job.srt_key ? srtKey : null,
    srtArKey,
    thumbKey,
    job.chapters || null,
    langs.length ? JSON.stringify(langs) : null,
    isAudiobook ? 'audio' : null
  ).run();

  // 3a. Attach to the site playlist this job was queued from (playlist imports).
  // playlist_pos was fixed at queue time, so order holds even when jobs are
  // published out of order.
  let playlist: { id: number; title: string; slug: string } | null = null;
  if (job.playlist_id) {
    try {
      const [vid, pl] = await Promise.all([
        env.DB.prepare('SELECT id FROM videos WHERE slug = ?').bind(slug).first() as Promise<any>,
        env.DB.prepare('SELECT id, title, slug FROM playlists WHERE id = ?').bind(job.playlist_id).first() as Promise<any>,
      ]);
      if (vid && pl) {
        let pos = job.playlist_pos;
        if (pos == null) {
          const max: any = await env.DB.prepare('SELECT COALESCE(MAX(position), -1) as p FROM playlist_videos WHERE playlist_id = ?').bind(pl.id).first();
          pos = (max?.p ?? -1) + 1;
        }
        await env.DB.prepare('INSERT OR IGNORE INTO playlist_videos (playlist_id, video_id, position) VALUES (?,?,?)')
          .bind(pl.id, vid.id, pos).run();
        playlist = pl;
      }
    } catch (err) {
      console.log('playlist attach failed (non-fatal):', (err as any)?.message);
    }
  }

  // 3b + 4 run in the background — the admin gets their response immediately
  const indexAndPurge = async () => {
  // 3b. Index cues: FTS for transcript search + Vectorize for semantic search
  try {
    const cuesObj = await env.MEDIA_BUCKET.get(`scribe/${jobId}/cues.json`);
    if (cuesObj) {
      const cues: any[] = await cuesObj.json();
      await env.DB.prepare('DELETE FROM cues_fts WHERE slug = ?').bind(slug).run().catch(() => {});
      for (let i = 0; i < cues.length; i += 40) {
        const batch = cues.slice(i, i + 40);
        const stmt = env.DB.prepare('INSERT INTO cues_fts (slug, start, text, source) VALUES (?,?,?,?)');
        await env.DB.batch(batch.map((cu) => stmt.bind(slug, Math.round(cu.start), cu.text, cu.source || '')));
      }
      if (env.AI && env.VECTORIZE) {
        for (let i = 0; i < cues.length; i += 50) {
          const batch = cues.slice(i, i + 50);
          const emb: any = await env.AI.run('@cf/baai/bge-m3', { text: batch.map((cu) => cu.text) });
          const vectors = (emb.data || []).map((v: number[], j: number) => ({
            id: `${slug}#${i + j}`,
            values: v,
            metadata: { slug, title, start: Math.round(batch[j].start), text: batch[j].text.slice(0, 200) },
          }));
          if (vectors.length) await env.VECTORIZE.upsert(vectors);
        }
      }
    }
  } catch (err) {
    console.log('cue indexing failed (non-fatal):', (err as any)?.message);
  }

  // 4. Fresh cache for the site
  const keys = await env.CACHE.list();
  for (const k of keys.keys) await env.CACHE.delete(k.name);
  };
  await (await import('./types')).updateJob(env.DB, jobId, { published_slug: slug });
  if (ctx) ctx.waitUntil(indexAndPurge());
  else await indexAndPurge();

  return { slug, video_key: videoKey, thumb_key: thumbKey, srt_key: srtKey, srt_ar_key: srtArKey, playlist };
}
