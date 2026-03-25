import { e } from '../lib/helpers.js';
import { vcard } from '../components/video-card.js';

export function renderCategory({ category, videos, sort }) {
  return `<section class="sec">
<div class="sec-hd"><div class="cat-hd"><span class="sec-ar">${e(category.name_ar)}</span><h1>${e(category.name)}</h1></div>
<div class="cat-ctrls"><span class="cat-ct">${videos.length} video${videos.length!==1?'s':''}</span>
<div class="sort-btns"><a href="?sort=newest" class="sb${sort!=='popular'?' sb-on':''}">Newest</a><a href="?sort=popular" class="sb${sort==='popular'?' sb-on':''}">Popular</a></div></div></div>
<div class="grid">${videos.length?videos.map(v=>vcard(v,{anim:true})).join(''):'<p class="emp">No videos in this category yet.</p>'}</div></section>`;
}
