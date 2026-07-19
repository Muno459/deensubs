import { Hono } from 'hono';
import { e } from '../lib/helpers.js';
import { VIDEO_COLS, VIDEO_JOIN } from '../lib/db.js';
import { getRSSVideos, getSitemapData } from '../lib/kv-cache.js';

// Import font binaries (served from edge via Worker)
import amiri400arabic from '../fonts/amiri-400-arabic.woff2';
import amiri400latin from '../fonts/amiri-400-latin.woff2';
import amiri700latin from '../fonts/amiri-700-latin.woff2';
import cormorantItLatExt from '../fonts/cormorant-italic-latin-ext.woff2';
import cormorantItLat from '../fonts/cormorant-italic-latin.woff2';
import cormorantLatExt from '../fonts/cormorant-latin-ext.woff2';
import cormorantLat from '../fonts/cormorant-latin.woff2';
import outfitLatExt from '../fonts/outfit-latin-ext.woff2';
import outfitLat from '../fonts/outfit-latin.woff2';
import patternT from '../artifacts/pattern-t.png';
import patternB from '../artifacts/pattern-b.png';
/*
 * pattern-flat.png — alpha mask derived from "Golden Color Traditional Islamic Pattern"
 * via Vecteezy (Free License): https://www.vecteezy.com/vector-art/47131621
 * Source EPS: src/artifacts/vecteezy_golden-color-traditional-islamic-pattern_47131621.eps
 * Regenerate with tools/pattern/make-flat-mask.py. Attribution kept in code only
 * (owner decision, July 2026) — the Free License expects visible credit; see AGENTS.md.
 */
import patternF from '../artifacts/pattern-flat.png';

// Favicon package (RealFaviconGenerator export, July 2026)
import faviconSvg from '../artifacts/favicon/favicon.svg';
import faviconIco from '../artifacts/favicon/favicon.ico';
import favicon96 from '../artifacts/favicon/favicon-96x96.png';
import appleTouchIcon from '../artifacts/favicon/apple-touch-icon.png';
import manifestIcon192 from '../artifacts/favicon/web-app-manifest-192x192.png';
import manifestIcon512 from '../artifacts/favicon/web-app-manifest-512x512.png';
import ogImage from '../artifacts/og-image.png';

const FONT_MAP = {
  'amiri-400-arabic': amiri400arabic,
  'amiri-400-latin': amiri400latin,
  'amiri-700-latin': amiri700latin,
  'cormorant-italic-latin-ext': cormorantItLatExt,
  'cormorant-italic-latin': cormorantItLat,
  'cormorant-latin-ext': cormorantLatExt,
  'cormorant-latin': cormorantLat,
  'outfit-latin-ext': outfitLatExt,
  'outfit-latin': outfitLat,
};

const feeds = new Hono();

const VC = VIDEO_COLS;
const VJ = VIDEO_JOIN;


// Fonts served from Worker edge
feeds.get('/fonts/:name', (c) => {
  const name = c.req.param('name').replace('.woff2', '');
  const data = FONT_MAP[name];
  if (!data) return c.text('Not found', 404);
  return new Response(data, { headers: { 'Content-Type': 'font/woff2', 'Cache-Control': 'public, max-age=31536000, immutable', 'Access-Control-Allow-Origin': '*' } });
});

