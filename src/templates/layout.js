import { e } from '../lib/helpers.js';
import CSS from '../styles/main.css';
import GLOBAL_JS from '../scripts/global.txt';

export function renderPage(title, body, categories, activeCat, meta, user) {
  meta = meta || {}; user = user || null;
  const desc = meta.description || 'Arabic Islamic lectures with accurate English subtitles, powered by AI.';
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="view-transition" content="same-origin">
<title>${e(title)} — DeenSubs</title>
<meta name="description" content="${e(desc)}">
<meta property="og:title" content="${e(title)} — DeenSubs"><meta property="og:type" content="${meta.type || 'website'}">
<meta property="og:description" content="${e(desc)}">
${meta.image ? `<meta property="og:image" content="${e(meta.image)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${e(meta.image)}">` : ''}
<link rel="alternate" type="application/rss+xml" title="DeenSubs" href="/feed.xml">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#c4a44c">
<link rel="preconnect" href="https://cdn.deensubs.com"><link rel="dns-prefetch" href="https://cdn.deensubs.com">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Amiri:wght@400;700&family=Outfit:wght@300;400;500;600&display=swap" rel="stylesheet">
<link rel="dns-prefetch" href="https://fonts.gstatic.com">
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
    <div class="nav-pills" id="pills"><a href="/" class="pill${!activeCat?' on':''}">All</a>${categories.filter(c=>c.slug!=='symposium').map(c=>`<a href="/category/${e(c.slug)}" class="pill${activeCat===c.slug?' on':''}" style="--pc:${e(c.color)}">${e(c.name)}</a>`).join('')}</div>
    <div class="nav-right">
      <a href="/scholars" class="nav-link">Scholars</a>
      <form action="/search" method="get" class="nav-sf"><svg class="nav-si" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input type="search" name="q" placeholder="Search..." aria-label="Search" autocomplete="off"><kbd class="nav-kbd">/</kbd></form>
      ${user?`<a href="/auth/logout" class="nav-user-btn" title="Sign out"><img src="${e(user.avatar)}" class="nav-user-av" alt="">${e(user.name.split(' ')[0])}</a>`:`<a href="/auth/google" class="nav-login">Sign in</a>`}
      <button class="nav-hb" id="hb" aria-label="Menu"><span></span><span></span><span></span></button>
    </div>
  </div>
</nav>
<div class="mob-menu" id="mob">
  <div class="mob-in">
    <form action="/search" method="get" class="mob-sf"><input type="search" name="q" placeholder="Search..." autocomplete="off"></form>
    <div class="mob-links"><a href="/"${!activeCat?' class="on"':''}>All</a>${categories.map(c=>`<a href="/category/${e(c.slug)}"${activeCat===c.slug?' class="on"':''}>${e(c.name_ar)} ${e(c.name)}</a>`).join('')}
    <div class="mob-div"></div><a href="/scholars">Scholars</a><a href="/history">History</a><a href="/bookmarks">Saved</a><a href="/about">About</a></div>
  </div>
</div>
<main class="wrap" id="main-content">${body}</main>
<footer class="ft"><div class="ft-in">
  <div class="ft-brand"><div class="logo-m"><svg viewBox="0 0 28 28" fill="none"><rect x="4" y="4" width="20" height="20" stroke="rgba(196,164,76,.3)" stroke-width=".7"/><rect x="4" y="4" width="20" height="20" stroke="rgba(196,164,76,.3)" stroke-width=".7" transform="rotate(45 14 14)"/></svg><span>د</span></div><span>DeenSubs</span></div>
  <span class="ft-copy">&copy; 2026 DeenSubs — Making Islamic knowledge accessible</span>
  <div class="ft-links"><a href="/scholars">Scholars</a><a href="/history">History</a><a href="/bookmarks">Saved</a><a href="/about">About</a><a href="/feed.xml">RSS</a><a href="https://github.com/Muno459/deensubs" target="_blank" rel="noopener">GitHub</a></div>
</div></footer>
<script>
${GLOBAL_JS}
${!user?`
// Google One Tap (isolated)
try{var otScript=document.createElement('script');otScript.src='https://accounts.google.com/gsi/client';otScript.async=true;
otScript.onload=function(){try{google.accounts.id.initialize({client_id:'1009654832009-9k61ld72vu7l6ml8n6v93vpgn9opfffb.apps.googleusercontent.com',callback:function(r){
fetch('/auth/onetap',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({credential:r.credential})}).then(function(res){if(res.ok)location.reload()})}
,auto_select:true});google.accounts.id.prompt()}catch(e){}};
document.head.appendChild(otScript)}catch(e){}
`:''}
</script>
</body></html>`;
}
