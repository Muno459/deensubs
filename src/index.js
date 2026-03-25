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
