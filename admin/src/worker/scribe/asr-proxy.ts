// Unauthenticated ElevenLabs STT through SOCKS5 proxies (residential IPs),
// entirely Worker-native via cloudflare:sockets.
//
// Why: the unauthenticated endpoint (allow_unauthenticated=1) is rate-limited
// per source IP. A Cloudflare Worker's own egress is datacenter/flagged, so we
// tunnel the request through a residential SOCKS5 proxy. The request body is a
// tiny source_url (ElevenLabs fetches the audio from R2 itself), so only the
// control connection rides the proxy. Webhooks aren't available unauthenticated,
// so the transcript is read straight from the synchronous response.
//
// The catch: cloudflare:sockets' startTls() sends the SNI of the connect() host
// (the proxy) and can't override it (expectedServerHostname only affects cert
// validation, verified empirically), so Google-fronted api.elevenlabs.io rejects
// the mismatched SNI. So we do the TLS ourselves: a raw ('off') socket to the
// proxy, a plaintext SOCKS5 CONNECT to api.elevenlabs.io:443, then a hand-rolled
// TLS 1.3 client (tls13.ts) over the tunnel where WE set the SNI.
//
// Flow per chunk: container splits audio → chunk to R2 → Worker leases quota
// (WS coordinator) → SOCKS5+TLS1.3 POST source_url → merge. Quota across the
// proxies is coordinated over a WebSocket (best-effort).

import { connect } from 'cloudflare:sockets';
import { streamToR2 } from './download';
import { containerCall } from './asr';
import { Tls13 } from './tls13';

/** Race a promise against a timeout so a hung proxy socket can never stall a
 *  chunk for hours. A timeout is flagged rateLimited so the loop tries the next
 *  proxy. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(Object.assign(new Error(`${label} timed out after ${ms}ms`), { rateLimited: true })), ms)),
  ]);
}
import type { AsrConfig } from './asr-config';
import type { ScribeEnv, Word } from './types';

const CDN_BASE = 'https://cdn.deensubs.com';
const STT_HOST = 'api.elevenlabs.io';
const STT_PATH = '/v1/speech-to-text?allow_unauthenticated=1';

// ---- SOCKS proxy parsing (nic identity) -----------------------------------

type Proxy = { host: string; port: number; user?: string; pass?: string };

function parseProxy(url: string): Proxy {
  // socks5:// and socks5h:// are equivalent for us — we always CONNECT by
  // domain (ATYP 0x03), so the proxy resolves the hostname either way.
  const m = url.trim().match(/^socks(?:5h?|4)?:\/\/(?:([^:@\/]+):([^@\/]+)@)?([^:\/]+):(\d+)\/?$/i);
  if (!m) throw new Error('bad SOCKS proxy url (want socks5[h]://[user:pass@]host:port): ' + url);
  return { user: m[1], pass: m[2], host: m[3], port: parseInt(m[4], 10) };
}

/** Replace a `{SESSION}` placeholder with a fresh random id so each request
 *  lands on a new SpyderProxy sticky session (a new residential IP). Rotating or
 *  fixed URLs (no placeholder) are returned unchanged. */
export function freshSession(url: string): string {
  return url.replace(/\{SESSION\}/gi, () => crypto.randomUUID().replace(/-/g, '').slice(0, 12));
}

// ---- SOCKS5 handshake (plaintext, over a raw socket) ----------------------

/** SOCKS5 CONNECT to destHost:destPort over an already-open raw socket's
 *  reader/writer. Returns any bytes read past the CONNECT reply (to seed the
 *  TLS layer — normally empty, since we send the TLS ClientHello first). */
async function socks5Connect(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  proxy: Proxy, destHost: string, destPort: number,
): Promise<Uint8Array> {
  let buf = new Uint8Array(0);
  const merge = (a: Uint8Array, b: Uint8Array) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };
  const need = async (n: number) => { while (buf.length < n) { const { done, value } = await reader.read(); if (done) throw new Error('socks: closed'); buf = merge(buf, value); } };
  const take = (n: number) => { const out = buf.slice(0, n); buf = buf.slice(n); return out; };
  const enc = new TextEncoder();

  const methods = proxy.user ? [0x00, 0x02] : [0x00];
  await writer.write(new Uint8Array([0x05, methods.length, ...methods]));
  await need(2); const g = take(2);
  if (g[0] !== 0x05) throw new Error('socks: not v5');
  if (g[1] === 0x02) {
    const u = enc.encode(proxy.user || ''); const p = enc.encode(proxy.pass || '');
    await writer.write(new Uint8Array([0x01, u.length, ...u, p.length, ...p]));
    await need(2); if (take(2)[1] !== 0x00) throw new Error('socks: auth rejected');
  } else if (g[1] !== 0x00) throw new Error('socks: no acceptable auth (0x' + g[1].toString(16) + ')');

  const dh = enc.encode(destHost);
  await writer.write(new Uint8Array([0x05, 0x01, 0x00, 0x03, dh.length, ...dh, (destPort >> 8) & 0xff, destPort & 0xff]));
  await need(4); const r = take(4);
  if (r[1] !== 0x00) throw new Error('socks: CONNECT failed (reply 0x' + r[1].toString(16) + ')');
  const alen = r[3] === 0x01 ? 4 : r[3] === 0x04 ? 16 : (await need(1), take(1)[0]);
  await need(alen + 2); take(alen + 2); // drain BND.ADDR + BND.PORT
  return buf;
}

