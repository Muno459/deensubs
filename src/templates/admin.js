import { e, ago } from '../lib/helpers.js';

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
