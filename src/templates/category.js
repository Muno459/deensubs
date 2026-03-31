import { e } from '../lib/helpers.js';
import { vcard } from '../components/video-card.js';

const CATEGORY_DESCRIPTIONS = {
  khutbah: 'Friday sermons (Jumuah Khutbahs) delivered at major mosques by senior scholars.',
  lecture: 'In-depth lectures and talks on various Islamic topics by trusted scholars.',
  tafsir: 'Quranic commentary and explanation — understanding the Book of Allah.',
  hadith: 'Studies and discussions of Prophetic traditions and their narrators.',
  fiqh: 'Islamic jurisprudence — rulings on prayer, transactions, worship, and daily life.',
  seerah: "The life and biography of the Prophet Muhammad \uFDFA and his Companions.",
  reminder: 'Short reminders and spiritual advice to strengthen faith and practice.',
  aqeedah: 'Islamic creed and theology — Tawheed, belief in Allah, and foundations of faith.',
};
const CATEGORY_ICONS = {
  khutbah: '<path d="M3 7l7-5 7 5v8a1 1 0 01-1 1H4a1 1 0 01-1-1V7z"/><path d="M8 16V10h4v6"/>',
  lecture: '<path d="M12 14l9-5-9-5-9 5 9 5z"/><path d="M12 14v7"/><path d="M3 9v5a9 9 0 006 0"/>',
  tafsir: '<path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>',
  hadith: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
  fiqh: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  seerah: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>',
  reminder: '<path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>',
  aqeedah: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
};

export function renderCategory({ category, videos, sort }) {
  const desc = CATEGORY_DESCRIPTIONS[category.slug] || '';
  const totalMin = Math.round(videos.reduce((a, v) => a + (v.duration || 0), 0) / 60);
  const subtitled = videos.filter(v => v.srt_key).length;
  const breadcrumb = JSON.stringify({'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:[
    {'@type':'ListItem',position:1,name:'Home',item:'https://deensubs.com/'},
    {'@type':'ListItem',position:2,name:category.name},
  ]});
  return `
<script type="application/ld+json">${breadcrumb}</script>
<section class="cat-page">
  <div class="cat-hero">
    <div class="cat-hero-top">
      <div>
        <h1 class="cat-hero-title">${CATEGORY_ICONS[category.slug]?`<svg viewBox="0 0 24 24" fill="none" stroke="${e(category.color)}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="28" height="28" style="vertical-align:middle;margin-right:.4rem;opacity:.6">${CATEGORY_ICONS[category.slug]}</svg>`:''}${e(category.name)}</h1>
        ${desc ? `<p class="cat-hero-desc">${desc}</p>` : ''}
      </div>
      <div class="cat-hero-right">
        <span class="cat-hero-count">${videos.length} video${videos.length !== 1 ? 's' : ''} &middot; ${totalMin} min &middot; ${subtitled} subtitled</span>
        <div class="sort-btns">
          <a href="?sort=newest" class="sb${sort !== 'popular' ? ' sb-on' : ''}">Newest</a>
          <a href="?sort=popular" class="sb${sort === 'popular' ? ' sb-on' : ''}">Popular</a>
        </div>
      </div>
    </div>
  </div>
  <div class="grid">${videos.length ? videos.map(v => vcard(v, { anim: true })).join('') : '<p class="emp">No videos in this category yet.</p>'}</div>
</section>`;
}
