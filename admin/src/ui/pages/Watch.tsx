import { useApi } from '../lib/api';
import { fmtNum } from '../lib/format';
import { GlowCard, SectionTitle, PageLoader, ErrorNote, HitBar, Table, Badge } from '../components/Primitives';
import { BlurFade } from '../components/BlurFade';
import { CountUp } from '../components/CountUp';

export default function Watch() {
  const { data, loading, error, refetch } = useApi<any>('/api/watch');

  if (loading) return <PageLoader />;
  if (error) return <ErrorNote message={error} onRetry={refetch} />;
  if (!data) return null;

  const { events, completion, connections, bufferIssues, videoMap } = data;
  const maxEvent = Math.max(...(events || []).map((e: any) => e.count), 1);
  const maxConn = Math.max(...(connections || []).map((e: any) => e.count), 1);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <BlurFade>
          <GlowCard className="p-5">
            <SectionTitle>Event types</SectionTitle>
            <div className="space-y-2.5">
              {(events || []).map((e: any) => (
                <div key={e.event_type} className="flex items-center gap-3">
                  <span className="w-20 text-[12px] font-medium capitalize text-cream">{e.event_type}</span>
                  <div className="flex-1">
                    <HitBar value={e.count} max={maxEvent} />
                  </div>
                  <span className="w-14 text-right text-[12px] tabular-nums text-muted">
                    <CountUp value={e.count} />
                  </span>
                </div>
              ))}
            </div>
          </GlowCard>
        </BlurFade>
        <BlurFade delay={0.05}>
          <GlowCard className="p-5">
            <SectionTitle>Connection types</SectionTitle>
            <div className="space-y-2.5">
              {(connections || []).map((e: any) => (
                <div key={e.connection} className="flex items-center gap-3">
                  <span className="w-20 text-[12px] font-medium text-cream">{e.connection}</span>
                  <div className="flex-1">
                    <HitBar value={e.count} max={maxConn} />
                  </div>
                  <span className="w-14 text-right text-[12px] tabular-nums text-muted">{fmtNum(e.count)}</span>
                </div>
              ))}
              {!connections?.length && <p className="text-[13px] text-muted">No connection data.</p>}
            </div>
          </GlowCard>
        </BlurFade>
      </div>

      <BlurFade delay={0.1}>
        <GlowCard className="p-5">
          <SectionTitle>Completion by video</SectionTitle>
          <Table head={['Video', 'Viewers', 'Events', 'Avg completion']}>
            {(completion || []).map((r: any) => (
              <tr key={r.video_slug} className="transition-colors hover:bg-white/[0.02]">
                <td className="max-w-md truncate px-3 py-2.5 text-cream/85" title={videoMap?.[r.video_slug] || r.video_slug}>
                  {videoMap?.[r.video_slug] || r.video_slug}
                </td>
                <td className="px-3 py-2.5 tabular-nums text-muted">{r.viewers}</td>
                <td className="px-3 py-2.5 tabular-nums text-muted">{r.events}</td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="w-24">
                      <HitBar value={r.avg_pct} max={100} />
                    </div>
                    <span className="text-[12px] tabular-nums text-cream">{r.avg_pct}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        </GlowCard>
      </BlurFade>

      {bufferIssues?.length > 0 && (
        <BlurFade delay={0.15}>
          <GlowCard className="p-5">
            <SectionTitle
              right={<Badge tone="dim">lowest buffer first</Badge>}
            >
              Buffering health
            </SectionTitle>
            <Table head={['Video', 'Avg buffered (s)', 'Events']}>
              {bufferIssues.map((r: any) => (
                <tr key={r.video_slug} className="transition-colors hover:bg-white/[0.02]">
                  <td className="max-w-md truncate px-3 py-2.5 text-cream/85">{videoMap?.[r.video_slug] || r.video_slug}</td>
                  <td className="px-3 py-2.5 tabular-nums text-muted">{r.avg_buffer}</td>
                  <td className="px-3 py-2.5 tabular-nums text-muted">{r.events}</td>
                </tr>
              ))}
            </Table>
          </GlowCard>
        </BlurFade>
      )}
    </div>
  );
}
