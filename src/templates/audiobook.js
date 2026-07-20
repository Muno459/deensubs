// Audiobook page — two renderings over the same karaoke engine
// (English units lighting up over the shared timed Arabic word array
// from transcripts/{slug}.json):
//
// 1. Video-format stage (scholar has a baked card in scholars/cards/):
//    watch-style layout where the 16:9 player viewport shows the full
//    1920x1080 static card, the title + transcript scroll in the empty
//    right zone of the artwork (Apple-Music lyrics feel), and a
//    vp-style auto-hiding control bar sits along the bottom.
// 2. Classic Apple-Podcasts look for scholars without a card.
import { e, fv, ft, thu, ago, jsStr, cdn, schImg, schImgSm, schCard } from '../lib/helpers.js';
import AB_JS from '../scripts/audiobook.min.txt';
import { scard } from '../components/video-card.js';
import { tsvg } from '../components/thumbnail.js';

const primaryLang = (v) => {
  try { return JSON.parse(v.srt_langs || '[]')[0] || 'en'; } catch { return 'en'; }
};

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

  const audioTag = `<audio id="ab-audio" src="${cdn(video.video_key)}" preload="metadata"></audio>`;
  const scriptTag = `<script>${AB_JS
    .replace('__ORIG__', video.orig_key ? e(cdn(video.orig_key)) : '')
    .replace('__SLUG__', e(video.slug))
    .replace('__TITLE__', jsStr(video.title))
    .replace('__ART__', th ? e(th) : '')
    .replace('__SCHOLAR__', jsStr(video.scholar_name || ''))
    .replace(/['"]__DUR__['"]/, String(dur)) // esbuild may re-quote the literal — match either style
    .replace('__CHAPTERS__', () => chJson)}</script>`;

  const card = schCard(video.scholar_slug);
  if (card) return renderStage({ video, related, playlist, card, th, dur, chapters, jsonLd, audioTag, scriptTag });
  return renderClassic({ video, related, th, dur, chapters, jsonLd, audioTag, scriptTag });
}

/* ── video-format stage ─────────────────────────────────────────────── */

/* Phone-only header of the transcript sheet: scholar portrait beside the
   chapter the playhead is in (falls back to the scholar's own name when the
   talk has no chapters). The button opens the chapter list over the sheet. */
function abChRow(video, chapters) {
  const nm = video.scholar_name || '';
  const av = video.scholar_photo
    ? `<img src="${e(schImgSm(video.scholar_photo))}" alt="" width="40" height="40">`
    : e(nm.split(' ').pop().charAt(0));
  return `<div class="abv-chrow">
    <span class="abv-chav">${av}</span>
    <span class="abv-chtx">
      <b class="abv-chn${chapters.length ? ' ab-chl-n' : ''}">${chapters.length ? 'Chapter 1' : e(nm)}</b>
      <span class="abv-cht${chapters.length ? ' ab-chl-t' : ''}">${e(chapters.length ? chapters[0].title : video.scholar_title || 'Audiobook')}</span>
    </span>
    ${chapters.length ? `<button class="abv-chbtn" id="ab-chlist" aria-label="Chapters" title="Chapters"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="17" height="17"><path d="M4 6h16M4 12h10M4 18h7"/></svg></button>` : ''}
  </div>`;
}

