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
import type { YtFormat } from './ytbrowser';
import { videoIdOf } from './ytdl';

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

const CDN_BASE = 'https://cdn.deensubs.com';

/** Mux a video-only + audio-only pair (already in R2, served via CDN) into one
 *  MP4 using the container's ffmpeg — it fetches from R2/CDN (fast, no throttle),
 *  never from googlevideo. Streams the merged result back into R2. */
export async function muxViaContainer(env: ScribeEnv, jobId: string, videoKey: string, audioKey: string): Promise<{ key: string; bytes: number; contentType: string }> {
  if (!env.YTDLP) throw new Error('mux container binding not configured');
  const { getContainer } = await import('@cloudflare/containers');
  const container = getContainer(env.YTDLP as any, poolName(jobId));
  const auth = { Authorization: 'Bearer ' + (env.YTDLP_TOKEN || 'internal') };
  const call = (path: string, init?: RequestInit) =>
    container.fetch(new Request('http://ytdlp' + path, { ...init, headers: { ...auth, ...(init?.headers as any) } }));

  const start = await call('/mux', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ video_url: `${CDN_BASE}/${videoKey}`, audio_url: `${CDN_BASE}/${audioKey}` }),
  });
  if (!start.ok) throw new Error(`mux start failed: HTTP ${start.status} ${await start.text().catch(() => '')}`);
  const { id } = (await start.json()) as { id: string };

  let info: any = null;
  for (let i = 0; i < 240; i++) {
    if (i) await new Promise((r) => setTimeout(r, i < 10 ? 400 : i < 30 ? 1000 : 2000));
    const st = await call(`/jobs/${id}`).catch(() => null);
    if (!st || !st.ok) continue;
    info = await st.json();
    if (info.status === 'done') break;
    if (info.status === 'error') throw new Error('mux failed: ' + (info.error || 'unknown'));
  }
  if (!info || info.status !== 'done') throw new Error('mux timed out');

  const file = await call(`/files/${id}`);
  if (!file.ok || !file.body) throw new Error(`mux file fetch failed: HTTP ${file.status}`);
  const ct = file.headers.get('content-type') || 'video/mp4';
  const key = `scribe/${jobId}/source.mp4`;
  const bytes = await streamToR2(env.MEDIA_BUCKET, key, file.body, ct);
  call(`/files/${id}`, { method: 'DELETE' }).catch(() => {});
  return { key, bytes, contentType: ct };
}

/**
 * Which container instance a job should use.
 *
 * getContainer(binding, jobId) gives every job its own instance, so every
 * download paid a container cold start before yt-dlp had fetched a single byte
 * — which is most of what a short video's "download" time actually was.
 * Hashing the job into a fixed set of slots keeps instances warm and reused
 * while still allowing this many downloads at once. The pool sits under the
 * binding's max_instances so clip and thumbnail containers keep their room.
 */
const DL_POOL = 24;
export function poolName(jobId: string): string {
  let h = 0;
  for (let i = 0; i < jobId.length; i++) h = (h * 31 + jobId.charCodeAt(i)) >>> 0;
  return `dl-${h % DL_POOL}`;
}

/** Primary path: the container runs yt-dlp from its own datacenter IP (no
    proxies, no browser). android_vr extraction works direct; the bytes are
    pulled with parallel 4 MB byte-ranges (~290 MB/s, c=48) that finish inside
    googlevideo's per-connection burst window, then muxed with ffmpeg. */
