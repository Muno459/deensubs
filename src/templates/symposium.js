import { e, ft, thu } from '../lib/helpers.js';
import { tsvg } from '../components/thumbnail.js';

// Symposium is DISABLED but code is kept
export function renderSymposium({ videos }) {
  const totalMin = Math.round(videos.reduce((a,v)=>a+v.duration,0)/60);
  const subbed = videos.filter(v=>v.srt_key).length;
  return `
<div class="sy">
  <!-- Hero -->
  <div class="sy-hero">
    <div class="sy-bg">
      <svg viewBox="0 0 800 400" fill="none" class="sy-geo">
        <circle cx="400" cy="200" r="180" stroke="rgba(164,132,76,.06)" stroke-width=".8"/>
        <circle cx="400" cy="200" r="150" stroke="rgba(164,132,76,.04)" stroke-width=".5" stroke-dasharray="4 6"/>
        <rect x="300" y="100" width="200" height="200" stroke="rgba(164,132,76,.07)" stroke-width=".7" transform="rotate(45 400 200)"/>
        <rect x="300" y="100" width="200" height="200" stroke="rgba(164,132,76,.07)" stroke-width=".7"/>
        <rect x="330" y="130" width="140" height="140" stroke="rgba(164,132,76,.05)" stroke-width=".6" transform="rotate(45 400 200)"/>
        <rect x="330" y="130" width="140" height="140" stroke="rgba(164,132,76,.05)" stroke-width=".6"/>
        <circle cx="400" cy="200" r="30" stroke="rgba(164,132,76,.06)" stroke-width=".6"/>
        <circle cx="400" cy="200" r="10" fill="rgba(164,132,76,.04)"/>
        <line x1="400" y1="20" x2="400" y2="380" stroke="rgba(164,132,76,.025)" stroke-width=".5"/>
        <line x1="220" y1="200" x2="580" y2="200" stroke="rgba(164,132,76,.025)" stroke-width=".5"/>
      </svg>
    </div>
    <div class="sy-hero-content">
      <div class="sy-badge"><span class="sy-badge-dot"></span>Symposium Highlights</div>
      <div class="sy-ornament">&#10052;</div>
      <h1 class="sy-title-ar">الفتوى في الحرمين الشريفين<br>على ضوء المنهج النبوي</h1>
      <div class="sy-divider"><span></span><svg viewBox="0 0 24 24" fill="none" width="16" height="16"><rect x="5" y="5" width="14" height="14" stroke="rgba(164,132,76,.4)" stroke-width="1" transform="rotate(45 12 12)"/></svg><span></span></div>
      <h2 class="sy-title-en">Fatwa in the Two Holy Mosques<br>in Light of the Prophetic Methodology</h2>
      <p class="sy-desc">Key highlights from a scholarly symposium featuring senior scholars on the principles, methodology, and application of fatwa in the Two Holy Mosques. Each clip is carefully selected and translated for maximum clarity and accessibility — bringing the essence of each scholar's contribution to an English-speaking audience.</p>
    </div>
  </div>

  <!-- Stats -->
  <div class="sy-stats">
    <div class="sy-stat">
      <div class="sy-stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="22" height="22"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg></div>
      <div class="sy-stat-val">${videos.length}</div>
      <div class="sy-stat-lbl">Clips</div>
    </div>
    <div class="sy-stat">
      <div class="sy-stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="22" height="22"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
      <div class="sy-stat-val">${totalMin}</div>
      <div class="sy-stat-lbl">Minutes</div>
    </div>
    <div class="sy-stat">
      <div class="sy-stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="22" height="22"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg></div>
      <div class="sy-stat-val">${videos.length}</div>
      <div class="sy-stat-lbl">Scholars</div>
    </div>
    <div class="sy-stat">
      <div class="sy-stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="22" height="22"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg></div>
      <div class="sy-stat-val">${subbed}/${videos.length}</div>
      <div class="sy-stat-lbl">Subtitled</div>
    </div>
  </div>

  <!-- About -->
  <div class="sy-about">
    <div class="sy-sec-hd"><div class="sy-sec-line"></div><h3>About This Symposium</h3><div class="sy-sec-line"></div></div>
    <div class="sy-about-grid">
      <div class="sy-about-card">
        <div class="sy-about-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="24" height="24"><path d="M3 7l7-5 7 5v8a1 1 0 01-1 1H4a1 1 0 01-1-1V7z"/><path d="M8 16V10h4v6"/></svg></div>
        <h4>The Two Holy Mosques</h4>
        <p>Masjid al-Haram in Makkah and Masjid an-Nabawi in Madinah hold the highest status in Islam. This symposium examines how fatwa serves to preserve and uphold their sacred mission.</p>
      </div>
      <div class="sy-about-card">
        <div class="sy-about-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="24" height="24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></div>
        <h4>Prophetic Methodology</h4>
        <p>Every session traces the chain of fatwa methodology back to the Prophet and his Companions, ensuring religious rulings remain grounded in authentic sources and scholarly consensus.</p>
      </div>
      <div class="sy-about-card">
        <div class="sy-about-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="24" height="24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg></div>
        <h4>Senior Scholars</h4>
        <p>Featuring members of the Council of Senior Scholars, imams of the Haramain, and leading academics — each bringing decades of specialized knowledge in Islamic jurisprudence.</p>
      </div>
    </div>
  </div>

  <!-- Sessions -->
  <div class="sy-sessions">
    <div class="sy-sec-hd"><div class="sy-sec-line"></div><h3>Highlights</h3><div class="sy-sec-line"></div></div>

    <div class="sy-timeline">
      ${videos.map((v,i) => {
        const th = thu(v);
        return `<a href="/watch/${e(v.slug)}" class="sy-card card-anim">
        <div class="sy-card-num"><span>${String(i+1).padStart(2,'0')}</span></div>
        <div class="sy-card-main">
          <div class="sy-card-th"${th?` data-bg="${e(th)}"`:''}>
            ${!th?tsvg(v.title,'#a4844c',240,135):''}
            <div class="sy-card-play"><svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M8 5v14l11-7z"/></svg></div>
            ${v.duration?`<span class="dur">${ft(v.duration)}</span>`:''}
          </div>
          <div class="sy-card-info">
            ${v.title_ar?`<div class="sy-card-ar">${e(v.title_ar)}</div>`:''}
            <h4>${e(v.title)}</h4>
            <div class="sy-card-speaker"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>${e(v.source||'')}</div>
            ${v.description?`<p class="sy-card-desc">${e(v.description)}</p>`:''}
            <div class="sy-card-foot">
              <div class="sy-card-tags">
                ${v.srt_key?'<span class="sy-tag sy-tag-en">English</span>':''}
                ${v.srt_ar_key?'<span class="sy-tag sy-tag-ar">العربية</span>':''}
                ${!v.srt_key?'<span class="sy-tag sy-tag-pending">Pending</span>':''}
              </div>
              <span class="sy-card-dur">${ft(v.duration)}</span>
            </div>
          </div>
        </div>
      </a>`;
      }).join('')}
    </div>
  </div>

  <!-- Scholars -->
  <div class="sy-scholars">
    <div class="sy-sec-hd"><div class="sy-sec-line"></div><h3>Featured Scholars</h3><div class="sy-sec-line"></div></div>
    <div class="sy-scholars-grid">
      ${videos.map(v => `<div class="sy-scholar">
        <div class="sy-scholar-av">${(v.source||'').split(' ').pop().charAt(0)}</div>
        <div class="sy-scholar-name">${e(v.source||'')}</div>
      </div>`).join('')}
    </div>
  </div>

  <!-- Footer quote -->
  <div class="sy-quote">
    <div class="sy-quote-mark">"</div>
    <p class="sy-quote-ar">يُرِيدُ ٱللَّهُ بِكُمُ ٱلْيُسْرَ وَلَا يُرِيدُ بِكُمُ ٱلْعُسْرَ</p>
    <p class="sy-quote-en">"Allah intends ease for you and does not intend hardship for you."</p>
    <p class="sy-quote-ref">— Surah Al-Baqarah, 2:185</p>
  </div>
</div>`;
}
