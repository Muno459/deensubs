import { Hono } from 'hono';
import { VIDEO_COLS, VIDEO_JOIN, readDB, writeDB } from '../lib/db.js';
import { getSearchSuggestions } from '../lib/kv-cache.js';

const api = new Hono();

// CORS for API endpoints
api.use('/api/*', async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' } });
  }
  await next();
  try { c.res.headers.set('Access-Control-Allow-Origin', '*'); } catch {}
});

// Simple KV-based rate limiter
async function rateLimit(env, key, maxReqs, windowSec) {
  const rlKey = 'rl:' + key;
  const val = parseInt(await env.CACHE.get(rlKey) || '0');
  if (val >= maxReqs) return false;
  await env.CACHE.put(rlKey, String(val + 1), { expirationTtl: windowSec });
  return true;
}

const VC = VIDEO_COLS;
const VJ = VIDEO_JOIN;

// Debug: check D1 read replica region
api.get('/api/d1-region', async (c) => {
  const start = Date.now();
  const result = await readDB(c.env).prepare('SELECT 1').run();
  return c.json({
    region: result.meta?.served_by_region || 'unknown',
    primary: result.meta?.served_by_primary ?? 'unknown',
    latency: Date.now() - start + 'ms',
  });
});

api.get('/api/videos', async (c) => {
  const cacheKey = 'api:videos';
  let cached = null;
  try { cached = await c.env.CACHE.get(cacheKey, 'json'); } catch {}
  if (cached) return c.json(cached);
  const videos = (await readDB(c.env).prepare(`SELECT ${VC} ${VJ} ORDER BY v.created_at DESC LIMIT 100`).all()).results;
  const result = { videos };
  c.executionCtx.waitUntil(c.env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 60 }));
  return c.json(result);
});

// Single video metadata
api.get('/api/videos/:slug', async (c) => {
  const slug = c.req.param('slug');
  const { getVideo } = await import('../lib/kv-cache.js');
  const video = await getVideo(c.env, slug);
  if (!video) return c.json({ error: 'Not found' }, 404);
  return c.json({ video: { title: video.title, slug: video.slug, description: video.description, source: video.source, category_name: video.category_name, scholar_name: video.scholar_name, views: video.views, likes: video.likes, duration: video.duration, created_at: video.created_at, has_subtitles: !!video.srt_key } });
});

api.post('/api/videos/:slug/like', async (c) => {
  const slug = c.req.param('slug');
  const ip = c.req.header('CF-Connecting-IP') || 'anon';
  if (!await rateLimit(c.env, 'like:' + ip + ':' + slug, 1, 3600)) return c.json({ error: 'Already liked' }, 429);
  const exists = await readDB(c.env).prepare('SELECT id FROM videos WHERE slug = ?').bind(slug).first();
  if (!exists) return c.json({ error: 'Not found' }, 404);
  await writeDB(c.env).prepare('UPDATE videos SET likes = likes + 1 WHERE slug = ?').bind(slug).run();
  const video = await readDB(c.env).prepare('SELECT likes FROM videos WHERE slug = ?').bind(slug).first();
  return c.json({ likes: video?.likes || 0 });
});

api.post('/api/videos/:slug/comments', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Sign in to comment' }, 401);
  if (!await rateLimit(c.env, 'comment:' + user.id, 10, 60)) return c.json({ error: 'Too many comments, slow down' }, 429);
  const slug = c.req.param('slug');
  const db = readDB(c.env);
  const video = await db.prepare('SELECT id FROM videos WHERE slug = ?').bind(slug).first();
  if (!video) return c.json({ error: 'Not found' }, 404);
  const body = await c.req.json();
  const content = (body.content || '').trim();
  if (!content || content.length > 2000) return c.json({ error: 'Invalid' }, 400);
  const wdb = writeDB(c.env);
  const r = await wdb.prepare('INSERT INTO comments (video_id, author, content, user_id) VALUES (?, ?, ?, ?)').bind(video.id, user.name, content, user.id).run();
  const comment = await wdb.prepare('SELECT * FROM comments WHERE id = ?').bind(r.meta.last_row_id).first();
  // Invalidate comments cache
  c.executionCtx.waitUntil(c.env.CACHE.delete('comments:' + slug));
  return c.json({ comment }, 201);
});

