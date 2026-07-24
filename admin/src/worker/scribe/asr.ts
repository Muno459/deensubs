// Step 2: transcribe with ElevenLabs Scribe v2 (authenticated API).
//
// Short files go in one call via cloud_storage_url. Long files (over ~75
// minutes) exceed the synchronous processing window (Cloudflare 524 at
// ElevenLabs' edge), so the container splits the audio into 45-minute
// stream-copied segments; each segment transcribes separately and the
// word timelines merge with exact per-segment offsets — the same chunking
// strategy the desktop Scribe used.
//
// The full word-level response is written to R2 (it can be megabytes);
// only a small summary is returned, because Workflow step results must
// stay small.

import { streamToR2 } from './download';
import { getAsrConfig, resolveAsrMode, type AsrConfig } from './asr-config';
import type { AsrResult, ScribeEnv, Word } from './types';

const STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text';
const CDN_BASE = 'https://cdn.deensubs.com';
const CHUNK_THRESHOLD_SEC = 2400; // chunk anything over 40 min
const CHUNK_SEC = 1500; // 25 min segments — 45 min flirted with ElevenLabs'
// ~100s sync window (their edge 524s) on dense Arabic lectures
const STT_CONCURRENCY = 3; // parallel segments; unbounded blasts made their edge 524 under load

/** Where async (webhook-delivered) transcription results land in R2. */
export function sttResultKey(requestId: string): string {
  return `scribe/stt-results/${requestId}.json`;
}

async function sttCall(env: ScribeEnv, sourceUrl: string, pendingKey?: string, attempts = 5, withFormats = false, forceSync = false): Promise<any> {
  // Async mode when the webhook secret is configured: the request returns
  // immediately with a transcription_id, and the result arrives EITHER via
  // the /hooks/elevenlabs webhook OR by polling their GET transcript
  // endpoint. The transcription_id persists to R2 the moment it exists
  // (pendingKey), so a crash, retry or resume picks up the SAME in-flight
  // transcription instead of paying for a new one.
  // forceSync bypasses the webhook entirely and reads the transcript straight
  // from the response — the reliable path the dual-mode ASR uses (the webhook
  // round-trip was stalling awaitResult for 40 min on some jobs).
  const useWebhook = !forceSync && !!(env as any).ELEVENLABS_WEBHOOK_SECRET;

  if (useWebhook && pendingKey) {
    const pending = await env.MEDIA_BUCKET.get(pendingKey);
    if (pending) {
      const { transcription_id } = (await pending.json()) as any;
      if (transcription_id) {
        const result = await awaitResult(env, transcription_id, withFormats);
        if (result) {
          env.MEDIA_BUCKET.delete(pendingKey).catch(() => {});
          return result;
        }
        // in-flight id went nowhere (expired/failed upstream) — resubmit
        await env.MEDIA_BUCKET.delete(pendingKey).catch(() => {});
      }
    }
  }

  let lastErr = '';
  for (let i = 0; i < attempts; i++) {
    const form = new FormData();
    form.append('model_id', 'scribe_v2');
    form.append('source_url', sourceUrl); // cloud_storage_url is deprecated
    form.append('diarize', 'true');
    form.append('timestamps_granularity', 'character'); // per-letter timing -> articulation-true sub-word fill
    form.append('tag_audio_events', 'true');
    if (withFormats) {
      // ElevenLabs' own exports ride along with the transcript: their native
      // (source-language, silence-based) segmentation is the structural truth
      // for audiobooks — we store it verbatim instead of re-deriving.
      // Segmentation knobs matter: with the defaults a single-voice lecture
      // comes back as ONE segment (turn-based only). These settings make
      // their engine cut readable paragraph-sized segments on real pauses.
      const seg = { segment_on_silence_longer_than_s: 1.1, max_segment_duration_s: 45, max_segment_chars: 500 };
      form.append('additional_formats', JSON.stringify([
        { format: 'txt', include_speakers: true, include_timestamps: true, ...seg },
        { format: 'segmented_json', ...seg },
      ]));
    }
    if (useWebhook) form.append('webhook', 'true');
    const res = await fetch(STT_URL, {
      method: 'POST',
      headers: { 'xi-api-key': env.ELEVENLABS_API_KEY! },
      body: form,
    });
    if (res.ok) {
      const data: any = await res.json();
      if (!useWebhook) return data;
      const transcriptionId = data.request_id || data.transcription_id || data.id;
      if (!transcriptionId) return data; // API answered synchronously anyway
      if (pendingKey) {
        await env.MEDIA_BUCKET.put(pendingKey, JSON.stringify({ transcription_id: transcriptionId }), {
          httpMetadata: { contentType: 'application/json' },
        });
      }
      const result = await awaitResult(env, transcriptionId, withFormats);
      if (result) {
        if (pendingKey) env.MEDIA_BUCKET.delete(pendingKey).catch(() => {});
        return result;
      }
      lastErr = `result for ${transcriptionId} never arrived`;
      continue; // one more submission attempt
    }
    const body = await res.text().catch(() => '');
    lastErr = `ElevenLabs STT HTTP ${res.status}: ${body.slice(0, 200)}`;
    // Retry timeouts (524) and 5xx with backoff; fail fast on 4xx
    if (res.status < 500 && res.status !== 429) break;
    await new Promise((r) => setTimeout(r, 20000 * (i + 1)));
  }
  throw new Error(lastErr);
}

