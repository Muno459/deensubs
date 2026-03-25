import { e, fv, ft, cdn } from '../lib/helpers.js';
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
        ${s.photo ? `<img src="${cdn(s.photo)}" alt="${e(s.name)}">` : `<div class="sch-card-initial">${e(s.name).split(' ').pop().charAt(0)}</div>`}
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
  return `
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
    ${hasHero ? `<div class="sp-hero-portrait"><img src="${cdn(scholar.photo_hero)}" alt="${e(scholar.name)}"></div>` : ''}
    ${!hasHero && hasPhoto ? `<div class="sp-hero-av-large"><img src="${cdn(scholar.photo)}" alt="${e(scholar.name)}"></div>` : ''}
    ${!hasHero && !hasPhoto ? `<div class="sp-hero-av-large"><div class="sp-hero-initial">${e(scholar.name).split(' ').pop().charAt(0)}</div></div>` : ''}
    <div class="sp-hero-content${hasHero ? ' sp-hero-offset' : ''}">
      <h1 class="sp-hero-name">${e(scholar.name)}</h1>
      ${scholar.title ? `<div class="sp-hero-title">${e(scholar.title)}</div>` : ''}
      ${scholar.bio ? `<p class="sp-hero-bio">${e(scholar.bio)}</p>` : ''}
      <div class="sp-hero-stats">
        <div class="sp-stat"><span>${videos.length}</span>Videos</div>
        <div class="sp-stat"><span>${videos.reduce((a, v) => a + (v.views || 0), 0)}</span>Views</div>
        <div class="sp-stat"><span>${videos.filter(v => v.srt_key).length}</span>Subtitled</div>
      </div>
    </div>
  </div>

  <div class="sec">
    <div class="sec-hd"><h2>Videos by ${e(scholar.name)}</h2></div>
    <div class="grid">${videos.map(v => vcard(v, { anim: true })).join('')}</div>
  </div>
</div>`;
}
