// Server-side SRT parser with KV caching
export async function parseSRT(env, srtKey) {
  if (!srtKey) return [];

  // Check KV cache first
  const cacheKey = 'srt:' + srtKey;
  try {
    const cached = await env.CACHE.get(cacheKey, 'json');
    if (cached) return cached;
  } catch {}

  try {
    const obj = await env.MEDIA_BUCKET.get(srtKey);
    if (!obj) return [];
    const text = await obj.text();
    const cues = text.trim().split(/\n\n+/).map(block => {
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

    // Cache parsed cues for 24 hours (SRT files don't change)
    try { await env.CACHE.put(cacheKey, JSON.stringify(cues), { expirationTtl: 86400 }); } catch {}
    return cues;
  } catch {
    return [];
  }
}
