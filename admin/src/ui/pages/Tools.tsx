import { useState, useEffect } from 'react';
import { api, useApi } from '../lib/api';
import { fmtBytes, fmtAgo } from '../lib/format';
import { GlowCard, SectionTitle, Button, inputCls, Table, Badge } from '../components/Primitives';
import { BlurFade } from '../components/BlurFade';
import { Icon } from '../components/Icon';

// Dual ElevenLabs ASR: authenticated (API key → whole file, no chunk) vs
// unauthenticated via SOCKS proxies (chunked, source_url, WS-coordinated quota).
function AsrSettings() {
  const { data, loading, refetch } = useApi<any>('/api/asr-config');
  const [mode, setMode] = useState('auto');
  const [chunk, setChunk] = useState('80');
  const [proxies, setProxies] = useState('');
  const [wsUrl, setWsUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');

  useEffect(() => {
    if (!data) return;
    setMode(data.mode || 'auto');
    setChunk(String(data.chunkMinutes ?? 80));
    setProxies((data.proxies || []).join('\n'));
    setWsUrl(data.wsUrl || '');
  }, [data]);

  async function save() {
    setSaving(true); setSaved('');
    try {
      const r = await api('/api/asr-config', { method: 'POST', body: JSON.stringify({
        mode,
        chunkMinutes: Number(chunk) || 80,
        proxies: proxies.split('\n').map((s) => s.trim()).filter(Boolean),
        wsUrl: wsUrl.trim(),
      }) });
      setSaved('Saved — active mode: ' + r.activeMode);
      refetch();
    } catch (e: any) { setSaved('Failed: ' + e.message); }
    setSaving(false);
  }

  const active = data?.activeMode;
  const proxyActive = active === 'proxy';
  return (
    <GlowCard className="p-5">
      <SectionTitle
        right={
          <Badge tone={active === 'authenticated' ? 'gold' : 'dim'}>
            {loading ? '…' : active === 'authenticated' ? 'authenticated · no chunk' : 'proxy · chunked'}
          </Badge>
        }
      >
        ElevenLabs transcription
      </SectionTitle>
      <p className="text-[13px] leading-relaxed text-muted">
        With an API key set, the whole file transcribes in one request (no chunking, synchronous response — this is what
        fixes the 2-hour timeouts). Without a key, audio is chunked and sent unauthenticated through your SOCKS proxies
        (residential IPs) via <code className="text-cream/80">source_url</code>, quota coordinated over a WebSocket.
      </p>

      <div className="mt-3 flex items-center gap-2 text-[12px]">
        <span className="text-muted">API key:</span>
        <Badge tone={data?.hasApiKey ? 'gold' : 'dim'}>{data?.hasApiKey ? 'set (ELEVENLABS_API_KEY)' : 'not set'}</Badge>
      </div>

      <div className="mt-4 space-y-4">
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-faint">Mode</label>
          <div className="flex flex-wrap gap-2">
            {[
              ['auto', 'Auto (key → authenticated)'],
              ['authenticated', 'Authenticated (no chunk)'],
              ['proxy', 'Proxy (chunked)'],
            ].map(([v, label]) => (
              <button
                key={v}
                onClick={() => setMode(v)}
                className={`rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
                  mode === v ? 'border-gold/40 bg-gold/10 text-gold-bright' : 'border-hairline bg-soft text-muted hover:text-cream'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className={proxyActive || mode !== 'authenticated' ? '' : 'opacity-50'}>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-faint">
                SOCKS proxies (one per line)
              </label>
              <textarea
                className={inputCls + ' h-20 w-full resize-y font-mono text-[12px]'}
                value={proxies}
                onChange={(e) => setProxies(e.target.value)}
                placeholder="socks5://user:pass@host:1080&#10;socks5://user:pass@host2:1080"
              />
            </div>
            <div className="sm:w-28">
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-faint">Chunk (min)</label>
              <input className={inputCls + ' w-full font-mono'} value={chunk} onChange={(e) => setChunk(e.target.value)} inputMode="numeric" />
            </div>
          </div>
          <label className="mb-1.5 mt-3 block text-[11px] font-semibold uppercase tracking-wide text-faint">
            Quota-coordination WebSocket
          </label>
          <input
            className={inputCls + ' w-full font-mono text-[12px]'}
            value={wsUrl}
            onChange={(e) => setWsUrl(e.target.value)}
            placeholder="ws://unifi.padborghotel.dk:5556/api/coord/ws"
          />
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          {saved && <span className="text-[12px] text-gold-bright">{saved}</span>}
        </div>
      </div>
    </GlowCard>
  );
}

export default function Tools() {
  const [purgeResult, setPurgeResult] = useState('');
  const [purging, setPurging] = useState(false);
  const [prefix, setPrefix] = useState('videos/');
  const r2 = useApi<any>(`/api/r2?prefix=${encodeURIComponent(prefix)}`);
  const logs = useApi<any>('/api/admin-logs');

  async function purge() {
    setPurging(true);
    setPurgeResult('');
    try {
      const r = await api('/api/purge-cache', { method: 'POST' });
      setPurgeResult(`Purged ${r.deleted} cache keys.`);
    } catch (e: any) {
      setPurgeResult('Failed: ' + e.message);
    }
    setPurging(false);
  }

  return (
    <div className="space-y-6">
      <BlurFade>
        <AsrSettings />
      </BlurFade>

      <div className="grid gap-6 lg:grid-cols-2">
        <BlurFade>
          <GlowCard className="p-5">
            <SectionTitle>Cache</SectionTitle>
            <p className="text-[13px] leading-relaxed text-muted">
              Purge every KV cache entry so the site serves fresh data on the next request. Sessions are re-cached
              automatically.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <Button onClick={purge} disabled={purging} className="flex items-center gap-1.5">
                <Icon name="refresh" className="h-4 w-4" />
                {purging ? 'Purging...' : 'Purge KV cache'}
              </Button>
              {purgeResult && <span className="text-[12px] text-gold-bright">{purgeResult}</span>}
            </div>
          </GlowCard>
        </BlurFade>

        <BlurFade delay={0.05}>
          <GlowCard className="p-5">
            <SectionTitle>Exports</SectionTitle>
            <p className="text-[13px] leading-relaxed text-muted">Download platform data as CSV.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <a href="/api/export/videos" className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-soft px-3.5 py-2 text-[13px] font-semibold text-cream transition-all hover:bg-hover active:scale-[0.97]">
                <Icon name="download" className="h-4 w-4" /> Videos CSV
              </a>
              <a href="/api/export/users" className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-soft px-3.5 py-2 text-[13px] font-semibold text-cream transition-all hover:bg-hover active:scale-[0.97]">
                <Icon name="download" className="h-4 w-4" /> Users CSV
              </a>
            </div>
          </GlowCard>
        </BlurFade>
      </div>

      <BlurFade delay={0.1}>
        <GlowCard className="p-5">
          <SectionTitle>R2 media browser</SectionTitle>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {['videos/', 'subs/', 'thumbs/', 'scholars/', 'vtt/', ''].map((p) => (
              <button
                key={p || 'all'}
                onClick={() => setPrefix(p)}
                className={`rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
                  prefix === p
                    ? 'border-gold/40 bg-gold/10 text-gold-bright'
                    : 'border-hairline bg-soft text-muted hover:text-cream'
                }`}
              >
                {p || 'all'}
              </button>
            ))}
            <input
              className={inputCls + ' ml-auto max-w-56 font-mono'}
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder="custom prefix..."
            />
          </div>
          {r2.loading ? (
            <p className="py-6 text-center text-[13px] text-muted">Listing...</p>
          ) : (
            <Table head={['Key', 'Size', 'Uploaded']}>
              {(r2.data?.objects || []).map((o: any) => (
                <tr key={o.key} className="transition-colors hover:bg-hover">
                  <td className="max-w-lg truncate px-3 py-2 font-mono text-[12px] text-cream/85" title={o.key}>{o.key}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted">{fmtBytes(o.size)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted">{fmtAgo(o.uploaded)}</td>
                </tr>
              ))}
            </Table>
          )}
          {r2.data?.truncated && <p className="mt-2 text-[11px] text-muted">Showing first 100 objects.</p>}
        </GlowCard>
      </BlurFade>

      <BlurFade delay={0.15}>
        <GlowCard className="p-5">
          <SectionTitle right={<Badge tone="dim">last 50</Badge>}>Admin activity log</SectionTitle>
          <Table head={['Admin', 'Action', 'Target', 'Details', 'When']}>
            {(logs.data?.logs || []).map((l: any) => (
              <tr key={l.id} className="transition-colors hover:bg-hover">
                <td className="px-3 py-2 text-cream/85">{l.admin_name || l.admin_id}</td>
                <td className="px-3 py-2"><Badge tone="gold">{l.action}</Badge></td>
                <td className="px-3 py-2 text-muted">{l.target}</td>
                <td className="max-w-sm truncate px-3 py-2 font-mono text-[11px] text-muted" title={l.details}>{l.details}</td>
                <td className="whitespace-nowrap px-3 py-2 text-muted">{fmtAgo(l.created_at)}</td>
              </tr>
            ))}
          </Table>
        </GlowCard>
      </BlurFade>
    </div>
  );
}
