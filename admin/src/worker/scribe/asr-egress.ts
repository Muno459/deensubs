import type { ScribeEnv } from './types';

/** A Durable Object placed (via `locationHint`) in a specific Cloudflare region.
 *  Distinct DO instances land in distinct data centers (colos) within a region,
 *  each with its own egress IP — and ElevenLabs' unauthenticated STT quota is
 *  strictly PER-IP (~8 clips; verified: an exhausted IP 401s while every other
 *  colo IP still 200s, even within the same /16 and the same ASN). So rotating a
 *  pool of these instances (asr.ts `unauthAsr`) multiplies the free quota by the
 *  number of distinct colo IPs (~24 measured across 8 instances × 9 regions),
 *  each transcribing a WHOLE file from its own IP — no chunking. */
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
      // 502 → caller rotates to the next pool instance / falls back to the proxy.
      return new Response(String(e?.message || e).slice(0, 200), { status: 502 });
    }
  }
}
