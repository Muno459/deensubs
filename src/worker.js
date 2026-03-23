import { Hono } from 'hono';
import { renderPage, renderHome, renderWatch, renderCategory } from './html';

const app = new Hono();

// ── Pages ──

app.get('/', async (c) => {
  const db = c.env.DB;
  const categories = (await db.prepare('SELECT * FROM categories ORDER BY name').all()).results;
  const featured = await db.prepare(
    'SELECT v.*, c.name as category_name, c.slug as category_slug FROM videos v LEFT JOIN categories c ON v.category_id = c.id ORDER BY v.created_at DESC LIMIT 1'
  ).first();
  const recent = (await db.prepare(
    'SELECT v.*, c.name as category_name, c.slug as category_slug FROM videos v LEFT JOIN categories c ON v.category_id = c.id ORDER BY v.created_at DESC LIMIT 20'
  ).all()).results;

  return c.html(renderPage('Home', renderHome({ featured, recent, categories }), categories));
});

app.get('/watch/:slug', async (c) => {
  const slug = c.req.param('slug');
  const db = c.env.DB;

  const video = await db.prepare(
    'SELECT v.*, c.name as category_name, c.slug as category_slug FROM videos v LEFT JOIN categories c ON v.category_id = c.id WHERE v.slug = ?'
  ).bind(slug).first();
  if (!video) return c.text('Not found', 404);

  await db.prepare('UPDATE videos SET views = views + 1 WHERE slug = ?').bind(slug).run();

  const comments = (await db.prepare(
    'SELECT * FROM comments WHERE video_id = ? ORDER BY created_at DESC'
  ).bind(video.id).all()).results;

  const related = (await db.prepare(
    'SELECT v.*, c.name as category_name FROM videos v LEFT JOIN categories c ON v.category_id = c.id WHERE v.id != ? ORDER BY RANDOM() LIMIT 8'
  ).bind(video.id).all()).results;

  const categories = (await db.prepare('SELECT * FROM categories ORDER BY name').all()).results;

  return c.html(renderPage(video.title, renderWatch({ video, comments, related }), categories, video.category_slug));
});

app.get('/category/:slug', async (c) => {
  const slug = c.req.param('slug');
  const db = c.env.DB;

  const category = await db.prepare('SELECT * FROM categories WHERE slug = ?').bind(slug).first();
  if (!category) return c.text('Not found', 404);

  const videos = (await db.prepare(
    'SELECT v.*, c.name as category_name, c.slug as category_slug FROM videos v LEFT JOIN categories c ON v.category_id = c.id WHERE c.slug = ? ORDER BY v.created_at DESC'
  ).bind(slug).all()).results;

  const categories = (await db.prepare('SELECT * FROM categories ORDER BY name').all()).results;

  return c.html(renderPage(category.name, renderCategory({ category, videos }), categories, slug));
});

// ── API ──

app.get('/api/videos', async (c) => {
  const db = c.env.DB;
  const cat = c.req.query('category');
  let q = 'SELECT v.*, c.name as category_name, c.slug as category_slug FROM videos v LEFT JOIN categories c ON v.category_id = c.id';
  const binds = [];
  if (cat) { q += ' WHERE c.slug = ?'; binds.push(cat); }
  q += ' ORDER BY v.created_at DESC LIMIT 50';
  const stmt = binds.length ? db.prepare(q).bind(...binds) : db.prepare(q);
  const videos = (await stmt.all()).results;
  return c.json({ videos });
});

app.post('/api/videos/:slug/comments', async (c) => {
  const slug = c.req.param('slug');
  const db = c.env.DB;
  const video = await db.prepare('SELECT id FROM videos WHERE slug = ?').bind(slug).first();
  if (!video) return c.json({ error: 'Video not found' }, 404);

  const { author, content } = await c.req.json();
  if (!author || !content || author.length > 100 || content.length > 2000) {
    return c.json({ error: 'Invalid input' }, 400);
  }

  const result = await db.prepare(
    'INSERT INTO comments (video_id, author, content) VALUES (?, ?, ?)'
  ).bind(video.id, author.trim(), content.trim()).run();

  const comment = await db.prepare('SELECT * FROM comments WHERE id = ?').bind(result.meta.last_row_id).first();
  return c.json({ comment }, 201);
});

app.get('/api/videos/:slug/comments', async (c) => {
  const slug = c.req.param('slug');
  const db = c.env.DB;
  const video = await db.prepare('SELECT id FROM videos WHERE slug = ?').bind(slug).first();
  if (!video) return c.json({ error: 'Not found' }, 404);
  const comments = (await db.prepare(
    'SELECT * FROM comments WHERE video_id = ? ORDER BY created_at DESC'
  ).bind(video.id).all()).results;
  return c.json({ comments });
});

// ── R2 Media (with Range support) ──

app.get('/api/media/*', async (c) => {
  const key = c.req.path.replace('/api/media/', '');
  const rangeHeader = c.req.header('Range');
  let object;

  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const offset = parseInt(match[1]);
      const end = match[2] ? parseInt(match[2]) : undefined;
      const length = end !== undefined ? end - offset + 1 : undefined;
      object = await c.env.MEDIA_BUCKET.get(key, { range: { offset, length } });
    }
  }

  if (!object) {
    object = await c.env.MEDIA_BUCKET.get(key);
  }

  if (!object) return c.text('Not found', 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'public, max-age=86400');

  if (rangeHeader && object.range) {
    const { offset, length } = object.range;
    headers.set('Content-Range', 'bytes ' + offset + '-' + (offset + length - 1) + '/' + object.size);
    headers.set('Content-Length', String(length));
    return new Response(object.body, { status: 206, headers });
  }

  headers.set('Content-Length', String(object.size));
  return new Response(object.body, { headers });
});

export default app;
