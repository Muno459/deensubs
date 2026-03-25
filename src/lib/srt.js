// Server-side SRT parser
export async function parseSRT(env, srtKey) {
  if (!srtKey) return [];
  try {
    const obj = await env.MEDIA_BUCKET.get(srtKey);
    if (!obj) return [];
    const text = await obj.text();
    return text.trim().split(/\n\n+/).map(block => {
      const lines = block.split('\n');
      if (lines.length < 3) return null;
      const m = lines[1]?.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
      if (!m) return null;
      return {
        start: +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000,
        end: +m[5] * 3600 + +m[6] * 60 + +m[7] + +m[8] / 1000,
        text: lines.slice(2).join(' '),
      };
    }).filter(Boolean);
  } catch {
    return [];
  }
}
