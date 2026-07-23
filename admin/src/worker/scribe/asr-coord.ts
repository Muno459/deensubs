// Full ASR quota coordinator client — implements docs/websocket-coord-spec.md
// against the proxy coordinator (e.g. ws://unifi.padborghotel.dk:5556/api/coord/ws).
//
// A persistent WebSocket session shared for the whole ASR run:
//   register → per-nic lease_request (granted / denied / queued→wait) → work →
//   lease_release. Handles refresh_pending/refresh_complete (drain a modem
//   while its IP rotates, resume when the new IP is ready), quota_updated /
//   lease_available broadcasts, ping/pong keepalive, and reconnection.
//
// Every op is time-bounded so a silent/absent coordinator degrades to
// "no lease" (transcription proceeds) rather than blocking.

type LeaseResult = { granted: boolean; leaseId?: string; remaining?: number; reason?: string };
type Waiter = (msg: any) => void;

const nicOf = (ns: string) => (ns || '').replace(/^asr\//, '');

export class AsrCoordinator {
  private ws: WebSocket | null = null;
  private pingTimer: any = null;
  private closed = false;
  // one lease request in flight at a time (the protocol has no request ids)
  private inflight: Waiter | null = null;
  private queuedLeaseId: string | null = null;
  private draining = new Set<string>();               // nics mid-IP-refresh
  private refreshWaiters = new Map<string, Waiter[]>(); // nic → resolvers waiting for refresh_complete
  private availWaiters: Waiter[] = [];                 // resolvers waiting for lease_available

  private constructor(private wsUrl: string, private nics: string[], private clientId: string) {}

  static async connect(wsUrl: string, nics: string[]): Promise<AsrCoordinator | null> {
    if (!wsUrl) return null;
    const c = new AsrCoordinator(wsUrl, nics, `deensubs-${crypto.randomUUID().slice(0, 8)}`);
    return (await c.open()) ? c : null;
  }

  private async open(): Promise<boolean> {
    try {
      const q = `client_id=${encodeURIComponent(this.clientId)}&namespaces=${this.nics.map((n) => 'asr/' + n).join(',')}`;
      const url = this.wsUrl.replace(/^ws/, 'http') + (this.wsUrl.includes('?') ? '&' : '?') + q;
      const resp = await Promise.race([
        fetch(url, { headers: { Upgrade: 'websocket' } }),
        new Promise<Response>((_, r) => setTimeout(() => r(new Error('coord connect timeout')), 6000)),
      ]);
      const ws = (resp as any).webSocket as WebSocket | undefined;
      if (!ws) return false;
      ws.accept();
      this.ws = ws;
      ws.addEventListener('message', (e: any) => this.onMessage(e));
      ws.addEventListener('close', () => { if (!this.closed) this.reconnectSoon(); });
      ws.addEventListener('error', () => { if (!this.closed) this.reconnectSoon(); });
      ws.send(JSON.stringify({ type: 'register', namespaces: this.nics.map((n) => 'asr/' + n) }));
      this.pingTimer = setInterval(() => { try { this.ws?.send(JSON.stringify({ type: 'ping' })); } catch {} }, 30_000);
      return true;
    } catch {
      return false;
    }
  }

  private reconnectSoon() {
    this.ws = null;
    clearInterval(this.pingTimer);
    // best-effort single reconnect; leases in flight resolve via their timeouts
    setTimeout(() => { if (!this.closed && !this.ws) this.open().catch(() => {}); }, 3000);
  }

  private onMessage(e: any) {
    let m: any;
    try { m = JSON.parse(typeof e.data === 'string' ? e.data : ''); } catch { return; }
    switch (m.type) {
      case 'lease_granted':
      case 'lease_denied':
        this.inflight?.(m);
        break;
      case 'lease_queued':
        this.queuedLeaseId = m.lease_id || null; // keep waiting for the matching lease_granted
        break;
      case 'refresh_pending':
        this.draining.add(nicOf(m.namespace));
        break;
      case 'refresh_complete': {
        const nic = nicOf(m.namespace);
        this.draining.delete(nic);
        (this.refreshWaiters.get(nic) || []).forEach((w) => w(m));
        this.refreshWaiters.delete(nic);
        this.availWaiters.splice(0).forEach((w) => w(m));
        break;
      }
      case 'lease_available':
        this.availWaiters.splice(0).forEach((w) => w(m));
        break;
      case 'quota_updated':
      case 'pong':
      case 'connected':
      case 'registered':
        break;
    }
  }

  isDraining(nic: string): boolean {
    return this.draining.has(nic);
  }

  /** Wait until `nic` finishes its IP refresh, or the drain timeout elapses. */
  waitReady(nic: string, ms = 35_000): Promise<void> {
    if (!this.draining.has(nic)) return Promise.resolve();
    return new Promise((resolve) => {
      const to = setTimeout(resolve, ms);
      const list = this.refreshWaiters.get(nic) || [];
      list.push(() => { clearTimeout(to); resolve(); });
      this.refreshWaiters.set(nic, list);
    });
  }

  /** Wait for freed quota (lease_available / refresh_complete), bounded. */
  waitAvailable(ms = 30_000): Promise<void> {
    return new Promise((resolve) => {
      const to = setTimeout(resolve, ms);
      this.availWaiters.push(() => { clearTimeout(to); resolve(); });
    });
  }

  /** Request a lease for `minutes` on `nic`. Waits through a queue up to
   *  `maxWaitMs`; resolves granted:false on denial/timeout so the caller can
   *  try another nic, wait, or fall back to authenticated. */
  async lease(nic: string, minutes: number, maxWaitMs = 20_000): Promise<LeaseResult> {
    if (!this.ws) return { granted: false, reason: 'disconnected' };
    if (this.draining.has(nic)) await this.waitReady(nic);
    return new Promise<LeaseResult>((resolve) => {
      let done = false;
      const finish = (r: LeaseResult) => { if (!done) { done = true; this.inflight = null; this.queuedLeaseId = null; resolve(r); } };
      const to = setTimeout(() => finish({ granted: false, reason: 'lease timeout' }), maxWaitMs);
      this.inflight = (m: any) => {
        if (m.type === 'lease_granted') { clearTimeout(to); finish({ granted: true, leaseId: m.lease_id, remaining: m.remaining }); }
        else if (m.type === 'lease_denied') { clearTimeout(to); finish({ granted: false, reason: m.reason || 'denied', remaining: m.remaining }); }
      };
      try {
        this.ws!.send(JSON.stringify({ type: 'lease_request', namespace: 'asr/' + nic, minutes, queue: true, client_id: this.clientId }));
      } catch {
        clearTimeout(to);
        finish({ granted: false, reason: 'send failed' });
      }
    });
  }

  release(leaseId: string, actualMinutes: number, success: boolean): void {
    try { this.ws?.send(JSON.stringify({ type: 'lease_release', lease_id: leaseId, actual_minutes: actualMinutes, success })); } catch {}
  }

  close(): void {
    this.closed = true;
    clearInterval(this.pingTimer);
    try { this.ws?.close(); } catch {}
    this.ws = null;
  }
}
