// Thumbnail language review: vision-detect Arabic text on catalog thumbnails
// so imported artwork gets English replacements before viewers see it.
import { llmChat } from './scribe/translate';

const CDN = 'https://cdn.deensubs.com';

async function imagePart(key: string): Promise<any | null> {
  const res = await fetch(`${CDN}/${encodeURI(key)}`);
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  if (!buf.byteLength || buf.byteLength > 3_000_000) return null;
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { type: 'image_url', image_url: { url: `data:${res.headers.get('content-type') || 'image/jpeg'};base64,${btoa(bin)}` } };
}

/** Frames sampled across one video: is it an audiobook wearing a video
    container (static artwork / audio visualizer)? */
export async function detectStaticVideo(env: any, frameKeys: string[]): Promise<boolean | null> {
  try {
    const parts: any[] = [{
      type: 'text',
      text: 'These frames are sampled from DIFFERENT points across one video (early, middle, late). Is this really an audio recording in a video container: essentially the same static artwork throughout, or an audio-visualizer (waveform/spectrum bars) over a fixed background? Footage of people, slides that change, or moving scenes is NOT static. Reply ONLY JSON: {"static": true|false}',
    }];
    for (const k of frameKeys.slice(0, 3)) {
      const p = await imagePart(k);
      if (p) parts.push(p);
    }
    if (parts.length < 3) return null;
    const raw = await llmChat(env, [{ role: 'user', content: parts as any }], 200);
    const m = raw.match(/"static"\s*:\s*(true|false)/i);
    return m ? m[1].toLowerCase() === 'true' : null;
  } catch {
    return null;
  }
}

export async function detectArabicThumb(
  env: any,
  key: string
): Promise<{ arabic: boolean; text: string } | null> {
  try {
    const res = await fetch(`${CDN}/${encodeURI(key)}`);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > 3_000_000) return null;
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const b64 = btoa(bin);
    const mime = res.headers.get('content-type') || 'image/jpeg';
    const raw = await llmChat(env, [
      {
        role: 'system',
        content:
          'You inspect a video thumbnail. Reply with ONLY JSON: {"arabic": true|false, "text": "..."} — arabic is true only if the image contains visible Arabic-script text (titles, captions, logos, watermarks all count); text carries a SHORT sample of the Arabic (max 10 words, no quotation marks inside). No markdown.',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Does this thumbnail contain Arabic text?' },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
        ] as any,
      },
    ], 400);
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        const o = JSON.parse(m[0]);
        return { arabic: !!o.arabic, text: String(o.text || '').slice(0, 300) };
      } catch { /* dense Arabic with quotes breaks the JSON — fall through */ }
    }
    const bm = raw.match(/"arabic"\s*:\s*(true|false)/i);
    if (bm) return { arabic: bm[1].toLowerCase() === 'true', text: '' };
    return null;
  } catch {
    return null;
  }
}
