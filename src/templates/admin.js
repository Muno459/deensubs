import { e, ago, fv } from '../lib/helpers.js';

/* ── Country code → emoji flag ── */
function flag(cc) {
  if (!cc || cc.length !== 2) return '';
  const a = cc.toUpperCase();
  return String.fromCodePoint(...[...a].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

/* ── Format number with commas ── */
function fmt(n) {
  if (n == null) return '0';
  return Number(n).toLocaleString('en-US');
}

/* ── Resolve slug to video title ── */
function resolveTitle(slug, videos) {
  if (!slug || !videos || !videos.length) return slug || '';
  const v = videos.find(v => v.slug === slug);
  return v ? v.title : slug;
}

/* ── Resolve analytics path to a readable name ── */
function resolvePath(path, videos) {
  if (!path) return '';
  const m = path.match(/^\/watch\/(.+)$/);
  if (m) {
    const title = resolveTitle(m[1], videos);
    return title !== m[1] ? title : path;
  }
  return path;
}

/* ── Device type icon ── */
function deviceIcon(type) {
  switch ((type || '').toLowerCase()) {
    case 'mobile': return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>';
    case 'tablet': return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>';
    default: return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';
  }
}

export function renderAdmin({ videos, categories, key, editing, tab, users, comments, stats, countries, topPages, topVideos, dailyHits, searchLogs, visitors, agents, referers, watchEvents, watchCompletion, watchConnections, scholars }) {
  const v = editing || {};
  const isEdit = !!editing;
  const q = key ? '&key=' + e(key) : '';
  const formAction = isEdit ? `/admin/edit/${v.id}?${q.slice(1)}` : `/admin/video?${q.slice(1)}`;
  countries = countries || []; topPages = topPages || []; topVideos = topVideos || [];
  dailyHits = dailyHits || []; searchLogs = searchLogs || []; visitors = visitors || [];
  agents = agents || []; referers = referers || []; watchEvents = watchEvents || [];
  watchCompletion = watchCompletion || []; watchConnections = watchConnections || [];
  scholars = scholars || [];

  const tabs = [
    ['dashboard',  'Dashboard',  '<path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1"/>'],
    ['analytics',  'Analytics',  '<path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6m6 0h6m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0h6"/>'],
    ['videos',     'Videos',     '<path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>'],
    ['comments',   'Comments',   '<path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>'],
    ['users',      'Users',      '<path d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m9 5.197v-1"/>'],
    ['searches',   'Searches',   '<path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>'],
    ['visitors',   'Visitors',   '<path d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>'],
    ['watch',      'Watch Events','<path d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>'],
    ['sql',        'SQL Console', '<path d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>'],
    ['tools',      'Tools',      '<path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>'],
    ['ai',         'AI Assistant','<path d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 00.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M19 14.5l-2.47 3.3a.75.75 0 01-.588.307H8.058a.75.75 0 01-.588-.307L5 14.5m14 0H5m5.25 5.25v1.5m3.5-1.5v1.5"/>'],
    ['add',        'Add Video',  '<path d="M12 4v16m8-8H4"/>'],
  ];

  const totalHits = dailyHits.reduce((s, d) => s + d.hits, 0);
  const avgHits = dailyHits.length ? Math.round(totalHits / dailyHits.length) : 0;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin — DeenSubs</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
/* ── CSS Variables ── */
:root {
  --bg-body: #0a0a12;
  --bg-sidebar: #08080f;
  --bg-card: #0e0e18;
  --bg-card-hover: #111122;
  --bg-input: #0a0a14;
  --bg-deep: #06060c;
  --border: #1a1a2e;
  --border-light: #22223a;
  --gold: #c4a44c;
  --gold-dim: rgba(196,164,76,.15);
  --gold-glow: rgba(196,164,76,.06);
  --text: #e0e0e8;
  --text-dim: #8888a0;
  --text-muted: #55556a;
  --red: #e04058;
  --red-dim: rgba(224,64,88,.12);
  --green: #3ddc84;
  --green-dim: rgba(61,220,132,.12);
  --blue: #4c8ac4;
  --blue-dim: rgba(76,138,196,.12);
  --purple: #8a6ce0;
  --sidebar-w: 240px;
  --radius: 12px;
  --radius-sm: 8px;
  --font: 'Outfit', system-ui, -apple-system, sans-serif;
  --mono: 'JetBrains Mono', 'SF Mono', 'Consolas', monospace;
  --transition: all .2s cubic-bezier(.4,0,.2,1);
}

/* ── Reset ── */
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
html{font-size:16px;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
body{font-family:var(--font);background:var(--bg-body);color:var(--text);min-height:100vh;overflow-x:hidden}
a{color:var(--gold);text-decoration:none;transition:var(--transition)}
a:hover{opacity:.85}
::selection{background:var(--gold);color:var(--bg-deep)}
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:#22223a;border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:#33334a}

/* ── Layout ── */
.layout{display:flex;min-height:100vh}
.sidebar{width:var(--sidebar-w);position:fixed;top:0;left:0;bottom:0;z-index:100;
  background:var(--bg-sidebar);border-right:1px solid var(--border);
  display:flex;flex-direction:column;overflow-y:auto;overflow-x:hidden;
  backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)}
.sidebar::-webkit-scrollbar{width:4px}
.main{margin-left:var(--sidebar-w);flex:1;min-width:0}

/* ── Sidebar Brand ── */
.sb-brand{padding:1.25rem 1.25rem 1rem;border-bottom:1px solid var(--border)}
.sb-brand h1{font-size:1.05rem;font-weight:700;color:var(--gold);letter-spacing:-.01em}
.sb-brand span{display:block;font-size:.65rem;color:var(--text-muted);font-weight:400;margin-top:.15rem;letter-spacing:.03em}

/* ── Sidebar Nav ── */
.sb-nav{flex:1;padding:.75rem .65rem}
.sb-link{display:flex;align-items:center;gap:.65rem;padding:.55rem .75rem;border-radius:var(--radius-sm);
  font-size:.8rem;font-weight:450;color:var(--text-dim);transition:var(--transition);margin-bottom:2px;
  position:relative;overflow:hidden}
.sb-link:hover{background:rgba(255,255,255,.03);color:var(--text);opacity:1}
.sb-link.on{background:var(--gold-dim);color:var(--gold);font-weight:600}
.sb-link.on::before{content:'';position:absolute;left:0;top:20%;bottom:20%;width:3px;background:var(--gold);border-radius:0 3px 3px 0}
.sb-link svg{width:18px;height:18px;flex-shrink:0;stroke:currentColor;stroke-width:1.5;fill:none;stroke-linecap:round;stroke-linejoin:round}
.sb-link .count{margin-left:auto;font-size:.65rem;background:rgba(255,255,255,.06);padding:.1rem .4rem;border-radius:10px;font-weight:500;color:var(--text-muted)}
.sb-link.on .count{background:rgba(196,164,76,.15);color:var(--gold)}
.sb-sep{height:1px;background:var(--border);margin:.65rem .75rem}

/* ── Sidebar Footer ── */
.sb-foot{padding:1rem 1.25rem;border-top:1px solid var(--border)}
.sb-foot a{font-size:.72rem;color:var(--text-muted);display:flex;align-items:center;gap:.4rem;transition:var(--transition)}
.sb-foot a:hover{color:var(--text);opacity:1}
.sb-foot a svg{width:14px;height:14px;stroke:currentColor;stroke-width:1.5;fill:none;stroke-linecap:round;stroke-linejoin:round}

/* ── Top Bar ── */
.topbar{padding:1rem 2rem;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;
  background:rgba(10,10,18,.8);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);position:sticky;top:0;z-index:50}
.topbar h2{font-size:1.1rem;font-weight:600;color:var(--text)}
.topbar-right{display:flex;align-items:center;gap:1rem}
.topbar-badge{font-size:.65rem;color:var(--text-muted);background:var(--bg-card);padding:.25rem .6rem;border-radius:20px;border:1px solid var(--border)}

/* ── Content ── */
.content{padding:1.75rem 2rem;max-width:1400px}

/* ── Section Headers ── */
.sh{display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem}
.sh h3{font-size:.85rem;font-weight:600;color:var(--text-dim);letter-spacing:-.01em}
.sh-badge{font-size:.62rem;color:var(--text-muted);background:rgba(255,255,255,.04);padding:.2rem .55rem;border-radius:10px}

/* ── Stat Cards ── */
.stats-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:.85rem;margin-bottom:2rem}
.stat-card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:1.25rem 1.35rem;
  transition:var(--transition);position:relative;overflow:hidden}
.stat-card:hover{border-color:var(--border-light);transform:translateY(-1px);box-shadow:0 8px 32px rgba(0,0,0,.2)}
.stat-card::after{content:'';position:absolute;top:0;right:0;width:100px;height:100px;
  background:radial-gradient(circle at top right,var(--gold-glow),transparent 70%);pointer-events:none}
.stat-label{font-size:.68rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;font-weight:500;margin-bottom:.5rem}
.stat-value{font-size:2rem;font-weight:300;color:var(--gold);line-height:1;letter-spacing:-.02em}
.stat-trend{display:inline-flex;align-items:center;gap:.25rem;font-size:.68rem;margin-top:.55rem;padding:.15rem .45rem;border-radius:6px;font-weight:500}
.stat-trend.up{color:var(--green);background:var(--green-dim)}
.stat-trend.down{color:var(--red);background:var(--red-dim)}
.stat-trend svg{width:12px;height:12px;stroke:currentColor;stroke-width:2;fill:none}

/* ── Cards Generic ── */
.card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;transition:var(--transition)}
.card:hover{border-color:var(--border-light)}
.card-header{padding:1rem 1.25rem;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}
.card-header h4{font-size:.82rem;font-weight:600;color:var(--text-dim)}
.card-body{padding:1.25rem}
.card-body.np{padding:0}

/* ── Country Table ── */
.country-table{width:100%;border-collapse:collapse}
.country-table td{padding:.55rem .85rem;border-bottom:1px solid rgba(255,255,255,.03);font-size:.78rem}
.country-table tr:hover td{background:rgba(255,255,255,.015)}
.country-bar{height:20px;border-radius:4px;background:linear-gradient(90deg,rgba(196,164,76,.25),rgba(196,164,76,.55));transition:width .6s cubic-bezier(.4,0,.2,1);min-width:4px}
.country-flag{font-size:1.1rem;margin-right:.4rem;vertical-align:middle}
.country-code{font-size:.72rem;color:var(--text-dim);font-weight:500}
.country-hits{font-size:.72rem;color:var(--text-muted);font-weight:500;text-align:right;white-space:nowrap}

/* ── Traffic Chart ── */
.chart-wrap{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:1.25rem;margin-bottom:1.5rem}
.chart-wrap h4{font-size:.82rem;font-weight:600;color:var(--text-dim);margin-bottom:.85rem}
.chart-meta{display:flex;gap:1.5rem;margin-bottom:1rem}
.chart-meta-item{display:flex;flex-direction:column;gap:.1rem}
.chart-meta-val{font-size:1.3rem;font-weight:300;color:var(--text)}
.chart-meta-label{font-size:.62rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em}
.bar-chart{display:flex;align-items:flex-end;gap:4px;height:140px;padding-top:.5rem}
.bar-col{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px}
.bar-fill{width:100%;border-radius:4px 4px 2px 2px;min-height:3px;position:relative;transition:var(--transition);
  background:linear-gradient(180deg,var(--gold),rgba(196,164,76,.4))}
