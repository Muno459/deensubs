import { e, fv, ft, cdn, schImg } from '../lib/helpers.js';
import { vcard } from '../components/video-card.js';

export function renderScholars({ scholars }) {
  return `
<div class="sch-page">
  <div class="sch-hero">
    <div class="sch-hero-ornament"><svg viewBox="0 0 200 200" fill="none" width="80"><rect x="50" y="50" width="100" height="100" stroke="rgba(164,132,76,.1)" stroke-width="1" transform="rotate(45 100 100)"/><rect x="50" y="50" width="100" height="100" stroke="rgba(164,132,76,.1)" stroke-width="1"/><circle cx="100" cy="100" r="20" stroke="rgba(164,132,76,.06)" stroke-width="1"/></svg></div>
    <h1>Our Scholars</h1>
    <p>The scholars whose knowledge we make accessible to the English-speaking world.</p>
  </div>
  <div class="sch-grid">
    ${scholars.map(s => `<a href="/scholar/${e(s.slug)}" class="sch-card card-anim">
      <div class="sch-card-img">
        ${s.photo ? `<img src="${schImg(s.photo)}" alt="${e(s.name)}" loading="lazy" decoding="async">` : `<div class="sch-card-initial">${e(s.name).split(' ').pop().charAt(0)}</div>`}
        <div class="sch-card-gradient"></div>
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

export function renderScholar({ scholar, videos }) {
  const hasHero = !!scholar.photo_hero;
  const hasPhoto = !!scholar.photo;
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
    <div class="sp-hero-bg">
      <svg viewBox="0 0 600 300" fill="none" class="sp-hero-geo">
        <circle cx="300" cy="150" r="140" stroke="rgba(164,132,76,.05)" stroke-width=".7"/>
        <rect x="210" y="60" width="180" height="180" stroke="rgba(164,132,76,.06)" stroke-width=".6" transform="rotate(45 300 150)"/>
        <rect x="210" y="60" width="180" height="180" stroke="rgba(164,132,76,.06)" stroke-width=".6"/>
        <circle cx="300" cy="150" r="50" stroke="rgba(164,132,76,.04)" stroke-width=".5"/>
      </svg>
    </div>
    ${hasHero ? `<div class="sp-hero-portrait"><img src="${schImg(scholar.photo_hero)}" alt="${e(scholar.name)}" fetchpriority="high"></div>` : ''}
    ${!hasHero && hasPhoto ? `<div class="sp-hero-av-large"><img src="${schImg(scholar.photo)}" alt="${e(scholar.name)}" fetchpriority="high"></div>` : ''}
    ${!hasHero && !hasPhoto ? `<div class="sp-hero-av-large"><div class="sp-hero-initial">${e(scholar.name).split(' ').pop().charAt(0)}</div></div>` : ''}
    <div class="sp-hero-content${hasHero ? ' sp-hero-offset' : ''}">
      <h1 class="sp-hero-name">${e(scholar.name)}</h1>
      ${scholar.title ? `<div class="sp-hero-title">${e(scholar.title)}</div>` : ''}
      ${scholar.bio ? `<p class="sp-hero-bio">${e(scholar.bio)}</p>` : ''}
      <div class="sp-hero-stats">
        <div class="sp-stat"><span>${videos.length}</span>Videos</div>
        <div class="sp-stat"><span>${videos.reduce((a, v) => a + (v.views || 0), 0)}</span>Views</div>
        <div class="sp-stat"><span>${Math.round(videos.reduce((a, v) => a + (v.duration || 0), 0) / 60)}</span>Minutes</div>
        <div class="sp-stat"><span>${videos.filter(v => v.srt_key).length}</span>Subtitled</div>
      </div>
      <button class="sp-share" id="sp-share" title="Share"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> Share</button>
      <script>document.getElementById('sp-share').onclick=function(){if(navigator.share)navigator.share({title:'${e(scholar.name)} — DeenSubs',url:location.href}).catch(function(){});else{navigator.clipboard.writeText(location.href).then(function(){var t=document.getElementById('toast');if(!t){t=document.createElement('div');t.id='toast';t.className='toast';document.body.appendChild(t)}t.textContent='Link copied';t.classList.add('show');setTimeout(function(){t.classList.remove('show')},2500)}).catch(function(){})}}</script>
    </div>
  </div>

  <div class="sec">
    <div class="sec-hd"><h2>Videos by ${e(scholar.name)}</h2><span class="cat-hero-count">${videos.length} video${videos.length!==1?'s':''}</span></div>
    <div class="sort-btns" id="sch-sort" style="margin-bottom:.75rem">
      <button class="sb sb-on" data-sort="newest">Newest</button>
      <button class="sb" data-sort="popular">Popular</button>
      <button class="sb" data-sort="longest">Longest</button>
    </div>
    <div class="grid" id="sch-grid">${videos.map(v => vcard(v, { anim: true })).join('')}</div>
  </div>
  <script>
  (function(){
    var grid=document.getElementById('sch-grid'),sort=document.getElementById('sch-sort');
    if(!grid||!sort)return;
    var cards=Array.from(grid.children);
    sort.onclick=function(ev){
      var b=ev.target.closest('.sb');if(!b)return;
      sort.querySelectorAll('.sb').forEach(function(s){s.classList.remove('sb-on')});b.classList.add('sb-on');
      var s=b.dataset.sort;
      cards.sort(function(a,c){
        if(s==='popular'){var va=parseInt(a.querySelector('.card-mt').textContent.match(/([\\d,.]+[KM]?)\\s*views/)?.[1]?.replace(/,/g,'')||'0');var vc=parseInt(c.querySelector('.card-mt').textContent.match(/([\\d,.]+[KM]?)\\s*views/)?.[1]?.replace(/,/g,'')||'0');return vc-va}
        if(s==='longest'){var da=a.querySelector('.dur');var dc=c.querySelector('.dur');return(dc?dc.textContent:'').localeCompare(da?da.textContent:'')}
        return 0;
      });
      if(s==='newest')cards.sort(function(){return 0}); // original order is newest
      cards.forEach(function(c){grid.appendChild(c)});
    };
  })();
  </script>
</div>`;
}
