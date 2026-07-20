// Step 1: get the media into R2.
//
// Plan A — direct fetch from the Worker (works for plain media URLs and
// anything Cloudflare can reach). Streamed to R2 in 10MB multipart chunks
// so large files never sit in Worker memory.
//
// Plan B — the yt-dlp helper service (VPS) for YouTube and anything that
// blocks datacenter fetches. The service tries a direct download first,
// then retries through the configured SOCKS proxies, extracts audio with
// ffmpeg, and we stream the result into R2 the same way.

import type { DownloadResult, ScribeEnv } from './types';

const PART_SIZE = 10 * 1024 * 1024; // R2 multipart minimum is 5MB per part

/** Stream an HTTP body into R2 via multipart upload. Returns byte count. */
export async function streamToR2(
  bucket: R2Bucket,
  key: string,
  body: ReadableStream<Uint8Array>,
  contentType: string,
  onProgress?: (bytes: number) => void
): Promise<number> {
  const upload = await bucket.createMultipartUpload(key, {
    httpMetadata: { contentType },
  });
  const parts: R2UploadedPart[] = [];
  const reader = body.getReader();
  // Chunk list with single-copy part assembly — naive buffer concatenation
  // is O(n²) memcpy and blows the CPU limit on large files.
  let chunks: Uint8Array[] = [];
  let size = 0;
  let partNumber = 1;
  let total = 0;

  const takePart = (len: number): Uint8Array => {
    const out = new Uint8Array(len);
    let off = 0;
    while (off < len) {
      const head = chunks[0];
      const need = len - off;
      if (head.length <= need) {
        out.set(head, off);
        off += head.length;
        chunks.shift();
      } else {
        out.set(head.subarray(0, need), off);
        chunks[0] = head.subarray(need);
        off += need;
      }
    }
    size -= len;
    return out;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) {
        chunks.push(value);
        size += value.length;
        total += value.length;
        onProgress?.(total);
      }
      while (size >= PART_SIZE) {
        parts.push(await upload.uploadPart(partNumber++, takePart(PART_SIZE)));
      }
      if (done) break;
    }
    if (size > 0 || parts.length === 0) {
      parts.push(await upload.uploadPart(partNumber++, takePart(size)));
    }
    await upload.complete(parts);
    return total;
  } catch (err) {
    await upload.abort().catch(() => {});
    throw err;
  }
}

function extFromContentType(ct: string, url: string): string {
  if (ct.includes('mp4')) return 'mp4';
  if (ct.includes('webm')) return 'webm';
  if (ct.includes('mpeg')) return 'mp3';
  if (ct.includes('ogg') || ct.includes('opus')) return 'opus';
  if (ct.includes('wav')) return 'wav';
  if (ct.includes('aac') || ct.includes('m4a')) return 'm4a';
  const m = url.split('?')[0].match(/\.(mp4|mkv|webm|mp3|m4a|wav|ogg|opus|flac|mov)$/i);
  return m ? m[1].toLowerCase() : 'bin';
}

/** Throttled download-percent writer (D1). */
function pctWriter(env: ScribeEnv, jobId: string) {
  let last = 0;
  return (pct: number) => {
    if (pct - last < 6 && pct < 99) return;
    last = pct;
    env.DB.prepare('UPDATE scribe_jobs SET download_pct = ? WHERE id = ?')
      .bind(Math.round(pct), jobId).run().catch(() => {});
  };
}

/** Plan A: plain fetch. Throws on anything that is not a media response. */
async function directDownload(env: ScribeEnv, jobId: string, url: string): Promise<DownloadResult> {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
  });
  if (!res.ok) throw new Error(`direct fetch HTTP ${res.status}`);
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('text/html') || ct.includes('application/xhtml')) {
    throw new Error('direct fetch returned an HTML page, not media');
  }
  if (!res.body) throw new Error('direct fetch had no body');
  const contentLength = parseInt(res.headers.get('content-length') || '0');
  const writePct = pctWriter(env, jobId);
  const key = `scribe/${jobId}/source.${extFromContentType(ct, url)}`;
  const bytes = await streamToR2(env.MEDIA_BUCKET, key, res.body, ct || 'application/octet-stream',
    contentLength > 0 ? (b) => writePct((b / contentLength) * 100) : undefined);
  if (bytes < 10_000) throw new Error(`direct fetch too small (${bytes} bytes) — likely not real media`);
  return { key, method: 'direct', contentType: ct, bytes };
}

/** Cookies (cookies.txt) saved from the dashboard, stored in R2 — private
 * per admin (keyed by the job creator), with the legacy shared file as fallback. */
export const COOKIES_KEY = 'scribe/config/cookies.txt';

async function loadCookies(env: ScribeEnv, jobId?: string): Promise<string | null> {
  if (jobId) {
    const row: any = await env.DB.prepare('SELECT created_by FROM scribe_jobs WHERE id = ?').bind(jobId).first().catch(() => null);
    if (row?.created_by != null) {
      const own = await env.MEDIA_BUCKET.get(`scribe/config/cookies-${row.created_by}.txt`);
      if (own) {
        const text = await own.text();
        if (text.trim()) return text;
      }
    }
  }
  const obj = await env.MEDIA_BUCKET.get(COOKIES_KEY);
  if (!obj) return null;
  const text = await obj.text();
  return text.trim() ? text : null;
}

