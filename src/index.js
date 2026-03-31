import { Hono } from 'hono';
import { authMiddleware } from './middleware/auth.js';
import { writeDB } from './lib/db.js';
import { renderPage } from './templates/layout.js';
import { render404 } from './templates/error.js';
import pages from './routes/pages.js';
import api from './routes/api.js';
import authRoutes from './routes/auth.js';
import admin from './routes/admin.js';
import feeds from './routes/feeds.js';
import { setCtx } from './lib/kv-cache.js';

const app = new Hono();

// ── Maintenance gate — password-protect entire site ──
// Set MAINTENANCE_PASS secret in Cloudflare to enable. Remove secret to disable.
const MAINTENANCE_PAGE = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DeenSubs — Rebuilding</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#050507;color:#eae6da;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:2rem}.c{text-align:center;max-width:400px}.logo{font-size:1.5rem;font-weight:300;color:#c4a44c;margin-bottom:.5rem;letter-spacing:.05em}h1{font-size:1.1rem;font-weight:400;color:#807c72;margin-bottom:2rem;line-height:1.6}form{display:flex;gap:.5rem;justify-content:center}input{background:#111118;border:1px solid rgba(196,164,76,.15);border-radius:8px;padding:.6rem 1rem;color:#eae6da;font:inherit;font-size:.85rem;width:200px;text-align:center}input:focus{outline:none;border-color:#c4a44c}button{background:rgba(196,164,76,.1);border:1px solid rgba(196,164,76,.2);border-radius:8px;padding:.6rem 1.2rem;color:#c4a44c;font:inherit;font-size:.85rem;font-weight:500;cursor:pointer;transition:all .2s}button:hover{background:rgba(196,164,76,.2);border-color:#c4a44c}.err{color:#c44;font-size:.75rem;margin-top:.75rem}</style></head><body><div class="c"><div class="logo">DeenSubs</div><h1>We are rebuilding the site.<br>Please check back soon.</h1><form method="POST"><input type="password" name="pass" placeholder="Password" autocomplete="off"><button type="submit">Enter</button></form>ERRMSG</div></body></html>`;

app.use('*', async (c, next) => {
  const mpass = c.env.MAINTENANCE_PASS;
  if (!mpass) return next(); // No secret = maintenance off

  const p = c.req.path;
  if (p === '/robots.txt' || p === '/favicon.svg' || p === '/favicon.ico') return next();

  const cookies = c.req.header('Cookie') || '';
  const hasAccess = cookies.includes('ds_maint=1');

  if (c.req.method === 'POST' && !hasAccess) {
    const body = await c.req.parseBody();
    if (body.pass === mpass) {
      return new Response('', {
        status: 302,
        headers: {
          'Location': p,
          'Set-Cookie': 'ds_maint=1; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400',
        },
      });
    }
    return c.html(MAINTENANCE_PAGE.replace('ERRMSG', '<p class="err">Incorrect password</p>'), 403);
  }

  if (!hasAccess) {
    return c.html(MAINTENANCE_PAGE.replace('ERRMSG', ''), 503);
  }

  return next();
});

// Set execution context for stale-while-revalidate KV refreshes
app.use('*', async (c, next) => {
  setCtx(c.executionCtx || c.env?.ctx || null);
  return next();
});

// Security headers
app.use('*', async (c, next) => {
  await next();
  try {
    const h = c.res.headers;
    h.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('X-Frame-Options', 'SAMEORIGIN');
    h.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    const ct = h.get('Content-Type') || '';
    if (ct.includes('text/html')) {
      h.append('Link', '</fonts/outfit-latin.woff2>; rel=preload; as=font; type=font/woff2; crossorigin');
      h.append('Link', '</fonts/cormorant-latin.woff2>; rel=preload; as=font; type=font/woff2; crossorigin');
    }
  } catch {}
});

// Inject user into requests (skip for static assets)
app.use('*', async (c, next) => {
  const p = c.req.path;
  if (p.startsWith('/fonts/') || p.startsWith('/img/') || p.startsWith('/api/media/') || p.startsWith('/api/vtt/') || p === '/api/watch-event' || p === '/api/fingerprint' || p === '/favicon.svg' || p === '/favicon.ico' || p === '/robots.txt' || p === '/sitemap.xml' || p === '/feed.xml' || p === '/manifest.json' || p === '/sw.js') {
    await next();
    return;
  }
  await authMiddleware(c, next);
});