function renderStage({ video, related, playlist, card, th, dur, chapters, jsonLd, audioTag, scriptTag }) {
  const plIdx = playlist ? playlist.items.findIndex((p) => p.slug === video.slug) : -1;
  const plNext = plIdx >= 0 && plIdx < playlist.items.length - 1 ? playlist.items[plIdx + 1] : null;
  return `
<link rel="preload" as="image" href="${e(card.src)}" imagesrcset="${e(card.srcset)}" imagesizes="(max-width:960px) 100vw, 66vw">
<script type="application/ld+json">${jsonLd}</script>
<div class="wl">
  <div class="wm">
    <div class="abv" id="abv">
      <div class="abv-frame">
        <img class="abv-bg" id="abv-bg" src="${e(card.src)}" srcset="${e(card.srcset)}" sizes="(max-width:960px) 100vw, 66vw" alt="${e(video.scholar_name || video.title)}">
        <div class="abv-head">
          <div class="abv-head-k"><span class="abv-kind">Audiobook</span>${video.speech_enhanced ? '<span class="abv-kind ab-se">Speech Enhanced</span>' : ''}</div>
          <h2>${e(video.title)}</h2>
          ${video.title_ar ? `<p class="abv-head-ar" dir="rtl">${e(video.title_ar)}</p>` : ''}
          <div class="abv-prog"><i id="ab-prog"></i></div>
          <p class="abv-pct"><b id="ab-pct">0%</b> completed</p>
        </div>
        <div class="abv-sheet">
          ${abChRow(video, chapters)}
          <div class="abv-txt" id="ab-trwrap">
            <div class="abv-ttl">
              <span class="abv-kind">Audiobook</span>${video.speech_enhanced ? '<span class="abv-kind ab-se">Speech Enhanced</span>' : ''}
              <h2>${e(video.title)}</h2>
              ${video.title_ar ? `<p class="abv-ttl-ar" dir="rtl">${e(video.title_ar)}</p>` : ''}
            </div>
            <div class="ab-tr" id="ab-tr"><p class="ab-p ab-dim">Loading transcript…</p></div>
          </div>
          <button class="ab-followbtn" id="ab-follow" hidden>Resume following</button>
          ${chapters.length ? `<div class="abv-chls" id="ab-chls" hidden>
            ${chapters.map((ch, i) => `<button class="abv-chi" data-t="${ch.t}"><span class="abv-chi-n">${i + 1}</span><span class="abv-chi-t">${e(ch.title)}</span><span class="abv-chi-m">${ft(ch.t)}</span></button>`).join('')}
          </div>` : ''}
          <div class="abv-bar" id="abv-bar">
            <div class="abv-btns">
              <button class="vb" id="ab-back" title="Back 15 seconds"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="19" height="19"><path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/></svg></button>
              <button class="vb" id="ab-play" aria-label="Play/Pause">
                <svg class="ab-ic-play" viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M8 5v14l11-7z"/></svg>
                <svg class="ab-ic-pause" viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>
              </button>
              <button class="vb" id="ab-fwd" title="Forward 15 seconds"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="19" height="19"><path d="M13 17l5-5-5-5M6 17l5-5-5-5"/></svg></button>
            </div>
            <div class="abv-sk"><div class="ab-ticks" id="ab-ticks"></div><input type="range" id="ab-seek" min="0" max="${dur || 100}" value="0" step="1" aria-label="Seek"></div>
            <span class="abv-tm"><span id="ab-cur">0:00</span> / <span id="ab-tot">0:00</span></span>
            <div class="abv-rt">
              <span class="abv-chl ab-chl-t" id="ab-chlabel"></span>
              <button class="vb" id="ab-arbtn" title="Show Arabic">ع</button>
              <button class="vb vb-spd" id="ab-speed" title="Playback speed">1×</button>
              <button class="vb vb-spd" id="ab-sleep" title="Sleep timer">☾</button>
              <button class="vb" id="ab-fs" title="Fullscreen (f)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/></svg></button>
            </div>
          </div>
        </div>
      </div>
    </div>
    ${audioTag}
    <div class="wi">
      <div class="wi-top">
        <div class="wi-tl">
          <h1>${e(video.title)}</h1>
          ${video.title_ar ? `<p class="wi-ar" dir="rtl">${e(video.title_ar)}</p>` : ''}
        </div>
        <div class="wi-acts">
          <button class="wa" id="ab-share" title="Share" aria-label="Share this audiobook"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg><span>Share</span></button>
          <a class="wa" href="/api/media/${e(video.video_key)}" download title="Download audio"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>Download</span></a>
          <a class="wa" href="/api/media/transcripts/${e(video.slug)}-${e(primaryLang(video))}.txt" download title="Download the transcript (.txt, speaker-labelled)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg><span>Transcript</span></a>
        </div>
      </div>
      <div class="wi-mt">
        <span>${fv(video.views)}</span>
        <span>${ago(video.created_at)}</span>
        ${dur ? `<span>${Math.floor(dur / 60)} min</span>` : ''}
        ${video.category_name ? `<a href="/category/${e(video.category_slug)}" class="tag" style="--tc:${e(video.category_color)}">${e(video.category_name)}</a>` : ''}
        <span class="tag tag-s">Audio</span>${video.speech_enhanced ? '<span class="tag tag-s ab-se">Speech Enhanced</span>' : ''}
      </div>
      <div class="wi-info-card">
        ${video.scholar_slug ? `<a href="/scholar/${e(video.scholar_slug)}" class="wi-sch">
          <div class="wi-sch-av">${video.scholar_photo ? `<img src="${schImg(video.scholar_photo)}" alt="">` : e((video.scholar_name || '').split(' ').pop().charAt(0))}</div>
          <div class="wi-sch-info"><span class="wi-sch-name">${e(video.scholar_name)}</span>${video.scholar_title ? `<span class="wi-sch-title">${e(video.scholar_title)}</span>` : ''}</div>
        </a>` : ''}
        ${video.description ? `<p class="wi-desc">${e(video.description)}</p>` : ''}
      </div>
    </div>
    ${chapters.length ? `
    <div class="chr">
      <div class="chr-hd"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M4 6h16M4 12h10M4 18h7"/></svg><span>Chapters</span><span class="chr-ct">${chapters.length}</span></div>
      <div class="chr-ls" id="chr-ls">
        ${chapters.map((ch) => `<button class="chr-c" data-t="${ch.t}" title="${e(ch.title)}"><span class="chr-tm">${ft(ch.t)}</span><span class="chr-t">${e(ch.title)}</span></button>`).join('')}
      </div>
    </div>` : ''}
  </div>
  <aside class="ws">
    ${plNext ? `<div class="ws-next"><span class="ws-next-label">Up next in ${e(playlist.title)}</span><a href="/watch/${e(plNext.slug)}" class="ws-next-title">${e(plNext.title)}</a></div>`
      : related && related.length ? `<div class="ws-next"><span class="ws-next-label">Up Next</span><a href="/watch/${e(related[0].slug)}" class="ws-next-title">${e(related[0].title)}</a></div>` : ''}
    ${playlist && plIdx >= 0 ? `
    <div class="plq">
      <div class="plq-hd">
        <a href="/playlist/${e(playlist.slug)}" class="plq-t">${e(playlist.title)}</a>
        <span class="plq-k">${plIdx + 1} / ${playlist.items.length}</span>
      </div>
      <div class="plq-ls" id="plq-ls">
        ${playlist.items.map((it, i) => {
          const itTh = thu(it);
          return `<a href="/watch/${e(it.slug)}" class="plq-r${i === plIdx ? ' plq-on' : ''}"${i === plIdx ? ' aria-current="true"' : ''}>
          <span class="plq-n">${i === plIdx ? '<svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10"><path d="M8 5v14l11-7z"/></svg>' : i + 1}</span>
          <div class="plq-th">${itTh ? `<img src="${e(itTh)}" alt="" loading="lazy" decoding="async">` : tsvg(it.title, '#0e6b63', 100, 56)}${it.duration ? `<span class="dur dur-s">${ft(it.duration)}</span>` : ''}</div>
          <h4>${e(it.title)}</h4>
        </a>`; }).join('')}
      </div>
    </div>
    <script>(function(){var q=document.getElementById('plq-ls');if(!q)return;var on=q.querySelector('.plq-on');if(on)q.scrollTop=Math.max(0,on.offsetTop-q.offsetTop-56)})()</script>` : ''}
    <h3>Related</h3>
    ${related && related.length ? related.map(scard).join('') : '<p class="emp-s">More content soon.</p>'}
  </aside>
</div>
${scriptTag}`;
}

