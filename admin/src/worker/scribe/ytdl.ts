// Worker-native YouTube audio download (no container, no browser rendering).
//
// Extraction: a Cloudflare Worker's own fetch is bot-walled by YouTube
// (LOGIN_REQUIRED; a minted poToken does NOT fix it — the wall is the datacenter
// egress/session, confirmed empirically). So the watch-page + android_vr /player
// extraction runs through a residential SOCKS5 proxy via the hand-rolled TLS 1.3
// client (tls13.ts). android_vr returns direct, un-gated googlevideo URLs (no
// signature deciphering, no poToken).
//
// Download: the googlevideo URL is NOT IP-gated, so the bytes are pulled DIRECT
// from the Worker in parallel 4MB ranges (c up to 48) — small ranges finish
// inside googlevideo's per-connection burst window, defeating the throttle —
// straight into R2 via multipart. No proxy bandwidth for the media.

import { connect } from 'cloudflare:sockets';
import { Tls13 } from './tls13';
import { getAsrConfig } from './asr-config';
import type { DownloadResult, ScribeEnv } from './types';

const enc = new TextEncoder();
const AVR_UA = 'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip';
const WEB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const VD_KV_KEY = 'yt:session';

function concat(a: Uint8Array[]): Uint8Array { let n = 0; for (const x of a) n += x.length; const o = new Uint8Array(n); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; }

