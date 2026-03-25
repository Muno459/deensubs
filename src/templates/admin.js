import { e, ago, fv } from '../lib/helpers.js';

export function renderAdmin({ videos, categories, key, editing, tab, users, comments, stats, countries, topPages, topVideos, dailyHits, searchLogs, visitors, agents, referers }) {
  const v = editing || {};
  const isEdit = !!editing;
  const q = key ? '&key=' + e(key) : '';
  const formAction = isEdit ? `/admin/edit/${v.id}?${q.slice(1)}` : `/admin/video?${q.slice(1)}`;
  countries = countries || []; topPages = topPages || []; topVideos = topVideos || [];
  dailyHits = dailyHits || []; searchLogs = searchLogs || []; visitors = visitors || [];
  agents = agents || []; referers = referers || [];

  const tabs = [
    ['dashboard', 'Dashboard'],
    ['analytics', 'Analytics'],
    ['videos', `Videos (${videos.length})`],
    ['comments', `Comments (${(comments||[]).length})`],
    ['users', `Users (${(users||[]).length})`],
    ['searches', 'Searches'],
    ['visitors', 'Visitors'],
    ['sql', 'SQL Console'],
    ['tools', 'Tools'],
    ['ai', 'AI Assistant'],
    ['add', '+ Add'],
  ];

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin — DeenSubs</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Outfit',system-ui,sans-serif;background:#06060c;color:#e0e0e0;min-height:100vh}
a{color:#c4a44c;text-decoration:none}
.at{background:#0a0a14;border-bottom:1px solid #16162a;padding:.85rem 2rem;display:flex;align-items:center;justify-content:space-between}
.at h1{font-size:1.1rem;font-weight:600;color:#c4a44c;display:flex;align-items:center;gap:.5rem}
.at h1 span{font-size:.6rem;color:#555;font-weight:400;background:#12121e;padding:.15rem .5rem;border-radius:4px}
.at a{font-size:.72rem;color:#666}
.tabs{display:flex;gap:.2rem;padding:.5rem 2rem;background:#08080f;border-bottom:1px solid #16162a;overflow-x:auto;scrollbar-width:none}
.tabs::-webkit-scrollbar{display:none}
.tab{padding:.4rem .85rem;border-radius:8px;font-size:.72rem;color:#666;transition:all .15s;white-space:nowrap}
.tab:hover{background:#12121e;color:#aaa}
.tab.on{background:rgba(196,164,76,.08);color:#c4a44c}
.body{max-width:1200px;margin:0 auto;padding:1.5rem 2rem}
h2{font-size:.95rem;font-weight:600;margin-bottom:.85rem;color:#ccc}
h3{font-size:.82rem;font-weight:600;margin:1.25rem 0 .6rem;color:#999}

/* Dashboard cards */
.dg{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.6rem;margin-bottom:1.5rem}
.dc{background:#0c0c16;border:1px solid #16162a;border-radius:10px;padding:1rem;text-align:center}
.dc-v{font-size:1.8rem;font-weight:300;color:#c4a44c;line-height:1}
.dc-l{font-size:.6rem;color:#555;text-transform:uppercase;letter-spacing:.08em;margin-top:.25rem}

/* Tables */
table{width:100%;border-collapse:collapse;font-size:.75rem;margin-bottom:1.5rem}
th{text-align:left;padding:.45rem .6rem;color:#444;font-weight:500;border-bottom:1px solid #16162a;font-size:.65rem;text-transform:uppercase;letter-spacing:.05em}
td{padding:.45rem .6rem;border-bottom:1px solid #0e0e1a}
tr:hover{background:#0a0a14}
.uav{width:20px;height:20px;border-radius:50%;vertical-align:middle;margin-right:.35rem}
.trunc{max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mono{font-family:monospace;font-size:.68rem;color:#888}

/* Chart */
.chart{display:flex;align-items:flex-end;gap:3px;height:100px;margin-bottom:1.5rem;padding:.5rem;background:#0c0c16;border:1px solid #16162a;border-radius:10px}
.chart-bar{flex:1;background:rgba(196,164,76,.3);border-radius:2px 2px 0 0;min-height:2px;position:relative;transition:background .2s}
.chart-bar:hover{background:rgba(196,164,76,.6)}
.chart-bar:hover::after{content:attr(data-label);position:absolute;bottom:100%;left:50%;transform:translateX(-50%);background:#1a1a2e;color:#ddd;font-size:.6rem;padding:.2rem .4rem;border-radius:4px;white-space:nowrap;margin-bottom:4px}

/* Actions */
.acts{display:flex;gap:.2rem}
.ab{padding:.15rem .45rem;border-radius:4px;font-size:.65rem;cursor:pointer;background:none;border:1px solid #2a2a3a;color:#888;transition:all .12s}
.ab:hover{border-color:#c4a44c;color:#c4a44c}
.db{color:#c44;border-color:#3a1a1a}.db:hover{background:#c44;color:#fff;border-color:#c44}

/* Forms */
.fc{background:#0c0c16;border:1px solid #16162a;border-radius:10px;padding:1.25rem;margin-bottom:1.5rem}
label{display:block;font-size:.7rem;color:#555;margin-bottom:.15rem;margin-top:.55rem}
input,select,textarea{width:100%;background:#06060c;border:1px solid #1a1a2e;border-radius:6px;padding:.4rem .6rem;color:#e0e0e0;font:inherit;font-size:.78rem}
input:focus,select:focus,textarea:focus{outline:none;border-color:#c4a44c}
.btn{margin-top:.65rem;padding:.45rem 1.1rem;background:#c4a44c;color:#06060c;border:none;border-radius:6px;font:inherit;font-size:.78rem;font-weight:600;cursor:pointer}
.btn:hover{filter:brightness(1.1)}
select.rs{width:auto;padding:.15rem .35rem;font-size:.65rem;border-radius:4px}
.back{display:inline-block;margin-bottom:.85rem;font-size:.78rem}

/* Country flags */
.flag{font-size:.9rem;margin-right:.3rem}

/* AI */
.ai-wrap{max-width:700px}
.ai-chat{background:#0c0c16;border:1px solid #16162a;border-radius:10px;padding:1rem;margin-bottom:.75rem;min-height:200px;max-height:500px;overflow-y:auto;font-size:.8rem;line-height:1.6}
.ai-msg{margin-bottom:.75rem;padding:.6rem .85rem;border-radius:8px}
.ai-user{background:#16162a;margin-left:2rem}
.ai-bot{background:#0a0a14;border:1px solid #1a1a2e;margin-right:2rem}
.ai-bot pre{font-size:.72rem;overflow-x:auto;background:#08080f;padding:.5rem;border-radius:4px;margin:.3rem 0}
.ai-form{display:flex;gap:.4rem}
.ai-form input{flex:1}
.ai-form button{flex-shrink:0}
.ai-typing{color:#666;font-size:.72rem;font-style:italic}
</style></head><body>
<div class="at">
  <h1>DeenSubs Admin <span>v2</span></h1>
  <a href="/">← Back to site</a>
</div>
${!isEdit ? `<div class="tabs">${tabs.map(([id, label]) => `<a href="/admin?tab=${id}${q}" class="tab${tab === id ? ' on' : ''}">${label}</a>`).join('')}</div>` : ''}
<div class="body">

${isEdit ? `
<a href="/admin?tab=videos${q}" class="back">&larr; Back</a>
<h2>Edit Video</h2>
<div class="fc"><form method="post" action="${formAction}">
<label>Title *</label><input name="title" required value="${e(v.title || '')}">
<label>Arabic Title</label><input name="title_ar" dir="rtl" value="${e(v.title_ar || '')}">
<label>Description</label><textarea name="description" rows="3">${e(v.description || '')}</textarea>
<label>Category</label><select name="category_id">${categories.map(c => `<option value="${c.id}"${v.category_id === c.id ? ' selected' : ''}>${e(c.name)}</option>`).join('')}</select>
<label>Source</label><input name="source" value="${e(v.source || '')}">
<label>Duration (seconds)</label><input name="duration" type="number" value="${v.duration || ''}">
<label>R2 Video Key *</label><input name="video_key" required value="${e(v.video_key || '')}">
<label>R2 Subtitle Key</label><input name="srt_key" value="${e(v.srt_key || '')}">
<label>R2 Thumbnail Key</label><input name="thumb_key" value="${e(v.thumb_key || '')}">
<button class="btn" type="submit">Save Changes</button></form></div>
` : ''}

${!isEdit && tab === 'dashboard' ? `
<h2>Dashboard</h2>
<div class="dg">
  <div class="dc"><div class="dc-v">${stats?.video_count || 0}</div><div class="dc-l">Videos</div></div>
  <div class="dc"><div class="dc-v">${stats?.user_count || 0}</div><div class="dc-l">Users</div></div>
  <div class="dc"><div class="dc-v">${stats?.comment_count || 0}</div><div class="dc-l">Comments</div></div>
  <div class="dc"><div class="dc-v">${stats?.total_views || 0}</div><div class="dc-l">Views</div></div>
  <div class="dc"><div class="dc-v">${stats?.total_likes || 0}</div><div class="dc-l">Likes</div></div>
  <div class="dc"><div class="dc-v">${countries.length}</div><div class="dc-l">Countries</div></div>
</div>

<h3>Traffic (Last 14 Days)</h3>
${dailyHits.length ? `<div class="chart">${(() => {
  const max = Math.max(...dailyHits.map(d => d.hits), 1);
  return dailyHits.reverse().map(d => `<div class="chart-bar" style="height:${Math.max((d.hits / max) * 100, 2)}%" data-label="${d.day}: ${d.hits} hits"></div>`).join('');
})()}</div>` : '<p style="color:#555;font-size:.78rem">No data yet</p>'}

<h3>Top Countries</h3>
<table><tr><th>Country</th><th>Hits</th></tr>
${countries.slice(0, 10).map(c => `<tr><td>${e(c.country)}</td><td>${c.hits}</td></tr>`).join('')}
</table>

<h3>Recent Comments</h3>
<table><tr><th>User</th><th>Video</th><th>Comment</th><th>When</th></tr>
${(comments || []).slice(0, 8).map(c => `<tr><td>${c.user_avatar ? `<img src="${e(c.user_avatar)}" class="uav">` : ''}${e(c.user_name || c.author)}</td><td><a href="/watch/${e(c.video_slug || '')}">${e((c.video_title || '?').slice(0, 30))}</a></td><td class="trunc">${e(c.content)}</td><td>${ago(c.created_at)}</td></tr>`).join('')}
</table>
` : ''}

${!isEdit && tab === 'analytics' ? `
<h2>Analytics</h2>
<h3>Top Pages</h3>
<table><tr><th>Path</th><th>Hits</th></tr>
${topPages.map(p => `<tr><td class="mono">${e(p.path)}</td><td>${p.hits}</td></tr>`).join('')}
</table>

<h3>Most Watched Videos</h3>
<table><tr><th>Video</th><th>Page Loads</th></tr>
${topVideos.map(v => `<tr><td><a href="/watch/${e(v.slug)}">${e(v.slug)}</a></td><td>${v.hits}</td></tr>`).join('')}
</table>

<h3>Top Referrers</h3>
<table><tr><th>Referrer</th><th>Hits</th></tr>
${referers.map(r => `<tr><td class="trunc mono">${e(r.referer)}</td><td>${r.hits}</td></tr>`).join('')}
</table>

<h3>User Agents</h3>
<table><tr><th>Agent</th><th>Hits</th></tr>
${agents.slice(0, 15).map(a => `<tr><td class="trunc mono" style="max-width:400px">${e(a.user_agent)}</td><td>${a.hits}</td></tr>`).join('')}
</table>
` : ''}

${!isEdit && tab === 'videos' ? `
<h2>All Videos</h2>
<table><tr><th>Title</th><th>Category</th><th>Views</th><th>Likes</th><th>Subs</th><th>Created</th><th></th></tr>
${videos.map(vi => `<tr><td><a href="/watch/${e(vi.slug)}">${e(vi.title)}</a></td><td>${e(vi.category_name || '')}</td><td>${vi.views}</td><td>${vi.likes}</td><td>${vi.srt_key ? '✓' : '✗'}</td><td>${ago(vi.created_at)}</td>
<td><div class="acts"><a href="/admin/edit/${vi.id}?tab=videos${q}" class="ab">Edit</a><form method="post" action="/admin/delete/${vi.id}?tab=videos${q}" onsubmit="return confirm('Delete?')" style="margin:0"><button class="ab db">Del</button></form></div></td></tr>`).join('')}
</table>
` : ''}

${!isEdit && tab === 'comments' ? `
<h2>Comment Moderation</h2>
<table><tr><th>User</th><th>Video</th><th>Comment</th><th>When</th><th></th></tr>
${(comments || []).map(c => `<tr><td>${c.user_avatar ? `<img src="${e(c.user_avatar)}" class="uav">` : ''}${e(c.user_name || c.author)}</td><td><a href="/watch/${e(c.video_slug || '')}">${e((c.video_title || '?').slice(0, 25))}</a></td><td class="trunc">${e(c.content)}</td><td>${ago(c.created_at)}</td>
<td><form method="post" action="/admin/delete-comment/${c.id}?tab=comments${q}" onsubmit="return confirm('Delete?')" style="margin:0"><button class="ab db">Del</button></form></td></tr>`).join('')}
</table>
` : ''}

${!isEdit && tab === 'users' ? `
<h2>User Management</h2>
<table><tr><th>User</th><th>Email</th><th>Role</th><th>Joined</th><th></th></tr>
${(users || []).map(u => `<tr><td>${u.avatar ? `<img src="${e(u.avatar)}" class="uav">` : ''}${e(u.name)}</td><td class="mono">${e(u.email)}</td><td>${e(u.role || 'user')}</td><td>${ago(u.created_at)}</td>
<td><form method="post" action="/admin/user-role/${u.id}?tab=users${q}" style="margin:0;display:flex;gap:.2rem"><select name="role" class="rs"><option value="user"${u.role !== 'admin' ? ' selected' : ''}>user</option><option value="admin"${u.role === 'admin' ? ' selected' : ''}>admin</option></select><button class="ab">Set</button></form></td></tr>`).join('')}
</table>
` : ''}

${!isEdit && tab === 'searches' ? `
<h2>Search Intelligence</h2>
<table><tr><th>Query</th><th>Results</th><th>Times Searched</th></tr>
${searchLogs.map(s => `<tr><td>${e(s.query)}</td><td>${s.results}</td><td>${s.times}</td></tr>`).join('')}
</table>
` : ''}

${!isEdit && tab === 'visitors' ? `
<h2>Visitor Intelligence</h2>
<table><tr><th>IP</th><th>Country</th><th>Hits</th><th>Last Seen</th></tr>
${visitors.map(v => `<tr><td class="mono">${e(v.ip)}</td><td>${e(v.country)}</td><td>${v.hits}</td><td>${ago(v.last_seen)}</td></tr>`).join('')}
</table>
` : ''}

${!isEdit && tab === 'sql' ? `
<h2>SQL Console</h2>
<p style="color:#555;font-size:.72rem;margin-bottom:.75rem">Read-only. SELECT queries only. Direct access to the D1 database.</p>
<div class="fc">
  <textarea id="sql-input" rows="4" placeholder="SELECT * FROM videos LIMIT 10" style="font-family:monospace;font-size:.75rem"></textarea>
  <button class="btn" id="sql-run" style="margin-top:.5rem">Execute</button>
</div>
<div id="sql-result" style="overflow-x:auto"></div>
<script>
document.getElementById('sql-run').onclick=function(){
  var q=document.getElementById('sql-input').value.trim();
  if(!q)return;
  var out=document.getElementById('sql-result');
  out.innerHTML='<p style="color:#666;font-size:.75rem">Running...</p>';
  fetch('/admin/sql',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:q})})
    .then(function(r){return r.json()}).then(function(d){
      if(d.error){out.innerHTML='<p style="color:#c44;font-size:.75rem">Error: '+d.error+'</p>';return}
      if(!d.results||!d.results.length){out.innerHTML='<p style="color:#666;font-size:.75rem">No results ('+((d.meta&&d.meta.duration)?d.meta.duration.toFixed(2)+'ms':'')+')</p>';return}
      var cols=Object.keys(d.results[0]);
      var html='<p style="color:#555;font-size:.65rem;margin-bottom:.4rem">'+d.results.length+' rows'+(d.meta&&d.meta.duration?' · '+d.meta.duration.toFixed(2)+'ms':'')+'</p>';
      html+='<table><tr>'+cols.map(function(c){return'<th>'+c+'</th>'}).join('')+'</tr>';
      d.results.forEach(function(row){html+='<tr>'+cols.map(function(c){var v=row[c];return'<td class="mono trunc">'+(v===null?'<span style="color:#555">NULL</span>':String(v).slice(0,100))+'</td>'}).join('')+'</tr>'});
      html+='</table>';out.innerHTML=html;
    }).catch(function(e){out.innerHTML='<p style="color:#c44;font-size:.75rem">'+e.message+'</p>'});
};
document.getElementById('sql-input').onkeydown=function(e){if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();document.getElementById('sql-run').click()}};
</script>
` : ''}

${!isEdit && tab === 'tools' ? `
<h2>Admin Tools</h2>
<div class="dg" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
  <a href="/admin/export/videos" class="dc" style="cursor:pointer">
    <div class="dc-v" style="font-size:1.2rem">📄</div>
    <div class="dc-l">Export Videos CSV</div>
  </a>
  <a href="/admin/export/users" class="dc" style="cursor:pointer">
    <div class="dc-v" style="font-size:1.2rem">👥</div>
    <div class="dc-l">Export Users CSV</div>
  </a>
  <a href="/admin/export/analytics" class="dc" style="cursor:pointer">
    <div class="dc-v" style="font-size:1.2rem">📊</div>
    <div class="dc-l">Export Analytics JSON</div>
  </a>
</div>

<h3>User Journey Lookup</h3>
<div class="fc">
  <label>User ID</label>
  <div style="display:flex;gap:.4rem">
    <input type="number" id="journey-uid" placeholder="Enter user ID" style="flex:1">
    <button class="btn" id="journey-btn">Lookup</button>
  </div>
</div>
<div id="journey-result"></div>

<h3>Quick SQL Queries</h3>
<div style="display:flex;flex-wrap:wrap;gap:.3rem;margin-bottom:1.5rem">
  <button class="ab" onclick="quickSql('SELECT COUNT(*) as total, DATE(created_at) as day FROM analytics GROUP BY day ORDER BY day DESC LIMIT 7')">Daily traffic (7d)</button>
  <button class="ab" onclick="quickSql('SELECT slug, COUNT(*) as watches FROM analytics WHERE type=\\'watch\\' GROUP BY slug ORDER BY watches DESC LIMIT 10')">Top videos</button>
  <button class="ab" onclick="quickSql('SELECT country, COUNT(DISTINCT ip) as unique_ips FROM analytics GROUP BY country ORDER BY unique_ips DESC LIMIT 15')">Unique visitors by country</button>
  <button class="ab" onclick="quickSql('SELECT u.name, u.email, COUNT(c.id) as comments FROM users u LEFT JOIN comments c ON u.id = c.user_id GROUP BY u.id ORDER BY comments DESC')">Most active commenters</button>
  <button class="ab" onclick="quickSql('SELECT v.title, v.views, v.likes, ROUND(v.likes*100.0/NULLIF(v.views,0),1) as like_rate FROM videos v ORDER BY like_rate DESC')">Like rate per video</button>
  <button class="ab" onclick="quickSql('SELECT query, SUM(times) as total FROM (SELECT query, COUNT(*) as times FROM search_logs GROUP BY query) GROUP BY query ORDER BY total DESC LIMIT 20')">All search queries</button>
  <button class="ab" onclick="quickSql('SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT 20')">Admin audit log</button>
</div>
<div id="quick-result" style="overflow-x:auto"></div>

<script>
// User journey
document.getElementById('journey-btn').onclick=function(){
  var uid=document.getElementById('journey-uid').value;if(!uid)return;
  var out=document.getElementById('journey-result');
  out.innerHTML='<p style="color:#666;font-size:.75rem">Loading...</p>';
  fetch('/admin/user-journey/'+uid).then(function(r){return r.json()}).then(function(d){
    if(!d.user){out.innerHTML='<p style="color:#c44;font-size:.75rem">User not found</p>';return}
    var html='<div class="fc"><h3 style="margin-top:0">'+d.user.name+' ('+d.user.email+')</h3>';
    html+='<p style="color:#555;font-size:.72rem">Role: '+d.user.role+' · Joined: '+d.user.created_at+'</p>';
    if(d.pages.length){html+='<h3>Page Views ('+d.pages.length+')</h3><table><tr><th>Path</th><th>When</th></tr>';
      d.pages.forEach(function(p){html+='<tr><td class="mono">'+p.path+'</td><td>'+p.created_at+'</td></tr>'});html+='</table>';}
    if(d.comments.length){html+='<h3>Comments ('+d.comments.length+')</h3><table><tr><th>Video</th><th>Comment</th><th>When</th></tr>';
      d.comments.forEach(function(c){html+='<tr><td>'+c.video_title+'</td><td class="trunc">'+c.content+'</td><td>'+c.created_at+'</td></tr>'});html+='</table>';}
    if(d.searches.length){html+='<h3>Searches ('+d.searches.length+')</h3><table><tr><th>Query</th><th>Results</th><th>When</th></tr>';
      d.searches.forEach(function(s){html+='<tr><td>'+s.query+'</td><td>'+s.results+'</td><td>'+s.created_at+'</td></tr>'});html+='</table>';}
    html+='</div>';out.innerHTML=html;
  }).catch(function(e){out.innerHTML='<p style="color:#c44">'+e.message+'</p>'});
};

// Quick SQL
function quickSql(q){
  var out=document.getElementById('quick-result');
  out.innerHTML='<p style="color:#666;font-size:.75rem">Running...</p>';
  fetch('/admin/sql',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:q})})
    .then(function(r){return r.json()}).then(function(d){
      if(d.error){out.innerHTML='<p style="color:#c44;font-size:.75rem">'+d.error+'</p>';return}
      if(!d.results||!d.results.length){out.innerHTML='<p style="color:#666;font-size:.75rem">No results</p>';return}
      var cols=Object.keys(d.results[0]);
      var html='<table><tr>'+cols.map(function(c){return'<th>'+c+'</th>'}).join('')+'</tr>';
      d.results.forEach(function(row){html+='<tr>'+cols.map(function(c){var v=row[c];return'<td class="mono trunc">'+(v===null?'NULL':String(v).slice(0,80))+'</td>'}).join('')+'</tr>'});
      out.innerHTML=html+'</table>';
    }).catch(function(e){out.innerHTML='<p style="color:#c44">'+e.message+'</p>'});
}
</script>
` : ''}

${!isEdit && tab === 'ai' ? `
<h2>AI Assistant</h2>
<div class="ai-wrap">
  <div class="ai-chat" id="ai-chat">
    <div class="ai-msg ai-bot">How can I help manage DeenSubs? I can help with content strategy, video descriptions, SEO, moderation decisions, or analytics insights. Ask me anything about the platform.</div>
  </div>
  <div class="ai-form">
    <input type="text" id="ai-input" placeholder="Ask about content, SEO, analytics..." autocomplete="off">
    <button class="btn" id="ai-send">Send</button>
  </div>
</div>
<script>
var chat=document.getElementById('ai-chat'),inp=document.getElementById('ai-input'),btn=document.getElementById('ai-send');
var context='Platform stats: ${stats?.video_count||0} videos, ${stats?.user_count||0} users, ${stats?.comment_count||0} comments, ${stats?.total_views||0} views. Top countries: ${countries.slice(0,5).map(c=>c.country+'('+c.hits+')').join(', ')}. Top searches: ${searchLogs.slice(0,5).map(s=>s.query+'('+s.times+'x)').join(', ')}';
function send(){
  var q=inp.value.trim();if(!q)return;
  chat.innerHTML+='<div class="ai-msg ai-user">'+q.replace(/</g,'&lt;')+'</div>';
  chat.innerHTML+='<div class="ai-msg ai-bot ai-typing">Thinking...</div>';
  chat.scrollTop=chat.scrollHeight;inp.value='';btn.disabled=true;
  fetch('/admin/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:q,context:context})})
    .then(function(r){return r.json()}).then(function(d){
      chat.querySelector('.ai-typing').remove();
      var resp=(d.response||d.error||'No response').replace(/</g,'&lt;').replace(/\\n/g,'<br>');
      chat.innerHTML+='<div class="ai-msg ai-bot">'+resp+'</div>';
      chat.scrollTop=chat.scrollHeight;
    }).catch(function(e){chat.querySelector('.ai-typing').remove();chat.innerHTML+='<div class="ai-msg ai-bot" style="color:#c44">Error: '+e.message+'</div>'})
    .finally(function(){btn.disabled=false;inp.focus()});
}
btn.onclick=send;inp.onkeydown=function(e){if(e.key==='Enter')send()};
</script>
` : ''}

${!isEdit && tab === 'add' ? `
<h2>Add Video</h2>
<div class="fc"><form method="post" action="/admin/video?${q.slice(1)}">
<label>Title *</label><input name="title" required>
<label>Arabic Title</label><input name="title_ar" dir="rtl">
<label>Slug *</label><input name="slug" required pattern="[a-z0-9-]+">
<label>Description</label><textarea name="description" rows="3"></textarea>
<label>Category</label><select name="category_id">${categories.map(c => `<option value="${c.id}">${e(c.name)}</option>`).join('')}</select>
<label>Source</label><input name="source">
<label>Duration (seconds)</label><input name="duration" type="number">
<label>R2 Video Key *</label><input name="video_key" required placeholder="videos/filename.mp4">
<label>R2 Subtitle Key</label><input name="srt_key" placeholder="subs/filename.srt">
<label>R2 Thumbnail Key</label><input name="thumb_key" placeholder="thumbs/filename.jpg">
<button class="btn" type="submit">Add Video</button></form></div>
` : ''}

</div></body></html>`;
}
