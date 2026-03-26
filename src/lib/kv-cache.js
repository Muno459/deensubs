// KV-backed cache for frequently-read, rarely-changed data
// Reads from nearest PoP (<1ms), falls back to D1 on miss

const TTL = 300; // 5 minutes

export async function kvGet(env, key, fetcher) {
  // Try KV first (global edge, <1ms)
  const cached = await env.CACHE.get(key, 'json');
  if (cached) return cached;

  // Miss — fetch from D1 and cache
  const data = await fetcher();
  await env.CACHE.put(key, JSON.stringify(data), { expirationTtl: TTL });
  return data;
}

// Invalidate specific keys (call after writes)
export async function kvInvalidate(env, ...keys) {
  for (const key of keys) {
    await env.CACHE.delete(key);
  }
}

// Common cached queries
export async function getCategories(env) {
  const { readDB } = await import('./db.js');
  return kvGet(env, 'categories', async () => {
    return (await readDB(env).prepare('SELECT * FROM categories ORDER BY name').all()).results;
  });
}

export async function getScholars(env) {
  const { readDB } = await import('./db.js');
  return kvGet(env, 'scholars', async () => {
    return (await readDB(env).prepare('SELECT * FROM scholars ORDER BY name').all()).results;
  });
}
