// KV-backed cache for frequently-read, rarely-changed data
// Reads from nearest PoP (<1ms), falls back to D1 on miss

import { readDB } from './db.js';
import { VIDEO_COLS, VIDEO_JOIN } from './db.js';

const TTL_SHORT = 60;      // 1 min — for data that changes often (views, comments count)
const TTL_MEDIUM = 300;    // 5 min — for semi-static data (video list, scholars)
const TTL_LONG = 3600;     // 1 hour — for rarely-changing data (categories)

export async function kvGet(env, key, fetcher, ttl) {
  try {
    const cached = await env.CACHE.get(key, 'json');
    if (cached) return cached;
  } catch {}

  const data = await fetcher();
  try {
    await env.CACHE.put(key, JSON.stringify(data), { expirationTtl: ttl || TTL_MEDIUM });
  } catch {}
  return data;
}

export async function kvInvalidate(env, ...keys) {
  for (const key of keys) {
    try { await env.CACHE.delete(key); } catch {}
  }
}

// ── Categories (1 hour cache — rarely changes) ──
export async function getCategories(env) {
  return kvGet(env, 'categories', async () => {
    return (await readDB(env).prepare('SELECT * FROM categories ORDER BY name').all()).results;
  }, TTL_LONG);
}

// ── Scholars list (5 min cache) ──
export async function getScholars(env) {
  return kvGet(env, 'scholars', async () => {
    return (await readDB(env).prepare(
      'SELECT s.*, (SELECT COUNT(*) FROM videos v WHERE v.scholar_id = s.id) as video_count, (SELECT SUM(views) FROM videos v WHERE v.scholar_id = s.id) as total_views FROM scholars s ORDER BY s.name'
    ).all()).results;
  }, TTL_MEDIUM);
}

// ── Homepage video list (1 min cache — views change) ──
export async function getHomeVideos(env) {
  return kvGet(env, 'home:videos', async () => {
    return (await readDB(env).prepare(
      `SELECT ${VIDEO_COLS} ${VIDEO_JOIN} WHERE c.slug != 'symposium' ORDER BY v.created_at DESC LIMIT 30`
    ).all()).results;
  }, TTL_SHORT);
}

// ── Popular videos (1 min cache) ──
export async function getPopularVideos(env) {
  return kvGet(env, 'home:popular', async () => {
    return (await readDB(env).prepare(
      `SELECT ${VIDEO_COLS} ${VIDEO_JOIN} WHERE c.slug != 'symposium' ORDER BY v.views DESC LIMIT 8`
    ).all()).results;
  }, TTL_SHORT);
}

// ── Single video by slug (5 min cache) ──
export async function getVideo(env, slug) {
  return kvGet(env, 'video:' + slug, async () => {
    const { VIDEO_WITH_SCHOLAR, VIDEO_SCHOLAR_JOIN } = await import('./db.js');
    return await readDB(env).prepare(
      `SELECT ${VIDEO_WITH_SCHOLAR} ${VIDEO_SCHOLAR_JOIN} WHERE v.slug = ?`
    ).bind(slug).first();
  }, TTL_MEDIUM);
}

// ── Search autocomplete results (1 min cache per query) ──
export async function getSearchSuggestions(env, q) {
  return kvGet(env, 'search:' + q.toLowerCase().slice(0, 30), async () => {
    const db = readDB(env);
    const [videos, scholars] = await Promise.all([
      db.prepare("SELECT title, slug, source, thumb_key FROM videos WHERE title LIKE ? ORDER BY views DESC LIMIT 6").bind('%' + q + '%').all(),
      db.prepare("SELECT name, slug, photo FROM scholars WHERE name LIKE ? LIMIT 3").bind('%' + q + '%').all(),
    ]);
    return { videos: videos.results, scholars: scholars.results };
  }, TTL_SHORT);
}

// ── RSS feed (1 hour cache) ──
export async function getRSSVideos(env) {
  return kvGet(env, 'rss:videos', async () => {
    return (await readDB(env).prepare(
      `SELECT ${VIDEO_COLS} ${VIDEO_JOIN} ORDER BY v.created_at DESC LIMIT 50`
    ).all()).results;
  }, TTL_LONG);
}

// ── Sitemap data (1 hour cache) ──
export async function getSitemapData(env) {
  return kvGet(env, 'sitemap', async () => {
    const db = readDB(env);
    const [videos, cats] = await Promise.all([
      db.prepare('SELECT slug, created_at FROM videos ORDER BY created_at DESC').all(),
      db.prepare('SELECT slug FROM categories ORDER BY name').all(),
    ]);
    return { videos: videos.results, categories: cats.results };
  }, TTL_LONG);
}

// ── Platform stats (5 min cache) ──
export async function getPlatformStats(env) {
  return kvGet(env, 'stats:platform', async () => {
    return await readDB(env).prepare(
      'SELECT COUNT(*) as count, SUM(views) as views FROM videos'
    ).first();
  }, TTL_MEDIUM);
}
