// AI image generation + editing (router ag/gemini-3.1-flash-image) and the
// deterministic v2 brand re-grade (container ffmpeg — the image model refuses
// to edit photos of real people, so portraits go through the filter chain).

import type { ScribeEnv } from '../scribe/types';

const CDN = 'https://cdn.deensubs.com';

type ImgEnv = ScribeEnv & { MEDIA_KV?: KVNamespace; YTDLP: any };

function slugify(s: string): string {
  return (s || 'ai').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'ai';
}

async function routerImage(env: ImgEnv, prompt: string, imageDataUri?: string): Promise<Uint8Array> {
  const key = (env as any).SCRIBE_IMG_KEY;
  if (!key) throw new Error('SCRIBE_IMG_KEY secret not set');
  const res = await fetch('https://router.padborginn.dk/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model: 'ag/gemini-3.1-flash-image',
      prompt,
      n: 1,
      size: 'auto',
      quality: 'auto',
      background: 'auto',
      image_detail: 'high',
      output_format: 'png',
      ...(imageDataUri ? { image: imageDataUri } : {}),
    }),
  });
  if (!res.ok) throw new Error(`image API HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`);
  const data: any = await res.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error(
      imageDataUri
        ? 'The model returned no image — it refuses to edit photos of real people. Use Re-grade for portraits.'
        : 'The model returned no image for this prompt.'
    );
  }
  return Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
}

async function store(env: ImgEnv, prefix: string, name: string, bytes: Uint8Array): Promise<string> {
  const key = `${prefix}${slugify(name)}-${Date.now().toString(36)}.png`;
  await env.MEDIA_BUCKET.put(key, bytes, { httpMetadata: { contentType: 'image/png' } });
  if (key.startsWith('thumbs/') && env.MEDIA_KV) {
    await env.MEDIA_KV.put(key, bytes, { metadata: { ct: 'image/png' } }).catch(() => {});
  }
  return key;
}

export async function aiImage(env: ImgEnv, kind: string, payload: any): Promise<{ key: string }> {
  const prefix = (payload.prefix || 'uploads/').replace(/[^\w/-]/g, '');

  if (kind === 'generate') {
    if (!payload.prompt) throw new Error('prompt required');
    const bytes = await routerImage(env, payload.prompt);
    return { key: await store(env, prefix, payload.name || 'generated', bytes) };
  }

  if (kind === 'edit') {
    if (!payload.imageKey || !payload.prompt) throw new Error('imageKey and prompt required');
    const obj = await env.MEDIA_BUCKET.get(payload.imageKey);
    if (!obj) throw new Error('image not found: ' + payload.imageKey);
    const buf = new Uint8Array(await obj.arrayBuffer());
    if (buf.byteLength > 6 * 1024 * 1024) throw new Error('image too large to edit (max 6MB)');
    let b64 = '';
    for (let i = 0; i < buf.length; i += 0x8000) b64 += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    const ct = obj.httpMetadata?.contentType || 'image/png';
    const bytes = await routerImage(env, payload.prompt, `data:${ct};base64,${btoa(b64)}`);
    const base = payload.imageKey.split('/').pop()!.replace(/\.[a-z]+$/i, '');
    return { key: await store(env, prefix, base + '-edit', bytes) };
  }

  if (kind === 'grade') {
    // Deterministic ffmpeg re-grade in the container (works on any image,
    // including real-person portraits the LLM refuses to touch)
    if (!payload.imageKey) throw new Error('imageKey required');
    const { getContainer } = await import('@cloudflare/containers');
    const container = getContainer(env.YTDLP as any, 'grade');
    const res: Response = await container.fetch(new Request('http://ytdlp/grade', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + ((env as any).YTDLP_TOKEN || 'internal'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: `${CDN}/${payload.imageKey}` }),
    }));
    if (!res.ok) throw new Error(`grade failed: HTTP ${res.status} ${(await res.text()).slice(0, 150)}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const dir = payload.imageKey.includes('/') ? payload.imageKey.slice(0, payload.imageKey.lastIndexOf('/') + 1) : '';
    const base = payload.imageKey.split('/').pop()!.replace(/\.[a-z]+$/i, '');
    const key = `${dir}${base}-v2.png`;
    await env.MEDIA_BUCKET.put(key, bytes, { httpMetadata: { contentType: 'image/png' } });
    if (key.startsWith('thumbs/') && env.MEDIA_KV) {
      await env.MEDIA_KV.put(key, bytes, { metadata: { ct: 'image/png' } }).catch(() => {});
    }
    return { key };
  }

  throw new Error('Unknown image kind: ' + kind);
}
