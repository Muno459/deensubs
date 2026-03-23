import { Hono } from 'hono';
import { renderPage, renderHome, renderWatch, renderCategory, renderSearch } from './html';

const app = new Hono();

const VIDEO_COLS = 'v.*, c.name as category_name, c.slug as category_slug, c.color as category_color';
const VIDEO_JOIN = 'FROM videos v LEFT JOIN categories c ON v.category_id = c.id';

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
  } catch {
    return [];
  }
}

// ── Pages ──

app.get('/', async (c) => {
  const db = c.env.DB;
  const [cats, featured, recent] = await Promise.all([
    db.prepare('SELECT * FROM categories ORDER BY name').all(),
    db.prepare(`SELECT ${VIDEO_COLS} ${VIDEO_JOIN} ORDER BY v.created_at DESC LIMIT 1`).first(),
    db.prepare(`SELECT ${VIDEO_COLS} ${VIDEO_JOIN} ORDER BY v.created_at DESC LIMIT 24`).all(),
  ]);
  return c.html(renderPage('Home', renderHome({ featured, recent: recent.results, categories: cats.results }), cats.results));
});

app.get('/watch/:slug', async (c) => {
  const slug = c.req.param('slug');
  const db = c.env.DB;

  const video = await db.prepare(`SELECT ${VIDEO_COLS} ${VIDEO_JOIN} WHERE v.slug = ?`).bind(slug).first();
  if (!video) return c.text('Not found', 404);

  const [, comments, related, cats, cues] = await Promise.all([
    db.prepare('UPDATE videos SET views = views + 1 WHERE slug = ?').bind(slug).run(),
    db.prepare('SELECT * FROM comments WHERE video_id = ? ORDER BY created_at DESC LIMIT 100').bind(video.id).all(),
    db.prepare(`SELECT ${VIDEO_COLS} ${VIDEO_JOIN} WHERE v.id != ? ORDER BY CASE WHEN v.category_id = ? THEN 0 ELSE 1 END, v.created_at DESC LIMIT 10`).bind(video.id, video.category_id).all(),
    db.prepare('SELECT * FROM categories ORDER BY name').all(),
    parseSRT(c.env, video.srt_key),
  ]);

  return c.html(renderPage(video.title, renderWatch({ video, comments: comments.results, related: related.results, cues }), cats.results, video.category_slug));
});

app.get('/category/:slug', async (c) => {
  const slug = c.req.param('slug');
  const db = c.env.DB;
  const [category, videos, cats] = await Promise.all([
    db.prepare('SELECT * FROM categories WHERE slug = ?').bind(slug).first(),
    db.prepare(`SELECT ${VIDEO_COLS} ${VIDEO_JOIN} WHERE c.slug = ? ORDER BY v.created_at DESC`).bind(slug).all(),
    db.prepare('SELECT * FROM categories ORDER BY name').all(),
  ]);
  if (!category) return c.text('Not found', 404);
  return c.html(renderPage(category.name, renderCategory({ category, videos: videos.results }), cats.results, slug));
});

app.get('/search', async (c) => {
  const q = (c.req.query('q') || '').trim();
  const db = c.env.DB;
  const cats = (await db.prepare('SELECT * FROM categories ORDER BY name').all()).results;
  let videos = [];
  if (q) {
    try {
      videos = (await db.prepare(
        `SELECT ${VIDEO_COLS} ${VIDEO_JOIN} WHERE v.id IN (SELECT rowid FROM videos_fts WHERE videos_fts MATCH ?) ORDER BY v.created_at DESC LIMIT 50`
      ).bind(q + '*').all()).results;
    } catch {
      videos = (await db.prepare(
        `SELECT ${VIDEO_COLS} ${VIDEO_JOIN} WHERE v.title LIKE ? OR v.description LIKE ? OR v.source LIKE ? ORDER BY v.created_at DESC LIMIT 50`
      ).bind('%' + q + '%', '%' + q + '%', '%' + q + '%').all()).results;
    }
  }
  return c.html(renderPage(q ? 'Search: ' + q : 'Search', renderSearch({ query: q, videos }), cats));
});

// ── API ──

app.post('/api/videos/:slug/comments', async (c) => {
  const slug = c.req.param('slug');
  const db = c.env.DB;
  const video = await db.prepare('SELECT id FROM videos WHERE slug = ?').bind(slug).first();
  if (!video) return c.json({ error: 'Not found' }, 404);
  const body = await c.req.json();
  const author = (body.author || '').trim();
  const content = (body.content || '').trim();
  if (!author || !content || author.length > 100 || content.length > 2000) {
    return c.json({ error: 'Invalid' }, 400);
  }
  const r = await db.prepare('INSERT INTO comments (video_id, author, content) VALUES (?, ?, ?)').bind(video.id, author, content).run();
  const comment = await db.prepare('SELECT * FROM comments WHERE id = ?').bind(r.meta.last_row_id).first();
  return c.json({ comment }, 201);
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

export default app;
