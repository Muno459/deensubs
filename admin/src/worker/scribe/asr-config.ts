// ASR mode configuration, editable from the /tools page and stored in KV.
//
// Two transcription modes:
//  - authenticated: an ElevenLabs API key is set → send the WHOLE file in one
//    request (source_url), no chunking, synchronous response.
//  - proxy: no API key → hit the unauthenticated STT endpoint through SOCKS
//    proxies (residential IPs) with source_url, chunked into ~80-min segments,
//    synchronous response (webhooks are NOT supported unauthenticated). Quota
//    across the proxies is coordinated over a WebSocket.

export type AsrConfig = {
  mode: 'auto' | 'authenticated' | 'proxy';
  chunkMinutes: number; // proxy-mode segment length (ElevenLabs edge ~caps long unauth calls)
  proxies: string[]; // SOCKS5 URLs for ElevenLabs STT; a `{SESSION}` placeholder is
                     // replaced per request with a fresh id (SpyderProxy sticky session)
  ytProxy: string; // SOCKS5 URL for the YouTube /player extraction (rotating). Download stays Worker-native.
  wsUrl: string; // legacy quota-coordination WebSocket (unused — coordinator disabled)
};

export const DEFAULT_ASR_CONFIG: AsrConfig = {
  mode: 'auto',
  chunkMinutes: 80,
  proxies: [],
  ytProxy: '',
  wsUrl: '',
};

const KV_KEY = 'asr:config';

export async function getAsrConfig(env: any): Promise<AsrConfig> {
  try {
    const raw = await env.MEDIA_KV?.get(KV_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_ASR_CONFIG,
        ...parsed,
        proxies: Array.isArray(parsed.proxies) ? parsed.proxies.filter((p: any) => typeof p === 'string' && p.trim()) : [],
        chunkMinutes: Math.max(5, Math.min(120, Number(parsed.chunkMinutes) || 80)),
      };
    }
  } catch {}
  return DEFAULT_ASR_CONFIG;
}

export async function putAsrConfig(env: any, cfg: Partial<AsrConfig>): Promise<AsrConfig> {
  const merged = { ...(await getAsrConfig(env)), ...cfg };
  const clean: AsrConfig = {
    mode: (['auto', 'authenticated', 'proxy'] as const).includes(merged.mode as any) ? merged.mode : 'auto',
    chunkMinutes: Math.max(5, Math.min(120, Number(merged.chunkMinutes) || 80)),
    proxies: (merged.proxies || []).filter((p) => typeof p === 'string' && p.trim()).map((p) => p.trim()),
    ytProxy: (merged.ytProxy || '').trim(),
    wsUrl: (merged.wsUrl || '').trim(),
  };
  await env.MEDIA_KV?.put(KV_KEY, JSON.stringify(clean));
  return clean;
}

/** Which mode actually runs, given the config + whether an API key is present. */
export function resolveAsrMode(cfg: AsrConfig, hasApiKey: boolean): 'authenticated' | 'proxy' {
  if (cfg.mode === 'authenticated') return 'authenticated';
  if (cfg.mode === 'proxy') return 'proxy';
  return hasApiKey ? 'authenticated' : 'proxy'; // auto
}
