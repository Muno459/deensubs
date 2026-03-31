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

  // Only load data needed for the active tab (was 17 queries for every tab)
  const base = [
    db.prepare('SELECT (SELECT COUNT(*) FROM videos) as video_count, (SELECT COUNT(*) FROM users) as user_count, (SELECT COUNT(*) FROM comments) as comment_count, (SELECT SUM(views) FROM videos) as total_views, (SELECT SUM(likes) FROM videos) as total_likes').first(),
    db.prepare('SELECT * FROM categories ORDER BY name').all(),
    db.prepare("SELECT * FROM scholars ORDER BY name").all(),
  ];
  const [stats, catsR, scholarsR] = await Promise.all(base);
  const cats = catsR.results; const scholars = scholarsR.results;

  // Tab-specific queries
  let videos = [], users = [], comments = [], countries = [], topPages = [], topVideos = [], dailyHits = [], searchLogs = [], visitors = [], agents = [], referers = [], watchEvents = [], watchCompletion = [], watchConnections = [];

  if (tab === 'dashboard') {
    const [v, co, cm, tp, tv, dh] = await Promise.all([
      db.prepare(`SELECT ${VC} ${VJ} ORDER BY v.created_at DESC LIMIT 20`).all(),
      db.prepare("SELECT country, COUNT(*) as hits FROM analytics WHERE country != '' GROUP BY country ORDER BY hits DESC LIMIT 20").all(),
      db.prepare('SELECT c.*, u.name as user_name, u.avatar as user_avatar, v.title as video_title, v.slug as video_slug FROM comments c LEFT JOIN users u ON c.user_id = u.id LEFT JOIN videos v ON c.video_id = v.id ORDER BY c.created_at DESC LIMIT 10').all(),
      db.prepare("SELECT path, COUNT(*) as hits FROM analytics WHERE type='pageview' GROUP BY path ORDER BY hits DESC LIMIT 20").all(),
      db.prepare("SELECT slug, COUNT(*) as hits FROM analytics WHERE type='watch' AND slug IS NOT NULL GROUP BY slug ORDER BY hits DESC LIMIT 15").all(),
      db.prepare("SELECT DATE(created_at) as day, COUNT(*) as hits FROM analytics GROUP BY day ORDER BY day DESC LIMIT 14").all(),
    ]);
    videos = v.results; countries = co.results; comments = cm.results; topPages = tp.results; topVideos = tv.results; dailyHits = dh.results;
  } else if (tab === 'analytics') {
    const [tp, tv, ag, rf, dh] = await Promise.all([
      db.prepare("SELECT path, COUNT(*) as hits FROM analytics WHERE type='pageview' GROUP BY path ORDER BY hits DESC LIMIT 20").all(),
      db.prepare("SELECT slug, COUNT(*) as hits FROM analytics WHERE type='watch' AND slug IS NOT NULL GROUP BY slug ORDER BY hits DESC LIMIT 15").all(),
      db.prepare("SELECT user_agent, COUNT(*) as hits FROM analytics GROUP BY user_agent ORDER BY hits DESC LIMIT 20").all(),
      db.prepare("SELECT referer, COUNT(*) as hits FROM analytics WHERE referer != '' GROUP BY referer ORDER BY hits DESC LIMIT 20").all(),
      db.prepare("SELECT DATE(created_at) as day, COUNT(*) as hits FROM analytics GROUP BY day ORDER BY day DESC LIMIT 14").all(),
    ]);
    topPages = tp.results; topVideos = tv.results; agents = ag.results; referers = rf.results; dailyHits = dh.results;
  } else if (tab === 'videos') {
    videos = (await db.prepare(`SELECT ${VC} ${VJ} ORDER BY v.created_at DESC`).all()).results;
  } else if (tab === 'comments') {
    comments = (await db.prepare('SELECT c.*, u.name as user_name, u.avatar as user_avatar, v.title as video_title, v.slug as video_slug FROM comments c LEFT JOIN users u ON c.user_id = u.id LEFT JOIN videos v ON c.video_id = v.id ORDER BY c.created_at DESC LIMIT 50').all()).results;
  } else if (tab === 'users') {
    users = (await db.prepare('SELECT id, name, email, avatar, role, created_at FROM users ORDER BY created_at DESC').all()).results;
  } else if (tab === 'searches') {
    searchLogs = (await db.prepare("SELECT query, results, COUNT(*) as times FROM search_logs GROUP BY query ORDER BY times DESC LIMIT 30").all()).results;
  } else if (tab === 'visitors') {
    visitors = (await db.prepare("SELECT f.*, u.name as user_name, u.email as user_email, u.avatar as user_avatar FROM fingerprints f LEFT JOIN users u ON f.user_id = u.id ORDER BY f.last_seen DESC LIMIT 50").all()).results;
  } else if (tab === 'watch') {
    const [we, wc, wn] = await Promise.all([
      db.prepare("SELECT event_type, COUNT(*) as count FROM watch_events GROUP BY event_type ORDER BY count DESC").all(),
      db.prepare("SELECT video_slug, COUNT(DISTINCT fingerprint_id) as viewers, COUNT(*) as events, ROUND(AVG(CASE WHEN duration>0 THEN position*100.0/duration ELSE 0 END),1) as avg_pct FROM watch_events GROUP BY video_slug ORDER BY viewers DESC LIMIT 20").all(),
      db.prepare("SELECT connection, COUNT(*) as count FROM watch_events WHERE connection != '' GROUP BY connection ORDER BY count DESC").all(),
    ]);
    watchEvents = we.results; watchCompletion = wc.results; watchConnections = wn.results;
    videos = (await db.prepare(`SELECT ${VC} ${VJ} ORDER BY v.created_at DESC`).all()).results;
  } else if (tab === 'add') {
    // Only need categories + scholars (already loaded above)
  }

  return c.html(renderAdmin({
    videos,
    categories: cats,
    users,
    comments,
    stats,
    countries,
    topPages,
    topVideos,
    dailyHits,
    searchLogs,
    visitors,
    agents,
    referers,
    watchEvents,
    watchCompletion,
    watchConnections,
    scholars,
    key,
    tab,
    editing: null,
  }));
});

