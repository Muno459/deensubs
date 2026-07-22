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
  // Idle instances shut down on their own. Kept short so batch imports free
  // their max_instances slots quickly — active work (download polls, file
  // streaming) resets the timer, so this only trims post-work lingering.
  sleepAfter = '3m';

  constructor(ctx: any, env: ContainerEnv) {
    super(ctx, env);
    this.envVars = {
      YTDLP_TOKEN: env.YTDLP_TOKEN || 'internal',
      YTDLP_PROXIES: env.YTDLP_PROXIES || '',
    };
  }
}

// Same image, but a bigger instance type (see wrangler.toml). Handles the
// CPU-heavy ffmpeg work — viral clip renders (libx264) and image grading —
// so downloads (network-bound, light) can run on a smaller, cheaper instance.
export class ClipContainer extends Container<ContainerEnv> {
  defaultPort = 8199;
  sleepAfter = '3m';

  constructor(ctx: any, env: ContainerEnv) {
    super(ctx, env);
    this.envVars = {
      YTDLP_TOKEN: env.YTDLP_TOKEN || 'internal',
      YTDLP_PROXIES: env.YTDLP_PROXIES || '',
    };
  }
}
