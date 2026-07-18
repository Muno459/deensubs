import { useApi } from '../lib/api';
import { fmtNum } from '../lib/format';
import { GlowCard, SectionTitle, PageLoader, ErrorNote, HitBar } from '../components/Primitives';
import { GoldArea } from '../components/Charts';
import { BlurFade } from '../components/BlurFade';

function RankList({ rows, label, mono = false }: { rows: { name: string; hits: number }[]; label: string; mono?: boolean }) {
  const max = Math.max(...rows.map((r) => r.hits), 1);
  return (
    <GlowCard className="p-5">
      <SectionTitle>{label}</SectionTitle>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-3">
            <span
              className={`min-w-0 flex-1 truncate text-[12px] text-cream/80 ${mono ? 'font-mono' : ''}`}
              title={r.name}
            >
              {r.name}
            </span>
            <div className="w-28 shrink-0">
              <HitBar value={r.hits} max={max} />
            </div>
            <span className="w-10 shrink-0 text-right text-[12px] tabular-nums text-muted">{fmtNum(r.hits)}</span>
          </div>
        ))}
        {!rows.length && <p className="text-[13px] text-muted">No data yet.</p>}
      </div>
    </GlowCard>
  );
}

function shortAgent(ua: string): string {
  if (!ua) return 'Unknown';
  if (ua.includes('bot') || ua.includes('Bot') || ua.includes('crawl')) {
    const m = ua.match(/([A-Za-z]+[Bb]ot)/);
    return '🤖 ' + (m ? m[1] : 'Bot');
  }
  const browser = ua.includes('Edg/') ? 'Edge' : ua.includes('Firefox/') ? 'Firefox' : ua.includes('Chrome/') ? 'Chrome' : ua.includes('Safari/') ? 'Safari' : 'Other';
  const os = ua.includes('Windows') ? 'Windows' : ua.includes('Mac OS') ? 'macOS' : ua.includes('Android') ? 'Android' : ua.includes('iPhone') || ua.includes('iPad') ? 'iOS' : ua.includes('Linux') ? 'Linux' : '';
  return browser + (os ? ' · ' + os : '');
}

export default function Analytics() {
  const { data, loading, error, refetch } = useApi<any>('/api/analytics');

  if (loading) return <PageLoader />;
  if (error) return <ErrorNote message={error} onRetry={refetch} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <BlurFade>
        <GlowCard className="p-5">
          <SectionTitle>Traffic, last 30 days</SectionTitle>
          <GoldArea data={data.dailyHits || []} x="day" y="hits" height={240} />
        </GlowCard>
      </BlurFade>
      <div className="grid gap-6 lg:grid-cols-2">
        <BlurFade delay={0.05}>
          <RankList mono label="Top pages" rows={(data.topPages || []).map((p: any) => ({ name: p.path, hits: p.hits }))} />
        </BlurFade>
        <BlurFade delay={0.1}>
          <RankList label="Top videos" rows={(data.topVideos || []).map((v: any) => ({ name: v.slug, hits: v.hits }))} />
        </BlurFade>
        <BlurFade delay={0.15}>
          <RankList mono label="Referrers" rows={(data.referers || []).map((r: any) => ({ name: r.referer, hits: r.hits }))} />
        </BlurFade>
        <BlurFade delay={0.2}>
          <RankList label="User agents" rows={(data.agents || []).map((a: any) => ({ name: shortAgent(a.user_agent), hits: a.hits }))} />
        </BlurFade>
      </div>
    </div>
  );
}
