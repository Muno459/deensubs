// DeenSubs Admin worker — JSON API for admin.deensubs.com
// Static SPA is served by the assets binding; this handles /api/*.
// Shares D1 / KV / R2 with the main deensubs worker.

import { Hono } from 'hono';
// Reuse the main worker's Analytics Engine helpers (single source of truth)
// @ts-ignore — plain JS module from the parent project
import { queryAE, Q } from '../../../src/lib/analytics.js';

type Env = {
  DB: D1Database;
  CACHE: KVNamespace;
  MEDIA_KV: KVNamespace;
  MEDIA_BUCKET: R2Bucket;
  ASSETS: Fetcher;
  SCRIBE_WORKFLOW: Workflow;
  CLIP_WORKFLOW: Workflow;
  YTDLP: DurableObjectNamespace;
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  ADMIN_KEY?: string;
  AI_API_KEY?: string;
  AI_BASE_URL?: string;
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
  ELEVENLABS_API_KEY?: string;
  SCRIBE_LLM_URL?: string;
  SCRIBE_LLM_KEY?: string;
  SCRIBE_LLM_MODEL?: string;
  YTDLP_TOKEN?: string;
  YTDLP_PROXIES?: string;
};

type User = { id: number; name: string; email: string; avatar: string; role: string; created_at: string };

const VIDEO_COLS = 'v.*, c.name as category_name, c.slug as category_slug, c.color as category_color, s.name as scholar_name';
const VIDEO_JOIN = 'FROM videos v LEFT JOIN categories c ON v.category_id = c.id LEFT JOIN scholars s ON v.scholar_id = s.id';

const app = new Hono<{ Bindings: Env; Variables: { user: User | null } }>();

// ---- Auth ----

function getCookie(c: any, name: string): string | null {
  const cookies = c.req.header('Cookie') || '';
  const match = cookies.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return match ? match[1] : null;
}

async function getUser(c: any): Promise<User | null> {
  const sid = getCookie(c, 'sid');
  if (!sid) return null;
  const cacheKey = 'session:' + sid;
  try {
    const cached = await c.env.CACHE.get(cacheKey, 'json');
    if (cached) return cached as User;
  } catch {}
  const session = await c.env.DB.prepare(
    "SELECT s.*, u.id as uid, u.name, u.email, u.avatar, u.role, u.created_at as user_created FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = ? AND s.expires_at > datetime('now')"
  ).bind(sid).first();
  if (!session) return null;
  const user: User = {
    id: session.uid as number, name: session.name as string, email: session.email as string,
    avatar: session.avatar as string, role: (session.role as string) || 'user', created_at: session.user_created as string,
  };
  try { await c.env.CACHE.put(cacheKey, JSON.stringify(user), { expirationTtl: 300 }); } catch {}
  return user;
}

app.use('/api/*', async (c, next) => {
  const key = c.req.query('key');
  if (key && c.env.ADMIN_KEY && key === c.env.ADMIN_KEY) {
    c.set('user', { id: 0, name: 'API Key', email: '', avatar: '', role: 'admin', created_at: '' });
    return next();
  }
  const user = await getUser(c);
  c.set('user', user);
  if (c.req.path === '/api/me') return next();
  if (!user || user.role !== 'admin') return c.json({ error: 'Unauthorized' }, 401);
  return next();
});

app.get('/api/me', (c) => {
  const user = c.get('user');
  if (!user) return c.json({ user: null }, 401);
  return c.json({ user, admin: user.role === 'admin' });
});

// ---- Overview (dashboard) ----

app.get('/api/overview', async (c) => {
  const db = c.env.DB;
  const [stats, dailyHits, topVideos, topPages, countries, recentComments, recentVideos] = await Promise.all([
    db.prepare('SELECT (SELECT COUNT(*) FROM videos) as video_count, (SELECT COUNT(*) FROM users) as user_count, (SELECT COUNT(*) FROM comments) as comment_count, (SELECT SUM(views) FROM videos) as total_views, (SELECT SUM(likes) FROM videos) as total_likes, (SELECT COUNT(*) FROM watch_events) as watch_events, (SELECT COUNT(DISTINCT country) FROM fingerprints) as countries').first(),
    db.prepare("SELECT DATE(created_at) as day, COUNT(*) as hits FROM analytics WHERE created_at > datetime('now', '-14 days') GROUP BY day ORDER BY day ASC").all(),
    db.prepare(`SELECT v.title, v.slug, v.thumb_key, v.views, v.likes, v.duration ${VIDEO_JOIN} ORDER BY v.views DESC LIMIT 8`).all(),
    db.prepare("SELECT path, COUNT(*) as hits FROM analytics WHERE type='pageview' GROUP BY path ORDER BY hits DESC LIMIT 10").all(),
    db.prepare("SELECT country, COUNT(*) as hits FROM analytics WHERE country != '' GROUP BY country ORDER BY hits DESC LIMIT 12").all(),
    db.prepare('SELECT c.id, c.content, c.created_at, u.name as user_name, u.avatar as user_avatar, v.title as video_title, v.slug as video_slug FROM comments c LEFT JOIN users u ON c.user_id = u.id LEFT JOIN videos v ON c.video_id = v.id ORDER BY c.created_at DESC LIMIT 6').all(),
    db.prepare(`SELECT v.id, v.title, v.slug, v.thumb_key, v.views, v.created_at ${VIDEO_JOIN} ORDER BY v.created_at DESC LIMIT 5`).all(),
  ]);
  const [scribeJobs, recentClips, spend] = await Promise.all([
    db.prepare('SELECT id, title, url, status, step, duration, cue_count, asr_seconds, llm_tokens, created_at FROM scribe_jobs ORDER BY created_at DESC LIMIT 6').all(),
    db.prepare('SELECT cl.id, cl.hook, cl.status, cl.start, cl.end, cl.r2_key, cl.created_at, j.title as job_title FROM clips cl LEFT JOIN scribe_jobs j ON cl.job_id = j.id ORDER BY cl.created_at DESC LIMIT 4').all(),
    db.prepare("SELECT COALESCE(SUM(asr_seconds),0) as asr, COALESCE(SUM(llm_tokens),0) as tokens, COUNT(*) as jobs FROM scribe_jobs WHERE created_at > datetime('now','start of month')").first(),
  ]);
  return c.json({
    stats,
    dailyHits: dailyHits.results,
    topVideos: topVideos.results,
    topPages: topPages.results,
    countries: countries.results,
    recentComments: recentComments.results,
    recentVideos: recentVideos.results,
    scribeJobs: scribeJobs.results,
    recentClips: recentClips.results,
    spend,
  });
});

