// DeenSubs Companion server side.
//
// CompanionHub — a Durable Object holding LIVE WebSocket connections from
// every running Companion app (role=companion) and every open admin
// dashboard (role=watch). Companions stream their task status; the hub
// broadcasts the full roster to everyone on any change, so both the admin
// page and each companion's peer list update in real time. The workflow
// asks the hub who is online before deciding to offload a download or an
// enhancement instead of using the proxy container.

export type CompanionInfo = {
  name: string;
  version: string;
  caps: string[]; // 'download' | 'encode' | 'enhance-cuda' | 'enhance-cpu'
  tasks: { kind: string; label: string; pct: number }[];
  since: number;
};

export class CompanionHub {
  private companions = new Map<WebSocket, CompanionInfo>();
  private watchers = new Set<WebSocket>();

  constructor(private state: DurableObjectState, private env: any) {}

  private roster(): CompanionInfo[] {
    return [...this.companions.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  private broadcast() {
    const msg = JSON.stringify({ type: 'roster', companions: this.roster() });
    for (const ws of [...this.companions.keys(), ...this.watchers]) {
      try { ws.send(msg); } catch {}
    }
  }

  private drop(ws: WebSocket) {
    const had = this.companions.delete(ws);
    this.watchers.delete(ws);
    if (had) this.broadcast();
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname.endsWith('/roster')) {
      return Response.json({ companions: this.roster() });
    }

    if (req.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const role = url.searchParams.get('role') === 'watch' ? 'watch' : 'companion';
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    server.accept();

    if (role === 'watch') {
      this.watchers.add(server);
    } else {
      this.companions.set(server, {
        name: (url.searchParams.get('name') || 'companion').slice(0, 40),
        version: (url.searchParams.get('version') || '').slice(0, 20),
        caps: (url.searchParams.get('caps') || '').split(',').filter(Boolean),
        tasks: [],
        since: Date.now(),
      });
      this.broadcast();
    }

    server.addEventListener('message', (ev) => {
      const info = this.companions.get(server);
      if (!info) return; // watchers only listen
      try {
        const msg = JSON.parse(String(ev.data));
        if (Array.isArray(msg.tasks)) {
          info.tasks = msg.tasks.slice(0, 12).map((t: any) => ({
            kind: String(t.kind || '').slice(0, 16),
            label: String(t.label || '').slice(0, 80),
            pct: Math.max(0, Math.min(100, Number(t.pct) || 0)),
          }));
        }
        if (Array.isArray(msg.caps)) info.caps = msg.caps.map(String);
        this.broadcast();
      } catch {}
    });
    server.addEventListener('close', () => this.drop(server));
    server.addEventListener('error', () => this.drop(server));

    // fresh socket gets the current roster immediately
    try { server.send(JSON.stringify({ type: 'roster', companions: this.roster() })); } catch {}

    return new Response(null, { status: 101, webSocket: client });
  }
}

/** Ask the hub who is online (used by workflows deciding to offload). */
export async function onlineCompanions(env: any): Promise<CompanionInfo[]> {
  try {
    const stub = env.HUB.get(env.HUB.idFromName('hub'));
    const res = await stub.fetch('http://hub/roster');
    const data: any = await res.json();
    return data.companions || [];
  } catch {
    return [];
  }
}

export function hasCap(list: CompanionInfo[], cap: string): boolean {
  return list.some((c) => c.caps.some((x) => x === cap || x.startsWith(cap)));
}

// ---- proxy selection ------------------------------------------------------

export function parseProxies(env: any): string[] {
  return String(env.YTDLP_PROXIES || '').split(',').map((s: string) => s.trim()).filter(Boolean);
}

export function maskProxy(p: string): string {
  // socks5://user:pass@host:port → host:port with the middle elided
  const host = p.replace(/^\w+:\/\//, '').replace(/^[^@]*@/, '');
  return host.length > 22 ? host.slice(0, 10) + '…' + host.slice(-9) : host;
}

export async function selectedProxy(env: any): Promise<string | null> {
  try {
    const row: any = await env.DB.prepare("SELECT value FROM config WHERE name = 'active_proxy'").first();
    const v = row?.value;
    if (v == null || v === 'auto') return null;
    const list = parseProxies(env);
    const i = parseInt(v);
    return Number.isInteger(i) && list[i] ? list[i] : null;
  } catch {
    return null;
  }
}