/* ── classic Apple-Podcasts look (no baked card for this scholar) ───── */

function renderClassic({ video, related, th, dur, chapters, jsonLd, audioTag, scriptTag }) {
  return `
<script type="application/ld+json">${jsonLd}</script>
<div class="ab">
  <div class="ab-hero">
    ${th ? `<img class="ab-art" src="${e(th)}" alt="${e(video.title)}" width="280" height="280">` : ''}
    <div class="ab-meta">
      <span class="ab-kind">Audiobook</span>${video.speech_enhanced ? '<span class="ab-kind ab-se">Speech Enhanced</span>' : ''}
      <h1 class="ab-title">${e(video.title)}</h1>
      ${video.title_ar ? `<p class="ab-title-ar" dir="rtl">${e(video.title_ar)}</p>` : ''}
      ${video.scholar_name ? `<a class="ab-sch" href="/scholar/${e(video.scholar_slug || '')}">${video.scholar_photo ? `<img src="${e(schImgSm(video.scholar_photo))}" alt="" width="28" height="28">` : ''}<span>${e(video.scholar_name)}</span></a>` : ''}
      <div class="ab-sub">${ft(dur)} · ${ago(video.created_at)}</div>
    </div>
  </div>

  ${audioTag}

  <div class="ab-ctl">
    <div class="ab-seekrow">
      <span class="ab-time" id="ab-cur">0:00</span>
      <div class="ab-seekwrap"><div class="ab-ticks" id="ab-ticks"></div><input type="range" id="ab-seek" min="0" max="${dur || 100}" value="0" step="1" aria-label="Seek"></div>
      <span class="ab-time" id="ab-tot">0:00</span>
    </div>
    <div class="ab-btnrow">
      <button class="ab-side" id="ab-speed" title="Playback speed">1×</button>
      <button class="ab-side" id="ab-sleep" title="Sleep timer">☾</button>
      <button class="ab-skip" id="ab-back" title="Back 15 seconds"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="26" height="26"><path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/></svg></button>
      <button class="ab-playbtn" id="ab-play" aria-label="Play/Pause">
        <svg class="ab-ic-play" viewBox="0 0 24 24" fill="currentColor" width="30" height="30"><path d="M8 5v14l11-7z"/></svg>
        <svg class="ab-ic-pause" viewBox="0 0 24 24" fill="currentColor" width="30" height="30"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>
      </button>
      <button class="ab-skip" id="ab-fwd" title="Forward 15 seconds"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="26" height="26"><path d="M13 17l5-5-5-5M6 17l5-5-5-5"/></svg></button>
      <button class="ab-side" id="ab-arbtn" title="Show Arabic">ع</button>
    </div>
    ${chapters.length ? `<div class="ab-chlabel ab-chl-t" id="ab-chlabel"></div>` : '<div id="ab-chlabel" hidden></div>'}
  </div>

  <div class="ab-trwrap" id="ab-trwrap">
    <button class="ab-followbtn" id="ab-follow" hidden>Resume following</button>
    <div class="ab-tr" id="ab-tr"><p class="ab-p ab-dim">Loading transcript…</p></div>
  </div>

  ${video.description ? `<details class="ab-desc"><summary>About this audiobook</summary><p>${e(video.description)}</p></details>` : ''}

  ${related?.length ? `<div class="ab-rel"><h2>More like this</h2><div class="vgrid">${related.slice(0, 8).map(scard).join('')}</div></div>` : ''}
</div>
${scriptTag}`;
}
