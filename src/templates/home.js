import { e, fv, ft, thu, ago, cdn } from '../lib/helpers.js';
import { tsvg } from '../components/thumbnail.js';
import { vcard, section } from '../components/video-card.js';
import HOME_JS from '../scripts/home.txt';

export function renderHome({ featured, videos, popular, categories, byCategory, scholars }) {
  const catsWithContent = categories.filter(c => byCategory[c.slug]?.length);
  return `
<div id="cw-slot"></div>

${featured ? `
<section class="hero">
  <a href="/watch/${e(featured.slug)}" class="hero-card">
    <div class="hero-th"${thu(featured) ? ` style="background-image:url('${e(thu(featured))}')"` : ''}>
      ${!thu(featured) ? tsvg(featured.title, featured.category_color || '#c4a44c', 900, 506) : ''}
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
    ${scholars.map(s => `<a href="/scholar/${e(s.slug)}" class="home-sch-card">
      <div class="home-sch-av">${s.photo ? `<img src="${cdn(s.photo)}" alt="">` : e(s.name).split(' ').pop().charAt(0)}</div>
      <span class="home-sch-name">${e(s.name.split(' ').slice(-2).join(' '))}</span>
    </a>`).join('')}
  </div>
</section>` : ''}

${popular.length > 1 ? section('Popular', '', popular, { scroll: true }) : ''}

${catsWithContent.map(c => {
  const cv = byCategory[c.slug];
  return section(c.name, '', cv.slice(0, 6), { link: '/category/' + c.slug });
}).join('')}

${section('All Videos', '', videos)}

<script>${HOME_JS}</script>`;
}
