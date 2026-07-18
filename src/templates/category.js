import { e, fv, ft, thu } from '../lib/helpers.js';
import { vcard } from '../components/video-card.js';
import { tsvg } from '../components/thumbnail.js';
import CATALOG_JS from '../scripts/catalog.min.txt';

/*
 * Per-category identity. `mode` drives what the page leads with:
 *   study  — disciplines learned in order: lead with a "Start here" pick
 *            (most-watched subtitled video) so newcomers have an entry point
 *   timely — recurring content (sermons): lead with the latest upload
 *   short  — bite-size content: lead with a "quick picks" row of clips ≤10 min
 *   (none) — just the catalog
 */
const CATEGORY_META = {
  aqeedah: { mode: 'study', desc: 'Islamic creed and theology — Tawheed, belief in Allah, and foundations of faith.', start: 'New to the science of creed? Begin with the most-watched foundation.' },
  fiqh: { mode: 'study', desc: 'Islamic jurisprudence — rulings on prayer, transactions, worship, and daily life.', start: 'Fiqh builds on fundamentals. This is the most-watched place to begin.' },
  hadith: { mode: 'study', desc: 'Studies and discussions of Prophetic traditions and their narrators.', start: 'Start with the most-watched study before the detailed commentaries.' },
  tafsir: { mode: 'study', desc: 'Quranic commentary and explanation — understanding the Book of Allah.', start: 'Begin your journey through the Quran with the most-watched explanation.' },
  seerah: { mode: 'study', desc: 'The life and biography of the Prophet Muhammad ﷺ and his Companions.', start: 'The story is best from the beginning — start with the most-watched session.' },
  khutbah: { mode: 'timely', desc: 'Friday sermons (Jumuah Khutbahs) delivered at major mosques by senior scholars.', start: 'The most recent sermon, fresh from the minbar.' },
  reminder: { mode: 'short', desc: 'Short reminders and spiritual advice to strengthen faith and practice.' },
  lecture: { desc: 'In-depth lectures and talks on various Islamic topics by trusted scholars.' },
};

function featCard(v, kicker, note) {
  const th = thu(v);
  return `<a href="/watch/${e(v.slug)}" class="cat-feat card-anim">
  <div class="cat-feat-th"${th ? ` data-bg="${e(th)}"` : ''}>
    ${!th ? tsvg(v.title, v.category_color || '#0e6b63', 480, 270) : ''}
    <div class="cat-feat-play"><svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M8 5v14l11-7z"/></svg></div>
    ${v.duration ? `<span class="dur">${ft(v.duration)}</span>` : ''}
  </div>
  <div class="cat-feat-info">
    <span class="cat-feat-k">${kicker}</span>
    <h2>${e(v.title)}</h2>
    ${v.description ? `<p class="cat-feat-desc">${e(v.description)}</p>` : ''}
    <p class="cat-feat-meta">${v.source ? e(v.source) + ' &middot; ' : ''}${fv(v.views)}${v.srt_key ? ' &middot; English subtitles' : ''}</p>
    ${note ? `<p class="cat-feat-note">${note}</p>` : ''}
  </div>
</a>`;
}

