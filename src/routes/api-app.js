import { Hono } from 'hono';
import { VIDEO_COLS, VIDEO_JOIN, readDB, writeDB } from '../lib/db.js';
import { getHomeBundle, getScholars, getScholar, getScholarVideos, getCategories, getCategory, getCategoryVideos, getPlatformStats, getVideo } from '../lib/kv-cache.js';

// JSON API for the native iOS app. Read-only mirrors of the SSR pages,
// backed by the same KV/D1 cache layer — plus account deletion, the one
// write the App Store requires (guideline 5.1.1(v)).
const appApi = new Hono();

appApi.use('/api/app/*', async (c, next) => {
  await next();
  try { c.res.headers.set('Access-Control-Allow-Origin', '*'); } catch {}
});

appApi.get('/api/app/home', async (c) => {
  const { categories, videos, popular, scholars } = await getHomeBundle(c.env);
  return c.json({ categories, videos, popular, scholars });
});

appApi.get('/api/app/categories', async (c) => {
  return c.json({ categories: await getCategories(c.env) });
});

appApi.get('/api/app/category/:slug', async (c) => {
  const slug = c.req.param('slug');
  const sort = c.req.query('sort') === 'popular' ? 'popular' : 'newest';
  const category = await getCategory(c.env, slug);
  if (!category) return c.json({ error: 'Not found' }, 404);
  const videos = await getCategoryVideos(c.env, slug, sort);
  return c.json({ category, videos });
});

appApi.get('/api/app/scholars', async (c) => {
  return c.json({ scholars: await getScholars(c.env) });
});

appApi.get('/api/app/scholars/:slug', async (c) => {
  const scholar = await getScholar(c.env, c.req.param('slug'));
  if (!scholar) return c.json({ error: 'Not found' }, 404);
  const videos = await getScholarVideos(c.env, scholar.id);
  return c.json({ scholar, videos });
});

// Full video row incl. media keys + scholar join — the public
// /api/videos/:slug strips both, which a native player can't work with.
appApi.get('/api/app/video/:slug', async (c) => {
  const video = await getVideo(c.env, c.req.param('slug'));
  if (!video) return c.json({ error: 'Not found' }, 404);
  return c.json({ video });
});

// /api/app/symposium removed — the Symposium category was retired in favor of Podcast


appApi.get('/api/app/stats', async (c) => {
  return c.json({ stats: await getPlatformStats(c.env) });
});

// Session probe — the app restores its signed-in state from the sid cookie
appApi.get('/api/app/me', (c) => {
  return c.json({ user: c.get('user') || null });
});

// Permanently delete the signed-in user's account: their comments, every
// session, and the user row. Analytics rows are detached, not retained
// under the account.
appApi.post('/api/app/account/delete', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Not signed in' }, 401);
  const db = writeDB(c.env);

  const sessions = (await db.prepare('SELECT id FROM sessions WHERE user_id = ?').bind(user.id).all()).results;
  for (const s of sessions) {
    try { await c.env.CACHE.delete('session:' + s.id); } catch {}
  }

  // Slugs whose comment caches go stale once the user's comments vanish.
  const commented = (await db.prepare('SELECT DISTINCT v.slug AS slug FROM comments cm JOIN videos v ON v.id = cm.video_id WHERE cm.user_id = ?').bind(user.id).all()).results;

  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();
  await db.prepare('DELETE FROM comments WHERE user_id = ?').bind(user.id).run();
  try { await db.prepare('UPDATE fingerprints SET user_id = NULL WHERE user_id = ?').bind(user.id).run(); } catch {}
  try { await db.prepare('UPDATE search_logs SET user_id = NULL WHERE user_id = ?').bind(user.id).run(); } catch {}
  await db.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();

  for (const v of commented) {
    c.executionCtx.waitUntil(c.env.CACHE.delete('comments:' + v.slug));
  }

  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.append('Set-Cookie', 'sid=; Domain=.deensubs.com; Path=/; HttpOnly; Secure; Max-Age=0');
  headers.append('Set-Cookie', 'sid=; Path=/; HttpOnly; Secure; Max-Age=0');
  return new Response(JSON.stringify({ ok: true }), { headers });
});

// Full search — same FTS query as the /search page, LIKE fallback included
appApi.get('/api/app/search', async (c) => {
  const q = (c.req.query('q') || '').trim().slice(0, 200);
  if (!q) return c.json({ videos: [], scholars: [] });
  const db = readDB(c.env);
  let videos = [], scholars = [];
  try {
    [videos, scholars] = await Promise.all([
      db.prepare(`SELECT ${VIDEO_COLS} ${VIDEO_JOIN} AND v.id IN (SELECT rowid FROM videos_fts WHERE videos_fts MATCH ?) ORDER BY v.created_at DESC LIMIT 50`).bind(q + '*').all().then(r => r.results),
      db.prepare("SELECT s.*, (SELECT COUNT(*) FROM videos v WHERE v.scholar_id=s.id AND v.enabled=1) as video_count FROM scholars s WHERE s.name LIKE ? LIMIT 5").bind('%' + q + '%').all().then(r => r.results),
    ]);
  } catch {
    videos = (await db.prepare(`SELECT ${VIDEO_COLS} ${VIDEO_JOIN} AND (v.title LIKE ? OR v.description LIKE ? OR v.source LIKE ?) ORDER BY v.created_at DESC LIMIT 50`).bind('%' + q + '%', '%' + q + '%', '%' + q + '%').all()).results;
  }
  return c.json({ videos, scholars });
});

export default appApi;
