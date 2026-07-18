// AI agent tool registry + execution. Grounded in D1/R2/AE and able to
// drive the Scribe pipeline (start transcriptions, publish results).

// @ts-ignore — plain JS module from the parent project
import { queryAE, Q } from '../../../../src/lib/analytics.js';

export type AgentEnv = {
  DB: D1Database;
  CACHE: KVNamespace;
  MEDIA_BUCKET: R2Bucket;
  SCRIBE_WORKFLOW: Workflow;
  AI?: Ai;
  VECTORIZE?: VectorizeIndex;
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
};

const fn = (name: string, description: string, properties: Record<string, any> = {}, required: string[] = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});

export const AI_TOOLS: any[] = [
  fn('query_database', 'Run a read-only SQL SELECT on the DeenSubs D1 database. Tables: videos (id,title,title_ar,slug,description,category_id,source,duration,video_key,srt_key,srt_ar_key,thumb_key,views,likes,scholar_id,created_at), users (id,name,email,avatar,role,created_at), comments (id,video_id,author,content,user_id,created_at), categories (id,name,name_ar,slug,color), scholars (id,name,slug,title,bio,photo,photo_hero), analytics (id,path,slug,type,ip,country,user_agent,referer,user_id,created_at), search_logs (id,query,results,user_id,created_at), fingerprints (id,user_id,ip,country,city,user_agent,device_type,os,browser,screen_w,screen_h,gpu,timezone,language,cores,memory,touch,visit_count,first_seen,last_seen), watch_events (id,video_slug,fingerprint_id,user_id,event_type,position,duration,buffered,connection,bandwidth,created_at), admin_logs (id,admin_id,action,target,details,created_at), scribe_jobs (id,url,target_lang,status,step,title,title_ar,description,duration,language_code,srt_key,cue_count,error,created_at)', { query: { type: 'string', description: 'SQL SELECT query' } }, ['query']),
  fn('get_platform_stats', 'Platform overview: totals for videos, users, comments, views, likes, countries, scholars, categories, watch events, searches'),
  fn('get_video_stats', 'Deep stats for one video: views, likes, comments, watch completion, unique viewers, subtitle/thumbnail presence', { slug: { type: 'string' } }, ['slug']),
  fn('get_engagement_report', 'Like-to-view ratios, most commented videos, views per category, videos missing subtitles, zero-view videos'),
  fn('get_content_gaps', 'Sparse categories, videos missing subtitles/thumbnails, zero-result searches, scholars without videos'),
  fn('get_top_searches', 'Most popular search queries', { limit: { type: 'number' } }),
  fn('get_zero_result_searches', 'Searches returning 0 results — content users want but cannot find', { limit: { type: 'number' } }),
  fn('get_scholar_stats', 'Per-scholar video counts, views, likes'),
  fn('get_category_stats', 'Per-category video counts and views'),
  fn('get_user_activity', 'One user\'s comments, searches, devices', { user_id: { type: 'number' } }, ['user_id']),
  fn('get_visitor_countries', 'Visitor distribution by country (Analytics Engine, last 7 days)'),
  fn('get_visitor_devices', 'Device/browser/OS breakdown (AE) + screens/GPUs (fingerprints)'),
  fn('get_traffic_trends', 'Daily traffic, peak hours, growth (Analytics Engine)', { days: { type: 'number' } }),
  fn('get_realtime_analytics', 'Last-hour traffic, live visitors, top countries/pages (Analytics Engine)'),
  fn('get_performance_metrics', 'Response times, error rates, slowest pages (Analytics Engine)'),
  fn('get_watch_analytics', 'Watch event distribution, completion rates, watch-by-device (Analytics Engine)'),
  fn('moderate_comment', 'Delete a comment by ID', { comment_id: { type: 'number' } }, ['comment_id']),
  fn('update_video', 'Update one field on a video', { slug: { type: 'string' }, field: { type: 'string', enum: ['title', 'description', 'source', 'category_id', 'srt_key', 'thumb_key'] }, value: { type: 'string' } }, ['slug', 'field', 'value']),
  fn('purge_cache', 'Purge every KV cache entry so the site serves fresh data'),
  fn('list_r2_files', 'List R2 media files by prefix (videos/, subs/, thumbs/, scholars/, scribe/)', { prefix: { type: 'string' } }),
  fn('get_admin_logs', 'Recent admin activity log entries', { limit: { type: 'number' } }),
  // ---- Scribe pipeline control ----
  fn('list_scribe_jobs', 'List recent Scribe transcription jobs with status/step/results', { limit: { type: 'number' } }),
  fn('get_scribe_job', 'Full detail of one Scribe job', { id: { type: 'string' } }, ['id']),
  fn('start_transcription', 'Start the Scribe pipeline on a video/audio URL (YouTube supported): download → ElevenLabs ASR → translate → SRT → metadata. Returns the job id; the job runs for minutes, check later with get_scribe_job.', { url: { type: 'string' }, target_lang: { type: 'string', description: 'Target language code, default en' } }, ['url']),
  fn('semantic_search', 'Semantic (meaning-based) search over all published video transcripts. Finds where topics are discussed even without keyword matches. Returns video slug + timestamp + text.', { q: { type: 'string' }, limit: { type: 'number' } }, ['q']),
  fn('publish_scribe_job', 'Publish a FINISHED Scribe job as a video on the site: inserts a videos row using the job\'s AI metadata, media key, and subtitles. Only works when the job downloaded an actual video file (mp4/webm), not audio-only. Optionally set category_id / scholar_id.', { job_id: { type: 'string' }, category_id: { type: 'number' }, scholar_id: { type: 'number' } }, ['job_id']),
];

