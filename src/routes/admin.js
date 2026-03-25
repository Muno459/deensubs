import { Hono } from 'hono';
import { VIDEO_COLS, VIDEO_JOIN } from '../lib/db.js';
import { renderAdmin } from '../templates/admin.js';

const admin = new Hono();

const VC = VIDEO_COLS;
const VJ = VIDEO_JOIN;

function checkAdmin(c) {
  const key = c.req.query('key');
  return key && c.env.ADMIN_KEY && key === c.env.ADMIN_KEY;
}

admin.get('/admin', async (c) => {
  if (!checkAdmin(c)) return c.text('Unauthorized', 401);
  const db = c.env.DB;
  const [videos, cats] = await Promise.all([
    db.prepare(`SELECT ${VC} ${VJ} ORDER BY v.created_at DESC`).all(),
    db.prepare('SELECT * FROM categories ORDER BY name').all(),
  ]);
  return c.html(renderAdmin({ videos: videos.results, categories: cats.results, key: c.req.query('key') }));
});

admin.post('/admin/video', async (c) => {
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

admin.get('/admin/edit/:id', async (c) => {
  if (!checkAdmin(c)) return c.text('Unauthorized', 401);
  const db = c.env.DB;
  const video = await db.prepare('SELECT * FROM videos WHERE id = ?').bind(parseInt(c.req.param('id'))).first();
  if (!video) return c.text('Not found', 404);
  const cats = (await db.prepare('SELECT * FROM categories ORDER BY name').all()).results;
  return c.html(renderAdmin({ videos: [], categories: cats, key: c.req.query('key'), editing: video }));
});

admin.post('/admin/edit/:id', async (c) => {
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

admin.post('/admin/delete/:id', async (c) => {
  if (!checkAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  await c.env.DB.prepare('DELETE FROM videos WHERE id = ?').bind(parseInt(c.req.param('id'))).run();
  return c.redirect('/admin?key=' + c.req.query('key'));
});

export default admin;