.bar-fill:hover{filter:brightness(1.3)}
.bar-fill:hover::after{content:attr(data-label);position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);
  background:var(--bg-card);color:var(--text);font-size:.65rem;padding:.3rem .55rem;border-radius:6px;
  white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,.3);border:1px solid var(--border);z-index:10;pointer-events:none}
.bar-label{font-size:.55rem;color:var(--text-muted);writing-mode:vertical-rl;text-orientation:mixed;transform:rotate(180deg);max-height:40px;overflow:hidden}

/* ── Tables ── */
table{width:100%;border-collapse:collapse;font-size:.78rem}
th{text-align:left;padding:.65rem .85rem;color:var(--text-muted);font-weight:500;font-size:.68rem;
  text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid var(--border);background:rgba(255,255,255,.01)}
td{padding:.65rem .85rem;border-bottom:1px solid rgba(255,255,255,.03);transition:var(--transition)}
tr:hover td{background:rgba(255,255,255,.015)}
.table-wrap{overflow-x:auto;border-radius:var(--radius);border:1px solid var(--border);background:var(--bg-card);margin-bottom:1.5rem}
.table-wrap table{margin:0}

/* ── Horizontal Bar Chart ── */
.hbar{margin-bottom:.5rem}
.hbar-row{display:flex;align-items:center;gap:.75rem;padding:.4rem 0}
.hbar-label{flex:0 0 200px;font-size:.72rem;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--mono);font-size:.68rem}
.hbar-track{flex:1;height:24px;background:rgba(255,255,255,.02);border-radius:4px;overflow:hidden;position:relative}
.hbar-fill{height:100%;border-radius:4px;transition:width .6s cubic-bezier(.4,0,.2,1);position:relative}
.hbar-fill.gold{background:linear-gradient(90deg,rgba(196,164,76,.3),rgba(196,164,76,.6))}
.hbar-fill.blue{background:linear-gradient(90deg,rgba(76,138,196,.3),rgba(76,138,196,.6))}
.hbar-fill.purple{background:linear-gradient(90deg,rgba(138,108,224,.3),rgba(138,108,224,.6))}
.hbar-fill.green{background:linear-gradient(90deg,rgba(61,220,132,.3),rgba(61,220,132,.5))}
.hbar-val{font-size:.7rem;color:var(--text-muted);flex:0 0 60px;text-align:right;font-weight:500}

/* ── View Bar (sparkline) ── */
.view-bar{display:inline-block;height:6px;border-radius:3px;background:linear-gradient(90deg,rgba(196,164,76,.3),var(--gold));vertical-align:middle;min-width:4px;transition:width .4s ease}

/* ── Status Badges ── */
.badge{display:inline-flex;align-items:center;gap:.25rem;padding:.15rem .5rem;border-radius:20px;font-size:.65rem;font-weight:500}
.badge-ok{background:var(--green-dim);color:var(--green)}
.badge-no{background:var(--red-dim);color:var(--red)}
.badge-info{background:var(--blue-dim);color:var(--blue)}

/* ── Thumbnail ── */
.thumb-sm{width:48px;height:28px;border-radius:4px;object-fit:cover;background:var(--bg-deep);flex-shrink:0}

/* ── Activity Feed ── */
.feed{display:flex;flex-direction:column;gap:.6rem;max-height:380px;overflow-y:auto;padding-right:.5rem}
.feed-item{display:flex;gap:.75rem;padding:.75rem;border-radius:var(--radius-sm);background:rgba(255,255,255,.015);transition:var(--transition)}
.feed-item:hover{background:rgba(255,255,255,.03)}
.feed-ava{width:32px;height:32px;border-radius:50%;flex-shrink:0;overflow:hidden;background:var(--gold-dim);
  display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:600;color:var(--gold)}
.feed-ava img{width:100%;height:100%;object-fit:cover}
.feed-body{flex:1;min-width:0}
.feed-name{font-size:.75rem;font-weight:600;color:var(--text)}
.feed-text{font-size:.72rem;color:var(--text-dim);margin-top:.15rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.feed-meta{font-size:.62rem;color:var(--text-muted);margin-top:.25rem}

/* ── User Cards ── */
.user-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:.85rem;margin-bottom:1.5rem}
.user-card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:1.25rem;transition:var(--transition);display:flex;flex-direction:column;gap:.75rem}
.user-card:hover{border-color:var(--border-light);transform:translateY(-1px)}
.user-card-top{display:flex;align-items:center;gap:.85rem}
.user-ava{width:42px;height:42px;border-radius:50%;flex-shrink:0;overflow:hidden;background:var(--gold-dim);
  display:flex;align-items:center;justify-content:center;font-size:.85rem;font-weight:600;color:var(--gold)}
.user-ava img{width:100%;height:100%;object-fit:cover}
.user-info{flex:1;min-width:0}
.user-name{font-size:.82rem;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.user-email{font-size:.68rem;color:var(--text-muted);font-family:var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.user-card-bottom{display:flex;align-items:center;justify-content:space-between;padding-top:.65rem;border-top:1px solid var(--border)}
.user-joined{font-size:.65rem;color:var(--text-muted)}
.user-role-form{display:flex;align-items:center;gap:.35rem}

/* ── Search Cloud ── */
.search-cloud{display:flex;flex-wrap:wrap;gap:.5rem;padding:1.25rem;align-items:center;justify-content:center}
.search-tag{display:inline-flex;align-items:center;gap:.35rem;padding:.35rem .75rem;border-radius:20px;
  background:rgba(255,255,255,.03);border:1px solid var(--border);transition:var(--transition);cursor:default}
.search-tag:hover{border-color:var(--gold);background:var(--gold-dim)}
.search-tag-q{font-size:.78rem;color:var(--text)}
.search-tag-c{font-size:.6rem;color:var(--text-muted);font-weight:500}
.search-tag-r{font-size:.55rem;color:var(--text-muted)}

/* ── Visitor / Device Cards ── */
.device-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:.85rem;margin-bottom:1.5rem}
.device-card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:1.15rem;
  transition:var(--transition);cursor:pointer;position:relative}
.device-card:hover{border-color:var(--border-light);transform:translateY(-1px);box-shadow:0 6px 24px rgba(0,0,0,.2)}
.device-card-top{display:flex;align-items:flex-start;gap:.85rem}
.device-icon{width:40px;height:40px;border-radius:var(--radius-sm);background:var(--gold-dim);
  display:flex;align-items:center;justify-content:center;color:var(--gold);flex-shrink:0}
.device-info{flex:1;min-width:0}
.device-os{font-size:.8rem;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.device-browser{font-size:.7rem;color:var(--text-dim);margin-top:.1rem}
.device-meta{display:flex;flex-wrap:wrap;gap:.5rem .85rem;margin-top:.75rem;padding-top:.65rem;border-top:1px solid var(--border)}
.device-meta-item{display:flex;align-items:center;gap:.3rem;font-size:.68rem;color:var(--text-muted)}
.device-meta-item svg{width:13px;height:13px;stroke:currentColor;stroke-width:1.5;fill:none;flex-shrink:0}
.device-meta-item .val{color:var(--text-dim);font-weight:500}
.device-user{display:flex;align-items:center;gap:.5rem;margin-top:.65rem;padding-top:.55rem;border-top:1px solid var(--border)}
.device-user-ava{width:24px;height:24px;border-radius:50%;overflow:hidden;background:var(--gold-dim);
  display:flex;align-items:center;justify-content:center;font-size:.55rem;font-weight:600;color:var(--gold);flex-shrink:0}
.device-user-ava img{width:100%;height:100%;object-fit:cover}
.device-user-name{font-size:.72rem;font-weight:500;color:var(--text)}
.device-user-email{font-size:.62rem;color:var(--text-muted);font-family:var(--mono)}
.device-visits{position:absolute;top:.85rem;right:.85rem;font-size:.62rem;color:var(--gold);background:var(--gold-dim);
  padding:.15rem .5rem;border-radius:10px;font-weight:600}
.device-expand{display:none;margin-top:.75rem;padding-top:.65rem;border-top:1px solid var(--border);font-size:.7rem;color:var(--text-muted)}
.device-card.expanded .device-expand{display:block}
.device-expand-row{display:flex;justify-content:space-between;padding:.25rem 0;border-bottom:1px solid rgba(255,255,255,.02)}
.device-expand-row .lbl{color:var(--text-muted);font-weight:500}
.device-expand-row .val{color:var(--text-dim);font-family:var(--mono);font-size:.65rem;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right}

/* ── SQL Console ── */
.sql-area{font-family:var(--mono) !important;font-size:.78rem !important;background:var(--bg-deep) !important;
  color:var(--gold) !important;border:1px solid var(--border) !important;border-radius:var(--radius-sm) !important;
  padding:.85rem !important;line-height:1.6;min-height:120px;resize:vertical;tab-size:2}
.sql-area:focus{border-color:var(--gold) !important;box-shadow:0 0 0 3px rgba(196,164,76,.08) !important}
.sql-hint{display:flex;align-items:center;gap:.5rem;margin-top:.5rem}
.sql-hint kbd{font-family:var(--mono);font-size:.62rem;padding:.1rem .35rem;border-radius:4px;
  background:rgba(255,255,255,.05);border:1px solid var(--border);color:var(--text-muted)}
.sql-history{display:flex;flex-wrap:wrap;gap:.3rem;margin-bottom:1rem}
.sql-history-item{font-size:.65rem;font-family:var(--mono);padding:.25rem .55rem;border-radius:6px;
  background:rgba(255,255,255,.03);border:1px solid var(--border);color:var(--text-muted);cursor:pointer;transition:var(--transition)}
.sql-history-item:hover{border-color:var(--gold);color:var(--gold)}

/* ── Tools ── */
.tool-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:.85rem;margin-bottom:2rem}
.tool-card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:1.5rem;
  text-align:center;transition:var(--transition);cursor:pointer;display:block}
.tool-card:hover{border-color:var(--gold);transform:translateY(-2px);box-shadow:0 8px 32px rgba(0,0,0,.2);opacity:1}
.tool-icon{font-size:1.8rem;margin-bottom:.65rem}
.tool-label{font-size:.82rem;font-weight:600;color:var(--text);margin-bottom:.25rem}
.tool-desc{font-size:.68rem;color:var(--text-muted)}

/* ── Timeline ── */
.timeline{position:relative;padding-left:2rem;margin:1rem 0}
.timeline::before{content:'';position:absolute;left:.45rem;top:0;bottom:0;width:2px;background:var(--border)}
.tl-item{position:relative;padding-bottom:1.25rem}
.tl-item::before{content:'';position:absolute;left:-1.65rem;top:.35rem;width:10px;height:10px;border-radius:50%;
  background:var(--gold);border:2px solid var(--bg-card);z-index:1}
.tl-item .tl-time{font-size:.62rem;color:var(--text-muted);font-family:var(--mono)}
.tl-item .tl-text{font-size:.75rem;color:var(--text-dim);margin-top:.15rem}

