// KV-backed cache for frequently-read, rarely-changed data
// Reads from nearest PoP (<1ms), falls back to D1 on miss

import { readDB, VIDEO_COLS, VIDEO_JOIN, VIDEO_WITH_SCHOLAR, VIDEO_SCHOLAR_JOIN } from './db.js';

// Stale-while-revalidate: always serve from KV, refresh in background when stale.
// KV entry lives 7 days (never truly empty), but data refreshes per stale TTL.
const STALE_SHORT = 300;    // 5 min — video lists
const STALE_MEDIUM = 1800;  // 30 min — scholars, search suggestions
const STALE_LONG = 86400;   // 24 hours — categories
const KV_EXPIRE = 2592000;  // 30 days — KV entry lifetime (SWR handles freshness, this is just safety net)

let _ctx = null;
export function setCtx(ctx) { _ctx = ctx; }

export async function kvGet(env, key, fetcher, stale) {
  const s = stale || STALE_MEDIUM;
  try {
    const raw = await env.CACHE.get(key, { type: 'json', cacheTtl: Math.min(s, 300) });
    if (raw != null) {
      // New SWR format: { _d: data, _t: timestamp }
      const data = raw._d != null ? raw._d : raw;
      const ts = raw._t || 0;
      // If stale, refresh in background (non-blocking)
      if ((!ts || Date.now() - ts > s * 1000) && _ctx?.waitUntil) {
        _ctx.waitUntil(
          fetcher().then(fresh =>
            env.CACHE.put(key, JSON.stringify({ _d: fresh, _t: Date.now() }), { expirationTtl: KV_EXPIRE })
          ).catch(() => {})
        );
      }
      return data;
    }
  } catch {}

  // Cold miss — fetch and store
  const data = await fetcher();
  try {
    await env.CACHE.put(key, JSON.stringify({ _d: data, _t: Date.now() }), { expirationTtl: KV_EXPIRE });
  } catch {}
  return data;
}

// Bulk read multiple KV keys in one call (up to 100 keys)
// entries: [{key, fetcher, stale}]  — returns array of values in same order
export async function kvGetMulti(env, entries) {
  const keys = entries.map(e => e.key);
  const now = Date.now();
  let cached;
  try {
    cached = await env.CACHE.get(keys, { type: 'json', cacheTtl: 300 });
  } catch { cached = new Map(); }

  return Promise.all(entries.map(async (entry, i) => {
    const raw = cached.get(entry.key);
    if (raw != null) {
      const data = raw._d != null ? raw._d : raw;
      const ts = raw._t || 0;
      const s = entry.stale || STALE_MEDIUM;
      if ((!ts || now - ts > s * 1000) && _ctx?.waitUntil) {
        _ctx.waitUntil(
          entry.fetcher().then(fresh =>
            env.CACHE.put(entry.key, JSON.stringify({ _d: fresh, _t: Date.now() }), { expirationTtl: KV_EXPIRE })
          ).catch(() => {})
        );
      }
      return data;
    }
    // Cold miss
    const data = await entry.fetcher();
    try {
      await env.CACHE.put(entry.key, JSON.stringify({ _d: data, _t: Date.now() }), { expirationTtl: KV_EXPIRE });
    } catch {}
    return data;
  }));
}

export async function kvInvalidate(env, ...keys) {
  for (const key of keys) {
    try { await env.CACHE.delete(key); } catch {}
  }
}