// Bulk add videos from JSON manifest
admin.post('/admin/bulk-add-videos', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  const db = c.env.DB;
  const videos = await c.req.json();
  const results = [];
  for (const v of videos) {
    try {
      await db.prepare("INSERT INTO videos (title, title_ar, slug, description, category_id, source, duration, video_key, srt_key, srt_ar_key, thumb_key) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .bind(v.title, v.title_ar || '', v.slug, v.description || '', v.category_id || 2, v.source || '', v.duration || 0, v.video_key, v.srt_key, v.srt_ar_key || '', v.thumb_key).run();
      results.push('✓ ' + v.slug);
    } catch (e) { results.push('✗ ' + v.slug + ': ' + e.message); }
  }
  const keys = await c.env.CACHE.list();
  for (const key of keys.keys) await c.env.CACHE.delete(key.name);
  results.push('✓ KV cache purged');
  return c.json({ results });
});

// One-time migration endpoint — add new videos
admin.get('/admin/migrate-new-videos', async (c) => {
  if (!isAdmin(c)) return c.text('Unauthorized', 401);
  const db = c.env.DB;
  const results = [];

  // 1. Applications of Fiqh of Easement
  try {
    await db.prepare("INSERT INTO videos (title, title_ar, slug, description, category_id, source, duration, video_key, srt_key, srt_ar_key, thumb_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind("Applications of Fiqh of Easement on Visitors' Fatwas at the Prophet's Mosque", "تطبيقات فقه التيسير على فتاوى الزائرات بالمسجد النبوي", "applications-of-fiqh-of-easement-on-visitors-fatwas", "Sheikh Dr. Ahmad Abdul Rahman Aal al-Sheikh discusses the practical applications of jurisprudential ease in the context of fatwas issued to female visitors at the Prophet's Mosque in Madinah.", 9, "Sheikh Dr. Ahmad Abdul Rahman Aal al-Sheikh", 825, "videos/applications-of-fiqh-of-easement-on-visitors-fatwas.mp4", "subs/applications-of-fiqh-of-easement-on-visitors-fatwas.srt", "subs/applications-of-fiqh-of-easement-on-visitors-fatwas-ar.srt", "thumbs/applications-of-fiqh-of-easement-on-visitors-fatwas.jpg").run();
    results.push('✓ applications-of-fiqh-of-easement-on-visitors-fatwas');
  } catch (e) { results.push('✗ applications: ' + e.message); }

  // 2. Practical Examples of Considering Difference
  try {
    await db.prepare("INSERT INTO videos (title, title_ar, slug, description, category_id, source, duration, video_key, srt_key, srt_ar_key, thumb_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind("Practical Examples of Considering Scholarly Differences in Fatwa", "نماذج تطبيقية لمراعاة الخلاف في الفتوى", "practical-examples-of-considering-difference-in-fatwa", "Sheikh Dr. Salman bin Salih al-Dukhail presents practical examples of how scholarly differences are considered when issuing fatwas.", 9, "Sheikh Dr. Salman bin Salih al-Dukhail", 758, "videos/practical-examples-of-considering-difference-in-fatwa.mp4", "subs/practical-examples-of-considering-difference-in-fatwa.srt", "subs/practical-examples-of-considering-difference-in-fatwa-ar.srt", "thumbs/practical-examples-of-considering-difference-in-fatwa.jpg").run();
    results.push('✓ practical-examples-of-considering-difference-in-fatwa');
  } catch (e) { results.push('✗ practical: ' + e.message); }

  // 3. Foundations of Treating Family - Lesson 2
  try {
    const scholar = await db.prepare("SELECT id FROM scholars WHERE slug = 'sulayman-ar-ruhaily'").first();
    await db.prepare("INSERT INTO videos (title, title_ar, slug, description, category_id, scholar_id, source, duration, video_key, srt_key, srt_ar_key, thumb_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind("Foundations of Treating Family and Companions — Lesson 2", "الدرس الثاني ｜ دورة أصول معاملة الأهل والأصحاب", "foundations-of-treating-family-lesson-2", "Sheikh Sulayman ar-Ruhaily delivers lesson 2 of the course on the foundations of treating family and companions according to Islamic principles.", 2, scholar?.id || null, "Sheikh Sulayman ar-Ruhaily", 2427, "videos/foundations-of-treating-family-lesson-2.mp4", "subs/foundations-of-treating-family-lesson-2.srt", "subs/foundations-of-treating-family-lesson-2-ar.srt", "thumbs/foundations-of-treating-family-lesson-2.jpg").run();
    results.push('✓ foundations-of-treating-family-lesson-2');
  } catch (e) { results.push('✗ foundations: ' + e.message); }

  // 4. Foundations of Treating Family - Lesson 8
  try {
    const scholar = await db.prepare("SELECT id FROM scholars WHERE slug = 'sulayman-ar-ruhaily'").first();
    await db.prepare("INSERT INTO videos (title, title_ar, slug, description, category_id, scholar_id, source, duration, video_key, srt_key, srt_ar_key, thumb_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind("Foundations of Treating Family and Companions — Lesson 8", "الدرس الثامن ｜ دورة أصول معاملة الأهل والأصحاب", "foundations-of-treating-family-lesson-8", "Sheikh Sulayman ar-Ruhaily delivers lesson 8 of the course on the foundations of treating family members and companions according to Islamic principles.", 2, scholar?.id || null, "Sheikh Sulayman ar-Ruhaily", 2240, "videos/foundations-of-treating-family-lesson-8.mp4", "subs/foundations-of-treating-family-lesson-8.srt", "subs/foundations-of-treating-family-lesson-8-ar.srt", "thumbs/foundations-of-treating-family-lesson-8.jpg").run();
    results.push('✓ foundations-of-treating-family-lesson-8');
  } catch (e) { results.push('✗ foundations-8: ' + e.message); }

  // 5. Reflections on Surah Al-Kahf - Lesson 3
  try {
    const scholar = await db.prepare("SELECT id FROM scholars WHERE slug = 'sulayman-ar-ruhaily'").first();
    await db.prepare("INSERT INTO videos (title, title_ar, slug, description, category_id, scholar_id, source, duration, video_key, srt_key, srt_ar_key, thumb_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind("Reflections on Surah Al-Kahf — Lesson 3", "الدرس الثالث ｜ وقفات مع سورة الكهف", "reflections-on-surah-al-kahf-lesson-3", "Sheikh Sulayman ar-Ruhaily shares reflections and contemplations on Surah Al-Kahf in lesson 3 of this series.", 3, scholar?.id || null, "Sheikh Sulayman ar-Ruhaily", 2333, "videos/reflections-on-surah-al-kahf-lesson-3.mp4", "subs/reflections-on-surah-al-kahf-lesson-3.srt", "subs/reflections-on-surah-al-kahf-lesson-3-ar.srt", "thumbs/reflections-on-surah-al-kahf-lesson-3.jpg").run();
    results.push('✓ reflections-on-surah-al-kahf-lesson-3');
  } catch (e) { results.push('✗ kahf: ' + e.message); }

  // Purge KV cache
  const keys = await c.env.CACHE.list();
  for (const key of keys.keys) await c.env.CACHE.delete(key.name);
  results.push('✓ KV cache purged');

  return c.json({ results });
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
    'INSERT INTO videos (title, title_ar, slug, description, category_id, scholar_id, source, duration, video_key, srt_key, srt_ar_key, thumb_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(body.title, body.title_ar || null, body.slug, body.description || null, parseInt(body.category_id) || null, parseInt(body.scholar_id) || null, body.source || null, parseInt(body.duration) || 0, body.video_key, body.srt_key || null, body.srt_ar_key || null, body.thumb_key || null).run();
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

// Analytics Engine SQL query
admin.post('/admin/analytics-query', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  const { query } = await c.req.json();
  if (!query) return c.json({ error: 'No query' }, 400);
  try {
    const { queryAE } = await import('../lib/analytics.js');
    const result = await queryAE(c.env, query);
    return c.json(result);
  } catch (err) {
    return c.json({ error: err.message }, 400);
  }
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

// Watch events analytics endpoint
admin.get('/admin/watch-analytics', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  const db = c.env.DB;
  const [events, completion, topWatched, bufferIssues, devices] = await Promise.all([
    db.prepare("SELECT event_type, COUNT(*) as count FROM watch_events GROUP BY event_type ORDER BY count DESC").all(),
    db.prepare("SELECT video_slug, AVG(CASE WHEN duration > 0 THEN position * 100.0 / duration ELSE 0 END) as avg_pct, COUNT(*) as sessions FROM watch_events WHERE event_type IN ('pause','end') AND duration > 0 GROUP BY video_slug ORDER BY sessions DESC LIMIT 20").all(),
    db.prepare("SELECT video_slug, COUNT(DISTINCT fingerprint_id) as unique_viewers, COUNT(*) as events FROM watch_events GROUP BY video_slug ORDER BY unique_viewers DESC LIMIT 20").all(),
    db.prepare("SELECT video_slug, AVG(buffered) as avg_buffer, COUNT(*) as events FROM watch_events WHERE buffered > 0 GROUP BY video_slug ORDER BY avg_buffer ASC LIMIT 10").all(),
    db.prepare("SELECT connection, COUNT(*) as count FROM watch_events WHERE connection != '' GROUP BY connection ORDER BY count DESC").all(),
  ]);
  return c.json({ events: events.results, completion: completion.results, topWatched: topWatched.results, bufferIssues: bufferIssues.results, devices: devices.results });
});

// Visitor journey endpoint (from fingerprint)
admin.get('/admin/visitor-journey/:id', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  const fpId = c.req.param('id');
  const db = c.env.DB;
  const [fp, watchEvents, user] = await Promise.all([
    db.prepare('SELECT * FROM fingerprints WHERE id = ?').bind(fpId).first(),
    db.prepare("SELECT video_slug, event_type, position, duration, created_at FROM watch_events WHERE fingerprint_id = ? ORDER BY created_at DESC LIMIT 50").bind(fpId).all(),
    db.prepare('SELECT u.* FROM users u JOIN fingerprints f ON u.id = f.user_id WHERE f.id = ?').bind(fpId).first(),
  ]);
  // Resolve video titles
  const slugs = [...new Set((watchEvents.results || []).map(w => w.video_slug).filter(Boolean))];
  let videoMap = {};
  if (slugs.length) {
    const vids = (await db.prepare(`SELECT slug, title FROM videos WHERE slug IN (${slugs.map(() => '?').join(',')})`).bind(...slugs).all()).results;
    vids.forEach(v => videoMap[v.slug] = v.title);
  }
  return c.json({ fingerprint: fp, watchEvents: watchEvents.results, user, videoMap });
});

// KV cache purge
admin.post('/admin/purge-cache', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  const keys = await c.env.CACHE.list();
  let deleted = 0;
  for (const key of keys.keys) {
    await c.env.CACHE.delete(key.name);
    deleted++;
  }
  const user = c.get('user');
  c.executionCtx.waitUntil(c.env.DB.prepare('INSERT INTO admin_logs (admin_id, action, target, details) VALUES (?, ?, ?, ?)').bind(user?.id, 'purge_cache', 'kv', `Purged ${deleted} keys`).run());
  return c.json({ deleted });
});

// Migrate thumbnails + scholar photos from R2 → KV
admin.get('/admin/migrate-to-kv', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  let migrated = 0, skipped = 0, errors = 0;

  for (const prefix of ['thumbs/', 'scholars/']) {
    let cursor;
    do {
      const list = await c.env.MEDIA_BUCKET.list({ prefix, cursor, limit: 500 });
      const webpFiles = list.objects.filter(o => o.key.endsWith('.avif') || o.key.endsWith('.webp'));

      // Process in batches of 10
      for (let i = 0; i < webpFiles.length; i += 10) {
        const batch = webpFiles.slice(i, i + 10);
        await Promise.all(batch.map(async (obj) => {
          try {
            // Check if already in KV
            const existing = await c.env.MEDIA_KV.getWithMetadata(obj.key, 'arrayBuffer');
            if (existing.value) { skipped++; return; }

            const r2obj = await c.env.MEDIA_BUCKET.get(obj.key);
            if (!r2obj) { errors++; return; }
            const body = await r2obj.arrayBuffer();
            await c.env.MEDIA_KV.put(obj.key, body, { metadata: { ct: obj.key.endsWith('.avif') ? 'image/avif' : 'image/webp' } });
            migrated++;
          } catch { errors++; }
        }));
      }
      cursor = list.truncated ? list.cursor : null;
    } while (cursor);
  }

  return c.json({ migrated, skipped, errors });
});

// Scholar management
admin.post('/admin/scholar', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  const body = await c.req.parseBody();
  await c.env.DB.prepare(
    'INSERT INTO scholars (name, slug, title, bio, photo, photo_hero) VALUES (?,?,?,?,?,?)'
  ).bind(body.name, body.slug, body.title || null, body.bio || null, body.photo || null, body.photo_hero || null).run();
  return c.redirect('/admin?tab=videos' + (c.req.query('key') ? '&key=' + c.req.query('key') : ''));
});

// R2 file listing for admin
admin.get('/admin/r2-list', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  const prefix = c.req.query('prefix') || '';
  const listed = await c.env.MEDIA_BUCKET.list({ prefix, limit: 100 });
  return c.json({ objects: listed.objects.map(o => ({ key: o.key, size: o.size, uploaded: o.uploaded })), truncated: listed.truncated });
});

// AI Chat endpoint for admin
// AI tool definitions
const AI_TOOLS = [
  { type: 'function', function: { name: 'query_database', description: 'Run a read-only SQL SELECT query on the DeenSubs database. Tables: videos (id,title,title_ar,slug,description,category_id,source,duration,video_key,srt_key,srt_ar_key,thumb_key,views,likes,scholar_id,created_at), users (id,name,email,avatar,role,created_at), comments (id,video_id,author,content,user_id,created_at), categories (id,name,name_ar,slug,color), scholars (id,name,slug,title,bio,photo,photo_hero), analytics (id,path,slug,type,ip,country,user_agent,referer,user_id,created_at), search_logs (id,query,results,user_id,created_at), fingerprints (id,user_id,ip,country,city,user_agent,device_type,os,browser,screen_w,screen_h,gpu,timezone,language,cores,memory,touch,visit_count,first_seen,last_seen), watch_events (id,video_slug,fingerprint_id,user_id,event_type,position,duration,buffered,connection,bandwidth,created_at), admin_logs (id,admin_id,action,target,details,created_at). Example: SELECT title, views FROM videos ORDER BY views DESC LIMIT 5', parameters: { type: 'object', properties: { query: { type: 'string', description: 'SQL SELECT query to execute' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'get_video_stats', description: 'Get comprehensive stats for a specific video including views, likes, comment count, watch event count, average watch completion, unique viewers, and buffering metrics', parameters: { type: 'object', properties: { slug: { type: 'string', description: 'Video slug' } }, required: ['slug'] } } },
  { type: 'function', function: { name: 'get_platform_stats', description: 'Get current platform overview: total videos, users, comments, views, likes, countries, scholars, categories, recent activity counts', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'get_engagement_report', description: 'Get engagement metrics: like-to-view ratio per video, most commented videos, average views per category, videos with no subtitles, videos with zero views', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'get_watch_analytics', description: 'Get watch event analytics: event type distribution, average completion rates, top videos by unique viewers, connection type distribution, buffering issues', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'get_top_searches', description: 'Get the most popular search queries with result counts and frequency', parameters: { type: 'object', properties: { limit: { type: 'number', description: 'Number of results (default 10)' } } } } },
  { type: 'function', function: { name: 'get_zero_result_searches', description: 'Get searches that returned 0 results — reveals content gaps and what users want but cannot find', parameters: { type: 'object', properties: { limit: { type: 'number', description: 'Number of results (default 20)' } } } } },
  { type: 'function', function: { name: 'get_visitor_countries', description: 'Get visitor distribution by country with hit counts', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'get_visitor_devices', description: 'Get device breakdown: device types, operating systems, browsers, screen sizes, GPU models — from fingerprint data', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'get_scholar_stats', description: 'Get stats per scholar: video count, total views, total likes, most popular video', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'get_category_stats', description: 'Get stats per category: video count, total views, average views per video', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'get_user_activity', description: 'Get activity for a specific user: comments, searches, watch history (if linked to fingerprint)', parameters: { type: 'object', properties: { user_id: { type: 'number', description: 'User ID' } }, required: ['user_id'] } } },
  { type: 'function', function: { name: 'get_content_gaps', description: 'Analyze content gaps: categories with few videos, scholars with no videos, popular searches with no results, videos missing subtitles or thumbnails', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'get_traffic_trends', description: 'Get traffic trends over the last 14-30 days: daily pageviews, daily unique visitors, peak hours, growth rate', parameters: { type: 'object', properties: { days: { type: 'number', description: 'Number of days (default 14)' } } } },},
  { type: 'function', function: { name: 'moderate_comment', description: 'Delete a comment by its ID', parameters: { type: 'object', properties: { comment_id: { type: 'number', description: 'Comment ID to delete' } }, required: ['comment_id'] } } },
  { type: 'function', function: { name: 'update_video', description: 'Update a specific field on a video (title, description, source, category_id, srt_key, thumb_key)', parameters: { type: 'object', properties: { slug: { type: 'string', description: 'Video slug' }, field: { type: 'string', enum: ['title', 'description', 'source', 'category_id', 'srt_key', 'thumb_key'], description: 'Field to update' }, value: { type: 'string', description: 'New value' } }, required: ['slug', 'field', 'value'] } } },
  { type: 'function', function: { name: 'purge_cache', description: 'Purge all KV cache entries to force fresh data on the site', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'list_r2_files', description: 'List files in the R2 media bucket with an optional prefix filter (e.g. "videos/", "subs/", "thumbs/", "scholars/")', parameters: { type: 'object', properties: { prefix: { type: 'string', description: 'R2 key prefix to filter by (e.g. "videos/")' } } } } },
  { type: 'function', function: { name: 'get_realtime_analytics', description: 'Get real-time analytics from the last hour — pageview count, unique visitors, top countries, device breakdown, top pages, average response time. Uses Analytics Engine (not D1).', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'get_performance_metrics', description: 'Get performance metrics — average response times by route, error rates by day, status code distribution, slowest pages. Uses Analytics Engine.', parameters: { type: 'object', properties: {} } } },
];

// AI tool execution
async function executeTool(env, name, args) {
  const db = env.DB;
  switch (name) {
    case 'query_database': {
      if (!args.query?.trim().toLowerCase().startsWith('select')) return { error: 'Only SELECT queries allowed' };
      try {
        const r = await db.prepare(args.query).all();
        return { results: r.results?.slice(0, 30), total_rows: r.results?.length, duration_ms: r.meta?.duration };
      } catch (err) { return { error: err.message }; }
    }
    case 'get_video_stats': {
      const v = await db.prepare('SELECT v.*, c.name as category, s.name as scholar_name FROM videos v LEFT JOIN categories c ON v.category_id=c.id LEFT JOIN scholars s ON v.scholar_id=s.id WHERE v.slug=?').bind(args.slug).first();
      if (!v) return { error: 'Video not found' };
      const [comments, watches, uniqueViewers, avgCompletion] = await Promise.all([
        db.prepare('SELECT COUNT(*) as c FROM comments WHERE video_id=?').bind(v.id).first(),
        db.prepare("SELECT COUNT(*) as c FROM watch_events WHERE video_slug=?").bind(args.slug).first(),
        db.prepare("SELECT COUNT(DISTINCT fingerprint_id) as c FROM watch_events WHERE video_slug=?").bind(args.slug).first(),
        db.prepare("SELECT AVG(CASE WHEN duration>0 THEN position*100.0/duration ELSE 0 END) as pct FROM watch_events WHERE video_slug=? AND event_type IN ('pause','end')").bind(args.slug).first(),
      ]);
      return { title: v.title, views: v.views, likes: v.likes, like_rate: v.views > 0 ? (v.likes * 100 / v.views).toFixed(1) + '%' : '0%', comments: comments?.c, watch_events: watches?.c, unique_viewers: uniqueViewers?.c, avg_completion: (avgCompletion?.pct || 0).toFixed(1) + '%', category: v.category, scholar: v.scholar_name, source: v.source, duration_seconds: v.duration, has_en_subs: !!v.srt_key, has_ar_subs: !!v.srt_ar_key, has_thumbnail: !!v.thumb_key, created: v.created_at };
    }
    case 'get_platform_stats': {
      const s = await db.prepare('SELECT (SELECT COUNT(*) FROM videos) as videos, (SELECT COUNT(*) FROM users) as users, (SELECT COUNT(*) FROM comments) as comments, (SELECT SUM(views) FROM videos) as views, (SELECT SUM(likes) FROM videos) as likes, (SELECT COUNT(DISTINCT country) FROM fingerprints) as countries, (SELECT COUNT(*) FROM scholars) as scholars, (SELECT COUNT(*) FROM categories) as categories, (SELECT COUNT(*) FROM watch_events) as watch_events, (SELECT COUNT(*) FROM fingerprints) as fingerprints, (SELECT COUNT(*) FROM search_logs) as searches').first();
      return s;
    }
    case 'get_engagement_report': {
      const [likeRates, topCommented, catAvg, noSubs, zeroViews] = await Promise.all([
        db.prepare("SELECT title, slug, views, likes, CASE WHEN views>0 THEN ROUND(likes*100.0/views,1) ELSE 0 END as like_rate FROM videos WHERE views>0 ORDER BY like_rate DESC LIMIT 10").all(),
        db.prepare("SELECT v.title, v.slug, COUNT(c.id) as comment_count FROM videos v JOIN comments c ON v.id=c.video_id GROUP BY v.id ORDER BY comment_count DESC LIMIT 10").all(),
        db.prepare("SELECT cat.name, COUNT(v.id) as videos, SUM(v.views) as total_views, ROUND(AVG(v.views),0) as avg_views FROM categories cat LEFT JOIN videos v ON cat.id=v.category_id GROUP BY cat.id ORDER BY avg_views DESC").all(),
        db.prepare("SELECT title, slug FROM videos WHERE srt_key IS NULL OR srt_key=''").all(),
        db.prepare("SELECT title, slug, created_at FROM videos WHERE views=0").all(),
      ]);
      return { highest_like_rates: likeRates.results, most_commented: topCommented.results, views_per_category: catAvg.results, missing_subtitles: noSubs.results, zero_view_videos: zeroViews.results };
    }
    case 'get_watch_analytics': {
      const { queryAE, Q } = await import('../lib/analytics.js');
      const [events, completion, byDevice] = await Promise.all([
        queryAE(env, Q.watchEventTypes(7)),
        queryAE(env, Q.watchCompletion(7)),
        queryAE(env, Q.watchByDevice(7)),
      ]);
      return { event_distribution: events.data, completion_rates: completion.data, watch_by_device: byDevice.data, source: 'Analytics Engine' };
    }
    case 'get_top_searches': {
      const r = await db.prepare('SELECT query, COUNT(*) as times, MAX(results) as max_results FROM search_logs GROUP BY query ORDER BY times DESC LIMIT ?').bind(args.limit || 10).all();
      return r.results;
    }
    case 'get_zero_result_searches': {
      const r = await db.prepare('SELECT query, COUNT(*) as times FROM search_logs WHERE results=0 GROUP BY query ORDER BY times DESC LIMIT ?').bind(args.limit || 20).all();
      return { zero_result_queries: r.results, note: 'These are topics users want but cannot find — potential content to add' };
    }
    case 'get_visitor_countries': {
      const { queryAE, Q } = await import('../lib/analytics.js');
      const r = await queryAE(env, Q.topCountries(7));
      return { countries: r.data, source: 'Analytics Engine' };
    }
    case 'get_visitor_devices': {
      const { queryAE, Q } = await import('../lib/analytics.js');
      const [types, browsers, oses] = await Promise.all([
        queryAE(env, Q.deviceBreakdown(7)),
        queryAE(env, Q.browserBreakdown(7)),
        queryAE(env, Q.osBreakdown(7)),
      ]);
      // Also get screen/GPU from fingerprints (AE doesn't have these)
      const [screens, gpus] = await Promise.all([
        db.prepare("SELECT screen_w||'x'||screen_h as resolution, COUNT(*) as count FROM fingerprints WHERE screen_w>0 GROUP BY resolution ORDER BY count DESC LIMIT 10").all(),
        db.prepare("SELECT gpu, COUNT(*) as count FROM fingerprints WHERE gpu!='' GROUP BY gpu ORDER BY count DESC LIMIT 10").all(),
      ]);
      return { device_types: types.data, browsers: browsers.data, operating_systems: oses.data, screen_resolutions: screens.results, gpus: gpus.results, source: 'Analytics Engine + D1 fingerprints' };
    }
    case 'get_scholar_stats': {
      const r = await db.prepare("SELECT s.name, s.slug, COUNT(v.id) as videos, SUM(v.views) as total_views, SUM(v.likes) as total_likes FROM scholars s LEFT JOIN videos v ON s.id=v.scholar_id GROUP BY s.id ORDER BY total_views DESC").all();
      return r.results;
    }
    case 'get_category_stats': {
      const r = await db.prepare("SELECT c.name, c.slug, COUNT(v.id) as videos, SUM(v.views) as total_views, ROUND(AVG(v.views),0) as avg_views FROM categories c LEFT JOIN videos v ON c.id=v.category_id GROUP BY c.id ORDER BY total_views DESC").all();
      return r.results;
    }
    case 'get_user_activity': {
      const u = await db.prepare('SELECT id,name,email,role,created_at FROM users WHERE id=?').bind(args.user_id).first();
      if (!u) return { error: 'User not found' };
      const [comments, searches, fps] = await Promise.all([
        db.prepare('SELECT c.content, v.title as video_title, c.created_at FROM comments c LEFT JOIN videos v ON c.video_id=v.id WHERE c.user_id=? ORDER BY c.created_at DESC LIMIT 20').bind(args.user_id).all(),
        db.prepare('SELECT query, results, created_at FROM search_logs WHERE user_id=? ORDER BY created_at DESC LIMIT 20').bind(args.user_id).all(),
        db.prepare('SELECT id, device_type, os, browser, country, city, visit_count, last_seen FROM fingerprints WHERE user_id=?').bind(args.user_id).all(),
      ]);
      return { user: u, comments: comments.results, searches: searches.results, devices: fps.results };
    }
    case 'get_content_gaps': {
      const [emptyCats, noSubVids, noThumbVids, zeroSearches, scholarsNoVids] = await Promise.all([
        db.prepare("SELECT c.name, c.slug, COUNT(v.id) as videos FROM categories c LEFT JOIN videos v ON c.id=v.category_id GROUP BY c.id HAVING videos < 3 ORDER BY videos ASC").all(),
        db.prepare("SELECT title, slug FROM videos WHERE srt_key IS NULL OR srt_key=''").all(),
        db.prepare("SELECT title, slug FROM videos WHERE thumb_key IS NULL OR thumb_key=''").all(),
        db.prepare("SELECT query, COUNT(*) as times FROM search_logs WHERE results=0 GROUP BY query ORDER BY times DESC LIMIT 15").all(),
        db.prepare("SELECT s.name FROM scholars s LEFT JOIN videos v ON s.id=v.scholar_id GROUP BY s.id HAVING COUNT(v.id)=0").all(),
      ]);
      return { sparse_categories: emptyCats.results, videos_without_subtitles: noSubVids.results, videos_without_thumbnails: noThumbVids.results, searches_with_no_results: zeroSearches.results, scholars_without_videos: scholarsNoVids.results };
    }
    case 'get_traffic_trends': {
      const days = args.days || 14;
      const { queryAE, Q } = await import('../lib/analytics.js');
      const [daily, hourly] = await Promise.all([
        queryAE(env, Q.dailyTraffic(days)),
        queryAE(env, Q.hourlyTraffic()),
      ]);
      const d = daily.data || [];
      const growth = d.length >= 2 ? ((d[0].hits - d[1].hits) / Math.max(d[1].hits, 1) * 100).toFixed(1) + '%' : 'N/A';
      return { daily_traffic: d, peak_hours: hourly.data, day_over_day_growth: growth, source: 'Analytics Engine' };
    }
    case 'moderate_comment': {
      await db.prepare('DELETE FROM comments WHERE id=?').bind(args.comment_id).run();
      return { deleted: true, comment_id: args.comment_id };
    }
    case 'update_video': {
      const allowed = ['title', 'description', 'source', 'category_id', 'srt_key', 'thumb_key'];
      if (!allowed.includes(args.field)) return { error: 'Field not allowed: ' + args.field };
      await db.prepare(`UPDATE videos SET ${args.field}=? WHERE slug=?`).bind(args.value, args.slug).run();
      return { updated: true, slug: args.slug, field: args.field, new_value: args.value };
    }
    case 'purge_cache': {
      const keys = await env.CACHE.list();
      let deleted = 0;
      for (const key of keys.keys) { await env.CACHE.delete(key.name); deleted++; }
      return { deleted, note: 'All KV cache entries purged. Site will re-populate cache on next requests.' };
    }
    case 'list_r2_files': {
      const listed = await env.MEDIA_BUCKET.list({ prefix: args.prefix || '', limit: 50 });
      return { files: listed.objects.map(o => ({ key: o.key, size_kb: Math.round(o.size / 1024), uploaded: o.uploaded })), count: listed.objects.length, truncated: listed.truncated };
    }
    case 'get_realtime_analytics': {
      const { queryAE, Q } = await import('../lib/analytics.js');
      const [traffic, countries, devices, pages, live] = await Promise.all([
        queryAE(env, Q.realtimeTraffic()),
        queryAE(env, Q.topCountries(1)),
        queryAE(env, Q.deviceBreakdown(1)),
        queryAE(env, Q.topPages(1)),
        queryAE(env, Q.liveVisitors()),
      ]);
      return { traffic: traffic.data, countries: countries.data, devices: devices.data, top_pages: pages.data, live_visitors: live.data, source: 'Analytics Engine (real-time)' };
    }
    case 'get_performance_metrics': {
      const { queryAE, Q } = await import('../lib/analytics.js');
      const [responseTime, errors, slowest, errorRate] = await Promise.all([
        queryAE(env, Q.avgResponseTime()),
        queryAE(env, Q.recentErrors()),
        queryAE(env, Q.slowestPages()),
        queryAE(env, Q.errorRate(7)),
      ]);
      return { avg_response_times: responseTime.data, recent_errors: errors.data, slowest_pages: slowest.data, error_rate_by_day: errorRate.data, source: 'Analytics Engine' };
    }
    default: return { error: 'Unknown tool: ' + name };
  }
}

admin.post('/admin/ai', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  const { prompt, context, history } = await c.req.json();

  const messages = [
    { role: 'system', content: `You are the DeenSubs admin AI assistant with 18 tools for managing an Islamic content platform (Arabic lectures → English subtitles).

Available tools:
DATA: query_database, get_video_stats, get_platform_stats, get_engagement_report, get_watch_analytics, get_traffic_trends
SEARCH: get_top_searches, get_zero_result_searches, get_content_gaps
VISITORS: get_visitor_countries, get_visitor_devices, get_user_activity
CONTENT: get_scholar_stats, get_category_stats
REALTIME: get_realtime_analytics, get_performance_metrics
ACTIONS: moderate_comment, update_video, purge_cache, list_r2_files

ALWAYS use tools to get real data. Never guess stats. When asked about content strategy, use get_content_gaps and get_zero_result_searches. When asked about performance, use get_watch_analytics. For video details, use get_video_stats with the slug.

Platform context: ${context || 'DeenSubs - Arabic Islamic content with English subtitles on Cloudflare Workers'}

Be concise and actionable. Format data as tables when showing multiple rows. Suggest improvements proactively.` },
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
        const result = await executeTool(c.env, tc.function.name, args);
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