export function renderCategory({ category, videos, sort }) {
  const meta = CATEGORY_META[category.slug] || {};
  const desc = meta.desc || '';
  const pc = category.color || '#0e6b63';
  const totalMin = Math.round(videos.reduce((a, v) => a + (v.duration || 0), 0) / 60);
  const subtitled = videos.filter(v => v.srt_key).length;
  const hrs = totalMin >= 60 ? `${Math.floor(totalMin / 60)}h ${totalMin % 60}m` : `${totalMin} min`;
  const scholarCounts = {};
  videos.forEach(v => { const s = v.source || 'Other'; scholarCounts[s] = (scholarCounts[s] || 0) + 1; });
  const scholarList = Object.entries(scholarCounts).sort((a, b) => b[1] - a[1]);

  // Lead module per mode
  let lead = '';
  if (videos.length >= 3 && meta.mode === 'study') {
    const pick = [...videos].filter(v => v.srt_key).sort((a, b) => (b.views || 0) - (a.views || 0))[0]
      || [...videos].sort((a, b) => (b.views || 0) - (a.views || 0))[0];
    lead = featCard(pick, 'Start here', meta.start);
  } else if (videos.length >= 3 && meta.mode === 'timely') {
    const latest = [...videos].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    lead = featCard(latest, 'Latest khutbah', meta.start);
  } else if (meta.mode === 'short') {
    const quick = videos.filter(v => v.duration && v.duration <= 600).slice(0, 8);
    if (quick.length >= 2) lead = `<section class="sec"><div class="sec-hd"><h2>Quick picks &middot; under 10 minutes</h2></div><div class="hscroll">${quick.map(v => vcard(v, { anim: true })).join('')}</div></section>`;
  }

  const popular = videos.length >= 5 ? [...videos].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 6) : [];
  const breadcrumb = JSON.stringify({'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:[
    {'@type':'ListItem',position:1,name:'Home',item:'https://deensubs.com/'},
    {'@type':'ListItem',position:2,name:category.name},
  ]});
  return `
<script type="application/ld+json">${breadcrumb}</script>
<section class="cat-page" style="--pc:${e(pc)}">
  <header class="cat-hero">
    <div class="cat-hero-txt">
      <h1 class="page-title">${e(category.name)}</h1>
      ${desc ? `<p class="page-desc">${desc}</p>` : ''}
      <p class="cat-hero-meta">${videos.length} video${videos.length !== 1 ? 's' : ''} <i></i> ${hrs}${subtitled ? ` <i></i> ${subtitled} subtitled` : ''}${scholarList.length > 1 ? ` <i></i> ${scholarList.length} scholars` : ''}</p>
    </div>
    ${category.name_ar ? `<span class="cat-hero-ar" aria-hidden="true">${e(category.name_ar)}</span>` : ''}
  </header>

  ${lead}

  ${popular.length ? `<section class="sec"><div class="sec-hd"><h2>Popular in ${e(category.name)}</h2></div><div class="hscroll">${popular.map(v => vcard(v, { anim: true })).join('')}</div></section>` : ''}

  ${videos.length ? `
  <div class="toolbar">
    <div class="tb-row">
      ${scholarList.length > 1 ? `<div class="tb-chips" id="tb-scholars"><button class="tb-chip tb-chip-on" data-scholar="">All scholars</button>${scholarList.map(([s, n]) => `<button class="tb-chip" data-scholar="${e(s)}">${e(s)}<span class="tb-n">${n}</span></button>`).join('')}</div>` : ''}
      <div class="tb-seg">
        <a href="?sort=newest" class="${sort !== 'popular' ? 'tb-seg-on' : ''}">Newest</a>
        <a href="?sort=popular" class="${sort === 'popular' ? 'tb-seg-on' : ''}">Popular</a>
      </div>
    </div>
    <div class="tb-row">
      <div class="tb-chips" id="tb-dur">
        <button class="tb-chip tb-chip-on" data-dur="">Any length</button>
        <button class="tb-chip" data-dur="s">Under 10 min</button>
        <button class="tb-chip" data-dur="m">10&ndash;30 min</button>
        <button class="tb-chip" data-dur="l">Over 30 min</button>
      </div>
      <label class="tb-toggle"><input type="checkbox" id="tb-subs"><span>Subtitled only</span></label>
      <span class="tb-count" id="tb-count">${videos.length} video${videos.length !== 1 ? 's' : ''}</span>
    </div>
  </div>
  <div class="grid" id="cat-grid">${videos.map(v => vcard(v, { anim: true, data: true })).join('')}</div>
  <p class="emp" id="cat-empty" style="display:none">No videos match the selected filters.</p>
  <script>${CATALOG_JS}</script>
  <script>initCatalog({grid:'cat-grid',count:'tb-count',empty:'cat-empty',scholars:'tb-scholars',dur:'tb-dur',subs:'tb-subs'});</script>
  ` : '<p class="emp">No videos in this category yet.</p>'}
</section>`;
}
