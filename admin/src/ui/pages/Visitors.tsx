import { useState } from 'react';
import { useApi } from '../lib/api';
import { fmtAgo, flagEmoji } from '../lib/format';
import { GlowCard, PageLoader, ErrorNote, Table, Badge, Drawer, Spinner, SectionTitle } from '../components/Primitives';
import { BlurFade } from '../components/BlurFade';

function deviceIcon(t: string) {
  if (t === 'mobile') return '📱';
  if (t === 'tablet') return '📲';
  return '💻';
}

function VisitorJourney({ id }: { id: string }) {
  const { data, loading } = useApi<any>(`/api/visitors/${id}`);
  if (loading) return <div className="flex h-40 items-center justify-center"><Spinner /></div>;
  if (!data) return null;
  const fp = data.fingerprint || {};
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 text-[12px]">
        {[
          ['Device', `${fp.device_type || '?'} · ${fp.os || '?'}`],
          ['Browser', fp.browser || '?'],
          ['Location', `${fp.city || '?'}, ${fp.country || '?'}`],
          ['Screen', fp.screen_w ? `${fp.screen_w}x${fp.screen_h}` : '?'],
          ['Visits', String(fp.visit_count ?? '?')],
          ['Last seen', fmtAgo(fp.last_seen)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-hairline bg-soft p-2">
            <p className="text-[10px] uppercase tracking-wider text-muted">{k}</p>
            <p className="mt-0.5 text-cream/90">{v}</p>
          </div>
        ))}
      </div>
      {fp.gpu && <p className="text-[11px] text-muted">GPU: {fp.gpu}</p>}
      {data.user && (
        <div className="flex items-center gap-2 rounded-lg border border-gold/20 bg-gold/[0.05] p-2.5">
          {data.user.avatar && <img src={data.user.avatar} alt="" referrerPolicy="no-referrer" className="h-6 w-6 rounded-full" />}
          <span className="text-[12px] text-cream">Signed in as <b>{data.user.name}</b> ({data.user.email})</span>
        </div>
      )}
      {data.watchEvents?.length > 0 && (
        <div>
          <SectionTitle>Watch history</SectionTitle>
          <div className="space-y-1.5">
            {data.watchEvents.map((w: any, i: number) => (
              <div key={i} className="flex items-center justify-between gap-2 text-[12px]">
                <span className="min-w-0 truncate text-cream/80">{data.videoMap?.[w.video_slug] || w.video_slug}</span>
                <span className="shrink-0 text-[11px] text-muted">
                  {w.event_type} @ {Math.round(w.position)}s · {fmtAgo(w.created_at)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {data.pages?.length > 0 && (
        <div>
          <SectionTitle>Pages</SectionTitle>
          <div className="space-y-1">
            {data.pages.slice(0, 30).map((p: any, i: number) => (
              <div key={i} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-mono text-[11px] text-cream/75">{p.path}</span>
                <span className="shrink-0 text-[10px] text-muted">{fmtAgo(p.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Visitors() {
  const { data, loading, error, refetch } = useApi<any>('/api/visitors');
  const [open, setOpen] = useState<any | null>(null);

  if (loading) return <PageLoader />;
  if (error) return <ErrorNote message={error} onRetry={refetch} />;

  const visitors = data?.visitors || [];

  return (
    <BlurFade>
      <GlowCard className="p-5">
        <p className="mb-3 text-[13px] text-muted">{visitors.length} most recent visitors (fingerprints)</p>
        <Table head={['Visitor', 'Location', 'Device', 'Visits', 'Last seen']}>
          {visitors.map((v: any) => (
            <tr key={v.id} className="cursor-pointer transition-colors hover:bg-hover" onClick={() => setOpen(v)}>
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-2">
                  {v.user_name ? (
                    <>
                      {v.user_avatar && <img src={v.user_avatar} alt="" referrerPolicy="no-referrer" className="h-6 w-6 rounded-full border border-hairline" />}
                      <span className="font-medium text-cream">{v.user_name}</span>
                    </>
                  ) : (
                    <span className="font-mono text-[11px] text-muted">{String(v.id).slice(0, 14)}...</span>
                  )}
                </div>
              </td>
              <td className="px-3 py-2.5 text-cream/80">
                {flagEmoji(v.country)} {v.city ? `${v.city}, ` : ''}{v.country || '?'}
              </td>
              <td className="px-3 py-2.5 text-muted">
                {deviceIcon(v.device_type)} {v.os || '?'} · {v.browser || '?'}
              </td>
              <td className="px-3 py-2.5 tabular-nums text-muted">{v.visit_count}</td>
              <td className="px-3 py-2.5 text-muted">{fmtAgo(v.last_seen)}</td>
            </tr>
          ))}
        </Table>
        <Drawer
          open={!!open}
          onClose={() => setOpen(null)}
          title={open?.user_name || 'Visitor'}
        >
          {open && <VisitorJourney id={open.id} />}
        </Drawer>
      </GlowCard>
    </BlurFade>
  );
}
