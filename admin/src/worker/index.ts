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
  CLIP: DurableObjectNamespace;
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
  UPLOAD_TOKEN?: string;
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

// ElevenLabs async STT results land here (configured in their dashboard).
// Outside /api/* on purpose: authenticated by HMAC signature, not our key.
app.post('/hooks/elevenlabs', async (c) => {
  const secret = (c.env as any).ELEVENLABS_WEBHOOK_SECRET as string | undefined;
  if (!secret) return c.json({ error: 'webhook not configured' }, 503);
  const raw = await c.req.text();
  const sig = c.req.header('ElevenLabs-Signature') || '';
  const t = sig.match(/t=(\d+)/)?.[1];
  const v0 = sig.match(/v0=([a-f0-9]+)/)?.[1];
  if (!t || !v0) return c.json({ error: 'missing signature' }, 401);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${raw}`)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (hex !== v0) return c.json({ error: 'bad signature' }, 401);
  let payload: any;
  try { payload = JSON.parse(raw); } catch { return c.json({ error: 'bad JSON' }, 400); }
  const requestId = payload?.data?.request_id || payload?.request_id || payload?.data?.transcription_id;
  if (!requestId) return c.json({ error: 'no request_id' }, 400);
  const { sttResultKey } = await import('./scribe/asr');
  await c.env.MEDIA_BUCKET.put(sttResultKey(String(requestId)), raw, {
    httpMetadata: { contentType: 'application/json' },
  });
  return c.json({ ok: true });
});

// Auto-update manifest for installed companions — public and NEVER cached
// (the edge would otherwise pin an old manifest for 30 days; the bundles it
// points to live on the cdn under version-unique names, so those cache fine).
app.get('/companion/update/latest.json', async (c) => {
  const obj = await c.env.MEDIA_BUCKET.get('companion/update/latest.json');
  if (!obj) return c.json({ error: 'no manifest' }, 404);
  return new Response(obj.body, {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
});

// Companion presence WebSocket — outside /api/* auth; validates the key
// param (companion apps) or the admin session cookie (dashboard watchers).
app.get('/ws/companion', async (c) => {
  if (c.req.header('Upgrade') !== 'websocket') return c.json({ error: 'websocket expected' }, 426);
  const key = c.req.query('key');
  let ok = !!(key && c.env.ADMIN_KEY && key === c.env.ADMIN_KEY);
  if (!ok) {
    const user = await getUser(c);
    ok = !!user && user.role === 'admin';
  }
  if (!ok) return c.json({ error: 'Unauthorized' }, 401);
  const stub = (c.env as any).HUB.get((c.env as any).HUB.idFromName('hub'));
  return stub.fetch(c.req.raw);
});

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
    queryAE(c.env, "SELECT toDate(timestamp) AS day, count() AS hits FROM deensubs_analytics WHERE timestamp > NOW() - INTERVAL '14' DAY AND blob1 IN ('pageview','watch') GROUP BY day ORDER BY day ASC"),
    db.prepare(`SELECT v.title, v.slug, v.thumb_key, v.views, v.likes, v.duration ${VIDEO_JOIN} ORDER BY v.views DESC LIMIT 8`).all(),
    queryAE(c.env, "SELECT blob2 AS path, count() AS hits FROM deensubs_analytics WHERE timestamp > NOW() - INTERVAL '14' DAY AND blob1 = 'pageview' GROUP BY path ORDER BY hits DESC LIMIT 10"),
    queryAE(c.env, "SELECT blob4 AS country, count() AS hits FROM deensubs_analytics WHERE timestamp > NOW() - INTERVAL '14' DAY AND blob4 != '' GROUP BY country ORDER BY hits DESC LIMIT 12"),
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
    dailyHits: aeRows(dailyHits),
    topVideos: topVideos.results,
    topPages: aeRows(topPages),
    countries: aeRows(countries),
    recentComments: recentComments.results,
    recentVideos: recentVideos.results,
    scribeJobs: scribeJobs.results,
    recentClips: recentClips.results,
    spend,
  });
});

// ---- Analytics (D1) ----

app.get('/api/analytics', async (c) => {
  // Sourced from Analytics Engine — the redesigned site writes events only there
  const W = "timestamp > NOW() - INTERVAL '30' DAY";
  const [dailyHits, topPages, topVideos, referers, agents] = await Promise.all([
    queryAE(c.env, `SELECT toDate(timestamp) AS day, count() AS hits FROM deensubs_analytics WHERE ${W} AND blob1 IN ('pageview','watch') GROUP BY day ORDER BY day ASC`),
    queryAE(c.env, `SELECT blob2 AS path, count() AS hits FROM deensubs_analytics WHERE ${W} AND blob1 = 'pageview' GROUP BY path ORDER BY hits DESC LIMIT 25`),
    queryAE(c.env, `SELECT blob3 AS slug, count() AS hits FROM deensubs_analytics WHERE ${W} AND blob1 = 'watch' AND blob3 != '' GROUP BY slug ORDER BY hits DESC LIMIT 20`),
    queryAE(c.env, `SELECT blob6 AS referer, count() AS hits FROM deensubs_analytics WHERE ${W} AND blob6 != '' AND blob1 IN ('pageview','watch') GROUP BY referer ORDER BY hits DESC LIMIT 20`),
    queryAE(c.env, `SELECT concat(blob9, ' · ', blob10, ' · ', blob8) AS user_agent, count() AS hits FROM deensubs_analytics WHERE ${W} AND blob9 != '' GROUP BY user_agent ORDER BY hits DESC LIMIT 20`),
  ]);
  return c.json({
    dailyHits: aeRows(dailyHits),
    topPages: aeRows(topPages),
    topVideos: aeRows(topVideos),
    referers: aeRows(referers),
    agents: aeRows(agents),
  });
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

/** Full site KV cache purge (same approach as publish) — rebuilt on demand. */
async function purgeSiteCache(env: Env) {
  const keys = await env.CACHE.list();
  for (const k of keys.keys) await env.CACHE.delete(k.name).catch(() => {});
}

/** Post-save hook: bake responsive variants for the thumbnail and refresh the site. */
function afterVideoSave(c: any, b: any) {
  c.executionCtx.waitUntil((async () => {
    if (b.thumb_key) await bakeThumbVariants(c.env, b.thumb_key).catch(() => {});
    await purgeSiteCache(c.env);
  })());
}

app.get('/api/videos', async (c) => {
  const videos = await c.env.DB.prepare(`SELECT ${VIDEO_COLS} ${VIDEO_JOIN} ORDER BY v.created_at DESC`).all();
  return c.json({ videos: videos.results });
});

app.post('/api/videos', async (c) => {
  const b = await c.req.json();
  await c.env.DB.prepare(
    'INSERT INTO videos (title, title_ar, slug, description, category_id, scholar_id, source, duration, video_key, srt_key, srt_ar_key, thumb_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(b.title, b.title_ar || null, b.slug, b.description || null, parseInt(b.category_id) || null, parseInt(b.scholar_id) || null, b.source || null, parseInt(b.duration) || 0, b.video_key, b.srt_key || null, b.srt_ar_key || null, b.thumb_key || null).run();
  afterVideoSave(c, b);
  return c.json({ ok: true });
});

app.put('/api/videos/:id', async (c) => {
  const b = await c.req.json();
  await c.env.DB.prepare(
    'UPDATE videos SET title=?, title_ar=?, slug=?, description=?, category_id=?, scholar_id=?, source=?, duration=?, video_key=?, srt_key=?, srt_ar_key=?, thumb_key=? WHERE id=?'
  ).bind(b.title, b.title_ar || null, b.slug, b.description || null, parseInt(b.category_id) || null, parseInt(b.scholar_id) || null, b.source || null, parseInt(b.duration) || 0, b.video_key, b.srt_key || null, b.srt_ar_key || null, b.thumb_key || null, parseInt(c.req.param('id'))).run();
  afterVideoSave(c, b);
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
  // D1 via the site's queue consumer (search_log messages) — still the live path
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
  // AE watch_event: blob2 = event type, blob3 = slug, double1 = pos, double2 = dur
  const W = "blob1 = 'watch_event' AND timestamp > NOW() - INTERVAL '30' DAY";
  const [events, completion] = await Promise.all([
    queryAE(c.env, `SELECT blob2 AS event_type, count() AS count FROM deensubs_analytics WHERE ${W} GROUP BY event_type ORDER BY count DESC`),
    queryAE(c.env, `SELECT index1 AS video_slug, count() AS events, round(avg(if(double2 > 0, double1 * 100.0 / double2, 0)), 1) AS avg_pct FROM deensubs_analytics WHERE ${W} AND index1 != '' AND index1 != 'unknown' GROUP BY video_slug ORDER BY events DESC LIMIT 25`),
  ]);
  const compRows = aeRows(completion).map((r: any) => ({ ...r, viewers: r.events }));
  const slugs = [...new Set(compRows.map((r: any) => r.video_slug).filter(Boolean))];
  let titles: Record<string, string> = {};
  if (slugs.length) {
    const rows = await c.env.DB.prepare(
      `SELECT slug, title FROM videos WHERE slug IN (${slugs.map(() => '?').join(',')})`
    ).bind(...slugs).all();
    titles = Object.fromEntries((rows.results as any[]).map((r) => [r.slug, r.title]));
  }
  return c.json({
    events: aeRows(events),
    completion: compRows.map((r: any) => ({ ...r, title: titles[r.video_slug] || r.video_slug })),
    topWatched: compRows.map((r: any) => ({ video_slug: r.video_slug, unique_viewers: r.viewers, events: r.events, title: titles[r.video_slug] || r.video_slug })),
    connections: [],
    bufferIssues: [],
  });});

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

// Cookies retired: downloads use Browser Rendering (a real headless Chrome on a
// Cloudflare IP passes YouTube's bot check with no cookies/proxies). The
// /api/scribe/cookies endpoints and the dashboard panel have been removed.

type JobIdentity = { title?: string; channel?: string; thumb_url?: string };
type JobPlaylist = { id: number; pos: number };

// upload: local file already streamed into R2 — the job starts with source_key
// preset so the workflow's download step resume-check short-circuits past yt-dlp
type JobUpload = { id: string; sourceKey: string; duration: number };

async function createScribeJob(env: Env, url: string, targetLangs: string[], fullVideo: boolean, ident: JobIdentity = {}, createdBy?: number, playlist?: JobPlaylist, upload?: JobUpload) {
  const id = upload?.id || genJobId();
  const primary = targetLangs[0] || 'en';
  await env.DB.prepare('INSERT INTO scribe_jobs (id, url, target_lang, target_langs, full_video, status, step, title, channel, thumb_url, created_by, playlist_id, playlist_pos, source_key, download_method, download_pct, duration) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, url, primary, JSON.stringify(targetLangs), fullVideo ? 1 : 0, 'queued', 'queued',
      ident.title || null, ident.channel || null, ident.thumb_url || null, createdBy ?? null,
      playlist?.id ?? null, playlist?.pos ?? null,
      upload?.sourceKey ?? null, upload ? 'upload' : null, upload ? 100 : 0, upload?.duration ?? 0).run();
  await env.DB.prepare('UPDATE scribe_jobs SET wf_instance = ? WHERE id = ?').bind(id, id).run();
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
  out.path = vid || /(youtube\.com|youtu\.be)\//i.test(url) ? 'browser' : 'direct';

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
    // Shallow probe is oembed-only so it returns in ~300ms (title, channel,
    // instant thumbnail). Exact duration + best thumbnail + 4K come from the
    // deep probe (container yt-dlp, android_vr, ~1-3s) — no InnerTube WEB call
    // here, which is bot-walled from the datacenter IP and only added latency.
  } else if (out.path === 'direct') {
    // Cheap HEAD for size/type
    try {
      const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(4000) });
      out.bytes = parseInt(head.headers.get('content-length') || '0') || undefined;
      out.content_type = head.headers.get('content-type') || undefined;
    } catch {}
  }

  // Deep probe (duration → cost): the container's yt-dlp (android_vr) probes
  // direct from the datacenter IP in ~1-3s — far faster than Browser Rendering.
  // The 'enum' instance is prewarmed while the user types. Browser Rendering is
  // the fallback if the container can't extract.
  if (deep && vid) {
    const est = (secs: number) => Math.round(((secs / 3600) * 0.4 + (secs * 450 / 1e6) * 0.4) * 100) / 100;
    try {
      const { getContainer } = await import('@cloudflare/containers');
      const container = getContainer(c.env.YTDLP as any, 'enum');
      const r = await container.fetch(new Request('http://ytdlp/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (c.env.YTDLP_TOKEN || 'internal') },
        body: JSON.stringify({ url }),
      }));
      const m: any = await r.json().catch(() => ({}));
      if (!m || !m.duration) throw new Error(m?.error || 'no duration from container');
      out.title = out.title || m.title;
      out.channel = out.channel || m.channel;
      if (m.thumbnail) out.thumb_url = m.thumbnail;
      out.duration = m.duration;
      out.four_k = m.four_k;
      out.est_cost = est(m.duration);
    } catch (containerErr: any) {
      try {
        const { browserMintCached } = await import('./scribe/ytbrowser');
        const m = await browserMintCached(c.env as any, vid);
        out.title = out.title || m.title;
        out.channel = out.channel || m.channel;
        if (m.thumbUrl) out.thumb_url = m.thumbUrl;
        out.duration = m.durationSec;
        out.four_k = m.fourK;
        if (m.durationSec) out.est_cost = est(m.durationSec);
      } catch (e: any) {
        out.probe_error = String(e?.message || e).slice(0, 120);
      }
    }
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

// ASR mode config (dual ElevenLabs system): authenticated no-chunk vs
// unauthenticated-via-SOCKS-proxies chunked. Edited on the /tools page.
function asrConfigView(c: any, cfg: any) {
  const hasApiKey = !!c.env.ELEVENLABS_API_KEY;
  // 'authenticated' forces the paid API; anything else runs the free-first chain
  // (CF pool -> SpyderProxy -> authenticated backstop). Matches resolveAsrMode.
  const activeMode = cfg.mode === 'authenticated' ? 'authenticated' : 'proxy';
  return { ...cfg, hasApiKey, activeMode };
}
app.get('/api/asr-config', async (c) => {
  const { getAsrConfig } = await import('./scribe/asr-config');
  return c.json(asrConfigView(c, await getAsrConfig(c.env)));
});
app.post('/api/asr-config', async (c) => {
  const { putAsrConfig } = await import('./scribe/asr-config');
  const body = await c.req.json().catch(() => ({}));
  return c.json(asrConfigView(c, await putAsrConfig(c.env, body)));
});

// Enumerate a playlist without downloading — Browser Rendering (one session,
// InnerTube browse). No container, no cookies.
app.post('/api/scribe/enumerate', async (c) => {
  const { url } = await c.req.json();
  if (!url || !/^https?:\/\//.test(url)) return c.json({ error: 'A valid http(s) URL is required' }, 400);
  const listId = (url.match(/[?&]list=([\w-]+)/) || [])[1] || null;
  if (!listId) return c.json({ error: 'no playlist (list=) id found in the URL' }, 400);
  try {
    const { resolvePlaylist } = await import('./scribe/ytbrowser');
    const pl = await resolvePlaylist(c.env as any, listId);
    const entries = pl.entries.map((e) => ({
      id: e.id,
      title: e.title,
      duration: 0, // exact duration is resolved at download time (per-video mint)
      url: `https://www.youtube.com/watch?v=${e.id}`,
      uploader: '',
    }));
    return c.json({ title: pl.title || 'Playlist', count: entries.length, entries: entries.slice(0, 500), yt_playlist_id: listId });
  } catch (e: any) {
    return c.json({ error: `enumeration failed: ${String(e?.message || e).slice(0, 120)}` }, 502);
  }
});