/** Wait for an async transcription: the webhook drop in R2 is the fast path,
 * and their GET transcript endpoint is polled as the reliable path (works
 * even if webhook delivery is broken). Up to 40 minutes. */
async function awaitResult(env: ScribeEnv, transcriptionId: string, preferFormats = false): Promise<any | null> {
  // The GET endpoint strips additional_formats — only the webhook payload
  // carries them. When formats were requested, a complete GET result waits a
  // grace window for the webhook drop before being accepted as-is.
  let stripped: any = null;
  let grace = 9; // ~90 s
  for (let i = 0; i < 240; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    const obj = await env.MEDIA_BUCKET.get(sttResultKey(transcriptionId));
    if (obj) {
      const payload: any = await obj.json();
      env.MEDIA_BUCKET.delete(sttResultKey(transcriptionId)).catch(() => {});
      return payload.words ? payload : payload.transcription || payload.data?.transcription || payload;
    }
    if (stripped && --grace <= 0) return stripped;
    if (i % 3 === 2) { // every ~30s, ask ElevenLabs directly
      const res = await fetch(`${STT_URL}/transcripts/${transcriptionId}`, {
        headers: { 'xi-api-key': env.ELEVENLABS_API_KEY! },
      }).catch(() => null);
      if (res?.ok) {
        const data: any = await res.json();
        const t = data.words ? data : data.transcription || data;
        if (t?.words?.length) {
          if (!preferFormats || t.additional_formats?.length) return t;
          stripped = t;
        }
      }
    }
  }
  return stripped;
}

/** Run tasks with a bounded worker pool (order-preserving results). */
async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function containerCall(env: ScribeEnv, name: string, path: string, init?: RequestInit): Promise<Response> {
  const { getContainer } = await import('@cloudflare/containers');
  const container = getContainer(env.YTDLP as any, name);
  const auth = { Authorization: 'Bearer ' + (env.YTDLP_TOKEN || 'internal') };
  return container.fetch(new Request('http://ytdlp' + path, { ...init, headers: { ...auth, ...(init?.headers as any) } }));
}

