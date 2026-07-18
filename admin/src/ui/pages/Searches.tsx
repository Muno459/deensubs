import { useApi } from '../lib/api';
import { GlowCard, SectionTitle, PageLoader, ErrorNote, HitBar, Badge } from '../components/Primitives';
import { BlurFade } from '../components/BlurFade';

export default function Searches() {
  const { data, loading, error, refetch } = useApi<any>('/api/searches');

  if (loading) return <PageLoader />;
  if (error) return <ErrorNote message={error} onRetry={refetch} />;

  const top = data?.top || [];
  const zero = data?.zero || [];
  const max = Math.max(...top.map((t: any) => t.times), 1);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <BlurFade>
        <GlowCard className="p-5">
          <SectionTitle>Top searches</SectionTitle>
          <div className="space-y-2.5">
            {top.map((s: any, i: number) => (
              <div key={i} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-[13px] text-cream/85">{s.query}</span>
                <div className="w-24 shrink-0">
                  <HitBar value={s.times} max={max} />
                </div>
                <span className="w-8 shrink-0 text-right text-[12px] tabular-nums text-muted">{s.times}</span>
                <span className="w-14 shrink-0 text-right text-[11px] text-muted/70">{s.results} hits</span>
              </div>
            ))}
            {!top.length && <p className="text-[13px] text-muted">No searches logged.</p>}
          </div>
        </GlowCard>
      </BlurFade>
      <BlurFade delay={0.05}>
        <GlowCard className="p-5">
          <SectionTitle right={<Badge tone="red">content gaps</Badge>}>Zero-result searches</SectionTitle>
          <p className="mb-3 text-[12px] leading-relaxed text-muted">
            What people looked for and could not find. Each of these is a content idea.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {zero.map((s: any, i: number) => (
              <span key={i} className="rounded-full border border-red-500/20 bg-red-500/[0.06] px-2.5 py-1 text-[12px] text-red-200">
                {s.query} <span className="text-red-300/60">×{s.times}</span>
              </span>
            ))}
            {!zero.length && <p className="text-[13px] text-muted">Everything found results.</p>}
          </div>
        </GlowCard>
      </BlurFade>
    </div>
  );
}
