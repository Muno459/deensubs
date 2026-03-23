function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d + 'Z').getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400) return Math.floor(s/3600) + 'h ago';
  if (s < 2592000) return Math.floor(s/86400) + 'd ago';
  return new Date(d).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}

function views(n) {
  if (!n) return '0 views';
  if (n >= 1000000) return (n/1000000).toFixed(1) + 'M views';
  if (n >= 1000) return (n/1000).toFixed(1) + 'K views';
  return n + ' views';
}

function videoCard(v) {
  return `<a href="/watch/${esc(v.slug)}" class="card">
    <div class="card-thumb">
      <svg class="card-geo" viewBox="0 0 160 90" fill="none"><rect x="55" y="20" width="50" height="50" stroke="rgba(196,164,76,0.08)" stroke-width="0.5" transform="rotate(45 80 45)"/><rect x="55" y="20" width="50" height="50" stroke="rgba(196,164,76,0.08)" stroke-width="0.5"/><circle cx="80" cy="45" r="6" stroke="rgba(196,164,76,0.06)" stroke-width="0.5"/></svg>
      <div class="card-play"><span></span></div>
    </div>
    <div class="card-body">
      <h3>${esc(v.title)}</h3>
      ${v.title_ar ? `<div class="card-ar">${esc(v.title_ar)}</div>` : ''}
      <div class="card-meta">
        ${v.source ? `<span>${esc(v.source)}</span>` : ''}
        <span>${views(v.views)}</span>
      </div>
      ${v.category_name ? `<span class="tag">${esc(v.category_name)}</span>` : ''}
    </div>
  </a>`;
}

function sidebarCard(v) {
  return `<a href="/watch/${esc(v.slug)}" class="side-card">
    <div class="side-thumb">
      <svg viewBox="0 0 80 45" fill="none"><rect x="27" y="10" width="26" height="26" stroke="rgba(196,164,76,0.08)" stroke-width="0.4" transform="rotate(45 40 23)"/><rect x="27" y="10" width="26" height="26" stroke="rgba(196,164,76,0.08)" stroke-width="0.4"/></svg>
    </div>
    <div class="side-info">
      <h4>${esc(v.title)}</h4>
      <span class="side-meta">${v.category_name ? esc(v.category_name) : ''} · ${views(v.views)}</span>
    </div>
  </a>`;
}

export function renderHome({ featured, recent, categories }) {
  return `
    ${featured ? `
    <section class="featured">
      <a href="/watch/${esc(featured.slug)}" class="featured-card">
        <div class="featured-thumb">
          <svg class="featured-geo" viewBox="0 0 400 225" fill="none">
            <rect x="150" y="62" width="100" height="100" stroke="rgba(196,164,76,0.06)" stroke-width="0.7" transform="rotate(45 200 112)"/>
            <rect x="150" y="62" width="100" height="100" stroke="rgba(196,164,76,0.06)" stroke-width="0.7"/>
            <circle cx="200" cy="112" r="14" stroke="rgba(196,164,76,0.05)" stroke-width="0.5"/>
          </svg>
          <div class="featured-play-btn"><span></span></div>
          ${featured.source ? `<div class="featured-badge">${esc(featured.source)}</div>` : ''}
        </div>
        <div class="featured-info">
          ${featured.title_ar ? `<div class="featured-ar">${esc(featured.title_ar)}</div>` : ''}
          <h2>${esc(featured.title)}</h2>
          <p class="featured-desc">${esc(featured.description || '')}</p>
          <div class="featured-meta">
            ${featured.category_name ? `<span class="tag">${esc(featured.category_name)}</span>` : ''}
            <span class="tag">AR &rarr; EN</span>
            <span>${views(featured.views)}</span>
          </div>
        </div>
      </a>
    </section>` : ''}

    <section class="content-section">
      <div class="section-head">
        <h2>All Videos</h2>
      </div>
      <div class="grid">
        ${recent.length ? recent.map(videoCard).join('') : '<p class="empty">No videos yet. Content is being prepared.</p>'}
      </div>
    </section>`;
}