// ---- Analytics (D1) ----

app.get('/api/analytics', async (c) => {
  const db = c.env.DB;
  const [dailyHits, topPages, topVideos, referers, agents] = await Promise.all([
    db.prepare("SELECT DATE(created_at) as day, COUNT(*) as hits FROM analytics WHERE created_at > datetime('now', '-30 days') GROUP BY day ORDER BY day ASC").all(),
    db.prepare("SELECT path, COUNT(*) as hits FROM analytics WHERE type='pageview' GROUP BY path ORDER BY hits DESC LIMIT 25").all(),
    db.prepare("SELECT slug, COUNT(*) as hits FROM analytics WHERE type='watch' AND slug IS NOT NULL GROUP BY slug ORDER BY hits DESC LIMIT 20").all(),
    db.prepare("SELECT referer, COUNT(*) as hits FROM analytics WHERE referer != '' GROUP BY referer ORDER BY hits DESC LIMIT 20").all(),
    db.prepare('SELECT user_agent, COUNT(*) as hits FROM analytics GROUP BY user_agent ORDER BY hits DESC LIMIT 20').all(),
  ]);
  return c.json({ dailyHits: dailyHits.results, topPages: topPages.results, topVideos: topVideos.results, referers: referers.results, agents: agents.results });
});

// Analytics Engine (real-time) summary for dashboard
app.get('/api/realtime', async (c) => {
  if (!c.env.CF_API_TOKEN || !c.env.CF_ACCOUNT_ID) return c.json({ unavailable: true });
  try {
    const [traffic, live, daily] = await Promise.all([
      queryAE(c.env, Q.realtimeTraffic()),
      queryAE(c.env, Q.liveVisitors()),
      queryAE(c.env, Q.dailyTraffic(14)),
    ]);
    return c.json({ traffic: traffic.data || [], live: live.data || [], daily: daily.data || [] });
  } catch (e: any) {
    return c.json({ unavailable: true, error: e.message });
  }
});

// ---- Meta (categories + scholars) ----

app.get('/api/meta', async (c) => {
  const db = c.env.DB;
  const [cats, scholars] = await Promise.all([
    db.prepare('SELECT * FROM categories ORDER BY name').all(),
    db.prepare('SELECT * FROM scholars ORDER BY name').all(),
  ]);
  return c.json({ categories: cats.results, scholars: scholars.results });
});

// ---- Videos ----

app.get('/api/videos', async (c) => {
  const videos = await c.env.DB.prepare(`SELECT ${VIDEO_COLS} ${VIDEO_JOIN} ORDER BY v.created_at DESC`).all();
  return c.json({ videos: videos.results });
});

app.post('/api/videos', async (c) => {
  const b = await c.req.json();
  await c.env.DB.prepare(
    'INSERT INTO videos (title, title_ar, slug, description, category_id, scholar_id, source, duration, video_key, srt_key, srt_ar_key, thumb_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(b.title, b.title_ar || null, b.slug, b.description || null, parseInt(b.category_id) || null, parseInt(b.scholar_id) || null, b.source || null, parseInt(b.duration) || 0, b.video_key, b.srt_key || null, b.srt_ar_key || null, b.thumb_key || null).run();
  return c.json({ ok: true });
});

app.put('/api/videos/:id', async (c) => {
  const b = await c.req.json();
  await c.env.DB.prepare(
    'UPDATE videos SET title=?, title_ar=?, slug=?, description=?, category_id=?, scholar_id=?, source=?, duration=?, video_key=?, srt_key=?, srt_ar_key=?, thumb_key=? WHERE id=?'
  ).bind(b.title, b.title_ar || null, b.slug, b.description || null, parseInt(b.category_id) || null, parseInt(b.scholar_id) || null, b.source || null, parseInt(b.duration) || 0, b.video_key, b.srt_key || null, b.srt_ar_key || null, b.thumb_key || null, parseInt(c.req.param('id'))).run();
  return c.json({ ok: true });
});

app.delete('/api/videos/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM videos WHERE id = ?').bind(parseInt(c.req.param('id'))).run();
  return c.json({ ok: true });
});

// ---- Scholars ----

app.post('/api/scholars', async (c) => {
  const b = await c.req.json();
  await c.env.DB.prepare('INSERT INTO scholars (name, slug, title, bio, photo, photo_hero) VALUES (?,?,?,?,?,?)')
    .bind(b.name, b.slug, b.title || null, b.bio || null, b.photo || null, b.photo_hero || null).run();
  return c.json({ ok: true });
});

// ---- Comments ----

app.get('/api/comments', async (c) => {
  const comments = await c.env.DB.prepare(
    'SELECT c.*, u.name as user_name, u.avatar as user_avatar, v.title as video_title, v.slug as video_slug FROM comments c LEFT JOIN users u ON c.user_id = u.id LEFT JOIN videos v ON c.video_id = v.id ORDER BY c.created_at DESC LIMIT 200'
  ).all();
  return c.json({ comments: comments.results });
});

app.delete('/api/comments/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(parseInt(c.req.param('id'))).run();
  return c.json({ ok: true });
});

app.post('/api/comments/bulk-delete', async (c) => {
  const { ids } = await c.req.json();
  if (!ids?.length) return c.json({ error: 'No IDs' }, 400);
  for (const id of ids) await c.env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(id).run();
  return c.json({ deleted: ids.length });
});

// ---- Users ----

app.get('/api/users', async (c) => {
  const users = await c.env.DB.prepare(
    'SELECT u.id, u.name, u.email, u.avatar, u.role, u.created_at, (SELECT COUNT(*) FROM comments WHERE user_id = u.id) as comment_count FROM users u ORDER BY u.created_at DESC'
  ).all();
  return c.json({ users: users.results });
});

app.post('/api/users/:id/role', async (c) => {
  const { role } = await c.req.json();
  if (!['user', 'admin'].includes(role)) return c.json({ error: 'Invalid role' }, 400);
  await c.env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, parseInt(c.req.param('id'))).run();
  return c.json({ ok: true });
});

