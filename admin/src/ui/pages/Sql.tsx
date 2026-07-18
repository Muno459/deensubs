import { useState } from 'react';
import { api } from '../lib/api';
import { GlowCard, SectionTitle, ErrorNote, Button, Table, Badge } from '../components/Primitives';
import { BlurFade } from '../components/BlurFade';

const PRESETS: { label: string; engine: 'd1' | 'ae'; sql: string }[] = [
  { label: 'Top videos by views', engine: 'd1', sql: 'SELECT title, slug, views, likes FROM videos ORDER BY views DESC LIMIT 15' },
  { label: 'Videos missing subtitles', engine: 'd1', sql: "SELECT title, slug FROM videos WHERE srt_key IS NULL OR srt_key=''" },
  { label: 'New users this month', engine: 'd1', sql: "SELECT name, email, created_at FROM users WHERE created_at > datetime('now','-30 days') ORDER BY created_at DESC" },
  { label: 'Admin activity log', engine: 'd1', sql: 'SELECT l.action, l.target, l.details, l.created_at, u.name FROM admin_logs l LEFT JOIN users u ON l.admin_id=u.id ORDER BY l.created_at DESC LIMIT 25' },
  { label: 'AE: daily traffic 14d', engine: 'ae', sql: "SELECT toDate(timestamp) AS day, sum(_sample_interval) AS hits, uniq(blob7) AS unique_visitors FROM deensubs_analytics WHERE blob1 IN ('pageview','watch') AND timestamp > NOW() - INTERVAL '14' DAY GROUP BY day ORDER BY day DESC" },
  { label: 'AE: top countries 7d', engine: 'ae', sql: "SELECT blob4 AS country, sum(_sample_interval) AS hits FROM deensubs_analytics WHERE blob4 != '' AND timestamp > NOW() - INTERVAL '7' DAY GROUP BY country ORDER BY hits DESC LIMIT 20" },
];

export default function Sql() {
  const [engine, setEngine] = useState<'d1' | 'ae'>('d1');
  const [sql, setSql] = useState('SELECT title, views, likes FROM videos ORDER BY views DESC LIMIT 10');
  const [rows, setRows] = useState<any[] | null>(null);
  const [meta, setMeta] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true); setErr(''); setRows(null); setMeta('');
    try {
      if (engine === 'd1') {
        const r = await api('/api/sql', { method: 'POST', body: JSON.stringify({ query: sql }) });
        setRows(r.results || []);
        setMeta(r.meta ? `${r.results?.length ?? 0} rows · ${r.meta.duration?.toFixed?.(1) ?? r.meta.duration}ms` : '');
      } else {
        const r = await api('/api/ae', { method: 'POST', body: JSON.stringify({ query: sql }) });
        if (r.error) throw new Error(typeof r.error === 'string' ? r.error : JSON.stringify(r.error));
        setRows(r.data || []);
        setMeta(`${r.rows ?? r.data?.length ?? 0} rows · Analytics Engine`);
      }
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy(false);
  }

  const cols = rows?.length ? Object.keys(rows[0]) : [];

  return (
    <div className="space-y-4">
      <BlurFade>
        <GlowCard className="p-5">
          <SectionTitle
            right={
              <div className="flex gap-1 rounded-lg border border-hairline bg-inset p-0.5">
                {(['d1', 'ae'] as const).map((e) => (
                  <button
                    key={e}
                    onClick={() => setEngine(e)}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
                      engine === e ? 'bg-gold/15 text-gold-bright' : 'text-muted hover:text-cream'
                    }`}
                  >
                    {e === 'd1' ? 'D1' : 'Analytics'}
                  </button>
                ))}
              </div>
            }
          >
            {engine === 'd1' ? 'D1 SQL console (read-only)' : 'Analytics Engine SQL'}
          </SectionTitle>
          <textarea
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run(); }}
            rows={5}
            spellCheck={false}
            className="w-full resize-y rounded-xl border border-hairline bg-inset p-3 font-mono text-[13px] leading-relaxed text-cream outline-none focus:border-gold/40"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button onClick={run} disabled={busy}>{busy ? 'Running...' : 'Run query'}</Button>
            <span className="text-[11px] text-muted">⌘⏎ to run · SELECT only</span>
            <div className="ml-auto flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => { setEngine(p.engine); setSql(p.sql); }}
                  className="rounded-full border border-hairline bg-soft px-2.5 py-1 text-[11px] text-muted transition-colors hover:border-gold/30 hover:text-cream"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </GlowCard>
      </BlurFade>

      {err && <ErrorNote message={err} />}

      {rows && (
        <BlurFade>
          <GlowCard className="p-5">
            <SectionTitle right={meta ? <Badge tone="dim">{meta}</Badge> : undefined}>Results</SectionTitle>
            {rows.length === 0 ? (
              <p className="text-[13px] text-muted">Empty result set.</p>
            ) : (
              <Table head={cols}>
                {rows.map((r, i) => (
                  <tr key={i} className="transition-colors hover:bg-hover">
                    {cols.map((c) => (
                      <td key={c} className="max-w-xs truncate px-3 py-2 font-mono text-[12px] text-cream/85" title={String(r[c] ?? '')}>
                        {String(r[c] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </Table>
            )}
          </GlowCard>
        </BlurFade>
      )}
    </div>
  );
}
