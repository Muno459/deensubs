import { Hono } from 'hono';
import { VIDEO_COLS, VIDEO_JOIN, VIDEO_WITH_SCHOLAR, VIDEO_SCHOLAR_JOIN, readDB } from '../lib/db.js';
import { getCategories, getScholars, getHomeVideos, getPopularVideos, getHomeBundle, getVideo, getPlatformStats, getCategoryVideos, getCategory, getScholarVideos, getScholar, getRelatedVideos, getSymposiumVideos, kvGetMulti } from '../lib/kv-cache.js';
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

import { setCDN, cdn } from '../lib/helpers.js';

const VC = VIDEO_COLS;
const VJ = VIDEO_JOIN;

// Set CDN origin + execution context for stale-while-revalidate
pages.use('*', async (c, next) => {
  const cf = c.req.raw.cf;
  setCDN(
    cf?.country || c.req.header('CF-IPCountry') || '',
    cf?.region || '',
    cf?.latitude != null ? +cf.latitude : null,
    cf?.longitude != null ? +cf.longitude : null
  );
  return next();
});

// Helper to render page with user + canonical URL
function rp(c, title, body, cats, activeCat, meta) {
  return renderPage(title, body, cats, activeCat, meta, c.get('user'), c.req.url);
}


pages.get('/', async (c) => {
  const { categories: cats, videos, popular, scholars } = await getHomeBundle(c.env);
  const byCategory = {};
  videos.forEach(v => {
    const s = v.category_slug || 'other';
    if (!byCategory[s]) byCategory[s] = [];
    byCategory[s].push(v);
  });
  const featured = videos.find(v => v.thumb_key) || videos[0] || null;
  const resp = c.html(rp(c,'Home', renderHome({
    featured,
    videos,
    popular,
    categories: cats,
    byCategory,
    scholars,
  }), cats));
  if (featured?.thumb_key) {
    const base = featured.thumb_key.replace(/\.(jpg|jpeg|png)$/i, '');
    resp.headers.set('Link', `</img/${base}-640w.avif>; rel=preload; as=image`);
  }

  return resp;
});

pages.get('/watch/:slug', async (c) => {
  const slug = c.req.param('slug');
  // Bulk read video + categories in single KV call
  const [video, cats] = await kvGetMulti(c.env, [
    { key: 'video:' + slug, fetcher: async () => await readDB(c.env).prepare(`SELECT ${VIDEO_WITH_SCHOLAR} ${VIDEO_SCHOLAR_JOIN} AND v.slug = ?`).bind(slug).first(), stale: 1800 },
    { key: 'categories', fetcher: async () => (await readDB(c.env).prepare('SELECT * FROM categories ORDER BY name').all()).results, stale: 86400 },
  ]);
  if (!video) return c.html(rp(c,'Not Found', render404(), cats), 404);
  // Then fetch related + transcript in parallel (both depend on video data)
  const [related, cues] = await Promise.all([
    getRelatedVideos(c.env, video.id, video.category_id),
    video.srt_key ? parseSRT(c.env, video.srt_key) : [],
  ]);
  // Increment views via queue (reliable, batched)
  c.executionCtx.waitUntil(c.env.TASKS.send({ type: 'view', slug }));
  video._user = c.get('user');
  const base = new URL(c.req.url).origin;
  const meta = {
    description: video.description || `Watch ${video.title} with English subtitles on DeenSubs.`,
    type: 'video.other',
    image: video.thumb_key ? base + '/img/' + video.thumb_key.replace(/\.(jpg|jpeg|png)$/i, '') + '-640w.avif' : null,
    video: video.video_key ? cdn(video.video_key) : null,
  };
  const resp = c.html(rp(c,video.title, renderWatch({ video, related, cues, base }), cats, video.category_slug, meta));
  // Preload poster image via Link header (Early Hints)
  if (video.thumb_key) {
    const tb = video.thumb_key.replace(/\.(jpg|jpeg|png)$/i, '');
    resp.headers.set('Link', `</img/${tb}-640w.avif>; rel=preload; as=image`);
  }
  return resp;
});

pages.get('/category/:slug', async (c) => {
  const slug = c.req.param('slug');
  const sort = c.req.query('sort') || 'newest';
  const [category, videos, cats] = await kvGetMulti(c.env, [
    { key: 'cat-info:' + slug, fetcher: async () => await readDB(c.env).prepare('SELECT * FROM categories WHERE slug = ?').bind(slug).first(), stale: 86400 },
    { key: `cat:${slug}:${sort || 'newest'}`, fetcher: async () => { const ob = sort === 'popular' ? 'v.views DESC' : 'v.created_at DESC'; return (await readDB(c.env).prepare(`SELECT ${VC} ${VJ} AND c.slug = ? ORDER BY ${ob}`).bind(slug).all()).results; }, stale: 300 },
    { key: 'categories', fetcher: async () => (await readDB(c.env).prepare('SELECT * FROM categories ORDER BY name').all()).results, stale: 86400 },
  ]);
  if (!category) return c.html(rp(c,'Not Found', render404(), cats), 404);
  const catMeta = { description: `Browse ${videos.length} ${category.name.toLowerCase()} videos with English subtitles — translated from Arabic by AI.` };
  return c.html(rp(c,category.name, renderCategory({ category, videos, sort }), cats, slug, catMeta));
});