// ── Homepage bundle — single KV read, single D1 round trip via batch() ──
export async function getHomeBundle(env) {
  return kvGet(env, 'home', async () => {
    const db = readDB(env);
    // batch() sends all queries in ONE round trip to D1 (not 4 separate ones)
    const [cats, videos, popular, scholars] = await db.batch([
      db.prepare('SELECT * FROM categories ORDER BY name'),
      db.prepare(`SELECT ${VIDEO_COLS} ${VIDEO_JOIN} AND c.slug != 'symposium' ORDER BY v.created_at DESC LIMIT 30`),
      db.prepare(`SELECT ${VIDEO_COLS} ${VIDEO_JOIN} AND c.slug != 'symposium' ORDER BY v.views DESC LIMIT 8`),
      db.prepare('SELECT s.*, (SELECT COUNT(*) FROM videos v WHERE v.scholar_id = s.id AND v.enabled = 1) as video_count, (SELECT SUM(views) FROM videos v WHERE v.scholar_id = s.id AND v.enabled = 1) as total_views FROM scholars s ORDER BY s.name'),
    ]);
    return { categories: cats.results, videos: videos.results, popular: popular.results, scholars: scholars.results };
  }, STALE_SHORT);
}

// ── Individual getters (used by non-homepage routes) ──
export async function getCategories(env) {
  return kvGet(env, 'categories', async () => {
    return (await readDB(env).prepare('SELECT * FROM categories ORDER BY name').all()).results;
  }, STALE_LONG);
}

export async function getScholars(env) {
  return kvGet(env, 'scholars', async () => {
    return (await readDB(env).prepare(
      'SELECT s.*, (SELECT COUNT(*) FROM videos v WHERE v.scholar_id = s.id AND v.enabled = 1) as video_count, (SELECT SUM(views) FROM videos v WHERE v.scholar_id = s.id AND v.enabled = 1) as total_views FROM scholars s ORDER BY s.name'
    ).all()).results;
  }, STALE_MEDIUM);
}

export async function getHomeVideos(env) {
  return kvGet(env, 'home:videos', async () => {
    return (await readDB(env).prepare(
      `SELECT ${VIDEO_COLS} ${VIDEO_JOIN} AND c.slug != 'symposium' ORDER BY v.created_at DESC LIMIT 30`
    ).all()).results;
  }, STALE_SHORT);
}

export async function getPopularVideos(env) {
  return kvGet(env, 'home:popular', async () => {
    return (await readDB(env).prepare(
      `SELECT ${VIDEO_COLS} ${VIDEO_JOIN} AND c.slug != 'symposium' ORDER BY v.views DESC LIMIT 8`
    ).all()).results;
  }, STALE_SHORT);
}

// ── Single video by slug (5 min cache) ──
export async function getVideo(env, slug) {
  return kvGet(env, 'video:' + slug, async () => {
    return await readDB(env).prepare(
      `SELECT ${VIDEO_WITH_SCHOLAR} ${VIDEO_SCHOLAR_JOIN} AND v.slug = ?`
    ).bind(slug).first();
  }, STALE_MEDIUM);
}

// ── Search autocomplete results (1 min cache per query) ──
export async function getSearchSuggestions(env, q) {
  return kvGet(env, 'search:' + q.toLowerCase().slice(0, 30), async () => {
    const db = readDB(env);
    const [videos, scholars] = await db.batch([
      db.prepare("SELECT title, slug, source, thumb_key FROM videos WHERE enabled = 1 AND title LIKE ? ORDER BY views DESC LIMIT 6").bind('%' + q + '%'),
      db.prepare("SELECT name, slug, photo FROM scholars WHERE name LIKE ? LIMIT 3").bind('%' + q + '%'),
    ]);
    return { videos: videos.results, scholars: scholars.results };
  }, STALE_SHORT);
}

// ── RSS feed (1 hour cache) ──
export async function getRSSVideos(env) {
  return kvGet(env, 'rss:videos', async () => {
    return (await readDB(env).prepare(
      `SELECT ${VIDEO_COLS} ${VIDEO_JOIN} ORDER BY v.created_at DESC LIMIT 50`
    ).all()).results;
  }, STALE_LONG);
}