/* ── AI Chat ── */
.ai-container{max-width:780px}
.ai-messages{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius) var(--radius) 0 0;
  padding:1.25rem;min-height:300px;max-height:550px;overflow-y:auto}
.ai-msg{margin-bottom:.85rem;padding:.85rem 1rem;border-radius:var(--radius-sm);line-height:1.65;font-size:.82rem}
.ai-user{background:rgba(196,164,76,.08);border:1px solid rgba(196,164,76,.12);margin-left:3rem;color:var(--text)}
.ai-bot{background:rgba(255,255,255,.02);border:1px solid var(--border);margin-right:3rem;color:var(--text-dim)}
.ai-bot pre{font-family:var(--mono);font-size:.72rem;overflow-x:auto;background:var(--bg-deep);padding:.65rem;border-radius:var(--radius-sm);margin:.45rem 0;border:1px solid var(--border)}
.ai-bot code{font-family:var(--mono);font-size:.72rem;background:rgba(255,255,255,.05);padding:.1rem .3rem;border-radius:3px}
.ai-typing{color:var(--text-muted);font-style:italic;font-size:.75rem}
.ai-input-wrap{display:flex;gap:0;border:1px solid var(--border);border-top:none;border-radius:0 0 var(--radius) var(--radius);overflow:hidden;background:var(--bg-card)}
.ai-input-wrap input{border:none !important;border-radius:0 !important;padding:.85rem 1rem !important;background:transparent !important;font-size:.82rem}
.ai-input-wrap button{border:none;border-radius:0;padding:.85rem 1.5rem;background:var(--gold);color:var(--bg-deep);
  font-family:var(--font);font-size:.82rem;font-weight:600;cursor:pointer;transition:var(--transition);white-space:nowrap}
.ai-input-wrap button:hover{filter:brightness(1.1)}

/* ── Forms ── */
.form-card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;margin-bottom:1.5rem}
.form-section{padding:1.5rem}
.form-section+.form-section{border-top:1px solid var(--border)}
.form-section-title{font-size:.78rem;font-weight:600;color:var(--text-dim);margin-bottom:1rem;display:flex;align-items:center;gap:.5rem}
.form-section-title .num{width:22px;height:22px;border-radius:50%;background:var(--gold-dim);color:var(--gold);
  display:flex;align-items:center;justify-content:center;font-size:.65rem;font-weight:700;flex-shrink:0}
label{display:block;font-size:.72rem;color:var(--text-muted);font-weight:500;margin-bottom:.3rem;margin-top:.85rem}
label:first-child{margin-top:0}
input,select,textarea{width:100%;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-sm);
  padding:.55rem .8rem;color:var(--text);font-family:var(--font);font-size:.82rem;transition:var(--transition)}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--gold);box-shadow:0 0 0 3px rgba(196,164,76,.08)}
input::placeholder,textarea::placeholder{color:var(--text-muted)}
textarea{resize:vertical;min-height:80px;line-height:1.5}
select{cursor:pointer;-webkit-appearance:none;appearance:none;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2355556a'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:right .75rem center;padding-right:2rem}
select.rs{width:auto;padding:.3rem .5rem;font-size:.7rem;border-radius:6px;padding-right:1.5rem;background-position:right .4rem center}

/* ── Buttons ── */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;padding:.55rem 1.25rem;
  background:var(--gold);color:var(--bg-deep);border:none;border-radius:var(--radius-sm);
  font-family:var(--font);font-size:.82rem;font-weight:600;cursor:pointer;transition:var(--transition);white-space:nowrap}