pages.get('/search', async (c) => {
  const q = (c.req.query('q') || '').trim().slice(0, 200);
  const db = readDB(c.env);
  const cats = await getCategories(c.env);
  let videos = [], scholars = [];
  if (q) {
    try {
      [videos, scholars] = await Promise.all([
        db.prepare(`SELECT ${VC} ${VJ} AND v.id IN (SELECT rowid FROM videos_fts WHERE videos_fts MATCH ?) ORDER BY v.created_at DESC LIMIT 50`).bind(q + '*').all().then(r => r.results),
        db.prepare("SELECT s.*, (SELECT COUNT(*) FROM videos v WHERE v.scholar_id=s.id AND v.enabled=1) as video_count FROM scholars s WHERE s.name LIKE ? LIMIT 5").bind('%' + q + '%').all().then(r => r.results),
      ]);
    } catch {
      videos = (await db.prepare(`SELECT ${VC} ${VJ} AND v.title LIKE ? OR v.description LIKE ? OR v.source LIKE ? ORDER BY v.created_at DESC LIMIT 50`).bind('%' + q + '%', '%' + q + '%', '%' + q + '%').all()).results;
    }
  }
  // Log search query
  if (q) { try { const user = c.get('user'); c.executionCtx.waitUntil(c.env.TASKS.send({ type: 'search_log', query: q, results: videos.length, user_id: user?.id || null })); } catch {} }
  return c.html(rp(c,q ? 'Search: ' + q : 'Search', renderSearch({ query: q, videos, scholars }), cats));
});

pages.get('/symposium', async (c) => {
  const [videos, cats] = await Promise.all([getSymposiumVideos(c.env), getCategories(c.env)]);
  return c.html(rp(c, 'Fatwa in the Haramain — Symposium', renderSymposium({ videos }), cats, 'symposium'));
});

pages.get('/scholars', async (c) => {
  const [scholars, cats] = await Promise.all([getScholars(c.env), getCategories(c.env)]);
  return c.html(rp(c,'Scholars', renderScholars({ scholars }), cats, 'scholars', { description: 'Browse the scholars whose Arabic lectures we translate into English with AI-powered subtitles.' }));
});

pages.get('/scholar/:slug', async (c) => {
  const slug = c.req.param('slug');
  const [scholar, cats] = await Promise.all([getScholar(c.env, slug), getCategories(c.env)]);
  if (!scholar) return c.html(rp(c,'Not Found', render404(), cats), 404);
  const videos = await getScholarVideos(c.env, scholar.id);
  const schMeta = {
    description: `Watch ${videos.length} videos by ${scholar.name} with English subtitles.${scholar.title ? ' ' + scholar.title + '.' : ''}`,
    image: scholar.photo ? new URL(c.req.url).origin + '/img/' + scholar.photo.replace(/\.(png|jpg|jpeg)$/i, '.avif') : null,
  };
  return c.html(rp(c,scholar.name, renderScholar({ scholar, videos }), cats, 'scholars', schMeta));
});

pages.get('/history', async (c) => {
  const cats = await getCategories(c.env);
  return c.html(rp(c,'Watch History', renderHistory(), cats, null, { noindex: true }));
});

pages.get('/about', async (c) => {
  const [cats, stats] = await Promise.all([getCategories(c.env), getPlatformStats(c.env)]);
  return c.html(rp(c,'About', renderAbout({ stats }), cats));
});

pages.get('/bookmarks', async (c) => {
  const cats = await getCategories(c.env);
  return c.html(rp(c,'Bookmarks', renderBookmarks(), cats, null, { noindex: true }));
});

pages.get('/profile', async (c) => {
  const user = c.get('user');
  if (!user) return c.redirect('/auth/google');
  const db = readDB(c.env);
  const [cats, comments, stats] = await Promise.all([
    getCategories(c.env),
    db.prepare('SELECT c.*, v.title as video_title, v.slug as video_slug FROM comments c LEFT JOIN videos v ON c.video_id = v.id WHERE c.user_id = ? ORDER BY c.created_at DESC LIMIT 20').bind(user.id).all(),
    db.prepare('SELECT COUNT(*) as comment_count FROM comments WHERE user_id = ?').bind(user.id).first(),
  ]);
  return c.html(rp(c, 'Profile', renderProfile({ user, comments: comments.results, stats }), cats, null, { noindex: true }));
});

export default pages;
