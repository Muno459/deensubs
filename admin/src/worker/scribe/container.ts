// Cloudflare Container wrapper for the yt-dlp helper. One instance per
// download job (named by jobId) so parallel jobs stay isolated. The
// container is only reachable through this Durable Object binding — the
// bearer token is defense in depth, not the perimeter.

import { Container } from '@cloudflare/containers';

type ContainerEnv = {
  YTDLP_TOKEN?: string;
  YTDLP_PROXIES?: string;
};

export class YtdlpContainer extends Container<ContainerEnv> {
  defaultPort = 8199;
  sleepAfter = '15m'; // idle instances shut down on their own

  constructor(ctx: any, env: ContainerEnv) {
    super(ctx, env);
    this.envVars = {
      YTDLP_TOKEN: env.YTDLP_TOKEN || 'internal',
      YTDLP_PROXIES: env.YTDLP_PROXIES || '',
    };
  }
}
