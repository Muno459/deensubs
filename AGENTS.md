# DeenSubs — Agent Guide

## Overview

DeenSubs is an Islamic content platform serving Arabic lectures with AI-powered English subtitles. Built on Cloudflare Workers with a fully edge-optimized architecture.

**Live**: https://deensubs.com
**Repo**: https://github.com/Muno459/deensubs

## Stack

- **Runtime**: Cloudflare Workers (Hono framework)
- **Database**: D1 (SQLite, WEUR primary with read replicas)
- **Storage**: R2 (6 geo-distributed buckets)
- **Cache**: Workers KV (CACHE for data, MEDIA_KV for thumbnails)
- **Queue**: Cloudflare Queues (async tasks — view counts, search logs)
- **Analytics**: Analytics Engine (pageviews, watch events)
- **Build**: esbuild (CSS/JS minification at deploy time)

## Architecture

### Routing
```
src/index.js          → Middleware chain (maintenance gate, security headers, auth, analytics)
src/routes/pages.js   → HTML pages (SSR templates)
src/routes/api.js     → API endpoints + /img/* thumbnail serving
src/routes/feeds.js   → Fonts, favicon, robots, sitemap, RSS, service worker, manifest
src/routes/auth.js    → Google OAuth + One Tap
src/routes/admin.js   → Admin panel
```

### Templates (SSR, no framework)
```
src/templates/layout.js   → Shell (head, nav, footer, inline CSS/JS)
src/templates/home.js     → Homepage
src/templates/watch.js    → Video player page
src/templates/category.js → Category listing
src/templates/scholar.js  → Scholar profile
src/templates/admin.js    → Admin panel
```

### Key Libraries
```
src/lib/helpers.js    → CDN routing (haversine), image URL helpers, escaping
src/lib/kv-cache.js   → Stale-while-revalidate KV caching, batch reads
src/lib/db.js         → D1 query fragments, read/write replica helpers
src/lib/srt.js        → SRT parsing for transcript rendering
src/lib/analytics.js  → Analytics Engine query helpers
```

## CDN Architecture

6 R2 buckets with location hints:
- **WEUR** (cdn.deensubs.com) — Falkenstein, Germany — default/fallback
- **EEUR** (eeur.cdn.deensubs.com) — Warsaw, Poland
- **ENAM** (enam.cdn.deensubs.com) — Ashburn, Virginia
- **WNAM** (wnam.cdn.deensubs.com) — Los Angeles
- **APAC** (apac.cdn.deensubs.com) — Tokyo
- **OC** (oc.cdn.deensubs.com) — Sydney

Routing: hashmap for small countries, haversine distance for large countries (US, IN, RU, CN, BR, CA, ID).

## Image Serving

All thumbnails served as AVIF via `/img/*` route with 3-tier cache:
1. **CF Edge Cache** (Cache API) — ~5ms
2. **Workers KV** (MEDIA_KV) — ~10-50ms
3. **R2 fallback** — lazy-populates KV on miss

Thumbnail sizes: 320w, 480w, 640w AVIF. Scholar photos: lossless AVIF (quality 100).

## Caching Strategy

- **KV data cache**: Stale-while-revalidate. Data lives 30 days in KV, refreshes in background via `waitUntil()` when stale (5min–24hr depending on data type).
- **Edge cache**: Cache API for /img/* responses (immutable, 1 year).
- **Service Worker**: Auto-versioned per deploy. Cache-first for fonts/images, network-first for HTML with offline fallback.

## Database Schema

### Key Tables
- `videos` — id, title, slug, description, video_key, srt_key, srt_ar_key, thumb_key, youtube_id, duration, views, likes, scholar_id, category_id, enabled
- `scholars` — id, name, slug, title, bio, photo, name_ar
- `categories` — id, name, slug, color, name_ar
- `comments` — id, video_id, author, content, user_id, created_at
- `users` — id, name, email, avatar, role, google_id

### Important
- `enabled` column on videos: set to 0 to hide from all public pages
- `VIDEO_JOIN` in db.js includes `WHERE v.enabled = 1` — all public queries auto-filter
- FTS triggers (`videos_ai`, `videos_ad`) must exist for search. Recreate if dropped.

## Build System

`build.js` runs before every deploy (configured in wrangler.toml `[build]`):
- Minifies CSS → `.min.css`
- Minifies JS → `.min.txt` (strips console/debugger, targets modern browsers)
- Generates build version hash → `build-version.txt` (used by service worker)

Templates import `.min.*` versions. Source files stay readable.

## Maintenance Mode

Controlled by `MAINTENANCE_PASS` Cloudflare secret:
- **Enable**: `echo "password" | npx wrangler secret put MAINTENANCE_PASS`
- **Disable**: `npx wrangler secret delete MAINTENANCE_PASS` then `npx wrangler deploy`

When active, all pages show a password gate. Correct password sets a 24hr cookie.

## Secrets (Cloudflare Worker Secrets)

Set via `echo "value" | npx wrangler secret put NAME`:

| Secret | Purpose |
|---|---|
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `ADMIN_KEY` | API key for admin panel access |
| `AI_API_KEY` | AI API key for subtitle/description generation |
| `AI_BASE_URL` | AI API base URL |
| `CF_ACCOUNT_ID` | Cloudflare account ID (for Analytics Engine) |
| `CF_API_TOKEN` | Cloudflare API token (for Analytics Engine queries) |
| `MAINTENANCE_PASS` | Site password (remove secret to disable) |

## R2 S3 API Access

For uploading large files (>300MB) via `aws s3 cp`:
```bash
export AWS_ACCESS_KEY_ID=50680a772ef98b20905ae19b33fe3604
export AWS_SECRET_ACCESS_KEY=f99b564f923ccd2fe8e06f91468f1517fd8151f6d6c577c918e1e3dfe7cd62a3
export R2_ENDPOINT=https://a04f68eb4a3c42642bb23718c532d0b4.r2.cloudflarestorage.com

aws s3 cp video.mp4 s3://deensubs-media-weur/videos/slug.mp4 --endpoint-url $R2_ENDPOINT
```

## Common Operations

### Deploy
```bash
npx wrangler deploy
```

### Add a video
1. Convert to MP4 (H.264 + AAC + faststart): `ffmpeg -i input.mkv -c:v copy -c:a aac -b:a 128k -movflags +faststart output.mp4`
2. Generate AVIF thumbnails (320w, 480w, 640w): `ffmpeg -i thumb.jpg -vf scale=640:-1 -c:v libaom-av1 -crf 30 -still-picture 1 slug-640w.avif`
3. Upload to R2: video to WEUR, SRTs + thumbnails to all 6 buckets
4. Insert into D1: `INSERT INTO videos (title, slug, ..., enabled) VALUES (..., 1)`
5. Clear KV cache: `echo "y" | npx wrangler kv key delete "home" --namespace-id=c025d769b8584d02aedcdaca9ba9edc0 --remote`

### Toggle video visibility
```bash
npx wrangler d1 execute deensubs-db-weur --remote --command "UPDATE videos SET enabled = 0 WHERE slug = 'slug-here'"
```

### Purge CDN cache
Cloudflare Dashboard → deensubs.com → Caching → Configuration → Purge Everything

### Clear KV data cache
```bash
echo "y" | npx wrangler kv key delete "home" --namespace-id=c025d769b8584d02aedcdaca9ba9edc0 --remote
```

## Performance Benchmarks

- Median TTFB: 38ms globally (63 cities)
- Lighthouse: 99 mobile / 100 desktop
- Compressed page size: ~22KB (Brotli)
- Image serving: ~5ms from edge cache
