import { Hono } from 'hono';
import { e } from '../lib/helpers.js';
import { VIDEO_COLS, VIDEO_JOIN } from '../lib/db.js';

const feeds = new Hono();

const VC = VIDEO_COLS;
const VJ = VIDEO_JOIN;

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#0a0a10"/><rect x="7" y="7" width="18" height="18" fill="none" stroke="#c4a44c" stroke-width="1.2"/><rect x="7" y="7" width="18" height="18" fill="none" stroke="#c4a44c" stroke-width="1.2" transform="rotate(45 16 16)"/><circle cx="16" cy="16" r="3" fill="none" stroke="#c4a44c" stroke-width="0.8"/></svg>`;

feeds.get('/favicon.svg', (c) => new Response(FAVICON, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=604800' } }));

feeds.get('/favicon.ico', (c) => new Response(FAVICON, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=604800' } }));

feeds.get('/robots.txt', (c) => new Response(`User-agent: *\nAllow: /\nSitemap: ${new URL(c.req.url).origin}/sitemap.xml\n`, { headers: { 'Content-Type': 'text/plain' } }));

feeds.get('/manifest.json', (c) => c.json({
  name: 'DeenSubs',
  short_name: 'DeenSubs',
  description: 'Arabic Islamic content with English subtitles',
  start_url: '/',
  display: 'standalone',
  background_color: '#050507',
  theme_color: '#c4a44c',
  icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' }],
}));

// RSS Feed
feeds.get('/feed.xml', async (c) => {
  const videos = (await c.env.DB.prepare(`SELECT ${VC} ${VJ} ORDER BY v.created_at DESC LIMIT 50`).all()).results;
  const base = new URL(c.req.url).origin;
  const items = videos.map(v => `<item>
<title>${e(v.title)}</title>
<link>${base}/watch/${v.slug}</link>
<description>${e(v.description || '')}</description>
<pubDate>${new Date(v.created_at + 'Z').toUTCString()}</pubDate>
<guid>${base}/watch/${v.slug}</guid>
${v.thumb_key ? `<enclosure url="${base}/api/media/${v.thumb_key}" type="image/jpeg"/>` : ''}
</item>`).join('\n');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel><title>DeenSubs</title><link>${base}</link>
<description>Arabic Islamic lectures with AI-powered English subtitles</description>
<language>en</language>
<atom:link href="${base}/feed.xml" rel="self" type="application/rss+xml"/>
${items}</channel></rss>`, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
});

// Sitemap
feeds.get('/sitemap.xml', async (c) => {
  const db = c.env.DB;
  const [videos, cats] = await Promise.all([
    db.prepare('SELECT slug, created_at FROM videos ORDER BY created_at DESC').all(),
    db.prepare('SELECT slug FROM categories ORDER BY name').all(),
  ]);
  const base = new URL(c.req.url).origin;
  const urls = [`<url><loc>${base}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`];
  cats.results.forEach(c => urls.push(`<url><loc>${base}/category/${c.slug}</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>`));
  videos.results.forEach(v => urls.push(`<url><loc>${base}/watch/${v.slug}</loc><lastmod>${v.created_at?.split(' ')[0] || ''}</lastmod><priority>0.9</priority></url>`));
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('\n')}</urlset>`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
});

export default feeds;
