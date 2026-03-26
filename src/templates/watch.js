import { e, fv, ft, thu, ago, jsStr, cdn } from '../lib/helpers.js';
import { tsvg } from '../components/thumbnail.js';
import { scard } from '../components/video-card.js';
import { commentHTML } from '../components/comment.js';
import WATCH_JS from '../scripts/watch.txt';

export function renderWatch({ video, comments, related, cues, base }) {
  const th=thu(video);
  base = base || 'https://deensubs.mostafa0333.workers.dev';
  const jsonLd = JSON.stringify({
    '@context':'https://schema.org','@type':'VideoObject',
    name:video.title, description:video.description||'',
    uploadDate:video.created_at?.split(' ')[0]||'',
    thumbnailUrl:th?base+th:'',
    duration:video.duration?'PT'+Math.floor(video.duration/60)+'M'+Math.floor(video.duration%60)+'S':'',
  });
  return `
${th?`<link rel="preload" as="image" href="${e(th)}">`:''}
<script type="application/ld+json">${jsonLd}</script>
<div class="wl">
  <div class="wm">
    <div class="vp" id="vp">
      <video id="vid" crossorigin="anonymous" preload="auto" playsinline${th?` poster="${e(th)}"`:''}>
        <source src="${cdn(video.video_key)}" type="video/mp4">
        ${video.srt_key?`<track kind="subtitles" src="${cdn('vtt/'+video.srt_key.replace('subs/','').replace('.srt','.vtt'))}" srclang="en" label="English" default>`:''}
        ${video.srt_ar_key?`<track kind="subtitles" src="${cdn('vtt/'+video.srt_ar_key.replace('subs/','').replace('.srt','.vtt'))}" srclang="ar" label="العربية">`:''}
      </video>
      <div class="vp-spinner" id="vp-spin"></div>
      <button class="vp-mini-close" id="vp-mini-x">&times;</button>
      <div class="vp-seek-ind vp-seek-l" id="seek-l"><svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg><span>10s</span></div>
      <div class="vp-seek-ind vp-seek-r" id="seek-r"><svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M11.5 8c2.65 0 5.05.99 6.9 2.6L22 7v9h-9l3.62-3.62C15.23 11.22 13.46 10.5 11.5 10.5c-3.54 0-6.55 2.31-7.6 5.5L1.53 15.22C2.92 11.03 6.85 8 11.5 8z"/></svg><span>10s</span></div>
      <div class="vp-sub" id="vp-sub"></div>
      <div class="vp-big" id="vp-big"><div class="vp-bigb"></div></div>
      <div class="vp-end" id="vp-end">
        <div class="vp-end-inner">
          <button class="vp-end-replay" id="vp-replay"><svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg><span>Replay</span></button>
          <div class="vp-end-next">${related.slice(0,3).map(r => {
            const rth = thu(r);
            return `<a href="/watch/${e(r.slug)}" class="vp-end-card"><div class="vp-end-card-th"${rth?` style="background-image:url('${e(rth)}');background-size:cover;background-position:center"`:''}></div><h5>${e(r.title)}</h5></a>`;
          }).join('')}</div>
        </div>
      </div>
      <div class="vp-bar" id="vp-bar">
        <button class="vb" id="vpp" title="Play (k)"><svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path id="ppi" d="M8 5v14l11-7z"/></svg></button>
        <div class="vp-sk" id="vsk"><div class="vp-bf" id="vbf"></div><div class="vp-pg" id="vpg"><div class="vp-dot"></div></div></div>
        <span class="vp-tm" id="vtm">0:00 / 0:00</span>
        <button class="vb" id="vvol" title="Mute (m)"><svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path id="voli" d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 010 7.07" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></button>
        <input type="range" class="vb-vr" id="vvr" min="0" max="1" step=".05" value="1" title="Volume">
        <div class="vb-lang-wrap"><button class="vb" id="vcc" title="Subtitles (c)">CC</button>
          <div class="vb-lang-menu" id="lang-menu">
            <button class="vb-lang-opt" data-lang="off">Off</button>
            ${video.srt_key?'<button class="vb-lang-opt vb-lang-on" data-lang="en">English</button>':''}
            ${video.srt_ar_key?'<button class="vb-lang-opt" data-lang="ar">العربية</button>':''}
          </div>
        </div>
        <button class="vb vb-spd" id="vspd" title="Speed">1x</button>
        <button class="vb" id="vthtr" title="Theater mode (t)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="2" y="4" width="20" height="16" rx="2"/></svg></button>
        <button class="vb" id="vpip" title="Picture-in-Picture"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="2" y="3" width="20" height="14" rx="2"/><rect x="11" y="9" width="10" height="7" rx="1" fill="currentColor" opacity=".3"/></svg></button>
        <button class="vb" id="vfs" title="Fullscreen (f)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/></svg></button>
      </div>
    </div>
    <div class="wi">
      <div class="wi-top">
        <div class="wi-tl">
          <h1>${e(video.title)}</h1>
        </div>
        <div class="wi-acts">
          <button class="wa" id="lk-btn" title="Like"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg><span id="lk-ct">${video.likes||0}</span></button>
          <button class="wa" id="bk-btn" title="Bookmark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg><span>Save</span></button>
          <button class="wa" id="sh-btn" title="Share"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg><span>Share</span></button>
          <button class="wa" id="dl-btn" title="Download"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>Download</span></button>
        </div>
      </div>
      <div class="wi-mt">
        <span>${fv(video.views)}</span>
        <span>${ago(video.created_at)}</span>
        ${video.category_name?`<a href="/category/${e(video.category_slug)}" class="tag" style="--tc:${e(video.category_color)}">${e(video.category_name)}</a>`:''}
        <span class="tag tag-s">Arabic &rarr; English</span>
      </div>
      ${video.scholar_slug?`<a href="/scholar/${e(video.scholar_slug)}" class="wi-sch-card">
        <div class="wi-sch-av">${e((video.source||video.scholar_name||'').split(' ').pop().charAt(0))}</div>
        <div class="wi-sch-info"><span class="wi-sch-name">${e(video.source||video.scholar_name)}</span>${video.scholar_title?`<span class="wi-sch-title">${e(video.scholar_title)}</span>`:''}</div>
      </a>`:video.source?`<div class="wi-source">${e(video.source)}</div>`:''}
      ${video.description?`<div class="wi-desc">${e(video.description)}</div>`:''}
    </div>
    ${cues&&cues.length?`
    <details class="tr" open>
      <summary class="tr-hd">Transcript <span class="tr-ct">${cues.length} lines</span></summary>
      <div class="tr-ls" id="trl">${cues.map((c,i)=>`<div class="tl" data-i="${i}" data-s="${c.start}" data-e="${c.end}"><span class="tl-t">${ft(c.start)}</span><p>${e(c.text)}</p></div>`).join('')}</div>
    </details>`:''}
    <div class="cms">
      <h2>${comments.length} Comment${comments.length!==1?'s':''}</h2>
      <form id="cf" class="cf" data-slug="${e(video.slug)}">
        <div class="cf-r">${video._user?`<input name="author" type="hidden" value="${e(video._user.name)}"><div class="cf-user"><img src="${e(video._user.avatar)}" class="cf-user-av"><span>${e(video._user.name)}</span></div>`:`<input name="author" placeholder="Your name" maxlength="100" required autocomplete="off">`}<button type="submit">Post</button></div>
        <div class="cf-ta-wrap"><textarea name="content" placeholder="Share your thoughts..." maxlength="2000" rows="2" required id="cf-ta"></textarea><span class="cf-counter" id="cf-ct">2000</span></div>
      </form>
      <div id="cl" class="cl">${comments.map(commentHTML).join('')}</div>
    </div>
  </div>
  <aside class="ws">
    <h3>Related</h3>
    ${related.length?related.map(scard).join(''):'<p class="emp-s">More content soon.</p>'}
  </aside>
</div>
<div class="scroll-prog" id="scroll-prog"></div>
<button class="btt" id="btt" title="Back to top"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M18 15l-6-6-6 6"/></svg></button>
<div class="toast" id="toast"></div>
<div class="dl-modal" id="dl-modal"><div class="dl-inner"><div class="dl-header"><h3>Download</h3><button class="dl-close" id="dl-close">&times;</button></div><div class="dl-grid">
<a href="${cdn(video.video_key)}" download class="dl-item"><div class="dl-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="28" height="28"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg></div><div><div class="dl-label">Video</div><div class="dl-sub">MP4 · Original quality</div></div></a>
${video.srt_key?`<a href="${cdn(video.srt_key)}" download class="dl-item"><div class="dl-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="28" height="28"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></div><div><div class="dl-label">English Subtitles</div><div class="dl-sub">SRT format</div></div></a>`:''}
${video.srt_ar_key?`<a href="${cdn(video.srt_ar_key)}" download class="dl-item"><div class="dl-icon dl-icon-ar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="28" height="28"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></div><div><div class="dl-label">Arabic Subtitles</div><div class="dl-sub">SRT · العربية</div></div></a>`:''}
</div></div></div>
<script>${WATCH_JS.replace('__SLUG__',e(video.slug)).replace('__SRT__',video.srt_key?e(video.srt_key):'').replace('__SRT_AR__',video.srt_ar_key?e(video.srt_ar_key):'').replace('__TITLE__',jsStr(video.title)).replace('__THUMB__',thu(video)?e(thu(video)):'').replace('__SOURCE__',jsStr(video.source||''))}</script>`;
}
