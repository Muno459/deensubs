import { e, ago } from '../lib/helpers.js';

export function renderProfile({ user, comments, stats }) {
  const memberSince = user.created_at ? new Date(user.created_at + 'Z').toLocaleDateString('en', { month: 'long', year: 'numeric' }) : '';
  return `
<div class="prof">
  <div class="prof-hero">
    <div class="prof-av-wrap">
      <img src="${e(user.avatar)}" class="prof-av" alt="${e(user.name)}">
      ${user.role === 'admin' ? '<span class="prof-badge">Admin</span>' : ''}
    </div>
    <div class="prof-info">
      <h1>${e(user.name)}</h1>
      <p class="prof-email">${e(user.email)}</p>
      ${memberSince ? `<p class="prof-since">Member since ${memberSince}</p>` : ''}
      <div class="prof-stats">
        <div class="prof-stat"><span>${stats?.comment_count || 0}</span>Comments</div>
        <div class="prof-stat"><span id="prof-watched">-</span>Watched</div>
        <div class="prof-stat"><span id="prof-time">-</span>Minutes</div>
      </div>
    </div>
  </div>
<script>
(function(){try{var w=0,t=0;for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k.startsWith('p_')){w++;try{var d=JSON.parse(localStorage.getItem(k));t+=Math.round((d.t||0)/60)}catch(e){}}}
var we=document.getElementById('prof-watched'),te=document.getElementById('prof-time');if(we)we.textContent=w;if(te)te.textContent=t}catch(e){}})();
</script>

  <div class="prof-section">
    <h2>Your Comments</h2>
    ${comments.length ? `<div class="prof-comments">
      ${comments.map(c => `<div class="prof-cm">
        <div class="prof-cm-top">
          <a href="/watch/${e(c.video_slug)}" class="prof-cm-video">${e(c.video_title || 'Unknown video')}</a>
          <time>${ago(c.created_at)}</time>
        </div>
        <p>${e(c.content)}</p>
      </div>`).join('')}
    </div>` : '<p class="prof-empty">No comments yet. Watch a video and share your thoughts!</p>'}
  </div>

  <div class="prof-section">
    <h2>Settings</h2>
    <div class="prof-settings">
      ${user.role === 'admin' ? '<a href="/admin" class="prof-admin-btn">Admin Dashboard</a>' : ''}
      <a href="/auth/logout" class="prof-logout">Sign Out</a>
    </div>
  </div>
</div>`;
}