.btn:hover{filter:brightness(1.1);transform:translateY(-1px)}
.btn:active{transform:translateY(0)}
.btn-sm{padding:.3rem .65rem;font-size:.72rem;border-radius:6px}
.btn-ghost{background:transparent;border:1px solid var(--border);color:var(--text-dim)}
.btn-ghost:hover{border-color:var(--gold);color:var(--gold)}
.btn-danger{background:transparent;border:1px solid rgba(224,64,88,.2);color:var(--red)}
.btn-danger:hover{background:var(--red);color:#fff;border-color:var(--red)}

/* ── Action Buttons ── */
.acts{display:flex;gap:.3rem}
.ab{padding:.25rem .55rem;border-radius:6px;font-size:.7rem;cursor:pointer;background:none;
  border:1px solid var(--border);color:var(--text-muted);transition:var(--transition);font-family:var(--font);white-space:nowrap}
.ab:hover{border-color:var(--gold);color:var(--gold)}
.db{color:var(--red);border-color:rgba(224,64,88,.2)}.db:hover{background:var(--red);color:#fff;border-color:var(--red)}

/* ── Checkbox ── */
.chk{width:16px;height:16px;accent-color:var(--gold);cursor:pointer}

/* ── Misc ── */
.mono{font-family:var(--mono);font-size:.72rem;color:var(--text-muted)}
.trunc{max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.flag{font-size:.95rem;margin-right:.3rem}
.back-link{display:inline-flex;align-items:center;gap:.35rem;font-size:.82rem;color:var(--text-dim);margin-bottom:1.25rem;transition:var(--transition)}
.back-link:hover{color:var(--gold);opacity:1}
.back-link svg{width:16px;height:16px;stroke:currentColor;stroke-width:2;fill:none}
.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:1.25rem}
.grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:1.25rem}
.empty-state{text-align:center;padding:3rem 1rem;color:var(--text-muted);font-size:.82rem}

/* ── Responsive ── */
@media(max-width:1024px){
  .grid-2,.grid-3{grid-template-columns:1fr}
  .stats-grid{grid-template-columns:repeat(auto-fit,minmax(130px,1fr))}
  .sidebar{width:60px}
  .sb-brand h1,.sb-brand span,.sb-link span,.sb-link .count,.sb-foot a span{display:none}
  .sb-link{justify-content:center;padding:.55rem}
  .sb-brand{padding:.85rem .5rem;text-align:center}
  .sb-foot{padding:.75rem .5rem;text-align:center}
  .main{margin-left:60px}
  .content{padding:1.25rem 1rem}
  .hbar-label{flex:0 0 120px}
}
@media(max-width:640px){
  .stats-grid{grid-template-columns:repeat(auto-fit,minmax(130px,1fr))}
  .user-grid{grid-template-columns:1fr}
  .device-grid{grid-template-columns:1fr}
  .tool-grid{grid-template-columns:1fr}
}
</style></head><body>

<div class="layout">
<!-- ── Sidebar ── -->
<nav class="sidebar">
  <div class="sb-brand">
    <h1>DeenSubs</h1>
    <span>Admin Console v3</span>
  </div>
  <div class="sb-nav">
    ${tabs.map(([id, label, icon], i) => {
      const count = id === 'videos' ? videos.length : id === 'comments' ? (comments||[]).length : id === 'users' ? (users||[]).length : 0;
      const isOn = !isEdit && tab === id;
      return `${i === 7 ? '<div class="sb-sep"></div>' : ''}` +
        `<a href="/admin?tab=${id}${q}" class="sb-link${isOn ? ' on' : ''}">` +
        `<svg viewBox="0 0 24 24">${icon}</svg>` +
        `<span>${label}</span>` +
        `${count ? `<span class="count">${count}</span>` : ''}` +
        `</a>`;
    }).join('')}
  </div>
  <div class="sb-foot">
    <a href="/">
      <svg viewBox="0 0 24 24"><path d="M10 19l-7-7m0 0l7-7m-7 7h18" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span>Back to site</span>
    </a>
  </div>
</nav>

<!-- ── Main Content ── -->
<div class="main">
<div class="topbar">
  <h2>${isEdit ? 'Edit Video' : tabs.find(t => t[0] === tab)?.[1] || 'Dashboard'}</h2>
  <div class="topbar-right">
    <span class="topbar-badge">${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
  </div>
</div>
<div class="content">

${isEdit ? `
<a href="/admin?tab=videos${q}" class="back-link">
  <svg viewBox="0 0 24 24"><path d="M10 19l-7-7m0 0l7-7m-7 7h18"/></svg>
  Back to Videos
</a>
<div class="form-card">
  <form method="post" action="${formAction}">
    <div class="form-section">
      <div class="form-section-title"><span class="num">1</span> Basic Information</div>
      <label>Title *</label><input name="title" required value="${e(v.title || '')}">
      <label>Arabic Title</label><input name="title_ar" dir="rtl" value="${e(v.title_ar || '')}">
      <label>Description</label><textarea name="description" rows="3">${e(v.description || '')}</textarea>
    </div>
    <div class="form-section">
      <div class="form-section-title"><span class="num">2</span> Categorization</div>
      <label>Category</label><select name="category_id">${categories.map(c => `<option value="${c.id}"${v.category_id === c.id ? ' selected' : ''}>${e(c.name)}</option>`).join('')}</select>
      <label>Source</label><input name="source" value="${e(v.source || '')}">
      <label>Duration (seconds)</label><input name="duration" type="number" value="${v.duration || ''}">
    </div>
    <div class="form-section">
      <div class="form-section-title"><span class="num">3</span> Media Files</div>
      <label>R2 Video Key *</label><input name="video_key" required value="${e(v.video_key || '')}">
      <label>R2 Subtitle Key</label><input name="srt_key" value="${e(v.srt_key || '')}">
      <label>R2 Thumbnail Key</label><input name="thumb_key" value="${e(v.thumb_key || '')}">
    </div>
    <div class="form-section" style="display:flex;justify-content:flex-end">
      <button class="btn" type="submit">Save Changes</button>
    </div>
  </form>
</div>
` : ''}

${!isEdit && tab === 'dashboard' ? `
<!-- ── Stat Cards (5 max) ── -->
<div class="stats-grid">
  <div class="stat-card">
    <div class="stat-label">Total Videos</div>
    <div class="stat-value">${fmt(stats?.video_count || 0)}</div>
    <div class="stat-trend up"><svg viewBox="0 0 24 24"><path d="M5 15l7-7 7 7"/></svg> Content library</div>
  </div>
  <div class="stat-card">
    <div class="stat-label">Registered Users</div>
    <div class="stat-value">${fmt(stats?.user_count || 0)}</div>
    <div class="stat-trend up"><svg viewBox="0 0 24 24"><path d="M5 15l7-7 7 7"/></svg> Growing</div>
  </div>
  <div class="stat-card">
    <div class="stat-label">Comments</div>
    <div class="stat-value">${fmt(stats?.comment_count || 0)}</div>
    <div class="stat-trend up"><svg viewBox="0 0 24 24"><path d="M5 15l7-7 7 7"/></svg> Engagement</div>
  </div>
  <div class="stat-card">
    <div class="stat-label">Total Views</div>
    <div class="stat-value">${fmt(stats?.total_views || 0)}</div>
    <div class="stat-trend up"><svg viewBox="0 0 24 24"><path d="M5 15l7-7 7 7"/></svg> All time</div>
  </div>
  <div class="stat-card">
    <div class="stat-label">Total Likes</div>
    <div class="stat-value">${fmt(stats?.total_likes || 0)}</div>
    <div class="stat-trend up"><svg viewBox="0 0 24 24"><path d="M5 15l7-7 7 7"/></svg> Appreciation</div>
  </div>
</div>

<!-- ── Interactive Map ── -->
<div class="card" style="margin-bottom:1rem">
  <div class="card-header"><h4>Visitor Map</h4><span class="sh-badge">${countries.length} countries</span></div>
  <div class="card-body np">
    <div id="admin-map" style="height:360px;border-radius:8px;background:#080810;position:relative;z-index:1"></div>
  </div>
</div>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<script src="https://unpkg.com/leaflet-choropleth@1.1.4/dist/choropleth.js"><\/script>
<script>
(function(){
  var hitData={};
  var maxH=1;
  ${JSON.stringify(countries)}.forEach(function(c){hitData[c.country]=c.hits;if(c.hits>maxH)maxH=c.hits});

  var map=L.map('admin-map',{zoomControl:false,attributionControl:false,minZoom:2,maxZoom:6,worldCopyJump:true}).setView([20,30],2);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png',{subdomains:'abcd'}).addTo(map);

  // Load GeoJSON country boundaries and color them
  fetch('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson')
    .then(function(r){return r.json()})
    .then(function(geo){
      var gl=L.geoJSON(geo,{
        style:function(feature){
          var iso=feature.properties['ISO3166-1-Alpha-2'];
          var hits=hitData[iso]||0;
          if(!hits)return{fillColor:'#0e0e1a',color:'#1a1a2e',weight:.3,fillOpacity:.4};
          var intensity=Math.min(hits/maxH,1);
          var r=Math.round(196*(0.3+intensity*0.7));
          var g=Math.round(164*(0.3+intensity*0.7));
          var b=Math.round(76*(0.3+intensity*0.7));
          return{fillColor:'rgb('+r+','+g+','+b+')',color:'#c4a44c',weight:intensity>0.3?1.5:.5,fillOpacity:0.2+intensity*0.6};
        },
        onEachFeature:function(feature,layer){
          var iso=feature.properties['ISO3166-1-Alpha-2'];
          var hits=hitData[iso];
          if(hits){
            layer.bindTooltip('<strong>'+feature.properties.name+'</strong><br>'+hits+' hits',{className:'map-tip',sticky:true});
            layer.on('mouseover',function(){this.setStyle({weight:2.5,fillOpacity:0.85})});
            layer.on('mouseout',function(e){gl.resetStyle(e.target)});
          }
        }
      }).addTo(map);
    }).catch(function(){
      // Fallback to circle markers if GeoJSON fails
      var cc={DK:[56,10],US:[38,-97],SA:[24,45],AE:[24,54],GB:[54,-2],DE:[51,10],FR:[46,2],NL:[52,5],SE:[62,15],NO:[60,8],CA:[56,-106],AU:[-25,134],IN:[20,77],PK:[30,70],EG:[27,30],TR:[39,35],MY:[4,102],ID:[-5,120],JP:[36,138],KR:[37,128],BR:[-14,-51],IT:[43,12],ES:[40,-4]};
      ${JSON.stringify(countries)}.forEach(function(c){
        var pos=cc[c.country];if(!pos)return;
        var r=Math.max(5,Math.min(22,Math.sqrt(c.hits/maxH)*22));
        L.circleMarker(pos,{radius:r,color:'#c4a44c',fillColor:'#c4a44c',fillOpacity:0.5,weight:1})
          .bindTooltip(c.country+': '+c.hits+' hits',{className:'map-tip'}).addTo(map);
      });
    });
})();
<\/script>
<style>
.map-tip{background:rgba(10,10,20,.92)!important;color:#e0e0e0!important;border:1px solid rgba(196,164,76,.3)!important;font-family:inherit;font-size:.75rem;padding:6px 10px!important;border-radius:6px!important;box-shadow:0 4px 16px rgba(0,0,0,.4)!important}
.map-tip strong{color:#c4a44c}
.leaflet-container{background:#080810!important}
</style>

<!-- ── Countries Table ── -->
<div class="card" style="margin-bottom:1.5rem">
  <div class="card-header"><h4>Global Visitor Distribution</h4><span class="sh-badge">${countries.length} countries &middot; ${fmt(countries.reduce((s,c)=>s+c.hits,0))} total hits</span></div>
  <div class="card-body${countries.length ? ' np' : ''}">
    ${countries.length ? (() => {
      const maxC = Math.max(...countries.map(c => c.hits), 1);
      return `<table class="country-table">${countries.slice(0, 20).map(c => `<tr>
        <td style="width:44px"><span class="country-flag">${flag(c.country)}</span></td>
        <td style="width:60px"><span class="country-code">${e(c.country)}</span></td>
        <td><div class="country-bar" style="width:${Math.max((c.hits / maxC) * 100, 2)}%"></div></td>
        <td style="width:70px" class="country-hits">${fmt(c.hits)} hits</td>
      </tr>`).join('')}</table>`;
    })() : '<div class="empty-state">No country data yet</div>'}
  </div>
</div>

<div class="grid-2">
  <!-- ── Traffic Chart ── -->
  <div class="chart-wrap">
    <h4>Traffic &mdash; Last ${dailyHits.length} Days</h4>
    <div class="chart-meta">
      <div class="chart-meta-item"><div class="chart-meta-val">${fmt(totalHits)}</div><div class="chart-meta-label">Total Hits</div></div>
      <div class="chart-meta-item"><div class="chart-meta-val">${fmt(avgHits)}</div><div class="chart-meta-label">Avg / Day</div></div>
    </div>
    ${dailyHits.length ? `<div class="bar-chart">${(() => {
      const sorted = [...dailyHits].reverse();
      const max = Math.max(...sorted.map(d => d.hits), 1);
      return sorted.map(d => {
        const pct = Math.max((d.hits / max) * 100, 3);
        const dayLabel = d.day.slice(5);
        return `<div class="bar-col"><div class="bar-fill" style="height:${pct}%" data-label="${d.day}: ${fmt(d.hits)} hits"></div><div class="bar-label">${dayLabel}</div></div>`;
      }).join('');
    })()}</div>` : '<div class="empty-state">No traffic data yet</div>'}
  </div>

  <!-- ── Top Videos (with real titles) ── -->
  <div class="card">
    <div class="card-header"><h4>Top Videos</h4><span class="sh-badge">${topVideos.length} videos</span></div>
    <div class="card-body np">
      <table>
        <tr><th>Video</th><th>Hits</th><th style="width:120px">Share</th></tr>
        ${(() => {
          const maxV = Math.max(...topVideos.map(v => v.hits), 1);
          return topVideos.slice(0, 10).map(vi => {
            const title = resolveTitle(vi.slug, videos);
            return `<tr>
            <td><a href="/watch/${e(vi.slug)}" style="font-size:.78rem" title="${e(vi.slug)}">${e(title)}</a></td>
            <td style="font-weight:500">${fmt(vi.hits)}</td>
            <td><span class="view-bar" style="width:${Math.max((vi.hits / maxV) * 100, 4)}%"></span></td>
          </tr>`;
          }).join('');
        })()}
      </table>
    </div>
  </div>
</div>

<!-- ── Recent Activity ── -->
<div class="grid-2" style="margin-top:1.25rem">
  <div class="card">
    <div class="card-header"><h4>Top Countries</h4><span class="sh-badge">${countries.length} countries</span></div>
    <div class="card-body np">
      <table>
        <tr><th>Country</th><th>Hits</th><th style="width:120px">Share</th></tr>
        ${(() => {
          const maxC = Math.max(...countries.map(c => c.hits), 1);
          return countries.slice(0, 10).map(c => `<tr>
            <td><span class="flag">${flag(c.country)}</span> ${e(c.country)}</td>
            <td style="font-weight:500">${fmt(c.hits)}</td>
            <td><span class="view-bar" style="width:${Math.max((c.hits / maxC) * 100, 4)}%"></span></td>
          </tr>`).join('');
        })()}
      </table>
    </div>
  </div>

  <div class="card">
    <div class="card-header"><h4>Live Activity</h4><span class="sh-badge">Recent comments</span></div>
    <div class="card-body">
      <div class="feed">
        ${(comments || []).slice(0, 10).map(c => `<div class="feed-item">
          <div class="feed-ava">${c.user_avatar ? `<img src="${e(c.user_avatar)}" alt="">` : (c.user_name || c.author || '?')[0].toUpperCase()}</div>
          <div class="feed-body">
            <div class="feed-name">${e(c.user_name || c.author)} <span style="color:var(--text-muted);font-weight:400;font-size:.7rem">on</span> <a href="/watch/${e(c.video_slug || '')}" style="font-size:.72rem">${e((c.video_title || '?').slice(0, 35))}</a></div>
            <div class="feed-text">${e(c.content)}</div>
            <div class="feed-meta">${ago(c.created_at)}</div>
          </div>
        </div>`).join('')}
        ${!(comments||[]).length ? '<div class="empty-state">No comments yet</div>' : ''}
      </div>
    </div>
  </div>
</div>
` : ''}

${!isEdit && tab === 'analytics' ? `
<!-- ── Top Pages (with real titles) ── -->
<div class="card" style="margin-bottom:1.5rem">
  <div class="card-header"><h4>Top Pages</h4><span class="sh-badge">${topPages.length} pages</span></div>
  <div class="card-body">
    <div class="hbar">
    ${(() => {
      const maxP = Math.max(...topPages.map(p => p.hits), 1);
      return topPages.slice(0, 15).map(p => {
        const label = resolvePath(p.path, videos);
        return `<div class="hbar-row">
        <div class="hbar-label" title="${e(p.path)}">${e(label)}</div>
        <div class="hbar-track"><div class="hbar-fill gold" style="width:${Math.max((p.hits / maxP) * 100, 2)}%"></div></div>
        <div class="hbar-val">${fmt(p.hits)}</div>
      </div>`;
      }).join('');
    })()}
    </div>
  </div>
</div>

<div class="grid-2">
  <!-- ── Most Watched Videos (with real titles) ── -->
  <div class="card">
    <div class="card-header"><h4>Most Watched Videos</h4></div>
    <div class="card-body">
      <div class="hbar">
      ${(() => {
        const maxV = Math.max(...topVideos.map(v => v.hits), 1);
        return topVideos.slice(0, 12).map(vi => {
          const title = resolveTitle(vi.slug, videos);
          return `<div class="hbar-row">
          <div class="hbar-label"><a href="/watch/${e(vi.slug)}" title="${e(vi.slug)}">${e(title)}</a></div>
          <div class="hbar-track"><div class="hbar-fill blue" style="width:${Math.max((vi.hits / maxV) * 100, 2)}%"></div></div>
          <div class="hbar-val">${fmt(vi.hits)}</div>
        </div>`;
        }).join('');
      })()}
      </div>
    </div>
  </div>

  <!-- ── Top Referrers ── -->
  <div class="card">
    <div class="card-header"><h4>Top Referrers</h4></div>
    <div class="card-body">
      <div class="hbar">
      ${(() => {
        const maxR = Math.max(...referers.map(r => r.hits), 1);
        return referers.slice(0, 12).map(r => `<div class="hbar-row">
          <div class="hbar-label" title="${e(r.referer)}">${e(r.referer)}</div>
          <div class="hbar-track"><div class="hbar-fill purple" style="width:${Math.max((r.hits / maxR) * 100, 2)}%"></div></div>
          <div class="hbar-val">${fmt(r.hits)}</div>
        </div>`).join('');
      })()}
      ${!referers.length ? '<div class="empty-state">No referrer data</div>' : ''}
      </div>
    </div>
  </div>
</div>

<!-- ── User Agents ── -->
<div class="card" style="margin-top:1.5rem">
  <div class="card-header"><h4>User Agents</h4><span class="sh-badge">${agents.length} agents</span></div>
  <div class="card-body">
    <div class="hbar">
    ${(() => {
      const maxA = Math.max(...agents.map(a => a.hits), 1);
      return agents.slice(0, 12).map(a => `<div class="hbar-row">
        <div class="hbar-label" title="${e(a.user_agent)}">${e(a.user_agent.slice(0, 60))}</div>
        <div class="hbar-track"><div class="hbar-fill green" style="width:${Math.max((a.hits / maxA) * 100, 2)}%"></div></div>
        <div class="hbar-val">${fmt(a.hits)}</div>
      </div>`).join('');
    })()}
    </div>
  </div>
</div>
` : ''}

${!isEdit && tab === 'videos' ? `
<div class="table-wrap">
  <table>
    <tr>
      <th style="width:48px">Thumb</th>
      <th>Title</th>
      <th>Category</th>
      <th>Views</th>
      <th>Likes</th>
      <th>Subtitles</th>
      <th>Created</th>
      <th style="width:120px">Actions</th>
    </tr>
    ${videos.map(vi => {
      const thumbUrl = vi.thumb_key ? `/img/${vi.thumb_key.replace(/\.(jpg|jpeg|png)$/i, '')}-640w.avif` : '';
      return `<tr>
        <td>${thumbUrl ? `<img src="${e(thumbUrl)}" class="thumb-sm" alt="" loading="lazy">` : '<div class="thumb-sm" style="background:var(--bg-deep)"></div>'}</td>
        <td><a href="/watch/${e(vi.slug)}" style="font-weight:500">${e(vi.title)}</a></td>
        <td style="color:var(--text-dim);font-size:.75rem">${e(vi.category_name || '-')}</td>
        <td style="font-weight:500">${fmt(vi.views)}</td>
        <td style="font-weight:500">${fmt(vi.likes)}</td>
        <td>${vi.srt_key ? '<span class="badge badge-ok">Has Subs</span>' : '<span class="badge badge-no">No Subs</span>'}</td>
        <td style="color:var(--text-muted);font-size:.72rem">${ago(vi.created_at)}</td>
        <td>
          <div class="acts">
            <a href="/admin/edit/${vi.id}?tab=videos${q}" class="ab">Edit</a>
            <form method="post" action="/admin/delete/${vi.id}?tab=videos${q}" onsubmit="return confirm('Delete this video?')" style="margin:0">
              <button class="ab db">Del</button>
            </form>
          </div>
        </td>
      </tr>`;
    }).join('')}
  </table>
</div>
` : ''}

${!isEdit && tab === 'comments' ? `
<div class="card" style="margin-bottom:1.5rem">
  <div class="card-header">
    <h4>Comment Moderation</h4>
    <span class="sh-badge">${(comments||[]).length} comments</span>
  </div>
  <div class="card-body np">
    <table>
      <tr>
        <th style="width:30px"><input type="checkbox" class="chk" id="chk-all"></th>
        <th>User</th>
        <th>Video</th>
        <th>Comment</th>
        <th>When</th>
        <th style="width:60px"></th>
      </tr>
      ${(comments || []).map(c => `<tr>
        <td><input type="checkbox" class="chk chk-item" value="${c.id}"></td>
        <td>
          <div style="display:flex;align-items:center;gap:.55rem">
            <div class="feed-ava" style="width:28px;height:28px;font-size:.65rem">${c.user_avatar ? `<img src="${e(c.user_avatar)}" alt="">` : (c.user_name || c.author || '?')[0].toUpperCase()}</div>
            <span style="font-weight:500;font-size:.78rem">${e(c.user_name || c.author)}</span>
          </div>
        </td>
        <td><a href="/watch/${e(c.video_slug || '')}" style="font-size:.75rem">${e((c.video_title || '?').slice(0, 30))}</a></td>
        <td class="trunc" style="max-width:300px">${e(c.content)}</td>
        <td style="color:var(--text-muted);font-size:.72rem">${ago(c.created_at)}</td>
        <td>
          <form method="post" action="/admin/delete-comment/${c.id}?tab=comments${q}" onsubmit="return confirm('Delete this comment?')" style="margin:0">
            <button class="ab db">Del</button>
          </form>
        </td>
      </tr>`).join('')}
    </table>
  </div>
</div>
<script>
document.getElementById('chk-all').onchange=function(){
  document.querySelectorAll('.chk-item').forEach(function(c){c.checked=this.checked}.bind(this));
};
</script>
` : ''}

${!isEdit && tab === 'users' ? `
<div class="user-grid">
  ${(users || []).map(u => `<div class="user-card">
    <div class="user-card-top">
      <div class="user-ava">${u.avatar ? `<img src="${e(u.avatar)}" alt="">` : (u.name || '?')[0].toUpperCase()}</div>
      <div class="user-info">
        <div class="user-name">${e(u.name)}</div>
        <div class="user-email">${e(u.email)}</div>
      </div>
      <span class="badge ${u.role === 'admin' ? 'badge-info' : 'badge-ok'}">${e(u.role || 'user')}</span>
    </div>
    <div class="user-card-bottom">
      <div class="user-joined">Joined ${ago(u.created_at)}</div>
      <form method="post" action="/admin/user-role/${u.id}?tab=users${q}" style="margin:0" class="user-role-form">
        <select name="role" class="rs">
          <option value="user"${u.role !== 'admin' ? ' selected' : ''}>user</option>
          <option value="admin"${u.role === 'admin' ? ' selected' : ''}>admin</option>
        </select>
        <button class="btn-sm btn-ghost" style="padding:.25rem .5rem;font-size:.65rem;border:1px solid var(--border);border-radius:6px;background:none;color:var(--text-muted);cursor:pointer;font-family:var(--font)">Set</button>
      </form>
    </div>
  </div>`).join('')}
</div>
${!(users||[]).length ? '<div class="empty-state">No users found</div>' : ''}
` : ''}

${!isEdit && tab === 'searches' ? `
<div class="card" style="margin-bottom:1.5rem">
  <div class="card-header"><h4>Search Cloud</h4><span class="sh-badge">${searchLogs.length} unique queries</span></div>
  <div class="card-body">
    <div class="search-cloud">
      ${(() => {
        const maxS = Math.max(...searchLogs.map(s => s.times), 1);
        return searchLogs.map(s => {
          const scale = 0.7 + (s.times / maxS) * 0.8;
          const opacity = 0.4 + (s.times / maxS) * 0.6;
          return `<div class="search-tag" style="font-size:${scale}rem;opacity:${opacity}">
            <span class="search-tag-q">${e(s.query)}</span>
            <span class="search-tag-c">${s.times}x</span>
            <span class="search-tag-r">${s.results} results</span>
          </div>`;
        }).join('');
      })()}
      ${!searchLogs.length ? '<div class="empty-state">No search data yet</div>' : ''}
    </div>
  </div>
</div>

<!-- Search table below cloud -->
<div class="table-wrap">
  <table>
    <tr><th>Query</th><th>Results Found</th><th>Times Searched</th><th>Popularity</th></tr>
    ${(() => {
      const maxS = Math.max(...searchLogs.map(s => s.times), 1);
      return searchLogs.map(s => `<tr>
        <td style="font-weight:500">${e(s.query)}</td>
        <td>${s.results > 0 ? `<span class="badge badge-ok">${s.results} found</span>` : `<span class="badge badge-no">No results</span>`}</td>
        <td style="font-weight:500">${s.times}</td>
        <td><span class="view-bar" style="width:${Math.max((s.times / maxS) * 100, 4)}%"></span></td>
      </tr>`).join('');
    })()}
  </table>
</div>
` : ''}

${!isEdit && tab === 'visitors' ? `
<!-- ── Fingerprint Device Cards ── -->
<div class="sh"><h3>Device Fingerprints</h3><span class="sh-badge">${visitors.length} devices</span></div>
<div class="device-grid">
  ${visitors.map((vi, idx) => `<div class="device-card" id="dev-${idx}" onclick="(function(el){el.classList.toggle('expanded')})(document.getElementById('dev-${idx}'))">
    <div class="device-visits">${fmt(vi.visit_count || 0)} visits</div>
    <div class="device-card-top">
      <div class="device-icon">${deviceIcon(vi.device_type)}</div>
      <div class="device-info">
        <div class="device-os">${e(vi.os || 'Unknown OS')} &middot; ${e(vi.browser || 'Unknown')}</div>
        <div class="device-browser">${e((vi.device_type || 'desktop').charAt(0).toUpperCase() + (vi.device_type || 'desktop').slice(1))} &middot; ${vi.screen_w || '?'}x${vi.screen_h || '?'}</div>
      </div>
    </div>
    <div class="device-meta">
      <div class="device-meta-item">
        <svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
        <span class="val">${flag(vi.country)} ${e(vi.country || '??')}${vi.city ? ', ' + e(vi.city) : ''}</span>
      </div>
      <div class="device-meta-item">
        <svg viewBox="0 0 24 24"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        <span class="val">${ago(vi.last_seen)}</span>
      </div>
      ${vi.gpu ? `<div class="device-meta-item">
        <svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        <span class="val" title="${e(vi.gpu)}">${e((vi.gpu || '').length > 30 ? vi.gpu.slice(0, 30) + '...' : (vi.gpu || ''))}</span>
      </div>` : ''}
    </div>
    ${vi.user_name ? `<div class="device-user">
      <div class="device-user-ava">${vi.user_avatar ? `<img src="${e(vi.user_avatar)}" alt="">` : (vi.user_name || '?')[0].toUpperCase()}</div>
      <div>
        <div class="device-user-name">${e(vi.user_name)}</div>
        ${vi.user_email ? `<div class="device-user-email">${e(vi.user_email)}</div>` : ''}
      </div>
    </div>` : ''}
    <div class="device-expand">
      <div class="device-expand-row"><span class="lbl">Fingerprint ID</span><span class="val">${e(vi.id || '')}</span></div>
      <div class="device-expand-row"><span class="lbl">IP Address</span><span class="val">${e(vi.ip || '')}</span></div>
      <div class="device-expand-row"><span class="lbl">User Agent</span><span class="val" title="${e(vi.user_agent || '')}">${e((vi.user_agent || '').slice(0, 80))}</span></div>
      <div class="device-expand-row"><span class="lbl">Screen</span><span class="val">${vi.screen_w || '?'}x${vi.screen_h || '?'}</span></div>
      <div class="device-expand-row"><span class="lbl">GPU</span><span class="val" title="${e(vi.gpu || '')}">${e(vi.gpu || 'N/A')}</span></div>
      <div class="device-expand-row"><span class="lbl">Timezone</span><span class="val">${e(vi.timezone || 'N/A')}</span></div>
      <div class="device-expand-row"><span class="lbl">Language</span><span class="val">${e(vi.language || 'N/A')}</span></div>
      <div class="device-expand-row"><span class="lbl">CPU Cores</span><span class="val">${vi.cores || 'N/A'}</span></div>
      <div class="device-expand-row"><span class="lbl">Memory</span><span class="val">${vi.memory ? vi.memory + ' GB' : 'N/A'}</span></div>
      <div class="device-expand-row"><span class="lbl">Touch</span><span class="val">${vi.touch ? 'Yes' : 'No'}</span></div>
      <div class="device-expand-row"><span class="lbl">First Seen</span><span class="val">${vi.first_seen || 'N/A'}</span></div>
      <div class="device-expand-row"><span class="lbl">Last Seen</span><span class="val">${vi.last_seen || 'N/A'}</span></div>
      <div class="device-expand-row"><span class="lbl">User ID</span><span class="val">${vi.user_id || 'Anonymous'}</span></div>
      <div style="margin-top:.65rem"><button class="btn-sm btn-ghost vj-btn" onclick="event.stopPropagation();showVisitorJourney('${e(vi.id)}')">View Full Journey</button></div>
    </div>
  </div>`).join('')}
</div>
${!visitors.length ? '<div class="empty-state">No visitor fingerprints yet</div>' : ''}

<!-- Visitor Journey Modal -->
<div id="vj-modal" style="display:none;position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.7);backdrop-filter:blur(8px);overflow-y:auto">
  <div style="max-width:680px;margin:3rem auto;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:1.5rem">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
      <h3 style="font-size:.95rem;font-weight:600">Visitor Journey</h3>
      <button onclick="document.getElementById('vj-modal').style.display='none'" style="background:none;border:none;color:var(--text-dim);font-size:1.2rem;cursor:pointer">&times;</button>
    </div>
    <div id="vj-content"><div style="color:var(--text-muted);font-size:.78rem">Loading...</div></div>
  </div>
</div>
<script>
function showVisitorJourney(fpId){
  var modal=document.getElementById('vj-modal');
  var content=document.getElementById('vj-content');
  modal.style.display='block';content.innerHTML='<div style="color:var(--text-muted);font-size:.78rem">Loading journey data...</div>';
  fetch('/admin/visitor-journey/'+fpId).then(function(r){return r.json()}).then(function(d){
    if(!d.fingerprint){content.innerHTML='<p style="color:var(--red)">Fingerprint not found</p>';return}
    var fp=d.fingerprint;var html='';
    html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-bottom:1rem">';
    html+='<div style="font-size:.72rem"><span style="color:var(--text-muted)">Device:</span> '+fp.os+' / '+fp.browser+'</div>';
    html+='<div style="font-size:.72rem"><span style="color:var(--text-muted)">Screen:</span> '+fp.screen_w+'x'+fp.screen_h+'</div>';
    html+='<div style="font-size:.72rem"><span style="color:var(--text-muted)">Location:</span> '+(fp.country||'??')+' '+(fp.city||'')+'</div>';
    html+='<div style="font-size:.72rem"><span style="color:var(--text-muted)">Visits:</span> '+fp.visit_count+'</div>';
    html+='</div>';
    if(d.user){html+='<div style="padding:.65rem;background:rgba(196,164,76,.06);border-radius:8px;margin-bottom:1rem;font-size:.78rem"><strong style="color:var(--gold)">Linked user:</strong> '+d.user.name+' ('+d.user.email+')</div>';}
    if(d.watchEvents&&d.watchEvents.length){
      html+='<h4 style="font-size:.8rem;color:var(--text-dim);margin-bottom:.5rem">Watch History</h4>';
      html+='<div style="max-height:300px;overflow-y:auto">';
      var seen={};d.watchEvents.forEach(function(w){
        if(seen[w.video_slug])return;seen[w.video_slug]=true;
        var title=d.videoMap[w.video_slug]||w.video_slug;
        var pct=w.duration>0?Math.round(w.position*100/w.duration):0;
        html+='<div style="display:flex;align-items:center;gap:.65rem;padding:.45rem 0;border-bottom:1px solid rgba(255,255,255,.03)">';
        html+='<div style="flex:1;min-width:0"><div style="font-size:.75rem;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+title+'</div>';
        html+='<div style="font-size:.62rem;color:var(--text-muted)">'+w.created_at+'</div></div>';
        html+='<div style="width:60px;height:6px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden"><div style="height:100%;width:'+pct+'%;background:var(--gold);border-radius:3px"></div></div>';
        html+='<span style="font-size:.65rem;color:var(--text-muted);min-width:30px;text-align:right">'+pct+'%</span></div>';
      });
      html+='</div>';
    } else {html+='<p style="color:var(--text-muted);font-size:.75rem">No watch events recorded for this device</p>';}
    content.innerHTML=html;
  }).catch(function(ex){content.innerHTML='<p style="color:var(--red)">'+ex.message+'</p>'});
}
</script>
` : ''}

${!isEdit && tab === 'watch' ? `
<!-- ── Watch Events Analytics ── -->
<div class="stats-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:1.5rem">
  ${(() => {
    const totalEvents = watchEvents.reduce((s, e) => s + e.count, 0);
    const playEvents = watchEvents.find(e => e.event_type === 'play')?.count || 0;
    const endEvents = watchEvents.find(e => e.event_type === 'end')?.count || 0;
    const uniqueVids = watchCompletion.length;
    return `
    <div class="stat-card"><div class="stat-label">Total Events</div><div class="stat-value">${fmt(totalEvents)}</div></div>
    <div class="stat-card"><div class="stat-label">Play Events</div><div class="stat-value">${fmt(playEvents)}</div></div>
    <div class="stat-card"><div class="stat-label">Completions</div><div class="stat-value">${fmt(endEvents)}</div></div>
    <div class="stat-card"><div class="stat-label">Videos Watched</div><div class="stat-value">${fmt(uniqueVids)}</div></div>`;
  })()}
</div>

<!-- Event Type Distribution -->
<div class="grid-2" style="margin-bottom:1.5rem">
  <div class="card">
    <div class="card-header"><h4>Event Distribution</h4></div>
    <div class="card-body">
      <div class="hbar">
      ${(() => {
        const maxE = Math.max(...watchEvents.map(e => e.count), 1);
        const colors = { play: 'green', pause: 'gold', seek: 'blue', end: 'purple', buffer: 'gold' };
        return watchEvents.map(ev => `<div class="hbar-row">
          <div class="hbar-label">${e(ev.event_type)}</div>
          <div class="hbar-track"><div class="hbar-fill ${colors[ev.event_type] || 'gold'}" style="width:${Math.max((ev.count / maxE) * 100, 2)}%"></div></div>
          <div class="hbar-val">${fmt(ev.count)}</div>
        </div>`).join('');
      })()}
      ${!watchEvents.length ? '<div class="empty-state">No watch events yet</div>' : ''}
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-header"><h4>Connection Types</h4></div>
    <div class="card-body">
      <div class="hbar">
      ${(() => {
        const maxC = Math.max(...(watchConnections || []).map(c => c.count), 1);
        return (watchConnections || []).map(c => `<div class="hbar-row">
          <div class="hbar-label">${e(c.connection || 'unknown')}</div>
          <div class="hbar-track"><div class="hbar-fill blue" style="width:${Math.max((c.count / maxC) * 100, 2)}%"></div></div>
          <div class="hbar-val">${fmt(c.count)}</div>
        </div>`).join('');
      })()}
      ${!watchConnections?.length ? '<div class="empty-state">No connection data</div>' : ''}
      </div>
    </div>
  </div>
</div>

<!-- Video Completion Rates -->
<div class="card" style="margin-bottom:1.5rem">
  <div class="card-header"><h4>Video Engagement</h4><span class="sh-badge">${watchCompletion.length} videos tracked</span></div>
  <div class="card-body np">
    <table>
      <tr><th>Video</th><th>Unique Viewers</th><th>Events</th><th style="width:180px">Avg. Completion</th></tr>
      ${watchCompletion.map(w => {
        const title = resolveTitle(w.video_slug, videos);
        const pct = Math.min(w.avg_pct || 0, 100);
        return `<tr>
          <td><a href="/watch/${e(w.video_slug)}" style="font-size:.78rem">${e(title)}</a></td>
          <td style="font-weight:500">${fmt(w.viewers)}</td>
          <td>${fmt(w.events)}</td>
          <td>
            <div style="display:flex;align-items:center;gap:.5rem">
              <div style="flex:1;height:8px;background:rgba(255,255,255,.04);border-radius:4px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:${pct > 50 ? 'var(--green)' : pct > 25 ? 'var(--gold)' : 'var(--red)'};border-radius:4px;transition:width .6s"></div>
              </div>
              <span style="font-size:.7rem;color:var(--text-dim);min-width:35px;text-align:right">${pct.toFixed(0)}%</span>
            </div>
          </td>
        </tr>`;
      }).join('')}
    </table>
    ${!watchCompletion.length ? '<div class="empty-state">No watch data yet. Watch events are recorded as users play videos.</div>' : ''}
  </div>
</div>
` : ''}

${!isEdit && tab === 'sql' ? `
<p style="color:var(--text-muted);font-size:.75rem;margin-bottom:1rem">Read-only. SELECT queries only. Direct access to the D1 database.</p>

<div id="sql-history-wrap" class="sql-history" style="display:none"></div>

<div class="card" style="margin-bottom:1.25rem">
  <div class="card-body">
    <textarea id="sql-input" class="sql-area" rows="5" placeholder="SELECT * FROM videos LIMIT 10" spellcheck="false"></textarea>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:.65rem">
      <div class="sql-hint">
        <span style="font-size:.68rem;color:var(--text-muted)">Press</span>
        <kbd>Ctrl</kbd><span style="font-size:.68rem;color:var(--text-muted)">+</span><kbd>Enter</kbd>
        <span style="font-size:.68rem;color:var(--text-muted)">to execute</span>
      </div>
      <button class="btn" id="sql-run">Execute Query</button>
    </div>
  </div>
</div>
<div id="sql-result"></div>
<script>
(function(){
  var history=JSON.parse(localStorage.getItem('sql_history')||'[]');
  var histWrap=document.getElementById('sql-history-wrap');
  function renderHistory(){
    if(!history.length){histWrap.style.display='none';return}
    histWrap.style.display='flex';
    histWrap.innerHTML='<span style="font-size:.65rem;color:var(--text-muted);margin-right:.3rem">Recent:</span>'+history.slice(-8).reverse().map(function(q){
      return '<span class="sql-history-item" data-q="'+q.replace(/"/g,'&quot;')+'">'+q.slice(0,40)+(q.length>40?'...':'')+'</span>';
    }).join('');
    histWrap.querySelectorAll('.sql-history-item').forEach(function(el){
      el.onclick=function(){document.getElementById('sql-input').value=this.dataset.q};
    });
  }
  renderHistory();
  function addHistory(q){
    history=history.filter(function(h){return h!==q});
    history.push(q);
    if(history.length>20)history=history.slice(-20);
    localStorage.setItem('sql_history',JSON.stringify(history));
    renderHistory();
  }
  document.getElementById('sql-run').onclick=function(){
    var q=document.getElementById('sql-input').value.trim();
    if(!q)return;
    addHistory(q);
    var out=document.getElementById('sql-result');
    out.innerHTML='<div class="card"><div class="card-body"><p style="color:var(--text-muted);font-size:.78rem">Running query...</p></div></div>';
    fetch('/admin/sql',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:q})})
      .then(function(r){return r.json()}).then(function(d){
        if(d.error){out.innerHTML='<div class="card"><div class="card-body"><p style="color:var(--red);font-size:.78rem">Error: '+d.error+'</p></div></div>';return}
        if(!d.results||!d.results.length){out.innerHTML='<div class="card"><div class="card-body"><p style="color:var(--text-muted);font-size:.78rem">No results'+((d.meta&&d.meta.duration)?' &middot; '+d.meta.duration.toFixed(2)+'ms':'')+'</p></div></div>';return}
        var cols=Object.keys(d.results[0]);
        var html='<p style="color:var(--text-muted);font-size:.68rem;margin-bottom:.65rem">'+d.results.length+' rows'+(d.meta&&d.meta.duration?' &middot; '+d.meta.duration.toFixed(2)+'ms':'')+'</p>';
        html+='<div class="table-wrap"><table><tr>'+cols.map(function(c){return'<th>'+c+'</th>'}).join('')+'</tr>';
        d.results.forEach(function(row){html+='<tr>'+cols.map(function(c){var v=row[c];return'<td class="mono trunc">'+(v===null?'<span style="color:var(--text-muted)">NULL</span>':String(v).slice(0,100))+'</td>'}).join('')+'</tr>'});
        html+='</table></div>';out.innerHTML=html;
      }).catch(function(e){out.innerHTML='<div class="card"><div class="card-body"><p style="color:var(--red);font-size:.78rem">'+e.message+'</p></div></div>'});
  };
  document.getElementById('sql-input').onkeydown=function(e){if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();document.getElementById('sql-run').click()}};
})();
</script>
` : ''}

${!isEdit && tab === 'tools' ? `
<!-- ── Export Cards ── -->
<div class="sh"><h3>Data Exports</h3></div>
<div class="tool-grid">
  <a href="/admin/export/videos" class="tool-card">
    <div class="tool-icon">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
    </div>
    <div class="tool-label">Export Videos</div>
    <div class="tool-desc">Download all videos as CSV</div>
  </a>
  <a href="/admin/export/users" class="tool-card">
    <div class="tool-icon">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
    </div>
    <div class="tool-label">Export Users</div>
    <div class="tool-desc">Download all users as CSV</div>
  </a>
  <a href="/admin/export/analytics" class="tool-card">
    <div class="tool-icon">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
    </div>
    <div class="tool-label">Export Analytics</div>
    <div class="tool-desc">Download analytics as JSON</div>
  </a>
</div>

<!-- ── User Journey ── -->
<div class="sh" style="margin-top:2rem"><h3>User Journey Lookup</h3></div>
<div class="card" style="margin-bottom:1.25rem">
  <div class="card-body">
    <label style="margin-top:0">User ID</label>
    <div style="display:flex;gap:.5rem;margin-top:.35rem">
      <input type="number" id="journey-uid" placeholder="Enter user ID" style="flex:1">
      <button class="btn" id="journey-btn">Lookup</button>
    </div>
  </div>
</div>
<div id="journey-result"></div>

<!-- ── Quick SQL ── -->
<div class="sh" style="margin-top:2rem"><h3>Quick SQL Queries</h3></div>
<div style="display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:1.5rem">
  <button class="ab" onclick="quickSql('SELECT COUNT(*) as total, DATE(created_at) as day FROM analytics GROUP BY day ORDER BY day DESC LIMIT 7')">Daily traffic (7d)</button>
  <button class="ab" onclick="quickSql('SELECT slug, COUNT(*) as watches FROM analytics WHERE type=\\'watch\\' GROUP BY slug ORDER BY watches DESC LIMIT 10')">Top videos</button>
  <button class="ab" onclick="quickSql('SELECT country, COUNT(DISTINCT ip) as unique_ips FROM analytics GROUP BY country ORDER BY unique_ips DESC LIMIT 15')">Unique visitors by country</button>
  <button class="ab" onclick="quickSql('SELECT u.name, u.email, COUNT(c.id) as comments FROM users u LEFT JOIN comments c ON u.id = c.user_id GROUP BY u.id ORDER BY comments DESC')">Most active commenters</button>
  <button class="ab" onclick="quickSql('SELECT v.title, v.views, v.likes, ROUND(v.likes*100.0/NULLIF(v.views,0),1) as like_rate FROM videos v ORDER BY like_rate DESC')">Like rate per video</button>
  <button class="ab" onclick="quickSql('SELECT query, SUM(times) as total FROM (SELECT query, COUNT(*) as times FROM search_logs GROUP BY query) GROUP BY query ORDER BY total DESC LIMIT 20')">All search queries</button>
  <button class="ab" onclick="quickSql('SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT 20')">Admin audit log</button>
</div>
<div id="quick-result"></div>

<script>
// User journey
document.getElementById('journey-btn').onclick=function(){
  var uid=document.getElementById('journey-uid').value;if(!uid)return;
  var out=document.getElementById('journey-result');
  out.innerHTML='<div class="card"><div class="card-body"><p style="color:var(--text-muted);font-size:.78rem">Loading...</p></div></div>';
  fetch('/admin/user-journey/'+uid).then(function(r){return r.json()}).then(function(d){
    if(!d.user){out.innerHTML='<div class="card"><div class="card-body"><p style="color:var(--red);font-size:.78rem">User not found</p></div></div>';return}
    var html='<div class="card"><div class="card-body">';
    html+='<div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.25rem">';
    html+='<div class="user-ava" style="width:48px;height:48px;font-size:1.1rem">'+d.user.name[0].toUpperCase()+'</div>';
    html+='<div><div style="font-size:.95rem;font-weight:600;color:var(--text)">'+d.user.name+'</div>';
    html+='<div class="mono" style="font-size:.72rem">'+d.user.email+'</div>';
    html+='<div style="font-size:.68rem;color:var(--text-muted);margin-top:.2rem">Role: '+d.user.role+' &middot; Joined: '+d.user.created_at+'</div></div></div>';
    if(d.pages.length){
      html+='<div class="sh" style="margin-top:1.25rem"><h3>Page Views</h3><span class="sh-badge">'+d.pages.length+'</span></div>';
      html+='<div class="timeline">';
      d.pages.forEach(function(p){html+='<div class="tl-item"><div class="tl-time">'+p.created_at+'</div><div class="tl-text">'+p.path+'</div></div>'});
      html+='</div>';
    }
    if(d.comments.length){
      html+='<div class="sh" style="margin-top:1.25rem"><h3>Comments</h3><span class="sh-badge">'+d.comments.length+'</span></div>';
      html+='<div class="timeline">';
      d.comments.forEach(function(c){html+='<div class="tl-item"><div class="tl-time">'+c.created_at+'</div><div class="tl-text"><strong>'+c.video_title+'</strong>: '+c.content+'</div></div>'});
      html+='</div>';
    }
    if(d.searches.length){
      html+='<div class="sh" style="margin-top:1.25rem"><h3>Searches</h3><span class="sh-badge">'+d.searches.length+'</span></div>';
      html+='<div class="timeline">';
      d.searches.forEach(function(s){html+='<div class="tl-item"><div class="tl-time">'+s.created_at+'</div><div class="tl-text">Searched "<strong>'+s.query+'</strong>" &mdash; '+s.results+' results</div></div>'});
      html+='</div>';
    }
    html+='</div></div>';out.innerHTML=html;
  }).catch(function(e){out.innerHTML='<div class="card"><div class="card-body"><p style="color:var(--red)">'+e.message+'</p></div></div>'});
};

// Quick SQL
function quickSql(q){
  var out=document.getElementById('quick-result');
  out.innerHTML='<div class="card"><div class="card-body"><p style="color:var(--text-muted);font-size:.78rem">Running...</p></div></div>';
  fetch('/admin/sql',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:q})})
    .then(function(r){return r.json()}).then(function(d){
      if(d.error){out.innerHTML='<div class="card"><div class="card-body"><p style="color:var(--red);font-size:.78rem">'+d.error+'</p></div></div>';return}
      if(!d.results||!d.results.length){out.innerHTML='<div class="card"><div class="card-body"><p style="color:var(--text-muted);font-size:.78rem">No results</p></div></div>';return}
      var cols=Object.keys(d.results[0]);
      var html='<div class="table-wrap"><table><tr>'+cols.map(function(c){return'<th>'+c+'</th>'}).join('')+'</tr>';
      d.results.forEach(function(row){html+='<tr>'+cols.map(function(c){var v=row[c];return'<td class="mono trunc">'+(v===null?'<span style="color:var(--text-muted)">NULL</span>':String(v).slice(0,80))+'</td>'}).join('')+'</tr>'});
      out.innerHTML=html+'</table></div>';
    }).catch(function(e){out.innerHTML='<div class="card"><div class="card-body"><p style="color:var(--red)">'+e.message+'</p></div></div>'});
}
</script>
` : ''}

${!isEdit && tab === 'ai' ? `
<div class="ai-container">
  <div class="ai-tools-bar">
    <span style="font-size:.68rem;color:var(--text-muted)">18 tools:</span>
    <span class="ai-tool-tag">query_database</span>
    <span class="ai-tool-tag">get_video_stats</span>
    <span class="ai-tool-tag">get_platform_stats</span>
    <span class="ai-tool-tag">get_engagement_report</span>
    <span class="ai-tool-tag">get_watch_analytics</span>
    <span class="ai-tool-tag">get_traffic_trends</span>
    <span class="ai-tool-tag">get_top_searches</span>
    <span class="ai-tool-tag">get_zero_result_searches</span>
    <span class="ai-tool-tag">get_content_gaps</span>
    <span class="ai-tool-tag">get_visitor_countries</span>
    <span class="ai-tool-tag">get_visitor_devices</span>
    <span class="ai-tool-tag">get_user_activity</span>
    <span class="ai-tool-tag">get_scholar_stats</span>
    <span class="ai-tool-tag">get_category_stats</span>
    <span class="ai-tool-tag">moderate_comment</span>
    <span class="ai-tool-tag">update_video</span>
    <span class="ai-tool-tag">purge_cache</span>
    <span class="ai-tool-tag">list_r2_files</span>
  </div>
  <div class="ai-messages" id="ai-chat">
    <div class="ai-msg ai-bot">I'm your DeenSubs admin assistant with <strong>18 tools</strong> and <strong>direct database access</strong>.<br><br>
    <strong>Data &amp; Analytics</strong><br>
    &bull; "Show platform stats" &bull; "What are the engagement rates?" &bull; "Show watch analytics"<br>
    &bull; "Traffic trends for the last 30 days" &bull; "Which videos have zero views?"<br><br>
    <strong>Content Strategy</strong><br>
    &bull; "What content gaps do we have?" &bull; "What are people searching for but not finding?"<br>
    &bull; "Scholar performance breakdown" &bull; "Category stats"<br><br>
    <strong>Visitor Intelligence</strong><br>
    &bull; "Where are visitors from?" &bull; "Device breakdown" &bull; "Show activity for user #3"<br><br>
    <strong>Actions</strong><br>
    &bull; "Update description of [slug]" &bull; "Delete comment #42" &bull; "Purge cache" &bull; "List R2 files"</div>
  </div>
  <div class="ai-input-wrap">
    <input type="text" id="ai-input" placeholder="e.g. Show me the most watched videos this week..." autocomplete="off">
    <button id="ai-send">Send</button>
  </div>
</div>
<script>
var chat=document.getElementById('ai-chat'),inp=document.getElementById('ai-input'),btn=document.getElementById('ai-send');
var context='Platform stats: ${stats?.video_count||0} videos, ${stats?.user_count||0} users, ${stats?.comment_count||0} comments, ${stats?.total_views||0} views. Top countries: ${countries.slice(0,5).map(c=>c.country+'('+c.hits+')').join(', ')}. Top searches: ${searchLogs.slice(0,5).map(s=>s.query+'('+s.times+'x)').join(', ')}';
var history=[];
function send(){
  var q=inp.value.trim();if(!q)return;
  chat.innerHTML+='<div class="ai-msg ai-user">'+q.replace(/</g,'&lt;')+'</div>';
  chat.innerHTML+='<div class="ai-msg ai-bot ai-typing"><div class="ai-dots"><span></span><span></span><span></span></div></div>';
  chat.scrollTop=chat.scrollHeight;inp.value='';btn.disabled=true;
  history.push({role:'user',content:q});
  fetch('/admin/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:q,context:context,history:history.slice(-10)})})
    .then(function(r){return r.json()}).then(function(d){
      var typing=chat.querySelector('.ai-typing');if(typing)typing.remove();
      var resp=(d.response||d.error||'No response').replace(/</g,'&lt;');
      resp=resp.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g,'<pre>$1</pre>');
      resp=resp.replace(/\`([^\`]+)\`/g,'<code>$1</code>');
      resp=resp.replace(/\\n/g,'<br>');
      var toolsHtml=d.tools_used?'<div class="ai-tools-used">Used: '+d.tools_used.map(function(t){return'<span class="ai-tool-tag ai-tool-used">'+t+'</span>'}).join('')+'</div>':'';
      chat.innerHTML+='<div class="ai-msg ai-bot">'+toolsHtml+resp+'</div>';
      history.push({role:'assistant',content:d.response||''});
      chat.scrollTop=chat.scrollHeight;
    }).catch(function(ex){var typing=chat.querySelector('.ai-typing');if(typing)typing.remove();chat.innerHTML+='<div class="ai-msg ai-bot" style="color:#c44">Error: '+ex.message+'</div>'})
    .finally(function(){btn.disabled=false;inp.focus()});
}
btn.onclick=send;inp.onkeydown=function(e){if(e.key==='Enter')send()};
</script>
<style>
.ai-tools-bar{display:flex;gap:.3rem;align-items:center;padding:.5rem 1rem;border-bottom:1px solid var(--border);flex-wrap:wrap}
.ai-tool-tag{font-size:.6rem;padding:.1rem .4rem;background:rgba(196,164,76,.06);border:1px solid rgba(196,164,76,.12);border-radius:4px;color:#c4a44c;font-family:monospace}
.ai-tool-used{background:rgba(76,164,76,.08)!important;border-color:rgba(76,164,76,.2)!important;color:#4ca44c!important}
.ai-tools-used{margin-bottom:.5rem;display:flex;gap:.25rem;flex-wrap:wrap}
.ai-dots{display:flex;gap:4px;padding:4px 0}
.ai-dots span{width:6px;height:6px;border-radius:50%;background:#555;animation:dotBounce 1.4s infinite ease-in-out}
.ai-dots span:nth-child(2){animation-delay:.2s}
.ai-dots span:nth-child(3){animation-delay:.4s}
@keyframes dotBounce{0%,80%,100%{transform:scale(0);opacity:.3}40%{transform:scale(1);opacity:1}}
</style>
` : ''}

${!isEdit && tab === 'add' ? `
<div class="form-card">
  <form method="post" action="/admin/video?${q.slice(1)}" id="add-form">
    <div class="form-section">
      <div class="form-section-title"><span class="num">1</span> Title & Description</div>
      <label>Title *</label>
      <input name="title" id="add-title" required placeholder="e.g. Ruling on Praying Asr at Home">
      <label>Slug <span style="color:var(--text-muted);font-weight:400">(auto-generated from title)</span></label>
      <input name="slug" id="add-slug" required pattern="[a-z0-9-]+" placeholder="auto-generated">
      <label>Description <button type="button" class="ai-gen-btn" id="ai-desc-btn">✨ Generate with AI</button></label>
      <textarea name="description" id="add-desc" rows="3" placeholder="AI can generate this for you"></textarea>
      <label>Arabic Title</label>
      <input name="title_ar" dir="rtl" placeholder="Optional">
    </div>
    <div class="form-section">
      <div class="form-section-title"><span class="num">2</span> Categorization</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.75rem">
        <div><label>Category</label><select name="category_id">${categories.map(c => `<option value="${c.id}">${e(c.name)}</option>`).join('')}</select></div>
        <div><label>Scholar</label><select name="scholar_id"><option value="">— None —</option>${scholars.map(s => `<option value="${s.id}">${e(s.name)}</option>`).join('')}</select></div>
        <div><label>Source Label</label><input name="source" placeholder="e.g. Sheikh Salih al-Fawzan"></div>
      </div>
      <label>Duration (seconds)</label>
      <input name="duration" type="number" placeholder="360">
    </div>
    <div class="form-section">
      <div class="form-section-title"><span class="num">3</span> R2 Media Keys</div>
      <p style="font-size:.72rem;color:var(--text-muted);margin-bottom:.5rem">Upload files to R2 first via CLI or S3 API, then enter the keys below.</p>
      <label>Video Key * <button type="button" class="ai-gen-btn" onclick="browseR2('video_key','videos/')">Browse R2</button></label>
      <input name="video_key" id="add-video-key" required placeholder="videos/file.mp4">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
        <div><label>English Subtitle <button type="button" class="ai-gen-btn" onclick="browseR2('srt_key','subs/')">Browse</button></label><input name="srt_key" id="add-srt-key" placeholder="subs/file.srt"></div>
        <div><label>Arabic Subtitle <button type="button" class="ai-gen-btn" onclick="browseR2('srt_ar_key','subs/')">Browse</button></label><input name="srt_ar_key" id="add-srt-ar-key" placeholder="subs/file-ar.srt"></div>
      </div>
      <label>Thumbnail Key <button type="button" class="ai-gen-btn" onclick="browseR2('thumb_key','thumbs/')">Browse</button></label>
      <input name="thumb_key" id="add-thumb-key" placeholder="thumbs/file.jpg">
    </div>
    <div class="form-section" style="display:flex;justify-content:flex-end;gap:.75rem;align-items:center">
      <a href="/admin?tab=videos${q}" style="font-size:.82rem;color:var(--text-muted)">Cancel</a>
      <button class="btn" type="submit">Add Video</button>
    </div>
  </form>
</div>
<script>
// Auto-generate slug from title
document.getElementById('add-title').addEventListener('input',function(){
  var slug=this.value.toLowerCase().replace(/[^a-z0-9\\s-]/g,'').replace(/\\s+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');
  document.getElementById('add-slug').value=slug;
});

// R2 file browser
function browseR2(targetField, prefix){
  var modal=document.createElement('div');
  modal.style.cssText='position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.7);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center';
  var inner=document.createElement('div');
  inner.style.cssText='background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:1.25rem;max-width:540px;width:90%;max-height:70vh;overflow-y:auto';
  inner.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem"><h3 style="font-size:.85rem">R2: '+prefix+'</h3><button onclick="this.closest(\'div[style]\').parentElement.remove()" style="background:none;border:none;color:var(--text-dim);font-size:1.2rem;cursor:pointer">&times;</button></div><div style="color:var(--text-muted);font-size:.75rem">Loading...</div>';
  modal.appendChild(inner);document.body.appendChild(modal);
  modal.addEventListener('click',function(e){if(e.target===modal)modal.remove()});
  fetch('/admin/r2-list?prefix='+encodeURIComponent(prefix)).then(function(r){return r.json()}).then(function(d){
    if(!d.objects||!d.objects.length){inner.innerHTML='<p style="color:var(--text-muted);font-size:.78rem">No files found in '+prefix+'</p>';return}
    var html='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.75rem"><h3 style="font-size:.85rem">R2: '+prefix+'</h3><button onclick="this.closest(\'div[style]\').parentElement.remove()" style="background:none;border:none;color:var(--text-dim);font-size:1.2rem;cursor:pointer">&times;</button></div>';
    d.objects.forEach(function(o){
      var sizeStr=o.size_kb>1024?(o.size_kb/1024).toFixed(1)+' MB':o.size_kb+' KB';
      html+='<div class="r2-file" data-key="'+o.key+'" style="display:flex;justify-content:space-between;align-items:center;padding:.45rem .65rem;border-bottom:1px solid rgba(255,255,255,.03);cursor:pointer;border-radius:6px;transition:all .15s">';
      html+='<span style="font-size:.75rem;font-family:var(--mono);color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">'+o.key+'</span>';
      html+='<span style="font-size:.65rem;color:var(--text-muted);margin-left:.5rem;white-space:nowrap">'+sizeStr+'</span></div>';
    });
    inner.innerHTML=html;
    inner.querySelectorAll('.r2-file').forEach(function(el){
      el.onmouseenter=function(){this.style.background='rgba(196,164,76,.08)'};
      el.onmouseleave=function(){this.style.background='none'};
      el.onclick=function(){document.querySelector('[name="'+targetField+'"]').value=this.dataset.key;modal.remove()};
    });
  }).catch(function(){inner.innerHTML='<p style="color:var(--red);font-size:.78rem">Failed to list R2 files</p>'});
}

// AI description generation
document.getElementById('ai-desc-btn').addEventListener('click',function(){
  var title=document.getElementById('add-title').value.trim();
  if(!title){alert('Enter a title first');return}
  var btn=this;btn.textContent='Generating...';btn.disabled=true;
  fetch('/admin/ai',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({prompt:'Generate a concise, SEO-optimized description (2-3 sentences) for an Islamic video titled: "'+title+'". Focus on what viewers will learn. Do not use markdown.',context:'DeenSubs platform - Arabic Islamic content with English subtitles'})
  }).then(function(r){return r.json()}).then(function(d){
    document.getElementById('add-desc').value=d.response||'';
  }).catch(function(){}).finally(function(){btn.textContent='✨ Generate with AI';btn.disabled=false});
});
<\/script>
<style>.ai-gen-btn{background:none;border:1px solid rgba(196,164,76,.2);color:#c4a44c;font-size:.65rem;padding:.15rem .5rem;border-radius:4px;cursor:pointer;margin-left:.5rem;transition:all .2s;font-family:inherit}.ai-gen-btn:hover{background:rgba(196,164,76,.08);border-color:#c4a44c}</style>
` : ''}

</div><!-- .content -->
</div><!-- .main -->
</div><!-- .layout -->
</body></html>`;
}
