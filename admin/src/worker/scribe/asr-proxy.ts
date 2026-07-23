// Unauthenticated ElevenLabs STT through SOCKS5 proxies (residential IPs).
//
// Why: the unauthenticated endpoint (allow_unauthenticated=1) is rate-limited
// per source IP. A Cloudflare Worker's own egress is datacenter/flagged, so we
// tunnel the request through a residential SOCKS5 proxy. The request body is a
// tiny source_url (ElevenLabs fetches the audio from R2 itself), so only the
// control connection rides the proxy. Webhooks aren't available unauthenticated,
// so the transcript is read straight from the synchronous response.
//
// The SOCKS5 + TLS is done in the CONTAINER (curl via /stt-proxy), NOT the
// Worker: cloudflare:sockets' startTls() sends the SNI of the connect() host
// (the proxy) and offers no way to override it to the tunnel destination, and
// Google-fronted api.elevenlabs.io rejects the mismatched SNI ("TLS Handshake
// Failed"). curl sets SNI to the destination, so the handshake succeeds.
//
// Flow per chunk: container splits audio → chunk to R2 → Worker leases quota
// (WS coordinator) and calls the container /stt-proxy (SOCKS5 → source_url POST)
// → merge. Quota across the proxies is coordinated over a WebSocket (best-effort).

import { streamToR2 } from './download';
import { containerCall, authStt } from './asr';
import { AsrCoordinator } from './asr-coord';

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

// ---- SOCKS proxy parsing (nic identity) -----------------------------------

type Proxy = { host: string; port: number; user?: string; pass?: string };

function parseProxy(url: string): Proxy {
  // socks5:// and socks5h:// are equivalent for us — we always CONNECT by
  // domain (ATYP 0x03), so the proxy resolves the hostname either way.
  const m = url.trim().match(/^socks(?:5h?|4)?:\/\/(?:([^:@\/]+):([^@\/]+)@)?([^:\/]+):(\d+)\/?$/i);
  if (!m) throw new Error('bad SOCKS proxy url (want socks5[h]://[user:pass@]host:port): ' + url);
  return { user: m[1], pass: m[2], host: m[3], port: parseInt(m[4], 10) };
}

/** One transcription request through a given proxy, executed in the container.
 *  The container (curl) does the SOCKS5 + TLS because a Cloudflare Worker's
 *  startTls() sends the SNI of the connect() host (the proxy) and cannot
 *  override it to the tunnel destination — Google-fronted api.elevenlabs.io
 *  rejects the mismatched SNI, while curl sets it correctly. The chunk lives in
 *  R2 (source_url); ElevenLabs fetches it and the transcript is the synchronous
 *  response (webhooks aren't available unauthenticated). */
async function containerSttProxy(env: ScribeEnv, cName: string, proxyUrl: string, sourceUrl: string): Promise<any> {
  const r = await containerCall(env, cName, '/stt-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ proxy: proxyUrl, source_url: sourceUrl }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err: any = new Error(j?.error || `stt-proxy HTTP ${r.status}`);
    // 429/401/quota/timeouts → rate-limited so the loop rotates to the next NIC
    err.rateLimited = !!j?.rate_limited || r.status === 429;
    throw err;
  }
  return j;
}

// ---- WS quota coordination (best-effort) ----------------------------------

// Quota leasing is handled by AsrCoordinator (asr-coord.ts) — the full
// register / lease / refresh-drain protocol, one session per run.

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
  const nics = proxies.map((p) => { try { return parseProxy(p).user || 'default'; } catch { return 'default'; } });
  // One coordinator session for the whole run: register + per-nic quota leases,
  // IP-refresh drain/resume. Null if no wsUrl or the coordinator is unreachable
  // (then we lease-free — the per-IP rate-limit still triggers proxy rotation).
  const coord = await AsrCoordinator.connect(cfg.wsUrl, [...new Set(nics)]);
  try {
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
      const idx = (n + attempt) % proxies.length;
      const proxyUrl = proxies[idx];
      const nic = nics[idx];
      // Reserve quota for this modem before uploading. Denied → try the next
      // modem; if all are dry, wait once for freed quota, then fall through.
      let leaseId: string | undefined;
      if (coord) {
        const lease = await coord.lease(nic, minutes);
        if (!lease.granted) {
          lastErr = 'lease ' + (lease.reason || 'denied');
          if (attempt >= proxies.length - 1) await coord.waitAvailable(15_000);
          continue;
        }
        leaseId = lease.leaseId;
      }
      try {
        data = await withTimeout(containerSttProxy(env, cName, proxyUrl, chunkUrl), 190_000, `proxy STT (${nic})`);
        const ok = !!(data?.words?.length || data?.text);
        if (coord && leaseId) coord.release(leaseId, minutes, ok);
        if (ok) break;
        lastErr = 'empty transcript';
      } catch (e: any) {
        if (coord && leaseId) coord.release(leaseId, 0, false);
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
  } finally {
    coord?.close();
  }
}