export async function ytdlpViaContainer(env: ScribeEnv, jobId: string, url: string, fullVideo = false): Promise<DownloadResult> {
  if (!env.YTDLP) throw new Error('container binding not configured');
  const { getContainer } = await import('@cloudflare/containers');
  const container = getContainer(env.YTDLP as any, poolName(jobId));
  const auth = { Authorization: 'Bearer ' + (env.YTDLP_TOKEN || 'internal') };
  const call = (path: string, init?: RequestInit) =>
    container.fetch(new Request('http://ytdlp' + path, { ...init, headers: { ...auth, ...(init?.headers as any) } }));

  const start = await call('/download', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url, video: fullVideo,
      // measured A/B: default web client 403s the media fetch from the
      // container IP; android_vr URLs are honored, with or without aria2c
      aria2: (env as any).__ARIA2 ?? true,
      player_client: (env as any).__PLAYER_CLIENT ?? 'android_vr',
    }),
  });
  if (!start.ok) throw new Error(`ytdlp start failed: HTTP ${start.status}`);
  const { id } = (await start.json()) as { id: string };

  let info: any = null;
  for (let i = 0; i < 1200; i++) {
    // Ask first, wait second, and wait less at the start. The old loop slept a
    // flat 1.5s before its first question, so a short clip that finished in two
    // seconds still reported closer to four.
    if (i) await new Promise((r) => setTimeout(r, i < 10 ? 400 : i < 30 ? 1000 : 2000));
    const st = await call(`/jobs/${id}`).catch(() => null);
    if (!st || !st.ok) continue;
    info = await st.json();
    if (info.status === 'done') break;
    if (info.status === 'error') throw new Error('ytdlp failed: ' + (info.error || 'unknown'));
  }
  if (!info || info.status !== 'done') throw new Error('ytdlp timed out');

  const file = await call(`/files/${id}`);
  if (!file.ok || !file.body) throw new Error(`ytdlp file fetch failed: HTTP ${file.status}`);
  const ct = file.headers.get('content-type') || (fullVideo ? 'video/mp4' : 'audio/mp4');
  const ext = ct.includes('webm') ? (fullVideo ? 'webm' : 'webm')
    : ct.startsWith('audio/') ? 'm4a' : 'mp4';
  const key = `scribe/${jobId}/source.${ext}`;
  const bytes = await streamToR2(env.MEDIA_BUCKET, key, file.body, ct);
  call(`/files/${id}`, { method: 'DELETE' }).catch(() => {});
  return {
    key, method: 'ytdlp' as any, contentType: ct, bytes,
    title: info.title, channel: info.channel || info.uploader,
    thumbUrl: info.thumbnail, durationSec: info.duration || 0,
  } as any;
}

/** Primary path: mint direct URLs with Browser Rendering, range-stream to R2. */
async function browserDownload(env: ScribeEnv, jobId: string, url: string, fullVideo = false): Promise<DownloadResult> {
  const yt = await import('./ytbrowser');
  const { videoId } = yt.parseYouTube(url);
  if (!videoId) throw new Error('could not parse a YouTube video id from the URL');

  const m = await yt.browserMintCached(env, videoId);
  const writePct = pctWriter(env, jobId);

  const streamFmt = async (f: YtFormat, key: string, onPct?: (b: number) => void): Promise<{ bytes: number; ct: string }> => {
    const clen = f.clen ?? (await yt.discoverLength(f.url));
    if (!clen) throw new Error(`itag ${f.itag}: no content length`);
    const ct = (f.mime || '').split(';')[0] || 'application/octet-stream';
    const bytes = await streamToR2(env.MEDIA_BUCKET, key, yt.rangeStream(f.url, clen), ct, onPct);
    if (bytes < 10_000) throw new Error(`itag ${f.itag}: too small (${bytes} bytes)`);
    return { bytes, ct };
  };

  const meta = {
    title: m.title, channel: m.channel, channelId: m.channelId, ytId: m.videoId,
    description: m.description, thumbUrl: m.thumbUrl, durationSec: m.durationSec, fourK: m.fourK,
  };

  if (!fullVideo) {
    const a = m.audio[0];
    if (!a) throw new Error('no audio format available');
    const ext = a.mime.includes('webm') || a.mime.includes('opus') ? 'webm' : 'm4a';
    const key = `scribe/${jobId}/source.${ext}`;
    const { bytes, ct } = await streamFmt(a, key, a.clen ? (b) => writePct((b / (a.clen as number)) * 100) : undefined);
    return { key, method: 'browser', contentType: ct, bytes, ...meta };
  }

  // Full video: best video-only + best audio-only, then mux (container from R2/CDN).
  const v = m.video[0];
  const a = m.audio[0];
  if (!v || !a) {
    // fall back to a progressive muxed format if adaptive is unavailable
    const p = m.progressive[0];
    if (!p) throw new Error('no downloadable video format available');
    const key = `scribe/${jobId}/source.mp4`;
    const { bytes, ct } = await streamFmt(p, key);
    return { key, method: 'browser', contentType: ct, bytes, ...meta };
  }
  const videoKey = `scribe/${jobId}/video.${v.mime.includes('webm') ? 'webm' : 'mp4'}`;
  const audioKey = `scribe/${jobId}/audio.${a.mime.includes('webm') || a.mime.includes('opus') ? 'webm' : 'm4a'}`;
  const [vTotal, aTotal] = await Promise.all([
    v.clen ?? yt.discoverLength(v.url),
    a.clen ?? yt.discoverLength(a.url),
  ]);
  const grand = vTotal + aTotal;
  let vDone = 0, aDone = 0;
  const [, av] = await Promise.all([
    streamFmt(v, videoKey, grand ? (b) => { vDone = b; writePct(((vDone + aDone) / grand) * 100); } : undefined),
    streamFmt(a, audioKey, grand ? (b) => { aDone = b; writePct(((vDone + aDone) / grand) * 100); } : undefined),
  ]);
  const merged = await muxViaContainer(env, jobId, videoKey, audioKey);
  // tidy the intermediate streams
  env.MEDIA_BUCKET.delete(videoKey).catch(() => {});
  env.MEDIA_BUCKET.delete(audioKey).catch(() => {});
  return { key: merged.key, method: 'browser', contentType: merged.contentType, bytes: merged.bytes, videoKey, audioKey, ...meta };
}