/** Chunked transcription for long files: split → per-segment ASR → merge. */
async function chunkedAsr(env: ScribeEnv, jobId: string, sourceKey: string): Promise<any> {
  const cName = 'split-' + jobId;
  const start = await containerCall(env, cName, '/split', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `${CDN_BASE}/${sourceKey}`, seconds: CHUNK_SEC }),
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

  // Segments run through a bounded pool (unbounded parallel blasts made
  // ElevenLabs' edge 524 under load). Offsets come from ffprobe durations,
  // so merge order is deterministic. Every finished segment persists its
  // result to R2 IMMEDIATELY — a retry of any kind re-transcribes only the
  // segments that never succeeded, never burning credits twice.
  const offsets: number[] = [];
  let acc = 0;
  for (let n = 0; n < names.length; n++) {
    offsets.push(acc);
    acc += durations[n] || CHUNK_SEC;
  }
  const results = await pool(names, STT_CONCURRENCY, async (name, n) => {
    const segKey = `scribe/${jobId}/asr-seg-${n}.json`;
    const cached = await env.MEDIA_BUCKET.get(segKey);
    if (cached) return { n, data: (await cached.json()) as any };
    const file = await containerCall(env, cName, `/files/${id}?name=${name}`);
    if (!file.ok || !file.body) throw new Error(`segment fetch failed: ${name}`);
    const chunkKey = `scribe/${jobId}/${name}`;
    await streamToR2(env.MEDIA_BUCKET, chunkKey, file.body, 'audio/mp4');
    const data = await sttCall(env, `${CDN_BASE}/${chunkKey}`, `scribe/${jobId}/stt-req-${n}.json`);
    await env.MEDIA_BUCKET.put(segKey, JSON.stringify(data), {
      httpMetadata: { contentType: 'application/json' },
    });
    await env.MEDIA_BUCKET.delete(chunkKey).catch(() => {});
    return { n, data };
  });

  const allWords: Word[] = [];
  let text = '';
  let languageCode = '';
  for (const { n, data } of results.sort((a, b) => a.n - b.n)) {
    if (!languageCode) languageCode = data.language_code || '';
    text += (text ? ' ' : '') + (data.text || '');
    for (const w of data.words || []) {
      allWords.push({ ...w, start: w.start + offsets[n], end: w.end + offsets[n] });
    }
  }

  containerCall(env, cName, `/files/${id}`, { method: 'DELETE' }).catch(() => {});
  // merged result is about to be persisted — segment caches served their purpose
  for (let n = 0; n < names.length; n++) {
    env.MEDIA_BUCKET.delete(`scribe/${jobId}/asr-seg-${n}.json`).catch(() => {});
  }
  return { language_code: languageCode, text, words: allWords, audio_duration_secs: acc };
}

/** Authenticated whole-file synchronous STT for a single URL. Used as the
 *  proxy-mode fallback: a chunk that can't get through any SOCKS proxy is
 *  transcribed with the API key instead of hanging/failing. */
export async function authStt(env: ScribeEnv, sourceUrl: string): Promise<any> {
  return sttCall(env, sourceUrl, undefined, 5, false, /* forceSync */ true);
}

/** WHOLE-FILE unauthenticated STT via a DIRECT Worker fetch — no proxy, no
 *  chunking. Verified: the ElevenLabs demo endpoint doesn't rate-limit the
 *  Worker's egress IP and has NO ~60s cap (that ceiling was the residential
 *  proxy's idle timeout, not ElevenLabs). Inside a Workflow step the fetch has
 *  no wall-clock limit (fetch wait isn't CPU), so a full 2h file transcribes in
 *  one request (~160s). Free, and it returns native additional_formats too. */