export function renderWatch({ video, comments, related }) {
  return `
    <div class="watch-layout">
      <div class="watch-main">
        <div class="player-container">
          <video id="player" crossorigin="anonymous" preload="metadata" controls>
            <source src="/api/media/${esc(video.video_key)}" type="video/mp4">
          </video>
        </div>

        <div class="watch-info">
          ${video.title_ar ? `<div class="watch-ar">${esc(video.title_ar)}</div>` : ''}
          <h1 class="watch-title">${esc(video.title)}</h1>
          <div class="watch-meta">
            ${video.source ? `<span>${esc(video.source)}</span>` : ''}
            <span>${views(video.views)}</span>
            <span>${timeAgo(video.created_at)}</span>
          </div>
          <div class="watch-tags">
            ${video.category_name ? `<a href="/category/${esc(video.category_slug)}" class="tag">${esc(video.category_name)}</a>` : ''}
            <span class="tag">Arabic &rarr; English</span>
            ${video.srt_key ? '<span class="tag">Subtitled</span>' : ''}
          </div>
          ${video.description ? `<p class="watch-desc">${esc(video.description)}</p>` : ''}
        </div>

        <div class="comments-section">
          <h2>${comments.length} Comment${comments.length !== 1 ? 's' : ''}</h2>
          <form id="comment-form" class="comment-form" data-slug="${esc(video.slug)}">
            <input name="author" placeholder="Your name" maxlength="100" required autocomplete="off">
            <textarea name="content" placeholder="Share your thoughts..." maxlength="2000" rows="3" required></textarea>
            <button type="submit">Post Comment</button>
          </form>
          <div id="comment-list" class="comment-list">
            ${comments.map(cm => `
              <div class="comment">
                <div class="comment-head">
                  <strong>${esc(cm.author)}</strong>
                  <time>${timeAgo(cm.created_at)}</time>
                </div>
                <p>${esc(cm.content)}</p>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <aside class="watch-sidebar">
        <h3>More Videos</h3>
        ${related.length ? related.map(sidebarCard).join('') : '<p class="empty-sm">More content coming soon.</p>'}
      </aside>
    </div>

    <script>
    (function() {
      // Load subtitles
      var player = document.getElementById('player');
      var srtKey = ${video.srt_key ? `'${esc(video.srt_key)}'` : 'null'};
      if (player && srtKey) {
        fetch('/api/media/' + srtKey)
          .then(function(r) { return r.text(); })
          .then(function(srt) {
            var vtt = 'WEBVTT\\n\\n' + srt.replace(/(\\d{2}:\\d{2}:\\d{2}),(\\d{3})/g, '$1.$2');
            var blob = new Blob([vtt], { type: 'text/vtt' });
            var track = document.createElement('track');
            track.kind = 'subtitles';
            track.label = 'English';
            track.srclang = 'en';
            track.src = URL.createObjectURL(blob);
            track.default = true;
            player.appendChild(track);
            setTimeout(function() { if (track.track) track.track.mode = 'showing'; }, 100);
          }).catch(function() {});
      }

      // Comments
      var form = document.getElementById('comment-form');
      var list = document.getElementById('comment-list');
      if (form) {
        form.addEventListener('submit', function(e) {
          e.preventDefault();
          var btn = form.querySelector('button');
          btn.disabled = true;
          btn.textContent = 'Posting...';
          var slug = form.dataset.slug;
          fetch('/api/videos/' + slug + '/comments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ author: form.author.value.trim(), content: form.content.value.trim() })
          }).then(function(r) { return r.json(); }).then(function(data) {
            if (data.comment) {
              var cm = data.comment;
              var div = document.createElement('div');
              div.className = 'comment comment-new';
              div.innerHTML = '<div class="comment-head"><strong>' +
                cm.author.replace(/</g,'&lt;') + '</strong><time>just now</time></div><p>' +
                cm.content.replace(/</g,'&lt;') + '</p>';
              list.insertBefore(div, list.firstChild);
              form.reset();
              var h2 = document.querySelector('.comments-section h2');
              var count = list.querySelectorAll('.comment').length;
              h2.textContent = count + ' Comment' + (count !== 1 ? 's' : '');
            }
          }).catch(function() {}).finally(function() {
            btn.disabled = false;
            btn.textContent = 'Post Comment';
          });
        });
      }
    })();
    </script>`;
}

export function renderCategory({ category, videos }) {
  return `
    <section class="content-section">
      <div class="section-head">
        <div class="cat-header">
          <span class="cat-ar">${esc(category.name_ar)}</span>
          <h1>${esc(category.name)}</h1>
        </div>
        <p class="cat-count">${videos.length} video${videos.length !== 1 ? 's' : ''}</p>
      </div>
      <div class="grid">
        ${videos.length ? videos.map(videoCard).join('') : '<p class="empty">No videos in this category yet.</p>'}
      </div>
    </section>`;
}

export function renderPage(title, body, categories, activeCategory) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} — DeenSubs</title>
<meta name="description" content="Arabic Islamic lectures with AI-powered English subtitles.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Amiri:wght@400;700&family=Outfit:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
<div class="grain"></div>
<nav class="topnav" id="topnav">
  <div class="nav-inner">
    <a href="/" class="logo">
      <div class="logo-mark">
        <svg viewBox="0 0 32 32" fill="none"><rect x="6" y="6" width="20" height="20" stroke="rgba(196,164,76,0.4)" stroke-width="0.6"/><rect x="6" y="6" width="20" height="20" stroke="rgba(196,164,76,0.4)" stroke-width="0.6" transform="rotate(45 16 16)"/></svg>
        <span>د</span>
      </div>
      <span class="logo-text">DeenSubs</span>
    </a>
    <div class="nav-cats">
      <a href="/" class="nav-cat${!activeCategory ? ' active' : ''}">All</a>
      ${categories.map(c => `<a href="/category/${esc(c.slug)}" class="nav-cat${activeCategory === c.slug ? ' active' : ''}">${esc(c.name)}</a>`).join('')}
    </div>
  </div>
</nav>
<main class="main-wrap">${body}</main>
<footer class="site-footer">
  <div class="footer-inner">
    <span>&copy; 2026 DeenSubs — Making Islamic knowledge accessible</span>
    <a href="https://github.com/Muno459/deensubs" target="_blank" rel="noopener">GitHub</a>
  </div>
</footer>
</body>
</html>`;
}

