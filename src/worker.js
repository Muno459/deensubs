import { Hono } from 'hono';
import { renderPage, renderHome, renderWatch, renderCategory, renderSearch, renderAdmin, render404, renderAbout, renderBookmarks } from './html';

const app = new Hono();

const VC = 'v.*, c.name as category_name, c.slug as category_slug, c.color as category_color';
const VJ = 'FROM videos v LEFT JOIN categories c ON v.category_id = c.id';

// ── SRT Parser ──

async function parseSRT(env, srtKey) {
  if (!srtKey) return [];
  try {
    const obj = await env.MEDIA_BUCKET.get(srtKey);
    if (!obj) return [];
    const text = await obj.text();
    return text.trim().split(/\n\n+/).map(block => {
      const lines = block.split('\n');
      if (lines.length < 3) return null;
      const m = lines[1]?.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
      if (!m) return null;
      return {
        start: +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000,
        end: +m[5] * 3600 + +m[6] * 60 + +m[7] + +m[8] / 1000,
        text: lines.slice(2).join(' '),
      };
    }).filter(Boolean);
  } catch { return []; }
}

// ── Pages ──

app.get('/', async (c) => {
  const db = c.env.DB;
  const [cats, all, popular] = await Promise.all([
    db.prepare('SELECT * FROM categories ORDER BY name').all(),
    db.prepare(`SELECT ${VC} ${VJ} ORDER BY v.created_at DESC LIMIT 30`).all(),
    db.prepare(`SELECT ${VC} ${VJ} ORDER BY v.views DESC LIMIT 8`).all(),
  ]);
  const videos = all.results;
  const byCategory = {};
  videos.forEach(v => {
    const s = v.category_slug || 'other';
    if (!byCategory[s]) byCategory[s] = [];
    byCategory[s].push(v);
  });
  return c.html(renderPage('Home', renderHome({
    featured: videos[0] || null,
    videos,
    popular: popular.results,
    categories: cats.results,
    byCategory,
  }), cats.results));
});

app.get('/watch/:slug', async (c) => {
  const slug = c.req.param('slug');
  const db = c.env.DB;
  const video = await db.prepare(`SELECT ${VC} ${VJ} WHERE v.slug = ?`).bind(slug).first();
  if (!video) return c.html(renderPage('Not Found', render404(), (await db.prepare('SELECT * FROM categories ORDER BY name').all()).results), 404);

  const [, comments, related, cats, cues] = await Promise.all([
    db.prepare('UPDATE videos SET views = views + 1 WHERE slug = ?').bind(slug).run(),
    db.prepare('SELECT * FROM comments WHERE video_id = ? ORDER BY created_at DESC LIMIT 200').bind(video.id).all(),
    db.prepare(`SELECT ${VC} ${VJ} WHERE v.id != ? ORDER BY CASE WHEN v.category_id = ? THEN 0 ELSE 1 END, v.created_at DESC LIMIT 12`).bind(video.id, video.category_id).all(),
    db.prepare('SELECT * FROM categories ORDER BY name').all(),
    parseSRT(c.env, video.srt_key),
  ]);
  const base = new URL(c.req.url).origin;
  const meta = {
    description: video.description || `Watch ${video.title} with English subtitles on DeenSubs.`,
    type: 'video.other',
    image: video.thumb_key ? base + '/api/media/' + video.thumb_key : null,
  };
  return c.html(renderPage(video.title, renderWatch({ video, comments: comments.results, related: related.results, cues, base }), cats.results, video.category_slug, meta));
});

app.get('/category/:slug', async (c) => {
  const slug = c.req.param('slug');
  const db = c.env.DB;
  const sort = c.req.query('sort') || 'newest';
  const orderBy = sort === 'popular' ? 'v.views DESC' : 'v.created_at DESC';
  const [category, videos, cats] = await Promise.all([
    db.prepare('SELECT * FROM categories WHERE slug = ?').bind(slug).first(),
    db.prepare(`SELECT ${VC} ${VJ} WHERE c.slug = ? ORDER BY ${orderBy}`).bind(slug).all(),
    db.prepare('SELECT * FROM categories ORDER BY name').all(),
  ]);
  if (!category) return c.html(renderPage('Not Found', render404(), cats.results), 404);
  return c.html(renderPage(category.name, renderCategory({ category, videos: videos.results, sort }), cats.results, slug));
});

app.get('/search', async (c) => {
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
  return c.html(renderPage(q ? 'Search: ' + q : 'Search', renderSearch({ query: q, videos }), cats));
});

