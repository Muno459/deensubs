import { Hono } from 'hono';
import { authMiddleware } from './middleware/auth.js';
import { readDB, writeDB } from './lib/db.js';
import { renderPage } from './templates/layout.js';
import { render404 } from './templates/error.js';
import pages from './routes/pages.js';
import api from './routes/api.js';
import authRoutes from './routes/auth.js';
import admin from './routes/admin.js';
import feeds from './routes/feeds.js';

const app = new Hono();

// Inject user into all requests
app.use('*', authMiddleware);

// Analytics tracking (non-blocking, don't slow down responses)
app.use('*', async (c, next) => {
  await next();
  // Track page views after response (non-blocking)
  const path = new URL(c.req.url).pathname;
  if (path.startsWith('/api/') || path.startsWith('/auth/') || path.includes('.')) return;
  const user = c.get('user');
  try {
    const slug = path.match(/\/watch\/([^/]+)/)?.[1] || null;
    c.executionCtx.waitUntil(
      writeDB(c.env).prepare(
        'INSERT INTO analytics (type, path, slug, user_id, ip, country, user_agent, referer) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        slug ? 'watch' : 'pageview',
        path,
        slug,
        user?.id || null,
        c.req.header('CF-Connecting-IP') || '',
        c.req.header('CF-IPCountry') || '',
        (c.req.header('User-Agent') || '').slice(0, 200),
        (c.req.header('Referer') || '').slice(0, 500)
      ).run()
    );
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
  const cats = (await readDB(c.env).prepare('SELECT * FROM categories ORDER BY name').all()).results;
  return c.html(renderPage('Not Found', render404(), cats, null, null, c.get('user')), 404);
});

// Scheduled handler — runs daily to optimize images + clean sessions
export default {
  fetch: app.fetch,
  async scheduled(event, env, ctx) {
    // 1. Clean expired sessions
    await env.DB.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();

    // 2. Auto-generate responsive WebP thumbnails (320w, 480w, 640w)
    const thumbs = await env.MEDIA_BUCKET.list({ prefix: 'thumbs/' });
    const originals = thumbs.objects.filter(o => /\.(jpg|jpeg|png)$/i.test(o.key) && !/-\d+w\./i.test(o.key));

    for (const orig of originals) {
      const base = orig.key.replace(/\.(jpg|jpeg|png)$/i, '');
      const sizes = [320, 480, 640];

      for (const w of sizes) {
        const webpKey = `${base}-${w}w.webp`;
        const existing = await env.MEDIA_BUCKET.head(webpKey);
        if (existing) continue;

        try {
          const cdnUrl = 'https://cdn.deensubs.com/' + orig.key;
          const resp = await fetch(cdnUrl, {
            cf: { image: { format: 'webp', quality: 80, width: w, fit: 'cover' } }
          });
          if (resp.ok) {
            const body = await resp.arrayBuffer();
            await env.MEDIA_BUCKET.put(webpKey, body, {
              httpMetadata: { contentType: 'image/webp' }
            });
          }
        } catch {}
      }
    }
  }
};