export function videoIdOf(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

// ---- SOCKS5 + HTTPS via the Worker-native TLS client ----------------------
type Proxy = { host: string; port: number; user?: string; pass?: string };
function parseProxy(url: string): Proxy {
  const m = url.trim().match(/^socks(?:5h?|4)?:\/\/(?:([^:@\/]+):([^@\/]+)@)?([^:\/]+):(\d+)\/?$/i);
  if (!m) throw new Error('bad SOCKS url: ' + url);
  return { user: m[1], pass: m[2], host: m[3], port: parseInt(m[4], 10) };
}
async function socks5Connect(reader: ReadableStreamDefaultReader<Uint8Array>, writer: WritableStreamDefaultWriter<Uint8Array>, proxy: Proxy, host: string, port: number): Promise<Uint8Array> {
  let buf: Uint8Array = new Uint8Array(0);
  const need = async (n: number) => { while (buf.length < n) { const { done, value } = await reader.read(); if (done) throw new Error('socks closed'); buf = concat([buf, value]); } };
  const take = (n: number) => { const o = buf.slice(0, n); buf = buf.slice(n); return o; };
  const methods = proxy.user ? [0x00, 0x02] : [0x00];
  await writer.write(new Uint8Array([0x05, methods.length, ...methods]));
  await need(2); const g = take(2);
  if (g[0] !== 0x05) throw new Error('not socks5');
  if (g[1] === 0x02) { const u = enc.encode(proxy.user || ''); const p = enc.encode(proxy.pass || ''); await writer.write(new Uint8Array([0x01, u.length, ...u, p.length, ...p])); await need(2); if (take(2)[1] !== 0x00) throw new Error('auth rejected'); }
  else if (g[1] !== 0x00) throw new Error('no acceptable auth');
  const dh = enc.encode(host);
  await writer.write(new Uint8Array([0x05, 0x01, 0x00, 0x03, dh.length, ...dh, (port >> 8) & 0xff, port & 0xff]));
  await need(4); const r = take(4);
  if (r[1] !== 0x00) throw new Error('CONNECT failed 0x' + r[1].toString(16));
  const alen = r[3] === 0x01 ? 4 : r[3] === 0x04 ? 16 : (await need(1), take(1)[0]);
  await need(alen + 2); take(alen + 2);
  return buf;
}
function dechunk(a: Uint8Array): Uint8Array {
  const out: Uint8Array[] = []; let i = 0;
  while (i < a.length) { let j = i; while (j + 1 < a.length && !(a[j] === 13 && a[j + 1] === 10)) j++; const size = parseInt(new TextDecoder().decode(a.slice(i, j)).trim(), 16); if (!size || Number.isNaN(size)) break; out.push(a.slice(j + 2, j + 2 + size)); i = j + 2 + size + 2; }
  return concat(out);
}
type HttpResp = { status: number; headers: Record<string, string>; setCookies: string[]; body: string };
function parseHttp(raw: Uint8Array): HttpResp {
  let sep = -1;
  for (let i = 0; i + 3 < raw.length; i++) if (raw[i] === 13 && raw[i + 1] === 10 && raw[i + 2] === 13 && raw[i + 3] === 10) { sep = i; break; }
  if (sep < 0) throw new Error('no header end');
  const lines = new TextDecoder().decode(raw.slice(0, sep)).split('\r\n');
  const status = parseInt(lines[0].split(' ')[1] || '0', 10);
  const headers: Record<string, string> = {}; const setCookies: string[] = [];
  for (let i = 1; i < lines.length; i++) { const idx = lines[i].indexOf(':'); if (idx < 0) continue; const k = lines[i].slice(0, idx).trim().toLowerCase(); const v = lines[i].slice(idx + 1).trim(); if (k === 'set-cookie') setCookies.push(v); else headers[k] = v; }
  const chunked = /chunked/i.test(headers['transfer-encoding'] || '');
  const bodyBytes = chunked ? dechunk(raw.slice(sep + 4)) : raw.slice(sep + 4);
  return { status, headers, setCookies, body: new TextDecoder().decode(bodyBytes) };
}
async function proxyHttps(proxyUrl: string, method: string, urlStr: string, extraHeaders: Record<string, string>, body?: string): Promise<HttpResp> {
  const proxy = parseProxy(proxyUrl);
  const u = new URL(urlStr);
  const socket = connect({ hostname: proxy.host, port: proxy.port }, { secureTransport: 'off', allowHalfOpen: false });
  await socket.opened;
  const reader = socket.readable.getReader(); const writer = socket.writable.getWriter();
  try {
    const leftover = await socks5Connect(reader, writer, proxy, u.hostname, 443);
    const tls = new Tls13(reader, writer, u.hostname, leftover);
    await tls.handshake();
    const bodyBytes = body ? enc.encode(body) : null;
    let head = `${method} ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.hostname}\r\nConnection: close\r\nAccept-Encoding: identity\r\n`;
    for (const [k, v] of Object.entries(extraHeaders)) head += `${k}: ${v}\r\n`;
    if (bodyBytes) head += `Content-Length: ${bodyBytes.length}\r\n`;
    head += '\r\n';
    await tls.write(bodyBytes ? concat([enc.encode(head), bodyBytes]) : enc.encode(head));
    const chunks: Uint8Array[] = [];
    for (;;) { const c = await tls.read(); if (c === null) break; chunks.push(c); }
    return parseHttp(concat(chunks));
  } finally { try { await socket.close(); } catch {} }
}

// ---- extraction (through the proxy) ---------------------------------------
type Session = { visitorData: string; cookies: string };
function cookieHeader(setCookies: string[]): string { return setCookies.map((c) => c.split(';')[0]).filter(Boolean).join('; '); }

/** Warm session (visitorData + cookies) from the watch page, cached in KV for
 *  ~50 min so the heavy page load happens rarely, not per job. */
async function getSession(env: ScribeEnv, proxyUrl: string, videoId: string, force = false): Promise<Session> {
  if (!force) {
    const cached = await (env as any).MEDIA_KV?.get(VD_KV_KEY, 'json').catch(() => null);
    if (cached?.visitorData) return cached as Session;
  }
  const watch = await proxyHttps(proxyUrl, 'GET', `https://www.youtube.com/watch?v=${videoId}&bpctr=9999999999&has_verified=1`,
    { 'User-Agent': WEB_UA, 'Accept-Language': 'en-US,en;q=0.9', 'Cookie': 'SOCS=CAI; PREF=hl=en&tz=UTC' });
  const vm = watch.body.match(/"visitorData":"([^"]+)"/);
  if (!vm) throw new Error(`no visitorData (watch HTTP ${watch.status}, len ${watch.body.length})`);
  const session: Session = { visitorData: vm[1], cookies: ['SOCS=CAI', 'PREF=hl=en&tz=UTC', cookieHeader(watch.setCookies)].filter(Boolean).join('; ') };
  await (env as any).MEDIA_KV?.put(VD_KV_KEY, JSON.stringify(session), { expirationTtl: 3000 }).catch(() => {});
  return session;
}

async function ytPlayer(proxyUrl: string, videoId: string, s: Session): Promise<any> {
  const body = JSON.stringify({
    context: { client: { clientName: 'ANDROID_VR', clientVersion: '1.65.10', deviceMake: 'Oculus', deviceModel: 'Quest 3', androidSdkVersion: 32, userAgent: AVR_UA, osName: 'Android', osVersion: '12L', hl: 'en', timeZone: 'UTC', utcOffsetMinutes: 0, visitorData: s.visitorData } },
    videoId, contentCheckOk: true, racyCheckOk: true,
  });
  const pr = await proxyHttps(proxyUrl, 'POST', 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
    { 'Content-Type': 'application/json', 'User-Agent': AVR_UA, 'X-Youtube-Client-Name': '28', 'X-Youtube-Client-Version': '1.65.10', 'X-Goog-Visitor-Id': s.visitorData, 'Cookie': s.cookies }, body);
  return JSON.parse(pr.body);
}

