// Generate unique SVG thumbnail per video based on title hash
export function tsvg(title, color, w, h) {
  w = w || 320;
  h = h || 180;
  let x = 0;
  for (let i = 0; i < title.length; i++) x = ((x << 5) - x + title.charCodeAt(i)) | 0;
  x = Math.abs(x);
  const cx = w * 0.35 + (x % (w * 0.3));
  const cy = h * 0.22 + ((x >> 4) % (h * 0.5));
  const s = Math.min(w, h) * 0.22 + ((x >> 8) % (Math.min(w, h) * 0.18));
  const cx2 = w * 0.7 + ((x >> 12) % (w * 0.2));
  const cy2 = h * 0.65 + ((x >> 16) % (h * 0.2));
  const s2 = s * 0.5;

  return `<svg viewBox="0 0 ${w} ${h}" fill="none" class="tsvg"><rect width="${w}" height="${h}" fill="#07070d"/>
<circle cx="${cx}" cy="${cy}" r="${s * 1.5}" fill="${color}" opacity=".03"/>
<g opacity=".12"><rect x="${cx - s / 2}" y="${cy - s / 2}" width="${s}" height="${s}" stroke="${color}" stroke-width=".7" transform="rotate(45 ${cx} ${cy})"/>
<rect x="${cx - s / 2}" y="${cy - s / 2}" width="${s}" height="${s}" stroke="${color}" stroke-width=".7"/></g>
<circle cx="${cx}" cy="${cy}" r="${s * 0.18}" stroke="${color}" stroke-width=".4" opacity=".08"/>
<g opacity=".06"><rect x="${cx2 - s2 / 2}" y="${cy2 - s2 / 2}" width="${s2}" height="${s2}" stroke="${color}" stroke-width=".5" transform="rotate(45 ${cx2} ${cy2})"/>
<rect x="${cx2 - s2 / 2}" y="${cy2 - s2 / 2}" width="${s2}" height="${s2}" stroke="${color}" stroke-width=".5"/></g></svg>`;
}
