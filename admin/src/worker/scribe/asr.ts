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
    const res = await fetch(`${STT_URL}?allow_unauthenticated=1`, {
      method: 'POST',
      headers: { origin: 'https://elevenlabs.io', referer: 'https://elevenlabs.io/' },
      body: form,
    });
    if (res.ok) return res.json();
    const body = await res.text().catch(() => '');
    lastErr = `unauth STT HTTP ${res.status}: ${body.slice(0, 200)}`;
    const retryable = res.status >= 500 || res.status === 429 || /rate limit|too many|quota/i.test(body);
    if (!retryable) break; // hard 4xx -> fail fast (caller falls back)
    await new Promise((r) => setTimeout(r, 5000 * (i + 1)));
  }
  throw new Error(lastErr);
}

// Cloudflare regions → distinct egress IPs (verified). Rotating across them
// multiplies the unauth per-IP quota by ~9 while keeping WHOLE-file (no chunk).
const ASR_REGIONS = ['weur', 'enam', 'wnam', 'apac', 'eeur', 'sam', 'oc', 'afr', 'me'];

/** Free ASR at scale. The unauth endpoint caps at ~8 clips per SOURCE IP, so:
 *   1) transcribe the whole file from THIS Worker's egress IP;
 *   2) on rate-limit, retry from region-placed egress DOs (each a distinct IP →
 *      its own quota) — still whole-file, no chunking;
 *   3) only if every Cloudflare IP is exhausted, fall back to the residential
 *      proxy (unlimited fresh IPs, but chunked). */
async function unauthAsr(env: ScribeEnv, jobId: string, sourceKey: string, cfg: AsrConfig): Promise<any> {
  const url = `${CDN_BASE}/${sourceKey}`;
  const ok = (d: any) => !!(d && (d.words?.length || d.text));

  try { const d = await directUnauthStt(env, url, /* withFormats */ true, /* attempts */ 2); if (ok(d)) return d; } catch { /* rate-limited → regions */ }

  if (env.ASR_EGRESS) {
    for (const h of ASR_REGIONS) {
      try {
        const stub = env.ASR_EGRESS.get(env.ASR_EGRESS.idFromName('asr-egress-' + h), { locationHint: h as any });
        const r = await stub.fetch('https://asr/', { method: 'POST', body: JSON.stringify({ url }) });
        if (r.ok) { const d: any = await r.json(); if (ok(d)) return d; }
      } catch { /* next region */ }
    }
  }

  if (cfg.proxies?.length) {
    console.log('all Cloudflare egress IPs exhausted/failed → proxy-chunked fallback');
    return (await import('./asr-proxy')).proxyChunkedAsr(env, jobId, sourceKey, cfg);
  }
  throw new Error('unauth STT failed on this Worker + all regions, and no proxy fallback configured');
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