// VTT conversion (SRT -> WebVTT for native players, KV cached)
api.get('/api/vtt/*', async (c) => {
  const key = c.req.path.replace('/api/vtt/', '');
  const cacheKey = 'vtt:' + key;
  // Try KV cache first (v2 = with STYLE block)
  let vtt = await c.env.CACHE.get(cacheKey + ':v6');
  if (!vtt) {
    const obj = await c.env.MEDIA_BUCKET.get(key);
    if (!obj) return c.text('Not found', 404);
    const srt = await obj.text();
    vtt = 'WEBVTT\n\n' + srt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    c.executionCtx.waitUntil(c.env.CACHE.put(cacheKey + ':v6', vtt, { expirationTtl: 86400 }));
  }
  return new Response(vtt, {
    headers: {
      'Content-Type': 'text/vtt; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=2592000, immutable',
    },
  });
});

// Serve thumbnails + scholar photos from KV (globally replicated, ~10-50ms)
// Edge-cached via Cache API → subsequent requests at same PoP = ~5ms
// All images served as AVIF (universal browser support since 2022)
api.get('/img/*', async (c) => {
  const key = c.req.path.slice(5); // strip '/img/'
  if (!key) return c.text('Not found', 404);

  // Check CF edge cache first (fastest path)
  const cacheKey = new Request(c.req.url);
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const headers = {
    'Content-Type': 'image/avif',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Access-Control-Allow-Origin': '*',
  };

  // Try KV
  const { value, metadata } = await c.env.MEDIA_KV.getWithMetadata(key, 'arrayBuffer');
  if (value) {
    headers['Content-Type'] = metadata?.ct || 'image/avif';
    const resp = new Response(value, { headers });
    c.executionCtx.waitUntil(cache.put(cacheKey, resp.clone()));
    return resp;
  }

  // KV miss — try R2, then fall back to WebP variant during transition
  let obj = await c.env.MEDIA_BUCKET.get(key);
  if (!obj && key.endsWith('.avif')) {
    const webpKey = key.replace('.avif', '.webp');
    obj = await c.env.MEDIA_BUCKET.get(webpKey);
  }
  if (!obj) return c.text('Not found', 404);
  const body = await obj.arrayBuffer();
  headers['Content-Type'] = obj.httpMetadata?.contentType || 'image/avif';

  c.executionCtx.waitUntil(Promise.all([
    c.env.MEDIA_KV.put(key, body, { metadata: { ct: headers['Content-Type'] } }),
    cache.put(cacheKey, new Response(body, { headers })),
  ]));

  return new Response(body, { headers });
});

// R2 Media
api.get('/api/media/*', async (c) => {
  const key = c.req.path.replace('/api/media/', '');
  const rangeH = c.req.header('Range');
  let obj;
  if (rangeH) {
    const m = rangeH.match(/bytes=(\d+)-(\d*)/);
    if (m) {
      const offset = parseInt(m[1]);
      const end = m[2] ? parseInt(m[2]) : undefined;
      obj = await c.env.MEDIA_BUCKET.get(key, { range: { offset, length: end !== undefined ? end - offset + 1 : undefined } });
    }
  }
  if (!obj) obj = await c.env.MEDIA_BUCKET.get(key);
  if (!obj) return c.text('Not found', 404);
  const h = new Headers();
  obj.writeHttpMetadata(h);
  h.set('Accept-Ranges', 'bytes');
  h.set('Cache-Control', 'public, max-age=86400');
  if (rangeH && obj.range) {
    const { offset, length } = obj.range;
    h.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    h.set('Content-Length', String(length));
    return new Response(obj.body, { status: 206, headers: h });
  }
  h.set('Content-Length', String(obj.size));
  return new Response(obj.body, { headers: h });
});

