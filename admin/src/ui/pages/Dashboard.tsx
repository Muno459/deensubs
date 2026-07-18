import { useApi } from '../lib/api';
import { fmtNum, fmtAgo, fmtDuration } from '../lib/format';
import { GlowCard, SectionTitle, PageLoader, ErrorNote, Badge } from '../components/Primitives';
import { GoldArea } from '../components/Charts';
import { CountUp } from '../components/CountUp';
import { BlurFade } from '../components/BlurFade';
import { Icon } from '../components/Icon';

const STATS: { key: string; label: string; icon: string }[] = [
  { key: 'video_count', label: 'Videos', icon: 'video' },
  { key: 'total_views', label: 'Views', icon: 'eye' },
  { key: 'user_count', label: 'Users', icon: 'users' },
  { key: 'comment_count', label: 'Comments', icon: 'comment' },
];

const STEP_LABEL: Record<string, string> = {
  queued: 'Queued', download: 'Downloading', asr: 'Transcribing',
  translate: 'Translating', render: 'Rendering', metadata: 'Metadata', done: 'Done',
};

function QuickAction({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-xl border border-hairline bg-soft px-4 py-3 text-[13px] font-medium text-cream transition-all hover:border-gold/30 hover:bg-gold/[0.04] active:scale-[0.98]"
    >
      <Icon name={icon} className="h-4 w-4 text-gold" />
      {label}
    </button>
  );
}

