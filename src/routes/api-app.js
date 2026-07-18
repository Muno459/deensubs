import { Hono } from 'hono';
import { VIDEO_COLS, VIDEO_JOIN, readDB } from '../lib/db.js';
import { getHomeBundle, getScholars, getScholar, getScholarVideos, getCategories, getCategory, getCategoryVideos, getSymposiumVideos, getPlatformStats, getVideo } from '../lib/kv-cache.js';

// JSON API for the native iOS app. Read-only mirrors of the SSR pages,
// backed by the same KV/D1 cache layer — no new queries, no writes.
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

appApi.get('/api/app/symposium', async (c) => {
  return c.json({ videos: await getSymposiumVideos(c.env) });
});

appApi.get('/api/app/stats', async (c) => {
  return c.json({ stats: await getPlatformStats(c.env) });
});

// Session probe — the app restores its signed-in state from the sid cookie
appApi.get('/api/app/me', (c) => {
  return c.json({ user: c.get('user') || null });
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
