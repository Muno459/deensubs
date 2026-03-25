import { Hono } from 'hono';
import { authMiddleware } from './middleware/auth.js';
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
      c.env.DB.prepare(
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
  const cats = (await c.env.DB.prepare('SELECT * FROM categories ORDER BY name').all()).results;
  return c.html(renderPage('Not Found', render404(), cats, null, null, c.get('user')), 404);
});

export default app;
