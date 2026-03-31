# DeenSubs CDN Architecture

## Overview

DeenSubs uses a multi-layer content delivery strategy:

1. **Workers KV** for thumbnails and scholar photos (globally replicated, ~5-50ms)
2. **6 R2 regional buckets** for videos, subtitles, and fonts (geo-routed)
3. **Cloudflare Edge Cache** in front of both layers (300+ PoPs)
4. **Hybrid geo-routing** — country hashmap for small countries, haversine for large ones

## R2 Bucket Locations

Confirmed via GlobalPing r2.dev latency testing (2026-03-28). R2 location hints are "best effort" — we verified actual placement by measuring TTFB from 40+ global probe locations.

| Bucket | R2 Hint | Confirmed Location | Fastest Probe | Custom Domain |
|--------|---------|-------------------|---------------|---------------|
| WEUR | `weur` | Falkenstein/Nuremberg, DE | Frankfurt 49ms | `cdn.deensubs.com` |
| EEUR | `eeur` | Warsaw, PL | Warsaw 44ms | `eeur.cdn.deensubs.com` |
| ENAM | `enam` | Ashburn, VA (US East) | Miami 83ms | `enam.cdn.deensubs.com` |
| WNAM | `wnam` | Los Angeles, CA (US West) | LA 64ms | `wnam.cdn.deensubs.com` |
| APAC | `apac` | Tokyo, JP | Tokyo 40ms | `apac.cdn.deensubs.com` |
| OC | `oc` | Sydney, AU | Sydney 63ms | `oc.cdn.deensubs.com` |

### How We Verified Bucket Locations

1. **r2.dev URLs** — Each R2 bucket has a public development URL (`pub-xxx.r2.dev`) that bypasses all caching. Every request goes directly to R2 origin.
2. **GlobalPing API** — Tested from 40+ cities worldwide including AU, NZ, JP, SG, IN, AE, SA, KE, BR, etc.
3. **Fastest probe = bucket location** — The city with the lowest TTFB is physically closest to the R2 storage. Tokyo at 40ms confirms APAC is in Japan. Sydney at 63ms confirms OC is in Australia.
4. **Triangulation attempted** — Linear distance-vs-latency models failed because submarine cables don't follow great circles. The fastest-probe method is more reliable.

### Key Findings

- R2 location hints **do work** — all 6 buckets ended up in or near their hinted regions
- R2 has **40-80ms internal retrieval latency** even from the same city (Tokyo→APAC is 40ms, not 0ms)
- Cold cache from a nearby R2 bucket: **100-200ms**. From a distant bucket: **300-500ms**
- Submarine cable routing means geographic distance != network latency. India routes west to Europe via Red Sea cables, making WEUR (Germany) faster than APAC (Tokyo) for Mumbai despite similar distances.

## Geo-Routing Strategy

### File: `src/lib/helpers.js`

Two-tier routing system:

#### Tier 1: Country Hashmap (250+ countries)

```javascript
const GEO = {
  JP: APAC, KR: APAC, IN: APAC, ...  // Asia → Tokyo
  AU: OC, NZ: OC, ...                  // Oceania → Sydney
  US: ENAM, CA: ENAM, BR: ENAM, ...   // Americas → US East
  DE: WEUR, FR: WEUR, GB: WEUR, ...   // W. Europe → Falkenstein
  PL: EEUR, TR: EEUR, AE: WEUR, ...   // E. Europe/ME → Warsaw
};
```

O(1) lookup. Each country mapped to the empirically fastest bucket based on GlobalPing testing from representative cities.

#### Tier 2: Haversine for Large Countries

For 7 large countries (US, IN, RU, CN, BR, CA, ID), country-level routing is too coarse. Instead, we use `request.cf.latitude` and `request.cf.longitude` to calculate the nearest bucket via haversine distance:

```javascript
const HAVERSINE_COUNTRIES = new Set(['US', 'IN', 'RU', 'CN', 'BR', 'CA', 'ID']);

if (lat != null && lon != null && HAVERSINE_COUNTRIES.has(country)) {
  // Pick nearest bucket by geographic distance
  for (const bucket of BUCKET_COORDS) {
    const distance = haversine(lat, lon, bucket.lat, bucket.lon);
    if (distance < min) { min = distance; cdn = bucket.url; }
  }
}
```

This handles sub-country routing:
- **US**: LA → WNAM, NYC → ENAM
- **India**: Mumbai → WEUR/EEUR (submarine cable west), Chennai → APAC (closer to Tokyo)
- **Russia**: Moscow → EEUR, Vladivostok → APAC
- **China**: Shanghai → APAC, Western China → EEUR
- **Canada**: Vancouver → WNAM, Toronto → ENAM

#### Routing Changes from Testing

Key changes discovered through 168+ global probes:

| Country | Before | After | Reason |
|---------|--------|-------|--------|
| South America (16 countries) | WNAM | ENAM | US East is closer than US West (tested: BR 332ms vs 544ms) |
| UAE (AE) | EEUR | WEUR | Dubai→Falkenstein 53ms vs →Warsaw 175ms |
| Oman (OM) | EEUR | WEUR | Muscat→Falkenstein 351ms vs →Warsaw 828ms |
| Panama (PA) | ENAM | WNAM | Panama City→LA 157ms vs →Virginia 279ms |
| Greece (GR), Cyprus (CY), Israel (IL) | WEUR | EEUR | Closer to Warsaw than Falkenstein |
| Sweden (SE), Finland (FI) | WEUR | EEUR | Closer to Warsaw than Falkenstein |
| Czech Republic (CZ), Slovenia (SI), Croatia (HR) | EEUR | WEUR | Closer to Falkenstein than Warsaw |
| South Africa (ZA) | WNAM | WEUR | Europe is closer than US West |

