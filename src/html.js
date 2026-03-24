// ── Utilities ──
function e(s) { return s == null ? '' : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function ago(d) { if (!d) return ''; const s = Math.floor((Date.now() - new Date(d+'Z').getTime()) / 1000); if (s<60) return 'just now'; if (s<3600) return Math.floor(s/60)+'m ago'; if (s<86400) return Math.floor(s/3600)+'h ago'; if (s<2592000) return Math.floor(s/86400)+'d ago'; return new Date(d).toLocaleDateString('en',{month:'short',day:'numeric',year:'numeric'}); }
function fv(n) { return !n ? '0 views' : n>=1e6 ? (n/1e6).toFixed(1)+'M views' : n>=1e3 ? (n/1e3).toFixed(1)+'K views' : n+' views'; }
function fl(n) { return !n ? '' : n>=1e3 ? (n/1e3).toFixed(1)+'K' : String(n); }
function ft(sec) { if (!sec||isNaN(sec)) return '0:00'; const m=Math.floor(sec/60),s=Math.floor(sec%60),h=Math.floor(m/60); return h>0?h+':'+String(m%60).padStart(2,'0')+':'+String(s).padStart(2,'0'):m+':'+String(s).padStart(2,'0'); }
function thu(v) { return v.thumb_key ? '/api/media/'+v.thumb_key : null; }

// ── Thumbnail SVG ──
function tsvg(title,color,w,h) {
  w=w||320;h=h||180; let x=0; for(let i=0;i<title.length;i++) x=((x<<5)-x+title.charCodeAt(i))|0; x=Math.abs(x);
  const cx=w*.35+(x%(w*.3)),cy=h*.22+((x>>4)%(h*.5)),s=Math.min(w,h)*.22+((x>>8)%(Math.min(w,h)*.18));
  const cx2=w*.7+((x>>12)%(w*.2)),cy2=h*.65+((x>>16)%(h*.2)),s2=s*.5;
  return `<svg viewBox="0 0 ${w} ${h}" fill="none" class="tsvg"><rect width="${w}" height="${h}" fill="#07070d"/>
<circle cx="${cx}" cy="${cy}" r="${s*1.5}" fill="${color}" opacity=".03"/>
<g opacity=".12"><rect x="${cx-s/2}" y="${cy-s/2}" width="${s}" height="${s}" stroke="${color}" stroke-width=".7" transform="rotate(45 ${cx} ${cy})"/>
<rect x="${cx-s/2}" y="${cy-s/2}" width="${s}" height="${s}" stroke="${color}" stroke-width=".7"/></g>
<circle cx="${cx}" cy="${cy}" r="${s*.18}" stroke="${color}" stroke-width=".4" opacity=".08"/>
<g opacity=".06"><rect x="${cx2-s2/2}" y="${cy2-s2/2}" width="${s2}" height="${s2}" stroke="${color}" stroke-width=".5" transform="rotate(45 ${cx2} ${cy2})"/>
<rect x="${cx2-s2/2}" y="${cy2-s2/2}" width="${s2}" height="${s2}" stroke="${color}" stroke-width=".5"/></g></svg>`;
}

// ── Video Card ──
function isNew(d) { return d && (Date.now() - new Date(d+'Z').getTime()) < 7*86400000; }

function vcard(v,opts) {
  opts=opts||{};
  const th=thu(v),col=v.category_color||'#c4a44c',fresh=isNew(v.created_at);
  return `<a href="/watch/${e(v.slug)}" class="card${opts.anim?' card-anim':''}">
<div class="card-th"${th?` data-bg="${e(th)}"`:''}>
  ${!th?tsvg(v.title,col):''}
  <div class="card-hover"><div class="card-pi"></div></div>
  ${v.duration?`<span class="dur">${ft(v.duration)}</span>`:''}
  ${fresh?'<span class="badge-new">NEW</span>':''}
</div>
<div class="card-bd">
  <h3>${e(v.title)}</h3>
  ${v.title_ar?`<div class="card-ar">${e(v.title_ar)}</div>`:''}
  <div class="card-mt">
    ${v.source?`<span>${e(v.source)}</span>`:''}
    <span>${fv(v.views)}</span>
    ${v.likes?`<span>${fl(v.likes)} likes</span>`:''}
  </div>
  <div class="card-tg">
    ${v.category_name?`<span class="tag" style="--tc:${e(col)}">${e(v.category_name)}</span>`:''}
    ${v.srt_key?'<span class="tag tag-s">CC</span>':''}
  </div>
</div></a>`;
}

// ── Sidebar Card ──
function scard(v) {
  const th=thu(v),col=v.category_color||'#c4a44c';
  return `<a href="/watch/${e(v.slug)}" class="sc">
<div class="sc-th"${th?` style="background-image:url('${e(th)}')"`:''}>
  ${!th?tsvg(v.title,col,140,79):''}${v.duration?`<span class="dur dur-s">${ft(v.duration)}</span>`:''}
</div>
<div class="sc-i"><h4>${e(v.title)}</h4><span>${v.source?e(v.source):''}</span><span>${fv(v.views)}</span></div></a>`;
}

// ── Section helper ──
function section(title,titleAr,items,opts) {
  opts=opts||{};
  if (!items.length) return '';
  return `<section class="sec${opts.scroll?' sec-scroll':''}">
<div class="sec-hd">${titleAr?`<span class="sec-ar">${e(titleAr)}</span>`:''}<h2>${title}</h2>${opts.link?`<a href="${e(opts.link)}" class="sec-more">View all &rarr;</a>`:''}</div>
<div class="${opts.scroll?'hscroll':'grid'}">${items.map((v,i)=>vcard(v,{anim:true})).join('')}</div></section>`;
}

// ═══ HOME ═══
export function renderHome({ featured, videos, popular, categories, byCategory }) {
  const catsWithContent = categories.filter(c => byCategory[c.slug]?.length);
  return `
<div id="cw-slot"></div>
${featured?`
<section class="hero">
  <a href="/watch/${e(featured.slug)}" class="hero-card">
    <div class="hero-th"${thu(featured)?` style="background-image:url('${e(thu(featured))}')"`:''}>
      ${!thu(featured)?tsvg(featured.title,featured.category_color||'#c4a44c',900,506):''}
      <div class="hero-ov">
        <div class="hero-pb"></div>
        <div class="hero-meta-ov">
          ${featured.source?`<span class="hero-badge">${e(featured.source)}</span>`:''}
          ${featured.duration?`<span class="dur hero-dur">${ft(featured.duration)}</span>`:''}
        </div>
      </div>
    </div>
    <div class="hero-info">
      ${featured.title_ar?`<div class="hero-ar">${e(featured.title_ar)}</div>`:''}
      <h1>${e(featured.title)}</h1>
      ${featured.description?`<p class="hero-desc">${e(featured.description)}</p>`:''}
      <div class="hero-mt">
        ${featured.category_name?`<span class="tag" style="--tc:${e(featured.category_color||'#c4a44c')}">${e(featured.category_name)}</span>`:''}
        <span class="tag tag-s">AR &rarr; EN</span>
        <span>${fv(featured.views)}</span>
        <span>${ago(featured.created_at)}</span>
      </div>
    </div>
  </a>
</section>`:''}

${popular.length>1?section('Popular','',popular,{scroll:true}):''}

${catsWithContent.map(c => {
  const cv = byCategory[c.slug];
  return section(c.name, c.name_ar, cv.slice(0,6), { link: '/category/'+c.slug });
}).join('')}

${section('All Videos','',videos)}

<script>${HOME_JS}</script>`;
}

// ═══ WATCH ═══
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
<script type="application/ld+json">${jsonLd}</script>
<div class="wl">
  <div class="wm">
    <div class="vp" id="vp">
      <video id="vid" crossorigin="anonymous" preload="metadata"${th?` poster="${e(th)}"`:''}><source src="/api/media/${e(video.video_key)}" type="video/mp4"></video>
      <div class="vp-spinner" id="vp-spin"></div>
      <button class="vp-mini-close" id="vp-mini-x">&times;</button>
      <div class="vp-seek-ind vp-seek-l" id="seek-l"><svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg><span>10s</span></div>
      <div class="vp-seek-ind vp-seek-r" id="seek-r"><svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M11.5 8c2.65 0 5.05.99 6.9 2.6L22 7v9h-9l3.62-3.62C15.23 11.22 13.46 10.5 11.5 10.5c-3.54 0-6.55 2.31-7.6 5.5L1.53 15.22C2.92 11.03 6.85 8 11.5 8z"/></svg><span>10s</span></div>
      <div class="vp-big" id="vp-big"><div class="vp-bigb"></div></div>
      <div class="vp-end" id="vp-end">
        <div class="vp-end-inner">
          <button class="vp-end-replay" id="vp-replay"><svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg><span>Replay</span></button>
          <div class="vp-end-next" id="vp-end-next"></div>
        </div>
      </div>
      <div class="vp-bar" id="vp-bar">
        <button class="vb" id="vpp" title="Play (k)"><svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path id="ppi" d="M8 5v14l11-7z"/></svg></button>
        <div class="vp-sk" id="vsk"><div class="vp-bf" id="vbf"></div><div class="vp-pg" id="vpg"><div class="vp-dot"></div></div></div>
        <span class="vp-tm" id="vtm">0:00 / 0:00</span>
        <button class="vb" id="vvol" title="Mute (m)"><svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path id="voli" d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 010 7.07" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></button>
        <input type="range" class="vb-vr" id="vvr" min="0" max="1" step=".05" value="1" title="Volume">
        <button class="vb" id="vcc" title="Subtitles (c)">CC</button>
        <button class="vb vb-spd" id="vspd" title="Speed">1x</button>
        <button class="vb" id="vthtr" title="Theater mode (t)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="2" y="4" width="20" height="16" rx="2"/></svg></button>
        <button class="vb" id="vpip" title="Picture-in-Picture"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="2" y="3" width="20" height="14" rx="2"/><rect x="11" y="9" width="10" height="7" rx="1" fill="currentColor" opacity=".3"/></svg></button>
        <button class="vb" id="vfs" title="Fullscreen (f)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/></svg></button>
      </div>
    </div>
    <div class="wi">
      <div class="wi-top">
        <div class="wi-tl">
          ${video.title_ar?`<div class="wi-ar">${e(video.title_ar)}</div>`:''}
          <h1>${e(video.title)}</h1>
        </div>
        <div class="wi-acts">
          <button class="wa" id="lk-btn" title="Like"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg><span id="lk-ct">${video.likes||0}</span></button>
          <button class="wa" id="bk-btn" title="Bookmark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg><span>Save</span></button>
          <button class="wa" id="sh-btn" title="Share"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg><span>Share</span></button>
          ${video.srt_key?`<a class="wa" href="/api/media/${e(video.srt_key)}" download title="Download subtitles"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>Subs</span></a>`:''}
        </div>
      </div>
      <div class="wi-mt">${video.source?`<span>${e(video.source)}</span>`:''}
        <span>${fv(video.views)}</span><span>${ago(video.created_at)}</span></div>
      <div class="wi-tgs">
        ${video.category_name?`<a href="/category/${e(video.category_slug)}" class="tag" style="--tc:${e(video.category_color)}">${e(video.category_name)}</a>`:''}
        <span class="tag tag-s">Arabic &rarr; English</span>
      </div>
      ${video.description?`<details class="wi-desc-wrap"><summary>Description</summary><p class="wi-desc">${e(video.description)}</p></details>`:''}
    </div>
    ${cues&&cues.length?`
    <details class="tr" open>
      <summary class="tr-hd">Transcript <span class="tr-ct">${cues.length} lines</span></summary>
      <div class="tr-ls" id="trl">${cues.map((c,i)=>`<div class="tl" data-i="${i}" data-s="${c.start}" data-e="${c.end}"><span class="tl-t">${ft(c.start)}</span><p>${e(c.text)}</p></div>`).join('')}</div>
    </details>`:''}
    <div class="cms">
      <h2>${comments.length} Comment${comments.length!==1?'s':''}</h2>
      <form id="cf" class="cf" data-slug="${e(video.slug)}">
        <div class="cf-r"><input name="author" placeholder="Your name" maxlength="100" required autocomplete="off"><button type="submit">Post</button></div>
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
<script>${WATCH_JS.replace('__SLUG__',e(video.slug)).replace('__SRT__',video.srt_key?e(video.srt_key):'').replace('__TITLE__',e(video.title).replace(/'/g,"\\\'")).replace('__THUMB__',thu(video)?e(thu(video)):'').replace('__SOURCE__',video.source?e(video.source):'')}</script>`;
}

function avatarColor(name) {
  let h=0;for(let i=0;i<name.length;i++)h=((h<<5)-h+name.charCodeAt(i))|0;
  const hues=['#c4a44c','#4c8ac4','#4ca476','#8a4cc4','#4cb4a4','#c44c6e','#c48a4c'];
  return hues[Math.abs(h)%hues.length];
}
function commentHTML(c) {
  const initials = e(c.author).split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  const col = avatarColor(c.author);
  return `<div class="cm"><div class="cm-av" style="background:${col}">${initials}</div><div class="cm-body"><div class="cm-h"><strong>${e(c.author)}</strong><time>${ago(c.created_at)}</time></div><p>${e(c.content)}</p></div></div>`;
}

// ═══ CATEGORY ═══
export function renderCategory({ category, videos, sort }) {
  return `<section class="sec">
<div class="sec-hd"><div class="cat-hd"><span class="sec-ar">${e(category.name_ar)}</span><h1>${e(category.name)}</h1></div>
<div class="cat-ctrls"><span class="cat-ct">${videos.length} video${videos.length!==1?'s':''}</span>
<div class="sort-btns"><a href="?sort=newest" class="sb${sort!=='popular'?' sb-on':''}">Newest</a><a href="?sort=popular" class="sb${sort==='popular'?' sb-on':''}">Popular</a></div></div></div>
<div class="grid">${videos.length?videos.map(v=>vcard(v,{anim:true})).join(''):'<p class="emp">No videos in this category yet.</p>'}</div></section>`;
}

// ═══ SEARCH ═══
export function renderSearch({ query, videos }) {
  return `<section class="sec">
<div class="sec-hd"><h1>${query?'Results for &ldquo;'+e(query)+'&rdquo;':'Search'}</h1><span class="cat-ct">${videos.length} result${videos.length!==1?'s':''}</span></div>
<div class="grid">${videos.length?videos.map(v=>vcard(v)).join(''):`<p class="emp">${query?'No results found. Try different keywords.':'Enter a search term above.'}</p>`}</div></section>`;
}

// ═══ ABOUT ═══
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

// ═══ BOOKMARKS ═══
export function renderBookmarks() {
  return `
<section class="sec">
  <div class="sec-hd"><h1>Saved Videos</h1></div>
  <div class="grid" id="bk-grid">
    <div class="skel-grid">${'<div class="skel-card"><div class="skel-th skel-shimmer"></div><div class="skel-bd"><div class="skel-line skel-shimmer"></div><div class="skel-line skel-line-s skel-shimmer"></div></div></div>'.repeat(4)}</div>
  </div>
</section>
<script>
(function(){
  var bks=JSON.parse(localStorage.getItem('ds_bk')||'[]');
  var grid=document.getElementById('bk-grid');
  if(!bks.length){grid.innerHTML='<p class="emp">No saved videos yet. Bookmark videos while watching to see them here.</p>';return}
  fetch('/api/videos').then(function(r){return r.json()}).then(function(d){
    var map={};d.videos.forEach(function(v){map[v.slug]=v});
    var found=bks.map(function(s){return map[s]}).filter(Boolean);
    if(!found.length){grid.innerHTML='<p class="emp">No saved videos found.</p>';return}
    grid.innerHTML=found.map(function(v){
      return '<a href="/watch/'+v.slug+'" class="card"><div class="card-th"'+(v.thumb_key?' data-bg="/api/media/'+v.thumb_key+'"':'')+'>'
        +(v.duration?'<span class="dur">'+Math.floor(v.duration/60)+':'+String(Math.floor(v.duration%60)).padStart(2,'0')+'</span>':'')
        +'</div><div class="card-bd"><h3>'+v.title.replace(/</g,'&lt;')+'</h3>'
        +'<div class="card-mt"><span>'+(v.source||'').replace(/</g,'&lt;')+'</span></div></div></a>';
    }).join('');
    // Lazy load
    grid.querySelectorAll('[data-bg]').forEach(function(el){
      el.style.backgroundImage="url('"+el.dataset.bg+"')";el.style.backgroundSize='cover';el.style.backgroundPosition='center';
    });
  }).catch(function(){grid.innerHTML='<p class="emp">Failed to load bookmarks.</p>'});
})();
</script>`;
}

// ═══ 404 ═══
export function render404() {
  return `<div class="e404">
<svg viewBox="0 0 200 200" fill="none" width="120" height="120"><rect x="50" y="50" width="100" height="100" stroke="rgba(196,164,76,.12)" stroke-width="1" transform="rotate(45 100 100)"/><rect x="50" y="50" width="100" height="100" stroke="rgba(196,164,76,.12)" stroke-width="1"/><circle cx="100" cy="100" r="20" stroke="rgba(196,164,76,.08)" stroke-width="1"/></svg>
<h1>404</h1><p>This page could not be found.</p><a href="/" class="e404-btn">Back to Home</a></div>`;
}

// ═══ ADMIN ═══
export function renderAdmin({ videos, categories, key, editing }) {
  const v = editing || {};
  const isEdit = !!editing;
  const formAction = isEdit ? `/admin/edit/${v.id}?key=${e(key)}` : `/admin/video?key=${e(key)}`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin — DeenSubs</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#0a0a0f;color:#e0e0e0;padding:2rem;max-width:900px;margin:0 auto}
h1{margin-bottom:1.5rem;color:#c4a44c}h2{margin:2rem 0 1rem;font-size:1.1rem}
form{background:#111;border:1px solid #222;border-radius:8px;padding:1.5rem;margin-bottom:2rem}
label{display:block;font-size:.8rem;color:#888;margin-bottom:.25rem;margin-top:.75rem}
input,select,textarea{width:100%;background:#0a0a0f;border:1px solid #222;border-radius:6px;padding:.5rem .75rem;color:#e0e0e0;font:inherit;font-size:.85rem}
input:focus,select:focus,textarea:focus{outline:none;border-color:#c4a44c}
button{margin-top:1rem;padding:.6rem 1.5rem;background:#c4a44c;color:#0a0a0f;border:none;border-radius:6px;font:inherit;font-weight:600;cursor:pointer}
button:hover{filter:brightness(1.1)}
table{width:100%;border-collapse:collapse;font-size:.82rem}th,td{text-align:left;padding:.5rem;border-bottom:1px solid #1a1a1a}
th{color:#888;font-weight:500}
.act{padding:.2rem .6rem;border-radius:4px;font-size:.75rem;cursor:pointer;margin:0;background:none;border:1px solid #444;color:#aaa}
.act:hover{border-color:#c4a44c;color:#c4a44c}
.del{color:#c44;border-color:#c44}.del:hover{background:#c44;color:#fff}
.acts{display:flex;gap:.3rem}
a{color:#c4a44c}.back{display:inline-block;margin-bottom:1rem;font-size:.85rem}</style></head>
<body><h1>DeenSubs Admin</h1>
${isEdit?`<a href="/admin?key=${e(key)}" class="back">&larr; Back to list</a>`:''}
<h2>${isEdit?'Edit Video':'Add Video'}</h2>
<form method="post" action="${formAction}">
<label>Title *</label><input name="title" required value="${e(v.title||'')}">
<label>Arabic Title</label><input name="title_ar" dir="rtl" value="${e(v.title_ar||'')}">
${!isEdit?`<label>Slug * (url-friendly)</label><input name="slug" required pattern="[a-z0-9-]+" value="${e(v.slug||'')}">`:'' }
<label>Description</label><textarea name="description" rows="3">${e(v.description||'')}</textarea>
<label>Category</label><select name="category_id">${categories.map(c=>`<option value="${c.id}"${v.category_id===c.id?' selected':''}>${e(c.name)}</option>`).join('')}</select>
<label>Source (e.g., Masjid al-Haram)</label><input name="source" value="${e(v.source||'')}">
<label>Duration (seconds)</label><input name="duration" type="number" value="${v.duration||''}">
<label>R2 Video Key *</label><input name="video_key" required value="${e(v.video_key||'')}">
<label>R2 Subtitle Key</label><input name="srt_key" value="${e(v.srt_key||'')}">
<label>R2 Thumbnail Key</label><input name="thumb_key" value="${e(v.thumb_key||'')}">
<button type="submit">${isEdit?'Save Changes':'Add Video'}</button></form>
${!isEdit?`<h2>Videos (${videos.length})</h2>
<table><tr><th>Title</th><th>Category</th><th>Views</th><th>Likes</th><th>Created</th><th></th></tr>
${videos.map(vi=>`<tr><td><a href="/watch/${e(vi.slug)}">${e(vi.title)}</a></td><td>${e(vi.category_name||'')}</td><td>${vi.views}</td><td>${vi.likes}</td><td>${ago(vi.created_at)}</td>
<td><div class="acts"><a href="/admin/edit/${vi.id}?key=${e(key)}" class="act">Edit</a><form method="post" action="/admin/delete/${vi.id}?key=${e(key)}" onsubmit="return confirm('Delete?')" style="margin:0"><button class="act del">Del</button></form></div></td></tr>`).join('')}
</table>`:''}</body></html>`;
}

// ═══ LAYOUT ═══
export function renderPage(title, body, categories, activeCat) {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="view-transition" content="same-origin">
<title>${e(title)} — DeenSubs</title>
<meta name="description" content="Arabic Islamic lectures with accurate English subtitles, powered by AI.">
<meta property="og:title" content="${e(title)} — DeenSubs"><meta property="og:type" content="website">
<meta property="og:description" content="Arabic Islamic lectures with AI-powered English subtitles.">
<link rel="alternate" type="application/rss+xml" title="DeenSubs" href="/feed.xml">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#c4a44c">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Amiri:wght@400;700&family=Outfit:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body>
<a href="#main-content" class="skip-link">Skip to content</a>
<div class="grain"></div>
<div class="kb-modal" id="kb-modal"><div class="kb-inner"><h2>Keyboard Shortcuts</h2>
<div class="kb-grid">
<div class="kb-row"><kbd>Space</kbd><span>Play / Pause</span></div>
<div class="kb-row"><kbd>K</kbd><span>Play / Pause</span></div>
<div class="kb-row"><kbd>J</kbd><span>Rewind 10s</span></div>
<div class="kb-row"><kbd>L</kbd><span>Forward 10s</span></div>
<div class="kb-row"><kbd>&larr;</kbd><span>Rewind 10s</span></div>
<div class="kb-row"><kbd>&rarr;</kbd><span>Forward 10s</span></div>
<div class="kb-row"><kbd>F</kbd><span>Fullscreen</span></div>
<div class="kb-row"><kbd>M</kbd><span>Mute</span></div>
<div class="kb-row"><kbd>C</kbd><span>Toggle captions</span></div>
<div class="kb-row"><kbd>T</kbd><span>Theater mode</span></div>
<div class="kb-row"><kbd>?</kbd><span>Show this help</span></div>
</div><button class="kb-close" id="kb-close">Close</button></div></div>
<nav class="nav" id="nav">
  <div class="nav-in">
    <a href="/" class="logo"><div class="logo-m"><svg viewBox="0 0 28 28" fill="none"><rect x="4" y="4" width="20" height="20" stroke="rgba(196,164,76,.5)" stroke-width=".7"/><rect x="4" y="4" width="20" height="20" stroke="rgba(196,164,76,.5)" stroke-width=".7" transform="rotate(45 14 14)"/></svg><span>د</span></div><span class="logo-t">DeenSubs</span></a>
    <div class="nav-pills" id="pills"><a href="/" class="pill${!activeCat?' on':''}">All</a>${categories.map(c=>`<a href="/category/${e(c.slug)}" class="pill${activeCat===c.slug?' on':''}" style="--pc:${e(c.color)}">${e(c.name)}</a>`).join('')}</div>
    <form action="/search" method="get" class="nav-sf"><svg class="nav-si" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input type="search" name="q" placeholder="Search..." aria-label="Search" autocomplete="off"></form>
    <a href="/bookmarks" class="nav-icon" title="Saved"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg></a>
    <button class="nav-hb" id="hb" aria-label="Menu"><span></span><span></span><span></span></button>
  </div>
</nav>
<div class="mob-menu" id="mob">
  <div class="mob-in">
    <form action="/search" method="get" class="mob-sf"><input type="search" name="q" placeholder="Search..." autocomplete="off"></form>
    <div class="mob-links"><a href="/"${!activeCat?' class="on"':''}>All</a>${categories.map(c=>`<a href="/category/${e(c.slug)}"${activeCat===c.slug?' class="on"':''}>${e(c.name_ar)} ${e(c.name)}</a>`).join('')}
    <div class="mob-div"></div><a href="/bookmarks">Saved Videos</a><a href="/about">About</a></div>
  </div>
</div>
<main class="wrap" id="main-content">${body}</main>
<footer class="ft"><div class="ft-in">
  <div class="ft-brand"><div class="logo-m"><svg viewBox="0 0 28 28" fill="none"><rect x="4" y="4" width="20" height="20" stroke="rgba(196,164,76,.3)" stroke-width=".7"/><rect x="4" y="4" width="20" height="20" stroke="rgba(196,164,76,.3)" stroke-width=".7" transform="rotate(45 14 14)"/></svg><span>د</span></div><span>DeenSubs</span></div>
  <span class="ft-copy">&copy; 2026 DeenSubs — Making Islamic knowledge accessible</span>
  <div class="ft-links"><a href="/about">About</a><a href="/bookmarks">Saved</a><a href="/feed.xml">RSS</a><a href="https://github.com/Muno459/deensubs" target="_blank" rel="noopener">GitHub</a></div>
</div></footer>
<script>
document.getElementById('hb').onclick=function(){document.getElementById('mob').classList.toggle('open');document.body.classList.toggle('no-scroll')};
document.getElementById('mob').onclick=function(e){if(e.target===this){this.classList.remove('open');document.body.classList.remove('no-scroll')}};
</script>
</body></html>`;
}

// ═══ HOME JS ═══
const HOME_JS = `
(function(){
var slot=document.getElementById('cw-slot');
try{
  var keys=[];for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k.startsWith('p_'))keys.push(k)}
  var items=keys.map(function(k){try{var d=JSON.parse(localStorage.getItem(k));if(d&&d.t>10&&d.d&&d.t<d.d-30&&d.title)return{slug:k.slice(2),t:d.t,d:d.d,ts:d.ts||0,title:d.title,thumb:d.thumb||'',source:d.source||''};return null}catch(e){return null}}).filter(Boolean).sort(function(a,b){return b.ts-a.ts}).slice(0,6);
  if(items.length>0){
    var html='<section class="sec sec-cw"><div class="sec-hd"><h2>Continue Watching</h2></div><div class="hscroll">';
    items.forEach(function(it){
      var pct=Math.round(it.t/it.d*100);
      html+='<a href="/watch/'+it.slug+'" class="card card-cw">'
        +'<div class="card-th"'+(it.thumb?' style="background-image:url(\\''+it.thumb+'\\')"':'')+'>'
        +'<div class="cw-prog" style="width:'+pct+'%"></div></div>'
        +'<div class="card-bd"><h3>'+it.title.replace(/</g,'&lt;')+'</h3>'
        +'<div class="card-mt"><span>'+it.source.replace(/</g,'&lt;')+'</span></div></div></a>';
    });
    html+='</div></section>';
    slot.innerHTML=html;
  }
}catch(e){}

// Lazy load thumbnails
var lazyObs=new IntersectionObserver(function(entries){
  entries.forEach(function(en){if(en.isIntersecting){var bg=en.target.dataset.bg;if(bg){en.target.style.backgroundImage="url('"+bg+"')";en.target.style.backgroundSize="cover";en.target.style.backgroundPosition="center"}lazyObs.unobserve(en.target)}});
},{rootMargin:'200px'});
document.querySelectorAll('[data-bg]').forEach(function(el){lazyObs.observe(el)});

// Card stagger
var cards=document.querySelectorAll('.card-anim');
var cObs=new IntersectionObserver(function(entries){
  entries.forEach(function(en){if(en.isIntersecting){en.target.classList.add('card-vis');cObs.unobserve(en.target)}});
},{threshold:.05,rootMargin:'0px 0px -20px 0px'});
cards.forEach(function(c){cObs.observe(c)});
})();`;

// ═══ WATCH JS ═══
const WATCH_JS = `
(function(){
var vid=document.getElementById('vid'),vp=document.getElementById('vp'),bar=document.getElementById('vp-bar'),big=document.getElementById('vp-big'),
pp=document.getElementById('vpp'),ppi=document.getElementById('ppi'),sk=document.getElementById('vsk'),pg=document.getElementById('vpg'),
bf=document.getElementById('vbf'),tm=document.getElementById('vtm'),cc=document.getElementById('vcc'),spd=document.getElementById('vspd'),
fs=document.getElementById('vfs'),trl=document.getElementById('trl'),slug='__SLUG__',srt='__SRT__',
vTitle='__TITLE__',vThumb='__THUMB__',vSrc='__SOURCE__';

function ftt(s){if(!s||isNaN(s))return'0:00';var m=Math.floor(s/60),sec=Math.floor(s%60),h=Math.floor(m/60);return h>0?h+':'+String(m%60).padStart(2,'0')+':'+String(sec).padStart(2,'0'):m+':'+String(sec).padStart(2,'0')}
function toast(m){var t=document.getElementById('toast');t.textContent=m;t.classList.add('show');setTimeout(function(){t.classList.remove('show')},2500)}
function toggle(){vid.paused?vid.play():vid.pause()}

pp.onclick=toggle;big.onclick=function(){big.style.display='none';vid.play()};vid.onclick=toggle;
vid.onpause=function(){ppi.setAttribute('d','M8 5v14l11-7z');vp.classList.remove('playing')};

vid.ontimeupdate=function(){
  if(!vid.duration)return;
  pg.style.width=(vid.currentTime/vid.duration*100)+'%';
  tm.textContent=ftt(vid.currentTime)+' / '+ftt(vid.duration);
  try{localStorage.setItem('p_'+slug,JSON.stringify({t:vid.currentTime,d:vid.duration,ts:Date.now(),title:vTitle,thumb:vThumb,source:vSrc}))}catch(e){}
  if(trl){for(var i=0;i<trl.children.length;i++){var l=trl.children[i],a=vid.currentTime>=+l.dataset.s&&vid.currentTime<+l.dataset.e;
    if(a&&!l.classList.contains('tl-on')){l.classList.add('tl-on');l.scrollIntoView({block:'nearest',behavior:'smooth'})}
    else if(!a)l.classList.remove('tl-on')}}
};
vid.onprogress=function(){if(vid.buffered.length)bf.style.width=(vid.buffered.end(vid.buffered.length-1)/vid.duration*100)+'%'};

var seeking=false;
sk.onmousedown=function(){seeking=true};
document.onmousemove=function(ev){if(seeking){var r=sk.getBoundingClientRect();pg.style.width=Math.max(0,Math.min(100,(ev.clientX-r.left)/r.width*100))+'%'}};
document.onmouseup=function(ev){if(seeking){seeking=false;var r=sk.getBoundingClientRect();vid.currentTime=Math.max(0,Math.min(1,(ev.clientX-r.left)/r.width))*vid.duration}};
sk.onclick=function(ev){var r=sk.getBoundingClientRect();vid.currentTime=(ev.clientX-r.left)/r.width*vid.duration};

if(srt){fetch('/api/media/'+srt).then(function(r){return r.text()}).then(function(s){
  var vtt='WEBVTT\\n\\n'+s.replace(/(\\d{2}:\\d{2}:\\d{2}),(\\d{3})/g,'$1.$2');
  var b=new Blob([vtt],{type:'text/vtt'});var t=document.createElement('track');
  t.kind='subtitles';t.label='English';t.srclang='en';t.src=URL.createObjectURL(b);t.default=true;
  vid.appendChild(t);setTimeout(function(){if(t.track)t.track.mode='showing'},100)}).catch(function(){})}

// Volume
var vvol=document.getElementById('vvol'),vvr=document.getElementById('vvr'),voli=document.getElementById('voli');
vvr.oninput=function(){vid.volume=+vvr.value;vid.muted=false;updVol()};
vvol.onclick=function(){vid.muted=!vid.muted;if(!vid.muted&&vid.volume===0){vid.volume=1;vvr.value=1}updVol()};
function updVol(){var v=vid.muted?0:vid.volume;vvr.value=vid.muted?0:vid.volume;
  voli.innerHTML=v===0?'<path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" stroke-width="1.5"/><line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" stroke-width="1.5"/>'
    :v<.5?'<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 010 7.07" fill="none" stroke="currentColor" stroke-width="1.5"/>'
    :'<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 010 7.07" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M19.07 4.93a10 10 0 010 14.14" fill="none" stroke="currentColor" stroke-width="1.5"/>'}

// Timestamp from URL
var urlT=new URLSearchParams(location.search).get('t');
if(urlT){vid.currentTime=parseFloat(urlT);setTimeout(function(){vid.play()},300)}

var ccOn=true;cc.onclick=function(){var t=vid.textTracks;if(t.length){ccOn=!ccOn;t[0].mode=ccOn?'showing':'hidden';cc.classList.toggle('vb-on',ccOn)}};
var spds=[.5,.75,1,1.25,1.5,2],si=2;
spd.onclick=function(){si=(si+1)%spds.length;vid.playbackRate=spds[si];spd.textContent=spds[si]+'x'};
fs.onclick=function(){document.fullscreenElement?document.exitFullscreen():vp.requestFullscreen().catch(function(){})};

document.onkeydown=function(ev){if(ev.target.tagName==='INPUT'||ev.target.tagName==='TEXTAREA')return;
  switch(ev.key){case' ':case'k':ev.preventDefault();toggle();break;case'ArrowLeft':case'j':vid.currentTime=Math.max(0,vid.currentTime-10);break;
  case'ArrowRight':case'l':vid.currentTime=Math.min(vid.duration,vid.currentTime+10);break;case'f':fs.click();break;case't':thtrBtn.click();break;case'm':vid.muted=!vid.muted;updVol();break;case'c':cc.click();break;
  case'?':var km=document.getElementById('kb-modal');km.classList.toggle('kb-open');break;case'Escape':document.getElementById('kb-modal').classList.remove('kb-open');break}};

// Theater mode
var thtrBtn=document.getElementById('vthtr'),wl=document.querySelector('.wl');
thtrBtn.onclick=function(){wl.classList.toggle('theater');thtrBtn.classList.toggle('vb-on')};

// Mini player on scroll
var vpRect=null,isMini=false,miniX=document.getElementById('vp-mini-x');
function checkMini(){
  if(!vid.paused&&!document.fullscreenElement){
    if(!vpRect)vpRect=vp.parentElement.getBoundingClientRect();
    var scrolledPast=window.scrollY>vpRect.bottom+100;
    if(scrolledPast&&!isMini){isMini=true;vp.classList.add('vp-mini')}
    else if(!scrolledPast&&isMini){isMini=false;vp.classList.remove('vp-mini')}
  }else if(isMini){isMini=false;vp.classList.remove('vp-mini')}
}
window.addEventListener('scroll',checkMini,{passive:true});
vid.onplay=function(){ppi.setAttribute('d','M6 4h4v16H6zM14 4h4v16h-4z');big.style.display='none';vp.classList.add('playing');vpRect=vp.parentElement.getBoundingClientRect();
  document.getElementById('vp-end').classList.remove('vp-end-on')};
miniX.onclick=function(ev){ev.stopPropagation();vid.pause();isMini=false;vp.classList.remove('vp-mini')};

// End screen
var endScreen=document.getElementById('vp-end'),endNext=document.getElementById('vp-end-next');
var relCards=document.querySelectorAll('.sc');
if(relCards.length){
  var endHtml='';
  for(var ri=0;ri<Math.min(relCards.length,3);ri++){
    var rc=relCards[ri],rth=rc.querySelector('.sc-th'),rh=rc.querySelector('h4');
    var bgStyle=rth?rth.getAttribute('style')||'':'';
    endHtml+='<a href="'+rc.href+'" class="vp-end-card"><div class="vp-end-card-th" '+bgStyle+'></div><h5>'+(rh?rh.textContent:'')+'</h5></a>';
  }
  endNext.innerHTML=endHtml;
}
vid.addEventListener('ended',function(){endScreen.classList.add('vp-end-on');if(isMini){isMini=false;vp.classList.remove('vp-mini')}});
document.getElementById('vp-replay').onclick=function(){endScreen.classList.remove('vp-end-on');vid.currentTime=0;vid.play()};

// Buffering spinner
var spin=document.getElementById('vp-spin');
vid.onwaiting=function(){spin.classList.add('vp-spin-on')};
vid.onplaying=function(){spin.classList.remove('vp-spin-on')};
vid.oncanplay=function(){spin.classList.remove('vp-spin-on')};

// Double-tap to seek
var tapTimer=null,tapSide='';
vp.addEventListener('dblclick',function(ev){
  if(ev.target.closest('.vp-bar')||ev.target.closest('.vp-big'))return;
  var rect=vp.getBoundingClientRect(),x=ev.clientX-rect.left,half=rect.width/2;
  if(x<half){vid.currentTime=Math.max(0,vid.currentTime-10);var sl=document.getElementById('seek-l');sl.classList.add('vp-seek-show');setTimeout(function(){sl.classList.remove('vp-seek-show')},600)}
  else{vid.currentTime=Math.min(vid.duration,vid.currentTime+10);var sr=document.getElementById('seek-r');sr.classList.add('vp-seek-show');setTimeout(function(){sr.classList.remove('vp-seek-show')},600)}
});

// Comment char counter
var cfTa=document.getElementById('cf-ta'),cfCt=document.getElementById('cf-ct');
if(cfTa&&cfCt){cfTa.oninput=function(){var rem=2000-cfTa.value.length;cfCt.textContent=rem;cfCt.classList.toggle('cf-ct-warn',rem<200)}}

// Scroll progress + back to top
var scrollProg=document.getElementById('scroll-prog'),bttBtn=document.getElementById('btt');
window.addEventListener('scroll',function(){
  var h=document.documentElement.scrollHeight-window.innerHeight;
  if(h>0&&scrollProg)scrollProg.style.width=(window.scrollY/h*100)+'%';
  if(bttBtn)bttBtn.classList.toggle('btt-show',window.scrollY>600);
},{passive:true});
if(bttBtn)bttBtn.onclick=function(){window.scrollTo({top:0,behavior:'smooth'})};

// Linkify timestamps in comments
document.querySelectorAll('.cm p').forEach(function(p){
  p.innerHTML=p.innerHTML.replace(/(\d{1,2}):(\d{2})(?::(\d{2}))?/g,function(match,a,b,c){
    var secs=c?parseInt(a)*3600+parseInt(b)*60+parseInt(c):parseInt(a)*60+parseInt(b);
    return '<a class="cm-ts" data-t="'+secs+'">'+match+'</a>';
  });
});
document.querySelectorAll('.cm-ts').forEach(function(a){a.onclick=function(){vid.currentTime=+a.dataset.t;vid.play();window.scrollTo({top:0,behavior:'smooth'})}});

// PiP
var pipBtn=document.getElementById('vpip');
if(pipBtn&&document.pictureInPictureEnabled){pipBtn.onclick=function(){document.pictureInPictureElement?document.exitPictureInPicture():vid.requestPictureInPicture().catch(function(){})}}
else if(pipBtn)pipBtn.style.display='none';

// Keyboard modal close
document.getElementById('kb-close').onclick=function(){document.getElementById('kb-modal').classList.remove('kb-open')};
document.getElementById('kb-modal').onclick=function(ev){if(ev.target===this)this.classList.remove('kb-open')};
void 0

try{var sv=JSON.parse(localStorage.getItem('p_'+slug));if(sv&&sv.t>5&&sv.t<sv.d-10)vid.currentTime=sv.t}catch(e){}
if(trl)trl.onclick=function(ev){var l=ev.target.closest('.tl');if(l){vid.currentTime=+l.dataset.s;vid.play()}};

// Like
var lkBtn=document.getElementById('lk-btn'),lkCt=document.getElementById('lk-ct');
var liked=JSON.parse(localStorage.getItem('ds_likes')||'{}');
if(liked[slug])lkBtn.classList.add('wa-on');
lkBtn.onclick=function(){if(liked[slug])return toast('Already liked');
  fetch('/api/videos/'+slug+'/like',{method:'POST'}).then(function(r){return r.json()}).then(function(d){
    lkCt.textContent=d.likes;liked[slug]=1;localStorage.setItem('ds_likes',JSON.stringify(liked));lkBtn.classList.add('wa-on');toast('Liked!')}).catch(function(){})};

// Bookmark
var bkBtn=document.getElementById('bk-btn'),bks=JSON.parse(localStorage.getItem('ds_bk')||'[]');
function updBk(){var s=bks.indexOf(slug)!==-1;bkBtn.classList.toggle('wa-on',s);bkBtn.querySelector('span').textContent=s?'Saved':'Save'}
updBk();bkBtn.onclick=function(){var i=bks.indexOf(slug);if(i===-1)bks.push(slug);else bks.splice(i,1);localStorage.setItem('ds_bk',JSON.stringify(bks));updBk();toast(i===-1?'Bookmarked':'Removed')};

// Share
// Share with timestamp
document.getElementById('sh-btn').onclick=function(){
  var url=location.origin+location.pathname;
  if(vid.currentTime>5)url+='?t='+Math.floor(vid.currentTime);
  navigator.clipboard.writeText(url).then(function(){toast(vid.currentTime>5?'Link with timestamp copied':'Link copied')}).catch(function(){})};

// (end screen handles video end now)

// Comments
var cf=document.getElementById('cf'),cl=document.getElementById('cl');
cf.onsubmit=function(ev){ev.preventDefault();var btn=cf.querySelector('button');btn.disabled=true;
  fetch('/api/videos/'+slug+'/comments',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({author:cf.author.value.trim(),content:cf.content.value.trim()})
  }).then(function(r){return r.json()}).then(function(d){if(d.comment){var div=document.createElement('div');div.className='cm cm-new';
    var aName=d.comment.author.replace(/</g,'&lt;'),initials=aName.split(' ').map(function(w){return w[0]}).join('').slice(0,2).toUpperCase();
    var cols=['#c4a44c','#4c8ac4','#4ca476','#8a4cc4','#4cb4a4','#c44c6e','#c48a4c'],ah=0;
    for(var ci=0;ci<aName.length;ci++)ah=((ah<<5)-ah+aName.charCodeAt(ci))|0;
    div.innerHTML='<div class="cm-av" style="background:'+cols[Math.abs(ah)%cols.length]+'">'+initials+'</div><div class="cm-body"><div class="cm-h"><strong>'+aName+'</strong><time>just now</time></div><p>'+d.comment.content.replace(/</g,'&lt;')+'</p></div>';
    cl.insertBefore(div,cl.firstChild);cf.reset();var h=document.querySelector('.cms h2'),n=cl.children.length;h.textContent=n+' Comment'+(n!==1?'s':'')}
  }).catch(function(){}).finally(function(){btn.disabled=false})};
})();`;

// ═══ CSS ═══
const CSS = `
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#050507;--s1:#0b0b10;--s2:#111118;--s3:#191920;--bd:rgba(196,164,76,.06);--bdh:rgba(196,164,76,.14);--gold:#c4a44c;--gd:rgba(196,164,76,.06);--tx:#eae6da;--t2:#807c72;--t3:#4a4840;--r:10px}
html{scroll-behavior:smooth}body{font-family:'Outfit',system-ui,sans-serif;background:var(--bg);color:var(--tx);line-height:1.6;-webkit-font-smoothing:antialiased}
body.no-scroll{overflow:hidden}::selection{background:rgba(196,164,76,.25)}a{color:inherit;text-decoration:none}
.wrap{animation:pageIn .4s ease both}
@keyframes pageIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}

.grain{position:fixed;inset:0;pointer-events:none;z-index:9999;opacity:.015;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}

/* ── Nav ── */
.nav{position:sticky;top:0;z-index:100;background:rgba(5,5,7,.94);backdrop-filter:blur(20px) saturate(1.2);border-bottom:1px solid var(--bd)}
.nav-in{max-width:1320px;margin:0 auto;padding:.55rem 1.25rem;display:flex;align-items:center;gap:.85rem}
.logo{display:flex;align-items:center;gap:.5rem;flex-shrink:0;transition:opacity .2s}
.logo:hover{opacity:.8}
.logo-m{width:24px;height:24px;position:relative;display:flex;align-items:center;justify-content:center}
.logo-m svg{position:absolute;inset:0}.logo-m span{font-family:'Amiri',serif;font-size:.75rem;font-weight:700;color:var(--gold);position:relative;z-index:1}
.logo-t{font-family:'Cormorant Garamond',serif;font-size:1.1rem;font-weight:600;letter-spacing:.03em}
.nav-pills{display:flex;gap:.25rem;overflow-x:auto;scrollbar-width:none;flex:1;-ms-overflow-style:none}
.nav-pills::-webkit-scrollbar{display:none}
.pill{padding:.25rem .65rem;border-radius:100px;font-size:.68rem;font-weight:500;color:var(--t2);white-space:nowrap;transition:all .2s;border:1px solid transparent}
.pill:hover{color:var(--tx);background:var(--s2)}
.pill.on{background:var(--gd);color:var(--gold);border-color:rgba(196,164,76,.1)}
.nav-sf{flex-shrink:0;position:relative;display:flex;align-items:center}
.nav-si{position:absolute;left:.6rem;color:var(--t3);pointer-events:none}
.nav-sf input{background:var(--s2);border:1px solid var(--bd);border-radius:8px;padding:.3rem .6rem .3rem 2rem;color:var(--tx);font:inherit;font-size:.75rem;width:160px;transition:border-color .2s,width .3s}
.nav-sf input:focus{outline:none;border-color:var(--gold);width:220px}
.nav-sf input::placeholder{color:var(--t3)}
.nav-hb{display:none;background:none;border:none;cursor:pointer;padding:.4rem;flex-shrink:0}
.nav-hb span{display:block;width:16px;height:1.5px;background:var(--t2);margin:3px 0;transition:all .3s;border-radius:1px}

/* ── Mobile Menu ── */
.mob-menu{position:fixed;inset:0;z-index:150;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);opacity:0;pointer-events:none;transition:opacity .3s}
.mob-menu.open{opacity:1;pointer-events:auto}
.mob-in{position:absolute;right:0;top:0;bottom:0;width:280px;background:var(--s1);border-left:1px solid var(--bd);padding:1.5rem;transform:translateX(100%);transition:transform .3s ease}
.mob-menu.open .mob-in{transform:translateX(0)}
.mob-sf{margin-bottom:1rem}
.mob-sf input{width:100%;background:var(--s2);border:1px solid var(--bd);border-radius:8px;padding:.5rem .75rem;color:var(--tx);font:inherit;font-size:.85rem}
.mob-sf input:focus{outline:none;border-color:var(--gold)}
.mob-links{display:flex;flex-direction:column;gap:.15rem}
.mob-links a{padding:.6rem .75rem;border-radius:8px;font-size:.85rem;color:var(--t2);transition:all .2s}
.mob-links a:hover,.mob-links a.on{background:var(--gd);color:var(--gold)}

/* ── Main ── */
.wrap{max-width:1320px;margin:0 auto;padding:1.25rem 1.25rem 4rem;min-height:70vh}

/* ── Hero ── */
.hero{margin-bottom:1.75rem}
.hero-card{display:grid;grid-template-columns:1.4fr 1fr;border-radius:var(--r);overflow:hidden;background:var(--s1);border:1px solid var(--bd);transition:all .35s ease}
.hero-card:hover{border-color:var(--bdh);box-shadow:0 12px 44px rgba(0,0,0,.4)}
.hero-th{aspect-ratio:16/9;background:var(--s2);position:relative;overflow:hidden;background-size:cover;background-position:center;transition:transform .5s ease}
.hero-card:hover .hero-th{transform:scale(1.03)}
.hero-th .tsvg{position:absolute;inset:0;width:100%;height:100%}
.hero-ov{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;transition:background .3s}
.hero-card:hover .hero-ov{background:rgba(0,0,0,.2)}
.hero-pb{width:60px;height:60px;border-radius:50%;background:rgba(196,164,76,.85);display:flex;align-items:center;justify-content:center;box-shadow:0 6px 28px rgba(196,164,76,.25);opacity:0;transform:scale(.85);transition:all .3s}
.hero-card:hover .hero-pb{opacity:1;transform:scale(1)}
.hero-pb::after{content:'';border-style:solid;border-width:10px 0 10px 17px;border-color:transparent transparent transparent var(--bg);margin-left:3px}
.hero-meta-ov{position:absolute;top:.85rem;left:.85rem;right:.85rem;display:flex;justify-content:space-between;align-items:flex-start}
.hero-badge{padding:.2rem .6rem;background:rgba(5,5,7,.65);backdrop-filter:blur(10px);border:1px solid rgba(196,164,76,.1);border-radius:100px;font-size:.6rem;font-weight:500;color:var(--gold)}
.hero-dur{bottom:.85rem;right:.85rem;top:auto;position:absolute}
.hero-info{padding:1.75rem;display:flex;flex-direction:column;justify-content:center;gap:.3rem}
.hero-ar{font-family:'Amiri',serif;font-size:1.05rem;color:var(--gold);direction:rtl}
.hero-info h1{font-family:'Cormorant Garamond',serif;font-size:clamp(1.3rem,2.2vw,1.7rem);font-weight:600;line-height:1.25;background:linear-gradient(135deg,var(--tx) 0%,var(--gold) 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.hero-desc{color:var(--t2);font-size:.78rem;font-weight:300;line-height:1.65;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.hero-mt{display:flex;align-items:center;gap:.4rem;font-size:.68rem;color:var(--t2);flex-wrap:wrap;margin-top:.15rem}

/* ── Sections ── */
.sec{margin-top:2rem}.sec:first-child{margin-top:0}
.sec-hd{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:.85rem;gap:.75rem;flex-wrap:wrap}
.sec-hd h1,.sec-hd h2{font-family:'Cormorant Garamond',serif;font-size:1.2rem;font-weight:600}
.sec-ar{font-family:'Amiri',serif;font-size:1rem;color:var(--gold);direction:rtl;margin-right:.4rem}
.sec-more{font-size:.72rem;color:var(--gold);transition:opacity .2s}.sec-more:hover{opacity:.7}

/* ── Grid & Scroll ── */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:.85rem}
.hscroll{display:flex;gap:.85rem;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;padding-bottom:.25rem}
.hscroll::-webkit-scrollbar{display:none}
.hscroll .card{min-width:260px;max-width:300px;scroll-snap-align:start;flex-shrink:0}

/* ── Card ── */
.card{background:var(--s1);border:1px solid var(--bd);border-radius:var(--r);overflow:hidden;transition:all .3s ease;display:block}
.card:hover{border-color:var(--bdh);transform:translateY(-3px);box-shadow:0 10px 32px rgba(0,0,0,.3)}
.card-anim{opacity:0;transform:translateY(16px);transition:opacity .5s ease,transform .5s ease,border-color .3s,box-shadow .3s}
.card-vis{opacity:1;transform:translateY(0)}
.card-th{aspect-ratio:16/9;background:var(--s2);position:relative;overflow:hidden;background-size:cover;background-position:center;transition:transform .4s ease}
.card:hover .card-th{transform:scale(1.04)}
.card-th .tsvg{position:absolute;inset:0;width:100%;height:100%}
.card-hover{position:absolute;inset:0;background:rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .25s}
.card:hover .card-hover{opacity:1}
.card-pi{width:36px;height:36px;border-radius:50%;background:rgba(196,164,76,.8);display:flex;align-items:center;justify-content:center}
.card-pi::after{content:'';border-style:solid;border-width:6px 0 6px 10px;border-color:transparent transparent transparent var(--bg);margin-left:2px}
.dur{position:absolute;bottom:.4rem;right:.4rem;padding:.1rem .35rem;background:rgba(0,0,0,.8);border-radius:4px;font-size:.6rem;font-weight:500;z-index:2}
.dur-s{font-size:.55rem}
.card-bd{padding:.65rem .8rem .75rem}
.card-bd h3{font-size:.8rem;font-weight:500;line-height:1.35;margin-bottom:.15rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card-ar{font-family:'Amiri',serif;font-size:.75rem;color:var(--gold);direction:rtl;margin-bottom:.2rem;opacity:.6}
.card-mt{font-size:.62rem;color:var(--t3);display:flex;gap:.4rem;margin-bottom:.3rem}
.card-tg{display:flex;gap:.25rem;flex-wrap:wrap}
.tag{display:inline-block;padding:.1rem .4rem;background:color-mix(in srgb,var(--tc,var(--gold)) 8%,transparent);border-radius:100px;color:var(--tc,var(--gold));font-size:.58rem;font-weight:500}
.tag-s{--tc:var(--t2);background:var(--s2)}

/* ── Continue Watching ── */
.sec-cw{margin-bottom:.5rem}
.card-cw .card-th{position:relative}.card-cw .card-bd h3{font-size:.75rem}
.cw-prog{position:absolute;bottom:0;left:0;height:3px;background:var(--gold);z-index:2;border-radius:0 2px 0 0;transition:width .3s}

/* ── Watch Layout ── */
.wl{display:grid;grid-template-columns:1fr 300px;gap:1.5rem;align-items:start}
.wm{min-width:0}

/* ── Player ── */
.vp{position:relative;background:#000;border-radius:var(--r);overflow:hidden;aspect-ratio:16/9}
.vp video{display:block;width:100%;height:100%;object-fit:contain}
.vp video::cue{background:rgba(0,0,0,.75);color:#fff;font-family:'Outfit',sans-serif;font-size:.9rem;line-height:1.4}
.vp-big{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;cursor:pointer;background:rgba(0,0,0,.2);z-index:3;transition:opacity .3s}
.vp.playing .vp-big{opacity:0;pointer-events:none}
.vp-bigb{width:64px;height:64px;border-radius:50%;background:rgba(196,164,76,.85);display:flex;align-items:center;justify-content:center;box-shadow:0 6px 30px rgba(196,164,76,.25);transition:transform .3s}
.vp-bigb:hover{transform:scale(1.08)}
.vp-bigb::after{content:'';border-style:solid;border-width:12px 0 12px 20px;border-color:transparent transparent transparent var(--bg);margin-left:4px}
.vp-bar{position:absolute;bottom:0;left:0;right:0;padding:2rem .75rem .5rem;background:linear-gradient(transparent,rgba(0,0,0,.85));display:flex;align-items:center;gap:.5rem;opacity:0;transition:opacity .25s;z-index:4}
.vp:hover .vp-bar,.vp:not(.playing) .vp-bar{opacity:1}
.vb{background:none;border:none;color:rgba(255,255,255,.8);cursor:pointer;font-size:.7rem;padding:.15rem;display:flex;align-items:center;transition:color .15s}
.vb:hover{color:#fff}.vb.vb-on{color:var(--gold)}
.vb-spd{font-weight:600;font-size:.65rem;min-width:22px}
.vb-vr{width:60px;height:4px;-webkit-appearance:none;appearance:none;background:rgba(255,255,255,.15);border-radius:2px;cursor:pointer;outline:none}
.vb-vr::-webkit-slider-thumb{-webkit-appearance:none;width:10px;height:10px;border-radius:50%;background:var(--gold);cursor:pointer}
.vb-vr::-moz-range-thumb{width:10px;height:10px;border-radius:50%;background:var(--gold);border:none;cursor:pointer}
.vp-sk{flex:1;height:4px;background:rgba(255,255,255,.12);border-radius:2px;cursor:pointer;position:relative}
.vp-bf{position:absolute;inset:0;border-radius:2px;background:rgba(255,255,255,.08);width:0}
.vp-pg{position:absolute;left:0;top:0;height:100%;border-radius:2px;background:var(--gold);width:0;transition:width .1s linear}
.vp-dot{position:absolute;right:-5px;top:-3px;width:10px;height:10px;background:var(--gold);border-radius:50%;opacity:0;transition:opacity .15s}
.vp:hover .vp-dot{opacity:1}
.vp-tm{font-size:.65rem;color:rgba(255,255,255,.55);white-space:nowrap}

/* ── Watch Info ── */
.wi{padding:.85rem 0}
.wi-top{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;margin-bottom:.35rem}
.wi-tl{flex:1;min-width:0}
.wi-ar{font-family:'Amiri',serif;font-size:.95rem;color:var(--gold);direction:rtl}
.wi h1{font-family:'Cormorant Garamond',serif;font-size:1.3rem;font-weight:600;line-height:1.25}
.wi-acts{display:flex;gap:.3rem;flex-shrink:0;flex-wrap:wrap}
.wa{display:flex;align-items:center;gap:.25rem;padding:.3rem .55rem;background:var(--s2);border:1px solid var(--bd);border-radius:8px;color:var(--t2);font:inherit;font-size:.65rem;cursor:pointer;transition:all .2s;text-decoration:none}
.wa:hover{border-color:var(--bdh);color:var(--tx)}.wa-on{color:var(--gold);border-color:rgba(196,164,76,.12);background:var(--gd)}
.wa-on svg{fill:var(--gold)}.wa svg{flex-shrink:0;width:15px;height:15px}
.wi-mt{font-size:.72rem;color:var(--t2);display:flex;gap:.55rem;margin-bottom:.4rem;flex-wrap:wrap}
.wi-tgs{display:flex;gap:.3rem;margin-bottom:.7rem;flex-wrap:wrap}
.wi-tgs a.tag:hover{filter:brightness(1.15)}
.wi-desc-wrap{background:var(--s1);border-radius:var(--r);border:1px solid var(--bd);margin-bottom:.75rem;overflow:hidden}
.wi-desc-wrap summary{padding:.65rem .85rem;cursor:pointer;font-size:.8rem;font-weight:500;color:var(--t2);list-style:none;display:flex;align-items:center;justify-content:space-between}
.wi-desc-wrap summary::-webkit-details-marker{display:none}
.wi-desc-wrap summary::after{content:'\\25BC';font-size:.55rem;color:var(--t3);transition:transform .2s}
.wi-desc-wrap[open] summary::after{transform:rotate(180deg)}
.wi-desc{font-size:.8rem;color:var(--t2);line-height:1.7;font-weight:300;padding:0 .85rem .75rem;white-space:pre-wrap}

/* ── Transcript ── */
.tr{border:1px solid var(--bd);border-radius:var(--r);background:var(--s1);margin:.75rem 0;overflow:hidden}
.tr-hd{padding:.65rem .85rem;cursor:pointer;font-family:'Cormorant Garamond',serif;font-size:.95rem;font-weight:600;display:flex;align-items:center;justify-content:space-between;list-style:none}
.tr-hd::-webkit-details-marker{display:none}
.tr-hd::after{content:'\\25BC';font-size:.55rem;color:var(--t3);transition:transform .2s}
details[open] .tr-hd::after{transform:rotate(180deg)}
.tr-ct{font-family:'Outfit',sans-serif;font-size:.65rem;font-weight:400;color:var(--t3)}
.tr-ls{max-height:300px;overflow-y:auto;padding:.15rem 0;scrollbar-width:thin;scrollbar-color:var(--s3) transparent}
.tl{display:flex;gap:.65rem;padding:.35rem .85rem;cursor:pointer;transition:background .15s;border-left:2px solid transparent}
.tl:hover{background:var(--s2)}.tl.tl-on{background:var(--gd);border-left-color:var(--gold)}
.tl-t{font-size:.65rem;color:var(--t3);white-space:nowrap;padding-top:.08rem;min-width:32px}
.tl p{font-size:.78rem;line-height:1.5;color:var(--t2)}.tl.tl-on p{color:var(--tx)}

/* ── Comments ── */
.cms{border-top:1px solid var(--bd);padding-top:1.1rem;margin-top:.4rem}
.cms h2{font-family:'Cormorant Garamond',serif;font-size:1rem;font-weight:600;margin-bottom:.75rem}
.cf{margin-bottom:1rem}.cf-r{display:flex;gap:.4rem;margin-bottom:.4rem}
.cf input,.cf textarea{flex:1;background:var(--s1);border:1px solid var(--bd);border-radius:8px;padding:.5rem .65rem;color:var(--tx);font:inherit;font-size:.78rem;transition:border-color .2s;resize:vertical}
.cf input:focus,.cf textarea:focus{outline:none;border-color:var(--gold)}
.cf input::placeholder,.cf textarea::placeholder{color:var(--t3)}
.cf button{padding:.5rem 1.1rem;background:var(--gold);color:var(--bg);border:none;border-radius:8px;font:inherit;font-size:.75rem;font-weight:600;cursor:pointer;transition:all .2s;white-space:nowrap}
.cf button:hover{filter:brightness(1.1)}.cf button:disabled{opacity:.5}
.cm{padding:.75rem 0;border-bottom:1px solid var(--bd)}.cm:last-child{border-bottom:none}
.cm-h{display:flex;align-items:baseline;gap:.45rem;margin-bottom:.15rem}
.cm-h strong{font-size:.78rem}.cm-h time{font-size:.6rem;color:var(--t3)}
.cm p{font-size:.78rem;color:var(--t2);line-height:1.55}
.cm-new{animation:cmIn .35s ease}
@keyframes cmIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}

/* ── Sidebar ── */
.ws{position:sticky;top:3.5rem}
.ws h3{font-family:'Cormorant Garamond',serif;font-size:.9rem;font-weight:600;margin-bottom:.5rem;padding-bottom:.35rem;border-bottom:1px solid var(--bd)}
.sc{display:flex;gap:.55rem;padding:.4rem .35rem;transition:all .2s;border-radius:6px;margin:0 -.35rem}
.sc:hover{background:var(--s2);transform:translateX(2px)}
.sc-th{width:115px;aspect-ratio:16/9;background:var(--s2);border-radius:6px;flex-shrink:0;overflow:hidden;position:relative;background-size:cover;background-position:center}
.sc-th .tsvg{position:absolute;inset:0;width:100%;height:100%}
.sc-i{min-width:0;display:flex;flex-direction:column;justify-content:center;gap:.08rem}
.sc-i h4{font-size:.7rem;font-weight:500;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.sc-i span{font-size:.58rem;color:var(--t3)}

/* ── Category ── */
.cat-hd{display:flex;align-items:baseline;gap:.5rem}
.cat-ctrls{display:flex;align-items:center;gap:.75rem}
.cat-ct{font-size:.7rem;color:var(--t3)}
.sort-btns{display:flex;gap:.2rem}
.sb{padding:.2rem .55rem;border-radius:6px;font-size:.65rem;color:var(--t2);transition:all .2s}
.sb:hover{background:var(--s2)}.sb-on{background:var(--gd);color:var(--gold)}

/* ── 404 ── */
.e404{text-align:center;padding:5rem 2rem}
.e404 h1{font-family:'Cormorant Garamond',serif;font-size:4rem;font-weight:300;color:var(--gold);margin:.5rem 0}
.e404 p{color:var(--t2);margin-bottom:1.5rem}
.e404-btn{display:inline-block;padding:.5rem 1.5rem;border:1px solid var(--bdh);border-radius:8px;color:var(--gold);font-size:.8rem;transition:all .2s}
.e404-btn:hover{background:var(--gd)}

/* ── Toast ── */
.toast{position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%) translateY(16px);background:var(--s3);border:1px solid var(--bdh);color:var(--tx);padding:.45rem 1.1rem;border-radius:8px;font-size:.78rem;opacity:0;transition:all .3s;z-index:200;pointer-events:none}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}

/* ── Footer ── */
.ft{border-top:1px solid var(--bd);padding:2rem 0;margin-top:2rem}
.ft-in{max-width:1320px;margin:0 auto;padding:0 1.25rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap}
.ft-brand{display:flex;align-items:center;gap:.4rem;font-family:'Cormorant Garamond',serif;font-size:.9rem;font-weight:600;color:var(--t2)}
.ft-copy{font-size:.65rem;color:var(--t3)}.ft-links{display:flex;gap:1rem}
.ft a{color:var(--t3);font-size:.65rem;transition:color .2s}.ft a:hover{color:var(--gold)}

/* ── Misc ── */
.emp{grid-column:1/-1;text-align:center;padding:3rem;color:var(--t3);font-size:.85rem}
.emp-s{color:var(--t3);font-size:.72rem;padding:.6rem 0}

/* ── Responsive ── */
@media(max-width:960px){.wl{grid-template-columns:1fr}.ws{position:static;margin-top:1rem}
.hero-card{grid-template-columns:1fr}.hero-th{aspect-ratio:16/9}.hero-info{padding:1.25rem}}
@media(max-width:768px){.nav-pills{display:none}.nav-sf{display:none}.nav-hb{display:block}
.grid{grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}.wrap{padding:1rem 1rem 3rem}}
@media(max-width:480px){.wi-top{flex-direction:column;gap:.4rem}.wi-acts{align-self:flex-start}
.sc-th{width:90px}.hscroll .card{min-width:220px}.hero-info h1{font-size:1.15rem}}

/* ── Theater mode ── */
.wl.theater{grid-template-columns:1fr;max-width:none}
.wl.theater .vp{border-radius:0;margin:0 -1.25rem;aspect-ratio:21/9;max-height:80vh}
.wl.theater .ws{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:.75rem}
.wl.theater .ws h3{grid-column:1/-1}
.wl.theater .sc{flex-direction:column}.wl.theater .sc-th{width:100%}

/* ── Mini player ── */
.vp-mini{position:fixed!important;bottom:1.5rem;right:1.5rem;width:320px;z-index:150;border-radius:8px!important;box-shadow:0 8px 32px rgba(0,0,0,.6);aspect-ratio:16/9!important;transition:none}
.vp-mini .vp-bar{padding:.5rem .5rem .3rem}
.vp-mini .vp-tm,.vp-mini .vb-vr,.vp-mini #vvol,.vp-mini #vcc,.vp-mini #vspd,.vp-mini #vpip,.vp-mini #vthtr{display:none}
.vp-mini-close{position:absolute;top:.4rem;right:.4rem;z-index:6;width:24px;height:24px;border-radius:50%;background:rgba(0,0,0,.7);border:none;color:#fff;font-size:.7rem;cursor:pointer;display:none;align-items:center;justify-content:center}
.vp-mini .vp-mini-close{display:flex}

/* ── End screen ── */
.vp-end{position:absolute;inset:0;background:rgba(0,0,0,.85);z-index:5;display:none;align-items:center;justify-content:center}
.vp-end.vp-end-on{display:flex}
.vp-end-inner{display:flex;align-items:center;gap:2rem;max-width:90%}
.vp-end-replay{display:flex;flex-direction:column;align-items:center;gap:.4rem;background:none;border:2px solid rgba(255,255,255,.2);border-radius:12px;padding:1.25rem 1.5rem;color:rgba(255,255,255,.8);cursor:pointer;transition:all .2s;font:inherit;font-size:.75rem}
.vp-end-replay:hover{border-color:var(--gold);color:var(--gold)}
.vp-end-next{display:flex;gap:.75rem;overflow:hidden}
.vp-end-card{display:block;width:160px;flex-shrink:0;border-radius:8px;overflow:hidden;background:var(--s2);transition:transform .2s}
.vp-end-card:hover{transform:scale(1.04)}
.vp-end-card-th{aspect-ratio:16/9;background:var(--s3);background-size:cover;background-position:center;position:relative}
.vp-end-card h5{padding:.4rem .5rem;font-size:.65rem;font-weight:500;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}

/* ── Spinner ── */
.vp-spinner{position:absolute;top:50%;left:50%;width:36px;height:36px;margin:-18px 0 0 -18px;border:3px solid rgba(255,255,255,.1);border-top-color:var(--gold);border-radius:50%;z-index:5;opacity:0;pointer-events:none;animation:spin .8s linear infinite}
.vp-spin-on{opacity:1}
@keyframes spin{to{transform:rotate(360deg)}}

/* ── Double-tap seek indicator ── */
.vp-seek-ind{position:absolute;top:50%;transform:translateY(-50%);z-index:5;display:flex;flex-direction:column;align-items:center;gap:.15rem;color:rgba(255,255,255,.9);opacity:0;pointer-events:none;transition:opacity .15s}
.vp-seek-l{left:15%}.vp-seek-r{right:15%}
.vp-seek-ind span{font-size:.7rem;font-weight:500}
.vp-seek-show{opacity:1;animation:seekPop .5s ease}
@keyframes seekPop{0%{transform:translateY(-50%) scale(.7);opacity:0}30%{transform:translateY(-50%) scale(1.1);opacity:1}100%{transform:translateY(-50%) scale(1);opacity:0}}

/* ── Comment counter ── */
.cf-ta-wrap{position:relative}
.cf-ta-wrap textarea{width:100%}
.cf-counter{position:absolute;bottom:.4rem;right:.6rem;font-size:.6rem;color:var(--t3);pointer-events:none;transition:color .2s}
.cf-ct-warn{color:#c44c4c}

/* ── Scroll progress ── */
.scroll-prog{position:fixed;top:0;left:0;height:2px;background:var(--gold);z-index:200;width:0;transition:width .1s linear}

/* ── Back to top ── */
.btt{position:fixed;bottom:1.5rem;right:1.5rem;width:36px;height:36px;border-radius:50%;background:var(--s2);border:1px solid var(--bd);color:var(--t2);display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:0;transform:translateY(10px);transition:all .3s;z-index:100;pointer-events:none}
.btt-show{opacity:1;transform:translateY(0);pointer-events:auto}
.btt:hover{border-color:var(--bdh);color:var(--gold)}

/* ── New badge ── */
.badge-new{position:absolute;top:.4rem;left:.4rem;padding:.1rem .35rem;background:#c44c4c;border-radius:4px;font-size:.55rem;font-weight:700;color:#fff;letter-spacing:.04em;z-index:2}

/* ── Comment avatars ── */
.cm{display:flex;gap:.65rem;padding:.75rem 0;border-bottom:1px solid var(--bd)}
.cm:last-child{border-bottom:none}
.cm-av{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.6rem;font-weight:700;color:var(--bg);flex-shrink:0;margin-top:.1rem}
.cm-body{flex:1;min-width:0}

/* ── Nav bookmark icon ── */
.nav-icon{color:var(--t3);display:flex;align-items:center;transition:color .2s;flex-shrink:0}
.nav-icon:hover{color:var(--gold)}

/* ── Mobile menu divider ── */
.mob-div{height:1px;background:var(--bd);margin:.5rem 0}

/* ── About page ── */
.about-page{max-width:700px;margin:0 auto;padding:2rem 0}
.about-hero{text-align:center;margin-bottom:2.5rem}
.about-geo{margin-bottom:1rem;opacity:.5}
.about-hero h1{font-family:'Cormorant Garamond',serif;font-size:clamp(1.8rem,4vw,2.5rem);font-weight:300;margin-bottom:.75rem}
.about-hero h1 span{font-weight:700;color:var(--gold)}
.about-lead{color:var(--t2);font-size:.9rem;line-height:1.7;max-width:500px;margin:0 auto}
.about-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem;margin-bottom:2.5rem}
.about-card{background:var(--s1);border:1px solid var(--bd);border-radius:var(--r);padding:1.25rem}
.about-card h3{font-family:'Cormorant Garamond',serif;font-size:1rem;font-weight:600;color:var(--gold);margin-bottom:.4rem}
.about-card p{color:var(--t2);font-size:.78rem;line-height:1.65}
.about-stats{display:flex;justify-content:center;gap:3rem;margin-bottom:2.5rem}
.about-stat{text-align:center}
.about-stat-n{display:block;font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:300;color:var(--gold)}
.about-stat-l{font-size:.65rem;color:var(--t3);text-transform:uppercase;letter-spacing:.1em}
.about-ayah{text-align:center;padding:2rem;background:var(--s1);border:1px solid var(--bd);border-radius:var(--r)}
.about-ayah-ar{font-family:'Amiri',serif;font-size:1.3rem;color:var(--gold);direction:rtl;margin-bottom:.5rem}
.about-ayah-en{color:var(--t2);font-size:.82rem;font-style:italic}

/* ── Skeleton loading ── */
.skel-grid{grid-column:1/-1;display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:.85rem}
.skel-card{border-radius:var(--r);overflow:hidden;background:var(--s1);border:1px solid var(--bd)}
.skel-th{aspect-ratio:16/9}
.skel-bd{padding:.7rem .85rem .85rem}
.skel-line{height:12px;border-radius:4px;margin-bottom:.4rem;width:80%}
.skel-line-s{width:50%}
.skel-shimmer{background:linear-gradient(90deg,var(--s2) 25%,var(--s3) 50%,var(--s2) 75%);background-size:200% 100%;animation:shimmer 1.5s infinite}
@keyframes shimmer{to{background-position:-200% 0}}

/* ── Comment timestamp links ── */
.cm-ts{color:var(--gold);cursor:pointer;font-weight:500;transition:opacity .2s}
.cm-ts:hover{opacity:.7}

/* ── Skip Link ── */
.skip-link{position:absolute;top:-100%;left:1rem;padding:.5rem 1rem;background:var(--gold);color:var(--bg);border-radius:0 0 8px 8px;font-size:.8rem;font-weight:600;z-index:999;transition:top .2s}
.skip-link:focus{top:0}

/* ── Focus styles ── */
:focus-visible{outline:2px solid var(--gold);outline-offset:2px;border-radius:4px}
button:focus-visible,.pill:focus-visible,.card:focus-visible,.wa:focus-visible{outline:2px solid var(--gold);outline-offset:2px}

/* ── Keyboard Modal ── */
.kb-modal{position:fixed;inset:0;z-index:300;background:rgba(0,0,0,.7);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .25s}
.kb-modal.kb-open{opacity:1;pointer-events:auto}
.kb-inner{background:var(--s1);border:1px solid var(--bd);border-radius:var(--r);padding:1.5rem 2rem;max-width:380px;width:90%}
.kb-inner h2{font-family:'Cormorant Garamond',serif;font-size:1.1rem;font-weight:600;margin-bottom:1rem;color:var(--gold)}
.kb-grid{display:flex;flex-direction:column;gap:.35rem;margin-bottom:1.25rem}
.kb-row{display:flex;align-items:center;justify-content:space-between;font-size:.78rem;color:var(--t2)}
.kb-row kbd{background:var(--s3);border:1px solid var(--bd);border-radius:4px;padding:.1rem .45rem;font-family:inherit;font-size:.7rem;color:var(--tx);min-width:28px;text-align:center}
.kb-close{width:100%;padding:.45rem;background:var(--s3);border:1px solid var(--bd);border-radius:8px;color:var(--t2);font:inherit;font-size:.78rem;cursor:pointer;transition:all .2s}
.kb-close:hover{border-color:var(--bdh);color:var(--tx)}

/* ── View Transitions ── */
@view-transition{navigation:auto}
::view-transition-old(root){animation:.15s ease-out both vt-out}
::view-transition-new(root){animation:.2s ease-in both vt-in}
@keyframes vt-out{to{opacity:0;transform:translateY(-4px)}}
@keyframes vt-in{from{opacity:0;transform:translateY(4px)}}
`;
