import { e, fv, fl, ft, thu, isNew, cdn } from '../lib/helpers.js';
import { tsvg } from './thumbnail.js';

// Standard video card
export function vcard(v, opts) {
  opts = opts || {};
  const th = thu(v);
  const col = v.category_color || '#c4a44c';
  const fresh = isNew(v.created_at);

  return `<a href="/watch/${e(v.slug)}" class="card${opts.anim ? ' card-anim' : ''}">
<div class="card-th"${th ? ` data-bg="${e(th)}"` : ''}>
  ${!th ? tsvg(v.title, col) : ''}
  <div class="card-hover"><div class="card-pi"></div></div>
  ${v.duration ? `<span class="dur">${ft(v.duration)}</span>` : ''}
  ${fresh ? '<span class="badge-new">NEW</span>' : ''}
</div>
<div class="card-bd">
  <h3>${e(v.title)}</h3>
  <div class="card-mt">
    ${v.source ? `<span>${e(v.source)}</span>` : ''}
    <span>${fv(v.views)}</span>
    ${v.likes ? `<span>${fl(v.likes)} likes</span>` : ''}
  </div>
  <div class="card-tg">
    ${v.category_name ? `<span class="tag" style="--tc:${e(col)}">${e(v.category_name)}</span>` : ''}
    ${v.srt_key ? '<span class="tag tag-s">CC</span>' : ''}
  </div>
</div></a>`;
}

// Sidebar card (for related videos)
export function scard(v) {
  const th = thu(v);
  const col = v.category_color || '#c4a44c';
  return `<a href="/watch/${e(v.slug)}" class="sc">
<div class="sc-th"${th ? ` style="background-image:url('${e(th)}');background-size:cover;background-position:center"` : ''}>
  ${!th ? tsvg(v.title, col, 140, 79) : ''}
  ${v.duration ? `<span class="dur dur-s">${ft(v.duration)}</span>` : ''}
</div>
<div class="sc-i"><h4>${e(v.title)}</h4><span>${v.source ? e(v.source) : ''}</span><span>${fv(v.views)}</span></div></a>`;
}

// Section helper
export function section(title, titleAr, items, opts) {
  opts = opts || {};
  if (!items.length) return '';
  return `<section class="sec${opts.scroll ? ' sec-scroll' : ''}">
<div class="sec-hd">${titleAr ? `<span class="sec-ar">${e(titleAr)}</span>` : ''}<h2>${title}</h2>${opts.link ? `<a href="${e(opts.link)}" class="sec-more">View all &rarr;</a>` : ''}</div>
<div class="${opts.scroll ? 'hscroll' : 'grid'}">${items.map(v => vcard(v, { anim: true })).join('')}</div></section>`;
}
