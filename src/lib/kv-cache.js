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
      // New SWR format: { _d: data, _t: timestamp } — _d may legitimately be null (cached miss)
      const wrapped = typeof raw === 'object' && '_t' in raw;
      const data = wrapped ? (raw._d ?? null) : raw;
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
      const wrapped = typeof raw === 'object' && '_t' in raw;
      const data = wrapped ? (raw._d ?? null) : raw;
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
      db.prepare(`SELECT ${VIDEO_COLS} ${VIDEO_JOIN} ORDER BY v.created_at DESC LIMIT 30`),
      db.prepare(`SELECT ${VIDEO_COLS} ${VIDEO_JOIN} ORDER BY v.views DESC LIMIT 8`),
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
      `SELECT ${VIDEO_COLS} ${VIDEO_JOIN} ORDER BY v.created_at DESC LIMIT 30`
    ).all()).results;
  }, STALE_SHORT);
}

export async function getPopularVideos(env) {
  return kvGet(env, 'home:popular', async () => {
    return (await readDB(env).prepare(
      `SELECT ${VIDEO_COLS} ${VIDEO_JOIN} ORDER BY v.views DESC LIMIT 8`
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
  return kvGet(env, 'sitemap:v4', async () => {
    const db = readDB(env);
    const [videos, cats, scholars, playlists] = await Promise.all([
      db.prepare('SELECT slug, created_at, title, description, thumb_key, video_key, duration FROM videos WHERE enabled = 1 ORDER BY created_at DESC').all(),
      db.prepare('SELECT slug FROM categories ORDER BY name').all(),
      db.prepare('SELECT slug FROM scholars ORDER BY name').all(),
      db.prepare('SELECT p.slug FROM playlists p WHERE EXISTS (SELECT 1 FROM playlist_videos pv JOIN videos v ON v.id = pv.video_id AND v.enabled = 1 WHERE pv.playlist_id = p.id) ORDER BY p.created_at DESC').all(),
    ]);
    return { videos: videos.results, categories: cats.results, scholars: scholars.results, playlists: playlists.results };
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

// Shared SELECT for playlist cards: card fields + first video's thumbnail
const PLAYLIST_CARD_COLS = `p.id, p.title, p.title_ar, p.slug, p.description, p.cover_key, p.created_at,
  COUNT(v.id) as video_count, SUM(v.duration) as total_duration,
  (SELECT v2.thumb_key FROM playlist_videos pv2 JOIN videos v2 ON v2.id = pv2.video_id AND v2.enabled = 1
    WHERE pv2.playlist_id = p.id AND v2.thumb_key IS NOT NULL ORDER BY pv2.position ASC LIMIT 1) as first_thumb`;
const PLAYLIST_CARD_JOIN = `FROM playlists p
  JOIN playlist_videos pv ON pv.playlist_id = p.id
  JOIN videos v ON v.id = pv.video_id AND v.enabled = 1`;

// ── Playlists shown inside a category page (5 min cache) ──
// Shown only where the category holds the majority (≥ half) of the playlist's
// videos, mirroring the scholar-page rule; those member videos collapse out of
// the grid. Minority-category videos stay as loose videos on their own pages.
export async function getCategoryPlaylists(env, slug) {
  return kvGet(env, 'cat-playlists:' + slug, async () => {
    return (await readDB(env).prepare(
      `SELECT ${PLAYLIST_CARD_COLS},
        SUM(CASE WHEN v.category_id = (SELECT id FROM categories WHERE slug = ?1) THEN 1 ELSE 0 END) as cat_count,
        GROUP_CONCAT(CASE WHEN v.category_id = (SELECT id FROM categories WHERE slug = ?1) THEN v.id END) as member_ids
       ${PLAYLIST_CARD_JOIN}
       GROUP BY p.id
       HAVING cat_count > 0 AND cat_count * 2 >= COUNT(v.id)
       ORDER BY p.created_at DESC`
    ).bind(slug).all()).results;
  }, STALE_SHORT);
}

// ── Playlists shown on a scholar page (5 min cache) ──
// Shown when the scholar is assigned the majority of the playlist's videos.
export async function getScholarPlaylists(env, scholarId) {
  return kvGet(env, 'scholar-playlists:' + scholarId, async () => {
    return (await readDB(env).prepare(
      `SELECT ${PLAYLIST_CARD_COLS},
        SUM(CASE WHEN v.scholar_id = ?1 THEN 1 ELSE 0 END) as scholar_count,
        GROUP_CONCAT(CASE WHEN v.scholar_id = ?1 THEN v.id END) as member_ids
       ${PLAYLIST_CARD_JOIN}
       GROUP BY p.id
       HAVING scholar_count > 0 AND scholar_count * 2 >= COUNT(v.id)
       ORDER BY p.created_at DESC`
    ).bind(scholarId).all()).results;
  }, STALE_SHORT);
}

// ── Single playlist + its videos in order (5 min cache) ──
export async function getPlaylist(env, slug) {
  return kvGet(env, 'playlist:' + slug, async () => {
    const db = readDB(env);
    const playlist = await db.prepare('SELECT * FROM playlists WHERE slug = ?').bind(slug).first();
    if (!playlist) return null;
    const videos = (await db.prepare(
      `SELECT v.*, c.name as category_name, c.slug as category_slug, c.color as category_color,
        s.name as scholar_name, s.slug as scholar_slug, pv.position
       FROM playlist_videos pv JOIN videos v ON v.id = pv.video_id
       LEFT JOIN categories c ON v.category_id = c.id
       LEFT JOIN scholars s ON v.scholar_id = s.id
       WHERE pv.playlist_id = ? AND v.enabled = 1 ORDER BY pv.position ASC`
    ).bind(playlist.id).all()).results;
    return { playlist, videos };
  }, STALE_SHORT);
}

// ── Playlist context for a video: the watch-page queue (5 min cache) ──
export async function getVideoPlaylist(env, videoId) {
  return kvGet(env, 'video-playlist:' + videoId, async () => {
    const db = readDB(env);
    const p = await db.prepare(
      'SELECT p.id, p.title, p.title_ar, p.slug FROM playlists p JOIN playlist_videos pv ON pv.playlist_id = p.id WHERE pv.video_id = ? ORDER BY p.id LIMIT 1'
    ).bind(videoId).first();
    if (!p) return null;
    const items = (await db.prepare(
      `SELECT v.id, v.title, v.slug, v.duration, v.thumb_key, v.views, v.source, pv.position
       FROM playlist_videos pv JOIN videos v ON v.id = pv.video_id
       WHERE pv.playlist_id = ? AND v.enabled = 1 ORDER BY pv.position ASC`
    ).bind(p.id).all()).results;
    return { ...p, items };
  }, STALE_SHORT);
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
