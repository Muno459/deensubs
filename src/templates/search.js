import { e } from '../lib/helpers.js';
import { vcard } from '../components/video-card.js';

export function renderSearch({ query, videos }) {
  return `<section class="sec">
<div class="sec-hd"><h1>${query?'Results for &ldquo;'+e(query)+'&rdquo;':'Search'}</h1><span class="cat-ct">${videos.length} result${videos.length!==1?'s':''}</span></div>
<div class="grid">${videos.length?videos.map(v=>vcard(v)).join(''):`<p class="emp">${query?'No results found. Try different keywords.':'Enter a search term above.'}</p>`}</div></section>`;
}
