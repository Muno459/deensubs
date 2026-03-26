// HTML escape
export function e(s) {
  return s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// JS string escape (for embedding in single-quoted JS strings)
export function jsStr(s) {
  return s == null ? '' : String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// Relative time
export function ago(d) {
  if (!d) return '';
  const s = Math.floor((Date.now() - new Date(d + 'Z').getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 2592000) return Math.floor(s / 86400) + 'd ago';
  return new Date(d).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Format views
export function fv(n) {
  return !n ? '0 views' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M views' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K views' : n + ' views';
}

// Format likes
export function fl(n) {
  return !n ? '' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n);
}

// Format seconds to time string
export function ft(sec) {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const h = Math.floor(m / 60);
  return h > 0
    ? h + ':' + String(m % 60).padStart(2, '0') + ':' + String(s).padStart(2, '0')
    : m + ':' + String(s).padStart(2, '0');
}

// CDN URL
export const CDN = 'https://cdn.deensubs.com';

export function cdn(key) {
  return key ? CDN + '/' + key : null;
}

// Responsive thumbnail URLs — returns srcset-ready object
export function thu(v) {
  if (!v.thumb_key) return null;
  const base = v.thumb_key.replace(/\.(jpg|jpeg|png)$/i, '');
  return cdn(base + '-640w.webp');
}

export function thuSrcset(v) {
  if (!v.thumb_key) return null;
  const base = v.thumb_key.replace(/\.(jpg|jpeg|png)$/i, '');
  return `${cdn(base + '-320w.webp')} 320w, ${cdn(base + '-480w.webp')} 480w, ${cdn(base + '-640w.webp')} 640w`;
}

// Check if video is new (less than 7 days)
export function isNew(d) {
  return d && (Date.now() - new Date(d + 'Z').getTime()) < 7 * 86400000;
}

// Generate avatar color from name
export function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  const hues = ['#c4a44c', '#4c8ac4', '#4ca476', '#8a4cc4', '#4cb4a4', '#c44c6e', '#c48a4c'];
  return hues[Math.abs(h) % hues.length];
}