/** Site playlist for a scribe batch: reuse by YouTube playlist id, else create. */
async function playlistForBatch(env: Env, title: string, ytId: string | null, videoTitles?: string[], channel?: string): Promise<number> {
  let row: any = ytId
    ? await env.DB.prepare('SELECT id FROM playlists WHERE yt_playlist_id = ?').bind(ytId).first()
    : null;
  if (!row) row = await env.DB.prepare('SELECT id FROM playlists WHERE title = ?1 OR title_ar = ?1').bind(title).first();
  if (row) {
    if (ytId) await env.DB.prepare('UPDATE playlists SET yt_playlist_id = COALESCE(yt_playlist_id, ?) WHERE id = ?').bind(ytId, row.id).run();
    return row.id;
  }
  // The site is English-first: an Arabic source title moves to title_ar and the AI
  // supplies the English title (which drives the slug) plus a description. A batch
  // still queues if the AI call fails; the admin's AI-fill can finish the job later.
  const isArabic = /[؀-ۿ]/.test(title);
  let en = title, ar: string | null = isArabic ? title : null, desc: string | null = null;
  try {
    const out: any = await aiFill(env, 'playlist', { title, videoTitles, channel });
    if (isArabic && out?.title && !/[؀-ۿ]/.test(out.title)) en = String(out.title).trim();
    if (!ar && out?.title_ar) ar = String(out.title_ar).trim();
    if (out?.description) desc = String(out.description).trim();
  } catch {}
  const base = en.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'playlist';
  let slug = base;
  for (let n = 2; await env.DB.prepare('SELECT 1 FROM playlists WHERE slug = ?').bind(slug).first(); n++) slug = `${base}-${n}`;
  const ins: any = await env.DB.prepare('INSERT INTO playlists (title, title_ar, slug, description, yt_playlist_id) VALUES (?,?,?,?,?) RETURNING id')
    .bind(en, ar, slug, desc, ytId).first();
  return ins.id;
}

