import { Hono } from 'hono';
import { VIDEO_COLS, VIDEO_JOIN } from '../lib/db.js';
import { renderAdmin } from '../templates/admin.js';

const admin = new Hono();
const VC = VIDEO_COLS;
const VJ = VIDEO_JOIN;

function isAdmin(c) {
  // API key auth OR logged-in admin user
  const key = c.req.query('key');
  if (key && c.env.ADMIN_KEY && key === c.env.ADMIN_KEY) return true;
  const user = c.get('user');
  return user && user.role === 'admin';
}

admin.get('/admin', async (c) => {
  if (!isAdmin(c)) return c.text('Unauthorized — sign in with an admin account or use ?key=', 401);
  const db = c.env.DB;
  const tab = c.req.query('tab') || 'dashboard';
  const key = c.req.query('key') || '';

  const queries = [
    db.prepare(`SELECT ${VC} ${VJ} ORDER BY v.created_at DESC`).all(),
    db.prepare('SELECT * FROM categories ORDER BY name').all(),
    db.prepare('SELECT id, name, email, avatar, role, created_at FROM users ORDER BY created_at DESC').all(),
    db.prepare('SELECT c.*, u.name as user_name, u.avatar as user_avatar, v.title as video_title, v.slug as video_slug FROM comments c LEFT JOIN users u ON c.user_id = u.id LEFT JOIN videos v ON c.video_id = v.id ORDER BY c.created_at DESC LIMIT 50').all(),
    db.prepare('SELECT (SELECT COUNT(*) FROM videos) as video_count, (SELECT COUNT(*) FROM users) as user_count, (SELECT COUNT(*) FROM comments) as comment_count, (SELECT SUM(views) FROM videos) as total_views, (SELECT SUM(likes) FROM videos) as total_likes').first(),
    db.prepare("SELECT country, COUNT(*) as hits FROM analytics WHERE country != '' GROUP BY country ORDER BY hits DESC LIMIT 20").all(),
    db.prepare("SELECT path, COUNT(*) as hits FROM analytics WHERE type='pageview' GROUP BY path ORDER BY hits DESC LIMIT 20").all(),
    db.prepare("SELECT slug, COUNT(*) as hits FROM analytics WHERE type='watch' AND slug IS NOT NULL GROUP BY slug ORDER BY hits DESC LIMIT 15").all(),
    db.prepare("SELECT DATE(created_at) as day, COUNT(*) as hits FROM analytics GROUP BY day ORDER BY day DESC LIMIT 14").all(),
    db.prepare("SELECT query, results, COUNT(*) as times FROM search_logs GROUP BY query ORDER BY times DESC LIMIT 30").all(),
    db.prepare("SELECT ip, country, COUNT(*) as hits, MAX(created_at) as last_seen FROM analytics GROUP BY ip ORDER BY hits DESC LIMIT 30").all(),
    db.prepare("SELECT user_agent, COUNT(*) as hits FROM analytics GROUP BY user_agent ORDER BY hits DESC LIMIT 20").all(),
    db.prepare("SELECT referer, COUNT(*) as hits FROM analytics WHERE referer != '' GROUP BY referer ORDER BY hits DESC LIMIT 20").all(),
  ];

  const [videos, cats, users, recentComments, stats, countries, topPages, topVideos, dailyHits, searchLogs, visitors, agents, referers] = await Promise.all(queries);

  return c.html(renderAdmin({
    videos: videos.results,
    categories: cats.results,
    users: users.results,
    comments: recentComments.results,
    stats,
    countries: countries.results,
    topPages: topPages.results,
    topVideos: topVideos.results,
    dailyHits: dailyHits.results,
    searchLogs: searchLogs.results,
    visitors: visitors.results,
    agents: agents.results,
    referers: referers.results,
    key,
    tab,
    editing: null,
  }));
});

admin.get('/admin/edit/:id', async (c) => {
  if (!isAdmin(c)) return c.text('Unauthorized', 401);
  const db = c.env.DB;
  const video = await db.prepare('SELECT * FROM videos WHERE id = ?').bind(parseInt(c.req.param('id'))).first();
  if (!video) return c.text('Not found', 404);
  const cats = (await db.prepare('SELECT * FROM categories ORDER BY name').all()).results;
  return c.html(renderAdmin({ videos: [], categories: cats, key: c.req.query('key') || '', tab: 'videos', editing: video, users: [], comments: [], stats: {} }));
});

admin.post('/admin/video', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  const body = await c.req.parseBody();
  await c.env.DB.prepare(
    'INSERT INTO videos (title, title_ar, slug, description, category_id, source, duration, video_key, srt_key, thumb_key) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).bind(body.title, body.title_ar || null, body.slug, body.description || null, parseInt(body.category_id) || null, body.source || null, parseInt(body.duration) || 0, body.video_key, body.srt_key || null, body.thumb_key || null).run();
  return c.redirect('/admin?tab=videos' + (c.req.query('key') ? '&key=' + c.req.query('key') : ''));
});

admin.post('/admin/edit/:id', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  const body = await c.req.parseBody();
  await c.env.DB.prepare(
    'UPDATE videos SET title=?, title_ar=?, description=?, category_id=?, source=?, duration=?, video_key=?, srt_key=?, thumb_key=? WHERE id=?'
  ).bind(body.title, body.title_ar || null, body.description || null, parseInt(body.category_id) || null, body.source || null, parseInt(body.duration) || 0, body.video_key, body.srt_key || null, body.thumb_key || null, parseInt(c.req.param('id'))).run();
  return c.redirect('/admin?tab=videos' + (c.req.query('key') ? '&key=' + c.req.query('key') : ''));
});

admin.post('/admin/delete/:id', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  await c.env.DB.prepare('DELETE FROM videos WHERE id = ?').bind(parseInt(c.req.param('id'))).run();
  return c.redirect('/admin?tab=videos' + (c.req.query('key') ? '&key=' + c.req.query('key') : ''));
});

admin.post('/admin/delete-comment/:id', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  await c.env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(parseInt(c.req.param('id'))).run();
  return c.redirect('/admin?tab=comments' + (c.req.query('key') ? '&key=' + c.req.query('key') : ''));
});

admin.post('/admin/user-role/:id', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  const body = await c.req.parseBody();
  await c.env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(body.role, parseInt(c.req.param('id'))).run();
  return c.redirect('/admin?tab=users' + (c.req.query('key') ? '&key=' + c.req.query('key') : ''));
});

// AI Chat endpoint for admin
admin.post('/admin/ai', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  const { prompt, context } = await c.req.json();
  try {
    const res = await fetch(c.env.AI_BASE_URL + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + c.env.AI_API_KEY },
      body: JSON.stringify({
        model: 'cx/gpt-5.4',
        messages: [
          { role: 'system', content: 'You are the DeenSubs admin AI assistant. You help manage an Islamic content platform. You have access to platform stats and can help with content strategy, SEO, video descriptions, and moderation decisions. Be concise and actionable.' },
          { role: 'user', content: (context ? 'Platform context: ' + context + '\n\n' : '') + prompt }
        ],
        max_tokens: 1000,
      }),
    });
    const data = await res.json();
    return c.json({ response: data.choices?.[0]?.message?.content || 'No response' });
  } catch (err) {
    return c.json({ error: 'AI request failed: ' + err.message }, 500);
  }
});

export default admin;
