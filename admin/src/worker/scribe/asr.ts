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

async function sttCall(env: ScribeEnv, sourceUrl: string, pendingKey?: string, attempts = 5): Promise<any> {
  // Async mode when the webhook secret is configured: the request returns
  // immediately with a transcription_id, and the result arrives EITHER via
  // the /hooks/elevenlabs webhook OR by polling their GET transcript
  // endpoint. The transcription_id persists to R2 the moment it exists
  // (pendingKey), so a crash, retry or resume picks up the SAME in-flight
  // transcription instead of paying for a new one.
  const useWebhook = !!(env as any).ELEVENLABS_WEBHOOK_SECRET;

  if (useWebhook && pendingKey) {
    const pending = await env.MEDIA_BUCKET.get(pendingKey);
    if (pending) {
      const { transcription_id } = (await pending.json()) as any;
      if (transcription_id) {
        const result = await awaitResult(env, transcription_id);
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
    form.append('cloud_storage_url', sourceUrl);
    form.append('diarize', 'true');
    form.append('tag_audio_events', 'true');
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
      const result = await awaitResult(env, transcriptionId);
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
async function awaitResult(env: ScribeEnv, transcriptionId: string): Promise<any | null> {
  for (let i = 0; i < 240; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    const obj = await env.MEDIA_BUCKET.get(sttResultKey(transcriptionId));
    if (obj) {
      const payload: any = await obj.json();
      env.MEDIA_BUCKET.delete(sttResultKey(transcriptionId)).catch(() => {});
      return payload.words ? payload : payload.transcription || payload.data?.transcription || payload;
    }
    if (i % 3 === 2) { // every ~30s, ask ElevenLabs directly
      const res = await fetch(`${STT_URL}/transcripts/${transcriptionId}`, {
        headers: { 'xi-api-key': env.ELEVENLABS_API_KEY! },
      }).catch(() => null);
      if (res?.ok) {
        const data: any = await res.json();
        const t = data.words ? data : data.transcription || data;
        if (t?.words?.length) return t;
      }
    }
  }
  return null;
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

async function containerCall(env: ScribeEnv, name: string, path: string, init?: RequestInit): Promise<Response> {
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

export async function runAsr(env: ScribeEnv, jobId: string, sourceKey: string, durationSec = 0): Promise<AsrResult> {
  if (!env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY secret not set');

  // Idempotent: a finished transcription is never paid for twice — resumes
  // and step retries reuse the stored result.
  //
  // With the webhook secret configured the WHOLE file goes in ONE async
  // request (no sync processing window, so no chunking and no parallelism —
  // ElevenLabs takes hours-long audio via cloud_storage_url + webhook).
  // Without it, long files fall back to the chunked sync path.
  const existingKey = `scribe/${jobId}/asr.json`;
  const existing = await env.MEDIA_BUCKET.get(existingKey);
  // A job that already has paid-for segment results finishes in chunked mode
  // even if webhook mode switched on mid-flight — those caches are money.
  const partial = (await env.MEDIA_BUCKET.list({ prefix: `scribe/${jobId}/asr-seg-`, limit: 1 })).objects.length > 0;
  const webhookMode = !!(env as any).ELEVENLABS_WEBHOOK_SECRET && !partial;
  const data: any = existing
    ? await existing.json()
    : webhookMode || durationSec <= CHUNK_THRESHOLD_SEC
      ? await sttCall(env, `${CDN_BASE}/${sourceKey}`, `scribe/${jobId}/stt-req-full.json`)
      : await chunkedAsr(env, jobId, sourceKey);

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
