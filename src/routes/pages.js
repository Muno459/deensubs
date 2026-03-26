import { Hono } from 'hono';
import { VIDEO_COLS, VIDEO_JOIN, VIDEO_WITH_SCHOLAR, VIDEO_SCHOLAR_JOIN, readDB, writeDB } from '../lib/db.js';
import { getCategories, getScholars, getHomeVideos, getPopularVideos, getVideo, getPlatformStats } from '../lib/kv-cache.js';
import { parseSRT } from '../lib/srt.js';
import { renderPage } from '../templates/layout.js';
import { renderHome } from '../templates/home.js';
import { renderWatch } from '../templates/watch.js';
import { renderCategory } from '../templates/category.js';
import { renderSearch } from '../templates/search.js';
import { renderScholars, renderScholar } from '../templates/scholar.js';
import { renderAbout } from '../templates/about.js';
import { renderBookmarks } from '../templates/bookmarks.js';
import { renderHistory } from '../templates/history.js';
import { render404 } from '../templates/error.js';
import { renderSymposium } from '../templates/symposium.js';
import { renderProfile } from '../templates/profile.js';

const pages = new Hono();

const VC = VIDEO_COLS;
const VJ = VIDEO_JOIN;

// Helper to render page with user
function rp(c, title, body, cats, activeCat, meta) {
  return renderPage(title, body, cats, activeCat, meta, c.get('user'));
}

pages.get('/', async (c) => {
  const [cats, videos, popular, scholars] = await Promise.all([
    getCategories(c.env),
    getHomeVideos(c.env),
    getPopularVideos(c.env),
    getScholars(c.env),
  ]);
  const byCategory = {};
  videos.forEach(v => {
    const s = v.category_slug || 'other';
    if (!byCategory[s]) byCategory[s] = [];
    byCategory[s].push(v);
  });
  return c.html(rp(c,'Home', renderHome({
    featured: videos[0] || null,
    videos,
    popular,
    categories: cats,
    byCategory,
    scholars,
  }), cats));
});

pages.get('/watch/:slug', async (c) => {
  const slug = c.req.param('slug');
  const db = readDB(c.env);
  const video = await db.prepare(`SELECT ${VIDEO_WITH_SCHOLAR} ${VIDEO_SCHOLAR_JOIN} WHERE v.slug = ?`).bind(slug).first();
  if (!video) return c.html(rp(c,'Not Found', render404(), await getCategories(c.env)), 404);

  const [, comments, related, cats, cues] = await Promise.all([
    writeDB(c.env).prepare('UPDATE videos SET views = views + 1 WHERE slug = ?').bind(slug).run(),
    db.prepare('SELECT * FROM comments WHERE video_id = ? ORDER BY created_at DESC LIMIT 200').bind(video.id).all(),
    db.prepare(`SELECT ${VC} ${VJ} WHERE v.id != ? ORDER BY CASE WHEN v.category_id = ? THEN 0 ELSE 1 END, v.created_at DESC LIMIT 12`).bind(video.id, video.category_id).all(),
    getCategories(c.env).then(r=>({results:r})),
    parseSRT(c.env, video.srt_key),
  ]);
  video._user = c.get('user');
  const base = new URL(c.req.url).origin;
  const meta = {
    description: video.description || `Watch ${video.title} with English subtitles on DeenSubs.`,
    type: 'video.other',
    image: video.thumb_key ? base + '/api/media/' + video.thumb_key : null,
  };
  return c.html(rp(c,video.title, renderWatch({ video, comments: comments.results, related: related.results, cues, base }), cats.results, video.category_slug, meta));
});

pages.get('/category/:slug', async (c) => {
  const slug = c.req.param('slug');
  const db = readDB(c.env);
  const sort = c.req.query('sort') || 'newest';
  const orderBy = sort === 'popular' ? 'v.views DESC' : 'v.created_at DESC';
  const [category, videos, cats] = await Promise.all([
    db.prepare('SELECT * FROM categories WHERE slug = ?').bind(slug).first(),
    db.prepare(`SELECT ${VC} ${VJ} WHERE c.slug = ? ORDER BY ${orderBy}`).bind(slug).all(),
    getCategories(c.env).then(r=>({results:r})),
  ]);
  if (!category) return c.html(rp(c,'Not Found', render404(), cats.results), 404);
  return c.html(rp(c,category.name, renderCategory({ category, videos: videos.results, sort }), cats.results, slug));
});