export default function Dashboard() {
  const { data, loading, error, refetch } = useApi<any>('/api/overview');
  const rt = useApi<any>('/api/realtime');

  if (loading) return <PageLoader />;
  if (error) return <ErrorNote message={error} onRetry={refetch} />;
  if (!data) return null;

  const { stats, dailyHits, scribeJobs, recentClips, spend, recentComments } = data;
  const liveCount = rt.data?.live?.length
    ? rt.data.live.reduce((a: number, r: any) => a + (r.visitors || r.live || 0), 0)
    : null;
  const monthCost = spend ? (spend.asr / 3600) * 0.4 + (spend.tokens / 1e6) * 0.4 : 0;
  const monthMinutes = spend ? Math.round(spend.asr / 60) : 0;

  return (
    <div className="space-y-5">
      {/* Quick actions */}
      <BlurFade>
        <div className="flex flex-wrap gap-2">
          <QuickAction icon="captions" label="New transcription" onClick={() => (location.hash = '/scribe')} />
          <QuickAction icon="play" label="Make a clip" onClick={() => (location.hash = '/clips')} />
          <QuickAction icon="sparkles" label="Ask the agent" onClick={() => (location.hash = '/ai')} />
          <QuickAction icon="folder" label="Playlists" onClick={() => (location.hash = '/playlists')} />
        </div>
      </BlurFade>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {STATS.map((s, i) => (
          <BlurFade key={s.key} delay={i * 0.04}>
            <GlowCard className="p-4">
              <div className="flex items-center justify-between text-faint">
                <span className="text-[10px] font-semibold uppercase tracking-[0.1em]">{s.label}</span>
                <Icon name={s.icon} className="h-3.5 w-3.5" />
              </div>
              <p className="mt-1.5 text-[22px] font-semibold tracking-tight text-cream">
                <CountUp value={stats?.[s.key] || 0} />
              </p>
            </GlowCard>
          </BlurFade>
        ))}
        <BlurFade delay={0.16}>
          <GlowCard className="p-4">
            <div className="flex items-center justify-between text-faint">
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em]">Minutes / mo</span>
              <Icon name="captions" className="h-3.5 w-3.5" />
            </div>
            <p className="mt-1.5 text-[22px] font-semibold tracking-tight text-cream">
              <CountUp value={monthMinutes} />
            </p>
          </GlowCard>
        </BlurFade>
        <BlurFade delay={0.2}>
          <GlowCard className="p-4">
            <div className="flex items-center justify-between text-faint">
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em]">Spend / mo</span>
              <Icon name="chart" className="h-3.5 w-3.5" />
            </div>
            <p className="mt-1.5 text-[22px] font-semibold tracking-tight text-gold-bright">
              ${monthCost.toFixed(2)}
            </p>
          </GlowCard>
        </BlurFade>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Pipeline activity */}
        <BlurFade delay={0.1}>
          <GlowCard className="p-5">
            <SectionTitle
              right={
                <a href="#/scribe" className="text-[11px] text-muted underline-offset-2 hover:text-gold-bright hover:underline">
                  Open Scribe →
                </a>
              }
            >
              Pipeline activity
            </SectionTitle>
            <div className="space-y-2">
              {(scribeJobs || []).map((j: any) => (
                <a key={j.id} href="#/scribe" className="flex items-center gap-3 rounded-lg p-1.5 transition-colors hover:bg-hover">
                  {j.status === 'running' ? (
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="absolute h-full w-full animate-ping rounded-full bg-gold opacity-60" />
                      <span className="relative h-2 w-2 rounded-full bg-gold" />
                    </span>
                  ) : (
                    <span className={`h-2 w-2 shrink-0 rounded-full ${j.status === 'done' ? 'bg-emerald-400' : j.status === 'error' ? 'bg-red-400' : 'bg-hairline-strong'}`} />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[13px] text-cream/90">{j.title || j.url}</span>
                  <Badge tone={j.status === 'running' ? 'gold' : 'dim'}>{STEP_LABEL[j.step] || j.step}</Badge>
                  <span className="w-14 shrink-0 text-right text-[11px] text-faint">{fmtAgo(j.created_at)}</span>
                </a>
              ))}
              {!scribeJobs?.length && (
                <p className="py-6 text-center text-[13px] text-muted">
                  No transcription jobs yet. <a href="#/scribe" className="text-gold-bright underline underline-offset-2">Start one</a>.
                </p>
              )}
            </div>
          </GlowCard>
        </BlurFade>

        {/* Recent clips */}
        <BlurFade delay={0.14}>
          <GlowCard className="p-5">
            <SectionTitle
              right={
                <a href="#/clips" className="text-[11px] text-muted underline-offset-2 hover:text-gold-bright hover:underline">
                  Clip Studio →
                </a>
              }
            >
              Recent clips
            </SectionTitle>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {(recentClips || []).map((c: any) =>
                c.status === 'done' && c.r2_key ? (
                  <video
                    key={c.id}
                    src={`https://cdn.deensubs.com/${c.r2_key}`}
                    controls
                    preload="metadata"
                    className="aspect-[9/16] w-28 shrink-0 rounded-xl border border-hairline bg-black"
                    title={c.hook}
                  />
                ) : (
                  <div key={c.id} className="flex aspect-[9/16] w-28 shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-hairline bg-soft p-2 text-center">
                    <Icon name="play" className="h-5 w-5 text-faint" />
                    <span className="line-clamp-3 text-[10px] leading-tight text-muted">{c.hook || 'Rendering...'}</span>
                    <Badge tone={c.status === 'error' ? 'red' : 'gold'} className="text-[9px]">{c.status}</Badge>
                  </div>
                )
              )}
              {!recentClips?.length && (
                <p className="py-6 text-[13px] text-muted">
                  No clips yet. <a href="#/clips" className="text-gold-bright underline underline-offset-2">Find a viral moment</a>.
                </p>
              )}
            </div>
          </GlowCard>
        </BlurFade>
      </div>

      {/* Traffic (fills after relaunch) */}
      <BlurFade delay={0.18}>
        <GlowCard className="p-5">
          <SectionTitle
            right={
              liveCount != null ? (
                <Badge tone="green" className="gap-1.5">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  </span>
                  {liveCount} live now
                </Badge>
              ) : undefined
            }
          >
            Site traffic
          </SectionTitle>
          {(dailyHits?.length || 0) > 1 ? (
            <GoldArea data={dailyHits} x="day" y="hits" />
          ) : (
            <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-hairline">
              <Icon name="chart" className="h-6 w-6 text-faint/40" />
              <p className="text-[13px] text-muted">Analytics reset for the relaunch — traffic charts fill in as visitors arrive.</p>
            </div>
          )}
        </GlowCard>
      </BlurFade>

      {/* Latest comments (only when present) */}
      {recentComments?.length > 0 && (
        <BlurFade delay={0.22}>
          <GlowCard className="p-5">
            <SectionTitle>Latest comments</SectionTitle>
            <div className="space-y-3">
              {recentComments.map((c: any) => (
                <div key={c.id} className="flex gap-3">
                  {c.user_avatar ? (
                    <img src={c.user_avatar} alt="" referrerPolicy="no-referrer" className="mt-0.5 h-7 w-7 shrink-0 rounded-full border border-hairline" />
                  ) : (
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gold/10 text-[11px] font-bold text-gold">
                      {(c.user_name || '?')[0]}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-[12px] text-muted">
                      <span className="font-medium text-cream">{c.user_name || 'Anonymous'}</span>
                      {' on '}
                      <span className="text-gold/80">{c.video_title}</span>
                      <span className="text-faint"> · {fmtAgo(c.created_at)}</span>
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-cream/85">{c.content}</p>
                  </div>
                </div>
              ))}
            </div>
          </GlowCard>
        </BlurFade>
      )}
    </div>
  );
}