export async function directUnauthStt(env: ScribeEnv, sourceUrl: string, withFormats = false, attempts = 3): Promise<any> {
  let lastErr = '';
  for (let i = 0; i < attempts; i++) {
    const form = new FormData();
    form.append('model_id', 'scribe_v2');
    form.append('source_url', sourceUrl);
    form.append('diarize', 'true');
    form.append('timestamps_granularity', 'character');
    form.append('tag_audio_events', 'true');
    if (withFormats) {
      const seg = { segment_on_silence_longer_than_s: 1.1, max_segment_duration_s: 45, max_segment_chars: 500 };
      form.append('additional_formats', JSON.stringify([
        { format: 'txt', include_speakers: true, include_timestamps: true, ...seg },
        { format: 'segmented_json', ...seg },
      ]));
    }
    let res: Response;
    try {
      // Hard per-request deadline so a hung/slow ElevenLabs fetch can never stall
      // a job. A real whole-file transcription is ~45-120s (a 90-min file was
      // ~81s), so 150s clears the slowest legit case; past that it's a hang.
      res = await fetch(`${STT_URL}?allow_unauthenticated=1`, {
        method: 'POST',
        headers: { origin: 'https://elevenlabs.io', referer: 'https://elevenlabs.io/' },
        body: form,
        signal: AbortSignal.timeout(150_000),
      });
    } catch (e: any) {
      // Timeout/network error: don't retry the SAME IP — let the caller rotate to
      // a fresh colo IP (tier 2) rather than re-hitting a slow/hung endpoint.
      lastErr = `unauth STT fetch failed: ${String(e?.name || e?.message || e).slice(0, 120)}`;
      break;
    }
    if (res.ok) return res.json();
    const body = await res.text().catch(() => '');
    lastErr = `unauth STT HTTP ${res.status}: ${body.slice(0, 200)}`;
    const retryable = res.status >= 500 || res.status === 429 || /rate limit|too many|quota/i.test(body);
    if (!retryable) break; // hard 4xx -> fail fast (caller falls back)
    await new Promise((r) => setTimeout(r, 5000 * (i + 1)));
  }
  throw new Error(lastErr);
}

// The 9 Cloudflare Durable Object `locationHint` regions. Within EACH region,
// distinct DO instances land in distinct data centers (colos), each with its own
// egress IP — so the pool of distinct IPs is regions × instances, not just 9.
const ASR_REGIONS = ['weur', 'enam', 'wnam', 'apac', 'eeur', 'sam', 'oc', 'afr', 'me'];
// Instances per region. MEASURED: each region saturates at ~4-6 reachable colos,
// so 8 instances/region harvests ~25-30 DISTINCT egress IPs across the pool.
// Each IP has its own ~8-clip unauth quota (proven per-IP, not per-subnet/ASN),
// so the pool is worth ~200+ whole-file transcriptions per quota window — enough
// that the residential-proxy fallback is effectively never reached.
const ASR_POOL_PER_REGION = 8;

/** Deterministic per-job shuffle of [0, len). Spreads quota usage across the IP
 *  pool (consecutive jobs start at different IPs) while staying reproducible on a
 *  workflow-step retry. Seeded FNV-1a → LCG Fisher-Yates. */
