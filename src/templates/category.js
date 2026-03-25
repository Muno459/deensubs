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

export function renderCategory({ category, videos, sort }) {
  const desc = CATEGORY_DESCRIPTIONS[category.slug] || '';
  return `
<section class="cat-page">
  <div class="cat-hero">
    <div class="cat-hero-top">
      <div>
        <span class="cat-hero-ar">${e(category.name_ar)}</span>
        <h1 class="cat-hero-title">${e(category.name)}</h1>
        ${desc ? `<p class="cat-hero-desc">${desc}</p>` : ''}
      </div>
      <div class="cat-hero-right">
        <span class="cat-hero-count">${videos.length} video${videos.length !== 1 ? 's' : ''}</span>
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
