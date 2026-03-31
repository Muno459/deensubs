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

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#0a0a10"/><rect x="7" y="7" width="18" height="18" fill="none" stroke="#c4a44c" stroke-width="1.2"/><rect x="7" y="7" width="18" height="18" fill="none" stroke="#c4a44c" stroke-width="1.2" transform="rotate(45 16 16)"/><circle cx="16" cy="16" r="3" fill="none" stroke="#c4a44c" stroke-width="0.8"/></svg>`;

// Fonts served from Worker edge
feeds.get('/fonts/:name', (c) => {
  const name = c.req.param('name').replace('.woff2', '');
  const data = FONT_MAP[name];
  if (!data) return c.text('Not found', 404);
  return new Response(data, { headers: { 'Content-Type': 'font/woff2', 'Cache-Control': 'public, max-age=31536000, immutable', 'Access-Control-Allow-Origin': '*' } });
});

feeds.get('/favicon.svg', (c) => new Response(FAVICON, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=604800' } }));

feeds.get('/favicon.ico', (c) => new Response(FAVICON, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=604800' } }));

feeds.get('/robots.txt', (c) => new Response(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /auth/\nDisallow: /api/fingerprint\nDisallow: /api/watch-event\nSitemap: ${new URL(c.req.url).origin}/sitemap.xml\n`, { headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=86400' } }));

// Service Worker — auto-versioned per deploy
import BUILD_VERSION from '../scripts/build-version.txt';

const OFFLINE_PAGE = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline — DeenSubs</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#050507;color:#eae6da;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:2rem}.c{max-width:360px}h1{color:#c4a44c;font-size:1.4rem;margin-bottom:.5rem}p{color:#807c72;font-size:.85rem;line-height:1.6;margin-bottom:1.5rem}a{color:#c4a44c;text-decoration:none;padding:.5rem 1.5rem;border:1px solid rgba(196,164,76,.2);border-radius:8px;font-size:.85rem;transition:border-color .2s}a:hover{border-color:#c4a44c}</style></head><body><div class="c"><h1>You\u2019re offline</h1><p>Check your connection and try again. Previously visited pages may still be available.</p><a href="/">Retry</a></div></body></html>`;

function buildSW(version) {
  return `var V='ds-${version}',IC='ds-img-${version}',MAX=500,
PRECACHE=['/fonts/outfit-latin.woff2','/fonts/cormorant-latin.woff2','/fonts/amiri-400-arabic.woff2','/fonts/amiri-400-latin.woff2','/favicon.svg'];

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

  if(u.pathname.startsWith('/fonts/')||u.pathname==='/favicon.svg'){
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
  background_color: '#050507',
  theme_color: '#c4a44c',
  categories: ['education', 'entertainment'],
  icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
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
  data.videos.forEach(v => urls.push(`<url><loc>${base}/watch/${v.slug}</loc><lastmod>${v.created_at?.split(' ')[0] || ''}</lastmod><priority>0.9</priority></url>`));
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('\n')}</urlset>`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
});

export default feeds;