#### Why Not Pure Haversine for Everything?

We tested this approach and found it suboptimal:
- Submarine cable routing means geographic distance != latency
- Mumbai is geographically equidistant from Tokyo and Frankfurt, but Frankfurt is 200ms faster because India's cables go west through the Red Sea
- The tested hashmap encodes **real cable routing**, not theoretical straight-line distance
- Haversine is only used for large countries where sub-country variation matters more than cable routing errors

## KV Thumbnail Serving

### Problem

R2 cold cache for thumbnails: 200-500ms globally. A page with 12 thumbnails could take 2+ seconds for image loading on first visit.

### Solution

Store all thumbnails and scholar photos (~366 WebP files, ~75MB total) in Workers KV (MEDIA_KV namespace). KV is globally replicated to 300+ PoPs.

### Architecture

```
Browser requests /img/thumbs/slug-640w.webp
  │
  ├─ CF Edge Cache HIT? → return (~5ms)
  │
  ├─ Worker → KV read → found? → return + cache at edge (~30-50ms)
  │
  └─ Worker → R2 fallback → return + write to KV + cache at edge (~200ms, one-time)
```

### File: `src/routes/api.js`

The `/img/*` route:
1. Checks CF edge cache via Cache API (fastest path)
2. Reads from `MEDIA_KV` (globally replicated)
3. Falls back to `MEDIA_BUCKET` (R2) on KV miss, lazy-populates KV
4. Sets `Cache-Control: public, max-age=31536000, immutable` for permanent edge caching

### What Goes Where

| Content | Storage | Served From | Path |
|---------|---------|-------------|------|
| Thumbnails (320w/480w/640w WebP) | KV + R2 | `/img/thumbs/...` | Worker → KV → Edge Cache |
| Scholar photos (full + 64w) | KV + R2 | `/img/scholars/...` | Worker → KV → Edge Cache |
| Videos (MP4, 50MB-1.2GB) | R2 only | CDN custom domain | R2 → Edge Cache |
| Subtitles (SRT/VTT) | R2 + KV cache | `/api/vtt/...` | Worker → KV cache → R2 |
| Fonts (woff2) | Worker binary | `/fonts/...` | Worker bundle |

### Cost

- KV storage: 75MB = ~$0.04/mo
- KV reads: $0.50/million (most reads served from edge cache, not KV)
- Total: **< $1/mo** for globally instant thumbnails

### Migration

One-time migration endpoint: `GET /admin/migrate-to-kv`

Reads all `.webp` files from `thumbs/` and `scholars/` prefixes in R2, writes to MEDIA_KV. Processes in batches of 10 with `Promise.all`.

New thumbnails are dual-written by the cron handler (`src/index.js` scheduled handler) — writes to both R2 and MEDIA_KV.

## Performance Summary

| Metric | Before | After |
|--------|--------|-------|
| Thumbnail cold cache (global) | 200-500ms | ~50ms (KV) → ~5ms (edge) |
| Thumbnail warm cache | ~20-40ms | ~5ms |
| Video cold cache (nearest R2) | 200-500ms | Same (R2 limitation) |
| Video warm cache | ~20-40ms | Same |
| Page TTFB | ~70ms | ~70ms |
| Geo-routing accuracy | Country-level only | Sub-country for US/IN/RU/CN/BR/CA/ID |

## Testing Methodology

### Tools Used

1. **check-host.net** — 40 nodes, Europe/Asia/Americas. No AU/NZ nodes. Free, unlimited.
2. **GlobalPing API** — 100+ cities including AU, NZ, AF, ME. Authenticated with token for higher limits.
3. **curl timing** — `time_appconnect` (TLS done) vs `time_starttransfer` (TTFB) to isolate internal CF backbone time.
4. **r2.dev public URLs** — Bypass all caching for pure R2 origin latency.

### How to Re-run the CDN Audit

```bash
# 1. Test a specific bucket from a specific location via GlobalPing:
curl -s -X POST "https://api.globalping.io/v1/measurements" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "type": "http",
    "target": "pub-XXXXX.r2.dev",
    "locations": [{"country": "IN", "city": "Mumbai"}],
    "measurementOptions": {
      "protocol": "HTTPS", "port": 443,
      "request": {"path": "/thumbs/some-file.webp", "method": "GET"}
    }
  }'

# 2. Fetch results:
curl -s "https://api.globalping.io/v1/measurements/MEASUREMENT_ID"

# 3. Compare TTFB across buckets for the same location to determine optimal routing.
```

### r2.dev URLs for Each Bucket

| Bucket | r2.dev URL |
|--------|-----------|
| WEUR | `pub-c598b65f02704960981e17350c1769f1.r2.dev` |
| EEUR | `pub-deacfeecb4844b4db40654facd663d6b.r2.dev` |
| ENAM | `pub-931f43bdc0e24efd825896cae48d8e99.r2.dev` |
| WNAM | `pub-8f60fba7afb9497685bdaf5e202eeb89.r2.dev` |
| APAC | `pub-9f52a41bd8de499695fd3fa73b2ad277.r2.dev` |
| OC | `pub-dc613d82e01c4d3386e9b8b4244edf82.r2.dev` |
