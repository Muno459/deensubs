// AI image generation + editing (router ag/gemini-3.1-flash-image) and the
// deterministic v2 brand re-grade (container ffmpeg — the image model refuses
// to edit photos of real people, so portraits go through the filter chain).

import type { ScribeEnv } from '../scribe/types';

const CDN = 'https://cdn.deensubs.com';

type ImgEnv = ScribeEnv & { MEDIA_KV?: KVNamespace; YTDLP: any };

function slugify(s: string): string {
  return (s || 'ai').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'ai';
}

/** OpenAI gpt-image-1: excellent text rendering + edits photos with people
 * (the gemini route refuses those). Primary for generation and all edits. */
async function openaiImage(env: ImgEnv, prompt: string, imageBytes?: Uint8Array, imageCt = 'image/jpeg'): Promise<Uint8Array> {
  const key = (env as any).OPENAI_KEY;
  if (!key) throw new Error('OPENAI_KEY secret not set');
  let res: Response;
  if (imageBytes) {
    const form = new FormData();
    form.append('model', 'gpt-image-1');
    form.append('prompt', prompt);
    form.append('size', '1536x1024');
    form.append('quality', 'high');
    form.append('image', new Blob([imageBytes as any], { type: imageCt }), 'image.' + (imageCt.includes('png') ? 'png' : 'jpg'));
    res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key },
      body: form,
    });
  } else {
    res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-image-1', prompt, size: '1536x1024', quality: 'high' }),
    });
  }
  if (!res.ok) throw new Error(`OpenAI image HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI returned no image');
  return Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
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
    let bytes: Uint8Array;
    try {
      bytes = await openaiImage(env, payload.prompt);
    } catch {
      bytes = await routerImage(env, payload.prompt);
    }
    return { key: await store(env, prefix, payload.name || 'generated', bytes) };
  }

  if (kind === 'edit') {
    if (!payload.imageKey || !payload.prompt) throw new Error('imageKey and prompt required');
    const obj = await env.MEDIA_BUCKET.get(payload.imageKey);
    if (!obj) throw new Error('image not found: ' + payload.imageKey);
    const buf = new Uint8Array(await obj.arrayBuffer());
    if (buf.byteLength > 15 * 1024 * 1024) throw new Error('image too large to edit (max 15MB)');
    const ct = obj.httpMetadata?.contentType || 'image/png';
    const bytes = await openaiImage(env, payload.prompt, buf, ct);
    const base = payload.imageKey.split('/').pop()!.replace(/\.[a-z]+$/i, '');
    return { key: await store(env, prefix, base + '-edit', bytes) };
  }

  if (kind === 'thumb_translate') {
    // Automagic: fetch the original platform thumbnail and re-render it with
    // all Arabic text translated to English — layout/person/design preserved.
    if (!payload.jobId) throw new Error('jobId required');
    const cacheKey = `scribe/${payload.jobId}/thumb-en.png`;
    if (!payload.refresh) {
      const cached = await env.MEDIA_BUCKET.head(cacheKey);
      if (cached) return { key: cacheKey };
    }
    const job: any = await env.DB.prepare('SELECT thumb_url FROM scribe_jobs WHERE id = ?').bind(payload.jobId).first();
    if (!job?.thumb_url) throw new Error('This job has no original thumbnail');
    // Prefer the max-res variant when the platform has one
    const urls = [job.thumb_url.replace(/hqdefault|sddefault|mqdefault/, 'maxresdefault'), job.thumb_url];
    let src: Response | null = null;
    for (const u of [...new Set(urls)]) {
      const r = await fetch(u);
      if (r.ok) { src = r; break; }
    }
    if (!src) throw new Error('Could not fetch the original thumbnail');
    const srcBytes = new Uint8Array(await src.arrayBuffer());
    const bytes = await openaiImage(
      env,
      'Recreate this video thumbnail exactly, but translate all Arabic (or other non-English) text into natural, concise English. Keep the layout, colors, person, background, badges and composition identical. Render the English text in a matching bold style, correctly spelled.',
      srcBytes,
      src.headers.get('content-type') || 'image/jpeg'
    );
    await env.MEDIA_BUCKET.put(cacheKey, bytes, { httpMetadata: { contentType: 'image/png' } });
    return { key: cacheKey };
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
