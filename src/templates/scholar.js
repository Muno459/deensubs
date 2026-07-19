import { e, fv, ft, cdn, schImg } from '../lib/helpers.js';
import { vcard } from '../components/video-card.js';
import { pcard } from './playlist.js';
import CATALOG_JS from '../scripts/catalog.min.txt';

export function renderScholars({ scholars }) {
  return `
<div class="sch-page">
  <header class="page-hd">
    <h1 class="page-title">Scholars</h1>
    <p class="page-desc">The scholars whose knowledge we make accessible to the English-speaking world.</p>
    <p class="page-meta">${scholars.length} scholar${scholars.length !== 1 ? 's' : ''}</p>
  </header>
  <div class="sch-grid">
    ${scholars.map(s => `<a href="/scholar/${e(s.slug)}" class="sch-card card-anim">
      <div class="sch-card-img">
        ${s.photo ? `<img src="${schImg(s.photo)}" alt="${e(s.name)}" loading="lazy" decoding="async">` : `<div class="sch-card-initial">${e(s.name).split(' ').pop().charAt(0)}</div>`}
      </div>
      <div class="sch-card-body">
        <h3>${e(s.name)}</h3>
        ${s.title ? `<p class="sch-card-title">${e(s.title)}</p>` : ''}
        <div class="sch-card-stats">
          <div class="sch-card-stat"><span>${s.video_count || 0}</span> videos</div>
          <div class="sch-card-stat"><span>${s.total_views || 0}</span> views</div>
        </div>
      </div>
    </a>`).join('')}
  </div>
</div>`;
}

export function renderScholar({ scholar, videos, playlists }) {
  playlists = playlists || [];
  // Videos in a playlist shown here collapse into its card
  const memberIds = new Set(playlists.flatMap(p => String(p.member_ids || '').split(',').filter(Boolean).map(Number)));
  const loose = memberIds.size ? videos.filter(v => !memberIds.has(v.id)) : videos;
  const hasHero = !!scholar.photo_hero;
  const hasPhoto = !!scholar.photo;
  const totalViews = videos.reduce((a, v) => a + (v.views || 0), 0);
  const totalMin = Math.round(videos.reduce((a, v) => a + (v.duration || 0), 0) / 60);
  const subtitled = videos.filter(v => v.srt_key).length;
  const hrs = totalMin >= 60 ? `${Math.floor(totalMin / 60)}h ${totalMin % 60}m` : `${totalMin} min`;
  const breadcrumb = JSON.stringify({'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:[
    {'@type':'ListItem',position:1,name:'Home',item:'https://deensubs.com/'},
    {'@type':'ListItem',position:2,name:'Scholars',item:'https://deensubs.com/scholars'},
    {'@type':'ListItem',position:3,name:scholar.name},
  ]});
  const personLd = JSON.stringify({'@context':'https://schema.org','@type':'Person',name:scholar.name,
    ...(scholar.title?{jobTitle:scholar.title}:{}),
    ...(scholar.bio?{description:scholar.bio}:{}),
    ...(scholar.photo?{image:cdn(scholar.photo.replace(/\.(png|jpg|jpeg)$/i,'.avif'))}:{}),
  });
  return `
<script type="application/ld+json">${breadcrumb}</script>
<script type="application/ld+json">${personLd}</script>
<div class="sch-profile">
  <div class="sp-hero${hasHero ? ' sp-hero-img' : ''}">
    ${hasHero ? `<div class="sp-hero-portrait"><img src="${schImg(scholar.photo_hero)}" alt="${e(scholar.name)}" fetchpriority="high"></div>` : ''}
    ${!hasHero && hasPhoto ? `<div class="sp-hero-av-large"><img src="${schImg(scholar.photo)}" alt="${e(scholar.name)}" fetchpriority="high"></div>` : ''}
    ${!hasHero && !hasPhoto ? `<div class="sp-hero-av-large"><div class="sp-hero-initial">${e(scholar.name).split(' ').pop().charAt(0)}</div></div>` : ''}
    <div class="sp-hero-content${hasHero ? ' sp-hero-offset' : ''}">
      <h1 class="sp-hero-name">${e(scholar.name)}</h1>
      ${scholar.title ? `<div class="sp-hero-title">${e(scholar.title)}</div>` : ''}
      ${scholar.bio ? `<p class="sp-hero-bio">${e(scholar.bio)}</p>` : ''}
      <p class="page-meta">${videos.length} video${videos.length !== 1 ? 's' : ''} &middot; ${fv(totalViews)} &middot; ${hrs} total${subtitled ? ` &middot; ${subtitled} subtitled` : ''}</p>
      <button class="sp-share" id="sp-share" title="Share"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> Share</button>
      <script>document.getElementById('sp-share').onclick=function(){if(navigator.share)navigator.share({title:'${e(scholar.name)} | DeenSubs',url:location.href}).catch(function(){});else{navigator.clipboard.writeText(location.href).then(function(){var t=document.getElementById('toast');if(!t){t=document.createElement('div');t.id='toast';t.className='toast';document.body.appendChild(t)}t.textContent='Link copied';t.classList.add('show');setTimeout(function(){t.classList.remove('show')},2500)}).catch(function(){})}}</script>
    </div>
  </div>

  ${playlists.length ? `<section class="sec"><div class="sec-hd"><h2>Playlists</h2></div><div class="plc-grid">${playlists.map(pcard).join('')}</div></section>` : ''}

  ${loose.length ? `
  <div class="toolbar">
    <div class="tb-row">
      <div class="tb-chips" id="sp-sort">
        <button class="tb-chip tb-chip-on" data-sort="newest">Newest</button>
        <button class="tb-chip" data-sort="popular">Popular</button>
        <button class="tb-chip" data-sort="longest">Longest</button>
      </div>
      <div class="tb-chips" id="tb-dur">
        <button class="tb-chip tb-chip-on" data-dur="">Any length</button>
        <button class="tb-chip" data-dur="s">Under 10 min</button>
        <button class="tb-chip" data-dur="m">10&ndash;30 min</button>
        <button class="tb-chip" data-dur="l">Over 30 min</button>
      </div>
      <label class="tb-toggle"><input type="checkbox" id="tb-subs"><span>Subtitled only</span></label>
      <span class="tb-count" id="tb-count">${loose.length} video${loose.length !== 1 ? 's' : ''}</span>
    </div>
  </div>
  <div class="grid" id="sch-grid">${loose.map(v => vcard(v, { anim: true, data: true })).join('')}</div>
  <p class="emp" id="sch-empty" style="display:none">No videos match the selected filters.</p>
  <script>${CATALOG_JS}</script>
  <script>initCatalog({grid:'sch-grid',count:'tb-count',empty:'sch-empty',sort:'sp-sort',dur:'tb-dur',subs:'tb-subs'});</script>
  ` : playlists.length ? '' : '<p class="emp">No videos yet.</p>'}
</div>`;
}