app.get('/about', async (c) => {
  const cats = (await c.env.DB.prepare('SELECT * FROM categories ORDER BY name').all()).results;
  const stats = await c.env.DB.prepare('SELECT COUNT(*) as count, SUM(views) as views FROM videos').first();
  return c.html(renderPage('About', renderAbout({ stats }), cats));
});

app.get('/bookmarks', async (c) => {
  const cats = (await c.env.DB.prepare('SELECT * FROM categories ORDER BY name').all()).results;
  return c.html(renderPage('Bookmarks', renderBookmarks(), cats));
});

// ── Admin ──

function checkAdmin(c) {
  const key = c.req.query('key');
  return key && c.env.ADMIN_KEY && key === c.env.ADMIN_KEY;
}

app.get('/admin', async (c) => {
  if (!checkAdmin(c)) return c.text('Unauthorized', 401);
  const db = c.env.DB;
  const [videos, cats] = await Promise.all([
    db.prepare(`SELECT ${VC} ${VJ} ORDER BY v.created_at DESC`).all(),
    db.prepare('SELECT * FROM categories ORDER BY name').all(),
  ]);
  return c.html(renderAdmin({ videos: videos.results, categories: cats.results, key: c.req.query('key') }));
});

app.post('/admin/video', async (c) => {
  if (!checkAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  const body = await c.req.parseBody();
  const db = c.env.DB;
  await db.prepare(
    'INSERT INTO videos (title, title_ar, slug, description, category_id, source, duration, video_key, srt_key, thumb_key) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).bind(
    body.title, body.title_ar || null, body.slug, body.description || null,
    parseInt(body.category_id) || null, body.source || null, parseInt(body.duration) || 0,
    body.video_key, body.srt_key || null, body.thumb_key || null
  ).run();
  return c.redirect('/admin?key=' + c.req.query('key'));
});

app.get('/admin/edit/:id', async (c) => {
  if (!checkAdmin(c)) return c.text('Unauthorized', 401);
  const db = c.env.DB;
  const video = await db.prepare('SELECT * FROM videos WHERE id = ?').bind(parseInt(c.req.param('id'))).first();
  if (!video) return c.text('Not found', 404);
  const cats = (await db.prepare('SELECT * FROM categories ORDER BY name').all()).results;
  return c.html(renderAdmin({ videos: [], categories: cats, key: c.req.query('key'), editing: video }));
});

app.post('/admin/edit/:id', async (c) => {
  if (!checkAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  const body = await c.req.parseBody();
  await c.env.DB.prepare(
    'UPDATE videos SET title=?, title_ar=?, description=?, category_id=?, source=?, duration=?, video_key=?, srt_key=?, thumb_key=? WHERE id=?'
  ).bind(
    body.title, body.title_ar || null, body.description || null,
    parseInt(body.category_id) || null, body.source || null, parseInt(body.duration) || 0,
    body.video_key, body.srt_key || null, body.thumb_key || null,
    parseInt(c.req.param('id'))
  ).run();
  return c.redirect('/admin?key=' + c.req.query('key'));
});

app.post('/admin/delete/:id', async (c) => {
  if (!checkAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  await c.env.DB.prepare('DELETE FROM videos WHERE id = ?').bind(parseInt(c.req.param('id'))).run();
  return c.redirect('/admin?key=' + c.req.query('key'));
});

// ── API ──

app.get('/api/videos', async (c) => {
  const videos = (await c.env.DB.prepare(`SELECT ${VC} ${VJ} ORDER BY v.created_at DESC LIMIT 100`).all()).results;
  return c.json({ videos });
});

app.post('/api/videos/:slug/like', async (c) => {
  const slug = c.req.param('slug');
  await c.env.DB.prepare('UPDATE videos SET likes = likes + 1 WHERE slug = ?').bind(slug).run();
  const video = await c.env.DB.prepare('SELECT likes FROM videos WHERE slug = ?').bind(slug).first();
  return c.json({ likes: video?.likes || 0 });
});

app.post('/api/videos/:slug/comments', async (c) => {
  const slug = c.req.param('slug');
  const db = c.env.DB;
  const video = await db.prepare('SELECT id FROM videos WHERE slug = ?').bind(slug).first();
  if (!video) return c.json({ error: 'Not found' }, 404);
  const body = await c.req.json();
  const author = (body.author || '').trim();
  const content = (body.content || '').trim();
  if (!author || !content || author.length > 100 || content.length > 2000) return c.json({ error: 'Invalid' }, 400);
  const r = await db.prepare('INSERT INTO comments (video_id, author, content) VALUES (?, ?, ?)').bind(video.id, author, content).run();
  const comment = await db.prepare('SELECT * FROM comments WHERE id = ?').bind(r.meta.last_row_id).first();
  return c.json({ comment }, 201);
});

// ── Static assets ──

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#0a0a10"/><rect x="7" y="7" width="18" height="18" fill="none" stroke="#c4a44c" stroke-width="1.2"/><rect x="7" y="7" width="18" height="18" fill="none" stroke="#c4a44c" stroke-width="1.2" transform="rotate(45 16 16)"/><circle cx="16" cy="16" r="3" fill="none" stroke="#c4a44c" stroke-width="0.8"/></svg>`;

app.get('/favicon.svg', (c) => new Response(FAVICON, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=604800' } }));

app.get('/favicon.ico', (c) => new Response(FAVICON, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=604800' } }));

app.get('/robots.txt', (c) => new Response(`User-agent: *\nAllow: /\nSitemap: ${new URL(c.req.url).origin}/sitemap.xml\n`, { headers: { 'Content-Type': 'text/plain' } }));

app.get('/manifest.json', (c) => c.json({
  name: 'DeenSubs',
  short_name: 'DeenSubs',
  description: 'Arabic Islamic content with English subtitles',
  start_url: '/',
  display: 'standalone',
  background_color: '#050507',
  theme_color: '#c4a44c',
  icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' }],
}));

// ── RSS Feed ──

app.get('/feed.xml', async (c) => {
  const videos = (await c.env.DB.prepare(`SELECT ${VC} ${VJ} ORDER BY v.created_at DESC LIMIT 50`).all()).results;
  const base = new URL(c.req.url).origin;
  const items = videos.map(v => `<item>
<title>${e(v.title)}</title>
<link>${base}/watch/${v.slug}</link>
<description>${e(v.description || '')}</description>
<pubDate>${new Date(v.created_at + 'Z').toUTCString()}</pubDate>
<guid>${base}/watch/${v.slug}</guid>
${v.thumb_key ? `<enclosure url="${base}/api/media/${v.thumb_key}" type="image/jpeg"/>` : ''}
</item>`).join('\n');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel><title>DeenSubs</title><link>${base}</link>
<description>Arabic Islamic lectures with AI-powered English subtitles</description>
<language>en</language>
<atom:link href="${base}/feed.xml" rel="self" type="application/rss+xml"/>
${items}</channel></rss>`, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
});

// ── Sitemap ──

app.get('/sitemap.xml', async (c) => {
  const db = c.env.DB;
  const [videos, cats] = await Promise.all([
    db.prepare('SELECT slug, created_at FROM videos ORDER BY created_at DESC').all(),
    db.prepare('SELECT slug FROM categories ORDER BY name').all(),
  ]);
  const base = new URL(c.req.url).origin;
  const urls = [`<url><loc>${base}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`];
  cats.results.forEach(c => urls.push(`<url><loc>${base}/category/${c.slug}</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>`));
  videos.results.forEach(v => urls.push(`<url><loc>${base}/watch/${v.slug}</loc><lastmod>${v.created_at?.split(' ')[0] || ''}</lastmod><priority>0.9</priority></url>`));
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('\n')}</urlset>`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
});

// ── R2 Media ──

app.get('/api/media/*', async (c) => {
  const key = c.req.path.replace('/api/media/', '');
  const rangeH = c.req.header('Range');
  let obj;
  if (rangeH) {
    const m = rangeH.match(/bytes=(\d+)-(\d*)/);
    if (m) {
      const offset = parseInt(m[1]);
      const end = m[2] ? parseInt(m[2]) : undefined;
      obj = await c.env.MEDIA_BUCKET.get(key, { range: { offset, length: end !== undefined ? end - offset + 1 : undefined } });
    }
  }
  if (!obj) obj = await c.env.MEDIA_BUCKET.get(key);
  if (!obj) return c.text('Not found', 404);
  const h = new Headers();
  obj.writeHttpMetadata(h);
  h.set('Accept-Ranges', 'bytes');
  h.set('Cache-Control', 'public, max-age=86400');
  if (rangeH && obj.range) {
    const { offset, length } = obj.range;
    h.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    h.set('Content-Length', String(length));
    return new Response(obj.body, { status: 206, headers: h });
  }
  h.set('Content-Length', String(obj.size));
  return new Response(obj.body, { headers: h });
});

// ── 404 ──

app.notFound(async (c) => {
  const cats = (await c.env.DB.prepare('SELECT * FROM categories ORDER BY name').all()).results;
  return c.html(renderPage('Not Found', render404(), cats), 404);
});

export default app;
