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
const CHUNK_THRESHOLD_SEC = 4500; // 75 min
const CHUNK_SEC = 2700; // 45 min segments

async function sttCall(env: ScribeEnv, sourceUrl: string, attempts = 3): Promise<any> {
  let lastErr = '';
  for (let i = 0; i < attempts; i++) {
    const form = new FormData();
    form.append('model_id', 'scribe_v2');
    form.append('cloud_storage_url', sourceUrl);
    form.append('diarize', 'true');
    form.append('tag_audio_events', 'true');
    const res = await fetch(STT_URL, {
      method: 'POST',
      headers: { 'xi-api-key': env.ELEVENLABS_API_KEY! },
      body: form,
    });
    if (res.ok) return res.json();
    const body = await res.text().catch(() => '');
    lastErr = `ElevenLabs STT HTTP ${res.status}: ${body.slice(0, 200)}`;
    // Retry timeouts and 5xx with backoff; fail fast on 4xx
    if (res.status < 500 && res.status !== 429) break;
    await new Promise((r) => setTimeout(r, 15000 * (i + 1)));
  }
  throw new Error(lastErr);
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

  // Segments are independent — stage + transcribe them ALL in parallel
  // (sequential chunks made a 2h file take 3x longer than needed).
  // Offsets come from ffprobe durations, so merge order is deterministic.
  const offsets: number[] = [];
  let acc = 0;
  for (let n = 0; n < names.length; n++) {
    offsets.push(acc);
    acc += durations[n] || CHUNK_SEC;
  }
  const results = await Promise.all(names.map(async (name, n) => {
    const file = await containerCall(env, cName, `/files/${id}?name=${name}`);
    if (!file.ok || !file.body) throw new Error(`segment fetch failed: ${name}`);
    const chunkKey = `scribe/${jobId}/${name}`;
    await streamToR2(env.MEDIA_BUCKET, chunkKey, file.body, 'audio/mp4');
    const data = await sttCall(env, `${CDN_BASE}/${chunkKey}`);
    await env.MEDIA_BUCKET.delete(chunkKey).catch(() => {});
    return { n, data };
  }));

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
  return { language_code: languageCode, text, words: allWords, audio_duration_secs: acc };
}

export async function runAsr(env: ScribeEnv, jobId: string, sourceKey: string, durationSec = 0): Promise<AsrResult> {
  if (!env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY secret not set');

  const data =
    durationSec > CHUNK_THRESHOLD_SEC
      ? await chunkedAsr(env, jobId, sourceKey)
      : await sttCall(env, `${CDN_BASE}/${sourceKey}`);

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