app.get('/api/users/:id/journey', async (c) => {
  const uid = parseInt(c.req.param('id'));
  const db = c.env.DB;
  const [user, pages, comments, searches] = await Promise.all([
    db.prepare('SELECT id, name, email, avatar, role, created_at FROM users WHERE id = ?').bind(uid).first(),
    db.prepare('SELECT path, created_at FROM analytics WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').bind(uid).all(),
    db.prepare('SELECT c.*, v.title as video_title FROM comments c LEFT JOIN videos v ON c.video_id = v.id WHERE c.user_id = ? ORDER BY c.created_at DESC').bind(uid).all(),
    db.prepare('SELECT * FROM search_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').bind(uid).all(),
  ]);
  return c.json({ user, pages: pages.results, comments: comments.results, searches: searches.results });
});

// ---- Searches ----

app.get('/api/searches', async (c) => {
  const db = c.env.DB;
  const [top, zero] = await Promise.all([
    db.prepare('SELECT query, MAX(results) as results, COUNT(*) as times FROM search_logs GROUP BY query ORDER BY times DESC LIMIT 50').all(),
    db.prepare('SELECT query, COUNT(*) as times FROM search_logs WHERE results = 0 GROUP BY query ORDER BY times DESC LIMIT 25').all(),
  ]);
  return c.json({ top: top.results, zero: zero.results });
});

// ---- Visitors ----

app.get('/api/visitors', async (c) => {
  const visitors = await c.env.DB.prepare(
    'SELECT f.*, u.name as user_name, u.email as user_email, u.avatar as user_avatar FROM fingerprints f LEFT JOIN users u ON f.user_id = u.id ORDER BY f.last_seen DESC LIMIT 100'
  ).all();
  return c.json({ visitors: visitors.results });
});

app.get('/api/visitors/:id', async (c) => {
  const fpId = c.req.param('id');
  const db = c.env.DB;
  const [fp, watchEvents, user, pages] = await Promise.all([
    db.prepare('SELECT * FROM fingerprints WHERE id = ?').bind(fpId).first(),
    db.prepare('SELECT video_slug, event_type, position, duration, created_at FROM watch_events WHERE fingerprint_id = ? ORDER BY created_at DESC LIMIT 50').bind(fpId).all(),
    db.prepare('SELECT u.id, u.name, u.email, u.avatar FROM users u JOIN fingerprints f ON u.id = f.user_id WHERE f.id = ?').bind(fpId).first(),
    db.prepare('SELECT path, slug, created_at FROM analytics WHERE ip = (SELECT ip FROM fingerprints WHERE id = ?) ORDER BY created_at DESC LIMIT 60').bind(fpId).all(),
  ]);
  const slugs = [...new Set((watchEvents.results || []).map((w: any) => w.video_slug).filter(Boolean))];
  const videoMap: Record<string, string> = {};
  if (slugs.length) {
    const vids = await db.prepare(`SELECT slug, title FROM videos WHERE slug IN (${slugs.map(() => '?').join(',')})`).bind(...slugs).all();
    for (const v of vids.results as any[]) videoMap[v.slug] = v.title;
  }
  return c.json({ fingerprint: fp, watchEvents: watchEvents.results, user, pages: pages.results, videoMap });
});

// ---- Watch analytics ----

app.get('/api/watch', async (c) => {
  const db = c.env.DB;
  const [events, completion, topWatched, connections, bufferIssues] = await Promise.all([
    db.prepare('SELECT event_type, COUNT(*) as count FROM watch_events GROUP BY event_type ORDER BY count DESC').all(),
    db.prepare("SELECT video_slug, COUNT(DISTINCT fingerprint_id) as viewers, COUNT(*) as events, ROUND(AVG(CASE WHEN duration>0 THEN position*100.0/duration ELSE 0 END),1) as avg_pct FROM watch_events GROUP BY video_slug ORDER BY viewers DESC LIMIT 25").all(),
    db.prepare('SELECT video_slug, COUNT(DISTINCT fingerprint_id) as unique_viewers, COUNT(*) as events FROM watch_events GROUP BY video_slug ORDER BY unique_viewers DESC LIMIT 20').all(),
    db.prepare("SELECT connection, COUNT(*) as count FROM watch_events WHERE connection != '' GROUP BY connection ORDER BY count DESC").all(),
    db.prepare('SELECT video_slug, ROUND(AVG(buffered),1) as avg_buffer, COUNT(*) as events FROM watch_events WHERE buffered > 0 GROUP BY video_slug ORDER BY avg_buffer ASC LIMIT 10').all(),
  ]);
  // Resolve titles
  const slugs = [...new Set((completion.results as any[]).map((r) => r.video_slug).filter(Boolean))];
  const videoMap: Record<string, string> = {};
  if (slugs.length) {
    const vids = await db.prepare(`SELECT slug, title FROM videos WHERE slug IN (${slugs.map(() => '?').join(',')})`).bind(...slugs).all();
    for (const v of vids.results as any[]) videoMap[v.slug] = v.title;
  }
  return c.json({ events: events.results, completion: completion.results, topWatched: topWatched.results, connections: connections.results, bufferIssues: bufferIssues.results, videoMap });
});

// ---- SQL console ----