/** Audio-first: stream just the audio track (seconds, not minutes) so ASR can
    start immediately while the full video + mux completes in the background. */
export async function downloadAudioOnly(env: ScribeEnv, jobId: string, url: string): Promise<{ key: string; durationSec: number }> {
  const yt = await import('./ytbrowser');
  const { videoId } = yt.parseYouTube(url);
  if (!videoId) throw new Error('could not parse a YouTube video id from the URL');
  for (const ext of ['m4a', 'webm']) {
    const k = `scribe/${jobId}/audio-first.${ext}`;
    const h = await env.MEDIA_BUCKET.head(k);
    if (h && h.size > 10_000) return { key: k, durationSec: 0 };
  }
  // Worker-native first: extract via proxy, range-download direct (no browser).
  try {
    const { ytdlAudioFirst } = await import('./ytdl');
    return await ytdlAudioFirst(env, jobId, url);
  } catch (e: any) {
    console.log('ytdl audio-first failed, falling back to Browser Rendering: ' + (e?.message || e));
  }
  const m = await yt.browserMintCached(env, videoId);
  const a = m.audio[0];
  if (!a) throw new Error('no audio format available');
  const ext = a.mime.includes('webm') || a.mime.includes('opus') ? 'webm' : 'm4a';
  const key = `scribe/${jobId}/audio-first.${ext}`;
  const clen = a.clen ?? (await yt.discoverLength(a.url));
  if (!clen) throw new Error('audio: no content length');
  const ct = (a.mime || '').split(';')[0] || 'audio/mp4';
  const bytes = await streamToR2(env.MEDIA_BUCKET, key, yt.rangeStream(a.url, clen), ct);
  if (bytes < 10_000) throw new Error(`audio too small (${bytes} bytes)`);
  return { key, durationSec: m.durationSec || 0 };
}

/** YouTube URLs bot-wall datacenter fetches — download via Browser Rendering. */
export function needsBrowser(url: string): boolean {
  return /(youtube\.com|youtu\.be)\//i.test(url);
}

export async function download(env: ScribeEnv, jobId: string, url: string, fullVideo = false): Promise<DownloadResult> {
  // YouTube → container yt-dlp (primary): android_vr extract + parallel
  // byte-ranges (~290 MB/s), extracts AND muxes on its own datacenter IP, no
  // browser, no proxies. Browser Rendering is the fallback (client changes,
  // rare extraction failures). Others → edge fetch.
  if (needsBrowser(url)) {
    // YouTube: Worker-native — extract via a residential proxy (bot wall), then
    // range-download the direct URLs from the Worker (no browser). Audio jobs are
    // fully container-free; full-video downloads video+audio in the Worker and
    // uses the container only to REMUX (stream-copy, no re-encode). Fallbacks:
    // container download, then Browser Rendering.
    if (videoIdOf(url)) {
      // 1. proxy extraction + Worker download (fast path)
      try {
        const ytdl = await import('./ytdl');
        return fullVideo
          ? await ytdl.ytdlFullVideoWorkerNative(env, jobId, url)
          : await ytdl.ytdlWorkerNative(env, jobId, url);
      } catch (e: any) {
        console.log('ytdl proxy extraction failed, trying Browser Rendering: ' + (e?.message || e));
      }
      // 2. Browser Rendering — proxy-free (a real Chrome session passes the bot
      //    wall from the datacenter IP); still Worker-downloaded bytes.
      try {
        return await browserDownload(env, jobId, url, fullVideo);
      } catch (e: any) {
        console.log('Browser Rendering failed, trying container: ' + (e?.message || e));
      }
    }
    // 3. container yt-dlp (last resort)
    try {
      return await ytdlpViaContainer(env, jobId, url, fullVideo);
    } catch (e: any) {
      return await browserDownload(env, jobId, url, fullVideo);
    }
  }
  return directDownload(env, jobId, url);
}