// ---- HTTP/1.1 over the TLS 1.3 socket -------------------------------------

function multipart(fields: Record<string, string>): { body: Uint8Array; contentType: string } {
  const boundary = '----DeenSubs' + crypto.randomUUID().replace(/-/g, '');
  const e = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(e.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(e.encode(`--${boundary}--\r\n`));
  let len = 0; for (const p of parts) len += p.length;
  const body = new Uint8Array(len);
  let off = 0; for (const p of parts) { body.set(p, off); off += p.length; }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let len = 0; for (const c of chunks) len += c.length;
  const out = new Uint8Array(len);
  let off = 0; for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function dechunk(a: Uint8Array): Uint8Array {
  const out: Uint8Array[] = []; let i = 0;
  while (i < a.length) {
    let j = i; while (j + 1 < a.length && !(a[j] === 13 && a[j + 1] === 10)) j++;
    const size = parseInt(new TextDecoder().decode(a.slice(i, j)).trim(), 16);
    if (!size || Number.isNaN(size)) break;
    out.push(a.slice(j + 2, j + 2 + size)); i = j + 2 + size + 2;
  }
  return concat(out);
}

function parseHttp(raw: Uint8Array): { status: number; body: string } {
  let sep = -1;
  for (let i = 0; i + 3 < raw.length; i++) if (raw[i] === 13 && raw[i + 1] === 10 && raw[i + 2] === 13 && raw[i + 3] === 10) { sep = i; break; }
  if (sep < 0) throw new Error('http: no header terminator');
  const head = new TextDecoder().decode(raw.slice(0, sep));
  const status = parseInt(head.split('\r\n')[0].split(' ')[1] || '0', 10);
  const chunked = /transfer-encoding:\s*chunked/i.test(head);
  const body = raw.slice(sep + 4);
  return { status, body: new TextDecoder().decode(chunked ? dechunk(body) : body) };
}

/** One transcription request through a proxy: raw socket → SOCKS5 CONNECT →
 *  Worker-native TLS 1.3 (correct SNI) → HTTP POST source_url → parse. */
async function proxyStt(proxyUrl: string, sourceUrl: string): Promise<any> {
  const proxy = parseProxy(proxyUrl);
  const socket = connect({ hostname: proxy.host, port: proxy.port }, { secureTransport: 'off', allowHalfOpen: false });
  await socket.opened;
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  try {
    const leftover = await socks5Connect(reader, writer, proxy, STT_HOST, 443);
    const tls = new Tls13(reader, writer, STT_HOST, leftover);
    await tls.handshake();

    const { body, contentType } = multipart({
      model_id: 'scribe_v2', source_url: sourceUrl, diarize: 'true',
      timestamps_granularity: 'character', tag_audio_events: 'true',
    });
    const head =
      `POST ${STT_PATH} HTTP/1.1\r\nHost: ${STT_HOST}\r\nConnection: close\r\naccept: */*\r\n` +
      `origin: https://elevenlabs.io\r\nreferer: https://elevenlabs.io/\r\n` +
      `user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36\r\n` +
      `content-type: ${contentType}\r\ncontent-length: ${body.length}\r\n\r\n`;
    await tls.write(concat([new TextEncoder().encode(head), body]));

    const chunks: Uint8Array[] = [];
    for (;;) { const c = await tls.read(); if (c === null) break; chunks.push(c); }
    const { status, body: text } = parseHttp(concat(chunks));
    if (status !== 200) {
      const rateLimited = status === 429 || status === 401 || /rate limit|quota|too many/i.test(text);
      const err: any = new Error(`ElevenLabs unauth STT HTTP ${status}: ${text.slice(0, 160)}`);
      err.rateLimited = rateLimited;
      throw err;
    }
    return JSON.parse(text);
  } finally {
    try { await socket.close(); } catch {}
  }
}

// ---- chunked orchestration ------------------------------------------------
// No quota coordinator: SpyderProxy issues a fresh residential IP per session,
// so there is no shared per-IP quota to coordinate (each attempt regenerates the
// session id via freshSession()).

/** Split (container) → transcribe each chunk through a proxy → merge. */
export async function proxyChunkedAsr(env: ScribeEnv, jobId: string, sourceKey: string, cfg: AsrConfig): Promise<any> {
  const chunkSec = Math.round(cfg.chunkMinutes * 60);
  const cName = 'split-' + jobId;
  const start = await containerCall(env, cName, '/split', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `${CDN_BASE}/${sourceKey}`, seconds: chunkSec }),
  });
  if (!start.ok) throw new Error(`split start failed: HTTP ${start.status}`);
  const { id } = (await start.json()) as { id: string };
  let info: any = null;
  for (let i = 0; i < 240; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await containerCall(env, cName, `/jobs/${id}`).catch(() => null);
    info = st?.ok ? await st.json() : info;
    if (info?.status === 'done' || info?.status === 'error') break;
  }
  if (info?.status !== 'done') throw new Error('split failed: ' + (info?.error || 'timeout'));

  const names: string[] = info.names || [];
  const durations: number[] = info.durations || [];
  const offsets: number[] = [];
  let acc = 0;
  for (let n = 0; n < names.length; n++) { offsets.push(acc); acc += durations[n] || chunkSec; }

  const proxies = cfg.proxies;
  if (!proxies.length) throw new Error('proxy ASR selected but no proxies are configured');

  // Each segment is transcribed through a rotating residential proxy. Every
  // attempt regenerates the proxy session ({SESSION} → fresh id), landing on a
  // NEW residential IP, so a rate-limited/flagged IP is simply replaced. No
  // quota coordinator: SpyderProxy hands out a fresh IP per session, so there is
  // no shared per-IP quota to coordinate.
  const results = await Promise.all(names.map(async (name, n) => {
    const segKey = `scribe/${jobId}/asr-seg-${n}.json`;
    const cached = await env.MEDIA_BUCKET.get(segKey);
    if (cached) return { n, data: (await cached.json()) as any };
    const file = await containerCall(env, cName, `/files/${id}?name=${name}`);
    if (!file.ok || !file.body) throw new Error(`segment fetch failed: ${name}`);
    const chunkKey = `scribe/${jobId}/${name}`;
    await streamToR2(env.MEDIA_BUCKET, chunkKey, file.body, 'audio/mp4');
    const chunkUrl = `${CDN_BASE}/${chunkKey}`;

    let data: any = null;
    let lastErr = '';
    const maxAttempts = Math.max(6, proxies.length * 2);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const proxyUrl = freshSession(proxies[attempt % proxies.length]);
      try {
        data = await withTimeout(proxyStt(proxyUrl, chunkUrl), 190_000, 'proxy STT');
        if (data?.words?.length || data?.text) break;
        lastErr = 'empty transcript';
      } catch (e: any) {
        lastErr = String(e?.message || e);
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    // No authenticated fallback: the API key is ONLY the whole-file authenticated
    // path (never a chunk). Proxy mode is proxy-only.
    if (!data || !(data.words?.length || data.text)) throw new Error(`segment ${n} failed via all proxies: ${lastErr}`);
    await env.MEDIA_BUCKET.put(segKey, JSON.stringify(data), { httpMetadata: { contentType: 'application/json' } });
    await env.MEDIA_BUCKET.delete(chunkKey).catch(() => {});
    return { n, data };
  }));

  // merge word timelines with per-segment offsets (deterministic order)
  const allWords: Word[] = [];
  let text = '';
  let languageCode = '';
  for (const { n, data } of results.sort((a, b) => a.n - b.n)) {
    if (!languageCode) languageCode = data.language_code || '';
    text += (text ? ' ' : '') + (data.text || '');
    for (const w of (data.words || []) as Word[]) {
      allWords.push({ ...w, start: (w.start || 0) + offsets[n], end: (w.end || 0) + offsets[n] });
    }
  }
  containerCall(env, cName, `/files/${id}`, { method: 'DELETE' }).catch(() => {});
  for (let n = 0; n < names.length; n++) env.MEDIA_BUCKET.delete(`scribe/${jobId}/asr-seg-${n}.json`).catch(() => {});
  return { language_code: languageCode, text, words: allWords, audio_duration_secs: acc };
}