app.post('/api/sql', async (c) => {
  const { query } = await c.req.json();
  if (!query) return c.json({ error: 'No query' }, 400);
  if (!query.trim().toLowerCase().startsWith('select')) return c.json({ error: 'Only SELECT queries allowed' }, 403);
  try {
    const result = await c.env.DB.prepare(query).all();
    const user = c.get('user');
    c.executionCtx.waitUntil(
      c.env.DB.prepare('INSERT INTO admin_logs (admin_id, action, target, details) VALUES (?, ?, ?, ?)')
        .bind(user?.id || 0, 'sql_query', 'database', query.slice(0, 500)).run()
    );
    return c.json({ results: result.results, meta: result.meta });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

app.post('/api/ae', async (c) => {
  const { query } = await c.req.json();
  if (!query) return c.json({ error: 'No query' }, 400);
  if (!c.env.CF_API_TOKEN || !c.env.CF_ACCOUNT_ID) return c.json({ error: 'Analytics Engine credentials not configured' }, 400);
  try {
    const result = await queryAE(c.env, query);
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// ---- R2 browser ----

app.get('/api/r2', async (c) => {
  const prefix = c.req.query('prefix') || '';
  const cursor = c.req.query('cursor') || undefined;
  const listed = await c.env.MEDIA_BUCKET.list({ prefix, limit: 100, cursor });
  return c.json({
    objects: listed.objects.map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded })),
    truncated: listed.truncated,
    cursor: listed.truncated ? (listed as any).cursor : null,
  });
});

// ---- Tools ----

app.post('/api/purge-cache', async (c) => {
  const keys = await c.env.CACHE.list();
  let deleted = 0;
  for (const key of keys.keys) { await c.env.CACHE.delete(key.name); deleted++; }
  const user = c.get('user');
  c.executionCtx.waitUntil(
    c.env.DB.prepare('INSERT INTO admin_logs (admin_id, action, target, details) VALUES (?, ?, ?, ?)')
      .bind(user?.id || 0, 'purge_cache', 'kv', `Purged ${deleted} keys`).run()
  );
  return c.json({ deleted });
});

app.get('/api/export/videos', async (c) => {
  const videos = (await c.env.DB.prepare('SELECT * FROM videos ORDER BY id').all()).results as any[];
  const csv = 'id,title,slug,category_id,source,views,likes,duration,created_at\n' +
    videos.map((v) => `${v.id},"${(v.title || '').replace(/"/g, '""')}",${v.slug},${v.category_id},"${(v.source || '').replace(/"/g, '""')}",${v.views},${v.likes},${v.duration},"${v.created_at}"`).join('\n');
  return new Response(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=deensubs-videos.csv' } });
});

app.get('/api/export/users', async (c) => {
  const users = (await c.env.DB.prepare('SELECT id,name,email,role,created_at FROM users ORDER BY id').all()).results as any[];
  const csv = 'id,name,email,role,created_at\n' +
    users.map((u) => `${u.id},"${(u.name || '').replace(/"/g, '""')}",${u.email},${u.role},"${u.created_at}"`).join('\n');
  return new Response(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=deensubs-users.csv' } });
});

app.get('/api/admin-logs', async (c) => {
  const logs = await c.env.DB.prepare(
    'SELECT l.*, u.name as admin_name FROM admin_logs l LEFT JOIN users u ON l.admin_id = u.id ORDER BY l.created_at DESC LIMIT 50'
  ).all();
  return c.json({ logs: logs.results });
});

// ---- Scribe pipeline (download → ASR → translate → SRT) ----

function genJobId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  const arr = new Uint8Array(12);
  crypto.getRandomValues(arr);
  for (const b of arr) id += chars[b % chars.length];
  return id;
}

// yt-dlp cookies (cookies.txt) — stored in R2, sent to the VPS per download
const COOKIES_KEY = 'scribe/config/cookies.txt';

app.get('/api/scribe/cookies', async (c) => {
  const obj = await c.env.MEDIA_BUCKET.get(COOKIES_KEY);
  if (!obj) return c.json({ set: false });
  const text = await obj.text();
  const lines = text.split('\n').filter((l) => l.trim() && !l.startsWith('#')).length;
  return c.json({ set: lines > 0, lines, updated: obj.uploaded, bytes: text.length });
});

app.put('/api/scribe/cookies', async (c) => {
  const { cookies } = await c.req.json();
  if (typeof cookies !== 'string' || !cookies.trim()) return c.json({ error: 'cookies text required' }, 400);
  if (cookies.length > 512 * 1024) return c.json({ error: 'cookies file too large' }, 400);
  await c.env.MEDIA_BUCKET.put(COOKIES_KEY, cookies, {
    httpMetadata: { contentType: 'text/plain; charset=utf-8' },
  });
  const lines = cookies.split('\n').filter((l) => l.trim() && !l.startsWith('#')).length;
  return c.json({ ok: true, lines });
});

app.delete('/api/scribe/cookies', async (c) => {
  await c.env.MEDIA_BUCKET.delete(COOKIES_KEY);
  return c.json({ ok: true });
});

type JobIdentity = { title?: string; channel?: string; thumb_url?: string };

async function createScribeJob(env: Env, url: string, targetLangs: string[], fullVideo: boolean, ident: JobIdentity = {}) {
  const id = genJobId();
  const primary = targetLangs[0] || 'en';
  await env.DB.prepare('INSERT INTO scribe_jobs (id, url, target_lang, target_langs, full_video, status, step, title, channel, thumb_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, url, primary, JSON.stringify(targetLangs), fullVideo ? 1 : 0, 'queued', 'queued',
      ident.title || null, ident.channel || null, ident.thumb_url || null).run();
  await env.SCRIBE_WORKFLOW.create({ id, params: { jobId: id, url, targetLang: primary, targetLangs, fullVideo } });
  return id;
}

/** YouTube video id from any of its URL shapes. */
function ytId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?[^#]*v=|youtu\.be\/|youtube\.com\/(?:shorts|live|embed)\/)([\w-]{11})/);
  return m ? m[1] : null;
}

// Pre-flight probe: identity (oEmbed, instant) + duration/cost (container)
// + duplicate detection. The composer calls this on paste.
app.post('/api/scribe/probe', async (c) => {
  const { url, deep } = await c.req.json();
  if (!url || !/^https?:\/\//.test(url)) return c.json({ error: 'valid url required' }, 400);
  const out: any = { url };

  const vid = ytId(url);
  out.path = vid || /(youtube\.com|youtu\.be|twitter\.com|x\.com|facebook\.com|instagram\.com|tiktok\.com|vimeo\.com)\//i.test(url)
    ? 'yt-dlp' : 'direct';

  // Duplicate check (by yt id when available, else exact URL)
  const dup: any = vid
    ? await c.env.DB.prepare("SELECT id, title, status FROM scribe_jobs WHERE url LIKE ? ORDER BY created_at DESC LIMIT 1").bind(`%${vid}%`).first()
    : await c.env.DB.prepare('SELECT id, title, status FROM scribe_jobs WHERE url = ? ORDER BY created_at DESC LIMIT 1').bind(url).first();
  if (dup) out.duplicate = dup;

  if (vid) {
    // oEmbed: instant title/channel/thumbnail, no key needed
    try {
      const oe = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, {
        signal: AbortSignal.timeout(4000),
      });
      if (oe.ok) {
        const d: any = await oe.json();
        out.title = d.title;
        out.channel = d.author_name;
        out.thumb_url = d.thumbnail_url;
      }
    } catch {}
    if (!out.thumb_url) out.thumb_url = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
  } else if (out.path === 'direct') {
    // Cheap HEAD for size/type
    try {
      const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(4000) });
      out.bytes = parseInt(head.headers.get('content-length') || '0') || undefined;
      out.content_type = head.headers.get('content-type') || undefined;
    } catch {}
  }

  // Deep probe (duration → cost) via the container, on request
  if (deep) {
    try {
      const { getContainer } = await import('@cloudflare/containers');
      const container = getContainer(c.env.YTDLP as any, 'enum');
      const cookiesObj = await c.env.MEDIA_BUCKET.get(COOKIES_KEY);
      const res = await container.fetch(new Request('http://ytdlp/probe', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + (c.env.YTDLP_TOKEN || 'internal'), 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, cookies: cookiesObj ? await cookiesObj.text() : null }),
      }));
      if (res.ok) {
        const d: any = await res.json();
        if (!d.error) {
          out.title = out.title || d.title;
          out.channel = out.channel || d.channel;
          out.thumb_url = out.thumb_url || d.thumbnail;
          out.duration = d.duration;
          if (d.duration) {
            out.est_cost = Math.round(((d.duration / 3600) * 0.4 + (d.duration * 450 / 1e6) * 0.4) * 100) / 100;
          }
        }
      }
    } catch {}
  }
  return c.json(out);
});

