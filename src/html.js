// ── Utilities ──

function e(s) { return s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function ago(d) {
  if (!d) return '';
  const s = Math.floor((Date.now() - new Date(d + 'Z').getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 2592000) return Math.floor(s / 86400) + 'd ago';
  return new Date(d).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fv(n) { return !n ? '0 views' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M views' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K views' : n + ' views'; }

function ft(sec) {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  const h = Math.floor(m / 60);
  return h > 0 ? h + ':' + String(m % 60).padStart(2, '0') + ':' + String(s).padStart(2, '0') : m + ':' + String(s).padStart(2, '0');
}

function thumbUrl(v) {
  return v.thumb_key ? '/api/media/' + v.thumb_key : null;
}

// ── Components ──

function videoCard(v) {
  const thumb = thumbUrl(v);
  const color = v.category_color || '#c4a44c';
  return `<a href="/watch/${e(v.slug)}" class="card">
  <div class="card-thumb" ${thumb ? `style="background-image:url('${e(thumb)}')"` : ''}>
    ${!thumb ? thumbSVG(v.title, color) : ''}
    <div class="card-play-i"></div>
    ${v.duration ? `<span class="card-dur">${ft(v.duration)}</span>` : ''}
  </div>
  <div class="card-body">
    <h3>${e(v.title)}</h3>
    <div class="card-meta">
      ${v.source ? `<span>${e(v.source)}</span>` : ''}
      <span>${fv(v.views)}</span>
    </div>
    <div class="card-tags">
      ${v.category_name ? `<span class="tag" style="--tc:${e(color)}">${e(v.category_name)}</span>` : ''}
      ${v.srt_key ? '<span class="tag tag-sub">Subtitled</span>' : ''}
    </div>
  </div>
</a>`;
}

function sideCard(v) {
  const thumb = thumbUrl(v);
  const color = v.category_color || '#c4a44c';
  return `<a href="/watch/${e(v.slug)}" class="sc">
  <div class="sc-thumb" ${thumb ? `style="background-image:url('${e(thumb)}')"` : ''}>
    ${!thumb ? thumbSVG(v.title, color, 140, 79) : ''}
    ${v.duration ? `<span class="card-dur">${ft(v.duration)}</span>` : ''}
  </div>
  <div class="sc-info">
    <h4>${e(v.title)}</h4>
    <span>${v.source ? e(v.source) : ''}</span>
    <span>${fv(v.views)}</span>
  </div>
</a>`;
}

function thumbSVG(title, color, w, h) {
  w = w || 320; h = h || 180;
  let hsh = 0;
  for (let i = 0; i < title.length; i++) hsh = ((hsh << 5) - hsh + title.charCodeAt(i)) | 0;
  hsh = Math.abs(hsh);
  const cx = w * 0.35 + (hsh % (w * 0.3));
  const cy = h * 0.25 + ((hsh >> 4) % (h * 0.5));
  const s = Math.min(w, h) * 0.25 + ((hsh >> 8) % (Math.min(w, h) * 0.2));
  return `<svg viewBox="0 0 ${w} ${h}" fill="none" class="th-svg"><rect width="${w}" height="${h}" fill="#08080f"/>
  <circle cx="${cx}" cy="${cy}" r="${s * 1.2}" fill="${color}" opacity="0.04"/>
  <rect x="${cx - s / 2}" y="${cy - s / 2}" width="${s}" height="${s}" stroke="${color}" stroke-width="0.7" opacity="0.14" transform="rotate(45 ${cx} ${cy})"/>
  <rect x="${cx - s / 2}" y="${cy - s / 2}" width="${s}" height="${s}" stroke="${color}" stroke-width="0.7" opacity="0.14"/>
  <circle cx="${cx}" cy="${cy}" r="${s * 0.2}" stroke="${color}" stroke-width="0.5" opacity="0.1"/></svg>`;
}

// ── Pages ──

export function renderHome({ featured, recent, categories }) {
  return `
  ${featured ? `<section class="hero-feat">
    <a href="/watch/${e(featured.slug)}" class="hf-card">
      <div class="hf-thumb" ${thumbUrl(featured) ? `style="background-image:url('${e(thumbUrl(featured))}')"` : ''}>
        ${!thumbUrl(featured) ? thumbSVG(featured.title, featured.category_color || '#c4a44c', 800, 450) : ''}
        <div class="hf-overlay">
          <div class="hf-play"></div>
        </div>
        ${featured.source ? `<div class="hf-badge">${e(featured.source)}</div>` : ''}
        ${featured.duration ? `<span class="card-dur hf-dur">${ft(featured.duration)}</span>` : ''}
      </div>
      <div class="hf-info">
        ${featured.title_ar ? `<div class="hf-ar">${e(featured.title_ar)}</div>` : ''}
        <h2>${e(featured.title)}</h2>
        ${featured.description ? `<p class="hf-desc">${e(featured.description)}</p>` : ''}
        <div class="hf-meta">
          ${featured.category_name ? `<span class="tag" style="--tc:${e(featured.category_color || '#c4a44c')}">${e(featured.category_name)}</span>` : ''}
          <span class="tag tag-sub">AR &rarr; EN</span>
          <span>${fv(featured.views)}</span>
          <span>${ago(featured.created_at)}</span>
        </div>
      </div>
    </a>
  </section>` : ''}
  <section class="sec">
    <div class="sec-head"><h2>All Videos</h2></div>
    <div class="grid">${recent.length ? recent.map(videoCard).join('') : '<p class="empty">No videos yet.</p>'}</div>
  </section>`;
}

export function renderWatch({ video, comments, related, cues }) {
  const thumb = thumbUrl(video);
  return `
  <div class="w-layout">
    <div class="w-main">
      <div class="vp" id="vp">
        <video id="vid" crossorigin="anonymous" preload="metadata" ${thumb ? `poster="${e(thumb)}"` : ''}>
          <source src="/api/media/${e(video.video_key)}" type="video/mp4">
        </video>
        <div class="vp-big" id="vp-big"><div class="vp-big-btn"></div></div>
        <div class="vp-bar" id="vp-bar">
          <button class="vp-btn" id="vp-pp" aria-label="Play/Pause"><svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path id="pp-icon" d="M8 5v14l11-7z"/></svg></button>
          <div class="vp-seek" id="vp-seek"><div class="vp-buf" id="vp-buf"></div><div class="vp-prog" id="vp-prog"><div class="vp-dot"></div></div></div>
          <span class="vp-time" id="vp-time">0:00 / 0:00</span>
          <button class="vp-btn" id="vp-cc" aria-label="Subtitles" title="Subtitles (c)">CC</button>
          <button class="vp-btn vp-speed" id="vp-spd" aria-label="Speed" title="Speed">1x</button>
          <button class="vp-btn" id="vp-fs" aria-label="Fullscreen" title="Fullscreen (f)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/></svg></button>
        </div>
      </div>

      <div class="w-info">
        <div class="w-top">
          <div>
            ${video.title_ar ? `<div class="w-ar">${e(video.title_ar)}</div>` : ''}
            <h1>${e(video.title)}</h1>
          </div>
          <div class="w-actions">
            <button class="w-act" id="bk-btn" title="Bookmark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg><span>Save</span></button>
            <button class="w-act" id="sh-btn" title="Share"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg><span>Share</span></button>
            ${video.srt_key ? `<a class="w-act" href="/api/media/${e(video.srt_key)}" download><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>Subs</span></a>` : ''}
          </div>
        </div>
        <div class="w-meta">
          ${video.source ? `<span>${e(video.source)}</span>` : ''}
          <span>${fv(video.views)}</span>
          <span>${ago(video.created_at)}</span>
        </div>
        <div class="w-tags">
          ${video.category_name ? `<a href="/category/${e(video.category_slug)}" class="tag" style="--tc:${e(video.category_color)}">${e(video.category_name)}</a>` : ''}
          <span class="tag tag-sub">Arabic &rarr; English</span>
        </div>
        ${video.description ? `<div class="w-desc">${e(video.description)}</div>` : ''}
      </div>

      ${cues && cues.length ? `
      <details class="tr-wrap" open>
        <summary class="tr-toggle">Transcript <span class="tr-count">${cues.length} lines</span></summary>
        <div class="tr-list" id="tr-list">
          ${cues.map((c, i) => `<div class="tr-line" data-i="${i}" data-s="${c.start}" data-e="${c.end}"><span class="tr-t">${ft(c.start)}</span><p>${e(c.text)}</p></div>`).join('')}
        </div>
      </details>` : ''}

      <div class="cm-sec">
        <h2>${comments.length} Comment${comments.length !== 1 ? 's' : ''}</h2>
        <form id="cm-form" class="cm-form" data-slug="${e(video.slug)}">
          <div class="cm-row"><input name="author" placeholder="Your name" maxlength="100" required autocomplete="off"><button type="submit">Post</button></div>
          <textarea name="content" placeholder="Share your thoughts..." maxlength="2000" rows="2" required></textarea>
        </form>
        <div id="cm-list" class="cm-list">${comments.map(c => commentHTML(c)).join('')}</div>
      </div>
    </div>

    <aside class="w-side">
      <h3>Related</h3>
      ${related.length ? related.map(sideCard).join('') : '<p class="empty-s">More content soon.</p>'}
    </aside>
  </div>
  <div class="toast" id="toast"></div>
  <script>${WATCH_JS.replace('__SLUG__', e(video.slug)).replace('__SRT__', video.srt_key ? e(video.srt_key) : '')}</script>`;
}

function commentHTML(c) {
  return `<div class="cm"><div class="cm-head"><strong>${e(c.author)}</strong><time>${ago(c.created_at)}</time></div><p>${e(c.content)}</p></div>`;
}

export function renderCategory({ category, videos }) {
  return `<section class="sec">
    <div class="sec-head">
      <div class="cat-hd"><span class="cat-ar">${e(category.name_ar)}</span><h1>${e(category.name)}</h1></div>
      <span class="cat-ct">${videos.length} video${videos.length !== 1 ? 's' : ''}</span>
    </div>
    <div class="grid">${videos.length ? videos.map(videoCard).join('') : '<p class="empty">No videos in this category yet.</p>'}</div>
  </section>`;
}

export function renderSearch({ query, videos }) {
  return `<section class="sec">
    <div class="sec-head"><h1>${query ? 'Results for "' + e(query) + '"' : 'Search'}</h1><span class="cat-ct">${videos.length} result${videos.length !== 1 ? 's' : ''}</span></div>
    <div class="grid">${videos.length ? videos.map(videoCard).join('') : `<p class="empty">${query ? 'No results found.' : 'Enter a search term above.'}</p>`}</div>
  </section>`;
}

// ── Layout ──

export function renderPage(title, body, categories, activeCat) {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${e(title)} — DeenSubs</title>
<meta name="description" content="Arabic Islamic lectures with accurate English subtitles, powered by AI.">
<meta property="og:title" content="${e(title)} — DeenSubs">
<meta property="og:type" content="website">
<meta property="og:description" content="Arabic Islamic lectures with AI-powered English subtitles.">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Amiri:wght@400;700&family=Outfit:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body>
<div class="grain"></div>
<nav class="nav"><div class="nav-in">
  <a href="/" class="logo"><div class="logo-m"><svg viewBox="0 0 28 28" fill="none"><rect x="4" y="4" width="20" height="20" stroke="rgba(196,164,76,0.5)" stroke-width="0.7"/><rect x="4" y="4" width="20" height="20" stroke="rgba(196,164,76,0.5)" stroke-width="0.7" transform="rotate(45 14 14)"/></svg><span>د</span></div><span class="logo-t">DeenSubs</span></a>
  <div class="nav-pills"><a href="/" class="pill${!activeCat ? ' on' : ''}">All</a>${categories.map(c => `<a href="/category/${e(c.slug)}" class="pill${activeCat === c.slug ? ' on' : ''}">${e(c.name)}</a>`).join('')}</div>
  <form action="/search" method="get" class="nav-search"><input type="search" name="q" placeholder="Search..." aria-label="Search" autocomplete="off"></form>
</div></nav>
<main class="wrap">${body}</main>
<footer class="ft"><div class="ft-in"><span>&copy; 2026 DeenSubs</span><a href="https://github.com/Muno459/deensubs" target="_blank" rel="noopener">GitHub</a></div></footer>
</body></html>`;
}

// ── Watch Page JS ──

const WATCH_JS = `
(function(){
var vid=document.getElementById('vid'),vp=document.getElementById('vp'),bar=document.getElementById('vp-bar'),
big=document.getElementById('vp-big'),pp=document.getElementById('vp-pp'),ppI=document.getElementById('pp-icon'),
seek=document.getElementById('vp-seek'),prog=document.getElementById('vp-prog'),buf=document.getElementById('vp-buf'),
timeEl=document.getElementById('vp-time'),ccBtn=document.getElementById('vp-cc'),spdBtn=document.getElementById('vp-spd'),
fsBtn=document.getElementById('vp-fs'),trList=document.getElementById('tr-list'),slug='__SLUG__',srtKey='__SRT__';

// Format time
function ft(s){if(!s||isNaN(s))return'0:00';var m=Math.floor(s/60),sec=Math.floor(s%60),h=Math.floor(m/60);return h>0?h+':'+String(m%60).padStart(2,'0')+':'+String(sec).padStart(2,'0'):m+':'+String(sec).padStart(2,'0')}

// Play/Pause
function toggle(){vid.paused?vid.play():vid.pause()}
pp.onclick=toggle;
big.onclick=function(){big.style.display='none';vid.play()};
vid.onclick=toggle;
vid.onplay=function(){ppI.setAttribute('d','M6 4h4v16H6zM14 4h4v16h-4z');big.style.display='none';vp.classList.add('playing')};
vid.onpause=function(){ppI.setAttribute('d','M8 5v14l11-7z');vp.classList.remove('playing')};

// Progress
vid.ontimeupdate=function(){
  if(vid.duration){
    var pct=(vid.currentTime/vid.duration)*100;
    prog.style.width=pct+'%';
    timeEl.textContent=ft(vid.currentTime)+' / '+ft(vid.duration);
    // Save progress
    try{localStorage.setItem('p_'+slug,JSON.stringify({t:vid.currentTime,d:vid.duration,ts:Date.now()}))}catch(e){}
    // Transcript sync
    if(trList){
      var lines=trList.children;
      for(var i=0;i<lines.length;i++){
        var l=lines[i],s=+l.dataset.s,en=+l.dataset.e,act=vid.currentTime>=s&&vid.currentTime<en;
        if(act&&!l.classList.contains('tr-on')){l.classList.add('tr-on');l.scrollIntoView({block:'nearest',behavior:'smooth'})}
        else if(!act)l.classList.remove('tr-on');
      }
    }
  }
};
// Buffered
vid.onprogress=function(){if(vid.buffered.length>0){buf.style.width=(vid.buffered.end(vid.buffered.length-1)/vid.duration*100)+'%'}};

// Seek
seek.onclick=function(ev){var r=seek.getBoundingClientRect();vid.currentTime=(ev.clientX-r.left)/r.width*vid.duration};
var seeking=false;
seek.onmousedown=function(){seeking=true};
document.onmousemove=function(ev){if(seeking){var r=seek.getBoundingClientRect();var p=Math.max(0,Math.min(1,(ev.clientX-r.left)/r.width));prog.style.width=p*100+'%'}};
document.onmouseup=function(ev){if(seeking){seeking=false;var r=seek.getBoundingClientRect();vid.currentTime=Math.max(0,Math.min(1,(ev.clientX-r.left)/r.width))*vid.duration}};

// Subtitles
var ccOn=true;
if(srtKey){
  fetch('/api/media/'+srtKey).then(function(r){return r.text()}).then(function(srt){
    var vtt='WEBVTT\\n\\n'+srt.replace(/(\\d{2}:\\d{2}:\\d{2}),(\\d{3})/g,'$1.$2');
    var b=new Blob([vtt],{type:'text/vtt'});var t=document.createElement('track');
    t.kind='subtitles';t.label='English';t.srclang='en';t.src=URL.createObjectURL(b);t.default=true;
    vid.appendChild(t);setTimeout(function(){if(t.track)t.track.mode='showing'},100);
  }).catch(function(){});
}
ccBtn.onclick=function(){
  var tracks=vid.textTracks;if(tracks.length){ccOn=!ccOn;tracks[0].mode=ccOn?'showing':'hidden';ccBtn.classList.toggle('vp-on',ccOn)}
};

// Speed
var speeds=[0.5,0.75,1,1.25,1.5,2],si=2;
spdBtn.onclick=function(){si=(si+1)%speeds.length;vid.playbackRate=speeds[si];spdBtn.textContent=speeds[si]+'x'};

// Fullscreen
fsBtn.onclick=function(){if(document.fullscreenElement)document.exitFullscreen();else vp.requestFullscreen().catch(function(){})};

// Keyboard
document.onkeydown=function(ev){
  if(ev.target.tagName==='INPUT'||ev.target.tagName==='TEXTAREA')return;
  switch(ev.key){
    case' ':case'k':ev.preventDefault();toggle();break;
    case'ArrowLeft':case'j':vid.currentTime=Math.max(0,vid.currentTime-10);break;
    case'ArrowRight':case'l':vid.currentTime=Math.min(vid.duration,vid.currentTime+10);break;
    case'f':fsBtn.click();break;
    case'm':vid.muted=!vid.muted;break;
    case'c':ccBtn.click();break;
  }
};

// Resume
try{var saved=JSON.parse(localStorage.getItem('p_'+slug));if(saved&&saved.t>5&&saved.t<saved.d-10)vid.currentTime=saved.t}catch(e){}

// Transcript click
if(trList){trList.onclick=function(ev){var line=ev.target.closest('.tr-line');if(line){vid.currentTime=+line.dataset.s;vid.play()}}}

// Bookmark
var bkBtn=document.getElementById('bk-btn');
var bks=JSON.parse(localStorage.getItem('deensubs_bk')||'[]');
function updateBk(){var saved=bks.indexOf(slug)!==-1;bkBtn.classList.toggle('w-act-on',saved);bkBtn.querySelector('span').textContent=saved?'Saved':'Save'}
updateBk();
bkBtn.onclick=function(){var i=bks.indexOf(slug);if(i===-1)bks.push(slug);else bks.splice(i,1);localStorage.setItem('deensubs_bk',JSON.stringify(bks));updateBk();toast(i===-1?'Bookmarked':'Removed')};

// Share
document.getElementById('sh-btn').onclick=function(){navigator.clipboard.writeText(location.href).then(function(){toast('Link copied')}).catch(function(){})};

// Toast
function toast(msg){var t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(function(){t.classList.remove('show')},2500)}

// Comments
var form=document.getElementById('cm-form'),list=document.getElementById('cm-list');
form.onsubmit=function(ev){
  ev.preventDefault();var btn=form.querySelector('button');btn.disabled=true;
  fetch('/api/videos/'+slug+'/comments',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({author:form.author.value.trim(),content:form.content.value.trim()})
  }).then(function(r){return r.json()}).then(function(d){
    if(d.comment){var div=document.createElement('div');div.className='cm cm-new';
      div.innerHTML='<div class="cm-head"><strong>'+d.comment.author.replace(/</g,'&lt;')+'</strong><time>just now</time></div><p>'+d.comment.content.replace(/</g,'&lt;')+'</p>';
      list.insertBefore(div,list.firstChild);form.reset();
      var h=document.querySelector('.cm-sec h2'),n=list.children.length;h.textContent=n+' Comment'+(n!==1?'s':'');
    }
  }).catch(function(){}).finally(function(){btn.disabled=false});
};
})();`;

// ── CSS ──

const CSS = `
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#050507;--s1:#0b0b10;--s2:#111118;--s3:#191920;--bd:rgba(196,164,76,0.06);--bdh:rgba(196,164,76,0.15);--gold:#c4a44c;--gd:rgba(196,164,76,0.07);--tx:#eae6da;--t2:#807c72;--t3:#4a4840;--r:10px}
html{scroll-behavior:smooth}
body{font-family:'Outfit',system-ui,sans-serif;background:var(--bg);color:var(--tx);line-height:1.6;-webkit-font-smoothing:antialiased}
::selection{background:rgba(196,164,76,.25)}a{color:inherit;text-decoration:none}
.grain{position:fixed;inset:0;pointer-events:none;z-index:9999;opacity:.018;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}

/* Nav */
.nav{position:sticky;top:0;z-index:100;background:rgba(5,5,7,.94);backdrop-filter:blur(20px) saturate(1.2);border-bottom:1px solid var(--bd)}
.nav-in{max-width:1320px;margin:0 auto;padding:.6rem 1.25rem;display:flex;align-items:center;gap:1rem}
.logo{display:flex;align-items:center;gap:.55rem;flex-shrink:0}
.logo-m{width:26px;height:26px;position:relative;display:flex;align-items:center;justify-content:center}
.logo-m svg{position:absolute;inset:0}
.logo-m span{font-family:'Amiri',serif;font-size:.8rem;font-weight:700;color:var(--gold);position:relative;z-index:1}
.logo-t{font-family:'Cormorant Garamond',serif;font-size:1.15rem;font-weight:600;letter-spacing:.03em}
.nav-pills{display:flex;gap:.3rem;overflow-x:auto;scrollbar-width:none;flex:1;-ms-overflow-style:none}
.nav-pills::-webkit-scrollbar{display:none}
.pill{padding:.3rem .7rem;border-radius:100px;font-size:.7rem;font-weight:500;color:var(--t2);white-space:nowrap;transition:all .2s;border:1px solid transparent}
.pill:hover{color:var(--tx);background:var(--s2)}
.pill.on{background:var(--gd);color:var(--gold);border-color:rgba(196,164,76,.1)}
.nav-search{flex-shrink:0}
.nav-search input{background:var(--s2);border:1px solid var(--bd);border-radius:8px;padding:.35rem .75rem;color:var(--tx);font:inherit;font-size:.78rem;width:180px;transition:border-color .2s,width .3s}
.nav-search input:focus{outline:none;border-color:var(--gold);width:240px}
.nav-search input::placeholder{color:var(--t3)}

/* Main */
.wrap{max-width:1320px;margin:0 auto;padding:1.25rem 1.25rem 4rem;min-height:70vh}

/* Hero Featured */
.hero-feat{margin-bottom:1.5rem}
.hf-card{display:grid;grid-template-columns:1.3fr 1fr;border-radius:var(--r);overflow:hidden;background:var(--s1);border:1px solid var(--bd);transition:all .35s ease}
.hf-card:hover{border-color:var(--bdh);box-shadow:0 12px 40px rgba(0,0,0,.35)}
.hf-thumb{aspect-ratio:16/9;background:var(--s2);position:relative;overflow:hidden;background-size:cover;background-position:center}
.hf-thumb .th-svg{position:absolute;inset:0;width:100%;height:100%}
.hf-overlay{position:absolute;inset:0;background:rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .3s}
.hf-card:hover .hf-overlay{opacity:1}
.hf-play{width:56px;height:56px;border-radius:50%;background:rgba(196,164,76,.85);display:flex;align-items:center;justify-content:center;box-shadow:0 6px 28px rgba(196,164,76,.25)}
.hf-play::after{content:'';border-style:solid;border-width:10px 0 10px 17px;border-color:transparent transparent transparent var(--bg);margin-left:3px}
.hf-badge{position:absolute;top:.85rem;left:.85rem;padding:.2rem .6rem;background:rgba(5,5,7,.65);backdrop-filter:blur(10px);border:1px solid rgba(196,164,76,.1);border-radius:100px;font-size:.62rem;font-weight:500;color:var(--gold);z-index:2}
.hf-dur{position:absolute;bottom:.85rem;right:.85rem}
.hf-info{padding:1.75rem;display:flex;flex-direction:column;justify-content:center;gap:.35rem}
.hf-ar{font-family:'Amiri',serif;font-size:1.1rem;color:var(--gold);direction:rtl}
.hf-info h2{font-family:'Cormorant Garamond',serif;font-size:1.5rem;font-weight:600;line-height:1.25}
.hf-desc{color:var(--t2);font-size:.78rem;font-weight:300;line-height:1.6;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.hf-meta{display:flex;align-items:center;gap:.45rem;font-size:.7rem;color:var(--t2);flex-wrap:wrap;margin-top:.25rem}

/* Grid */
.sec{margin-top:.5rem}
.sec-head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:1rem}
.sec-head h1,.sec-head h2{font-family:'Cormorant Garamond',serif;font-size:1.25rem;font-weight:600}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1rem}

/* Card */
.card{background:var(--s1);border:1px solid var(--bd);border-radius:var(--r);overflow:hidden;transition:all .3s ease;display:block}
.card:hover{border-color:var(--bdh);transform:translateY(-3px);box-shadow:0 10px 32px rgba(0,0,0,.3)}
.card-thumb{aspect-ratio:16/9;background:var(--s2);position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;background-size:cover;background-position:center}
.card-thumb .th-svg{position:absolute;inset:0;width:100%;height:100%}
.card-play-i{width:36px;height:36px;border-radius:50%;background:rgba(196,164,76,.75);display:flex;align-items:center;justify-content:center;z-index:1;opacity:0;transform:scale(.8);transition:all .25s}
.card:hover .card-play-i{opacity:1;transform:scale(1)}
.card-play-i::after{content:'';border-style:solid;border-width:6px 0 6px 10px;border-color:transparent transparent transparent var(--bg);margin-left:2px}
.card-dur{position:absolute;bottom:.5rem;right:.5rem;padding:.1rem .4rem;background:rgba(0,0,0,.8);border-radius:4px;font-size:.65rem;font-weight:500;z-index:2}
.card-body{padding:.7rem .85rem .85rem}
.card-body h3{font-size:.82rem;font-weight:500;line-height:1.35;margin-bottom:.2rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card-meta{font-size:.65rem;color:var(--t3);display:flex;gap:.45rem;margin-bottom:.35rem}
.card-tags{display:flex;gap:.3rem;flex-wrap:wrap}
.tag{display:inline-block;padding:.12rem .45rem;background:color-mix(in srgb,var(--tc,var(--gold)) 8%,transparent);border-radius:100px;color:var(--tc,var(--gold));font-size:.6rem;font-weight:500}
.tag-sub{--tc:var(--t2);background:var(--s2)}

/* Watch */
.w-layout{display:grid;grid-template-columns:1fr 300px;gap:1.5rem;align-items:start}
.w-main{min-width:0}

/* Player */
.vp{position:relative;background:#000;border-radius:var(--r);overflow:hidden;aspect-ratio:16/9}
.vp video{display:block;width:100%;height:100%;object-fit:contain}
.vp video::cue{background:rgba(0,0,0,.75);color:#fff;font-family:'Outfit',sans-serif;font-size:.9rem;line-height:1.4}
.vp-big{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;cursor:pointer;background:rgba(0,0,0,.25);z-index:3;transition:opacity .3s}
.vp.playing .vp-big{opacity:0;pointer-events:none}
.vp-big-btn{width:64px;height:64px;border-radius:50%;background:rgba(196,164,76,.85);display:flex;align-items:center;justify-content:center;box-shadow:0 6px 30px rgba(196,164,76,.25)}
.vp-big-btn::after{content:'';border-style:solid;border-width:12px 0 12px 20px;border-color:transparent transparent transparent var(--bg);margin-left:4px}
.vp-bar{position:absolute;bottom:0;left:0;right:0;padding:2.5rem .75rem .5rem;background:linear-gradient(transparent,rgba(0,0,0,.85));display:flex;align-items:center;gap:.6rem;opacity:0;transition:opacity .25s;z-index:4}
.vp:hover .vp-bar,.vp:not(.playing) .vp-bar{opacity:1}
.vp-btn{background:none;border:none;color:rgba(255,255,255,.85);cursor:pointer;font-size:.75rem;padding:.2rem;display:flex;align-items:center;transition:color .15s}
.vp-btn:hover{color:#fff}
.vp-btn.vp-on{color:var(--gold)}
.vp-speed{font-weight:600;font-size:.7rem;min-width:24px}
.vp-seek{flex:1;height:4px;background:rgba(255,255,255,.15);border-radius:2px;cursor:pointer;position:relative}
.vp-buf{position:absolute;inset:0;border-radius:2px;background:rgba(255,255,255,.1);width:0}
.vp-prog{position:absolute;left:0;top:0;height:100%;border-radius:2px;background:var(--gold);width:0;transition:width .1s linear}
.vp-dot{position:absolute;right:-5px;top:-3px;width:10px;height:10px;background:var(--gold);border-radius:50%;opacity:0;transition:opacity .15s}
.vp:hover .vp-dot{opacity:1}
.vp-time{font-size:.7rem;color:rgba(255,255,255,.6);white-space:nowrap}

/* Watch info */
.w-info{padding:1rem 0}
.w-top{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;margin-bottom:.4rem}
.w-ar{font-family:'Amiri',serif;font-size:1rem;color:var(--gold);direction:rtl}
.w-info h1{font-family:'Cormorant Garamond',serif;font-size:1.4rem;font-weight:600;line-height:1.25}
.w-actions{display:flex;gap:.35rem;flex-shrink:0}
.w-act{display:flex;align-items:center;gap:.3rem;padding:.35rem .65rem;background:var(--s2);border:1px solid var(--bd);border-radius:8px;color:var(--t2);font:inherit;font-size:.7rem;cursor:pointer;transition:all .2s;text-decoration:none}
.w-act:hover{border-color:var(--bdh);color:var(--tx)}
.w-act-on{color:var(--gold);border-color:rgba(196,164,76,.15);background:var(--gd)}
.w-act svg{flex-shrink:0}
.w-meta{font-size:.75rem;color:var(--t2);display:flex;gap:.6rem;margin-bottom:.5rem;flex-wrap:wrap}
.w-tags{display:flex;gap:.35rem;margin-bottom:.75rem;flex-wrap:wrap}
.w-tags a.tag:hover{filter:brightness(1.2)}
.w-desc{font-size:.8rem;color:var(--t2);line-height:1.7;font-weight:300;padding:.85rem;background:var(--s1);border-radius:var(--r);border:1px solid var(--bd)}

/* Transcript */
.tr-wrap{border:1px solid var(--bd);border-radius:var(--r);background:var(--s1);margin:1rem 0;overflow:hidden}
.tr-toggle{padding:.75rem 1rem;cursor:pointer;font-family:'Cormorant Garamond',serif;font-size:1rem;font-weight:600;display:flex;align-items:center;justify-content:space-between;list-style:none}
.tr-toggle::-webkit-details-marker{display:none}
.tr-toggle::after{content:'\\25BC';font-size:.6rem;color:var(--t3);transition:transform .2s}
details[open] .tr-toggle::after{transform:rotate(180deg)}
.tr-count{font-family:'Outfit',sans-serif;font-size:.7rem;font-weight:400;color:var(--t3)}
.tr-list{max-height:320px;overflow-y:auto;padding:.25rem 0;scrollbar-width:thin;scrollbar-color:var(--s3) transparent}
.tr-line{display:flex;gap:.75rem;padding:.4rem 1rem;cursor:pointer;transition:background .15s;border-left:2px solid transparent}
.tr-line:hover{background:var(--s2)}
.tr-line.tr-on{background:var(--gd);border-left-color:var(--gold)}
.tr-t{font-size:.7rem;color:var(--t3);white-space:nowrap;padding-top:.1rem;min-width:36px}
.tr-line p{font-size:.8rem;line-height:1.5;color:var(--t2)}
.tr-line.tr-on p{color:var(--tx)}

/* Comments */
.cm-sec{border-top:1px solid var(--bd);padding-top:1.25rem;margin-top:.5rem}
.cm-sec h2{font-family:'Cormorant Garamond',serif;font-size:1.05rem;font-weight:600;margin-bottom:.85rem}
.cm-form{margin-bottom:1.25rem}
.cm-row{display:flex;gap:.5rem;margin-bottom:.5rem}
.cm-form input,.cm-form textarea{flex:1;background:var(--s1);border:1px solid var(--bd);border-radius:8px;padding:.55rem .75rem;color:var(--tx);font:inherit;font-size:.8rem;transition:border-color .2s;resize:vertical}
.cm-form input:focus,.cm-form textarea:focus{outline:none;border-color:var(--gold)}
.cm-form input::placeholder,.cm-form textarea::placeholder{color:var(--t3)}
.cm-form button{padding:.55rem 1.25rem;background:var(--gold);color:var(--bg);border:none;border-radius:8px;font:inherit;font-size:.78rem;font-weight:600;cursor:pointer;transition:all .2s;white-space:nowrap}
.cm-form button:hover{filter:brightness(1.1)}
.cm-form button:disabled{opacity:.5}
.cm{padding:.85rem 0;border-bottom:1px solid var(--bd)}
.cm:last-child{border-bottom:none}
.cm-head{display:flex;align-items:baseline;gap:.5rem;margin-bottom:.2rem}
.cm-head strong{font-size:.8rem}
.cm-head time{font-size:.65rem;color:var(--t3)}
.cm p{font-size:.8rem;color:var(--t2);line-height:1.55}
.cm-new{animation:cmIn .35s ease}
@keyframes cmIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}

/* Sidebar */
.w-side{position:sticky;top:4rem}
.w-side h3{font-family:'Cormorant Garamond',serif;font-size:.95rem;font-weight:600;margin-bottom:.6rem;padding-bottom:.4rem;border-bottom:1px solid var(--bd)}
.sc{display:flex;gap:.6rem;padding:.45rem 0;transition:background .15s;border-radius:6px}
.sc:hover{background:var(--s2)}
.sc-thumb{width:120px;aspect-ratio:16/9;background:var(--s2);border-radius:6px;flex-shrink:0;overflow:hidden;position:relative;background-size:cover;background-position:center}
.sc-thumb .th-svg{position:absolute;inset:0;width:100%;height:100%}
.sc-info{min-width:0;display:flex;flex-direction:column;justify-content:center;gap:.1rem}
.sc-info h4{font-size:.72rem;font-weight:500;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.sc-info span{font-size:.6rem;color:var(--t3)}

/* Category */
.cat-hd{display:flex;align-items:baseline;gap:.6rem}
.cat-ar{font-family:'Amiri',serif;font-size:1.2rem;color:var(--gold);direction:rtl}
.cat-ct{font-size:.72rem;color:var(--t3)}

/* Toast */
.toast{position:fixed;bottom:2rem;left:50%;transform:translateX(-50%) translateY(20px);background:var(--s3);border:1px solid var(--bdh);color:var(--tx);padding:.5rem 1.25rem;border-radius:8px;font-size:.8rem;opacity:0;transition:all .3s;z-index:200;pointer-events:none}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}

/* Misc */
.empty{grid-column:1/-1;text-align:center;padding:3rem;color:var(--t3);font-size:.85rem}
.empty-s{color:var(--t3);font-size:.75rem;padding:.75rem 0}
.ft{border-top:1px solid var(--bd);padding:1.25rem 0}
.ft-in{max-width:1320px;margin:0 auto;padding:0 1.25rem;display:flex;align-items:center;justify-content:space-between;font-size:.68rem;color:var(--t3)}
.ft a{color:var(--t3);transition:color .2s}.ft a:hover{color:var(--gold)}

/* Responsive */
@media(max-width:960px){
  .w-layout{grid-template-columns:1fr}.w-side{position:static;margin-top:1rem}
  .hf-card{grid-template-columns:1fr}.hf-thumb{aspect-ratio:16/9}.hf-info{padding:1.25rem}
}
@media(max-width:640px){
  .nav-in{gap:.6rem;flex-wrap:wrap}.nav-pills{order:3;flex:none;width:100%}.nav-search input{width:120px}
  .nav-search input:focus{width:160px}.logo-t{display:none}
  .grid{grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}
  .wrap{padding:1rem 1rem 3rem}
  .w-top{flex-direction:column;gap:.5rem}.w-actions{align-self:flex-start}
  .sc-thumb{width:100px}
}
`;
