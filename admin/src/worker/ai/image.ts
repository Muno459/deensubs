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
async function openaiImage(env: ImgEnv, prompt: string, imageBytes?: Uint8Array, imageCt = 'image/jpeg', size = 'auto', background?: string, model = 'gpt-image-2'): Promise<Uint8Array> {
  const key = (env as any).OPENAI_KEY;
  if (!key) throw new Error('OPENAI_KEY secret not set');
  let res: Response;
  if (imageBytes) {
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', prompt);
    form.append('size', size);
    if (background) form.append('background', background);
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
      body: JSON.stringify({ model: 'gpt-image-2', prompt, size, quality: 'high' }),
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
  if ((key.startsWith('thumbs/') || key.startsWith('scholars/')) && env.MEDIA_KV) {
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


  if (kind === 'scholar_magic') {
    // The magic, run as the PROVEN pipeline that shipped all 15 scholars
    // (IMG_V v9-v11): true original photo -> outpaint the scene onto a wider
    // 1536x1024 canvas (gpt-image-1 — the only edits model that honors a
    // transparent canvas) -> composite the ORIGINAL pixels back at exact
    // placement so the face is never an AI re-render -> magenta cutout ->
    // deterministic chroma key. Outpaint is an upgrade, not a gate: any
    // failure falls back to running the cutout on the raw photo.
    if (!payload.imageKey) throw new Error('imageKey required');
    const obj = await env.MEDIA_BUCKET.get(payload.imageKey);
    if (!obj) throw new Error('reference image not found: ' + payload.imageKey);
    let editInput = new Uint8Array(await obj.arrayBuffer());
    let editCt = obj.httpMetadata?.contentType || 'image/jpeg';
    const base = slugify(payload.name || 'scholar');
    const { getContainer } = await import('@cloudflare/containers');
    const cAuth = { Authorization: 'Bearer ' + ((env as any).YTDLP_TOKEN || 'internal'), 'Content-Type': 'application/json' };
    const srcUrl = `${CDN}/${payload.imageKey}?v=${Date.now()}`; // bust the 30-day edge cache
    try {
      const prep = getContainer(env.YTDLP as any, 'grade');
      // 1. Exact-geometry canvas; placement comes back in headers
      const cres: Response = await prep.fetch(new Request('http://ytdlp/grade', {
        method: 'POST', headers: cAuth,
        body: JSON.stringify({ url: srcUrl, canvas: true }),
        signal: AbortSignal.timeout(90_000),
      }));
      if (!cres.ok) throw new Error(`canvas HTTP ${cres.status}`);
      const canvas = new Uint8Array(await cres.arrayBuffer());
      const [ox, oy, ow, oh] = ['X-Ox', 'X-Oy', 'X-Ow', 'X-Oh'].map((h) => Number(cres.headers.get(h)));
      if (!ow || !oh) throw new Error('canvas placement headers missing (container still rolling out?)');
      // 2. Outpaint the scene with gpt-image-2 — measured 29dB original-region
      //    fidelity on the transparent canvas vs 11dB for gpt-image-1, so the
      //    composite-back boundary is cleaner. Never feed the model a
      //    transparent CUTOUT (only a transparent-padded natural photo) and
      //    never ask it to pose limbs — both are proven ghost/extra-hands
      //    failure modes; scene continuation of a natural photo is what works.
      const outp = await openaiImage(
        env,
        "Extend this photograph seamlessly into the transparent areas: continue the scene, background and the person's shoulders and clothing naturally with realistic slim proportions, reaching the bottom edge so the body is grounded. Do NOT add hands, arms or objects that are not already visible. Keep everything already visible EXACTLY unchanged.",
        canvas, 'image/png', '1536x1024', undefined, 'gpt-image-2'
      );
      // 3. Composite the original pixels back at the exact placement
      const tmpKey = `scribe/tmp/${base}-outp-${Date.now().toString(36)}.png`;
      await env.MEDIA_BUCKET.put(tmpKey, outp, { httpMetadata: { contentType: 'image/png' } });
      const mres: Response = await prep.fetch(new Request('http://ytdlp/grade', {
        method: 'POST', headers: cAuth,
        body: JSON.stringify({ url: `${CDN}/${tmpKey}`, overlay_url: srcUrl, ox, oy, ow, oh }),
        signal: AbortSignal.timeout(90_000),
      }));
      env.MEDIA_BUCKET.delete(tmpKey).catch(() => {});
      if (!mres.ok) throw new Error(`composite HTTP ${mres.status}`);
      editInput = new Uint8Array(await mres.arrayBuffer());
      editCt = 'image/png';
    } catch (e) {
      console.log('scholar_magic outpaint skipped:', (e as Error).message);
    }
    const KEEP = "Preserve the person's face, beard and headwear likeness EXACTLY — do not beautify, repaint or alter features. Chest-up bust composition with clean natural colors. The person occupies at MOST 70% of the frame width: keep at least 15% empty background margin on the left edge and 15% on the right edge — scale the figure down as needed, nothing may touch the side edges; only the robe/torso runs off the BOTTOM edge so the figure is grounded, never floating. Do NOT invent hands, arms or limbs that are not in the photo. Exclude tables, desks, microphones, cups and every other object — the person only.";
    const MAGENTA = 'The background must be a completely flat, uniform, solid pure magenta (#FF00FF) filling the entire frame edge to edge — no gradient, no vignette, no shadows on the background.';
    const naturalRaw = await openaiImage(env, `Cut out the person cleanly. ${MAGENTA} The person keeps clean natural tones (neutralize heavy casts on the PERSON only — the background stays vivid pure magenta, never desaturate the background). ${KEEP}`, editInput, editCt, '1024x1024');
    // Deterministic chroma-key in the container: guaranteed clean alpha
    const keyOut = async (bytes: Uint8Array, tmpName: string): Promise<Uint8Array> => {
      const tmpKey = `scribe/tmp/${tmpName}`;
      await env.MEDIA_BUCKET.put(tmpKey, bytes, { httpMetadata: { contentType: 'image/png' } });
      const container = getContainer(env.YTDLP as any, 'grade');
      const res: Response = await container.fetch(new Request('http://ytdlp/grade', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + ((env as any).YTDLP_TOKEN || 'internal'), 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: `${CDN}/${tmpKey}`, keyauto: true, out: 'webp' }),
        signal: AbortSignal.timeout(90_000),
      }));
      env.MEDIA_BUCKET.delete(tmpKey).catch(() => {});
      if (!res.ok) throw new Error(`chroma key failed: HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    };
    const natural = await keyOut(naturalRaw, `${base}-nat-${Date.now().toString(36)}.png`);
    // ONE clean natural cutout serves everything: cards (CSS mutes it, hover
    // restores color + teal glow) and the scholar page hero (transparent).
    // WebP because the site serves .webp keys untouched (.png gets rewritten
    // to .avif variants that do not exist).
    const naturalKey = `scholars/${base}-hero.webp`;
    await env.MEDIA_BUCKET.put(naturalKey, natural, { httpMetadata: { contentType: 'image/webp' } });
    if (env.MEDIA_KV) await env.MEDIA_KV.put(naturalKey, natural, { metadata: { ct: 'image/webp' } }).catch(() => {});
    return { photo: naturalKey, photo_hero: naturalKey } as any;
  }

  if (kind === 'refilter') {
    // Run an arbitrary ffmpeg filter over an existing R2 image in place
    // (e.g. alpha-erosion de-fringing) — deterministic, no model involved.
    if (!payload.imageKey || !payload.filter) throw new Error('imageKey and filter required');
    const { getContainer } = await import('@cloudflare/containers');
    const container = getContainer(env.YTDLP as any, 'grade');
    const res: Response = await container.fetch(new Request('http://ytdlp/grade', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + ((env as any).YTDLP_TOKEN || 'internal'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `${CDN}/${payload.imageKey}?rf=${Date.now()}`, filter: payload.filter, out: payload.imageKey.endsWith('.webp') ? 'webp' : undefined }),
      signal: AbortSignal.timeout(90_000),
    }));
    if (!res.ok) throw new Error(`refilter failed: HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    await env.MEDIA_BUCKET.put(payload.imageKey, bytes, {
      httpMetadata: { contentType: payload.imageKey.endsWith('.webp') ? 'image/webp' : 'image/png' },
    });
    if ((payload.imageKey.startsWith('thumbs/') || payload.imageKey.startsWith('scholars/')) && env.MEDIA_KV) {
      await env.MEDIA_KV.put(payload.imageKey, bytes, { metadata: { ct: payload.imageKey.endsWith('.webp') ? 'image/webp' : 'image/png' } }).catch(() => {});
    }
    return { key: payload.imageKey };
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