// Debug: dump a job's container-side state
app.get('/api/scribe/:id/debug', async (c) => {
  const { getContainer } = await import('@cloudflare/containers');
  const container = getContainer(c.env.YTDLP as any, c.req.param('id'));
  const res = await container.fetch(new Request('http://ytdlp/debug', {
    headers: { Authorization: 'Bearer ' + (c.env.YTDLP_TOKEN || 'internal') },
  }));
  return c.json(await res.json().catch(() => ({ error: 'unreachable' })));
});

// Warm a container instance while the user is still composing
app.post('/api/scribe/prewarm', async (c) => {
  try {
    const { getContainer } = await import('@cloudflare/containers');
    const container = getContainer(c.env.YTDLP as any, 'enum');
    c.executionCtx.waitUntil(container.fetch(new Request('http://ytdlp/health')).then(() => {}));
  } catch {}
  return c.json({ ok: true });
});

// Enumerate a playlist/channel without downloading (container, seconds)
app.post('/api/scribe/enumerate', async (c) => {
  const { url } = await c.req.json();
  if (!url || !/^https?:\/\//.test(url)) return c.json({ error: 'A valid http(s) URL is required' }, 400);
  const { getContainer } = await import('@cloudflare/containers');
  const container = getContainer(c.env.YTDLP as any, 'enum');
  const cookiesObj = await c.env.MEDIA_BUCKET.get(COOKIES_KEY);
  const cookies = cookiesObj ? await cookiesObj.text() : null;
  const res = await container.fetch(new Request('http://ytdlp/playlist', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + (c.env.YTDLP_TOKEN || 'internal'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, cookies }),
  }));
  if (!res.ok) return c.json({ error: `enumeration failed: HTTP ${res.status}` }, 502);
  return c.json(await res.json());
});

// Queue many URLs at once
app.post('/api/scribe/batch', async (c) => {
  const { urls, target_langs, full_video } = await c.req.json();
  if (!Array.isArray(urls) || !urls.length) return c.json({ error: 'urls array required' }, 400);
  if (urls.length > 30) return c.json({ error: 'max 30 per batch' }, 400);
  const langs = Array.isArray(target_langs) && target_langs.length ? target_langs : ['en'];
  const ids: string[] = [];
  for (const url of urls) {
    if (!/^https?:\/\//.test(url)) continue;
    ids.push(await createScribeJob(c.env, url, langs, !!full_video));
  }
  return c.json({ created: ids.length, ids });
});

app.post('/api/scribe', async (c) => {
  const { url, target_lang, target_langs, full_video, title, channel, thumb_url } = await c.req.json();
  if (!url || !/^https?:\/\//.test(url)) return c.json({ error: 'A valid http(s) URL is required' }, 400);
  const langs = Array.isArray(target_langs) && target_langs.length ? target_langs : [target_lang || 'en'];
  const targetLang = langs[0];
  let id = '';
  try {
    id = await createScribeJob(c.env, url, langs, !!full_video, { title, channel, thumb_url });
  } catch (err: any) {
    return c.json({ error: 'Failed to start pipeline: ' + err.message }, 500);
  }
  const job = await c.env.DB.prepare('SELECT * FROM scribe_jobs WHERE id = ?').bind(id).first();
  return c.json({ job });
});

app.get('/api/scribe', async (c) => {
  const jobs = await c.env.DB.prepare('SELECT * FROM scribe_jobs ORDER BY created_at DESC LIMIT 50').all();
  return c.json({ jobs: jobs.results });
});

app.get('/api/scribe/:id', async (c) => {
  const job = await c.env.DB.prepare('SELECT * FROM scribe_jobs WHERE id = ?').bind(c.req.param('id')).first();
  if (!job) return c.json({ error: 'Not found' }, 404);
  return c.json({ job });
});

app.get('/api/scribe/:id/file', async (c) => {
  const job: any = await c.env.DB.prepare('SELECT * FROM scribe_jobs WHERE id = ?').bind(c.req.param('id')).first();
  if (!job) return c.json({ error: 'Not found' }, 404);
  const type = c.req.query('type') || 'srt';
  const key = type === 'source' ? job.srt_source_key : type === 'asr' ? job.asr_key : job.srt_key;
  if (!key) return c.json({ error: 'File not ready' }, 404);
  const obj = await c.env.MEDIA_BUCKET.get(key);
  if (!obj) return c.json({ error: 'File missing from R2' }, 404);
  const name = key.split('/').pop() || 'file';
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${job.id}-${name}"`,
    },
  });
});

