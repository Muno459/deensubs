import { Hono } from 'hono';
import { VIDEO_COLS, VIDEO_JOIN, VIDEO_WITH_SCHOLAR, VIDEO_SCHOLAR_JOIN, readDB, writeDB } from '../lib/db.js';
import { getCategories, getScholars, getHomeVideos, getPopularVideos, getVideo, getPlatformStats, getCategoryVideos, getCategory, getScholarVideos, getScholar, getRelatedVideos, getSymposiumVideos } from '../lib/kv-cache.js';
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
  const video = await getVideo(c.env, slug);
  if (!video) return c.html(rp(c,'Not Found', render404(), await getCategories(c.env)), 404);

  const [, cats, related, cues] = await Promise.all([
    writeDB(c.env).prepare('UPDATE videos SET views = views + 1 WHERE slug = ?').bind(slug).run(),
    getCategories(c.env),
    getRelatedVideos(c.env, video.id, video.category_id),
    parseSRT(c.env, video.srt_key),
  ]);
  video._user = c.get('user');
  const base = new URL(c.req.url).origin;
  const meta = {
    description: video.description || `Watch ${video.title} with English subtitles on DeenSubs.`,
    type: 'video.other',
    image: video.thumb_key ? base + '/api/media/' + video.thumb_key : null,
  };
  return c.html(rp(c,video.title, renderWatch({ video, related, cues, base }), cats, video.category_slug, meta));
});

pages.get('/category/:slug', async (c) => {
  const slug = c.req.param('slug');
  const sort = c.req.query('sort') || 'newest';
  const [category, videos, cats] = await Promise.all([
    getCategory(c.env, slug),
    getCategoryVideos(c.env, slug, sort),
    getCategories(c.env),
  ]);
  if (!category) return c.html(rp(c,'Not Found', render404(), cats), 404);
  return c.html(rp(c,category.name, renderCategory({ category, videos, sort }), cats, slug));
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
  const [videos, cats] = await Promise.all([getSymposiumVideos(c.env), getCategories(c.env)]);
  return c.html(rp(c, 'Fatwa in the Haramain — Symposium', renderSymposium({ videos }), cats, 'symposium'));
});

pages.get('/scholars', async (c) => {
  const [scholars, cats] = await Promise.all([getScholars(c.env), getCategories(c.env)]);
  return c.html(rp(c,'Scholars', renderScholars({ scholars }), cats, 'scholars'));
});

pages.get('/scholar/:slug', async (c) => {
  const slug = c.req.param('slug');
  const scholar = await getScholar(c.env, slug);
  if (!scholar) return c.html(rp(c,'Not Found', render404(), await getCategories(c.env)), 404);
  const [videos, cats] = await Promise.all([
    getScholarVideos(c.env, scholar.id),
    getCategories(c.env),
  ]);
  return c.html(rp(c,scholar.name, renderScholar({ scholar, videos }), cats, 'scholars'));
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
