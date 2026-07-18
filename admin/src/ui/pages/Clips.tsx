// Clip Studio: AI finds the viral moments, you fine-tune, the container
// renders a 9:16 clip with rapid captions, hook title, and progress bar.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, useApi } from '../lib/api';
import { fmtDuration, fmtAgo } from '../lib/format';
import { GlowCard, SectionTitle, Button, inputCls, Badge, Spinner, ErrorNote } from '../components/Primitives';
import { BlurFade } from '../components/BlurFade';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { AiFillButton } from '../components/AiFill';

const STYLES = [
  { id: 'bold', label: 'Bold', desc: 'UPPERCASE white, heavy outline — maximum stopping power' },
  { id: 'gold', label: 'Gold', desc: 'DeenSubs cream + gold karaoke accent — elegant' },
  { id: 'minimal', label: 'Minimal', desc: 'Clean white, thin outline — calm and premium' },
];

type Moment = { start: number; end: number; hook: string; reason: string; score: number };

function Composer({ job, moment, onClose, onCreated }: { job: any; moment: Moment | null; onClose: () => void; onCreated: () => void }) {
  const [start, setStart] = useState(moment?.start ?? 0);
  const [end, setEnd] = useState(moment?.end ?? Math.min(45, job.duration || 45));
  const [hook, setHook] = useState(moment?.hook ?? '');
  const [style, setStyle] = useState('bold');
  const [creating, setCreating] = useState(false);
  const [cues, setCues] = useState<any[]>([]);
  const toast = useToast();

  useEffect(() => {
    api(`/api/scribe/${job.id}/cues`).then((r) => setCues(r.cues || [])).catch(() => {});
  }, [job.id]);

  const included = useMemo(() => cues.filter((c) => c.end > start && c.start < end), [cues, start, end]);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-hairline bg-panel p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-cream">Compose clip</h3>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-cream">✕</button>
        </div>
        <div className="space-y-3.5">
          <div>
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">Hook title (pinned on top)</span>
            <div className="flex gap-2">
              <input className={inputCls} value={hook} onChange={(e) => setHook(e.target.value)} placeholder="The Dua That Changes Everything" />
              <AiFillButton
                kind="clip_hook"
                payload={{ text: included.map((c: any) => c.text).join(' ') }}
                label="Hook"
                className="shrink-0"
                onFill={(r) => r.hook && setHook(r.hook)}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">Start (s)</span>
              <input type="number" step="0.1" className={inputCls} value={start} onChange={(e) => setStart(parseFloat(e.target.value) || 0)} />
            </div>
            <div>
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">End (s)</span>
              <input type="number" step="0.1" className={inputCls} value={end} onChange={(e) => setEnd(parseFloat(e.target.value) || 0)} />
            </div>
            <div className="flex items-end pb-2 text-[13px] tabular-nums text-muted">{Math.max(0, end - start).toFixed(1)}s clip</div>
          </div>
          <div>
            <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted">Caption style</span>
            <div className="grid grid-cols-3 gap-2">
              {STYLES.map((s) => (
                <button key={s.id} onClick={() => setStyle(s.id)}
                  className={`rounded-xl border p-3 text-left transition-all ${style === s.id ? 'border-gold/50 bg-gold/[0.07]' : 'border-hairline bg-soft hover:border-hairline-strong'}`}>
                  <p className="text-[13px] font-semibold text-cream">{s.label}</p>
                  <p className="mt-0.5 text-[10px] leading-tight text-faint">{s.desc}</p>
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">Captions in range ({included.length} cues)</span>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-hairline bg-inset p-2.5">
              {included.map((c, i) => (
                <p key={i} className="text-[12px] leading-snug text-cream/80">
                  <span className="mr-2 font-mono text-[10px] text-faint">{fmtDuration(c.start)}</span>
                  {c.text}
                </p>
              ))}
              {!included.length && <p className="text-[12px] text-faint">No cues in this range.</p>}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              disabled={creating || end <= start || !included.length}
              onClick={async () => {
                setCreating(true);
                try {
                  await api('/api/clips', { method: 'POST', body: JSON.stringify({ job_id: job.id, start, end, hook, style }) });
                  toast.push('Rendering clip — takes a minute or two');
                  onCreated();
                  onClose();
                } catch (e: any) {
                  toast.push(e.message, 'error');
                }
                setCreating(false);
              }}
            >
              {creating ? 'Starting...' : 'Render clip'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Clips() {
  const jobs = useApi<any>('/api/scribe');
  const clips = useApi<any>('/api/clips');
  const [jobId, setJobId] = useState('');
  const [moments, setMoments] = useState<Moment[] | null>(null);
  const [finding, setFinding] = useState(false);
  const [findErr, setFindErr] = useState('');
  const [composing, setComposing] = useState<{ job: any; moment: Moment | null } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const toast = useToast();

  const videoJobs = (jobs.data?.jobs || []).filter(
    (j: any) => j.status === 'done' && /\.(mp4|webm|mkv|mov)$/i.test(j.source_key || '')
  );
  const job = videoJobs.find((j: any) => j.id === jobId) || null;
  const anyRendering = (clips.data?.clips || []).some((c: any) => c.status === 'running');

  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (anyRendering) timer.current = setInterval(clips.refetch, 5000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [anyRendering, clips.refetch]);

  async function findMoments() {
    if (!job) return;
    setFinding(true);
    setFindErr('');
    setMoments(null);
    try {
      const r = await api('/api/clips/suggest', { method: 'POST', body: JSON.stringify({ job_id: job.id }) });
      setMoments(r.moments || []);
    } catch (e: any) {
      setFindErr(e.message);
    }
    setFinding(false);
  }

  return (
    <div className="space-y-5">
      <BlurFade>
        <GlowCard className="relative overflow-hidden p-6">
          <h2 className="text-[15px] font-semibold tracking-tight text-cream">Clip Studio</h2>
          <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-muted">
            The viral formula, automated: AI scans the transcript for hook-first, self-contained, quotable moments —
            then the renderer produces a 9:16 clip with rapid pop-in captions timed to speech, a pinned hook title,
            blur-pad framing, and a gold progress bar. Pick a moment, adjust, render.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <select className={inputCls + ' max-w-md flex-1'} value={jobId} onChange={(e) => { setJobId(e.target.value); setMoments(null); }}>
              <option value="">Choose a finished job with video...</option>
              {videoJobs.map((j: any) => (
                <option key={j.id} value={j.id}>{j.title || j.url}</option>
              ))}
            </select>
            <Button onClick={findMoments} disabled={!job || finding} className="flex items-center gap-1.5">
              <Icon name="sparkles" className="h-4 w-4" />
              {finding ? 'Scanning transcript...' : 'Find viral moments'}
            </Button>
            {job && (
              <Button variant="ghost" onClick={() => setComposing({ job, moment: null })}>Manual clip</Button>
            )}
          </div>
          {!videoJobs.length && !jobs.loading && (
            <p className="mt-3 text-[12px] text-faint">
              No video-source jobs yet. Run a Scribe job on a direct video URL, or a YouTube job with "full video" enabled.
            </p>
          )}
          {findErr && <p className="mt-2 text-[12px] text-red-400">{findErr}</p>}
        </GlowCard>
      </BlurFade>

      {moments && (
        <BlurFade>
          <div className="grid gap-3 md:grid-cols-2">
            {moments.map((m, i) => (
              <GlowCard key={i} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[14px] font-semibold leading-snug text-cream">{m.hook}</p>
                  <Badge tone="gold" className="shrink-0 tabular-nums">{m.score}/10</Badge>
                </div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{m.reason}</p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="font-mono text-[11px] tabular-nums text-faint">
                    {fmtDuration(m.start)} → {fmtDuration(m.end)} · {(m.end - m.start).toFixed(0)}s
                  </span>
                  <Button className="px-3 py-1.5 text-[12px]" onClick={() => setComposing({ job, moment: m })}>
                    Compose →
                  </Button>
                </div>
              </GlowCard>
            ))}
            {!moments.length && <p className="text-[13px] text-muted">No strong moments found in this transcript.</p>}
          </div>
        </BlurFade>
      )}

      <div>
        <SectionTitle>Rendered clips</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(clips.data?.clips || []).map((c: any) => (
            <GlowCard key={c.id} glow={false} className="p-3.5">
              <div className="flex items-center gap-2">
                {c.status === 'running' && <Spinner className="h-3.5 w-3.5" />}
                {c.status === 'done' && <span className="h-2 w-2 rounded-full bg-emerald-400" />}
                {c.status === 'error' && <span className="h-2 w-2 rounded-full bg-red-400" />}
                <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-cream">{c.hook || 'Untitled clip'}</p>
                <Badge tone="dim">{c.style}</Badge>
              </div>
              <p className="mt-1 truncate text-[11px] text-faint">{c.job_title || c.job_id} · {(c.end - c.start).toFixed(0)}s · {fmtAgo(c.created_at)}</p>
              {c.error && <p className="mt-1 break-all text-[11px] text-red-400">{c.error}</p>}
              {c.status === 'done' && c.r2_key && (
                <div className="mt-2.5 flex items-center gap-2">
                  <video src={`https://cdn.deensubs.com/${c.r2_key}`} controls preload="metadata" className="aspect-[9/16] w-24 rounded-lg border border-hairline bg-black" />
                  <div className="flex flex-col gap-1.5">
                    <a href={`/api/clips/${c.id}/file`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-gold px-2.5 py-1.5 text-[11px] font-semibold text-ink hover:bg-gold-bright">
                      <Icon name="download" className="h-3 w-3" /> Download
                    </a>
                    <button
                      onClick={async () => { await api(`/api/clips/${c.id}`, { method: 'DELETE' }); toast.push('Clip deleted'); clips.refetch(); }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-2.5 py-1.5 text-[11px] text-muted hover:bg-red-500/10 hover:text-red-400">
                      <Icon name="trash" className="h-3 w-3" /> Delete
                    </button>
                  </div>
                </div>
              )}
            </GlowCard>
          ))}
        </div>
        {!clips.data?.clips?.length && !clips.loading && (
          <div className="rounded-2xl border border-dashed border-hairline py-12 text-center">
            <Icon name="play" className="mx-auto h-8 w-8 text-faint/40" />
            <p className="mt-3 text-[13px] text-muted">No clips yet. Find a viral moment above.</p>
          </div>
        )}
      </div>

      {composing && (
        <Composer
          job={composing.job}
          moment={composing.moment}
          onClose={() => setComposing(null)}
          onCreated={clips.refetch}
        />
      )}
    </div>
  );
}
