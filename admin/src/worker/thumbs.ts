// Thumbnail language review: vision-detect Arabic text on catalog thumbnails
// so imported artwork gets English replacements before viewers see it.
import { llmChat } from './scribe/translate';

const CDN = 'https://cdn.deensubs.com';

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