// Queue many URLs at once; optionally group them into a site playlist that
// each job's video joins automatically on publish (in the given order).
app.post('/api/scribe/batch', async (c) => {
  const { urls, target_langs, full_video, playlist } = await c.req.json();
  if (!Array.isArray(urls) || !urls.length) return c.json({ error: 'urls array required' }, 400);
  // ~3 subrequests per job (2 D1 writes + workflow create) against the 1000
  // subrequest budget of a single request — 250 keeps comfortable headroom
  if (urls.length > 250) return c.json({ error: 'max 250 per batch' }, 400);
  const langs = Array.isArray(target_langs) && target_langs.length ? target_langs : ['en'];

  let playlistId: number | null = null;
  let basePos = 0;
  if (playlist?.title) {
    playlistId = await playlistForBatch(c.env, String(playlist.title).trim(), playlist.yt_id || null,
      Array.isArray(playlist.video_titles) ? playlist.video_titles.filter((t: any) => typeof t === 'string') : undefined,
      playlist.channel || undefined);
    // Append after existing videos AND already-queued (unpublished) jobs
    const [pub, queued] = await Promise.all([
      c.env.DB.prepare('SELECT COALESCE(MAX(position), -1) as p FROM playlist_videos WHERE playlist_id = ?').bind(playlistId).first() as Promise<any>,
      c.env.DB.prepare('SELECT COALESCE(MAX(playlist_pos), -1) as p FROM scribe_jobs WHERE playlist_id = ?').bind(playlistId).first() as Promise<any>,
    ]);
    basePos = Math.max((pub?.p ?? -1) + 1, (queued?.p ?? -1) + 1);
  }

  // Channel re-imports must not re-run whole lectures: anything whose
  // YouTube id already has a PUBLISHED site video is skipped outright
  const pubRows: any = await c.env.DB.prepare(
    "SELECT j.url FROM scribe_jobs j JOIN videos v ON v.video_key LIKE 'scribe/' || j.id || '/%' WHERE j.url LIKE '%youtu%'"
  ).all();
  const pubIds = new Set<string>();
  for (const r of pubRows.results as any[]) {
    const v = ytId(r.url || '');
    if (v) pubIds.add(v);
  }
  // and anything with a LIVE job already in flight or finished — re-imports
  // must top up what is missing, not duplicate what is running
  const liveRows: any = await c.env.DB.prepare(
    "SELECT url FROM scribe_jobs WHERE status IN ('running','queued','done') AND url LIKE '%youtu%'"
  ).all();
  for (const r of liveRows.results as any[]) {
    const v = ytId(r.url || '');
    if (v) pubIds.add(v);
  }
  const ids: string[] = [];
  let skippedPublished = 0;
  for (const url of urls) {
    if (!/^https?:\/\//.test(url)) continue;
    const vid = ytId(url);
    if (vid && pubIds.has(vid)) { skippedPublished++; continue; }
    ids.push(await createScribeJob(c.env, url, langs, !!full_video, {}, c.get('user')?.id,
      playlistId != null ? { id: playlistId, pos: basePos + ids.length } : undefined));
  }
  // one browser session pre-mints stream URLs for the whole batch (bounded);
  // download-audio steps then hit the warm cache instead of minting each
  const mintIds = urls.map((u: string) => ytId(u)).filter((v: string | null): v is string => !!v && !pubIds.has(v));
  if (mintIds.length > 1) {
    c.executionCtx.waitUntil((async () => {
      const { browserMintMany } = await import('./scribe/ytbrowser');
      await browserMintMany(c.env as any, mintIds).catch(() => {});
    })());
  }
  return c.json({ created: ids.length, ids, playlist_id: playlistId, skipped_published: skippedPublished });
});

app.post('/api/scribe', async (c) => {
  const { url, target_lang, target_langs, full_video, title, channel, thumb_url, force } = await c.req.json();
  if (!url || !/^https?:\/\//.test(url)) return c.json({ error: 'A valid http(s) URL is required' }, 400);
  const vid0 = ytId(url);
  if (vid0 && !force) {
    const pub: any = await c.env.DB.prepare(
      "SELECT v.slug, v.title FROM scribe_jobs j JOIN videos v ON v.video_key LIKE 'scribe/' || j.id || '/%' WHERE j.url LIKE ? LIMIT 1"
    ).bind(`%${vid0}%`).first();
    if (pub) return c.json({ error: `Already published as /watch/${pub.slug} — pass force to re-run`, published: pub }, 409);
  }
  const langs = Array.isArray(target_langs) && target_langs.length ? target_langs : [target_lang || 'en'];
  const targetLang = langs[0];
  let id = '';
  try {
    id = await createScribeJob(c.env, url, langs, !!full_video, { title, channel, thumb_url }, c.get('user')?.id);
  } catch (err: any) {
    return c.json({ error: 'Failed to start pipeline: ' + err.message }, 500);
  }
  const job = await c.env.DB.prepare('SELECT * FROM scribe_jobs WHERE id = ?').bind(id).first();
  return c.json({ job });
});

app.get('/api/scribe', async (c) => {
  const jobs = await c.env.DB.prepare(
    'SELECT j.*, p.title as playlist_title, p.slug as playlist_slug FROM scribe_jobs j LEFT JOIN playlists p ON p.id = j.playlist_id ORDER BY j.created_at DESC LIMIT 400'
  ).all();
  return c.json({ jobs: jobs.results });
});

// Pipeline health: cron heartbeat, stuck jobs, recent auto-resumes.
// Registered BEFORE /api/scribe/:id, which was shadowing this path (404).
app.get('/api/scribe/sweep-status', async (c) => {
  const [hb, stuckRaw, logs] = await Promise.all([
    c.env.CACHE.get('sweep:heartbeat'),
    c.env.CACHE.get('ops:stuck'),
    c.env.DB.prepare("SELECT target, details, created_at FROM admin_logs WHERE action = 'auto_resume' ORDER BY created_at DESC LIMIT 5").all().catch(() => ({ results: [] })),
  ]);
  let stuck: any[] = [];
  try { stuck = JSON.parse(stuckRaw || '[]'); } catch {}
  return c.json({ heartbeat: hb, stuck, recent_auto_resumes: (logs as any).results });
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

/** AE SQL returns numerics as strings — coerce every row value that looks numeric. */
function aeRows(res: any): any[] {
  return (res?.data || []).map((row: any) => {
    const out: any = {};
    for (const [k, v] of Object.entries(row)) {
      out[k] = typeof v === 'string' && v !== '' && !isNaN(Number(v)) && k !== 'day' ? Number(v) : v;
    }
    return out;
  });
}

/** Terminate the job's most recent workflow instance (tracked in wf_instance),
 * falling back to the base id. Prevents zombie instances from re-writing artifacts. */
async function terminateJob(env: Env, job: any) {
  for (const iid of [...new Set([job.wf_instance, job.id].filter(Boolean))]) {
    try { await (await env.SCRIBE_WORKFLOW.get(iid)).terminate(); } catch {}
  }
}

app.delete('/api/scribe/:id', async (c) => {
  const id = c.req.param('id');
  const job: any = await c.env.DB.prepare('SELECT * FROM scribe_jobs WHERE id = ?').bind(id).first();
  if (!job) return c.json({ error: 'Not found' }, 404);
  const ref = await c.env.DB.prepare("SELECT slug FROM videos WHERE video_key LIKE 'scribe/' || ? || '/%' LIMIT 1").bind(id).first();
  if (ref) return c.json({ error: `Published video /watch/${(ref as any).slug} uses this job's media — delete the video first` }, 400);
  await terminateJob(c.env, job);
  // Remove artifacts
  const list = await c.env.MEDIA_BUCKET.list({ prefix: `scribe/${id}/` });
  for (const obj of list.objects) await c.env.MEDIA_BUCKET.delete(obj.key);
  await c.env.DB.prepare('DELETE FROM scribe_jobs WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

// Resume a failed job from its last completed artifact (download/ASR reused)
app.post('/api/scribe/:id/resume', async (c) => {
  const id = c.req.param('id');
  const job: any = await c.env.DB.prepare('SELECT * FROM scribe_jobs WHERE id = ?').bind(id).first();
  if (!job) return c.json({ error: 'Not found' }, 404);
  await terminateJob(c.env, job);
  const langs = JSON.parse(job.target_langs || `["${job.target_lang}"]`);
  const instance = `${id}-r${genJobId().slice(0, 4)}`;
  await c.env.DB.prepare("UPDATE scribe_jobs SET status = 'queued', error = NULL, wf_instance = ? WHERE id = ?").bind(instance, id).run();
  await c.env.SCRIBE_WORKFLOW.create({
    id: instance,
    params: { jobId: id, url: job.url, targetLang: langs[0], targetLangs: langs, fullVideo: !!job.full_video },
  });
  return c.json({ ok: true, resumed: true, instance });
});

// Fetch the video track for an audio-only job: transcript + subtitles are
// reused, only download (+ render/done) re-run. Unlocks publish + native preview.
// Direct image upload to R2 (thumbs/ uploads also mirror into MEDIA_KV,
// which is where the site serves thumbnails from)
app.post('/api/upload', async (c) => {
  const prefix = (c.req.query('prefix') || 'uploads/').replace(/[^\w/-]/g, '');
  const ct = c.req.header('content-type') || '';
  if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(ct)) return c.json({ error: 'Image uploads only (jpeg/png/webp/gif/avif)' }, 400);
  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength > 8 * 1024 * 1024) return c.json({ error: 'Max 8MB' }, 400);
  if (!bytes.byteLength) return c.json({ error: 'Empty upload' }, 400);
  const ext = ct.split('/')[1].replace('jpeg', 'jpg');
  const base = (c.req.query('name') || 'image').toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'image';
  const key = `${prefix}${base}-${Date.now().toString(36)}.${ext}`;
  await c.env.MEDIA_BUCKET.put(key, bytes, { httpMetadata: { contentType: ct } });
  if (key.startsWith('thumbs/')) {
    await (c.env as any).MEDIA_KV?.put(key, bytes, { metadata: { ct } }).catch(() => {});
    // Bake the -{320,480,640}w.webp variants the site actually serves
    c.executionCtx.waitUntil(bakeThumbVariants(c.env as any, key).catch(() => {}));
  }
  return c.json({ key });
});

// ---- Companion coordination ----------------------------------------------
// Live presence + work offloading for DeenSubs Companion apps. Downloads and
// speech enhancement claim like the 4K queue; presence flows over WebSockets
// through the CompanionHub DO (see /ws/companion below, outside this auth
// middleware, with its own auth).

app.get('/api/companion/roster', async (c) => {
  const { onlineCompanions } = await import('./companion');
  return c.json({ companions: await onlineCompanions(c.env) });
});

app.post('/api/companion/download/claim', async (c) => {
  // Companion downloads are RETIRED — all downloading now runs via Browser
  // Rendering on Cloudflare. Never hand a download job to a companion (even an
  // old build that still polls this): the companion only enhances/encodes now.
  return c.json({ job: null, retired: true });
});

app.post('/api/companion/download/complete', async (c) => {
  const { job_id, key, meta } = await c.req.json();
  if (!job_id || !key || !key.startsWith(`scribe/${job_id}/source.`)) {
    return c.json({ error: 'job_id and key scribe/<job_id>/source.<ext> required' }, 400);
  }
  const job: any = await c.env.DB.prepare('SELECT source_key, dl_status, full_video FROM scribe_jobs WHERE id = ?').bind(job_id).first();
  if (!job) return c.json({ error: 'job not found' }, 404);
  if (job.source_key) return c.json({ error: 'job already has a source (container beat you to it)' }, 409);
  const head = await c.env.MEDIA_BUCKET.head(key);
  if (!head || head.size < 100_000) return c.json({ error: 'uploaded file missing or too small in R2' }, 400);
  const m = meta || {};
  await c.env.DB.prepare(
    `UPDATE scribe_jobs SET source_key = ?, dl_status = 'done', download_method = 'companion',
       download_pct = 100,
       title = COALESCE(title, ?), channel = COALESCE(channel, ?), thumb_url = COALESCE(thumb_url, ?),
       duration = CASE WHEN COALESCE(duration, 0) = 0 THEN ? ELSE duration END,
       orig_description = COALESCE(orig_description, ?), yt_id = COALESCE(yt_id, ?),
       k4_status = CASE WHEN full_video = 1 THEN ? ELSE k4_status END
     WHERE id = ?`
  ).bind(
    key,
    m.title || null, m.channel || null, m.thumbnail || null,
    Math.round(Number(m.duration) || 0),
    (m.description || '').slice(0, 5000) || null, m.yt_id || null,
    m.four_k ? 'capable' : 'none',
    job_id
  ).run();
  // wake the waiting workflow instantly instead of leaving it to its poll
  try {
    const inst = await (c.env as any).SCRIBE_WORKFLOW.get(job_id);
    await inst.sendEvent({ type: 'download-complete', payload: {} });
  } catch { /* instance finished or errored; the poll fallback covers it */ }
  return c.json({ ok: true });
});

app.post('/api/companion/download/release', async (c) => {
  const { job_id, failed } = await c.req.json();
  await c.env.DB.prepare(
    "UPDATE scribe_jobs SET dl_status = ?, dl_claimed_by = NULL, dl_claimed_at = NULL WHERE id = ? AND dl_status = 'claimed'"
  ).bind(failed ? 'failed' : 'wanted', job_id).run();
  // failures propagate immediately too: the waiter re-reads state and reacts
  try {
    const inst = await (c.env as any).SCRIBE_WORKFLOW.get(job_id);
    await inst.sendEvent({ type: 'download-complete', payload: { failed: !!failed } });
  } catch {}
  return c.json({ ok: true });
});

app.post('/api/companion/enhance/claim', async (c) => {
  const body: any = await c.req.json().catch(() => ({}));
  // Requeue orphaned claims fast: if the claiming device dropped off the
  // presence hub (crash, sleep, network loss), its claim goes back to
  // 'wanted' after 5 minutes so another online companion picks it up —
  // the 3 h wall stays as the hard fallback for zombie connections.
  try {
    const { onlineCompanions } = await import('./companion');
    const online = (await onlineCompanions(c.env as any)).map((x) => x.name);
    const stale: any = await c.env.DB.prepare(
      "SELECT id, se_claimed_by FROM scribe_jobs WHERE se_status = 'claimed' AND se_claimed_at < unixepoch() - 300"
    ).all();
    for (const row of (stale.results || []) as any[]) {
      if (!online.includes(row.se_claimed_by)) {
        await c.env.DB.prepare(
          "UPDATE scribe_jobs SET se_status = 'wanted', se_claimed_by = NULL, se_claimed_at = NULL WHERE id = ? AND se_status = 'claimed'"
        ).bind(row.id).run();
      }
    }
  } catch {}
  const job: any = await c.env.DB.prepare(
    `UPDATE scribe_jobs SET se_status='claimed', se_claimed_by=?, se_claimed_at=unixepoch()
     WHERE id = (SELECT id FROM scribe_jobs
       WHERE se_status = 'wanted' OR (se_status = 'claimed' AND se_claimed_at < unixepoch() - 10800)
       ORDER BY created_at LIMIT 1)
     RETURNING id, source_key, duration, title`
  ).bind(String(body.worker || 'companion').slice(0, 40)).first();
  return c.json({ job: job || null });
});

app.post('/api/companion/enhance/complete', async (c) => {
  const { job_id, key, duration } = await c.req.json();
  if (!job_id || !key || key !== `scribe/${job_id}/source-enhanced.m4a`) {
    return c.json({ error: 'job_id and key scribe/<job_id>/source-enhanced.m4a required' }, 400);
  }
  const job: any = await c.env.DB.prepare('SELECT duration, se_status FROM scribe_jobs WHERE id = ?').bind(job_id).first();
  if (!job) return c.json({ error: 'job not found' }, 404);
  const head = await c.env.MEDIA_BUCKET.head(key);
  if (!head || head.size < 50_000) return c.json({ error: 'enhanced file missing or too small in R2' }, 400);
  // The Sidon ideal-timeline contract guarantees exact duration; anything
  // beyond encoder padding tolerance means broken alignment — reject.
  if (job.duration > 0 && Math.abs(Number(duration) - job.duration) > 0.15) {
    return c.json({ error: `duration contract violated: job ${job.duration}s vs enhanced ${duration}s` }, 400);
  }
  // Capture the pre-swap key: it IS the original recording
  const origRow: any = await c.env.DB.prepare('SELECT source_key FROM scribe_jobs WHERE id = ?').bind(job_id).first();
  await c.env.DB.prepare(
    "UPDATE scribe_jobs SET source_key = ?, speech_enhanced = 1, se_status = 'done' WHERE id = ?"
  ).bind(key, job_id).run();
  // If this job is ALREADY published (an enhancement finishing after a
  // publish or during a re-run), sync the live video row immediately: the
  // site must play the enhanced file, show the badge, and keep the original
  // selectable. This is the moment the swap happens, so nothing can desync.
  const vid: any = await c.env.DB.prepare(
    "SELECT id FROM videos WHERE video_key LIKE 'scribe/' || ? || '/%' AND video_key != ?"
  ).bind(job_id, key).first();
  if (vid) {
    const orig = origRow?.source_key && !/-enhanced\./.test(origRow.source_key) ? origRow.source_key : null;
    await c.env.DB.prepare('UPDATE videos SET video_key = ?, speech_enhanced = 1, orig_key = COALESCE(orig_key, ?), media_v = COALESCE(media_v, 0) + 1 WHERE id = ?')
      .bind(key, orig, vid.id).run();
    afterVideoSave(c, {});
  }
  try {
    const inst = await (c.env as any).SCRIBE_WORKFLOW.get(job_id);
    await inst.sendEvent({ type: 'enhance-complete', payload: {} });
  } catch { /* instance done or errored; the poll fallback covers it */ }

  return c.json({ ok: true });
});

app.post('/api/companion/enhance/release', async (c) => {
  const { job_id, failed } = await c.req.json();
  await c.env.DB.prepare(
    "UPDATE scribe_jobs SET se_status = ?, se_claimed_by = NULL, se_claimed_at = NULL WHERE id = ? AND se_status = 'claimed'"
  ).bind(failed ? 'failed' : 'wanted', job_id).run();
  try {
    const inst = await (c.env as any).SCRIBE_WORKFLOW.get(job_id);
    await inst.sendEvent({ type: 'enhance-complete', payload: { failed: true } });
  } catch {}

  return c.json({ ok: true });
});

app.get('/api/companion/proxies', async (c) => {
  const { parseProxies, maskProxy } = await import('./companion');
  const list = parseProxies(c.env);
  const lock: any = await c.env.DB.prepare(
    "SELECT holder, until FROM locks WHERE name = 'download' AND until > unixepoch()"
  ).first().catch(() => null);
  const sel: any = await c.env.DB.prepare("SELECT value FROM config WHERE name = 'active_proxy'").first().catch(() => null);
  const target: any = await c.env.DB.prepare("SELECT value FROM config WHERE name = 'download_target'").first().catch(() => null);
  return c.json({
    proxies: list.map((p, i) => ({ index: i, label: maskProxy(p) })),
    selected: sel?.value ?? 'auto',
    target: String(target?.value || ''),
    busy: !!lock,
    busy_job: lock?.holder || null,
  });
});

// Where download work is routed: '' any companion (proxy fallback),
// 'proxy' container only, or a companion instance name.
app.post('/api/companion/target', async (c) => {
  const { target } = await c.req.json();
  await c.env.DB.prepare(
    "INSERT INTO config (name, value) VALUES ('download_target', ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value"
  ).bind(String(target || '').slice(0, 40)).run();
  return c.json({ ok: true, target: String(target || '') });
});

app.post('/api/companion/proxies/select', async (c) => {
  const { index } = await c.req.json();
  const lock: any = await c.env.DB.prepare(
    "SELECT holder FROM locks WHERE name = 'download' AND until > unixepoch()"
  ).first().catch(() => null);
  if (lock) return c.json({ error: `proxy is downloading job ${lock.holder} — wait for it to finish` }, 409);
  const value = index === 'auto' ? 'auto' : String(parseInt(index));
  if (value !== 'auto' && isNaN(parseInt(value))) return c.json({ error: 'index or "auto" required' }, 400);
  await c.env.DB.prepare(
    "INSERT INTO config (name, value) VALUES ('active_proxy', ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value"
  ).bind(value).run();
  return c.json({ ok: true, selected: value });
});

// ---- 4K upgrade queue ----------------------------------------------------
// Local encoder machines (any number, any OS) coordinate through these:
// claim atomically hands out one job at a time, stale claims (4h) recycle,
// complete verifies the upload then repoints the job + published video to
// the new file and deletes the 1080p original.

app.post('/api/scribe/4k/claim', async (c) => {
  const body: any = await c.req.json().catch(() => ({}));
  const job: any = await c.env.DB.prepare(
    `UPDATE scribe_jobs SET k4_status='claimed', k4_claimed_by=?, k4_claimed_at=unixepoch()
     WHERE id = (SELECT id FROM scribe_jobs
       WHERE full_video = 1
         AND (k4_status = 'capable' OR (k4_status = 'claimed' AND k4_claimed_at < unixepoch() - 14400))
       ORDER BY created_at LIMIT 1)
     RETURNING id, url, title, source_key`
  ).bind(String(body.worker || 'anon').slice(0, 60)).first();
  return c.json({ job: job || null });
});

app.post('/api/scribe/4k/complete', async (c) => {
  const { job_id, key } = await c.req.json();
  if (!job_id || !key || key !== `scribe/${job_id}/source-4k.mp4`) {
    return c.json({ error: 'job_id and key scribe/<job_id>/source-4k.mp4 required' }, 400);
  }
  const head = await c.env.MEDIA_BUCKET.head(key);
  if (!head || head.size < 10_000_000) return c.json({ error: '4K file missing or suspiciously small in R2 — upload first' }, 400);
  const job: any = await c.env.DB.prepare('SELECT source_key FROM scribe_jobs WHERE id = ?').bind(job_id).first();
  if (!job) return c.json({ error: 'job not found' }, 404);
  const old = job.source_key;
  await c.env.DB.prepare("UPDATE scribe_jobs SET source_key = ?, k4_status = 'done' WHERE id = ?").bind(key, job_id).run();
  if (old && old !== key) {
    await c.env.DB.prepare('UPDATE videos SET video_key = ? WHERE video_key = ?').bind(key, old).run();
    await c.env.MEDIA_BUCKET.delete(old).catch(() => {});
  }
  return c.json({ ok: true, replaced: old || null });
});

app.post('/api/scribe/4k/release', async (c) => {
  // demote:true = the claim was wrong (no >1080p stream actually available)
  const { job_id, demote } = await c.req.json();
  await c.env.DB.prepare(
    "UPDATE scribe_jobs SET k4_status = ?, k4_claimed_by = NULL, k4_claimed_at = NULL WHERE id = ? AND k4_status = 'claimed'"
  ).bind(demote ? 'none' : 'capable', job_id).run();
  return c.json({ ok: true });
});

// Chunked upload for the 4K encoder app — multi-GB files stream through the
// Worker into R2 multipart, so local machines need no R2 credentials at all.
app.post('/api/scribe/4k/upload/start', async (c) => {
  const { job_id } = await c.req.json();
  if (!job_id) return c.json({ error: 'job_id required' }, 400);
  const key = `scribe/${job_id}/source-4k.mp4`;
  const mpu = await c.env.MEDIA_BUCKET.createMultipartUpload(key, {
    httpMetadata: { contentType: 'video/mp4' },
  });
  return c.json({ key, uploadId: mpu.uploadId });
});

app.put('/api/scribe/4k/upload/part', async (c) => {
  const key = c.req.query('objkey') || '';
  const uploadId = c.req.query('uploadId') || '';
  const part = parseInt(c.req.query('part') || '0');
  if (!key.startsWith('scribe/') || !uploadId || !part) return c.json({ error: 'objkey, uploadId, part required' }, 400);
  const body = await c.req.arrayBuffer();
  if (!body.byteLength) return c.json({ error: 'empty part' }, 400);
  const mpu = c.env.MEDIA_BUCKET.resumeMultipartUpload(key, uploadId);
  const uploaded = await mpu.uploadPart(part, body);
  return c.json({ partNumber: uploaded.partNumber, etag: uploaded.etag });
});

app.post('/api/scribe/4k/upload/finish', async (c) => {
  const { objkey, uploadId, parts, abort } = await c.req.json();
  if (!objkey?.startsWith('scribe/') || !uploadId) return c.json({ error: 'objkey and uploadId required' }, 400);
  const mpu = c.env.MEDIA_BUCKET.resumeMultipartUpload(objkey, uploadId);
  if (abort) {
    await mpu.abort().catch(() => {});
    return c.json({ ok: true, aborted: true });
  }
  if (!Array.isArray(parts) || !parts.length) return c.json({ error: 'parts required' }, 400);
  const obj = await mpu.complete(parts);
  return c.json({ ok: true, size: obj.size });
});

// Local media upload → Scribe job (drag & drop in the admin). start allocates
// the job id + R2 multipart; parts stream through /api/scribe/4k/upload/part
// (already generic over scribe/* keys); finish completes the object and starts
// the pipeline with the download step pre-satisfied (source_key in R2,
// download_method='upload'). Video files are always full_video (the source IS
// the video — there is nothing to fetch later); audio files publish as
// audiobooks.
const UPLOAD_EXT = /\.(mp4|webm|mkv|mov|m4a|mp3|wav|aac|ogg|opus|flac)$/i;
app.post('/api/scribe/upload/start', async (c) => {
  const { filename, content_type, size } = await c.req.json();
  const ext = UPLOAD_EXT.exec(filename || '')?.[1]?.toLowerCase();
  if (!ext) return c.json({ error: 'Unsupported file — video (mp4/webm/mkv/mov) or audio (mp3/m4a/wav/aac/ogg/opus/flac)' }, 400);
  if (typeof size === 'number' && size > 8e9) return c.json({ error: 'File too large (8 GB max)' }, 400);
  const jobId = genJobId();
  const key = `scribe/${jobId}/source.${ext}`;
  const mpu = await c.env.MEDIA_BUCKET.createMultipartUpload(key, {
    httpMetadata: { contentType: content_type || 'application/octet-stream' },
  });
  return c.json({ job_id: jobId, key, uploadId: mpu.uploadId });
});

app.post('/api/scribe/upload/finish', async (c) => {
  const { job_id, objkey, uploadId, parts, abort, filename, duration, target_langs } = await c.req.json();
  if (!job_id || !objkey?.startsWith(`scribe/${job_id}/`) || !uploadId) return c.json({ error: 'job_id, objkey, uploadId required' }, 400);
  const mpu = c.env.MEDIA_BUCKET.resumeMultipartUpload(objkey, uploadId);
  if (abort) {
    await mpu.abort().catch(() => {});
    return c.json({ ok: true, aborted: true });
  }
  if (!Array.isArray(parts) || !parts.length) return c.json({ error: 'parts required' }, 400);
  await mpu.complete(parts);
  const langs = Array.isArray(target_langs) && target_langs.length ? target_langs : ['en'];
  const title = String(filename || job_id).replace(/\.[^.]+$/, '');
  const isVideo = /\.(mp4|webm|mkv|mov)$/i.test(objkey);
  let id = '';
  try {
    id = await createScribeJob(c.env, 'upload://' + (filename || objkey), langs, isVideo, { title }, c.get('user')?.id, undefined, {
      id: job_id, sourceKey: objkey, duration: Math.max(0, Math.round(+duration || 0)),
    });
  } catch (err: any) {
    return c.json({ error: 'Failed to start pipeline: ' + err.message }, 500);
  }
  const job = await c.env.DB.prepare('SELECT * FROM scribe_jobs WHERE id = ?').bind(id).first();
  return c.json({ job });
});

app.get('/api/scribe/4k/stats', async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT k4_status as s, COUNT(*) as n, GROUP_CONCAT(DISTINCT k4_claimed_by) as who FROM scribe_jobs WHERE k4_status IS NOT NULL AND k4_status != '' GROUP BY k4_status"
  ).all();
  const out: any = { capable: 0, claimed: 0, done: 0, none: 0, workers: '' };
  for (const r of rows.results as any[]) {
    out[r.s] = r.n;
    if (r.s === 'claimed') out.workers = r.who || '';
  }
  return c.json(out);
});

app.get('/api/scribe/4k/pending-scan', async (c) => {
  // Backfill: video jobs from before capability flagging existed
  const rows = await c.env.DB.prepare(
    "SELECT id, url FROM scribe_jobs WHERE full_video = 1 AND (k4_status IS NULL OR k4_status = '') AND url LIKE '%youtu%' ORDER BY created_at DESC LIMIT 200"
  ).all();
  return c.json({ jobs: rows.results });
});

app.post('/api/scribe/4k/flag', async (c) => {
  const { job_id, capable } = await c.req.json();
  await c.env.DB.prepare(
    "UPDATE scribe_jobs SET k4_status = ? WHERE id = ? AND (k4_status IS NULL OR k4_status = '')"
  ).bind(capable ? 'capable' : 'none', job_id).run();
  return c.json({ ok: true });
});

// ElevenLabs stores every Scribe transcription — these endpoints recover
// transcripts that were paid for but lost to transport errors (e.g. 524s),
// so a job never has to be transcribed twice.
// Temporary diagnostics: what does ElevenLabs actually return for
// additional_formats (create-sync) and for a stored transcript (get)?
// Controlled LLM experiments through the production router (diagnostics)
app.post('/api/scribe/llm-test', async (c) => {
  const { messages, max_tokens, model } = await c.req.json();
  const { llmChat } = await import('./scribe/translate');
  try {
    const raw = await llmChat(c.env as any, messages, max_tokens || 4000, model);
    return c.json({ ok: true, raw });
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message || e) });
  }
});

