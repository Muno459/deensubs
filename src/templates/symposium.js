import { e, ft, thu } from '../lib/helpers.js';
import { tsvg } from '../components/thumbnail.js';

export function renderSymposium({ videos }) {
  const totalMin = Math.round(videos.reduce((a, v) => a + (v.duration || 0), 0) / 60);
  const hrs = totalMin >= 60 ? `${Math.floor(totalMin / 60)}h ${totalMin % 60}m` : `${totalMin} min`;
  const speakers = [...new Set(videos.map(v => v.source).filter(Boolean))];
  return `
<div class="sy">
  <header class="sy-hero">
    <p class="sy-over">Scholarly Symposium</p>
    <h1 class="sy-ar">الفتوى في الحرمين الشريفين على ضوء المنهج النبوي</h1>
    <p class="sy-en">Fatwa in the Two Holy Mosques, in Light of the Prophetic Methodology</p>
    <p class="sy-lede">Selected highlights from a symposium on the principles and practice of fatwa in the Two Holy Mosques — featuring members of the Council of Senior Scholars and imams of the Haramain, translated with accurate English subtitles.</p>
    <p class="sy-meta">${videos.length} session${videos.length !== 1 ? 's' : ''} &middot; ${hrs} &middot; ${speakers.length} scholar${speakers.length !== 1 ? 's' : ''}</p>
  </header>

  <ol class="sy-list">
    ${videos.map((v, i) => {
      const th = thu(v);
      return `<li class="sy-item card-anim">
      <a href="/watch/${e(v.slug)}" class="sy-row">
        <span class="sy-n">${String(i + 1).padStart(2, '0')}</span>
        <div class="sy-th"${th ? ` data-bg="${e(th)}"` : ''}>
          ${!th ? tsvg(v.title, '#0e6b63', 240, 135) : ''}
          <div class="sy-play"><svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M8 5v14l11-7z"/></svg></div>
        </div>
        <div class="sy-info">
          ${v.title_ar ? `<div class="sy-item-ar">${e(v.title_ar)}</div>` : ''}
          <h2>${e(v.title)}</h2>
          ${v.description ? `<p class="sy-item-desc">${e(v.description)}</p>` : ''}
          <p class="sy-item-meta">${e(v.source || '')}${v.duration ? ` &middot; ${ft(v.duration)}` : ''}${v.srt_key ? ' &middot; English subtitles' : ' &middot; Subtitles coming soon'}</p>
        </div>
      </a>
    </li>`;
    }).join('')}
  </ol>

  <p class="sy-note">The Two Holy Mosques — Masjid al-Haram in Makkah and Masjid an-Nabawi in Madinah — hold the highest station in Islam, and a fatwa issued within them carries weight across the entire Muslim world. These sessions examine how that responsibility is met: the qualifications required of the mufti, the controls that govern issuing rulings, and the methodology that traces every verdict back to the Prophet ﷺ and his Companions.</p>

  <figure class="sy-ayah">
    <p class="sy-ayah-ar">يُرِيدُ ٱللَّهُ بِكُمُ ٱلْيُسْرَ وَلَا يُرِيدُ بِكُمُ ٱلْعُسْرَ</p>
    <figcaption>&ldquo;Allah intends ease for you and does not intend hardship for you.&rdquo; &mdash; Al-Baqarah 2:185</figcaption>
  </figure>
</div>`;
}