const CSS = `
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#050507;--surface:#0c0c11;--surface-2:#14141b;--surface-3:#1c1c25;
  --border:rgba(196,164,76,0.06);--border-h:rgba(196,164,76,0.16);
  --gold:#c4a44c;--gold-dim:rgba(196,164,76,0.07);
  --text:#eae6da;--text-2:#807c72;--text-3:#4a4840;
  --r:12px;
}
html{scroll-behavior:smooth}
body{font-family:'Outfit',system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.6;-webkit-font-smoothing:antialiased}
::selection{background:rgba(196,164,76,0.25)}
a{color:inherit;text-decoration:none}

.grain{position:fixed;inset:0;pointer-events:none;z-index:9999;opacity:0.02;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}

/* ── Nav ── */
.topnav{position:sticky;top:0;z-index:100;background:rgba(5,5,7,0.92);backdrop-filter:blur(24px) saturate(1.2);border-bottom:1px solid var(--border);padding:0.75rem 0}
.nav-inner{max-width:1280px;margin:0 auto;padding:0 1.5rem;display:flex;align-items:center;gap:2rem}
.logo{display:flex;align-items:center;gap:0.65rem;flex-shrink:0}
.logo-mark{width:30px;height:30px;position:relative;display:flex;align-items:center;justify-content:center}
.logo-mark svg{position:absolute;inset:0}
.logo-mark span{font-family:'Amiri',serif;font-size:0.9rem;font-weight:700;color:var(--gold);position:relative;z-index:1}
.logo-text{font-family:'Cormorant Garamond',serif;font-size:1.2rem;font-weight:600;letter-spacing:0.03em}
.nav-cats{display:flex;gap:0.35rem;overflow-x:auto;scrollbar-width:none;-ms-overflow-style:none;flex:1}
.nav-cats::-webkit-scrollbar{display:none}
.nav-cat{padding:0.35rem 0.85rem;border-radius:100px;font-size:0.75rem;font-weight:500;color:var(--text-2);white-space:nowrap;transition:all 0.25s;border:1px solid transparent}
.nav-cat:hover{color:var(--text);background:var(--surface-2)}
.nav-cat.active{background:var(--gold-dim);color:var(--gold);border-color:rgba(196,164,76,0.1)}

/* ── Main ── */
.main-wrap{max-width:1280px;margin:0 auto;padding:1.5rem 1.5rem 4rem;min-height:70vh}

/* ── Featured ── */
.featured{margin-bottom:2rem}
.featured-card{display:grid;grid-template-columns:1.2fr 1fr;border-radius:var(--r);overflow:hidden;background:var(--surface);border:1px solid var(--border);transition:all 0.4s cubic-bezier(0.23,1,0.32,1)}
.featured-card:hover{border-color:var(--border-h);transform:translateY(-3px);box-shadow:0 16px 48px rgba(0,0,0,0.35)}
.featured-thumb{aspect-ratio:16/9;background:linear-gradient(135deg,#08081a,#10101e,#0c0c18);position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center}
.featured-geo{position:absolute;width:100%;height:100%;opacity:0.5}
.featured-play-btn{width:64px;height:64px;border-radius:50%;background:rgba(196,164,76,0.85);display:flex;align-items:center;justify-content:center;z-index:2;box-shadow:0 8px 36px rgba(196,164,76,0.2);transition:transform 0.4s}
.featured-play-btn span{display:block;width:0;height:0;border-style:solid;border-width:11px 0 11px 18px;border-color:transparent transparent transparent var(--bg);margin-left:4px}
.featured-card:hover .featured-play-btn{transform:scale(1.1)}
.featured-badge{position:absolute;top:1rem;left:1rem;padding:0.25rem 0.7rem;background:rgba(5,5,7,0.65);backdrop-filter:blur(12px);border:1px solid rgba(196,164,76,0.1);border-radius:100px;font-size:0.65rem;font-weight:500;color:var(--gold);z-index:2}
.featured-info{padding:2rem;display:flex;flex-direction:column;justify-content:center}
.featured-ar{font-family:'Amiri',serif;font-size:1.25rem;color:var(--gold);direction:rtl;margin-bottom:0.3rem}
.featured-info h2{font-family:'Cormorant Garamond',serif;font-size:1.6rem;font-weight:600;margin-bottom:0.5rem;line-height:1.25}
.featured-desc{color:var(--text-2);font-size:0.82rem;font-weight:300;line-height:1.65;margin-bottom:1rem;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.featured-meta{display:flex;align-items:center;gap:0.5rem;font-size:0.75rem;color:var(--text-2);flex-wrap:wrap}

/* ── Grid ── */
.content-section{margin-top:1rem}
.section-head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:1.25rem}
.section-head h1,.section-head h2{font-family:'Cormorant Garamond',serif;font-size:1.4rem;font-weight:600}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:1rem}

/* ── Video Card ── */
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);overflow:hidden;transition:all 0.4s cubic-bezier(0.23,1,0.32,1);display:block}
.card:hover{border-color:var(--border-h);transform:translateY(-4px);box-shadow:0 14px 40px rgba(0,0,0,0.35)}
.card-thumb{aspect-ratio:16/9;background:linear-gradient(135deg,var(--surface-2),var(--surface-3));position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden}
.card-geo{position:absolute;width:100%;height:100%;opacity:0.4}
.card-play{width:40px;height:40px;border-radius:50%;background:rgba(196,164,76,0.75);display:flex;align-items:center;justify-content:center;z-index:1;transition:transform 0.3s;box-shadow:0 4px 20px rgba(196,164,76,0.15)}
.card-play span{display:block;width:0;height:0;border-style:solid;border-width:7px 0 7px 12px;border-color:transparent transparent transparent var(--bg);margin-left:2px}
.card:hover .card-play{transform:scale(1.1)}
.card-body{padding:0.85rem 1rem 1rem}
.card-body h3{font-size:0.9rem;font-weight:500;line-height:1.35;margin-bottom:0.15rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card-ar{font-family:'Amiri',serif;font-size:0.82rem;color:var(--gold);direction:rtl;margin-bottom:0.3rem;opacity:0.7}
.card-meta{font-size:0.7rem;color:var(--text-3);display:flex;gap:0.5rem;margin-bottom:0.4rem}
.tag{display:inline-block;padding:0.15rem 0.5rem;background:var(--gold-dim);border-radius:100px;color:var(--gold);font-size:0.65rem;font-weight:500;letter-spacing:0.02em}

/* ── Watch ── */
.watch-layout{display:grid;grid-template-columns:1fr 320px;gap:1.5rem;align-items:start}
.watch-main{min-width:0}
.player-container{border-radius:var(--r);overflow:hidden;background:#000;margin-bottom:1.25rem}
.player-container video{display:block;width:100%;aspect-ratio:16/9;background:#000}
.player-container video::cue{background:rgba(0,0,0,0.75);color:#fff;font-family:'Outfit',sans-serif;font-size:0.95rem}
.watch-ar{font-family:'Amiri',serif;font-size:1.15rem;color:var(--gold);direction:rtl;margin-bottom:0.25rem}
.watch-title{font-family:'Cormorant Garamond',serif;font-size:1.6rem;font-weight:600;line-height:1.25;margin-bottom:0.5rem}
.watch-meta{font-size:0.78rem;color:var(--text-2);display:flex;gap:0.75rem;margin-bottom:0.6rem;flex-wrap:wrap}
.watch-tags{display:flex;gap:0.4rem;margin-bottom:1rem;flex-wrap:wrap}
.watch-tags a.tag:hover{background:rgba(196,164,76,0.12)}
.watch-desc{font-size:0.85rem;color:var(--text-2);line-height:1.7;font-weight:300;padding:1rem;background:var(--surface);border-radius:var(--r);border:1px solid var(--border);margin-bottom:1.5rem}

/* ── Comments ── */
.comments-section{border-top:1px solid var(--border);padding-top:1.5rem}
.comments-section h2{font-family:'Cormorant Garamond',serif;font-size:1.15rem;font-weight:600;margin-bottom:1rem}
.comment-form{display:flex;flex-direction:column;gap:0.6rem;margin-bottom:1.5rem}
.comment-form input,.comment-form textarea{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:0.65rem 0.85rem;color:var(--text);font-family:inherit;font-size:0.85rem;transition:border-color 0.25s;resize:vertical}
.comment-form input:focus,.comment-form textarea:focus{outline:none;border-color:var(--gold)}
.comment-form input::placeholder,.comment-form textarea::placeholder{color:var(--text-3)}
.comment-form button{align-self:flex-end;padding:0.55rem 1.5rem;background:var(--gold);color:var(--bg);border:none;border-radius:8px;font-family:inherit;font-size:0.8rem;font-weight:600;cursor:pointer;transition:all 0.25s}
.comment-form button:hover{filter:brightness(1.1);transform:translateY(-1px)}
.comment-form button:disabled{opacity:0.5;cursor:default;transform:none}
.comment-list{display:flex;flex-direction:column}
.comment{padding:1rem 0;border-bottom:1px solid var(--border)}
.comment:last-child{border-bottom:none}
.comment-head{display:flex;align-items:baseline;gap:0.6rem;margin-bottom:0.3rem}
.comment-head strong{font-size:0.85rem;font-weight:600}
.comment-head time{font-size:0.7rem;color:var(--text-3)}
.comment p{font-size:0.85rem;color:var(--text-2);line-height:1.6}
.comment-new{animation:commentIn 0.4s ease}
@keyframes commentIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}

/* ── Sidebar ── */
.watch-sidebar{position:sticky;top:5rem}
.watch-sidebar h3{font-family:'Cormorant Garamond',serif;font-size:1rem;font-weight:600;margin-bottom:0.75rem;padding-bottom:0.5rem;border-bottom:1px solid var(--border)}
.side-card{display:flex;gap:0.75rem;padding:0.6rem 0;border-radius:8px;transition:background 0.2s}
.side-card:hover{background:var(--surface-2)}
.side-thumb{width:130px;aspect-ratio:16/9;background:linear-gradient(135deg,var(--surface-2),var(--surface-3));border-radius:6px;flex-shrink:0;display:flex;align-items:center;justify-content:center;overflow:hidden}
.side-thumb svg{width:100%;height:100%;opacity:0.3}
.side-info{min-width:0;display:flex;flex-direction:column;justify-content:center}
.side-info h4{font-size:0.78rem;font-weight:500;line-height:1.35;margin-bottom:0.2rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.side-meta{font-size:0.65rem;color:var(--text-3)}

/* ── Category ── */
.cat-header{display:flex;align-items:baseline;gap:0.75rem}
.cat-ar{font-family:'Amiri',serif;font-size:1.3rem;color:var(--gold);direction:rtl}
.cat-count{font-size:0.78rem;color:var(--text-3)}

/* ── Misc ── */
.empty{grid-column:1/-1;text-align:center;padding:3rem;color:var(--text-3);font-size:0.9rem}
.empty-sm{color:var(--text-3);font-size:0.8rem;padding:1rem 0}

/* ── Footer ── */
.site-footer{border-top:1px solid var(--border);padding:1.5rem 0}
.site-footer .footer-inner{max-width:1280px;margin:0 auto;padding:0 1.5rem;display:flex;align-items:center;justify-content:space-between;font-size:0.72rem;color:var(--text-3)}
.site-footer a{color:var(--text-3);transition:color 0.2s}
.site-footer a:hover{color:var(--gold)}

/* ── Responsive ── */
@media(max-width:900px){
  .watch-layout{grid-template-columns:1fr}
  .watch-sidebar{position:static;margin-top:1.5rem}
  .featured-card{grid-template-columns:1fr}
  .featured-thumb{aspect-ratio:16/9}
  .featured-info{padding:1.5rem}
}
@media(max-width:640px){
  .nav-inner{gap:1rem}
  .logo-text{display:none}
  .grid{grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
  .main-wrap{padding:1rem 1rem 3rem}
  .watch-title{font-size:1.3rem}
  .side-thumb{width:100px}
}
`;