app.post('/api/scribe/stt-format-test', async (c) => {
  const { url, formats, model, webhook, granularity } = await c.req.json();
  const form = new FormData();
  form.append('model_id', model || 'scribe_v2');
  form.append('cloud_storage_url', url);
  form.append('diarize', 'true');
  if (granularity) form.append('timestamps_granularity', granularity);
  form.append('additional_formats', JSON.stringify(formats || [{ format: 'txt' }, { format: 'segmented_json' }]));
  if (webhook) form.append('webhook', 'true');
  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST', headers: { 'xi-api-key': c.env.ELEVENLABS_API_KEY! }, body: form,
  });
  const body: any = await res.json().catch(async () => ({ raw: await res.text() }));
  const t = body.words ? body : body.transcription || body;
  return c.json({
    status: res.status,
    keys: Object.keys(body),
    formats: (t.additional_formats || []).map((f: any) => ({
      requested_format: f.requested_format, is_base64_encoded: f.is_base64_encoded,
      content_len: (f.content || '').length, head: (f.content || '').slice(0, 120),
    })),
    word_sample: (t.words || []).filter((w: any) => (w.type || 'word') === 'word').slice(0, 2),
    error: body.detail || body.error || null,
  });
});

app.get('/api/scribe/stt-get-raw/:tid', async (c) => {
  const res = await fetch(`https://api.elevenlabs.io/v1/speech-to-text/transcripts/${c.req.param('tid')}`, {
    headers: { 'xi-api-key': c.env.ELEVENLABS_API_KEY! },
  });
  const body: any = await res.json().catch(() => ({}));
  const t = body.words ? body : body.transcription || body;
  return c.json({
    status: res.status, keys: Object.keys(body),
    formats: (t.additional_formats || []).map((f: any) => ({ requested_format: f.requested_format, content_len: (f.content || '').length })),
  });
});