// Analytics Engine — full 20 blob + 20 double schema
// Blobs (strings/dimensions):
//   1: event_type    2: path         3: slug          4: country
//   5: city          6: referer      7: ip            8: device_type
//   9: browser       10: os          11: method       12: content_type
//   13: category     14: scholar     15: user_agent   16-20: reserved
// Doubles (numbers):
//   1: user_id       2: status_code  3: response_ms   4: content_length
//   5-20: reserved (watch events use 5-12)
function parseUA(ua) {
  const isM = /Mobile|Android|iPhone|iPad/i.test(ua);
  const device = /iPad|Tablet/i.test(ua) ? 'tablet' : isM ? 'mobile' : 'desktop';
  const os = /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'macOS' : /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Linux/i.test(ua) ? 'Linux' : 'Other';
  const browser = /Edg/i.test(ua) ? 'Edge' : /Chrome/i.test(ua) ? 'Chrome' : /Firefox/i.test(ua) ? 'Firefox' : /Safari/i.test(ua) ? 'Safari' : 'Other';
  return { device, os, browser };
}
app.use('*', async (c, next) => {
  const start = Date.now();
  try { await next(); } catch (e) { console.error('MIDDLEWARE ERROR:', e.message, e.stack); throw e; }
  const path = new URL(c.req.url).pathname;
  if (path.startsWith('/fonts/') || path.startsWith('/img/') || path === '/favicon.svg' || path === '/favicon.ico' || path === '/api/watch-event' || path === '/sw.js') return;
  const user = c.get('user');
  const slug = path.match(/\/watch\/([^/]+)/)?.[1] || null;
  const catMatch = path.match(/\/category\/([^/]+)/)?.[1] || '';
  const schMatch = path.match(/\/scholar\/([^/]+)/)?.[1] || '';
  const ua = c.req.header('User-Agent') || '';
  const { device, os, browser } = parseUA(ua);
  const isApi = path.startsWith('/api/');
  const type = isApi ? 'api' : path.startsWith('/admin') ? 'admin' : slug ? 'watch' : 'pageview';
  const elapsed = Date.now() - start;
  try {
    const resHeaders = c.res?.headers;
    const cl = parseInt(resHeaders?.get('Content-Length') || '0') || 0;
    const ct = (resHeaders?.get('Content-Type') || '').split(';')[0];
    c.env.ANALYTICS.writeDataPoint({
      indexes: [slug || catMatch || schMatch || path.slice(0, 80)],
      blobs: [type, path.slice(0, 200), slug || '', c.req.header('CF-IPCountry') || '', '', (c.req.header('Referer') || '').slice(0, 200), c.req.header('CF-Connecting-IP') || '', device, browser, os, c.req.method, ct, catMatch, schMatch, ua.slice(0, 200)],
      doubles: [user?.id || 0, c.res?.status || 0, elapsed, cl],
    });
  } catch {}
});

// Mount route groups
app.route('/', feeds);
app.route('/', api);
app.route('/', authRoutes);
app.route('/', admin);
app.route('/', pages);

// 404 handler
app.notFound(async (c) => {
  const { getCategories: gc } = await import('./lib/kv-cache.js');
  const cats = await gc(c.env);
  const resp = c.html(renderPage('Not Found', render404(), cats, null, null, c.get('user'), c.req.url), 404);
  resp.headers.set('X-Robots-Tag', 'noindex');
  return resp;
});

// Global error handler
app.onError(async (err, c) => {
  console.error('Unhandled error:', err.message, err.stack);
  // Track errors in Analytics Engine with full context
  try {
    const ua = c.req.header('User-Agent') || '';
    const { device, os, browser } = parseUA(ua);
    c.env.ANALYTICS.writeDataPoint({
      indexes: ['error'],
      blobs: ['error', c.req.path, '', c.req.header('CF-IPCountry') || '', c.req.header('CF-IPCity') || '', '', c.req.header('CF-Connecting-IP') || '', device, browser, os, c.req.method, err.message?.slice(0, 100) || ''],
      doubles: [0, 500, 0, 0],
    });
  } catch {}
  if (c.req.path.startsWith('/api/')) return c.json({ error: 'Internal server error' }, 500);
  try {
    const { getCategories: gc } = await import('./lib/kv-cache.js');
    const cats = await gc(c.env);
    return c.html(renderPage('Error', '<div class="e404"><h1>Something went wrong</h1><p>Please try again in a moment.</p><div class="e404-actions"><a href="/" class="e404-btn e404-primary">Back to Home</a></div></div>', cats, null, null, c.get('user')), 500);
  } catch { return c.text('Internal Server Error', 500); }
});

