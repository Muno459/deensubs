import { e, fv, fl, ft, thu, thuSrcset, isNew, cdn } from '../lib/helpers.js';
import { tsvg } from './thumbnail.js';

// Standard video card
export function vcard(v, opts) {
  opts = opts || {};
  const th = thu(v);
  const col = v.category_color || '#c4a44c';
  const fresh = isNew(v.created_at);

  const eager = opts.eager;
  const srcset = thuSrcset(v);
  return `<a href="/watch/${e(v.slug)}" class="card${opts.anim ? ' card-anim' : ''}" title="${e(v.title)}${v.source ? ' — ' + e(v.source) : ''}">
<div class="card-th">
  ${!th ? tsvg(v.title, col) : `<img src="${e(th)}" ${srcset ? `srcset="${srcset}" sizes="(max-width:768px) 50vw, 280px"` : ''} alt="${e(v.title)}" class="card-img" width="640" height="360" loading="${eager ? 'eager' : 'lazy'}" decoding="async"${eager ? ' fetchpriority="high"' : ''}>`}
  <div class="card-hover"><div class="card-pi"></div></div>
  ${v.duration ? `<span class="dur">${ft(v.duration)}</span>` : ''}
  ${v.srt_key ? '<span class="badge-cc">CC</span>' : ''}
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
<div class="sc-th">
  ${th ? `<img src="${e(th)}" alt="${e(v.title)}" loading="lazy" decoding="async" class="sc-img">` : tsvg(v.title, col, 140, 79)}
  ${v.duration ? `<span class="dur dur-s">${ft(v.duration)}</span>` : ''}
</div>
<div class="sc-i"><h4>${e(v.title)}</h4><span>${v.source ? e(v.source) : ''}</span><span>${fv(v.views)}</span></div></a>`;
}

// Section helper
export function section(title, titleAr, items, opts) {
  opts = opts || {};
  if (!items.length) return '';
  const cards = items.map((v, i) => vcard(v, { anim: true, eager: opts.eager && i < 5 })).join('');
  if (opts.scroll) {
    return `<section class="sec sec-scroll">
<div class="sec-hd">${titleAr ? `<span class="sec-ar">${e(titleAr)}</span>` : ''}<h2>${title}</h2>${opts.link ? `<a href="${e(opts.link)}" class="sec-more">View all &rarr;</a>` : ''}</div>
<div class="hscroll-wrap"><button class="hscroll-arr hscroll-arr-l" aria-label="Scroll left"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button><div class="hscroll">${cards}</div><button class="hscroll-arr hscroll-arr-r" aria-label="Scroll right"><svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></button></div></section>`;
  }
  return `<section class="sec">
<div class="sec-hd">${titleAr ? `<span class="sec-ar">${e(titleAr)}</span>` : ''}<h2>${title}</h2>${opts.link ? `<a href="${e(opts.link)}" class="sec-more">View all &rarr;</a>` : ''}</div>
<div class="grid">${cards}</div></section>`;
}