// ── Sitemap data (1 hour cache) ──
export async function getSitemapData(env) {
  return kvGet(env, 'sitemap:v2', async () => {
    const db = readDB(env);
    const [videos, cats, scholars] = await Promise.all([
      db.prepare('SELECT slug, created_at FROM videos WHERE enabled = 1 ORDER BY created_at DESC').all(),
      db.prepare('SELECT slug FROM categories ORDER BY name').all(),
      db.prepare('SELECT slug FROM scholars ORDER BY name').all(),
    ]);
    return { videos: videos.results, categories: cats.results, scholars: scholars.results };
  }, STALE_LONG);
}

// ── Videos by category (1 min cache) ──
export async function getCategoryVideos(env, slug, sort) {
  const orderBy = sort === 'popular' ? 'v.views DESC' : 'v.created_at DESC';
  return kvGet(env, `cat:${slug}:${sort || 'newest'}`, async () => {
    return (await readDB(env).prepare(
      `SELECT ${VIDEO_COLS} ${VIDEO_JOIN} AND c.slug = ? ORDER BY ${orderBy}`
    ).bind(slug).all()).results;
  }, STALE_SHORT);
}

// ── Single category by slug (1 hour cache) ──
export async function getCategory(env, slug) {
  return kvGet(env, 'cat-info:' + slug, async () => {
    return await readDB(env).prepare('SELECT * FROM categories WHERE slug = ?').bind(slug).first();
  }, STALE_LONG);
}

// ── Videos by scholar (1 min cache) ──
export async function getScholarVideos(env, scholarId) {
  return kvGet(env, 'scholar-vids:' + scholarId, async () => {
    return (await readDB(env).prepare(
      `SELECT ${VIDEO_COLS} ${VIDEO_JOIN} AND v.scholar_id = ? ORDER BY v.created_at DESC`
    ).bind(scholarId).all()).results;
  }, STALE_SHORT);
}

// ── Single scholar by slug (5 min cache) ──
export async function getScholar(env, slug) {
  return kvGet(env, 'scholar:' + slug, async () => {
    return await readDB(env).prepare('SELECT * FROM scholars WHERE slug = ?').bind(slug).first();
  }, STALE_MEDIUM);
}

// ── Related videos (5 min cache) ──
export async function getRelatedVideos(env, videoId, categoryId) {
  return kvGet(env, `related:${videoId}`, async () => {
    return (await readDB(env).prepare(
      `SELECT ${VIDEO_COLS} ${VIDEO_JOIN} AND v.id != ? ORDER BY CASE WHEN v.category_id = ? THEN 0 ELSE 1 END, v.created_at DESC LIMIT 12`
    ).bind(videoId, categoryId).all()).results;
  }, STALE_MEDIUM);
}

// ── Symposium videos (5 min cache) ──
export async function getSymposiumVideos(env) {
  return kvGet(env, 'symposium:videos', async () => {
    return (await readDB(env).prepare(
      `SELECT ${VIDEO_COLS} ${VIDEO_JOIN} AND c.slug = 'symposium' ORDER BY v.id`
    ).all()).results;
  }, STALE_MEDIUM);
}

// ── Platform stats (5 min cache) ──
export async function getPlatformStats(env) {
  return kvGet(env, 'stats:platform:v2', async () => {
    const db = readDB(env);
    const [vids, scholars, cats] = await Promise.all([
      db.prepare('SELECT COUNT(*) as count, SUM(views) as views, SUM(likes) as likes, SUM(duration) as total_duration, SUM(CASE WHEN srt_key IS NOT NULL THEN 1 ELSE 0 END) as subtitled FROM videos WHERE enabled = 1').first(),
      db.prepare('SELECT COUNT(*) as count FROM scholars').first(),
      db.prepare('SELECT COUNT(*) as count FROM categories').first(),
    ]);
    return { ...vids, scholars: scholars?.count || 0, categories: cats?.count || 0, hours: Math.round((vids?.total_duration || 0) / 3600) };
  }, STALE_MEDIUM);
}