/** Plan B: yt-dlp inside a Cloudflare Container (one instance per job). */
async function ytdlpDownload(env: ScribeEnv, jobId: string, url: string, fullVideo = false): Promise<DownloadResult> {
  if (!env.YTDLP) throw new Error('yt-dlp container binding not configured');
  const { getContainer } = await import('@cloudflare/containers');
  const container = getContainer(env.YTDLP as any, jobId);
  const auth = { Authorization: 'Bearer ' + (env.YTDLP_TOKEN || 'internal') };
  const call = (path: string, init?: RequestInit) =>
    container.fetch(new Request('http://ytdlp' + path, { ...init, headers: { ...auth, ...(init?.headers as any) } }));

  const cookies = await loadCookies(env, jobId);
  const start = await call('/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url, cookies, video: fullVideo,
      proxy: await (await import('../companion')).selectedProxy(env),
    }),
  });
  if (!start.ok) throw new Error(`yt-dlp container start failed: HTTP ${start.status} ${await start.text().catch(() => '')}`);
  const { id } = (await start.json()) as { id: string };

  // Poll until finished (up to 20 minutes), persisting live progress.
  // Transient poll failures are tolerated (a deploy rollout can briefly
  // 500 the instance); a lost in-memory job means the container was
  // replaced mid-download — fail with a clear, retryable message.
  const writePct = pctWriter(env, jobId);
  let info: any = null;
  let misses = 0;
  for (let i = 0; i < 240; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await call(`/jobs/${id}`).catch(() => null);
    if (!st || !st.ok) {
      if (st?.status === 404) throw new Error('container restarted mid-download (likely a deploy) — retry the job');
      if (++misses >= 6) throw new Error(`yt-dlp poll failed ${misses}x in a row (HTTP ${st?.status ?? 'network'})`);
      continue;
    }
    misses = 0;
    info = await st.json();
    if (typeof info.pct === 'number' && info.pct > 0) writePct(info.pct);
    if (info.status === 'done') break;
    if (info.status === 'error') throw new Error('yt-dlp failed: ' + (info.error || 'unknown'));
  }
  if (!info || info.status !== 'done') throw new Error('yt-dlp timed out after 20 minutes');

  const file = await call(`/files/${id}`);
  if (!file.ok || !file.body) throw new Error(`yt-dlp file fetch failed: HTTP ${file.status}`);
  const ct = file.headers.get('content-type') || 'audio/ogg';
  const key = `scribe/${jobId}/source.${info.ext || (fullVideo ? 'mp4' : 'opus')}`;
  const bytes = await streamToR2(env.MEDIA_BUCKET, key, file.body, ct);

  // Best-effort cleanup inside the container (it also self-cleans + sleeps)
  call(`/files/${id}`, { method: 'DELETE' }).catch(() => {});

  return {
    key,
    method: 'yt-dlp',
    contentType: ct,
    bytes,
    title: info.title,
    channel: info.channel,
    thumbUrl: info.thumbnail,
    durationSec: info.duration,
    description: info.description || '',
    channelId: info.channel_id || '',
    ytId: info.vid || '',
    fourK: !!info.four_k,
  };
}

/** Sites where a direct Worker fetch can never yield media — skip straight to yt-dlp. */
export function needsYtdlp(url: string): boolean {
  return /(youtube\.com|youtu\.be|twitter\.com|x\.com|facebook\.com|instagram\.com|tiktok\.com|twitch\.tv|vimeo\.com|dailymotion\.com)\//i.test(url);
}

// Global download slot: the yt-dlp container path funnels through shared
// SOCKS proxies, and parallel jobs hammering the same exits get throttled or
// banned. One job downloads at a time; the rest wait politely in their
// workflow. The lock self-expires after 45 min so a crashed holder never
// wedges the queue (downloads hard-timeout at 30 min).

export async function acquireDownloadSlot(env: ScribeEnv, jobId: string): Promise<boolean> {
  const row: any = await env.DB.prepare(
    `INSERT INTO locks (name, holder, until) VALUES ('download', ?1, unixepoch() + 2700)
     ON CONFLICT(name) DO UPDATE SET holder = ?1, until = unixepoch() + 2700
     WHERE locks.until < unixepoch() OR locks.holder = ?1
     RETURNING holder`
  ).bind(jobId).first().catch(() => null);
  return row?.holder === jobId;
}

export async function releaseDownloadSlot(env: ScribeEnv, jobId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM locks WHERE name = 'download' AND holder = ?")
    .bind(jobId).run().catch(() => {});
}

export async function download(env: ScribeEnv, jobId: string, url: string, fullVideo = false): Promise<DownloadResult> {
  if (needsYtdlp(url)) return ytdlpDownload(env, jobId, url, fullVideo);
  try {
    return await directDownload(env, jobId, url);
  } catch (err: any) {
    // Cloudflare-side download failed — fall back to yt-dlp + proxies
    try {
      return await ytdlpDownload(env, jobId, url, fullVideo);
    } catch (err2: any) {
      throw new Error(`direct: ${err.message}; yt-dlp: ${err2.message}`);
    }
  }
}
