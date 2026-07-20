// Audiobook page — Apple-Podcasts-style audio player with a karaoke
// transcript (English units lighting up over the shared timed Arabic word
// array from transcripts/{slug}.json).
import { e, ft, thu, ago, jsStr, cdn, schImgSm } from '../lib/helpers.js';
import AB_JS from '../scripts/audiobook.min.txt';
import { scard } from '../components/video-card.js';

export function renderAudiobook({ video, related, base, playlist }) {
  const th = thu(video);
  const dur = video.duration || 0;
  let chapters = [];
  try {
    chapters = (JSON.parse(video.chapters || '[]') || [])
      .filter((ch) => ch && typeof ch.t === 'number' && ch.title && (!dur || ch.t < dur - 5))
      .sort((a, b) => a.t - b.t);
  } catch { chapters = []; }
  if (chapters.length < 2) chapters = [];
  const chJson = JSON.stringify(chapters.map((ch) => ({ t: ch.t, title: ch.title }))).replace(/</g, '\\u003c');
  base = base || 'https://deensubs.com';
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'AudioObject',
    name: video.title,
    description: video.description || undefined,
    contentUrl: base + '/api/media/' + video.video_key,
    thumbnailUrl: video.thumb_key ? base + '/api/media/' + video.thumb_key : undefined,
    duration: dur ? `PT${Math.floor(dur / 60)}M${dur % 60}S` : undefined,
  }).replace(/</g, '\\u003c');

  return `
<script type="application/ld+json">${jsonLd}</script>
<div class="ab">
  <div class="ab-hero">
    ${th ? `<img class="ab-art" src="${e(th)}" alt="${e(video.title)}" width="280" height="280">` : ''}
    <div class="ab-meta">
      <span class="ab-kind">Audiobook</span>
      <h1 class="ab-title">${e(video.title)}</h1>
      ${video.title_ar ? `<p class="ab-title-ar" dir="rtl">${e(video.title_ar)}</p>` : ''}
      ${video.scholar_name ? `<a class="ab-sch" href="/scholar/${e(video.scholar_slug || '')}">${video.scholar_photo ? `<img src="${e(schImgSm(video.scholar_photo))}" alt="" width="28" height="28">` : ''}<span>${e(video.scholar_name)}</span></a>` : ''}
      <div class="ab-sub">${ft(dur)} · ${ago(video.created_at)}</div>
    </div>
  </div>

  <audio id="ab-audio" src="${cdn(video.video_key)}" preload="metadata"></audio>

  <div class="ab-ctl">
    <div class="ab-seekrow">
      <span class="ab-time" id="ab-cur">0:00</span>
      <div class="ab-seekwrap"><div class="ab-ticks" id="ab-ticks"></div><input type="range" id="ab-seek" min="0" max="${dur || 100}" value="0" step="1" aria-label="Seek"></div>
      <span class="ab-time" id="ab-tot">0:00</span>
    </div>
    <div class="ab-btnrow">
      <button class="ab-side" id="ab-speed" title="Playback speed">1×</button>
      <button class="ab-skip" id="ab-back" title="Back 15 seconds"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="26" height="26"><path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/></svg></button>
      <button class="ab-playbtn" id="ab-play" aria-label="Play/Pause">
        <svg class="ab-ic-play" viewBox="0 0 24 24" fill="currentColor" width="30" height="30"><path d="M8 5v14l11-7z"/></svg>
        <svg class="ab-ic-pause" viewBox="0 0 24 24" fill="currentColor" width="30" height="30"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>
      </button>
      <button class="ab-skip" id="ab-fwd" title="Forward 15 seconds"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="26" height="26"><path d="M13 17l5-5-5-5M6 17l5-5-5-5"/></svg></button>
      <button class="ab-side" id="ab-arbtn" title="Show Arabic">ع</button>
    </div>
    ${chapters.length ? `<div class="ab-chlabel" id="ab-chlabel"></div>` : '<div id="ab-chlabel" hidden></div>'}
  </div>

  <div class="ab-trwrap" id="ab-trwrap">
    <button class="ab-followbtn" id="ab-follow" hidden>Resume following</button>
    <div class="ab-tr" id="ab-tr"><p class="ab-p ab-dim">Loading transcript…</p></div>
  </div>

  ${video.description ? `<details class="ab-desc"><summary>About this audiobook</summary><p>${e(video.description)}</p></details>` : ''}

  ${related?.length ? `<div class="ab-rel"><h2>More like this</h2><div class="vgrid">${related.slice(0, 8).map(scard).join('')}</div></div>` : ''}
</div>
<script>${AB_JS
    .replace('__SLUG__', e(video.slug))
    .replace('__TITLE__', jsStr(video.title))
    .replace('__ART__', th ? e(th) : '')
    .replace('__SCHOLAR__', jsStr(video.scholar_name || ''))
    .replace("'__DUR__'", String(dur))
    .replace('__CHAPTERS__', () => chJson)}</script>`;
}
