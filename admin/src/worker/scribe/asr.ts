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

async function sttCall(env: ScribeEnv, sourceUrl: string, attempts = 5): Promise<any> {
  // Async mode when the webhook secret is configured: the request returns
  // immediately with a request_id, ElevenLabs POSTs the transcript to
  // /hooks/elevenlabs when ready, and we pick it up from R2. No sync
  // processing window, no 524s, works for any segment length.
  const useWebhook = !!(env as any).ELEVENLABS_WEBHOOK_SECRET;
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
      const requestId = data.request_id || data.transcription_id || data.id;
      if (!requestId) return data; // API answered synchronously anyway
      const result = await awaitWebhookResult(env, requestId);
      if (result) return result;
      lastErr = `webhook result for ${requestId} never arrived`;
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

/** Poll R2 for the webhook-delivered result (up to 40 minutes). */
async function awaitWebhookResult(env: ScribeEnv, requestId: string): Promise<any | null> {
  for (let i = 0; i < 240; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    const obj = await env.MEDIA_BUCKET.get(sttResultKey(requestId));
    if (obj) {
      const payload: any = await obj.json();
      env.MEDIA_BUCKET.delete(sttResultKey(requestId)).catch(() => {});
      // webhook envelope vs bare transcription — accept both
      return payload.words ? payload : payload.transcription || payload.data?.transcription || payload;
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
    const data = await sttCall(env, `${CDN_BASE}/${chunkKey}`);
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
  const webhookMode = !!(env as any).ELEVENLABS_WEBHOOK_SECRET;
  const data: any = existing
    ? await existing.json()
    : webhookMode || durationSec <= CHUNK_THRESHOLD_SEC
      ? await sttCall(env, `${CDN_BASE}/${sourceKey}`)
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