app.delete('/api/scribe/:id', async (c) => {
  const id = c.req.param('id');
  const job: any = await c.env.DB.prepare('SELECT * FROM scribe_jobs WHERE id = ?').bind(id).first();
  if (!job) return c.json({ error: 'Not found' }, 404);
  // Best-effort: stop a running workflow instance
  try {
    const inst = await c.env.SCRIBE_WORKFLOW.get(id);
    await inst.terminate();
  } catch {}
  // Remove artifacts
  const list = await c.env.MEDIA_BUCKET.list({ prefix: `scribe/${id}/` });
  for (const obj of list.objects) await c.env.MEDIA_BUCKET.delete(obj.key);
  await c.env.DB.prepare('DELETE FROM scribe_jobs WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

app.post('/api/scribe/:id/retry', async (c) => {
  const id = c.req.param('id');
  const job: any = await c.env.DB.prepare('SELECT * FROM scribe_jobs WHERE id = ?').bind(id).first();
  if (!job) return c.json({ error: 'Not found' }, 404);
  if (job.status === 'running') return c.json({ error: 'Job is still running' }, 400);
  const newId = genJobId();
  await c.env.DB.prepare('INSERT INTO scribe_jobs (id, url, target_lang, status, step) VALUES (?, ?, ?, ?, ?)')
    .bind(newId, job.url, job.target_lang, 'queued', 'queued').run();
  await c.env.SCRIBE_WORKFLOW.create({ id: newId, params: { jobId: newId, url: job.url, targetLang: job.target_lang } });
  const fresh = await c.env.DB.prepare('SELECT * FROM scribe_jobs WHERE id = ?').bind(newId).first();
  return c.json({ job: fresh });
});

// ---- Scribe publish flow (job → site video, elite path) ----

import { generateThumbCandidates, publishScribeJob } from './scribe/publish';

app.post('/api/scribe/:id/thumbs', async (c) => {
  try {
    const candidates = await generateThumbCandidates(c.env as any, c.req.param('id'));
    return c.json({ candidates });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

app.post('/api/scribe/:id/publish', async (c) => {
  try {
    const opts = await c.req.json();
    const result = await publishScribeJob(c.env as any, c.req.param('id'), opts);
    const user = c.get('user');
    c.executionCtx.waitUntil(
      c.env.DB.prepare('INSERT INTO admin_logs (admin_id, action, target, details) VALUES (?, ?, ?, ?)')
        .bind(user?.id || 0, 'publish_video', result.slug, `from scribe job ${c.req.param('id')}`).run()
    );
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// ---- Playlists ----

app.get('/api/playlists', async (c) => {
  const playlists = await c.env.DB.prepare(
    'SELECT p.*, (SELECT COUNT(*) FROM playlist_videos pv WHERE pv.playlist_id = p.id) as video_count FROM playlists p ORDER BY p.created_at DESC'
  ).all();
  return c.json({ playlists: playlists.results });
});

app.post('/api/playlists', async (c) => {
  const b = await c.req.json();
  if (!b.title) return c.json({ error: 'title required' }, 400);
  const slug = (b.slug || b.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  await c.env.DB.prepare('INSERT INTO playlists (title, title_ar, slug, description, cover_key) VALUES (?,?,?,?,?)')
    .bind(b.title, b.title_ar || null, slug, b.description || null, b.cover_key || null).run();
  const playlist = await c.env.DB.prepare('SELECT * FROM playlists WHERE slug = ?').bind(slug).first();
  return c.json({ playlist });
});

app.get('/api/playlists/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const [playlist, videos] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM playlists WHERE id = ?').bind(id).first(),
    c.env.DB.prepare(
      `SELECT v.id, v.title, v.slug, v.thumb_key, v.duration, v.views, pv.position ${''}
       FROM playlist_videos pv JOIN videos v ON v.id = pv.video_id WHERE pv.playlist_id = ? ORDER BY pv.position ASC`
    ).bind(id).all(),
  ]);
  if (!playlist) return c.json({ error: 'Not found' }, 404);
  return c.json({ playlist, videos: videos.results });
});

app.put('/api/playlists/:id', async (c) => {
  const b = await c.req.json();
  await c.env.DB.prepare('UPDATE playlists SET title=?, title_ar=?, description=?, cover_key=? WHERE id=?')
    .bind(b.title, b.title_ar || null, b.description || null, b.cover_key || null, parseInt(c.req.param('id'))).run();
  return c.json({ ok: true });
});

app.delete('/api/playlists/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM playlists WHERE id = ?').bind(parseInt(c.req.param('id'))).run();
  return c.json({ ok: true });
});

app.post('/api/playlists/:id/videos', async (c) => {
  const id = parseInt(c.req.param('id'));
  const { video_id } = await c.req.json();
  const max: any = await c.env.DB.prepare('SELECT COALESCE(MAX(position), -1) as p FROM playlist_videos WHERE playlist_id = ?').bind(id).first();
  await c.env.DB.prepare('INSERT OR IGNORE INTO playlist_videos (playlist_id, video_id, position) VALUES (?,?,?)')
    .bind(id, video_id, (max?.p ?? -1) + 1).run();
  return c.json({ ok: true });
});

app.delete('/api/playlists/:id/videos/:videoId', async (c) => {
  await c.env.DB.prepare('DELETE FROM playlist_videos WHERE playlist_id = ? AND video_id = ?')
    .bind(parseInt(c.req.param('id')), parseInt(c.req.param('videoId'))).run();
  return c.json({ ok: true });
});

app.put('/api/playlists/:id/order', async (c) => {
  const id = parseInt(c.req.param('id'));
  const { video_ids } = await c.req.json();
  if (!Array.isArray(video_ids)) return c.json({ error: 'video_ids array required' }, 400);
  for (let i = 0; i < video_ids.length; i++) {
    await c.env.DB.prepare('UPDATE playlist_videos SET position = ? WHERE playlist_id = ? AND video_id = ?')
      .bind(i, id, video_ids[i]).run();
  }
  return c.json({ ok: true });
});

// ---- Cue editor (source ↔ translation, QA-in-the-loop) ----

import { renderSrt as renderSrtFile } from './scribe/srt';
import { llmChat as scribeLlm } from './scribe/translate';

app.get('/api/scribe/:id/cues', async (c) => {
  const id = c.req.param('id');
  const lang = c.req.query('lang');
  const job: any = await c.env.DB.prepare('SELECT * FROM scribe_jobs WHERE id = ?').bind(id).first();
  if (!job) return c.json({ error: 'Not found' }, 404);
  const key = !lang || lang === job.target_lang ? `scribe/${id}/cues.json` : `scribe/${id}/cues.${lang}.json`;
  const obj = await c.env.MEDIA_BUCKET.get(key);
  if (!obj) return c.json({ error: 'Cues not ready' }, 404);
  return c.json({ cues: await obj.json(), lang: lang || job.target_lang });
});

app.put('/api/scribe/:id/cues', async (c) => {
  const id = c.req.param('id');
  const { cues, lang } = await c.req.json();
  if (!Array.isArray(cues)) return c.json({ error: 'cues array required' }, 400);
  const job: any = await c.env.DB.prepare('SELECT * FROM scribe_jobs WHERE id = ?').bind(id).first();
  if (!job) return c.json({ error: 'Not found' }, 404);
  const isPrimary = !lang || lang === job.target_lang;
  const cuesKey = isPrimary ? `scribe/${id}/cues.json` : `scribe/${id}/cues.${lang}.json`;
  await c.env.MEDIA_BUCKET.put(cuesKey, JSON.stringify(cues), { httpMetadata: { contentType: 'application/json' } });
  const srtKey = `scribe/${id}/${lang || job.target_lang}.srt`;
  await c.env.MEDIA_BUCKET.put(srtKey, renderSrtFile(cues, 'text'), { httpMetadata: { contentType: 'text/plain; charset=utf-8' } });
  if (isPrimary) {
    await c.env.MEDIA_BUCKET.put(`scribe/${id}/source.srt`, renderSrtFile(cues, 'source'), { httpMetadata: { contentType: 'text/plain; charset=utf-8' } });
    await c.env.DB.prepare('UPDATE scribe_jobs SET cue_count = ? WHERE id = ?').bind(cues.length, id).run();
  }
  return c.json({ ok: true, saved: cues.length });
});

app.post('/api/scribe/:id/retranslate', async (c) => {
  const { source, current, target_lang, context } = await c.req.json();
  if (!source) return c.json({ error: 'source text required' }, 400);
  const text = await scribeLlm(c.env as any, [
    { role: 'system', content: `You retranslate one subtitle cue for an Islamic lecture. Target language: ${target_lang || 'en'}. Keep honorifics (ﷺ, ﷻ, RA). Max 84 characters. Answer with ONLY the improved translation, nothing else.` },
    { role: 'user', content: `Source: ${source}\nCurrent translation: ${current || '(none)'}\nSurrounding context: ${context || '(none)'}` },
  ], 300);
  return c.json({ translation: text.trim().replace(/^"|"$/g, '') });
});

// ---- Clip Studio ----

import { suggestMoments } from './scribe/clips';

app.post('/api/clips/suggest', async (c) => {
  const { job_id } = await c.req.json();
  const obj = await c.env.MEDIA_BUCKET.get(`scribe/${job_id}/cues.json`);
  if (!obj) return c.json({ error: 'Job cues not found' }, 404);
  try {
    const moments = await suggestMoments(c.env as any, await obj.json());
    return c.json({ moments });
  } catch (err: any) {
    return c.json({ error: 'suggestion failed: ' + err.message }, 500);
  }
});

app.get('/api/clips', async (c) => {
  const jobId = c.req.query('job_id');
  const q = jobId
    ? c.env.DB.prepare('SELECT * FROM clips WHERE job_id = ? ORDER BY created_at DESC').bind(jobId)
    : c.env.DB.prepare('SELECT cl.*, j.title as job_title FROM clips cl LEFT JOIN scribe_jobs j ON cl.job_id = j.id ORDER BY cl.created_at DESC LIMIT 50');
  return c.json({ clips: (await q.all()).results });
});

app.post('/api/clips', async (c) => {
  const { job_id, start, end, hook, style } = await c.req.json();
  if (!job_id || typeof start !== 'number' || typeof end !== 'number' || end <= start) {
    return c.json({ error: 'job_id, start, end required' }, 400);
  }
  if (end - start > 180) return c.json({ error: 'clips are capped at 3 minutes' }, 400);
  const id = genJobId();
  await c.env.DB.prepare('INSERT INTO clips (id, job_id, start, end, hook, style, status) VALUES (?,?,?,?,?,?,?)')
    .bind(id, job_id, start, end, hook || '', style || 'bold', 'running').run();
  try {
    await c.env.CLIP_WORKFLOW.create({ id: 'clip-' + id, params: { clipId: id } });
  } catch (err: any) {
    await c.env.DB.prepare("UPDATE clips SET status='error', error=? WHERE id=?").bind(err.message, id).run();
    return c.json({ error: err.message }, 500);
  }
  const clip = await c.env.DB.prepare('SELECT * FROM clips WHERE id = ?').bind(id).first();
  return c.json({ clip });
});

app.get('/api/clips/:id/file', async (c) => {
  const clip: any = await c.env.DB.prepare('SELECT * FROM clips WHERE id = ?').bind(c.req.param('id')).first();
  if (!clip?.r2_key) return c.json({ error: 'Not ready' }, 404);
  const obj = await c.env.MEDIA_BUCKET.get(clip.r2_key);
  if (!obj) return c.json({ error: 'Missing from R2' }, 404);
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Disposition': `attachment; filename="deensubs-clip-${clip.id}.mp4"`,
    },
  });
});

app.delete('/api/clips/:id', async (c) => {
  const id = c.req.param('id');
  const clip: any = await c.env.DB.prepare('SELECT * FROM clips WHERE id = ?').bind(id).first();
  if (clip?.r2_key) await c.env.MEDIA_BUCKET.delete(clip.r2_key).catch(() => {});
  await c.env.DB.prepare('DELETE FROM clips WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

// ---- Semantic search (Vectorize + Workers AI bge-m3) ----

app.post('/api/semantic', async (c) => {
  const { q, limit } = await c.req.json();
  if (!q) return c.json({ error: 'q required' }, 400);
  try {
    const emb: any = await c.env.AI.run('@cf/baai/bge-m3', { text: [q] });
    const vector = emb.data?.[0];
    if (!vector) return c.json({ error: 'embedding failed' }, 500);
    const res = await c.env.VECTORIZE.query(vector, { topK: Math.min(limit || 10, 25), returnMetadata: 'all' });
    return c.json({
      matches: res.matches.map((m) => ({ score: Math.round(m.score * 1000) / 1000, ...(m.metadata || {}) })),
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ---- Dubbing (ElevenLabs) ----

app.post('/api/scribe/:id/dub', async (c) => {
  const id = c.req.param('id');
  const { lang } = await c.req.json().catch(() => ({}));
  const target = lang || 'en';
  const job: any = await c.env.DB.prepare('SELECT * FROM scribe_jobs WHERE id = ?').bind(id).first();
  if (!job?.source_key) return c.json({ error: 'Job or source missing' }, 404);
  const form = new FormData();
  form.append('source_url', `https://cdn.deensubs.com/${job.source_key}`);
  form.append('target_lang', target);
  form.append('mode', 'automatic');
  const res = await fetch('https://api.elevenlabs.io/v1/dubbing', {
    method: 'POST',
    headers: { 'xi-api-key': c.env.ELEVENLABS_API_KEY || '' },
    body: form,
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data.dubbing_id) {
    return c.json({ error: `dubbing failed: ${data?.detail?.message || data?.detail || res.status}` }, 400);
  }
  await c.env.DB.prepare("UPDATE scribe_jobs SET dub_id = ?, dub_status = 'dubbing' WHERE id = ?").bind(data.dubbing_id, id).run();
  return c.json({ dubbing_id: data.dubbing_id, status: 'dubbing' });
});

app.get('/api/scribe/:id/dub', async (c) => {
  const id = c.req.param('id');
  const job: any = await c.env.DB.prepare('SELECT * FROM scribe_jobs WHERE id = ?').bind(id).first();
  if (!job?.dub_id) return c.json({ status: 'none' });
  if (job.dub_status === 'done' && job.dub_key) return c.json({ status: 'done', key: job.dub_key });
  const res = await fetch(`https://api.elevenlabs.io/v1/dubbing/${job.dub_id}`, {
    headers: { 'xi-api-key': c.env.ELEVENLABS_API_KEY || '' },
  });
  const data: any = await res.json().catch(() => ({}));
  if (data.status === 'dubbed') {
    const lang = (JSON.parse(job.target_langs || '["en"]'))[0];
    const audio = await fetch(`https://api.elevenlabs.io/v1/dubbing/${job.dub_id}/audio/${lang}`, {
      headers: { 'xi-api-key': c.env.ELEVENLABS_API_KEY || '' },
    });
    if (audio.ok && audio.body) {
      const key = `scribe/${id}/dub-${lang}.mp3`;
      await c.env.MEDIA_BUCKET.put(key, await audio.arrayBuffer(), { httpMetadata: { contentType: 'audio/mpeg' } });
      await c.env.DB.prepare("UPDATE scribe_jobs SET dub_status = 'done', dub_key = ? WHERE id = ?").bind(key, id).run();
      return c.json({ status: 'done', key });
    }
  }
  if (data.status === 'failed') {
    await c.env.DB.prepare("UPDATE scribe_jobs SET dub_status = 'error' WHERE id = ?").bind(id).run();
    return c.json({ status: 'error', detail: data.error || 'dubbing failed' });
  }
  return c.json({ status: job.dub_status || 'dubbing' });
});

app.get('/api/scribe/:id/dub/file', async (c) => {
  const job: any = await c.env.DB.prepare('SELECT * FROM scribe_jobs WHERE id = ?').bind(c.req.param('id')).first();
  if (!job?.dub_key) return c.json({ error: 'Not ready' }, 404);
  const obj = await c.env.MEDIA_BUCKET.get(job.dub_key);
  if (!obj) return c.json({ error: 'Missing' }, 404);
  return new Response(obj.body, {
    headers: { 'Content-Type': 'audio/mpeg', 'Content-Disposition': `attachment; filename="dub-${job.id}.mp3"` },
  });
});

// ---- Categories CRUD + scholar editing ----

app.post('/api/categories', async (c) => {
  const b = await c.req.json();
  if (!b.name) return c.json({ error: 'name required' }, 400);
  const slug = (b.slug || b.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  await c.env.DB.prepare('INSERT INTO categories (name, name_ar, slug, color) VALUES (?,?,?,?)')
    .bind(b.name, b.name_ar || b.name, slug, b.color || '#c4a44c').run();
  return c.json({ ok: true });
});

app.put('/api/categories/:id', async (c) => {
  const b = await c.req.json();
  await c.env.DB.prepare('UPDATE categories SET name=?, name_ar=?, color=? WHERE id=?')
    .bind(b.name, b.name_ar || b.name, b.color || '#c4a44c', parseInt(c.req.param('id'))).run();
  return c.json({ ok: true });
});

app.delete('/api/categories/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const used: any = await c.env.DB.prepare('SELECT COUNT(*) as n FROM videos WHERE category_id = ?').bind(id).first();
  if (used?.n > 0) return c.json({ error: `${used.n} videos still use this category` }, 400);
  await c.env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

app.put('/api/scholars/:id', async (c) => {
  const b = await c.req.json();
  await c.env.DB.prepare('UPDATE scholars SET name=?, title=?, bio=?, photo=?, photo_hero=? WHERE id=?')
    .bind(b.name, b.title || null, b.bio || null, b.photo || null, b.photo_hero || null, parseInt(c.req.param('id'))).run();
  return c.json({ ok: true });
});

// ---- AI agent (padborginn router, agentic loop, SSE streaming) ----

import { runAgent, SYSTEM_PROMPT as AGENT_PROMPT } from './ai/agent';
import { AI_TOOLS as AGENT_TOOLS, executeTool as runTool } from './ai/tools';

// Streaming endpoint: SSE events (round / tool_start / tool_done / token / done / error)
app.post('/api/ai/stream', async (c) => {
  const { prompt, history } = await c.req.json();
  if (!prompt) return c.json({ error: 'prompt required' }, 400);
  if (!c.env.SCRIBE_LLM_URL || !c.env.SCRIBE_LLM_KEY) return c.json({ error: 'LLM router not configured' }, 500);

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const emit = (e: any) => writer.write(encoder.encode('data: ' + JSON.stringify(e) + '\n\n')).catch(() => {});

  c.executionCtx.waitUntil(
    runAgent(c.env as any, prompt, history || [], emit)
      .catch((err) => emit({ type: 'error', message: String(err?.message || err) }))
      .finally(() => writer.close().catch(() => {}))
  );

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
});

// Non-streaming fallback (scripts / curl)
app.post('/api/ai', async (c) => {
  const { prompt, history } = await c.req.json();
  if (!prompt) return c.json({ error: 'prompt required' }, 400);
  let answer = '';
  let model = '';
  const tools: string[] = [];
  let error = '';
  await runAgent(c.env as any, prompt, history || [], (e: any) => {
    if (e.type === 'token') answer += e.text;
    if (e.type === 'tool_done') tools.push(e.name);
    if (e.type === 'done') model = e.model;
    if (e.type === 'error') error = e.message;
  });
  if (error && !answer) return c.json({ error }, 500);
  return c.json({ response: answer, model, tools_used: tools });
});

// ---- Fallback: serve SPA (assets binding handles static; this covers deep links when run_worker_first matches) ----

app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export { ScribePipeline } from './scribe/workflow';
export { ClipRenderer } from './scribe/clips';
export { YtdlpContainer } from './scribe/container';

// Daily retention: drop scribe artifacts for jobs older than 30 days.
// Published copies live under canonical keys, so this only clears staging.
async function retentionSweep(env: Env) {
  const old = await env.DB.prepare(
    "SELECT id FROM scribe_jobs WHERE created_at < datetime('now', '-30 days') AND status IN ('done','error')"
  ).all();
  for (const row of old.results as any[]) {
    const list = await env.MEDIA_BUCKET.list({ prefix: `scribe/${row.id}/` });
    for (const obj of list.objects) await env.MEDIA_BUCKET.delete(obj.key);
    await env.DB.prepare('DELETE FROM scribe_jobs WHERE id = ?').bind(row.id).run();
  }
}

export default {
  fetch: app.fetch,
  scheduled: (_event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(retentionSweep(env));
  },
};
