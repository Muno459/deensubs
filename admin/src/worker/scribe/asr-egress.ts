import type { ScribeEnv } from './types';

/** A Durable Object placed (via `locationHint`) in a specific Cloudflare region
 *  so its outbound `fetch` egresses from THAT region's IP. Used to multiply the
 *  unauthenticated ElevenLabs STT per-IP quota: each region is a distinct egress
 *  IP with its own ~8-clip quota, and each instance transcribes a WHOLE file
 *  from its own IP (no chunking). Verified: 9 region hints → distinct egress IPv4. */
export class AsrEgress {
  private env: ScribeEnv;
  constructor(_state: DurableObjectState, env: ScribeEnv) {
    this.env = env;
  }
  async fetch(req: Request): Promise<Response> {
    try {
      const { url } = (await req.json()) as { url: string };
      const { directUnauthStt } = await import('./asr');
      const data = await directUnauthStt(this.env, url, /* withFormats */ true, /* attempts */ 1);
      return Response.json(data);
    } catch (e: any) {
      // 502 → caller rotates to the next region / falls back to the proxy.
      return new Response(String(e?.message || e).slice(0, 200), { status: 502 });
    }
  }
}
