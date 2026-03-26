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
    <div class="nav-pills" id="pills"><a href="/" class="pill${!activeCat?' on':''}">All</a>${categories.map(c=>`<a href="${c.slug==='symposium'?'/symposium':'/category/'+e(c.slug)}" class="pill${activeCat===c.slug?' on':''}" style="--pc:${e(c.color)}">${e(c.name)}</a>`).join('')}</div>
    <div class="nav-right">
      <a href="/scholars" class="nav-link${activeCat==='scholars'?' nav-link-on':''}">Scholars</a>
      <form action="/search" method="get" class="nav-sf"><svg class="nav-si" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input type="search" name="q" placeholder="Search..." aria-label="Search" autocomplete="off"><kbd class="nav-kbd">/</kbd></form>
      ${user?`<a href="/profile" class="nav-user-btn" title="Profile"><img src="${e(user.avatar)}" class="nav-user-av" alt="">${e(user.name.split(' ')[0])}</a>`:`<a href="/auth/google" class="nav-login">Sign in</a>`}
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
  <div class="ft-links"><a href="/scholars">Scholars</a><a href="/history">History</a><a href="/bookmarks">Saved</a><a href="/about">About</a><a href="/feed.xml">RSS</a></div>
  <div class="ft-social"><a href="https://x.com/deensubss" target="_blank" rel="noopener" title="X / Twitter"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg></a><a href="https://www.tiktok.com/@deensubs" target="_blank" rel="noopener" title="TikTok"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V9.27a8.16 8.16 0 004.77 1.52V7.36a4.85 4.85 0 01-1-.67z"/></svg></a><a href="https://github.com/Muno459/deensubs" target="_blank" rel="noopener" title="GitHub"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg></a></div>
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