// Get comments for a video (KV cached 30s)
api.get('/api/videos/:slug/comments', async (c) => {
  const slug = c.req.param('slug');
  const cacheKey = 'comments:' + slug;
  let cached = null;
  try { cached = await c.env.CACHE.get(cacheKey, 'json'); } catch {}
  if (cached) return c.json(cached);
  const db = readDB(c.env);
  const video = await db.prepare('SELECT id FROM videos WHERE slug = ?').bind(slug).first();
  if (!video) return c.json({ comments: [] });
  const comments = (await db.prepare('SELECT c.*, u.avatar as user_avatar FROM comments c LEFT JOIN users u ON c.user_id = u.id WHERE c.video_id = ? ORDER BY c.created_at DESC LIMIT 200').bind(video.id).all()).results;
  const result = { comments };
  c.executionCtx.waitUntil(c.env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 30 }));
  return c.json(result);
});

// Get related videos
api.get('/api/videos/:slug/related', async (c) => {
  const { getRelatedVideos } = await import('../lib/kv-cache.js');
  const slug = c.req.param('slug');
  const db = readDB(c.env);
  const video = await db.prepare('SELECT id, category_id FROM videos WHERE slug = ?').bind(slug).first();
  if (!video) return c.json({ videos: [] });
  const videos = await getRelatedVideos(c.env, video.id, video.category_id);
  return c.json({ videos });
});

// Search autocomplete
api.get('/api/search/suggest', async (c) => {
  const q = (c.req.query('q') || '').trim();
  if (!q || q.length < 2) return c.json({ results: [] });
  const data = await getSearchSuggestions(c.env, q);
  return c.json(data);
});

// Watch event tracking via Analytics Engine (sendBeacon)
api.post('/api/watch-event', async (c) => {
  try {
    const text = await c.req.text();
    const data = JSON.parse(text || '{}');
    try {
      c.env.ANALYTICS.writeDataPoint({
        indexes: [data.slug || 'unknown'],
        blobs: ['watch_event', data.type || '', data.slug || ''],
        doubles: [data.pos || 0, data.dur || 0],
      });
    } catch {}
  } catch {}
  return new Response(null, { status: 204 });
});

// Device fingerprint collection
api.post('/api/fingerprint', async (c) => {
  try {
    const ip = c.req.header('CF-Connecting-IP') || '';
    if (!await rateLimit(c.env, 'fp:' + ip, 5, 3600)) return c.json({ id: '' });
    const data = await c.req.json();
    const country = c.req.header('CF-IPCountry') || '';
    const city = c.req.header('CF-IPCity') || '';
    const ua = (c.req.header('User-Agent') || '').slice(0, 300);
    const user = c.get('user');

    // Parse user agent for device/browser/OS
    const isM = /Mobile|Android|iPhone|iPad/i.test(ua);
    const deviceType = /iPad|Tablet/i.test(ua) ? 'tablet' : isM ? 'mobile' : 'desktop';
    const os = /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'macOS' : /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Linux/i.test(ua) ? 'Linux' : 'Other';
    const browser = /Edg/i.test(ua) ? 'Edge' : /Chrome/i.test(ua) ? 'Chrome' : /Firefox/i.test(ua) ? 'Firefox' : /Safari/i.test(ua) ? 'Safari' : 'Other';

    // Generate fingerprint ID from stable attributes
    const raw = `${ip}|${ua}|${data.sw}x${data.sh}|${data.gpu}|${data.tz}|${data.cores}|${data.plt}`;
    const encoder = new TextEncoder();
    const hashBuf = await crypto.subtle.digest('SHA-256', encoder.encode(raw));
    const hashArr = Array.from(new Uint8Array(hashBuf));
    const fpId = hashArr.slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');

    // Queue the D1 write (don't block response)
    c.executionCtx.waitUntil(c.env.TASKS.send({
      type: 'fingerprint',
      fpId, userId: user?.id || null, ip, country, city: city || '', ua, deviceType, os, browser,
      sw: data.sw || 0, sh: data.sh || 0, gpu: (data.gpu || '').slice(0, 200),
      tz: data.tz || '', lang: data.lang || '', cores: data.cores || 0, mem: data.mem || 0, touch: data.touch || 0,
    }));

    return c.json({ id: fpId });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

export default api;
