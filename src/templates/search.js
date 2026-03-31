import { e, cdn, schImg } from '../lib/helpers.js';
import { vcard } from '../components/video-card.js';

export function renderSearch({ query, videos, scholars }) {
  scholars = scholars || [];
  const total = videos.length + scholars.length;
  const cats = [...new Set(videos.map(v => v.category_name).filter(Boolean))];
  return `<section class="sec">
<div class="sec-hd"><h1>${query?'Results for &ldquo;'+e(query)+'&rdquo;':'Search'}</h1>${total?`<span class="cat-ct">${total} result${total!==1?'s':''}</span>`:''}</div>
${query && cats.length > 1 ? `<div class="search-filters" id="sf"><button class="sf-chip sf-on" data-cat="all">All</button>${cats.map(c => `<button class="sf-chip" data-cat="${e(c)}">${e(c)}</button>`).join('')}</div>` : ''}
${!query?`<form action="/search" method="get" class="search-page-form"><input type="search" name="q" placeholder="Search videos, scholars, topics..." autofocus autocomplete="off"><button type="submit">Search</button></form>`:''}
${scholars.length?`<div class="search-scholars"><h3>Scholars</h3><div class="search-sch-row">${scholars.map(s=>`<a href="/scholar/${e(s.slug)}" class="search-sch-card card-anim">
  <div class="search-sch-av">${s.photo?`<img src="${schImg(s.photo)}" alt="" loading="lazy">`:(s.name||'').split(' ').pop().charAt(0)}</div>
  <div><div class="search-sch-name">${e(s.name)}</div><div class="search-sch-sub">${s.video_count||0} videos${s.title?' · '+e(s.title):''}</div></div>
</a>`).join('')}</div></div>`:''}
<div class="grid" id="sr">${videos.length?videos.map(v=>vcard(v,{anim:true})).join(''):`<p class="emp">${query&&!scholars.length?'No results found for &ldquo;'+e(query)+'&rdquo;. Try different keywords or browse <a href="/" style="color:var(--gold)">all videos</a>.':(query?'':'Type a query to search across all videos, scholars, and topics.')}</p>`}</div>
${query && cats.length > 1 ? `<script>(function(){var sf=document.getElementById('sf');if(!sf)return;sf.onclick=function(ev){var b=ev.target.closest('.sf-chip');if(!b)return;sf.querySelectorAll('.sf-chip').forEach(function(c){c.classList.remove('sf-on')});b.classList.add('sf-on');var cat=b.dataset.cat;document.querySelectorAll('#sr .card').forEach(function(c){var tags=c.querySelectorAll('.tag');var match=cat==='all';tags.forEach(function(t){if(t.textContent===cat)match=true});c.style.display=match?'':'none'})}})()</script>` : ''}
</section>`;
}