// Background pattern artwork (see layout.js for Vecteezy license/attribution)
const BG_MAP = { 'pattern-t': patternT, 'pattern-b': patternB, 'pattern-flat': patternF };
feeds.get('/bg/:name', (c) => {
  const data = BG_MAP[c.req.param('name').replace('.png', '')];
  if (!data) return c.text('Not found', 404);
  return new Response(data, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' } });
});

const ICON_CACHE = { 'Cache-Control': 'public, max-age=604800' };
feeds.get('/favicon.svg', (c) => new Response(faviconSvg, { headers: { 'Content-Type': 'image/svg+xml', ...ICON_CACHE } }));
feeds.get('/favicon.ico', (c) => new Response(faviconIco, { headers: { 'Content-Type': 'image/x-icon', ...ICON_CACHE } }));
feeds.get('/favicon-96x96.png', (c) => new Response(favicon96, { headers: { 'Content-Type': 'image/png', ...ICON_CACHE } }));
feeds.get('/apple-touch-icon.png', (c) => new Response(appleTouchIcon, { headers: { 'Content-Type': 'image/png', ...ICON_CACHE } }));
feeds.get('/web-app-manifest-192x192.png', (c) => new Response(manifestIcon192, { headers: { 'Content-Type': 'image/png', ...ICON_CACHE } }));
feeds.get('/web-app-manifest-512x512.png', (c) => new Response(manifestIcon512, { headers: { 'Content-Type': 'image/png', ...ICON_CACHE } }));
feeds.get('/og-image.png', (c) => new Response(ogImage, { headers: { 'Content-Type': 'image/png', ...ICON_CACHE } }));

feeds.get('/robots.txt', (c) => new Response(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /auth/\nDisallow: /api/fingerprint\nDisallow: /api/watch-event\nSitemap: ${new URL(c.req.url).origin}/sitemap.xml\n`, { headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=86400' } }));

// Service Worker — auto-versioned per deploy
import BUILD_VERSION from '../scripts/build-version.txt';

const OFFLINE_PAGE = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline — DeenSubs</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#0f0f0f;color:#eae6da;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:2rem}.c{max-width:360px}h1{color:#45b3a2;font-size:1.4rem;margin-bottom:.5rem}p{color:#807c72;font-size:.85rem;line-height:1.6;margin-bottom:1.5rem}a{color:#45b3a2;text-decoration:none;padding:.5rem 1.5rem;border:1px solid rgba(62,166,152,.2);border-radius:8px;font-size:.85rem;transition:border-color .2s}a:hover{border-color:#45b3a2}</style></head><body><div class="c"><h1>You\u2019re offline</h1><p>Check your connection and try again. Previously visited pages may still be available.</p><a href="/">Retry</a></div></body></html>`;

function buildSW(version) {
  return `var V='ds-${version}',IC='ds-img-${version}',MAX=500,
PRECACHE=['/fonts/outfit-latin.woff2','/fonts/amiri-400-arabic.woff2','/fonts/amiri-400-latin.woff2','/favicon.svg'];

self.addEventListener('install',function(e){
  e.waitUntil(caches.open(V).then(function(c){return c.addAll(PRECACHE)}));
  self.skipWaiting();
});

self.addEventListener('activate',function(e){
  e.waitUntil(Promise.all([
    caches.keys().then(function(k){return Promise.all(k.filter(function(n){return n!==V&&n!==IC}).map(function(n){return caches.delete(n)}))}),
    self.registration.navigationPreload?self.registration.navigationPreload.enable():Promise.resolve()
  ]));
  self.clients.claim();
});

self.addEventListener('message',function(e){
  if(e.data==='clear-cache'){
    caches.keys().then(function(k){return Promise.all(k.map(function(n){return caches.delete(n)}))}).then(function(){
      self.clients.matchAll().then(function(cls){cls.forEach(function(c){c.postMessage('cache-cleared')})});
    });
  }
});

self.addEventListener('fetch',function(e){
  var u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==self.location.origin)return;
  if(u.pathname.startsWith('/api/media/')||u.pathname.startsWith('/api/vtt/'))return;

  if(u.pathname.startsWith('/fonts/')||u.pathname.startsWith('/bg/')||u.pathname==='/favicon.svg'){
    e.respondWith(caches.match(e.request).then(function(r){return r||fetch(e.request).then(function(res){if(res.ok){var cl=res.clone();caches.open(V).then(function(c){c.put(e.request,cl)})}return res})}));
    return;
  }

  if(u.pathname.startsWith('/img/')){
    e.respondWith(caches.open(IC).then(function(cache){
      return cache.match(e.request).then(function(r){
        if(r)return r;
        return fetch(e.request).then(function(res){
          if(res.ok){
            var cl=res.clone();
            cache.put(e.request,cl);
            cache.keys().then(function(keys){if(keys.length>MAX)cache.delete(keys[0])});
          }
          return res;
        });
      });
    }));
    return;
  }

  if(e.request.mode==='navigate'){
    e.respondWith((async function(){
      try{
        var r=e.preloadResponse?await e.preloadResponse:null;
        if(r)return r;
        return await fetch(e.request);
      }catch(err){
        var cached=await caches.match(e.request);
        if(cached)return cached;
        return new Response(${JSON.stringify(OFFLINE_PAGE)},{headers:{'Content-Type':'text/html'}});
      }
    })());
    return;
  }
});`;
}

feeds.get('/sw.js', (c) => new Response(buildSW(BUILD_VERSION.trim()), {
  headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'public, max-age=0, must-revalidate', 'Service-Worker-Allowed': '/' }
}));

feeds.get('/manifest.json', (c) => new Response(JSON.stringify({
  name: 'DeenSubs',
  short_name: 'DeenSubs',
  description: 'Arabic Islamic lectures with accurate English subtitles, powered by AI',
  start_url: '/',
  display: 'standalone',
  orientation: 'any',
  background_color: '#f6f4ee',
  theme_color: '#0e6b63',
  categories: ['education', 'entertainment'],
  icons: [
    { src: '/web-app-manifest-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: '/web-app-manifest-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
  ],
  shortcuts: [
    { name: 'Search', url: '/search', icons: [{ src: '/favicon.svg', sizes: 'any' }] },
    { name: 'Scholars', url: '/scholars', icons: [{ src: '/favicon.svg', sizes: 'any' }] },
    { name: 'Bookmarks', url: '/bookmarks', icons: [{ src: '/favicon.svg', sizes: 'any' }] },
  ],
}), { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=86400' } }));

// RSS Feed
feeds.get('/feed.xml', async (c) => {
  const videos = await getRSSVideos(c.env);
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
  const data = await getSitemapData(c.env);
  const base = new URL(c.req.url).origin;
  const urls = [
    `<url><loc>${base}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
    `<url><loc>${base}/scholars</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>`,
    `<url><loc>${base}/about</loc><changefreq>monthly</changefreq><priority>0.4</priority></url>`,
  ];
  data.categories.forEach(c => urls.push(`<url><loc>${base}/category/${c.slug}</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>`));
  (data.scholars || []).forEach(s => urls.push(`<url><loc>${base}/scholar/${s.slug}</loc><changefreq>weekly</changefreq><priority>0.6</priority></url>`));
  (data.playlists || []).forEach(p => urls.push(`<url><loc>${base}/playlist/${p.slug}</loc><changefreq>weekly</changefreq><priority>0.6</priority></url>`));
  data.videos.forEach(v => {
    // Video sitemap extension: requires title + thumbnail; only emit when both exist
    const vid = v.title && v.thumb_key ? `<video:video>
<video:thumbnail_loc>${base}/api/media/${e(v.thumb_key)}</video:thumbnail_loc>
<video:title>${e(v.title)}</video:title>
<video:description>${e((v.description || v.title).slice(0, 2000))}</video:description>
${v.video_key ? `<video:content_loc>${base}/api/media/${e(v.video_key)}</video:content_loc>` : ''}
${v.duration ? `<video:duration>${Math.round(v.duration)}</video:duration>` : ''}
${v.created_at ? `<video:publication_date>${v.created_at.split(' ')[0]}</video:publication_date>` : ''}
</video:video>` : '';
    urls.push(`<url><loc>${base}/watch/${v.slug}</loc><lastmod>${v.created_at?.split(' ')[0] || ''}</lastmod><priority>0.9</priority>${vid}</url>`);
  });
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">${urls.join('\n')}</urlset>`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
});

export default feeds;
