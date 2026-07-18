import { useState } from 'react';
import { api, useApi } from '../lib/api';
import { fmtBytes, fmtAgo } from '../lib/format';
import { GlowCard, SectionTitle, Button, inputCls, Table, Badge } from '../components/Primitives';
import { BlurFade } from '../components/BlurFade';
import { Icon } from '../components/Icon';

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
              <a href="/api/export/videos" className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white/[0.04] px-3.5 py-2 text-[13px] font-semibold text-cream transition-all hover:bg-white/[0.08] active:scale-[0.97]">
                <Icon name="download" className="h-4 w-4" /> Videos CSV
              </a>
              <a href="/api/export/users" className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white/[0.04] px-3.5 py-2 text-[13px] font-semibold text-cream transition-all hover:bg-white/[0.08] active:scale-[0.97]">
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
                    : 'border-hairline bg-white/[0.02] text-muted hover:text-cream'
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
                <tr key={o.key} className="transition-colors hover:bg-white/[0.02]">
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
              <tr key={l.id} className="transition-colors hover:bg-white/[0.02]">
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
