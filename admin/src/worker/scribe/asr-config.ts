// ASR mode configuration, editable from the /tools page and stored in KV.
//
// Two transcription modes:
//  - authenticated: an ElevenLabs API key is set → send the WHOLE file in one
//    request (source_url), no chunking, synchronous response.
//  - proxy: no API key → hit the unauthenticated STT endpoint. The primary path
//    (asr.ts) transcribes the whole file direct from the Worker + region egress
//    IPs (no proxy). Only when every Cloudflare IP is rate-limited does it fall
//    back to residential SOCKS proxies (asr-proxy.ts), chunked to clear the
//    proxy's ~60s idle timeout (see PROXY_CHUNK_MAX_MIN), each chunk on a fresh
//    rotating IP. Synchronous response (webhooks are NOT supported unauth).

// Largest proxy chunk that reliably clears SpyderProxy's ~60s idle timeout.
// MEASURED through SpyderProxy on a real lecture: chunks ≤18 min transcribe with
// the idle gap (ElevenLabs processing before the first response byte) under 60s
// and succeed; ≥25 min chunks drop at ~60s mid-processing ("no header
// terminator"). 18 is the proven ceiling; the default (10) leaves margin for
// ElevenLabs load variance. Retry can't rescue an oversized chunk (the idle gap
// is deterministic), so the clamp hard-caps it below the wall.
export const PROXY_CHUNK_MAX_MIN = 18;
export const PROXY_CHUNK_DEFAULT_MIN = 10;

export type AsrConfig = {
  mode: 'auto' | 'authenticated' | 'proxy';
  chunkMinutes: number; // proxy-fallback segment length; clamped to [3, PROXY_CHUNK_MAX_MIN]
  proxies: string[]; // SOCKS5 URLs for ElevenLabs STT; a `{SESSION}` placeholder is
                     // replaced per request with a fresh id (SpyderProxy sticky session)
  ytProxy: string; // SOCKS5 URL for the YouTube /player extraction (rotating). Download stays Worker-native.
  wsUrl: string; // legacy quota-coordination WebSocket (unused — coordinator disabled)
};

export const DEFAULT_ASR_CONFIG: AsrConfig = {
  mode: 'auto',
  chunkMinutes: PROXY_CHUNK_DEFAULT_MIN,
  proxies: [],
  ytProxy: '',
  wsUrl: '',
};

/** Clamp a proxy chunk length to the safe [3, PROXY_CHUNK_MAX_MIN] window. */
function clampChunkMinutes(v: any): number {
  return Math.max(3, Math.min(PROXY_CHUNK_MAX_MIN, Number(v) || PROXY_CHUNK_DEFAULT_MIN));
}

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
        chunkMinutes: clampChunkMinutes(parsed.chunkMinutes),
      };
    }
  } catch {}
  return DEFAULT_ASR_CONFIG;
}

export async function putAsrConfig(env: any, cfg: Partial<AsrConfig>): Promise<AsrConfig> {
  const merged = { ...(await getAsrConfig(env)), ...cfg };
  const clean: AsrConfig = {
    mode: (['auto', 'authenticated', 'proxy'] as const).includes(merged.mode as any) ? merged.mode : 'auto',
    chunkMinutes: clampChunkMinutes(merged.chunkMinutes),
    proxies: (merged.proxies || []).filter((p) => typeof p === 'string' && p.trim()).map((p) => p.trim()),
    ytProxy: (merged.ytProxy || '').trim(),
    wsUrl: (merged.wsUrl || '').trim(),
  };
  await env.MEDIA_KV?.put(KV_KEY, JSON.stringify(clean));
  return clean;
}

/** Which mode actually runs. `authenticated` FORCES the paid API for the whole
 *  file (skips the free tiers). `proxy` and `auto` both run the free-first chain
 *  (CF colo pool → SpyderProxy → authenticated backstop; see asr.ts `unauthAsr`),
 *  so we never pay when a cheaper tier can serve the request — even when an API
 *  key is configured, the key is only the final fallback, not the default. */
export function resolveAsrMode(cfg: AsrConfig, _hasApiKey: boolean): 'authenticated' | 'proxy' {
  return cfg.mode === 'authenticated' ? 'authenticated' : 'proxy';
}
