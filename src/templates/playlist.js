import { e, fv, ft, thu, cdn } from '../lib/helpers.js';
import { tsvg } from '../components/thumbnail.js';

function fmtTotal(sec) {
  const min = Math.round((sec || 0) / 60);
  if (!min) return '';
  return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min} min`;
}

function plThumb(p) {
  if (p.cover_key) return cdn(p.cover_key);
  return p.first_thumb ? thu({ thumb_key: p.first_thumb }) : null;
}

// Playlist card, shown inside category and scholar pages
export function pcard(p) {
  const th = plThumb(p);
  const total = fmtTotal(p.total_duration);
  return `<a href="/playlist/${e(p.slug)}" class="plc card-anim" title="${e(p.title)}">
<div class="plc-th">
  ${th ? `<img src="${e(th)}" alt="${e(p.title)}" loading="lazy" decoding="async">` : tsvg(p.title, '#0e6b63', 480, 270)}
  <span class="plc-count"><svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h10v2H4z"/></svg>${p.video_count}</span>
</div>
<div class="plc-bd">
  <h3>${e(p.title)}</h3>
  ${p.title_ar ? `<p class="plc-ar" dir="rtl">${e(p.title_ar)}</p>` : ''}
  <p class="plc-mt">${p.video_count} video${p.video_count !== 1 ? 's' : ''}${total ? ` &middot; ${total}` : ''}</p>
</div></a>`;
}

export function renderPlaylist({ playlist, videos, base }) {
  base = base || 'https://deensubs.com';
  const th = plThumb({ ...playlist, first_thumb: videos.find(v => v.thumb_key)?.thumb_key });
  const total = fmtTotal(videos.reduce((a, v) => a + (v.duration || 0), 0));
  const views = videos.reduce((a, v) => a + (v.views || 0), 0);
  const first = videos[0];
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'ItemList',
    name: playlist.title, description: playlist.description || '',
    numberOfItems: videos.length,
    itemListElement: videos.map((v, i) => ({
      '@type': 'ListItem', position: i + 1, name: v.title, url: base + '/watch/' + v.slug,
    })),
  });
  const cat = videos.find(v => v.category_name);
  const breadcrumb = JSON.stringify({'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:[
    {'@type':'ListItem',position:1,name:'Home',item:base+'/'},
    ...(cat?[{'@type':'ListItem',position:2,name:cat.category_name,item:base+'/category/'+cat.category_slug}]:[]),
    {'@type':'ListItem',position:cat?3:2,name:playlist.title},
  ]});
  return `
<script type="application/ld+json">${jsonLd}</script>
<script type="application/ld+json">${breadcrumb}</script>
<section class="pl-page">
  <header class="pl-hero">
    <div class="pl-hero-th">
      ${th ? `<img src="${e(th)}" alt="${e(playlist.title)}" decoding="async">` : tsvg(playlist.title, '#0e6b63', 480, 270)}
    </div>
    <div class="pl-hero-txt">
      <span class="pl-kicker">Playlist</span>
      <h1 class="page-title">${e(playlist.title)}</h1>
      ${playlist.title_ar ? `<p class="pl-hero-ar" dir="rtl">${e(playlist.title_ar)}</p>` : ''}
      ${playlist.description ? `<p class="page-desc">${e(playlist.description)}</p>` : ''}
      <p class="cat-hero-meta">${videos.length} video${videos.length !== 1 ? 's' : ''}${total ? ` <i></i> ${total}` : ''}${views ? ` <i></i> ${fv(views)}` : ''}</p>
      ${first ? `<a href="/watch/${e(first.slug)}" class="pl-play"><svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M8 5v14l11-7z"/></svg>Play all</a>` : ''}
    </div>
  </header>
  ${videos.length ? `<ol class="pl-ls">${videos.map((v, i) => {
    const vt = thu(v);
    return `<li><a href="/watch/${e(v.slug)}" class="plr">
      <span class="plr-n">${i + 1}</span>
      <div class="plr-th">${vt ? `<img src="${e(vt)}" alt="" loading="lazy" decoding="async">` : tsvg(v.title, v.category_color || '#0e6b63', 160, 90)}${v.duration ? `<span class="dur dur-s">${ft(v.duration)}</span>` : ''}</div>
      <div class="plr-i">
        <h3>${e(v.title)}</h3>
        <p>${v.source ? e(v.source) + ' &middot; ' : ''}${fv(v.views)}${v.srt_key ? ' &middot; CC' : ''}</p>
      </div>
    </a></li>`;
  }).join('')}</ol>` : '<p class="emp">Videos in this playlist are being prepared. Check back soon.</p>'}
</section>`;
}
