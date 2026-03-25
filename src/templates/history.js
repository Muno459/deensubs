export function renderHistory() {
  return `
<section class="sec">
  <div class="sec-hd"><h1>Watch History</h1></div>
  <div class="grid" id="hist-grid">
    <div class="skel-grid">${'<div class="skel-card"><div class="skel-th skel-shimmer"></div><div class="skel-bd"><div class="skel-line skel-shimmer"></div><div class="skel-line skel-line-s skel-shimmer"></div></div></div>'.repeat(4)}</div>
  </div>
</section>
<script>
(function(){
  var grid=document.getElementById('hist-grid');
  var keys=[];for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k.startsWith('p_'))keys.push(k)}
  var items=keys.map(function(k){try{var d=JSON.parse(localStorage.getItem(k));if(d&&d.title)return{slug:k.slice(2),t:d.t||0,d:d.d||0,ts:d.ts||0,title:d.title,thumb:d.thumb||'',source:d.source||''};return null}catch(e){return null}}).filter(Boolean).sort(function(a,b){return b.ts-a.ts});
  if(!items.length){grid.innerHTML='<p class="emp">No watch history yet. Videos you watch will appear here.</p>';return}
  grid.innerHTML=items.map(function(it){
    var pct=it.d?Math.round(it.t/it.d*100):0;
    var done=pct>95;
    return '<a href="/watch/'+it.slug+'" class="card">'
      +'<div class="card-th"'+(it.thumb?' style="background-image:url(\\''+it.thumb+'\\');background-size:cover;background-position:center"':'')+'>'
      +'<div class="cw-prog" style="width:'+pct+'%"></div>'
      +(done?'<div class="hist-done"><svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></div>':'')
      +'</div><div class="card-bd"><h3>'+it.title.replace(/</g,'&lt;')+'</h3>'
      +'<div class="card-mt"><span>'+it.source.replace(/</g,'&lt;')+'</span>'
      +'<span>'+(done?'Watched':Math.round(it.t/60)+'m watched')+'</span></div></div></a>';
  }).join('');
})();
</script>`;
}
