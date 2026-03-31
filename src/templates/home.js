import { e, fv, ft, thu, thuSrcset, ago, cdn, schImg, schImgSm, isNew } from '../lib/helpers.js';
import { tsvg } from '../components/thumbnail.js';
import { vcard, section } from '../components/video-card.js';
import HOME_JS from '../scripts/home.min.txt';

export function renderHome({ featured, videos, popular, categories, byCategory, scholars }) {
  const catsWithContent = categories.filter(c => byCategory[c.slug]?.length);
  const newThisWeek = videos.filter(v => isNew(v.created_at)).length;
  return `
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"DeenSubs","url":"https://deensubs.com","potentialAction":{"@type":"SearchAction","target":"https://deensubs.com/search?q={search_term_string}","query-input":"required name=search_term_string"}}</script>
<div id="cw-slot"></div>

${featured ? `
<section class="hero">
  <a href="/watch/${e(featured.slug)}" class="hero-card">
    <div class="hero-th">
      ${thu(featured) ? `<img src="${e(thu(featured))}" ${thuSrcset(featured) ? `srcset="${thuSrcset(featured)}" sizes="(max-width:768px) 100vw, 640px"` : ''} alt="${e(featured.title)}" class="hero-img" width="640" height="360" fetchpriority="high">` : tsvg(featured.title, featured.category_color || '#c4a44c', 900, 506)}
      <div class="hero-ov">
        <div class="hero-pb"></div>
        <div class="hero-meta-ov">
          ${featured.source ? `<span class="hero-badge">${e(featured.source)}</span>` : ''}
          ${featured.duration ? `<span class="dur hero-dur">${ft(featured.duration)}</span>` : ''}
        </div>
      </div>
    </div>
    <div class="hero-info">
      <h1>${e(featured.title)}</h1>
      ${featured.description ? `<p class="hero-desc">${e(featured.description)}</p>` : ''}
      <div class="hero-mt">
        ${featured.category_name ? `<span class="tag" style="--tc:${e(featured.category_color || '#c4a44c')}">${e(featured.category_name)}</span>` : ''}
        <span class="tag tag-s">AR &rarr; EN</span>
        <span>${fv(featured.views)}</span>
        <span>${ago(featured.created_at)}</span>
      </div>
    </div>
  </a>
</section>` : ''}

${scholars && scholars.length ? `
<section class="home-scholars">
  <div class="sec-hd"><h2>Scholars</h2><a href="/scholars" class="sec-more">View all &rarr;</a></div>
  <div class="hscroll">
    ${scholars.map((s, i) => `<a href="/scholar/${e(s.slug)}" class="home-sch-card">
      <div class="home-sch-av">${s.photo ? `<img src="${schImgSm(s.photo)}" width="52" height="52" alt=""${i === 0 ? ' fetchpriority="high"' : ' loading="lazy"'}>` : e(s.name).split(' ').pop().charAt(0)}</div>
      <span class="home-sch-name">${e(s.name.split(' ').slice(-2).join(' '))}</span>
    </a>`).join('')}
  </div>
</section>` : ''}

${popular.length > 1 ? `<script type="application/ld+json">${JSON.stringify({'@context':'https://schema.org','@type':'ItemList',name:'Popular Videos',itemListElement:popular.slice(0,8).map((v,i)=>({'@type':'ListItem',position:i+1,url:'https://deensubs.com/watch/'+v.slug,name:v.title}))})}</script>` + section('Popular', '', popular, { scroll: true, eager: true }) : ''}

${catsWithContent.map(c => {
  const cv = byCategory[c.slug];
  return section(c.name, '', cv.slice(0, 6), { link: '/category/' + c.slug });
}).join('')}

${videos.length ? `<section class="sec">
<div class="sec-hd"><h2>Latest Videos</h2>${newThisWeek ? `<span class="sec-new">${newThisWeek} new this week</span>` : ''}<a href="/search" class="sec-more">View all &rarr;</a></div>
<div class="grid">${videos.slice(0, 12).map((v, i) => vcard(v, { anim: true })).join('')}</div></section>` : ''}

<script>${HOME_JS}</script>`;
}