export async function executeTool(env: AgentEnv, name: string, args: any): Promise<any> {
  const db = env.DB;
  switch (name) {
    case 'query_database': {
      if (!args.query?.trim().toLowerCase().startsWith('select')) return { error: 'Only SELECT queries allowed' };
      try {
        const r = await db.prepare(args.query).all();
        return { results: r.results?.slice(0, 30), total_rows: r.results?.length, duration_ms: r.meta?.duration };
      } catch (err: any) { return { error: err.message }; }
    }
    case 'get_platform_stats':
      return await db.prepare('SELECT (SELECT COUNT(*) FROM videos) as videos, (SELECT COUNT(*) FROM users) as users, (SELECT COUNT(*) FROM comments) as comments, (SELECT SUM(views) FROM videos) as views, (SELECT SUM(likes) FROM videos) as likes, (SELECT COUNT(DISTINCT country) FROM fingerprints) as countries, (SELECT COUNT(*) FROM scholars) as scholars, (SELECT COUNT(*) FROM categories) as categories, (SELECT COUNT(*) FROM watch_events) as watch_events, (SELECT COUNT(*) FROM fingerprints) as fingerprints, (SELECT COUNT(*) FROM search_logs) as searches, (SELECT COUNT(*) FROM scribe_jobs) as scribe_jobs').first();
    case 'get_video_stats': {
      const v: any = await db.prepare('SELECT v.*, c.name as category, s.name as scholar_name FROM videos v LEFT JOIN categories c ON v.category_id=c.id LEFT JOIN scholars s ON v.scholar_id=s.id WHERE v.slug=?').bind(args.slug).first();
      if (!v) return { error: 'Video not found' };
      const [comments, watches, uniqueViewers, avgCompletion] = await Promise.all([
        db.prepare('SELECT COUNT(*) as c FROM comments WHERE video_id=?').bind(v.id).first(),
        db.prepare('SELECT COUNT(*) as c FROM watch_events WHERE video_slug=?').bind(args.slug).first(),
        db.prepare('SELECT COUNT(DISTINCT fingerprint_id) as c FROM watch_events WHERE video_slug=?').bind(args.slug).first(),
        db.prepare("SELECT AVG(CASE WHEN duration>0 THEN position*100.0/duration ELSE 0 END) as pct FROM watch_events WHERE video_slug=? AND event_type IN ('pause','end')").bind(args.slug).first(),
      ]) as any[];
      return { title: v.title, views: v.views, likes: v.likes, comments: comments?.c, watch_events: watches?.c, unique_viewers: uniqueViewers?.c, avg_completion: (avgCompletion?.pct || 0).toFixed(1) + '%', category: v.category, scholar: v.scholar_name, duration_seconds: v.duration, has_en_subs: !!v.srt_key, has_ar_subs: !!v.srt_ar_key, has_thumbnail: !!v.thumb_key, created: v.created_at };
    }
    case 'get_engagement_report': {
      const [likeRates, topCommented, catAvg, noSubs, zeroViews] = await Promise.all([
        db.prepare('SELECT title, slug, views, likes, CASE WHEN views>0 THEN ROUND(likes*100.0/views,1) ELSE 0 END as like_rate FROM videos WHERE views>0 ORDER BY like_rate DESC LIMIT 10').all(),
        db.prepare('SELECT v.title, v.slug, COUNT(c.id) as comment_count FROM videos v JOIN comments c ON v.id=c.video_id GROUP BY v.id ORDER BY comment_count DESC LIMIT 10').all(),
        db.prepare('SELECT cat.name, COUNT(v.id) as videos, SUM(v.views) as total_views, ROUND(AVG(v.views),0) as avg_views FROM categories cat LEFT JOIN videos v ON cat.id=v.category_id GROUP BY cat.id ORDER BY avg_views DESC').all(),
        db.prepare("SELECT title, slug FROM videos WHERE srt_key IS NULL OR srt_key=''").all(),
        db.prepare('SELECT title, slug, created_at FROM videos WHERE views=0').all(),
      ]);
      return { highest_like_rates: likeRates.results, most_commented: topCommented.results, views_per_category: catAvg.results, missing_subtitles: noSubs.results, zero_view_videos: zeroViews.results };
    }
    case 'get_content_gaps': {
      const [emptyCats, noSubVids, noThumbVids, zeroSearches, scholarsNoVids] = await Promise.all([
        db.prepare('SELECT c.name, c.slug, COUNT(v.id) as videos FROM categories c LEFT JOIN videos v ON c.id=v.category_id GROUP BY c.id HAVING videos < 3 ORDER BY videos ASC').all(),
        db.prepare("SELECT title, slug FROM videos WHERE srt_key IS NULL OR srt_key=''").all(),
        db.prepare("SELECT title, slug FROM videos WHERE thumb_key IS NULL OR thumb_key=''").all(),
        db.prepare('SELECT query, COUNT(*) as times FROM search_logs WHERE results=0 GROUP BY query ORDER BY times DESC LIMIT 15').all(),
        db.prepare('SELECT s.name FROM scholars s LEFT JOIN videos v ON s.id=v.scholar_id GROUP BY s.id HAVING COUNT(v.id)=0').all(),
      ]);
      return { sparse_categories: emptyCats.results, videos_without_subtitles: noSubVids.results, videos_without_thumbnails: noThumbVids.results, searches_with_no_results: zeroSearches.results, scholars_without_videos: scholarsNoVids.results };
    }
    case 'get_top_searches':
      return (await db.prepare('SELECT query, COUNT(*) as times, MAX(results) as max_results FROM search_logs GROUP BY query ORDER BY times DESC LIMIT ?').bind(args.limit || 10).all()).results;
    case 'get_zero_result_searches': {
      const r = await db.prepare('SELECT query, COUNT(*) as times FROM search_logs WHERE results=0 GROUP BY query ORDER BY times DESC LIMIT ?').bind(args.limit || 20).all();
      return { zero_result_queries: r.results, note: 'Topics users want but cannot find — potential content to add' };
    }
    case 'get_scholar_stats':
      return (await db.prepare('SELECT s.name, s.slug, COUNT(v.id) as videos, SUM(v.views) as total_views, SUM(v.likes) as total_likes FROM scholars s LEFT JOIN videos v ON s.id=v.scholar_id GROUP BY s.id ORDER BY total_views DESC').all()).results;
    case 'get_category_stats':
      return (await db.prepare('SELECT c.name, c.slug, COUNT(v.id) as videos, SUM(v.views) as total_views, ROUND(AVG(v.views),0) as avg_views FROM categories c LEFT JOIN videos v ON c.id=v.category_id GROUP BY c.id ORDER BY total_views DESC').all()).results;
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
    case 'get_visitor_countries':
      return { countries: (await queryAE(env, Q.topCountries(7))).data, source: 'Analytics Engine' };
    case 'get_visitor_devices': {
      const [types, browsers, oses] = await Promise.all([
        queryAE(env, Q.deviceBreakdown(7)), queryAE(env, Q.browserBreakdown(7)), queryAE(env, Q.osBreakdown(7)),
      ]);
      const [screens, gpus] = await Promise.all([
        db.prepare("SELECT screen_w||'x'||screen_h as resolution, COUNT(*) as count FROM fingerprints WHERE screen_w>0 GROUP BY resolution ORDER BY count DESC LIMIT 10").all(),
        db.prepare("SELECT gpu, COUNT(*) as count FROM fingerprints WHERE gpu!='' GROUP BY gpu ORDER BY count DESC LIMIT 10").all(),
      ]);
      return { device_types: types.data, browsers: browsers.data, operating_systems: oses.data, screen_resolutions: screens.results, gpus: gpus.results };
    }
    case 'get_traffic_trends': {
      const [daily, hourly] = await Promise.all([queryAE(env, Q.dailyTraffic(args.days || 14)), queryAE(env, Q.hourlyTraffic())]);
      const d = daily.data || [];
      const growth = d.length >= 2 ? ((d[0].hits - d[1].hits) / Math.max(d[1].hits, 1) * 100).toFixed(1) + '%' : 'N/A';
      return { daily_traffic: d, peak_hours: hourly.data, day_over_day_growth: growth };
    }
    case 'get_realtime_analytics': {
      const [traffic, countries, devices, pages, live] = await Promise.all([
        queryAE(env, Q.realtimeTraffic()), queryAE(env, Q.topCountries(1)), queryAE(env, Q.deviceBreakdown(1)), queryAE(env, Q.topPages(1)), queryAE(env, Q.liveVisitors()),
      ]);
      return { traffic: traffic.data, countries: countries.data, devices: devices.data, top_pages: pages.data, live_visitors: live.data };
    }
    case 'get_performance_metrics': {
      const [responseTime, errors, slowest, errorRate] = await Promise.all([
        queryAE(env, Q.avgResponseTime()), queryAE(env, Q.recentErrors()), queryAE(env, Q.slowestPages()), queryAE(env, Q.errorRate(7)),
      ]);
      return { avg_response_times: responseTime.data, recent_errors: errors.data, slowest_pages: slowest.data, error_rate_by_day: errorRate.data };
    }
    case 'get_watch_analytics': {
      const [events, completion, byDevice] = await Promise.all([
        queryAE(env, Q.watchEventTypes(7)), queryAE(env, Q.watchCompletion(7)), queryAE(env, Q.watchByDevice(7)),
      ]);
      return { event_distribution: events.data, completion_rates: completion.data, watch_by_device: byDevice.data };
    }
    case 'moderate_comment':
      await db.prepare('DELETE FROM comments WHERE id=?').bind(args.comment_id).run();
      return { deleted: true, comment_id: args.comment_id };
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
      return { deleted };
    }
    case 'list_r2_files': {
      const listed = await env.MEDIA_BUCKET.list({ prefix: args.prefix || '', limit: 50 });
      return { files: listed.objects.map((o) => ({ key: o.key, size_kb: Math.round(o.size / 1024), uploaded: o.uploaded })), truncated: listed.truncated };
    }
    case 'get_admin_logs':
      return (await db.prepare('SELECT l.action, l.target, l.details, l.created_at, u.name as admin FROM admin_logs l LEFT JOIN users u ON l.admin_id=u.id ORDER BY l.created_at DESC LIMIT ?').bind(args.limit || 20).all()).results;
    // ---- Scribe control ----
    case 'list_scribe_jobs':
      return (await db.prepare('SELECT id, url, target_lang, status, step, title, language_code, duration, cue_count, error, created_at FROM scribe_jobs ORDER BY created_at DESC LIMIT ?').bind(args.limit || 15).all()).results;
    case 'get_scribe_job': {
      const job = await db.prepare('SELECT * FROM scribe_jobs WHERE id = ?').bind(args.id).first();
      return job || { error: 'Job not found' };
    }
    case 'start_transcription': {
      if (!/^https?:\/\//.test(args.url || '')) return { error: 'Valid http(s) url required' };
      const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
      let id = '';
      const arr = new Uint8Array(12);
      crypto.getRandomValues(arr);
      for (const b of arr) id += chars[b % chars.length];
      const targetLang = args.target_lang || 'en';
      await db.prepare('INSERT INTO scribe_jobs (id, url, target_lang, status, step) VALUES (?, ?, ?, ?, ?)')
        .bind(id, args.url, targetLang, 'queued', 'queued').run();
      await env.SCRIBE_WORKFLOW.create({ id, params: { jobId: id, url: args.url, targetLang } });
      return { started: true, job_id: id, note: 'Pipeline runs for several minutes. Check progress with get_scribe_job.' };
    }
    case 'semantic_search': {
      if (!env.AI || !env.VECTORIZE) return { error: 'semantic search not configured' };
      const emb: any = await env.AI.run('@cf/baai/bge-m3', { text: [args.q] });
      const vector = emb.data?.[0];
      if (!vector) return { error: 'embedding failed' };
      const res = await env.VECTORIZE.query(vector, { topK: Math.min(args.limit || 8, 20), returnMetadata: 'all' });
      return res.matches.map((m: any) => ({ score: Math.round(m.score * 100) / 100, ...(m.metadata || {}) }));
    }
    case 'publish_scribe_job': {
      try {
        const { publishScribeJob } = await import('../scribe/publish');
        const result = await publishScribeJob(env as any, args.job_id, {
          category_id: args.category_id || null,
          scholar_id: args.scholar_id || null,
        });
        return { published: true, ...result, note: 'Media, subtitles, and responsive thumbnails all placed in canonical locations; cache purged.' };
      } catch (err: any) {
        return { error: err.message };
      }
    }
    default:
      return { error: 'Unknown tool: ' + name };
  }
}