function seededOrder(len: number, seed: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  let s = h >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const idx = Array.from({ length: len }, (_, i) => i);
  for (let i = len - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return idx;
}

// Shared KV pool state: `cool` = which egress IPs are cooling (hit their unauth
// 401), `map` = which pool instance currently egresses from which IP. Cooling by
// EXACT IP (not by instance) lets a batch skip ALL of an exhausted IP's sibling
// instances after probing just one — our 72 instances collapse to ~24 distinct
// colo IPs (3× redundancy), so per-IP cooling avoids re-downloading the file on
// every sibling. Soft: a cooled IP is deprioritised, still re-checked before the
// proxy, so a wrong TTL can't strand quota.
const POOL_KEY = 'asr:ippool';
const COOLED_RECHECK_CAP = 8; // longest-cooled IPs to re-probe per job before the proxy

/** Stable short key for a proxy entry, so its cooldown lives in the same IP map
 *  without writing credentials into it a second time. */
function fnv1a(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

const is401 = (x: any): boolean =>
  /\b401\b|sign[_ -]?in|reached the limit|too many|rate limit|quota/i.test(String(x?.message ?? x ?? ''));

/** This colo's egress IPv4 (IPv4-only, non-Cloudflare echoes — api.elevenlabs.io
 *  is IPv4-only, so this IS the IP ElevenLabs rate-limits). Best-effort ''. */
export async function echoEgressIp(): Promise<string> {
  for (const h of ['https://v4.ident.me/', 'https://ip4.seeip.org/']) {
    try { const r = await fetch(h); const t = (await r.text()).trim(); if (/^\d+\.\d+\.\d+\.\d+$/.test(t)) return t; } catch {}
  }
  return '';
}

type PoolState = { map: Record<string, string>; cool: Record<string, number> };
async function readPool(env: ScribeEnv): Promise<PoolState> {
  try {
    const raw = await env.MEDIA_KV?.get(POOL_KEY);
    if (!raw) return { map: {}, cool: {} };
    const p = JSON.parse(raw) as PoolState;
    const now = Date.now();
    const cool = p.cool || {};
    for (const k of Object.keys(cool)) if (!(cool[k] > now)) delete cool[k]; // drop expired
    return { map: p.map || {}, cool };
  } catch { return { map: {}, cool: {} }; }
}

/** Merge this job's instance→IP learnings + IP-cooldown changes into the latest
 *  KV state (best-effort; a lost concurrent write costs at most one re-probe). */
async function flushPool(env: ScribeEnv, mapPending: Record<string, string>, coolPending: Record<string, number | null>): Promise<void> {
  if (!Object.keys(mapPending).length && !Object.keys(coolPending).length) return;
  try {
    const latest = await readPool(env);
    Object.assign(latest.map, mapPending);
    for (const [ip, v] of Object.entries(coolPending)) { if (v === null) delete latest.cool[ip]; else latest.cool[ip] = v; }
    await env.MEDIA_KV?.put(POOL_KEY, JSON.stringify(latest));
  } catch {}
}

/** Free-first ASR with a reliable paid backstop. The unauth endpoint caps at ~8
 *  clips per SOURCE IP, so the tiers escalate cheapest → most reliable:
 *   1+2) CF free: the whole file from a distinct egress IP — this Worker's own IP
 *      plus a POOL of region-placed colo DOs. An IP-keyed cooldown skips egress
 *      IPs known to be rate-limited AND all their sibling instances (saving the
 *      file re-download + ~6s 401), dedups so an IP is never probed twice per job,
 *      and re-checks the longest-cooled few for recovery before giving up on CF;
 *   3) SpyderProxy: only if EVERY CF IP is exhausted, the residential proxy
 *      (unlimited fresh IPs, chunked). It is UNRELIABLE (can't hold the TCP
 *      connection long), so its failure falls THROUGH to the paid backstop;
 *   4) authenticated: the paid ElevenLabs API key, whole file — reliable last
 *      resort, reached only when every free tier + the proxy couldn't serve it,
 *      so we never pay when a cheaper tier can. */
async function unauthAsr(env: ScribeEnv, jobId: string, sourceKey: string, cfg: AsrConfig): Promise<any> {
  const url = `${CDN_BASE}/${sourceKey}`;
  const ok = (d: any) => !!(d && (d.words?.length || d.text));

  // --- CF free tiers, rotated across egress IPs with an IP-keyed cooldown ---
  const ttlMs = (cfg.cooldownHours ?? 3) * 3_600_000;
  const { map: ipMap, cool } = ttlMs > 0 ? await readPool(env) : { map: {}, cool: {} };
  const now = Date.now();
  const coolPending: Record<string, number | null> = {};
  const mapPending: Record<string, string> = {};
  const ipOf = (key: string): string | undefined => mapPending[key] ?? ipMap[key];
  const isIpCool = (ip?: string) => !!ip && ((ip in coolPending) ? coolPending[ip] !== null : (cool[ip] ?? 0) > now);

  // Each source runs its STT + a CONCURRENT egress-IP echo (the echo finishes long
  // before the ~30-60s transcription, so it adds no latency), returning the IP so
  // we can cool + dedup by EXACT IP. Sources: local Worker IP + each colo DO.
  type Res = { data?: any; rateLimited: boolean; ip: string };
  type Src = { key: string; run: () => Promise<Res> };
  const srcs: Src[] = [{
    key: 'local',
    run: async () => {
      const ipP = echoEgressIp();
      try { const d = await directUnauthStt(env, url, /* withFormats */ true, /* attempts */ 2); return { data: ok(d) ? d : undefined, rateLimited: false, ip: await ipP }; }
      catch (e) { return { rateLimited: is401(e), ip: await ipP }; }
    },
  }];
  if (env.ASR_EGRESS) {
    for (const r of ASR_REGIONS) for (let n = 0; n < ASR_POOL_PER_REGION; n++) {
      const key = `${r}-${n}`;
      srcs.push({
        key,
        run: async () => {
          try {
            const stub = env.ASR_EGRESS.get(env.ASR_EGRESS.idFromName(`asr-egress-${key}`), { locationHint: r as any });
            const resp = await stub.fetch('https://asr/', { method: 'POST', body: JSON.stringify({ url }) });
            const ip = resp.headers.get('x-egress-ip') || '';
            if (resp.ok) { const d: any = await resp.json(); return { data: ok(d) ? d : undefined, rateLimited: false, ip }; }
            return { rateLimited: is401(await resp.text().catch(() => '')), ip };
          } catch { return { rateLimited: false, ip: '' }; }
        },
      });
    }
  }

  // Fresh IPs first (per-job shuffle so load spreads); a source whose KNOWN IP is
  // cooled goes to the capped recovery re-check. Dedup: never probe an IP twice
  // in one job (skips exhausted IPs' sibling instances).
  const shuffled = seededOrder(srcs.length, jobId).map((i) => srcs[i]);
  const hot = shuffled.filter((s) => !isIpCool(ipOf(s.key)));
  const cooled = shuffled.filter((s) => isIpCool(ipOf(s.key)))
    .sort((a, b) => (cool[ipOf(a.key)!] ?? 0) - (cool[ipOf(b.key)!] ?? 0))
    .slice(0, COOLED_RECHECK_CAP);
  const triedIps = new Set<string>();
  for (const s of [...hot, ...cooled]) {
    const known = ipOf(s.key);
    if (known && triedIps.has(known)) continue; // same IP already tried this job
    const res = await s.run();
    if (res.ip) { mapPending[s.key] = res.ip; triedIps.add(res.ip); }
    if (res.data) { if (res.ip) coolPending[res.ip] = null; await flushPool(env, mapPending, coolPending); return res.data; }
    if (res.rateLimited && res.ip && ttlMs > 0) coolPending[res.ip] = now + ttlMs;
  }
  await flushPool(env, mapPending, coolPending);

  // Tier 3 — the proxy pool. Every proxy entry is its OWN egress IP with its own
  // ~8-clip quota, so this extends the same IP-keyed rotation rather than being a
  // single last resort. Wrapped so any failure falls THROUGH to the paid backstop.
  if (cfg.proxies?.length) {
    const px = cfg.proxies;
    try {
      const { proxyStt, freshSession, proxyChunkedAsr } = await import('./asr-proxy');

      // 3a. Whole file in ONE request — only when the proxies can hold an idle
      // connection through ElevenLabs' processing (datacenter proxies can;
      // residential exits drop at ~60s). Avoids the container split + merge
      // entirely. Rotates across proxies so each contributes its own quota.
      if (cfg.proxyWholeFile) {
        let drops = 0; // connection failures → these proxies can't hold; stop early
        for (const i of seededOrder(px.length, jobId + ':px')) {
          if (drops >= 2) break;
          const key = `px:${fnv1a(px[i])}`;
          if (isIpCool(key)) continue;
          try {
            const d = await Promise.race([
              proxyStt(freshSession(px[i]), url),
              new Promise((_, r) => setTimeout(() => r(new Error('proxy whole-file timeout')), 170_000)),
            ]);
            if (ok(d)) {
              coolPending[key] = null;
              await flushPool(env, mapPending, coolPending);
              return d;
            }
          } catch (e: any) {
            if (is401(e)) { if (ttlMs > 0) coolPending[key] = now + ttlMs; } // quota, not a drop
            else drops++; // dropped/timed out → likely can't hold the idle gap
          }
        }
        await flushPool(env, mapPending, coolPending);
        console.log('proxy whole-file pass failed → chunked');
      }

      // 3b. Chunked (segments sized to clear a residential proxy's ~60s idle wall).
      console.log('all Cloudflare egress IPs exhausted → proxy chunked fallback');
      const d = await proxyChunkedAsr(env, jobId, sourceKey, cfg);
      if (ok(d)) return d;
      console.log('proxy returned no transcript → authenticated fallback');
    } catch (e: any) {
      console.log('proxy fallback failed → authenticated fallback:', String(e?.message || e).slice(0, 160));
    }
  }

  // Tier 4 — authenticated whole-file (paid, reliable). Last resort.
  if (env.ELEVENLABS_API_KEY) {
    console.log('final fallback → authenticated ElevenLabs API (whole file)');
    return sttCall(env, url, undefined, 5, /* withFormats */ true, /* forceSync */ true);
  }

  throw new Error('ASR failed: Worker IP + CF pool exhausted, proxy fallback failed/absent, and no ELEVENLABS_API_KEY for the authenticated backstop');
}

/** Resolve + validate the ASR plan. Throws immediately on misconfiguration so
 *  callers (workflow preflight, runAsr) can fail fast instead of after a
 *  download. Exported so the workflow can validate before spending a download. */
export async function getAsrPlan(env: ScribeEnv): Promise<{ cfg: AsrConfig; mode: 'authenticated' | 'proxy' }> {
  const cfg = await getAsrConfig(env);
  const mode = resolveAsrMode(cfg, !!env.ELEVENLABS_API_KEY);
  if (mode === 'authenticated' && !env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY secret not set');
  // proxy (free/unauth) mode needs no proxies for the primary direct-fetch path;
  // proxies are only the rate-limit fallback, so an empty list is fine.
  return { cfg, mode };
}

export async function runAsr(env: ScribeEnv, jobId: string, sourceKey: string, durationSec = 0): Promise<AsrResult> {
  // Dual mode (configurable in /tools):
  //  - authenticated (API key set): the WHOLE file in ONE synchronous request
  //    via source_url — no chunking, no webhook (the webhook round-trip was
  //    stalling awaitResult for ~40 min and timing the step out at 2 h).
  //  - proxy (no key): FREE unauthenticated STT — the WHOLE file in ONE direct
  //    Worker fetch (no proxy, no chunking; the Worker IP isn't rate-limited and
  //    there is no ~60s cap — that was the residential proxy's idle timeout).
  //    Falls back to the residential-proxy chunked path only if rate-limited.
  const { cfg, mode } = await getAsrPlan(env);

  const existingKey = `scribe/${jobId}/asr.json`;
  const existing = await env.MEDIA_BUCKET.get(existingKey);
  // Any already-paid-for chunked segments finish in chunked mode — those caches are money.
  const partial = (await env.MEDIA_BUCKET.list({ prefix: `scribe/${jobId}/asr-seg-`, limit: 1 })).objects.length > 0;
  const data: any = existing
    ? await existing.json()
    : mode === 'proxy'
      ? await unauthAsr(env, jobId, sourceKey, cfg)
      : partial
        ? await chunkedAsr(env, jobId, sourceKey)
        : await sttCall(env, `${CDN_BASE}/${sourceKey}`, undefined, 5, true, /* forceSync */ true);

  const words: Word[] = data.words || [];
  if (!words.length) throw new Error('ElevenLabs returned no words');

  const asrKey = `scribe/${jobId}/asr.json`;
  await env.MEDIA_BUCKET.put(asrKey, JSON.stringify(data), {
    httpMetadata: { contentType: 'application/json' },
  });

  const last = words[words.length - 1];
  return {
    asrKey,
    languageCode: data.language_code || '',
    wordCount: words.filter((w) => (w.type || 'word') === 'word').length,
    durationSec: data.audio_duration_secs || last.end || 0,
  };
}

/** Load the stored ASR response back from R2. */
export async function loadAsr(env: ScribeEnv, asrKey: string): Promise<{ words: Word[]; text: string; language_code: string }> {
  const obj = await env.MEDIA_BUCKET.get(asrKey);
  if (!obj) throw new Error('ASR result missing from R2: ' + asrKey);
  return obj.json();
}