app.post('/api/scribe/audioclip-test', async (c) => {
  const { url, start, dur } = await c.req.json();
  const { containerCall } = await import('./scribe/asr');
  const res = await containerCall(c.env as any, 'aclip-test', '/audioclip', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, start: start || 0, dur: dur || 30 }),
  });
  const body: any = await res.json().catch(() => ({}));
  return c.json({ status: res.status, bytes: body.bytes || 0, b64_len: (body.b64 || '').length, error: body.error || null });
});

app.get('/api/scribe/stt-transcripts', async (c) => {
  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text/transcripts?page_size=30', {
    headers: { 'xi-api-key': c.env.ELEVENLABS_API_KEY! },
  });
  return c.json(await res.json() as any, res.status as any);
});

app.post('/api/scribe/:id/import-asr', async (c) => {
  // body: { transcript_ids: [...] } in chronological segment order; each
  // segment's words are offset by the accumulated duration and merged into
  // the exact asr.json shape the pipeline writes itself.
  const jobId = c.req.param('id');
  const { transcript_ids } = await c.req.json();
  if (!Array.isArray(transcript_ids) || !transcript_ids.length) return c.json({ error: 'transcript_ids required' }, 400);
  const allWords: any[] = [];
  let text = '';
  let languageCode = '';
  let acc = 0;
  for (const tid of transcript_ids) {
    const res = await fetch(`https://api.elevenlabs.io/v1/speech-to-text/transcripts/${tid}`, {
      headers: { 'xi-api-key': c.env.ELEVENLABS_API_KEY! },
    });
    if (!res.ok) return c.json({ error: `transcript ${tid}: HTTP ${res.status} ${(await res.text()).slice(0, 150)}` }, 502);
    const seg: any = await res.json();
    const data = seg.transcription || seg;
    if (!languageCode) languageCode = data.language_code || '';
    text += (text ? ' ' : '') + (data.text || '');
    const words = data.words || [];
    let segEnd = 0;
    for (const w of words) {
      allWords.push({ ...w, start: w.start + acc, end: w.end + acc });
      segEnd = Math.max(segEnd, w.end || 0);
    }
    acc += data.audio_duration_secs || segEnd;
  }
  if (!allWords.length) return c.json({ error: 'no words in the given transcripts' }, 400);
  const asrKey = `scribe/${jobId}/asr.json`;
  await c.env.MEDIA_BUCKET.put(asrKey, JSON.stringify({
    language_code: languageCode, text, words: allWords, audio_duration_secs: acc,
  }), { httpMetadata: { contentType: 'application/json' } });
  await c.env.DB.prepare('UPDATE scribe_jobs SET asr_key = ? WHERE id = ?').bind(asrKey, jobId).run();
  return c.json({ ok: true, asrKey, words: allWords.length, durationSec: Math.round(acc) });
});


// Quality report (mechanical metrics + semantic audit); POST re-runs it
app.get('/api/scribe/:id/quality', async (c) => {
  const lang = c.req.query('lang');
  const suffix = lang && lang !== 'primary' ? `.${lang}` : '';
  const obj = await c.env.MEDIA_BUCKET.get(`scribe/${c.req.param('id')}/quality${suffix}.json`);
  if (!obj) return c.json({ error: 'No quality report yet' }, 404);
  return c.json(await obj.json());
});
app.post('/api/scribe/:id/quality', async (c) => {
  const id = c.req.param('id');
  const job: any = await c.env.DB.prepare('SELECT * FROM scribe_jobs WHERE id = ?').bind(id).first();
  if (!job) return c.json({ error: 'Not found' }, 404);
  try {
    const { assessQuality } = await import('./scribe/quality');
    return c.json(await assessQuality(c.env as any, id, `scribe/${id}/cues.json`));
  } catch (e: any) {
    return c.json({ error: String(e?.message || e).slice(0, 300) }, 500);
  }
});

// AI image generation / editing / brand re-grade
app.post('/api/ai/image', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try {
    const { aiImage } = await import('./ai/image');
    return c.json(await aiImage(c.env as any, body.kind, body));
  } catch (e: any) {
    return c.json({ error: String(e?.message || e).slice(0, 300) }, 500);
  }
});

// AI drafts any admin form (see ai/fill.ts for kinds)
app.post('/api/ai/fill', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try {
    return c.json(await aiFill(c.env, body.kind, body));
  } catch (e: any) {
    return c.json({ error: String(e?.message || e).slice(0, 300) }, 500);
  }
});

app.post('/api/scribe/:id/fetch-video', async (c) => {
  const id = c.req.param('id');
  const job: any = await c.env.DB.prepare('SELECT * FROM scribe_jobs WHERE id = ?').bind(id).first();
  if (!job) return c.json({ error: 'Not found' }, 404);
  if (/\.(mp4|webm|mkv|mov)$/i.test(job.source_key || '')) return c.json({ error: 'Job already has video' }, 400);
  // Local uploads have no URL to fetch from — and this endpoint deletes the
  // source before re-downloading, which would destroy the only copy.
  if ((job.url || '').startsWith('upload://')) return c.json({ error: 'This job came from a local upload — there is no video to fetch. Publish it as an audiobook instead.' }, 400);
  await terminateJob(c.env, job);
  if (job.source_key) await c.env.MEDIA_BUCKET.delete(job.source_key).catch(() => {});
  const langs = JSON.parse(job.target_langs || `["${job.target_lang}"]`);
  const instance = `${id}-v${genJobId().slice(0, 4)}`;
  await c.env.DB.prepare("UPDATE scribe_jobs SET status = 'queued', step = 'download', error = NULL, download_pct = 0, source_key = NULL, full_video = 1, wf_instance = ? WHERE id = ?").bind(instance, id).run();
  await c.env.SCRIBE_WORKFLOW.create({
    id: instance,
    params: { jobId: id, url: job.url, targetLang: langs[0], targetLangs: langs, fullVideo: true },
  });
  return c.json({ ok: true, fetching: true });
});

