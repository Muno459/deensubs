import { Hono } from 'hono';
import { VIDEO_COLS, VIDEO_JOIN, VIDEO_WITH_SCHOLAR, VIDEO_SCHOLAR_JOIN } from '../lib/db.js';
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

const pages = new Hono();

const VC = VIDEO_COLS;
const VJ = VIDEO_JOIN;

// Helper to render page with user
function rp(c, title, body, cats, activeCat, meta) {
  return renderPage(title, body, cats, activeCat, meta, c.get('user'));
}

pages.get('/', async (c) => {
  const db = c.env.DB;
  const [cats, all, popular] = await Promise.all([
    db.prepare('SELECT * FROM categories ORDER BY name').all(),
    db.prepare(`SELECT ${VC} ${VJ} WHERE c.slug != 'symposium' ORDER BY v.created_at DESC LIMIT 30`).all(),
    db.prepare(`SELECT ${VC} ${VJ} WHERE c.slug != 'symposium' ORDER BY v.views DESC LIMIT 8`).all(),
  ]);
  const videos = all.results;
  const byCategory = {};
  videos.forEach(v => {
    const s = v.category_slug || 'other';
    if (!byCategory[s]) byCategory[s] = [];
    byCategory[s].push(v);
  });
  return c.html(rp(c,'Home', renderHome({
    featured: videos[0] || null,
    videos,
    popular: popular.results,
    categories: cats.results,
    byCategory,
  }), cats.results));
});

pages.get('/watch/:slug', async (c) => {
  const slug = c.req.param('slug');
  const db = c.env.DB;
  const video = await db.prepare(`SELECT ${VIDEO_WITH_SCHOLAR} ${VIDEO_SCHOLAR_JOIN} WHERE v.slug = ?`).bind(slug).first();
  if (!video) return c.html(rp(c,'Not Found', render404(), (await db.prepare('SELECT * FROM categories ORDER BY name').all()).results), 404);

  const [, comments, related, cats, cues] = await Promise.all([
    db.prepare('UPDATE videos SET views = views + 1 WHERE slug = ?').bind(slug).run(),
    db.prepare('SELECT * FROM comments WHERE video_id = ? ORDER BY created_at DESC LIMIT 200').bind(video.id).all(),
    db.prepare(`SELECT ${VC} ${VJ} WHERE v.id != ? ORDER BY CASE WHEN v.category_id = ? THEN 0 ELSE 1 END, v.created_at DESC LIMIT 12`).bind(video.id, video.category_id).all(),
    db.prepare('SELECT * FROM categories ORDER BY name').all(),
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
  const db = c.env.DB;
  const sort = c.req.query('sort') || 'newest';
  const orderBy = sort === 'popular' ? 'v.views DESC' : 'v.created_at DESC';
  const [category, videos, cats] = await Promise.all([
    db.prepare('SELECT * FROM categories WHERE slug = ?').bind(slug).first(),
    db.prepare(`SELECT ${VC} ${VJ} WHERE c.slug = ? ORDER BY ${orderBy}`).bind(slug).all(),
    db.prepare('SELECT * FROM categories ORDER BY name').all(),
  ]);
  if (!category) return c.html(rp(c,'Not Found', render404(), cats.results), 404);
  return c.html(rp(c,category.name, renderCategory({ category, videos: videos.results, sort }), cats.results, slug));
});

pages.get('/search', async (c) => {
  const q = (c.req.query('q') || '').trim();
  const db = c.env.DB;
  const cats = (await db.prepare('SELECT * FROM categories ORDER BY name').all()).results;
  let videos = [];
  if (q) {
    try {
      videos = (await db.prepare(`SELECT ${VC} ${VJ} WHERE v.id IN (SELECT rowid FROM videos_fts WHERE videos_fts MATCH ?) ORDER BY v.created_at DESC LIMIT 50`).bind(q + '*').all()).results;
    } catch {
      videos = (await db.prepare(`SELECT ${VC} ${VJ} WHERE v.title LIKE ? OR v.description LIKE ? OR v.source LIKE ? ORDER BY v.created_at DESC LIMIT 50`).bind('%' + q + '%', '%' + q + '%', '%' + q + '%').all()).results;
    }
  }
  return c.html(rp(c,q ? 'Search: ' + q : 'Search', renderSearch({ query: q, videos }), cats));
});

// symposium disabled for now

pages.get('/scholars', async (c) => {
  const db = c.env.DB;
  const [scholars, cats] = await Promise.all([
    db.prepare('SELECT s.*, (SELECT COUNT(*) FROM videos v WHERE v.scholar_id = s.id) as video_count, (SELECT SUM(views) FROM videos v WHERE v.scholar_id = s.id) as total_views FROM scholars s ORDER BY s.name').all(),
    db.prepare('SELECT * FROM categories ORDER BY name').all(),
  ]);
  return c.html(rp(c,'Scholars', renderScholars({ scholars: scholars.results }), cats.results));
});

pages.get('/scholar/:slug', async (c) => {
  const slug = c.req.param('slug');
  const db = c.env.DB;
  const scholar = await db.prepare('SELECT * FROM scholars WHERE slug = ?').bind(slug).first();
  if (!scholar) return c.html(rp(c,'Not Found', render404(), (await db.prepare('SELECT * FROM categories ORDER BY name').all()).results), 404);
  const [videos, cats] = await Promise.all([
    db.prepare(`SELECT ${VC} ${VJ} WHERE v.scholar_id = ? ORDER BY v.created_at DESC`).bind(scholar.id).all(),
    db.prepare('SELECT * FROM categories ORDER BY name').all(),
  ]);
  return c.html(rp(c,scholar.name, renderScholar({ scholar, videos: videos.results }), cats.results));
});

pages.get('/history', async (c) => {
  const cats = (await c.env.DB.prepare('SELECT * FROM categories ORDER BY name').all()).results;
  return c.html(rp(c,'Watch History', renderHistory(), cats));
});

pages.get('/about', async (c) => {
  const cats = (await c.env.DB.prepare('SELECT * FROM categories ORDER BY name').all()).results;
  const stats = await c.env.DB.prepare('SELECT COUNT(*) as count, SUM(views) as views FROM videos').first();
  return c.html(rp(c,'About', renderAbout({ stats }), cats));
});

pages.get('/bookmarks', async (c) => {
  const cats = (await c.env.DB.prepare('SELECT * FROM categories ORDER BY name').all()).results;
  return c.html(rp(c,'Bookmarks', renderBookmarks(), cats));
});

export default pages;
