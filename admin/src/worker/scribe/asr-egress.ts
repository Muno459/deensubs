import type { ScribeEnv } from './types';

/** A Durable Object placed (via `locationHint`) in a specific Cloudflare region.
 *  Distinct DO instances land in distinct data centers (colos), each with its own
 *  egress IP — and ElevenLabs' unauthenticated STT quota is strictly PER-IP (~8
 *  clips; an exhausted IP 401s while every other colo IP still 200s, even within
 *  the same /16 and ASN). So rotating a pool of these instances (asr.ts
 *  `unauthAsr`) multiplies the free quota by the number of distinct colo IPs.
 *  Each response carries this colo's egress IP in `x-egress-ip` (echoed CONCURRENTLY
 *  with the transcription, so no added latency) — the caller cools + dedups the
 *  ~24 distinct IPs by exact IP rather than by the 72 (redundant) instance names. */
export class AsrEgress {
  private env: ScribeEnv;
  constructor(_state: DurableObjectState, env: ScribeEnv) {
    this.env = env;
  }
  async fetch(req: Request): Promise<Response> {
    const { echoEgressIp } = await import('./asr');
    const ipP = echoEgressIp(); // concurrent with the STT below → zero added latency
    try {
      const { url } = (await req.json()) as { url: string };
      const { directUnauthStt } = await import('./asr');
      const data = await directUnauthStt(this.env, url, /* withFormats */ true, /* attempts */ 1);
      return Response.json(data, { headers: { 'x-egress-ip': await ipP } });
    } catch (e: any) {
      // 502 → caller rotates to the next pool instance / falls back to the proxy.
      return new Response(String(e?.message || e).slice(0, 200), { status: 502, headers: { 'x-egress-ip': await ipP } });
    }
  }
}
