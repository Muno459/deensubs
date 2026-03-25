import { e } from '../lib/helpers.js';

export function renderAbout({ stats }) {
  return `
<div class="about-page">
  <div class="about-hero">
    <svg class="about-geo" viewBox="0 0 200 200" fill="none" width="100" height="100"><rect x="40" y="40" width="120" height="120" stroke="rgba(196,164,76,.15)" stroke-width="1" transform="rotate(45 100 100)"/><rect x="40" y="40" width="120" height="120" stroke="rgba(196,164,76,.15)" stroke-width="1"/><circle cx="100" cy="100" r="25" stroke="rgba(196,164,76,.1)" stroke-width="1"/><circle cx="100" cy="100" r="8" fill="rgba(196,164,76,.08)"/></svg>
    <h1>About <span>DeenSubs</span></h1>
    <p class="about-lead">Bridging the language gap between Arabic Islamic scholarship and English-speaking communities worldwide.</p>
  </div>
  <div class="about-grid">
    <div class="about-card">
      <h3>Mission</h3>
      <p>DeenSubs makes the words of Islamic scholars accessible to everyone. We use cutting-edge AI to transcribe Arabic lectures and translate them into English, preserving the depth and beauty of the original content.</p>
    </div>
    <div class="about-card">
      <h3>Technology</h3>
      <p>Powered by ElevenLabs Scribe v2 for Arabic speech recognition and AI for translation. Deployed on Cloudflare's global edge network for fast, reliable access from anywhere in the world.</p>
    </div>
    <div class="about-card">
      <h3>Content</h3>
      <p>We source content from trusted scholars and masajid including Masjid al-Haram and Masjid an-Nabawi. Every subtitle is reviewed for accuracy in both language and Islamic terminology.</p>
    </div>
  </div>
  ${stats ? `<div class="about-stats">
    <div class="about-stat"><span class="about-stat-n">${stats.count || 0}</span><span class="about-stat-l">Videos</span></div>
    <div class="about-stat"><span class="about-stat-n">${stats.views || 0}</span><span class="about-stat-l">Total Views</span></div>
    <div class="about-stat"><span class="about-stat-n">7</span><span class="about-stat-l">Categories</span></div>
  </div>` : ''}
  <div class="about-ayah">
    <p class="about-ayah-ar">وَمَا أَرْسَلْنَاكَ إِلَّا رَحْمَةً لِّلْعَالَمِينَ</p>
    <p class="about-ayah-en">"And We have not sent you except as a mercy to the worlds." — Quran 21:107</p>
  </div>
</div>`;
}