function pickAudio(player: any): any {
  const fmts = (player.streamingData?.adaptiveFormats || []).filter((f: any) => f.url && (f.mimeType || '').startsWith('audio/'));
  if (!fmts.length) throw new Error('no audio formats with direct URLs');
  const m4a = fmts.filter((f: any) => /mp4a/.test(f.mimeType));
  const pool = m4a.length ? m4a : fmts;
  return pool.reduce((a: any, b: any) => ((b.bitrate || 0) > (a.bitrate || 0) ? b : a));
}

// ---- direct parallel download → R2 multipart ------------------------------
async function fetchRange(url: string, start: number, end: number): Promise<Uint8Array> {
  let tries = 0;
  for (;;) {
    try {
      const r = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
      if (r.status !== 206 && r.status !== 200) throw new Error('range HTTP ' + r.status);
      return new Uint8Array(await r.arrayBuffer());
    } catch (e) { if (++tries >= 5) throw e; await new Promise((res) => setTimeout(res, 250 * tries)); }
  }
}

/** Parallel 4MB ranges assembled into 8MB R2 parts, up to ~20 concurrent range
 *  fetches, bounded memory (~80MB). Reports byte progress. */
async function downloadToR2(bucket: R2Bucket, key: string, url: string, total: number, contentType: string, onBytes?: (n: number) => void): Promise<number> {
  const CHUNK = 4 * 1024 * 1024, PART = 8 * 1024 * 1024, PARTCONC = 10;
  const nParts = Math.ceil(total / PART);
  const mpu = await bucket.createMultipartUpload(key, { httpMetadata: { contentType } });
  const uploaded: R2UploadedPart[] = new Array(nParts);
  let nextPart = 0, done = 0;
  try {
    async function worker() {
      for (;;) {
        const p = nextPart++; if (p >= nParts) return;
        const pStart = p * PART, pEnd = Math.min(pStart + PART, total);
        const subN = Math.ceil((pEnd - pStart) / CHUNK);
        const subs = await Promise.all(Array.from({ length: subN }, (_, s) => fetchRange(url, pStart + s * CHUNK, Math.min(pStart + (s + 1) * CHUNK, pEnd) - 1)));
        const partBytes = concat(subs);
        uploaded[p] = await mpu.uploadPart(p + 1, partBytes);
        done += partBytes.length; onBytes?.(done);
      }
    }
    await Promise.all(Array.from({ length: Math.min(PARTCONC, nParts) }, worker));
    await mpu.complete(uploaded);
    return total;
  } catch (e) { try { await mpu.abort(); } catch {} throw e; }
}

/** Worker-native YouTube AUDIO download. Throws (caller falls back to the
 *  container) if the proxy/config is missing or extraction fails. */
export async function ytdlWorkerNative(env: ScribeEnv, jobId: string, url: string): Promise<DownloadResult> {
  const videoId = videoIdOf(url);
  if (!videoId) throw new Error('not a YouTube video url');
  const cfg = await getAsrConfig(env);
  const proxyUrl = cfg.proxies?.[0];
  if (!proxyUrl) throw new Error('no proxy configured for extraction');

  // extract with a cached session; on LOGIN_REQUIRED refresh the session once
  let player = await ytPlayer(proxyUrl, videoId, await getSession(env, proxyUrl, videoId));
  if (player?.playabilityStatus?.status !== 'OK') {
    player = await ytPlayer(proxyUrl, videoId, await getSession(env, proxyUrl, videoId, true));
  }
  const status = player?.playabilityStatus?.status;
  if (status !== 'OK') throw new Error(`playability ${status}: ${player?.playabilityStatus?.reason || ''}`);

  const a = pickAudio(player);
  const total = parseInt(a.contentLength || '0', 10);
  if (!total) throw new Error('audio format has no contentLength');
  const key = `scribe/${jobId}/source.m4a`;
  const pctWriter = throttledPct(env, jobId, total);
  const bytes = await downloadToR2(env.MEDIA_BUCKET, key, a.url, total, 'audio/mp4', pctWriter);

  const vd = player.videoDetails || {};
  const thumbs = vd.thumbnail?.thumbnails || [];
  return {
    key, method: 'yt-dlp', contentType: 'audio/mp4', bytes,
    title: vd.title, channel: vd.author,
    thumbUrl: thumbs.length ? thumbs[thumbs.length - 1].url : undefined,
    durationSec: parseInt(vd.lengthSeconds || '0', 10),
  };
}

function throttledPct(env: ScribeEnv, jobId: string, total: number): (n: number) => void {
  let last = 0;
  return (n: number) => {
    const pct = Math.round((n / total) * 100);
    if (pct - last < 6 && pct < 99) return;
    last = pct;
    env.DB.prepare('UPDATE scribe_jobs SET download_pct = ? WHERE id = ?').bind(pct, jobId).run().catch(() => {});
  };
}
