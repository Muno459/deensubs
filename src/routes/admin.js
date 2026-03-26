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
    db.prepare("SELECT f.*, u.name as user_name, u.email as user_email, u.avatar as user_avatar FROM fingerprints f LEFT JOIN users u ON f.user_id = u.id ORDER BY f.last_seen DESC LIMIT 50").all(),
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

// Fingerprint detail
admin.get('/admin/fingerprint/:id', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  const fpId = c.req.param('id');
  const db = c.env.DB;
  const [fp, pages, user] = await Promise.all([
    db.prepare('SELECT * FROM fingerprints WHERE id = ?').bind(fpId).first(),
    db.prepare("SELECT path, slug, created_at FROM analytics WHERE ip = (SELECT ip FROM fingerprints WHERE id = ?) ORDER BY created_at DESC LIMIT 100").bind(fpId).all(),
    db.prepare('SELECT u.* FROM users u JOIN fingerprints f ON u.id = f.user_id WHERE f.id = ?').bind(fpId).first(),
  ]);
  return c.json({ fingerprint: fp, pages: pages.results, user });
});

// SQL Console (read-only)
admin.post('/admin/sql', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  const { query } = await c.req.json();
  if (!query) return c.json({ error: 'No query' }, 400);
  const lower = query.trim().toLowerCase();
  if (!lower.startsWith('select')) return c.json({ error: 'Only SELECT queries allowed' }, 403);
  try {
    const result = await c.env.DB.prepare(query).all();
    const user = c.get('user');
    c.executionCtx.waitUntil(c.env.DB.prepare('INSERT INTO admin_logs (admin_id, action, target, details) VALUES (?, ?, ?, ?)').bind(user?.id, 'sql_query', 'database', query.slice(0, 500)).run());
    return c.json({ results: result.results, meta: result.meta });
  } catch (err) {
    return c.json({ error: err.message }, 400);
  }
});

// User journey endpoint
admin.get('/admin/user-journey/:id', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  const uid = parseInt(c.req.param('id'));
  const db = c.env.DB;
  const [user, pages, comments, searches] = await Promise.all([
    db.prepare('SELECT * FROM users WHERE id = ?').bind(uid).first(),
    db.prepare("SELECT path, created_at FROM analytics WHERE user_id = ? ORDER BY created_at DESC LIMIT 50").bind(uid).all(),
    db.prepare('SELECT c.*, v.title as video_title FROM comments c LEFT JOIN videos v ON c.video_id = v.id WHERE c.user_id = ? ORDER BY c.created_at DESC').bind(uid).all(),
    db.prepare('SELECT * FROM search_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').bind(uid).all(),
  ]);
  return c.json({ user, pages: pages.results, comments: comments.results, searches: searches.results });
});

