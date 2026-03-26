import { Hono } from 'hono';
import { VIDEO_COLS, VIDEO_JOIN, readDB, writeDB } from '../lib/db.js';
import { getSearchSuggestions } from '../lib/kv-cache.js';

const api = new Hono();

const VC = VIDEO_COLS;
const VJ = VIDEO_JOIN;

api.get('/api/videos', async (c) => {
  const videos = (await readDB(c.env).prepare(`SELECT ${VC} ${VJ} ORDER BY v.created_at DESC LIMIT 100`).all()).results;
  return c.json({ videos });
});

api.post('/api/videos/:slug/like', async (c) => {
  const slug = c.req.param('slug');
  await writeDB(c.env).prepare('UPDATE videos SET likes = likes + 1 WHERE slug = ?').bind(slug).run();
  const video = await readDB(c.env).prepare('SELECT likes FROM videos WHERE slug = ?').bind(slug).first();
  return c.json({ likes: video?.likes || 0 });
});

api.post('/api/videos/:slug/comments', async (c) => {
  const slug = c.req.param('slug');
  const db = readDB(c.env);
  const video = await db.prepare('SELECT id FROM videos WHERE slug = ?').bind(slug).first();
  if (!video) return c.json({ error: 'Not found' }, 404);
  const body = await c.req.json();
  const author = (body.author || '').trim();
  const content = (body.content || '').trim();
  if (!author || !content || author.length > 100 || content.length > 2000) return c.json({ error: 'Invalid' }, 400);
  const wdb = writeDB(c.env);
  const r = await wdb.prepare('INSERT INTO comments (video_id, author, content) VALUES (?, ?, ?)').bind(video.id, author, content).run();
  const comment = await wdb.prepare('SELECT * FROM comments WHERE id = ?').bind(r.meta.last_row_id).first();
  return c.json({ comment }, 201);
});

// VTT conversion (SRT -> WebVTT for native players)
api.get('/api/vtt/*', async (c) => {
  const key = c.req.path.replace('/api/vtt/', '');
  const obj = await c.env.MEDIA_BUCKET.get(key);
  if (!obj) return c.text('Not found', 404);
  const srt = await obj.text();
  const vtt = 'WEBVTT\n\n' + srt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return new Response(vtt, {
    headers: {
      'Content-Type': 'text/vtt; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=86400',
    },
  });
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

// Get comments for a video
api.get('/api/videos/:slug/comments', async (c) => {
  const slug = c.req.param('slug');
  const db = readDB(c.env);
  const video = await db.prepare('SELECT id FROM videos WHERE slug = ?').bind(slug).first();
  if (!video) return c.json({ comments: [] });
  const comments = (await db.prepare('SELECT * FROM comments WHERE video_id = ? ORDER BY created_at DESC LIMIT 200').bind(video.id).all()).results;
  return c.json({ comments });
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

// Watch event tracking (sendBeacon)
api.post('/api/watch-event', async (c) => {
  try {
    const text = await c.req.text();
    const data = JSON.parse(text);
    const user = c.get('user');
    c.executionCtx.waitUntil(
      writeDB(c.env).prepare(
        'INSERT INTO watch_events (video_slug, fingerprint_id, user_id, event_type, position, duration, buffered, connection, bandwidth) VALUES (?,?,?,?,?,?,?,?,?)'
      ).bind(
        data.slug || '', data.fp || null, user?.id || null,
        data.type || '', data.pos || 0, data.dur || 0, data.buf || 0,
        data.conn || '', data.bw || 0
      ).run()
    );
    return new Response('ok', { status: 204 });
  } catch { return new Response('ok', { status: 204 }); }
});

// Device fingerprint collection
api.post('/api/fingerprint', async (c) => {
  try {
    const data = await c.req.json();
    const ip = c.req.header('CF-Connecting-IP') || '';
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

    const db = readDB(c.env);
    const existing = await db.prepare('SELECT id, visit_count FROM fingerprints WHERE id = ?').bind(fpId).first();

    if (existing) {
      await db.prepare("UPDATE fingerprints SET last_seen = datetime('now'), visit_count = visit_count + 1, user_id = COALESCE(?, user_id) WHERE id = ?")
        .bind(user?.id || null, fpId).run();
    } else {
      await db.prepare(
        'INSERT INTO fingerprints (id, user_id, ip, country, city, user_agent, device_type, os, browser, screen_w, screen_h, gpu, timezone, language, cores, memory, touch) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
      ).bind(fpId, user?.id || null, ip, country, city || '', ua, deviceType, os, browser, data.sw || 0, data.sh || 0, (data.gpu || '').slice(0, 200), data.tz || '', data.lang || '', data.cores || 0, data.mem || 0, data.touch || 0).run();
    }

    return c.json({ id: fpId });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

export default api;
