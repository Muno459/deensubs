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
// Flow per chunk: container splits audio → chunk to R2 → SOCKS5 CONNECT to
// api.elevenlabs.io:443 → startTls() → HTTP POST source_url → parse response.
// Quota across the proxies is coordinated over a WebSocket (best-effort).

import { connect } from 'cloudflare:sockets';
import { streamToR2 } from './download';
import { containerCall, authStt } from './asr';

/** Race a promise against a timeout so a hung proxy socket can never stall a
 *  chunk for hours. A timeout is flagged rateLimited so the loop tries the next
 *  proxy (and ultimately the authenticated fallback). */
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

// ---- SOCKS5 ---------------------------------------------------------------

type Proxy = { host: string; port: number; user?: string; pass?: string };

function parseProxy(url: string): Proxy {
  // socks5:// and socks5h:// are equivalent for us — we always CONNECT by
  // domain (ATYP 0x03), so the proxy resolves the hostname either way.
  const m = url.trim().match(/^socks(?:5h?|4)?:\/\/(?:([^:@\/]+):([^@\/]+)@)?([^:\/]+):(\d+)\/?$/i);
  if (!m) throw new Error('bad SOCKS proxy url (want socks5[h]://[user:pass@]host:port): ' + url);
  return { user: m[1], pass: m[2], host: m[3], port: parseInt(m[4], 10) };
}

/** Minimal buffered reader over a ReadableStream<Uint8Array>. */
class Buf {
  private q: Uint8Array = new Uint8Array(0);
  constructor(private reader: ReadableStreamDefaultReader<Uint8Array>) {}
  async readN(n: number): Promise<Uint8Array> {
    while (this.q.length < n) {
      const { done, value } = await this.reader.read();
      if (done) throw new Error('socket closed mid-read');
      const merged = new Uint8Array(this.q.length + value.length);
      merged.set(this.q); merged.set(value, this.q.length);
      this.q = merged;
    }
    const out = this.q.slice(0, n);
    this.q = this.q.slice(n);
    return out;
  }
}

/** Open a TLS tunnel to destHost:destPort THROUGH a SOCKS5 proxy. */
async function socks5Tls(proxy: Proxy, destHost: string, destPort: number): Promise<any> {
  const socket = connect({ hostname: proxy.host, port: proxy.port }, { secureTransport: 'starttls', allowHalfOpen: false });
  await socket.opened;
  const writer = socket.writable.getWriter();
  const buf = new Buf(socket.readable.getReader());
  try {
    // greeting: version 5, offered auth methods
    const methods = proxy.user ? [0x00, 0x02] : [0x00];
    await writer.write(new Uint8Array([0x05, methods.length, ...methods]));
    const g = await buf.readN(2);
    if (g[0] !== 0x05) throw new Error('socks: not v5');
    if (g[1] === 0x02) {
      const u = new TextEncoder().encode(proxy.user || '');
      const p = new TextEncoder().encode(proxy.pass || '');
      await writer.write(new Uint8Array([0x01, u.length, ...u, p.length, ...p]));
      const a = await buf.readN(2);
      if (a[1] !== 0x00) throw new Error('socks: auth rejected');
    } else if (g[1] !== 0x00) {
      throw new Error('socks: no acceptable auth method (0x' + g[1].toString(16) + ')');
    }
    // CONNECT destHost:destPort (ATYP 0x03 = domain)
    const dh = new TextEncoder().encode(destHost);
    await writer.write(new Uint8Array([0x05, 0x01, 0x00, 0x03, dh.length, ...dh, (destPort >> 8) & 0xff, destPort & 0xff]));
    const r = await buf.readN(4);
    if (r[1] !== 0x00) throw new Error('socks: CONNECT failed (reply 0x' + r[1].toString(16) + ')');
    const atyp = r[3];
    const alen = atyp === 0x01 ? 4 : atyp === 0x04 ? 16 : (await buf.readN(1))[0];
    await buf.readN(alen + 2); // drain BND.ADDR + BND.PORT
  } finally {
    writer.releaseLock();
  }
  // the socket now tunnels raw bytes to destHost:destPort — upgrade to TLS.
  // SNI/cert must validate against the DESTINATION (ElevenLabs), not the proxy
  // we dialed, so pin expectedServerHostname to destHost.
  return socket.startTls({ expectedServerHostname: destHost });
}