// Scheduled handler — runs daily to optimize images + clean sessions
export default {
  fetch: app.fetch,

  // Queue consumer — batched D1 writes (view counts, search logs)
  async queue(batch, env) {
    const db = env.DB.withSession ? env.DB.withSession('first-primary') : env.DB;
    // Batch view increments by slug
    const viewCounts = {};
    const searchLogs = [];
    for (const msg of batch.messages) {
      const { type } = msg.body;
      if (type === 'view') {
        viewCounts[msg.body.slug] = (viewCounts[msg.body.slug] || 0) + 1;
      } else if (type === 'search_log') {
        searchLogs.push(msg.body);
      }
      msg.ack();
    }
    // Batch view updates (1 query per unique slug instead of 1 per pageview)
    for (const [slug, count] of Object.entries(viewCounts)) {
      await db.prepare('UPDATE videos SET views = views + ? WHERE slug = ?').bind(count, slug).run();
    }
    // Batch search log inserts
    for (const s of searchLogs) {
      await db.prepare('INSERT INTO search_logs (query, results, user_id) VALUES (?, ?, ?)').bind(s.query, s.results, s.user_id).run();
    }
    // Fingerprint upserts
    for (const msg of batch.messages) {
      if (msg.body.type !== 'fingerprint') continue;
      const f = msg.body;
      const existing = await db.prepare('SELECT id FROM fingerprints WHERE id = ?').bind(f.fpId).first();
      if (existing) {
        await db.prepare("UPDATE fingerprints SET last_seen = datetime('now'), visit_count = visit_count + 1, user_id = COALESCE(?, user_id) WHERE id = ?").bind(f.userId, f.fpId).run();
      } else {
        await db.prepare('INSERT INTO fingerprints (id, user_id, ip, country, city, user_agent, device_type, os, browser, screen_w, screen_h, gpu, timezone, language, cores, memory, touch) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(f.fpId, f.userId, f.ip, f.country, f.city, f.ua, f.deviceType, f.os, f.browser, f.sw, f.sh, f.gpu, f.tz, f.lang, f.cores, f.mem, f.touch).run();
      }
    }
  },

  async scheduled(event, env, ctx) {
    // 1. Clean expired sessions
    await env.DB.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();

    // 2. Auto-generate responsive AVIF thumbnails (320w, 480w, 640w)
    const thumbs = await env.MEDIA_BUCKET.list({ prefix: 'thumbs/' });
    const originals = thumbs.objects.filter(o => /\.(jpg|jpeg|png)$/i.test(o.key) && !/-\d+w\./i.test(o.key));

    for (const orig of originals) {
      const base = orig.key.replace(/\.(jpg|jpeg|png)$/i, '');
      const sizes = [320, 480, 640];

      for (const w of sizes) {
        const avifKey = `${base}-${w}w.avif`;
        const existing = await env.MEDIA_BUCKET.head(avifKey);
        if (existing) continue;

        try {
          const resp = await fetch('https://cdn.deensubs.com/' + orig.key, {
            cf: { image: { format: 'avif', quality: 65, width: w, fit: 'cover' } }
          });
          if (resp.ok) {
            const body = await resp.arrayBuffer();
            await env.MEDIA_BUCKET.put(avifKey, body, {
              httpMetadata: { contentType: 'image/avif' }
            });
            await env.MEDIA_KV.put(avifKey, body, { metadata: { ct: 'image/avif' } });
          }
        } catch {}
      }
    }

    // 3. Auto-generate scholar photos as lossless AVIF (64w avatar + full-size)
    const schFiles = await env.MEDIA_BUCKET.list({ prefix: 'scholars/' });
    const schOriginals = schFiles.objects.filter(o => /\.(png|jpg|jpeg|webp)$/i.test(o.key) && !/-\d+w\./i.test(o.key) && !/-hero/i.test(o.key));
    for (const orig of schOriginals) {
      const base = orig.key.replace(/\.(png|jpg|jpeg|webp)$/i, '');
      // Full-size lossless AVIF
      const fullKey = `${base}.avif`;
      if (!await env.MEDIA_BUCKET.head(fullKey)) {
        try {
          const resp = await fetch('https://cdn.deensubs.com/' + orig.key, {
            cf: { image: { format: 'avif', quality: 100, fit: 'cover' } }
          });
          if (resp.ok) {
            const body = await resp.arrayBuffer();
            await env.MEDIA_BUCKET.put(fullKey, body, { httpMetadata: { contentType: 'image/avif' } });
            await env.MEDIA_KV.put(fullKey, body, { metadata: { ct: 'image/avif' } });
          }
        } catch {}
      }
      // 64w avatar lossless AVIF
      const smallKey = `${base}-64w.avif`;
      if (!await env.MEDIA_BUCKET.head(smallKey)) {
        try {
          const resp = await fetch('https://cdn.deensubs.com/' + orig.key, {
            cf: { image: { format: 'avif', quality: 100, width: 64, height: 64, fit: 'cover' } }
          });
          if (resp.ok) {
            const body = await resp.arrayBuffer();
            await env.MEDIA_BUCKET.put(smallKey, body, { httpMetadata: { contentType: 'image/avif' } });
            await env.MEDIA_KV.put(smallKey, body, { metadata: { ct: 'image/avif' } });
          }
        } catch {}
      }
    }

    // 4. Pre-generate VTT files from SRT (so CDN can serve them directly)
    const srtFiles = await env.MEDIA_BUCKET.list({ prefix: 'subs/' });
    for (const srt of srtFiles.objects) {
      if (!srt.key.endsWith('.srt')) continue;
      const vttKey = 'vtt/' + srt.key.replace('subs/', '').replace('.srt', '.vtt');
      const existing = await env.MEDIA_BUCKET.head(vttKey);
      if (existing) continue;
      try {
        const obj = await env.MEDIA_BUCKET.get(srt.key);
        if (!obj) continue;
        const text = await obj.text();
        const vtt = 'WEBVTT\n\n' + text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
        await env.MEDIA_BUCKET.put(vttKey, vtt, { httpMetadata: { contentType: 'text/vtt; charset=utf-8' } });
      } catch {}
    }
  }
};
