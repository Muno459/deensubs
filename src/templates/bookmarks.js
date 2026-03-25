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
