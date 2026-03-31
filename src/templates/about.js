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
    <div class="about-stat"><span class="about-stat-n">${stats.subtitled || 0}</span><span class="about-stat-l">Subtitled</span></div>
    <div class="about-stat"><span class="about-stat-n">${stats.scholars || 0}</span><span class="about-stat-l">Scholars</span></div>
    <div class="about-stat"><span class="about-stat-n">${stats.hours || 0}h</span><span class="about-stat-l">Content</span></div>
    <div class="about-stat"><span class="about-stat-n">${stats.views || 0}</span><span class="about-stat-l">Views</span></div>
  </div>` : ''}
  <div class="about-links">
    <a href="https://github.com/Muno459/deensubs" target="_blank" rel="noopener" class="about-link"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg> Open Source on GitHub</a>
    <a href="https://x.com/deensubss" target="_blank" rel="noopener" class="about-link"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg> Follow on X</a>
  </div>
  <div class="about-ayah">
    <p class="about-ayah-ar">وَمَا أَرْسَلْنَاكَ إِلَّا رَحْمَةً لِّلْعَالَمِينَ</p>
    <p class="about-ayah-en">"And We have not sent you except as a mercy to the worlds." — Quran 21:107</p>
  </div>
</div>`;
}