// ---- HTTP over the TLS socket --------------------------------------------

function multipart(fields: Record<string, string>): { body: Uint8Array; contentType: string } {
  const boundary = '----DeenSubs' + crypto.randomUUID().replace(/-/g, '');
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(enc.encode(`--${boundary}--\r\n`));
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

/** Decode an HTTP/1.1 response (Connection: close) into {status, body}. */
function parseHttp(raw: Uint8Array): { status: number; body: string } {
  const sep = indexOfCRLFCRLF(raw);
  if (sep < 0) throw new Error('http: no header terminator');
  const head = new TextDecoder().decode(raw.slice(0, sep));
  const status = parseInt(head.split('\r\n')[0].split(' ')[1] || '0', 10);
  const chunked = /transfer-encoding:\s*chunked/i.test(head);
  const rest = raw.slice(sep + 4);
  return { status, body: new TextDecoder().decode(chunked ? dechunk(rest) : rest) };
}

function indexOfCRLFCRLF(a: Uint8Array): number {
  for (let i = 0; i + 3 < a.length; i++) {
    if (a[i] === 13 && a[i + 1] === 10 && a[i + 2] === 13 && a[i + 3] === 10) return i;
  }
  return -1;
}

function dechunk(a: Uint8Array): Uint8Array {
  const out: Uint8Array[] = [];
  let i = 0;
  while (i < a.length) {
    let j = i;
    while (j + 1 < a.length && !(a[j] === 13 && a[j + 1] === 10)) j++;
    const size = parseInt(new TextDecoder().decode(a.slice(i, j)).trim(), 16);
    if (!size || Number.isNaN(size)) break;
    const start = j + 2;
    out.push(a.slice(start, start + size));
    i = start + size + 2;
  }
  return concat(out);
}

/** One transcription request through a given proxy. */
async function proxyStt(proxyUrl: string, sourceUrl: string): Promise<any> {
  const proxy = parseProxy(proxyUrl);
  const tls = await socks5Tls(proxy, STT_HOST, 443);
  const { body, contentType } = multipart({
    model_id: 'scribe_v2',
    source_url: sourceUrl,
    diarize: 'true',
    timestamps_granularity: 'character',
    tag_audio_events: 'true',
  });
  const writer = tls.writable.getWriter();
  const head =
    `POST ${STT_PATH} HTTP/1.1\r\n` +
    `Host: ${STT_HOST}\r\n` +
    `Connection: close\r\n` +
    `accept: */*\r\n` +
    `origin: https://elevenlabs.io\r\n` +
    `referer: https://elevenlabs.io/\r\n` +
    `user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36\r\n` +
    `content-type: ${contentType}\r\n` +
    `content-length: ${body.length}\r\n\r\n`;
  await writer.write(new TextEncoder().encode(head));
  await writer.write(body);
  writer.releaseLock();

  const reader = tls.readable.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  try { await tls.close(); } catch {}
  const { status, body: text } = parseHttp(concat(chunks));
  if (status !== 200) {
    const rateLimited = status === 429 || status === 401 || /rate limit|quota|too many/i.test(text);
    const err: any = new Error(`ElevenLabs unauth STT HTTP ${status}: ${text.slice(0, 160)}`);
    err.rateLimited = rateLimited;
    throw err;
  }
  return JSON.parse(text);
}

// ---- WS quota coordination (best-effort) ----------------------------------

/** Lease `minutes` of ASR quota over the coordinator WS, run fn, release.
 *  If wsUrl is empty or the coordinator is unreachable, runs fn without a lease. */
async function withQuotaLease<T>(cfg: AsrConfig, clientId: string, minutes: number, fn: () => Promise<T>): Promise<T> {
  if (!cfg.wsUrl) return fn();
  let ws: WebSocket | null = null;
  let leaseId: string | null = null;
  try {
    const resp = await fetch(cfg.wsUrl.replace(/^ws/, 'http'), { headers: { Upgrade: 'websocket' } });
    ws = (resp as any).webSocket as WebSocket | undefined || null;
    if (!ws) return fn();
    ws.accept();
    const granted = await new Promise<boolean>((resolve) => {
      const to = setTimeout(() => resolve(true), 4000); // don't block forever on a flaky coordinator
      ws!.addEventListener('message', (e: any) => {
        try {
          const m = JSON.parse(typeof e.data === 'string' ? e.data : '');
          if (m.type === 'lease_granted') { leaseId = m.lease_id; clearTimeout(to); resolve(true); }
          else if (m.type === 'lease_denied') { clearTimeout(to); resolve(false); }
        } catch {}
      });
      ws!.send(JSON.stringify({ type: 'lease_request', namespace: 'asr', minutes, queue: true, client_id: clientId }));
    });
    if (!granted) throw Object.assign(new Error('quota denied'), { rateLimited: true });
    return await fn();
  } finally {
    try { if (ws && leaseId) ws.send(JSON.stringify({ type: 'lease_release', lease_id: leaseId, actual_minutes: minutes, success: true })); } catch {}
    try { ws?.close(); } catch {}
  }
}

// ---- chunked orchestration ------------------------------------------------

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
  // round-robin the segments across proxies; retry a segment on the next proxy
  // when it comes back rate-limited (per-IP quota / IP flagged).
  const results = await Promise.all(names.map(async (name, n) => {
    const segKey = `scribe/${jobId}/asr-seg-${n}.json`;
    const cached = await env.MEDIA_BUCKET.get(segKey);
    if (cached) return { n, data: (await cached.json()) as any };
    const file = await containerCall(env, cName, `/files/${id}?name=${name}`);
    if (!file.ok || !file.body) throw new Error(`segment fetch failed: ${name}`);
    const chunkKey = `scribe/${jobId}/${name}`;
    await streamToR2(env.MEDIA_BUCKET, chunkKey, file.body, 'audio/mp4');
    const chunkUrl = `${CDN_BASE}/${chunkKey}`;
    const minutes = (durations[n] || chunkSec) / 60;

    let data: any = null;
    let lastErr = '';
    for (let attempt = 0; attempt < proxies.length * 2; attempt++) {
      const proxyUrl = proxies[(n + attempt) % proxies.length];
      try {
        data = await withQuotaLease(cfg, `deensubs-${jobId}-${n}`, minutes, () =>
          withTimeout(proxyStt(proxyUrl, chunkUrl), 180_000, `proxy STT (${new URL(proxyUrl.replace('socks5h', 'http').replace('socks5', 'http')).host})`));
        if (data?.words?.length || data?.text) break;
        lastErr = 'empty transcript';
      } catch (e: any) {
        lastErr = String(e?.message || e);
        if (!e?.rateLimited && attempt >= proxies.length) break; // non-quota error: give up after trying each proxy
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      }
    }
    // Fallback: if no proxy could transcribe this chunk and an API key exists,
    // transcribe it authenticated so the job completes rather than failing.
    if ((!data || !(data.words?.length || data.text)) && env.ELEVENLABS_API_KEY) {
      try { data = await authStt(env, chunkUrl); }
      catch (e: any) { lastErr = `proxy + auth fallback both failed: ${lastErr} | ${String(e?.message || e)}`; }
    }
    if (!data || !(data.words?.length || data.text)) throw new Error(`segment ${n} failed: ${lastErr}`);
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
