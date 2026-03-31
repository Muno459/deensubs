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

// CDN URL — set per-request based on user's region
// 6 R2 buckets (confirmed via GlobalPing r2.dev latency, 2026-03-28):
//   W = WEUR: Falkenstein, Germany (49ms)   E = EEUR: Warsaw, Poland (44ms)
//   N = ENAM: US East (109ms from LA)       S = WNAM: US West / LA (209ms)
//   A = APAC: Tokyo, Japan (51ms)           O = OC:   Sydney/Auckland (58-63ms)
let _cdn = 'https://cdn.deensubs.com';

const A='https://apac.cdn.deensubs.com',O='https://oc.cdn.deensubs.com',N='https://enam.cdn.deensubs.com',S='https://wnam.cdn.deensubs.com',E='https://eeur.cdn.deensubs.com',W='https://cdn.deensubs.com';

// US states → WNAM (west of Mississippi) or ENAM (east)
const US_WEST = new Set(['AK','AZ','CA','CO','HI','ID','MT','NM','NV','OR','UT','WA','WY','TX','ND','SD','NE','KS','MN','IA','MO','OK','LA','AR']);

// Large countries where sub-country routing matters — use haversine
const HAVERSINE_COUNTRIES = new Set(['US','IN','RU','CN','BR','CA','ID']);

// Bucket origins: [url, lat, lon] — confirmed via GlobalPing r2.dev 2026-03-28
const BUCKET_COORDS = [
  [W, 50.5, 12.3],   // WEUR: Falkenstein DE
  [E, 52.2, 21.0],   // EEUR: Warsaw PL
  [N, 39.0, -77.5],  // ENAM: Ashburn VA
  [S, 34.0, -118.2], // WNAM: Los Angeles
  [A, 35.7, 139.7],  // APAC: Tokyo
  [O, -33.9, 151.2], // OC:   Sydney
];
const DEG = Math.PI / 180;

const GEO={
  // APAC — Tokyo: South/East/Southeast Asia
  BD:A,BN:A,BT:A,CN:A,HK:A,ID:A,IN:A,JP:A,KH:A,KP:A,KR:A,LA:A,LK:A,MM:A,MN:A,MO:A,MV:A,MY:A,NP:A,PH:A,PK:A,SG:A,TH:A,TL:A,TW:A,VN:A,
  // OC — Sydney: Oceania + Pacific
  AS:O,AU:O,CC:O,CK:O,CX:O,FJ:O,FM:O,GU:O,HM:O,KI:O,MH:O,MP:O,NC:O,NF:O,NR:O,NU:O,NZ:O,PF:O,PG:O,PN:O,PW:O,SB:O,TK:O,TO:O,TV:O,UM:O,VU:O,WF:O,WS:O,
  // ENAM — US East: N/C America + Caribbean + South America
  AG:N,AI:N,AW:N,BB:N,BL:N,BM:N,BQ:N,BS:N,BZ:N,CA:N,CR:N,CU:N,CW:N,DM:N,DO:N,GD:N,GL:N,GP:N,GT:N,HN:N,HT:N,JM:N,KN:N,KY:N,LC:N,MF:N,MQ:N,MS:N,MX:N,NI:N,PM:N,PR:N,SV:N,SX:N,TC:N,TT:N,US:N,VC:N,VG:N,VI:N,
  // Panama → WNAM (tested: 157ms vs ENAM 279ms)
  PA:S,
  AR:N,BO:N,BR:N,BV:N,CL:N,CO:N,EC:N,FK:N,GF:N,GS:N,GY:N,PE:N,PY:N,SR:N,UY:N,VE:N,
  // EEUR — Warsaw: Balkans + E.Europe + Caucasus + Middle East + East Africa
  AL:E,AM:E,AZ:E,BA:E,BG:E,BY:E,EE:E,GE:E,HU:E,LT:E,LV:E,MD:E,ME:E,MK:E,PL:E,RO:E,RS:E,RU:E,SK:E,UA:E,XK:E,
  // Dubai, Oman → WEUR (tested: AE save 122ms, OM save 477ms)
  AE:W,OM:W,
  BH:E,EG:E,IQ:E,JO:E,KW:E,LB:E,PS:E,QA:E,SA:E,SY:E,TR:E,YE:E,
  DJ:E,ER:E,ET:E,KE:E,SO:E,
  AF:E,IR:E,KG:E,KZ:E,TJ:E,TM:E,UZ:E,
  GR:E,CY:E,IL:E,
  // WEUR — Falkenstein: W/N/S Europe + Africa (default fallback)
  FI:E,SE:E,
  AD:W,AO:W,AQ:W,AT:W,AX:W,BE:W,BF:W,BI:W,BJ:W,BW:W,CD:W,CF:W,CG:W,CH:W,CI:W,CM:W,CV:W,CZ:W,DE:W,DK:W,DZ:W,EH:W,ES:W,FO:W,FR:W,GA:W,GB:W,GG:W,GH:W,GI:W,GM:W,GN:W,GQ:W,GW:W,HR:W,IE:W,IM:W,IO:W,IS:W,IT:W,JE:W,KM:W,LI:W,LR:W,LS:W,LU:W,LY:W,MA:W,MC:W,MG:W,ML:W,MR:W,MT:W,MU:W,MW:W,MZ:W,NA:W,NE:W,NG:W,NL:W,NO:W,PT:W,RE:W,RW:W,SC:W,SD:W,SH:W,SI:W,SJ:W,SL:W,SM:W,SN:W,SS:W,ST:W,SZ:W,TD:W,TF:W,TG:W,TN:W,TZ:W,UG:W,VA:W,YT:W,ZA:W,ZM:W,ZW:W,
};

export function setCDN(country, region, lat, lon) {
  // Large countries: use haversine to pick nearest bucket
  if (lat != null && lon != null && HAVERSINE_COUNTRIES.has(country)) {
    const rlat = lat * DEG;
    const clat = Math.cos(rlat);
    let min = Infinity;
    for (const b of BUCKET_COORDS) {
      const dlat = (b[1] - lat) * DEG;
      const dlon = (b[2] - lon) * DEG;
      const a = Math.sin(dlat / 2) ** 2 + clat * Math.cos(b[1] * DEG) * Math.sin(dlon / 2) ** 2;
      if (a < min) { min = a; _cdn = b[0]; }
    }
    return;
  }
  // Small countries: hashmap
  _cdn = GEO[country] || W;
}

export function cdn(key) {
  return key ? _cdn + '/' + key : null;
}

export { _cdn as CDN };

// Scholar photo as WebP (full size for profile/cards) — served from KV via /img/
export function schImg(key) {
  if (!key) return null;
  return '/img/' + key.replace(/\.(png|jpg|jpeg)$/i, '.avif');
}

// Scholar photo tiny (64px for homepage spotlight)
export function schImgSm(key) {
  if (!key) return null;
  return '/img/' + key.replace(/\.(png|jpg|jpeg)$/i, '-64w.avif');
}

// Responsive thumbnail URLs — served from KV via /img/
export function thu(v) {
  if (!v.thumb_key) return null;
  const base = v.thumb_key.replace(/\.(jpg|jpeg|png)$/i, '');
  return '/img/' + base + '-640w.avif';
}

export function thuSrcset(v) {
  if (!v.thumb_key) return null;
  const base = v.thumb_key.replace(/\.(jpg|jpeg|png)$/i, '');
  return `/img/${base}-320w.avif 320w, /img/${base}-480w.avif 480w, /img/${base}-640w.avif 640w`;
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