// Force a fresh translation (clears cue artifacts, keeps download + ASR)
app.post('/api/scribe/:id/retranslate-all', async (c) => {
  const id = c.req.param('id');
  const job: any = await c.env.DB.prepare('SELECT * FROM scribe_jobs WHERE id = ?').bind(id).first();
  if (!job) return c.json({ error: 'Not found' }, 404);
  await terminateJob(c.env, job);
  const langs = JSON.parse(job.target_langs || `["${job.target_lang}"]`);
  const list = await c.env.MEDIA_BUCKET.list({ prefix: `scribe/${id}/` });
  for (const o of list.objects) {
    if (/\/(cues.*\.json|[a-z]{2}\.srt|source\.srt|chapters\.json|meta\.json)$/.test(o.key)) {
      await c.env.MEDIA_BUCKET.delete(o.key);
    }
  }
  const instance = `${id}-r${genJobId().slice(0, 4)}`;
  await c.env.DB.prepare("UPDATE scribe_jobs SET status = 'queued', step = 'translate', error = NULL, cue_count = 0, llm_tokens = 0, wf_instance = ? WHERE id = ?").bind(instance, id).run();
  await c.env.SCRIBE_WORKFLOW.create({
    id: instance,
    params: { jobId: id, url: job.url, targetLang: langs[0], targetLangs: langs, fullVideo: !!job.full_video },
  });
  return c.json({ ok: true, retranslating: true });
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

// Convert a finished VIDEO job into an audiobook: a fresh audio job re-runs
// the audiobook translation/transcript pipeline, but the stored ElevenLabs
// transcription rides along; the ASR step short-circuits on an existing
// asr.json, so conversion costs zero transcription credits.
app.post('/api/scribe/:id/to-audiobook', async (c) => {
  const id = c.req.param('id');
  const job: any = await c.env.DB.prepare('SELECT * FROM scribe_jobs WHERE id = ?').bind(id).first();
  if (!job) return c.json({ error: 'job not found' }, 404);
  if (!job.full_video) return c.json({ error: 'already an audio job' }, 400);
  const asrObj = await c.env.MEDIA_BUCKET.get(`scribe/${id}/asr.json`);
  if (!asrObj) return c.json({ error: 'no stored transcription for this job yet' }, 400);
  const asrBytes = await asrObj.arrayBuffer();
  let langs = ['en'];
  try {
    const l = JSON.parse(job.target_langs || '[]');
    if (Array.isArray(l) && l.length) langs = l;
  } catch {}
  let newId = '';
  try {
    newId = await createScribeJob(c.env, job.url, langs, false,
      { title: job.title, channel: job.channel, thumb_url: job.thumb_url }, c.get('user')?.id);
  } catch (err: any) {
    return c.json({ error: 'failed to start audiobook job: ' + err.message }, 500);
  }
  await c.env.MEDIA_BUCKET.put(`scribe/${newId}/asr.json`, asrBytes, {
    httpMetadata: { contentType: 'application/json' },
  });
  return c.json({ ok: true, id: newId });
});

// Diagnostic: prove the translation pipeline's audio-in-the-loop still works
// end to end (container clip -> input_audio part -> Gemini hears it)
app.post('/api/scribe/:id/audio-test', async (c) => {
  const id = c.req.param('id');
  const job: any = await c.env.DB.prepare('SELECT source_key FROM scribe_jobs WHERE id = ?').bind(id).first();
  if (!job?.source_key) return c.json({ error: 'job has no source' }, 400);
  const { windowAudio, llmChat } = await import('./scribe/translate');
  const part = await windowAudio(c.env as any, { jobId: id, sourceUrl: `https://cdn.deensubs.com/${job.source_key}` }, 0, 25);
  if (!part) return c.json({ error: 'audio clip could not be produced (container /audioclip failed)' }, 500);
  const raw = await llmChat(c.env as any, [
    { role: 'system', content: 'You are given an audio clip. Reply with ONLY JSON: {"heard": true|false, "language": "...", "first_words": "quote the first sentence you hear, in its original language"}' },
    { role: 'user', content: [
      { type: 'text', text: 'What do you hear in this clip?' },
      part,
    ] as any },
  ], 2000);
  return c.json({ audio_bytes_b64: (part.input_audio?.data || '').length, model_reply: raw.slice(0, 500) });
});

// Diagnostic: can the mux container fetch BR-minted googlevideo URLs
// directly? (IP-binding test — decides whether downloads can skip the Worker
// streaming + intermediate R2 objects entirely.)
app.post('/api/scribe/mux-test', async (c) => {
  const { video_id } = await c.req.json();
  if (!video_id) return c.json({ error: 'video_id required' }, 400);
  const { browserMintCached } = await import('./scribe/ytbrowser');
  const m: any = await browserMintCached(c.env as any, video_id);
  if (!m?.video?.[0] || !m?.audio?.[0]) {
    return c.json({ error: 'mint has no adaptive formats' }, 500);
  }
  const { muxViaContainer } = await import('./scribe/download');
  const t0 = Date.now();
  try {
    const r = await muxViaContainer(c.env as any, 'muxtest-' + video_id, m.video[0].url, m.audio[0].url);
    return c.json({ ok: true, bytes: r.bytes, key: r.key, ms: Date.now() - t0 });
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message || e).slice(0, 300), ms: Date.now() - t0 });
  }
});

// Diagnostic: time the container yt-dlp + aria2c path (no proxies, no browser)
app.post('/api/scribe/ytdlp-test', async (c) => {
  const { url, video, aria2, player_client } = await c.req.json();
  if (!url) return c.json({ error: 'url required' }, 400);
  const { ytdlpViaContainer } = await import('./scribe/download');
  (c.env as any).__ARIA2 = aria2;
  (c.env as any).__PLAYER_CLIENT = player_client;
  const t0 = Date.now();
  try {
    const r: any = await ytdlpViaContainer(c.env as any, 'dltest-' + Date.now().toString(36), url, !!video);
    return c.json({ ok: true, ms: Date.now() - t0, bytes: r.bytes, key: r.key, mbps: Math.round(r.bytes / 1024 / 1024 / ((Date.now() - t0) / 1000) * 10) / 10 });
  } catch (e: any) {
    return c.json({ ok: false, ms: Date.now() - t0, error: String(e?.message || e).slice(0, 300) });
  }
});

// ---- Thumbnail language review (Arabic artwork -> English replacements) ----
app.post('/api/thumbs/scan', async (c) => {
  const { detectArabicThumb } = await import('./thumbs');
  const rows: any = await c.env.DB.prepare(
    "SELECT id, thumb_key FROM videos WHERE thumb_key IS NOT NULL AND thumb_key != '' AND thumb_lang IS NULL ORDER BY created_at DESC LIMIT 6"
  ).all();
  let scanned = 0, flagged = 0;
  await Promise.all((rows.results as any[]).map(async (v) => {
    const det = await detectArabicThumb(c.env, v.thumb_key);
    const lang = det === null ? 'err' : det.arabic ? 'ar' : 'ok';
    if (lang === 'ar') flagged++;
    scanned++;
    await c.env.DB.prepare('UPDATE videos SET thumb_lang = ? WHERE id = ?').bind(lang, v.id).run();
  }));
  const rem: any = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM videos WHERE thumb_key IS NOT NULL AND thumb_key != '' AND thumb_lang IS NULL"
  ).first();
  return c.json({ scanned, flagged, remaining: rem?.n ?? 0 });
});

app.get('/api/thumbs/review', async (c) => {
  const [items, counts] = await Promise.all([
    c.env.DB.prepare("SELECT id, title, slug, thumb_key, media, created_at FROM videos WHERE thumb_lang = 'ar' ORDER BY created_at DESC").all(),
    c.env.DB.prepare(`SELECT
      SUM(CASE WHEN thumb_lang = 'ar' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN thumb_lang IS NULL AND thumb_key IS NOT NULL AND thumb_key != '' THEN 1 ELSE 0 END) AS unscanned,
      SUM(CASE WHEN thumb_lang = 'accepted' THEN 1 ELSE 0 END) AS accepted,
      SUM(CASE WHEN thumb_lang = 'skipped' THEN 1 ELSE 0 END) AS skipped,
      SUM(CASE WHEN thumb_lang = 'err' THEN 1 ELSE 0 END) AS errors
      FROM videos`).first(),
  ]);
  return c.json({ items: items.results, counts });
});

app.post('/api/thumbs/:id/flag', async (c) => {
  const { status } = await c.req.json();
  if (![null, 'accepted', 'skipped', 'ar'].includes(status)) return c.json({ error: 'bad status' }, 400);
  await c.env.DB.prepare('UPDATE videos SET thumb_lang = ? WHERE id = ?').bind(status, c.req.param('id')).run();
  return c.json({ ok: true });
});

app.post('/api/thumbs/:id/replace', async (c) => {
  const v: any = await c.env.DB.prepare('SELECT id, slug FROM videos WHERE id = ?').bind(c.req.param('id')).first();
  if (!v) return c.json({ error: 'video not found' }, 404);
  const ct = c.req.header('content-type') || '';
  if (!/^image\/(jpeg|png|webp)$/.test(ct)) return c.json({ error: 'jpeg/png/webp only' }, 400);
  const bytes = await c.req.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > 8 * 1024 * 1024) return c.json({ error: 'empty or over 8MB' }, 400);
  const ext = ct.split('/')[1].replace('jpeg', 'jpg');
  const key = `thumbs/${v.slug}-en-${Date.now().toString(36)}.${ext}`;
  await c.env.MEDIA_BUCKET.put(key, bytes, { httpMetadata: { contentType: ct } });
  await bakeThumbVariants(c.env as any, key); // responsive WebPs upfront, never deferred
  await c.env.DB.prepare("UPDATE videos SET thumb_key = ?, thumb_lang = 'ok', media_v = COALESCE(media_v, 0) + 1 WHERE id = ?").bind(key, v.id).run();
  afterVideoSave(c, {});
  return c.json({ ok: true, key });
});

app.post('/api/thumbs/detect', async (c) => {
  const { key } = await c.req.json();
  if (!key) return c.json({ error: 'key required' }, 400);
  const { detectArabicThumb } = await import('./thumbs');
  const det = await detectArabicThumb(c.env, key);
  return c.json(det || { arabic: false, text: '', unknown: true });
});

// ---- Scribe publish flow (job → site video, elite path) ----

import { bakeThumbVariants, generateThumbCandidates, publishScribeJob } from './scribe/publish';

