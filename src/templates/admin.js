import { e, ago, fv } from '../lib/helpers.js';

export function renderAdmin({ videos, categories, key, editing, tab, users, comments, stats }) {
  const v = editing || {};
  const isEdit = !!editing;
  const q = key ? '&key=' + e(key) : '';
  const formAction = isEdit ? `/admin/edit/${v.id}?${q.slice(1)}` : `/admin/video?${q.slice(1)}`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin — DeenSubs</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Outfit',system-ui,sans-serif;background:#08080e;color:#e0e0e0;min-height:100vh}
a{color:#c4a44c;text-decoration:none}
.adm-top{background:#0c0c14;border-bottom:1px solid #1a1a24;padding:1rem 2rem;display:flex;align-items:center;justify-content:space-between}
.adm-top h1{font-size:1.2rem;font-weight:600;color:#c4a44c}
.adm-top a{font-size:.75rem;color:#888}
.adm-tabs{display:flex;gap:.25rem;padding:.75rem 2rem;background:#0a0a12;border-bottom:1px solid #1a1a24}
.adm-tab{padding:.4rem 1rem;border-radius:8px;font-size:.78rem;color:#888;transition:all .2s}
.adm-tab:hover{background:#14141e;color:#ddd}
.adm-tab.on{background:rgba(196,164,76,.08);color:#c4a44c}
.adm-body{max-width:1100px;margin:0 auto;padding:1.5rem 2rem}

/* Dashboard */
.dash-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.75rem;margin-bottom:2rem}
.dash-card{background:#0e0e16;border:1px solid #1a1a24;border-radius:10px;padding:1.25rem;text-align:center}
.dash-card-val{font-size:2rem;font-weight:300;color:#c4a44c;line-height:1}
.dash-card-lbl{font-size:.68rem;color:#666;text-transform:uppercase;letter-spacing:.08em;margin-top:.3rem}

/* Forms */
.form-card{background:#0e0e16;border:1px solid #1a1a24;border-radius:10px;padding:1.5rem;margin-bottom:1.5rem}
label{display:block;font-size:.75rem;color:#666;margin-bottom:.2rem;margin-top:.65rem}
input,select,textarea{width:100%;background:#08080e;border:1px solid #1a1a24;border-radius:6px;padding:.45rem .65rem;color:#e0e0e0;font:inherit;font-size:.82rem}
input:focus,select:focus,textarea:focus{outline:none;border-color:#c4a44c}
.btn{margin-top:.75rem;padding:.5rem 1.25rem;background:#c4a44c;color:#08080e;border:none;border-radius:6px;font:inherit;font-size:.8rem;font-weight:600;cursor:pointer}
.btn:hover{filter:brightness(1.1)}

/* Tables */
table{width:100%;border-collapse:collapse;font-size:.78rem}
th{text-align:left;padding:.5rem .65rem;color:#555;font-weight:500;border-bottom:1px solid #1a1a24;font-size:.68rem;text-transform:uppercase;letter-spacing:.05em}
td{padding:.5rem .65rem;border-bottom:1px solid #12121a}
tr:hover{background:#0c0c14}
.acts{display:flex;gap:.25rem}
.act-btn{padding:.2rem .5rem;border-radius:4px;font-size:.7rem;cursor:pointer;background:none;border:1px solid #333;color:#888;transition:all .15s}
.act-btn:hover{border-color:#c4a44c;color:#c4a44c}
.del-btn{color:#c44;border-color:#c44}.del-btn:hover{background:#c44;color:#fff}
.user-av{width:24px;height:24px;border-radius:50%;vertical-align:middle;margin-right:.4rem}
.cm-text{max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
h2{font-size:1rem;font-weight:600;margin-bottom:1rem;color:#ddd}
.back{display:inline-block;margin-bottom:1rem;font-size:.8rem}
select.role-sel{width:auto;padding:.15rem .4rem;font-size:.7rem;border-radius:4px}
</style></head><body>
<div class="adm-top">
  <h1>DeenSubs Admin</h1>
  <a href="/">← Back to site</a>
</div>
${!isEdit ? `<div class="adm-tabs">
  <a href="/admin?tab=dashboard${q}" class="adm-tab${tab==='dashboard'?' on':''}">Dashboard</a>
  <a href="/admin?tab=videos${q}" class="adm-tab${tab==='videos'?' on':''}">Videos (${videos.length})</a>
  <a href="/admin?tab=comments${q}" class="adm-tab${tab==='comments'?' on':''}">Comments (${comments.length})</a>
  <a href="/admin?tab=users${q}" class="adm-tab${tab==='users'?' on':''}">Users (${users.length})</a>
  <a href="/admin?tab=add${q}" class="adm-tab${tab==='add'?' on':''}">+ Add Video</a>
</div>` : ''}
<div class="adm-body">

${isEdit ? `
<a href="/admin?tab=videos${q}" class="back">&larr; Back to videos</a>
<h2>Edit Video</h2>
<div class="form-card"><form method="post" action="${formAction}">
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
<div class="dash-grid">
  <div class="dash-card"><div class="dash-card-val">${stats?.video_count || 0}</div><div class="dash-card-lbl">Videos</div></div>
  <div class="dash-card"><div class="dash-card-val">${stats?.user_count || 0}</div><div class="dash-card-lbl">Users</div></div>
  <div class="dash-card"><div class="dash-card-val">${stats?.comment_count || 0}</div><div class="dash-card-lbl">Comments</div></div>
  <div class="dash-card"><div class="dash-card-val">${stats?.total_views || 0}</div><div class="dash-card-lbl">Total Views</div></div>
  <div class="dash-card"><div class="dash-card-val">${stats?.total_likes || 0}</div><div class="dash-card-lbl">Total Likes</div></div>
</div>
<h2>Recent Comments</h2>
<table><tr><th>User</th><th>Video</th><th>Comment</th><th>When</th></tr>
${(comments || []).slice(0, 10).map(c => `<tr><td>${c.user_avatar ? `<img src="${e(c.user_avatar)}" class="user-av">` : ''}${e(c.user_name || c.author)}</td><td><a href="/watch/${e(c.video_slug || '')}">${e(c.video_title || '?')}</a></td><td class="cm-text">${e(c.content)}</td><td>${ago(c.created_at)}</td></tr>`).join('')}
</table>
` : ''}

${!isEdit && tab === 'videos' ? `
<h2>All Videos</h2>
<table><tr><th>Title</th><th>Category</th><th>Views</th><th>Likes</th><th>Created</th><th></th></tr>
${videos.map(vi => `<tr><td><a href="/watch/${e(vi.slug)}">${e(vi.title)}</a></td><td>${e(vi.category_name || '')}</td><td>${vi.views}</td><td>${vi.likes}</td><td>${ago(vi.created_at)}</td>
<td><div class="acts"><a href="/admin/edit/${vi.id}?tab=videos${q}" class="act-btn">Edit</a><form method="post" action="/admin/delete/${vi.id}?tab=videos${q}" onsubmit="return confirm('Delete this video?')" style="margin:0"><button class="act-btn del-btn">Del</button></form></div></td></tr>`).join('')}
</table>
` : ''}

${!isEdit && tab === 'comments' ? `
<h2>All Comments</h2>
<table><tr><th>User</th><th>Video</th><th>Comment</th><th>When</th><th></th></tr>
${(comments || []).map(c => `<tr><td>${c.user_avatar ? `<img src="${e(c.user_avatar)}" class="user-av">` : ''}${e(c.user_name || c.author)}</td><td><a href="/watch/${e(c.video_slug || '')}">${e(c.video_title || '?')}</a></td><td class="cm-text">${e(c.content)}</td><td>${ago(c.created_at)}</td>
<td><form method="post" action="/admin/delete-comment/${c.id}?tab=comments${q}" onsubmit="return confirm('Delete this comment?')" style="margin:0"><button class="act-btn del-btn">Del</button></form></td></tr>`).join('')}
</table>
` : ''}

${!isEdit && tab === 'users' ? `
<h2>All Users</h2>
<table><tr><th>User</th><th>Email</th><th>Role</th><th>Joined</th><th></th></tr>
${(users || []).map(u => `<tr><td>${u.avatar ? `<img src="${e(u.avatar)}" class="user-av">` : ''}${e(u.name)}</td><td>${e(u.email)}</td><td>${e(u.role || 'user')}</td><td>${ago(u.created_at)}</td>
<td><form method="post" action="/admin/user-role/${u.id}?tab=users${q}" style="margin:0;display:flex;gap:.25rem"><select name="role" class="role-sel"><option value="user"${u.role !== 'admin' ? ' selected' : ''}>user</option><option value="admin"${u.role === 'admin' ? ' selected' : ''}>admin</option></select><button class="act-btn">Set</button></form></td></tr>`).join('')}
</table>
` : ''}

${!isEdit && tab === 'add' ? `
<h2>Add Video</h2>
<div class="form-card"><form method="post" action="/admin/video?${q.slice(1)}">
<label>Title *</label><input name="title" required>
<label>Arabic Title</label><input name="title_ar" dir="rtl">
<label>Slug * (url-friendly)</label><input name="slug" required pattern="[a-z0-9-]+">
<label>Description</label><textarea name="description" rows="3"></textarea>
<label>Category</label><select name="category_id">${categories.map(c => `<option value="${c.id}">${e(c.name)}</option>`).join('')}</select>
<label>Source (e.g., Sheikh al-Fawzan)</label><input name="source">
<label>Duration (seconds)</label><input name="duration" type="number">
<label>R2 Video Key *</label><input name="video_key" required placeholder="videos/filename.mp4">
<label>R2 Subtitle Key</label><input name="srt_key" placeholder="subs/filename.srt">
<label>R2 Thumbnail Key</label><input name="thumb_key" placeholder="thumbs/filename.jpg">
<button class="btn" type="submit">Add Video</button></form></div>
` : ''}

</div></body></html>`;
}