pages.get('/search', async (c) => {
  const q = (c.req.query('q') || '').trim();
  const db = readDB(c.env);
  const cats = await getCategories(c.env);
  let videos = [];
  if (q) {
    try {
      videos = (await db.prepare(`SELECT ${VC} ${VJ} WHERE v.id IN (SELECT rowid FROM videos_fts WHERE videos_fts MATCH ?) ORDER BY v.created_at DESC LIMIT 50`).bind(q + '*').all()).results;
    } catch {
      videos = (await db.prepare(`SELECT ${VC} ${VJ} WHERE v.title LIKE ? OR v.description LIKE ? OR v.source LIKE ? ORDER BY v.created_at DESC LIMIT 50`).bind('%' + q + '%', '%' + q + '%', '%' + q + '%').all()).results;
    }
  }
  // Log search query
  if (q) { try { const user = c.get('user'); c.executionCtx.waitUntil(writeDB(c.env).prepare('INSERT INTO search_logs (query, results, user_id) VALUES (?, ?, ?)').bind(q, videos.length, user?.id || null).run()); } catch {} }
  return c.html(rp(c,q ? 'Search: ' + q : 'Search', renderSearch({ query: q, videos }), cats));
});

pages.get('/symposium', async (c) => {
  const db = readDB(c.env);
  const [videos, cats] = await Promise.all([
    db.prepare(`SELECT ${VC} ${VJ} WHERE c.slug = 'symposium' ORDER BY v.id`).all(),
    getCategories(c.env).then(r=>({results:r})),
  ]);
  return c.html(rp(c, 'Fatwa in the Haramain — Symposium', renderSymposium({ videos: videos.results }), cats.results, 'symposium'));
});

pages.get('/scholars', async (c) => {
  const [scholars, cats] = await Promise.all([getScholars(c.env), getCategories(c.env)]);
  return c.html(rp(c,'Scholars', renderScholars({ scholars }), cats, 'scholars'));
});

pages.get('/scholar/:slug', async (c) => {
  const slug = c.req.param('slug');
  const db = readDB(c.env);
  const scholar = await db.prepare('SELECT * FROM scholars WHERE slug = ?').bind(slug).first();
  if (!scholar) return c.html(rp(c,'Not Found', render404(), await getCategories(c.env)), 404);
  const [videos, cats] = await Promise.all([
    db.prepare(`SELECT ${VC} ${VJ} WHERE v.scholar_id = ? ORDER BY v.created_at DESC`).bind(scholar.id).all(),
    getCategories(c.env).then(r=>({results:r})),
  ]);
  return c.html(rp(c,scholar.name, renderScholar({ scholar, videos: videos.results }), cats.results, 'scholars'));
});

pages.get('/history', async (c) => {
  const cats = await getCategories(c.env);
  return c.html(rp(c,'Watch History', renderHistory(), cats));
});

pages.get('/about', async (c) => {
  const [cats, stats] = await Promise.all([getCategories(c.env), getPlatformStats(c.env)]);
  return c.html(rp(c,'About', renderAbout({ stats }), cats));
});

pages.get('/bookmarks', async (c) => {
  const cats = await getCategories(c.env);
  return c.html(rp(c,'Bookmarks', renderBookmarks(), cats));
});

pages.get('/profile', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/auth/google');
  const db = readDB(c.env);
  const [cats, comments, stats] = await Promise.all([
    getCategories(c.env).then(r=>({results:r})),
    db.prepare('SELECT c.*, v.title as video_title, v.slug as video_slug FROM comments c LEFT JOIN videos v ON c.video_id = v.id WHERE c.user_id = ? ORDER BY c.created_at DESC LIMIT 20').bind(user.id).all(),
    db.prepare('SELECT COUNT(*) as comment_count FROM comments WHERE user_id = ?').bind(user.id).first(),
  ]);
  return c.html(rp(c, 'Profile', renderProfile({ user, comments: comments.results, stats }), cats.results));
});

export default pages;