app.post('/api/scribe/:id/thumbs', async (c) => {
  try {
    const candidates = await generateThumbCandidates(c.env as any, c.req.param('id'), c.req.query('refresh') === '1');
    return c.json({ candidates });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// Rebuild the karaoke transcript from stored asr.json + cues (no credits
// spent) — picks up new document features (speaker turns) for old jobs and
// refreshes the published copy when the job is live.
app.post('/api/scribe/:id/rebuild-transcript', async (c) => {
  const jobId = c.req.param('id');
  const job: any = await c.env.DB.prepare('SELECT chapters, title, channel, target_langs, full_video FROM scribe_jobs WHERE id = ?').bind(jobId).first();
  if (!job) return c.json({ error: 'job not found' }, 404);
  if (job.full_video) return c.json({ error: 'not an audiobook job' }, 400);
  const asrObj = await c.env.MEDIA_BUCKET.get(`scribe/${jobId}/asr.json`);
  const cuesObj = await c.env.MEDIA_BUCKET.get(`scribe/${jobId}/cues.json`);
  if (!asrObj || !cuesObj) return c.json({ error: 'asr.json or cues.json missing' }, 404);
  const asr: any = await asrObj.json();
  const cues: any = await cuesObj.json();
  const { buildTranscript, buildSpeakerTxt, nameSpeakers, elevenFormats, alignUnits } = await import('./scribe/audiobook');
  let native = elevenFormats(asr);
  // Legacy jobs never requested exports at create time — ask ElevenLabs'
  // stored transcript once and persist whatever it can still give us.
  if (!native.segments && asr.transcription_id) {
    const res = await fetch(`https://api.elevenlabs.io/v1/speech-to-text/transcripts/${asr.transcription_id}`, {
      headers: { 'xi-api-key': c.env.ELEVENLABS_API_KEY! },
    }).catch(() => null);
    if (res?.ok) {
      const remote: any = await res.json();
      const t = remote.words ? remote : remote.transcription || remote;
      const retro = elevenFormats(t);
      if (retro.segments || retro.txt) {
        native = retro;
        asr.additional_formats = t.additional_formats;
        await c.env.MEDIA_BUCKET.put(`scribe/${jobId}/asr.json`, JSON.stringify(asr), {
          httpMetadata: { contentType: 'application/json' },
        });
      }
    }
  }
  const doc: any = buildTranscript(asr.words || [], cues, job.chapters, native.segments);
  const schRow: any = await c.env.DB.prepare(
    'SELECT s.name AS scholar FROM videos v JOIN scholars s ON s.id = v.scholar_id WHERE v.video_key LIKE ?'
  ).bind(`scribe/${jobId}/%`).first().catch(() => null);
  const scholar: string | null = schRow?.scholar || null;
  if (doc.turns) {
    let existing: string[] | null = null;
    try {
      const prev = await c.env.MEDIA_BUCKET.get(`scribe/${jobId}/transcript.json`);
      const pj: any = prev ? await prev.json() : null;
      if (Array.isArray(pj?.speakers) && !pj.speakers.every((x: string) => /^Speaker \d+$/.test(x))) existing = pj.speakers;
    } catch {}
    // a known featured scholar should appear by name; re-name if he doesn't yet
    if (existing && scholar && !existing.some((x) => x.toLowerCase() === scholar.toLowerCase())) existing = null;
    doc.speakers = existing || await nameSpeakers(c.env as any, doc, { title: job.title, channel: job.channel, scholar });
  }
  doc.align = await alignUnits(c.env as any, doc);
  let lang = 'en';
  try { lang = JSON.parse(job.target_langs || '[]')[0] || 'en'; } catch {}
  const body = JSON.stringify(doc);
  const putJson = (key: string) =>
    c.env.MEDIA_BUCKET.put(key, body, { httpMetadata: { contentType: 'application/json' } });
  const putTxt = (key: string, text: string) =>
    c.env.MEDIA_BUCKET.put(key, text, { httpMetadata: { contentType: 'text/plain; charset=utf-8' } });
  const sourceTxt = native.txt || buildSpeakerTxt(doc, 'source');
  await putJson(`scribe/${jobId}/transcript.json`);
  if (native.txt) await putTxt(`scribe/${jobId}/elevenlabs.txt`, native.txt);
  await putTxt(`scribe/${jobId}/transcript-source.txt`, sourceTxt);
  await putTxt(`scribe/${jobId}/transcript-${lang}.txt`, buildSpeakerTxt(doc, 'translated'));
  const vid: any = await c.env.DB.prepare("SELECT id, slug, video_key FROM videos WHERE video_key LIKE ?").bind(`scribe/${jobId}/%`).first();
  if (vid?.slug) {
    await putJson(`transcripts/${vid.slug}.json`);
    await putTxt(`transcripts/${vid.slug}-source.txt`, sourceTxt);
    await putTxt(`transcripts/${vid.slug}-${lang}.txt`, buildSpeakerTxt(doc, 'translated'));
    // A re-run may have enhanced the job AFTER publish: sync the video row so
    // the site plays the enhanced file (original stays selectable)
    const jrow: any = await c.env.DB.prepare('SELECT source_key, speech_enhanced FROM scribe_jobs WHERE id = ?').bind(jobId).first();
    if (jrow?.speech_enhanced && /-enhanced\.m4a$/.test(jrow.source_key || '') && vid.video_key !== jrow.source_key) {
      const listed = await c.env.MEDIA_BUCKET.list({ prefix: `scribe/${jobId}/source.` });
      const orig = listed.objects.map((o) => o.key).find((k) => !/-enhanced\./.test(k)) || null;
      await c.env.DB.prepare('UPDATE videos SET video_key = ?, speech_enhanced = 1, orig_key = ?, media_v = COALESCE(media_v, 0) + 1 WHERE id = ?')
        .bind(jrow.source_key, orig, vid.id).run();
      afterVideoSave(c, {});
    }
    await c.env.DB.prepare('UPDATE videos SET media_v = COALESCE(media_v, 0) + 1 WHERE id = ?').bind(vid.id).run();
    afterVideoSave(c, {});
  }
  return c.json({ ok: true, turns: doc.turns?.length || 0, speakers: doc.speakers || null, native: !!native.segments, native_txt: !!native.txt, slug: vid?.slug || null, aligned: doc.align.filter((p: any) => p.length).length });
});

app.post('/api/scribe/:id/publish', async (c) => {
  try {
    const opts = await c.req.json();
    const result = await publishScribeJob(c.env as any, c.req.param('id'), opts, c.executionCtx);
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

/** Purge the public site's KV-cached playlist data after any playlist mutation. */
async function purgePlaylistCache(env: Env) {
  for (const prefix of ['playlist', 'video-playlist:', 'cat-playlists:', 'scholar-playlists:', 'home', 'sitemap:']) {
    const list = await env.CACHE.list({ prefix });
    for (const k of list.keys) await env.CACHE.delete(k.name).catch(() => {});
  }
}

app.get('/api/playlists', async (c) => {
  const playlists = await c.env.DB.prepare(
    'SELECT p.*, (SELECT COUNT(*) FROM playlist_videos pv WHERE pv.playlist_id = p.id) as video_count FROM playlists p ORDER BY p.created_at DESC'
  ).all();
  return c.json({ playlists: playlists.results });
});

app.post('/api/playlists', async (c) => {
  const b = await c.req.json();
  if (!b.title) return c.json({ error: 'title required' }, 400);
  const base = (b.slug || b.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'playlist';
  let slug = base;
  for (let n = 2; await c.env.DB.prepare('SELECT 1 FROM playlists WHERE slug = ?').bind(slug).first(); n++) slug = `${base}-${n}`;
  await c.env.DB.prepare('INSERT INTO playlists (title, title_ar, slug, description, cover_key) VALUES (?,?,?,?,?)')
    .bind(b.title, b.title_ar || null, slug, b.description || null, b.cover_key || null).run();
  const playlist = await c.env.DB.prepare('SELECT * FROM playlists WHERE slug = ?').bind(slug).first();
  c.executionCtx.waitUntil(purgePlaylistCache(c.env));
  return c.json({ playlist });
});

// Create the AI-proposed playlists the admin approved in the review modal
app.post('/api/playlists/ai-apply', async (c) => {
  const { playlists } = await c.req.json();
  if (!Array.isArray(playlists) || !playlists.length) return c.json({ error: 'playlists required' }, 400);
  const valid = new Set<number>(
    ((await c.env.DB.prepare('SELECT id FROM videos').all()).results as any[]).map((r) => r.id)
  );
  const created: any[] = [];
  for (const p of playlists.slice(0, 10)) {
    if (!p?.title || !Array.isArray(p.video_ids)) continue;
    const ids = p.video_ids.filter((v: any) => valid.has(v)).slice(0, 500);
    if (!ids.length) continue;
    const base = String(p.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'playlist';
    let slug = base;
    for (let n = 2; await c.env.DB.prepare('SELECT 1 FROM playlists WHERE slug = ?').bind(slug).first(); n++) slug = `${base}-${n}`;
    await c.env.DB.prepare('INSERT INTO playlists (title, slug, description) VALUES (?,?,?)')
      .bind(String(p.title).slice(0, 120), slug, p.description ? String(p.description).slice(0, 500) : null).run();
    const row: any = await c.env.DB.prepare('SELECT id FROM playlists WHERE slug = ?').bind(slug).first();
    let pos = 0;
    for (const vid of ids) {
      await c.env.DB.prepare('INSERT OR IGNORE INTO playlist_videos (playlist_id, video_id, position) VALUES (?,?,?)')
        .bind(row.id, vid, pos++).run();
    }
    created.push({ id: row.id, slug, title: p.title, count: pos });
  }
  c.executionCtx.waitUntil(purgePlaylistCache(c.env));
  return c.json({ created });
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
  c.executionCtx.waitUntil(purgePlaylistCache(c.env));
  return c.json({ ok: true });
});

app.delete('/api/playlists/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM playlists WHERE id = ?').bind(parseInt(c.req.param('id'))).run();
  c.executionCtx.waitUntil(purgePlaylistCache(c.env));
  return c.json({ ok: true });
});

app.post('/api/playlists/:id/videos', async (c) => {
  const id = parseInt(c.req.param('id'));
  const { video_id } = await c.req.json();
  const max: any = await c.env.DB.prepare('SELECT COALESCE(MAX(position), -1) as p FROM playlist_videos WHERE playlist_id = ?').bind(id).first();
  await c.env.DB.prepare('INSERT OR IGNORE INTO playlist_videos (playlist_id, video_id, position) VALUES (?,?,?)')
    .bind(id, video_id, (max?.p ?? -1) + 1).run();
  c.executionCtx.waitUntil(purgePlaylistCache(c.env));
  return c.json({ ok: true });
});

app.delete('/api/playlists/:id/videos/:videoId', async (c) => {
  await c.env.DB.prepare('DELETE FROM playlist_videos WHERE playlist_id = ? AND video_id = ?')
    .bind(parseInt(c.req.param('id')), parseInt(c.req.param('videoId'))).run();
  c.executionCtx.waitUntil(purgePlaylistCache(c.env));
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
  c.executionCtx.waitUntil(purgePlaylistCache(c.env));
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

// One click: find the top moments and render them all
app.post('/api/clips/batch', async (c) => {
  const { job_id, count } = await c.req.json();
  const obj = await c.env.MEDIA_BUCKET.get(`scribe/${job_id}/cues.json`);
  if (!obj) return c.json({ error: 'Job cues not found' }, 404);
  const moments = await suggestMoments(c.env as any, await obj.json(), Math.min(count || 3, 5));
  const created: string[] = [];
  for (const m of moments.slice(0, count || 3)) {
    const id = genJobId();
    await c.env.DB.prepare('INSERT INTO clips (id, job_id, start, end, hook, style, framing, status) VALUES (?,?,?,?,?,?,?,?)')
      .bind(id, job_id, m.start, m.end, m.hook, 'bubble', 'fill', 'running').run();
    try {
      await c.env.CLIP_WORKFLOW.create({ id: 'clip-' + id, params: { clipId: id } });
      created.push(id);
    } catch (err: any) {
      await c.env.DB.prepare("UPDATE clips SET status='error', error=? WHERE id=?").bind(err.message, id).run();
    }
  }
  return c.json({ created, moments: moments.slice(0, count || 3) });
});

app.get('/api/clips', async (c) => {
  const jobId = c.req.query('job_id');
  const q = jobId
    ? c.env.DB.prepare('SELECT * FROM clips WHERE job_id = ? ORDER BY created_at DESC').bind(jobId)
    : c.env.DB.prepare('SELECT cl.*, j.title as job_title FROM clips cl LEFT JOIN scribe_jobs j ON cl.job_id = j.id ORDER BY cl.created_at DESC LIMIT 50');
  return c.json({ clips: (await q.all()).results });
});

app.post('/api/clips', async (c) => {
  const { job_id, start, end, hook, style, framing } = await c.req.json();
  if (!job_id || typeof start !== 'number' || typeof end !== 'number' || end <= start) {
    return c.json({ error: 'job_id, start, end required' }, 400);
  }
  if (end - start > 180) return c.json({ error: 'clips are capped at 3 minutes' }, 400);
  const id = genJobId();
  await c.env.DB.prepare('INSERT INTO clips (id, job_id, start, end, hook, style, framing, status) VALUES (?,?,?,?,?,?,?,?)')
    .bind(id, job_id, start, end, hook || '', style || 'bubble', framing === 'fit' ? 'fit' : 'fill', 'running').run();
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
import { aiFill } from './ai/fill';
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

// Backfill chapters for published videos that lack them (see chaptersBackfillSweep).
app.post('/api/tools/backfill-chapters', async (c) => {
  const report = await chaptersBackfillSweep(c.env, 10);
  return c.json(report);
});

// ---- Large media upload (chunked R2 multipart) ----
// Wrangler caps `r2 object put` at 300MiB and Workers cap request bodies, so
// big local files (full lectures) are uploaded in parts: start → N x part →
// complete. Authenticated by UPLOAD_TOKEN (separate from the admin session).

const mediaUploadKey = (name: string) => name.replace(/[^\w./-]/g, '').replace(/\.\.+/g, '.');

app.use('/media-upload/*', async (c, next) => {
  const tok = (c.req.header('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!c.env.UPLOAD_TOKEN || tok !== c.env.UPLOAD_TOKEN) return c.json({ error: 'Unauthorized' }, 401);
  return next();
});

app.post('/media-upload/start', async (c) => {
  const name = mediaUploadKey(c.req.query('name') || '');
  if (!name) return c.json({ error: 'name required' }, 400);
  const upload = await c.env.MEDIA_BUCKET.createMultipartUpload(name, {
    httpMetadata: { contentType: c.req.query('ct') || 'application/octet-stream' },
  });
  return c.json({ key: name, uploadId: upload.uploadId });
});

app.put('/media-upload/part', async (c) => {
  const name = mediaUploadKey(c.req.query('name') || '');
  const uploadId = c.req.query('uploadId') || '';
  const part = parseInt(c.req.query('part') || '0');
  if (!name || !uploadId || !part) return c.json({ error: 'name, uploadId, part required' }, 400);
  const upload = c.env.MEDIA_BUCKET.resumeMultipartUpload(name, uploadId);
  const bytes = await c.req.arrayBuffer();
  if (!bytes.byteLength) return c.json({ error: 'empty part' }, 400);
  const res = await upload.uploadPart(part, bytes);
  return c.json({ partNumber: res.partNumber, etag: res.etag });
});

app.post('/media-upload/complete', async (c) => {
  const { name, uploadId, parts } = await c.req.json();
  const key = mediaUploadKey(String(name || ''));
  if (!key || !uploadId || !Array.isArray(parts) || !parts.length) return c.json({ error: 'name, uploadId, parts required' }, 400);
  const upload = c.env.MEDIA_BUCKET.resumeMultipartUpload(key, uploadId);
  const obj = await upload.complete(parts.map((p: any) => ({ partNumber: p.partNumber, etag: p.etag })));
  return c.json({ key, size: obj.size });
});

// ---- Fallback: serve SPA (assets binding handles static; this covers deep links when run_worker_first matches) ----

app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export { ScribePipeline } from './scribe/workflow';
export { ClipRenderer } from './scribe/clips';
export { YtdlpContainer, ClipContainer } from './scribe/container';
export { AsrEgress } from './scribe/asr-egress';
export { CompanionHub } from './companion';

/** Auto-resume jobs killed by infrastructure (deploy rollouts reset the
 * workflow engine mid-step). Artifact-aware steps make resumes cheap. */
async function autoResumeSweep(env: Env) {
  // Heartbeat proves the cron actually fires (visible at /api/scribe/sweep-status)
  await env.CACHE.put('sweep:heartbeat', new Date().toISOString()).catch(() => {});
  const dead = await env.DB.prepare(
    `SELECT * FROM scribe_jobs WHERE updated_at > datetime('now', '-1 day') AND (
       (status = 'error' AND (error LIKE '%Durable Object reset%' OR error LIKE '%code was updated%' OR error LIKE '%WorkflowInternalError%' OR error LIKE '%internal workflows error%'))
       OR (status = 'queued' AND wf_instance IS NOT NULL AND updated_at < datetime('now', '-15 minutes'))
     ) LIMIT 3`
  ).all();
  for (const job of dead.results as any[]) {
    for (const iid of [...new Set([job.wf_instance, job.id].filter(Boolean))]) {
      try { await (await env.SCRIBE_WORKFLOW.get(iid)).terminate(); } catch {}
    }
    const langs = JSON.parse(job.target_langs || `["${job.target_lang}"]`);
    const instance = `${job.id}-a${Math.random().toString(36).slice(2, 6)}`;
    await env.DB.prepare("UPDATE scribe_jobs SET status = 'queued', error = 'auto-resumed after deploy reset', wf_instance = ? WHERE id = ?").bind(instance, job.id).run();
    try {
      await env.SCRIBE_WORKFLOW.create({
        id: instance,
        params: { jobId: job.id, url: job.url, targetLang: langs[0], targetLangs: langs, fullVideo: !!job.full_video },
      });
      await env.DB.prepare('INSERT INTO admin_logs (admin_id, action, target, details) VALUES (0, ?, ?, ?)')
        .bind('auto_resume', job.id, `instance ${instance}`).run().catch(() => {});
    } catch (e: any) {
      // Put the job back in error so the next sweep retries instead of leaving a queued zombie
      await env.DB.prepare("UPDATE scribe_jobs SET status = 'error', error = ? WHERE id = ?")
        .bind('auto-resume create failed: ' + String(e?.message || e).slice(0, 150), job.id).run();
    }
  }
}

/** Published videos should always carry chapters for the player. Older
 * publishes (and any job whose chapter generation failed) are healed here:
 * cues come from re-parsing the canonical SRT, chapters from the same LLM
 * segmentation the pipeline uses. Runs on the cron, bounded per tick. */
async function chaptersBackfillSweep(env: Env, limit = 2) {
  // Random order so one persistently-failing video can't sit at the front of
  // the scan and starve the rest of the queue tick after tick
  const rows = (await env.DB.prepare(
    "SELECT id, slug, srt_key FROM videos WHERE (chapters IS NULL OR chapters = '') AND srt_key IS NOT NULL ORDER BY RANDOM() LIMIT ?"
  ).bind(limit).all()).results as any[];
  const done: any[] = [], failed: any[] = [];
  for (const v of rows) {
    try {
      const obj = await env.MEDIA_BUCKET.get(v.srt_key);
      if (!obj) throw new Error('SRT missing: ' + v.srt_key);
      const cues = parseSrtCues(await obj.text());
      if (cues.length < 20) {
        // Too short to chapter — '[]' is the terminal "checked, none" marker
        // (excluded from the missing-filter above) so this stops being retried
        await env.DB.prepare("UPDATE videos SET chapters = '[]' WHERE id = ?").bind(v.id).run();
        done.push({ slug: v.slug, chapters: 0 });
        continue;
      }
      const { generateChapters } = await import('./scribe/metadata');
      const chapters = await generateChapters(env as any, cues);
      if (!chapters.length) throw new Error(`no chapters from ${cues.length} cues`);
      await env.DB.prepare('UPDATE videos SET chapters = ? WHERE id = ?').bind(JSON.stringify(chapters), v.id).run();
      await env.CACHE.delete('video:' + v.slug).catch(() => {});
      await env.DB.prepare('INSERT INTO admin_logs (admin_id, action, target, details) VALUES (0, ?, ?, ?)')
        .bind('chapters_backfill', v.slug, `${chapters.length} chapters`).run().catch(() => {});
      done.push({ slug: v.slug, chapters: chapters.length });
    } catch (e: any) {
      const error = String(e?.message || e).slice(0, 300);
      console.log('chapters backfill failed:', v.slug, error);
      await env.DB.prepare('INSERT INTO admin_logs (admin_id, action, target, details) VALUES (0, ?, ?, ?)')
        .bind('chapters_backfill_fail', v.slug, error).run().catch(() => {});
      failed.push({ slug: v.slug, error });
    }
  }
  return { scanned: rows.length, done, failed };
}

function parseSrtCues(text: string): { start: number; end: number; text: string; source: string }[] {
  const cues: { start: number; end: number; text: string; source: string }[] = [];
  for (const block of text.replace(/\r/g, '').trim().split(/\n\n+/)) {
    const lines = block.split('\n');
    if (lines.length < 3) continue;
    const m = lines[1].match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
    if (!m) continue;
    cues.push({
      start: +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000,
      end: +m[5] * 3600 + +m[6] * 60 + +m[7] + +m[8] / 1000,
      text: lines.slice(2).join(' '),
      source: '',
    });
  }
  return cues;
}

// Daily retention: drop scribe artifacts for jobs older than 30 days.
// Published copies live under canonical keys, so this only clears staging.
async function stuckDetectorSweep(env: Env) {
  const stuck: any[] = [];
  const stale: any = await env.DB.prepare(
    "SELECT id, title, step, updated_at FROM scribe_jobs WHERE status = 'running' AND updated_at < datetime('now', '-3 hours') ORDER BY updated_at ASC LIMIT 10"
  ).all().catch(() => ({ results: [] }));
  for (const j of stale.results as any[]) {
    stuck.push({ kind: 'no-progress-3h', id: j.id, title: (j.title || '').slice(0, 60), step: j.step, since: j.updated_at });
  }
  const wanted: any = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM scribe_jobs WHERE se_status = 'wanted' AND updated_at < datetime('now', '-2 hours')"
  ).first().catch(() => null);
  if (wanted?.n) {
    const { onlineCompanions, hasCap } = await import('./companion');
    const online = await onlineCompanions(env as any).catch(() => []);
    if (!hasCap(online, 'enhance')) stuck.push({ kind: 'enhance-wanted-no-companion', count: wanted.n });
  }
  await env.CACHE.put('ops:stuck', JSON.stringify(stuck), { expirationTtl: 1800 }).catch(() => {});
}

async function retentionSweep(env: Env) {
  const old = await env.DB.prepare(
    "SELECT id FROM scribe_jobs WHERE created_at < datetime('now', '-30 days') AND status IN ('done','error')"
  ).all();
  // Never delete artifacts a published video references in place
  const refs = await env.DB.prepare("SELECT video_key FROM videos WHERE video_key LIKE 'scribe/%'").all();
  const referenced = new Set((refs.results as any[]).map((r) => r.video_key.split('/')[1]));
  for (const row of old.results as any[]) {
    if (referenced.has(row.id)) continue;
    const list = await env.MEDIA_BUCKET.list({ prefix: `scribe/${row.id}/` });
    for (const obj of list.objects) await env.MEDIA_BUCKET.delete(obj.key);
    await env.DB.prepare('DELETE FROM scribe_jobs WHERE id = ?').bind(row.id).run();
  }
}

export default {
  fetch: app.fetch,
  scheduled: (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(autoResumeSweep(env));
    ctx.waitUntil(stuckDetectorSweep(env).catch(() => {}));
    ctx.waitUntil(chaptersBackfillSweep(env).catch(() => {}));
    // Retention only on the daily 03:30 tick
    const d = new Date(event.scheduledTime);
    if (d.getUTCHours() === 3 && d.getUTCMinutes() >= 30 && d.getUTCMinutes() < 35) {
      ctx.waitUntil(retentionSweep(env));
    }
  },
};