// Export endpoints
admin.get('/admin/export/videos', async (c) => {
  if (!isAdmin(c)) return c.text('Unauthorized', 401);
  const videos = (await c.env.DB.prepare('SELECT * FROM videos ORDER BY id').all()).results;
  const csv = 'id,title,slug,category_id,source,views,likes,duration,created_at\n' + videos.map(v => `${v.id},"${(v.title||'').replace(/"/g,'""')}",${v.slug},${v.category_id},"${(v.source||'').replace(/"/g,'""')}",${v.views},${v.likes},${v.duration},"${v.created_at}"`).join('\n');
  return new Response(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=deensubs-videos.csv' } });
});

admin.get('/admin/export/users', async (c) => {
  if (!isAdmin(c)) return c.text('Unauthorized', 401);
  const users = (await c.env.DB.prepare('SELECT id,name,email,role,created_at FROM users ORDER BY id').all()).results;
  const csv = 'id,name,email,role,created_at\n' + users.map(u => `${u.id},"${(u.name||'').replace(/"/g,'""')}",${u.email},${u.role},"${u.created_at}"`).join('\n');
  return new Response(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=deensubs-users.csv' } });
});

admin.get('/admin/export/analytics', async (c) => {
  if (!isAdmin(c)) return c.text('Unauthorized', 401);
  const data = (await c.env.DB.prepare('SELECT * FROM analytics ORDER BY created_at DESC LIMIT 5000').all()).results;
  return c.json(data);
});

// Bulk actions
admin.post('/admin/bulk-delete-comments', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  const { ids } = await c.req.json();
  if (!ids || !ids.length) return c.json({ error: 'No IDs' }, 400);
  for (const id of ids) {
    await c.env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(id).run();
  }
  return c.json({ deleted: ids.length });
});

// AI Chat endpoint for admin
// AI tool definitions
const AI_TOOLS = [
  { type: 'function', function: { name: 'query_database', description: 'Run a read-only SQL SELECT query on the DeenSubs database. Tables: videos, users, comments, categories, scholars, analytics, search_logs, fingerprints, watch_events. Example: SELECT title, views FROM videos ORDER BY views DESC LIMIT 5', parameters: { type: 'object', properties: { query: { type: 'string', description: 'SQL SELECT query' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'get_video_stats', description: 'Get detailed stats for a video including views, likes, comments, watch events', parameters: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] } } },
  { type: 'function', function: { name: 'generate_description', description: 'Generate an SEO-optimized video description given the title and context', parameters: { type: 'object', properties: { title: { type: 'string' }, context: { type: 'string', description: 'Any additional context about the video' } }, required: ['title'] } } },
  { type: 'function', function: { name: 'get_platform_stats', description: 'Get current platform overview stats', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'get_top_searches', description: 'Get the most popular search queries', parameters: { type: 'object', properties: { limit: { type: 'number', description: 'Number of results (default 10)' } } } } },
  { type: 'function', function: { name: 'get_visitor_countries', description: 'Get visitor distribution by country', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'moderate_comment', description: 'Delete a comment by ID', parameters: { type: 'object', properties: { comment_id: { type: 'number' } }, required: ['comment_id'] } } },
  { type: 'function', function: { name: 'update_video', description: 'Update a video field (title, description, source, category_id)', parameters: { type: 'object', properties: { slug: { type: 'string' }, field: { type: 'string', enum: ['title', 'description', 'source', 'category_id'] }, value: { type: 'string' } }, required: ['slug', 'field', 'value'] } } },
];

// AI tool execution
async function executeTool(db, name, args) {
  switch (name) {
    case 'query_database': {
      if (!args.query?.trim().toLowerCase().startsWith('select')) return { error: 'Only SELECT queries' };
      const r = await db.prepare(args.query).all();
      return { results: r.results?.slice(0, 20), count: r.results?.length };
    }
    case 'get_video_stats': {
      const v = await db.prepare('SELECT v.*, c.name as category FROM videos v LEFT JOIN categories c ON v.category_id=c.id WHERE v.slug=?').bind(args.slug).first();
      if (!v) return { error: 'Video not found' };
      const comments = await db.prepare('SELECT COUNT(*) as c FROM comments WHERE video_id=?').bind(v.id).first();
      const watches = await db.prepare("SELECT COUNT(*) as c FROM watch_events WHERE video_slug=?").bind(args.slug).first();
      return { title: v.title, views: v.views, likes: v.likes, comments: comments?.c, watch_events: watches?.c, category: v.category, source: v.source, duration: v.duration, has_subs: !!v.srt_key };
    }
    case 'get_platform_stats': {
      return await db.prepare('SELECT (SELECT COUNT(*) FROM videos) as videos, (SELECT COUNT(*) FROM users) as users, (SELECT COUNT(*) FROM comments) as comments, (SELECT SUM(views) FROM videos) as views, (SELECT SUM(likes) FROM videos) as likes, (SELECT COUNT(DISTINCT country) FROM fingerprints) as countries').first();
    }
    case 'get_top_searches': {
      const r = await db.prepare('SELECT query, COUNT(*) as times, MAX(results) as results FROM search_logs GROUP BY query ORDER BY times DESC LIMIT ?').bind(args.limit || 10).all();
      return r.results;
    }
    case 'get_visitor_countries': {
      const r = await db.prepare("SELECT country, COUNT(*) as hits FROM analytics WHERE country!='' GROUP BY country ORDER BY hits DESC LIMIT 20").all();
      return r.results;
    }
    case 'moderate_comment': {
      await db.prepare('DELETE FROM comments WHERE id=?').bind(args.comment_id).run();
      return { deleted: true, comment_id: args.comment_id };
    }
    case 'update_video': {
      const allowed = ['title', 'description', 'source', 'category_id'];
      if (!allowed.includes(args.field)) return { error: 'Field not allowed' };
      await db.prepare(`UPDATE videos SET ${args.field}=? WHERE slug=?`).bind(args.value, args.slug).run();
      return { updated: true, slug: args.slug, field: args.field };
    }
    case 'generate_description': {
      return { note: 'Use AI to generate - this is handled by the model itself', title: args.title, context: args.context };
    }
    default: return { error: 'Unknown tool' };
  }
}

admin.post('/admin/ai', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  const { prompt, context, history } = await c.req.json();
  const db = c.env.DB;

  const messages = [
    { role: 'system', content: `You are the DeenSubs admin AI assistant with tool access. You help manage an Islamic content platform.

You can:
- Query the database directly (query_database)
- Get video stats (get_video_stats)
- Get platform overview (get_platform_stats)
- See top searches (get_top_searches)
- See visitor countries (get_visitor_countries)
- Delete comments (moderate_comment)
- Update video fields (update_video)
- Generate SEO descriptions (generate_description)

Platform context: ${context || 'DeenSubs - Arabic Islamic content with English subtitles'}

Be concise and actionable. Use tools when the user asks for data rather than guessing.` },
    ...(history || []),
    { role: 'user', content: prompt }
  ];

  try {
    // First call - may return tool calls
    const res = await fetch(c.env.AI_BASE_URL + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + c.env.AI_API_KEY },
      body: JSON.stringify({ model: 'cx/gpt-5.4', messages, tools: AI_TOOLS, max_tokens: 1500 }),
    });
    const data = await res.json();
    const msg = data.choices?.[0]?.message;

    if (msg?.tool_calls?.length) {
      // Execute tools and send results back
      const toolResults = [];
      for (const tc of msg.tool_calls) {
        const args = JSON.parse(tc.function.arguments || '{}');
        const result = await executeTool(db, tc.function.name, args);
        toolResults.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
      }

      // Second call with tool results
      const res2 = await fetch(c.env.AI_BASE_URL + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + c.env.AI_API_KEY },
        body: JSON.stringify({ model: 'cx/gpt-5.4', messages: [...messages, msg, ...toolResults], max_tokens: 1500 }),
      });
      const data2 = await res2.json();
      return c.json({
        response: data2.choices?.[0]?.message?.content || 'No response',
        tools_used: msg.tool_calls.map(tc => tc.function.name),
      });
    }

    return c.json({ response: msg?.content || 'No response' });
  } catch (err) {
    return c.json({ error: 'AI request failed: ' + err.message }, 500);
  }
});

export default admin;
