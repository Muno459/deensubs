import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api, useApi } from '../lib/api';
import { fmtAgo, fmtDuration } from '../lib/format';
import { GlowCard, Button, inputCls, Badge, ErrorNote, Modal, Spinner, Field } from '../components/Primitives';
import { useToast } from '../components/Toast';
import { SubtitleEditor } from '../components/SubtitleEditor';
import { PreviewPlayer } from '../components/PreviewPlayer';
import { BlurFade } from '../components/BlurFade';
import { Icon } from '../components/Icon';

const LANGS = [
  { code: 'en', label: 'English' }, { code: 'ar', label: 'Arabic' },
  { code: 'fa', label: 'Farsi' }, { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' }, { code: 'es', label: 'Spanish' },
  { code: 'tr', label: 'Turkish' }, { code: 'ru', label: 'Russian' },
];

// User-facing pipeline stages. Internal `render` is folded into Translate.
const STAGES = [
  { id: 'download', label: 'Download', icon: 'download' },
  { id: 'asr', label: 'Transcribe', icon: 'captions' },
  { id: 'translate', label: 'Translate', icon: 'globe' },
  { id: 'metadata', label: 'Metadata', icon: 'sparkles' },
] as const;

function stageIndex(step: string): number {
  if (step === 'queued') return -1;
  if (step === 'render') return 2; // rendering counts as translating
  if (step === 'done') return STAGES.length;
  if (step === 'enhance') return 3; // rendezvous with the parallel companion enhancement at the end
  const i = STAGES.findIndex((s) => s.id === step);
  return i < 0 ? 0 : i;
}

/** Live companions + proxy control, fed by the presence WebSocket. */
/** Compact download-routing dropdown: Auto (companion first, proxy fallback),
 * a specific proxy exit, or a specific online companion. */
function RouteSelect() {
  const [proxies, setProxies] = useState<any | null>(null);
  const [roster, setRoster] = useState<any[]>([]);
  const toast = useToast();

  const load = async () => {
    try { setProxies(await api('/api/companion/proxies')); } catch {}
    try { setRoster((await api('/api/companion/roster')).companions || []); } catch {}
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 25000);
    return () => clearInterval(t);
  }, []);

  const value = proxies
    ? proxies.target === 'proxy'
      ? (String(proxies.selected) === 'auto' ? 'proxy:auto' : `proxy:${proxies.selected}`)
      : proxies.target
        ? `comp:${proxies.target}`
        : 'auto'
    : 'auto';

  const change = async (v: string) => {
    try {
      if (v === 'auto') {
        await api('/api/companion/target', { method: 'POST', body: JSON.stringify({ target: '' }) });
      } else if (v.startsWith('proxy:')) {
        await api('/api/companion/target', { method: 'POST', body: JSON.stringify({ target: 'proxy' }) });
        await api('/api/companion/proxies/select', {
          method: 'POST',
          body: JSON.stringify({ index: v === 'proxy:auto' ? 'auto' : parseInt(v.slice(6)) }),
        });
      } else if (v.startsWith('comp:')) {
        await api('/api/companion/target', { method: 'POST', body: JSON.stringify({ target: v.slice(5) }) });
      }
      load();
    } catch (e: any) { toast.push(e.message, 'error'); }
  };

  const dlComps = roster.filter((c) => c.caps?.some((x: string) => x.startsWith('download')));
  return (
    <select
      className={inputCls + ' w-52 py-2.5'}
      value={value}
      onChange={(e) => change(e.target.value)}
      title="Where downloads run — Auto uses an online companion first and falls back to the proxy container"
    >
      <option value="auto">Downloads: Auto</option>
      <option value="proxy:auto">Proxy · auto exit</option>
      {(proxies?.proxies || []).map((p: any) => (
        <option key={p.index} value={`proxy:${p.index}`}>Proxy · {p.label}</option>
      ))}
      {dlComps.map((c) => (
        <option key={c.name} value={`comp:${c.name}`}>Companion · {c.name}</option>
      ))}
    </select>
  );
}

function parseTimes(raw: string | null): Record<string, number> {
  try {
    const obj = JSON.parse(raw || '{}');
    const out: Record<string, number> = {};
    for (const k of Object.keys(obj)) out[k] = new Date(obj[k]).getTime();
    return out;
  } catch { return {}; }
}

function stageDuration(times: Record<string, number>, stage: string, now: number): number | null {
  // Visual stages; `translate` spans the internal translate + render steps.
  // Prefer explicit end marks (survive resumes); fall back to next-stage start.
  const order = ['download', 'asr', 'translate', 'metadata', 'done'];
  const start = times[stage];
  if (!start) return null;
  const end = times[`${stage}_end`];
  if (end && end >= start) return (end - start) / 1000;
  let next: number | undefined;
  for (let i = order.indexOf(stage) + 1; i < order.length; i++) {
    if (times[order[i]]) { next = times[order[i]]; break; }
  }
  return ((next ?? now) - start) / 1000;
}

function fmtSecs(s: number | null): string {
  if (s == null || s < 0) return '';
  if (s < 90) return `${Math.round(s)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

function Timeline({ job, now }: { job: any; now: number }) {
  const idx = stageIndex(job.step);
  const times = useMemo(() => parseTimes(job.stage_times), [job.stage_times]);
  const failed = job.status === 'error';

  return (
    <div className="flex items-center">
      {STAGES.map((s, i) => {
        const isDone = i < idx || job.status === 'done';
        const isActive = i === idx && job.status === 'running';
        const isFailed = failed && i === idx;
        const dur = isDone || isActive ? stageDuration(times, s.id, now) : null;
        return (
          <div key={s.id} className={`flex items-center ${i > 0 ? 'flex-1' : ''}`}>
            {i > 0 && (
              <div className="relative mx-1 h-px flex-1 overflow-hidden rounded bg-soft">
                <motion.div
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-gold/60 to-gold"
                  initial={false}
                  animate={{ width: isDone || isActive ? '100%' : '0%' }}
                  transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                />
              </div>
            )}
            <div className="flex flex-col items-center gap-1">
              <div
                className={`relative flex h-7 w-7 items-center justify-center rounded-full border transition-colors duration-300 ${
                  isFailed
                    ? 'border-red-500/50 bg-red-500/10 text-red-400'
                    : isDone
                      ? 'border-gold/50 bg-gold/15 text-gold-bright'
                      : isActive
                        ? 'border-gold bg-gold/10 text-gold-bright'
                        : 'border-hairline bg-soft text-muted/50'
                }`}
              >
                {isActive && (
                  <span className="absolute inset-0 animate-ping rounded-full border border-gold/40" />
                )}
                {isDone && !isFailed ? (
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" d="M5 13l4 4L19 7" /></svg>
                ) : isFailed ? (
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
                ) : (
                  <Icon name={s.icon} className="h-3 w-3" />
                )}
              </div>
              <span className={`text-[9px] font-semibold uppercase tracking-wider ${isActive ? 'text-gold-bright' : isDone ? 'text-cream/60' : 'text-muted/40'}`}>
                {s.label}
              </span>
              <span className="h-3 text-[9px] tabular-nums text-muted/60">
                {s.id === 'download' && isActive && job.download_pct > 0
                  ? `${Math.round(job.download_pct)}%`
                  : fmtSecs(dur)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-muted transition-colors hover:bg-gold/10 hover:text-gold-bright"
    >
      {copied ? 'Copied' : label || 'Copy'}
    </button>
  );
}

function QualityCard({ job }: { job: any }) {
  const q = useApi<any>(job.status === 'done' ? `/api/scribe/${job.id}/quality` : null);
  const [rerunning, setRerunning] = useState(false);
  const toast = useToast();
  if (job.status !== 'done') return null;
  const r = q.data;
  const gradeColor = (g: string) =>
    g === 'A' ? 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10'
    : g === 'B' ? 'text-gold-bright border-gold/40 bg-gold/10'
    : g === 'C' ? 'text-amber-400 border-amber-500/40 bg-amber-500/10'
    : 'text-red-400 border-red-500/40 bg-red-500/10';
  return (
    <div className="rounded-xl border border-hairline bg-panel/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Quality report</p>
        <button
          disabled={rerunning}
          onClick={async () => {
            setRerunning(true);
            try { await api(`/api/scribe/${job.id}/quality`, { method: 'POST' }); q.refetch(); toast.push('Quality re-assessed'); }
            catch (e: any) { toast.push(e.message, 'error'); }
            setRerunning(false);
          }}
          className="text-[11px] text-muted hover:text-cream"
        >
          {rerunning ? 'Measuring...' : 'Re-measure'}
        </button>
      </div>
      {!r ? (
        <p className="text-[12px] text-faint">{q.loading ? 'Loading...' : 'No report yet — hit Re-measure.'}</p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className={`flex h-12 w-12 items-center justify-center rounded-xl border text-xl font-bold ${gradeColor(r.grade)}`}>{r.grade}</div>
            <div className="text-[12px] leading-relaxed text-muted">
              <span className="font-semibold text-cream">{r.score}/100</span> · {r.metrics.cues} cues · {r.metrics.coverage_pct}% coverage
              {r.metrics.verse_cues > 0 && <> · <span className="text-gold-bright">{r.metrics.verse_cues} Quran verse cues</span></>}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              ['Semantic flags', `${r.metrics.audit_flagged}/${r.metrics.audit_cues}`],
              ['CPS p90', r.metrics.cps_p90],
              ['Gaps >8s', r.metrics.gaps_over_8s],
              ['Arabic leak', r.metrics.arabic_leak],
              ['Overlaps', r.metrics.overlaps],
              ['>10s cues', r.metrics.cues_over_10s],
            ].map(([k, v]) => (
              <div key={k as string} className="rounded-lg bg-inset px-2 py-1.5">
                <p className="text-[13px] font-semibold tabular-nums text-cream">{v as any}</p>
                <p className="text-[9px] uppercase tracking-wider text-faint">{k}</p>
              </div>
            ))}
          </div>
          {r.flags?.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted">Lowest-similarity cues (review these)</p>
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {r.flags.slice(0, 12).map((f: any) => (
                  <div key={f.i} className="rounded-lg bg-inset px-2 py-1.5 text-[11px]">
                    <span className="font-mono text-faint">{fmtDuration(f.start)} · sim {f.sim}</span>
                    <p className="truncate text-cream/80">{f.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Audiobook thumbnail: the scholar's stage card with the episode title drawn
// into its empty right zone (vertically centered, wrapped, size adapts to
// length). Composed in-browser on canvas — the site's font and card image both
// serve with open CORS — then uploaded like a custom thumb so publish makes
// the usual responsive variants.
let thumbFontLoad: Promise<void> | null = null;
function loadThumbFont(): Promise<void> {
  if (!thumbFontLoad) {
    thumbFontLoad = (async () => {
      const f = new FontFace('OutfitThumb', "url(https://deensubs.com/fonts/outfit-latin.woff2)", { weight: '100 900' });
      await f.load();
      document.fonts.add(f);
    })().catch(() => {});
  }
  return thumbFontLoad;
}

async function composeCardThumb(schSlug: string, title: string): Promise<{ dataUrl: string; blob: Blob } | null> {
  try {
    await loadThumbFont();
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = `https://deensubs.com/img/v13/scholars/cards/${schSlug}.jpg`;
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    const W = 1920, H = 1080, X = 800, MAXW = 1040;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, W, H);
    const wrap = (s: number) => {
      ctx.font = `600 ${s}px OutfitThumb, sans-serif`;
      const out: string[] = [];
      let cur = '';
      for (const w of title.trim().split(/\s+/)) {
        const t = cur ? cur + ' ' + w : w;
        if (ctx.measureText(t).width > MAXW && cur) { out.push(cur); cur = w; } else cur = t;
      }
      if (cur) out.push(cur);
      return out;
    };
    let size = 84, lines: string[] = [];
    for (const s of [84, 76, 68, 60, 54, 48, 42]) {
      size = s;
      lines = wrap(s);
      if (lines.length <= (s >= 68 ? 3 : 4)) break;
    }
    const lh = size * 1.28;
    let y = H / 2 - ((lines.length - 1) * lh) / 2;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#eceadf';
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 2;
    ctx.font = `600 ${size}px OutfitThumb, sans-serif`;
    for (const ln of lines) { ctx.fillText(ln, X, y); y += lh; }
    const blob = await new Promise<Blob | null>((res) => cv.toBlob(res, 'image/jpeg', 0.92));
    if (!blob) return null;
    return { dataUrl: cv.toDataURL('image/jpeg', 0.85), blob };
  } catch {
    return null;
  }
}

function PublishModal({ job, open, onClose }: { job: any; open: boolean; onClose: () => void }) {
  const meta = useApi<any>(open ? '/api/meta' : null);
  const [form, setForm] = useState<any>(null);
  const [cands, setCands] = useState<{ key: string; ts: number }[] | null>(null);
  const [customThumb, setCustomThumb] = useState<string | null>(null);
  const [chosenKey, setChosenKey] = useState<string | null>(null);
  const thumbFileRef = useRef<HTMLInputElement>(null);
  const [candErr, setCandErr] = useState('');
  const [cardThumb, setCardThumb] = useState<{ dataUrl: string; blob: Blob } | null>(null);
  const [chosenTs, setChosenTs] = useState<number | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<any | null>(null);
  const toast = useToast();

  useEffect(() => {
    if (!open) { setCands(null); setDone(null); setErr(''); setCandErr(''); return; }
    setForm({
      title: job.title || '',
      title_ar: job.title_ar || '',
      description: job.description || '',
      chapters: (() => { try { const a = JSON.parse(job.chapters || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } })(),
      slug: (job.title || job.id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80),
      category_id: null,
      scholar_id: null,
    });
    // Generate frame candidates via the container (video jobs only — audio
    // jobs have no frames; artwork is the scholar stage card or an upload)
    if (job.full_video) {
      api(`/api/scribe/${job.id}/thumbs`, { method: 'POST' })
        .then((r) => {
          setCands(r.candidates || []);
          if (r.candidates?.length) setChosenTs(r.candidates[0].ts);
        })
        .catch((e) => { setCands([]); setCandErr(e.message); });
    } else setCands([]);
    setCustomThumb(null);
    setChosenKey(null);
    // AI drafts the rest: category/scholar picks + Arabic title + slug (silent best-effort)
    let live = true;
    // A custom thumb already staged for this job (uploaded earlier or via
    // bulk import) is picked up and preselected; extracted frames stay as
    // alternatives.
    api(`/api/r2?prefix=${encodeURIComponent(`scribe/${job.id}/`)}`)
      .then((r) => {
        if (!live) return;
        const ct = (r.objects || []).find((o: any) => o.key.includes('custom-thumb'));
        if (ct) { setCustomThumb(ct.key); setChosenKey(ct.key); }
      })
      .catch(() => {});
    api('/api/ai/fill', { method: 'POST', body: JSON.stringify({ kind: 'publish', jobId: job.id }) })
      .then((r) => {
        if (!live) return;
        setForm((f: any) => f ? {
          ...f,
          title_ar: f.title_ar || r.title_ar || '',
          description: f.description || r.description || '',
          slug: r.slug || f.slug,
          category_id: f.category_id ?? r.category_id ?? null,
          scholar_id: f.scholar_id ?? r.scholar_id ?? null,
        } : f);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [open, job.id]);

  // Audiobook thumb preview: re-compose the card + title whenever either changes
  const schCardSlug = !job.full_video ? (meta.data?.scholars || []).find((s: any) => s.id === form?.scholar_id)?.slug : null;
  useEffect(() => {
    setCardThumb(null);
    if (!open || !schCardSlug || !form?.title) return;
    let live = true;
    const t = setTimeout(() => {
      composeCardThumb(schCardSlug, form.title).then((r) => { if (live) setCardThumb(r); });
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [open, schCardSlug, form?.title]);

  const [arThumb, setArThumb] = useState<{ arabic: boolean; text: string } | null>(null);
  useEffect(() => {
    setArThumb(null);
    const key = chosenKey || customThumb;
    if (!open || !key) return;
    let live = true;
    api('/api/thumbs/detect', { method: 'POST', body: JSON.stringify({ key }) })
      .then((r) => { if (live) setArThumb(r); })
      .catch(() => {});
    return () => { live = false; };
  }, [open, chosenKey, customThumb]);

  const fmtT = (sec: number) => { const v = Math.max(0, Math.round(sec || 0)); const h = Math.floor(v / 3600), m = Math.floor((v % 3600) / 60), x = v % 60; return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + ':' + String(x).padStart(2, '0'); };
  const parseT = (v: string) => { const parts = v.split(':').map((x) => parseInt(x, 10)); return parts.some((x) => isNaN(x)) ? null : parts.reduce((a, x) => a * 60 + x, 0); };
  const updCh = (i: number, patch: any) => setForm((f: any) => ({ ...f, chapters: f.chapters.map((c: any, j: number) => (j === i ? { ...c, ...patch } : c)) }));

  if (!open || !form) return null;

  return (
    <Modal open={open} onClose={onClose} title="Publish as video" wide>
      {done ? (
        <div className="space-y-4 text-center">
          <p className="text-[15px] font-semibold text-cream">Published</p>
          <p className="text-[13px] text-muted">Media, subtitles, and responsive thumbnails are in place. Cache purged.</p>
          {done.playlist && (
            <p className="text-[13px] text-gold-bright">
              Added to playlist <a href={`https://deensubs.com/playlist/${done.playlist.slug}`} target="_blank" rel="noreferrer" className="underline underline-offset-2">{done.playlist.title}</a>
            </p>
          )}
          <a href={`https://deensubs.com/watch/${done.slug}`} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-gold px-4 py-2 text-[13px] font-semibold text-ink hover:bg-gold-bright">
            <Icon name="external" className="h-3.5 w-3.5" /> Open /watch/{done.slug}
          </a>
        </div>
      ) : (
        <div className="space-y-3.5">
          <Field label="Title">
            <input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Arabic title">
              <input dir="rtl" className={inputCls + ' font-arabic'} value={form.title_ar} onChange={(e) => setForm({ ...form, title_ar: e.target.value })} />
            </Field>
            <Field label="Slug">
              <input className={inputCls + ' font-mono'} value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
            </Field>
          </div>
          <Field label="Description">
            <textarea rows={3} className={inputCls + ' resize-y'} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label={`Chapters (${(form.chapters || []).length})`}>
            <div className="space-y-1.5">
              {(form.chapters || []).map((ch: any, i: number) => (
                <div key={i} className="flex items-center gap-2">
                  <input className={inputCls + ' w-24 text-center font-mono'} value={ch._t ?? fmtT(ch.t)}
                    onChange={(e) => updCh(i, { _t: e.target.value })}
                    onBlur={() => { const t = parseT(ch._t ?? ''); updCh(i, { t: t == null ? ch.t : t, _t: undefined }); }} />
                  <input className={inputCls + ' flex-1'} value={ch.title} placeholder="Chapter title"
                    onChange={(e) => updCh(i, { title: e.target.value })} />
                  <button type="button" className="px-1 text-[15px] leading-none text-muted hover:text-cream" title="Remove chapter"
                    onClick={() => setForm({ ...form, chapters: form.chapters.filter((_: any, j: number) => j !== i) })}>×</button>
                </div>
              ))}
              <button type="button" className="text-[11px] font-medium text-muted hover:text-cream"
                onClick={() => setForm({ ...form, chapters: [...(form.chapters || []), { t: ((form.chapters || [])[form.chapters.length - 1]?.t ?? -60) + 60, title: '' }] })}>
                + Add chapter
              </button>
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <select className={inputCls} value={form.category_id ?? ''} onChange={(e) => setForm({ ...form, category_id: e.target.value ? parseInt(e.target.value) : null })}>
                <option value="">None</option>
                {(meta.data?.categories || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Scholar">
              <select className={inputCls} value={form.scholar_id ?? ''} onChange={(e) => setForm({ ...form, scholar_id: e.target.value ? parseInt(e.target.value) : null })}>
                <option value="">None</option>
                {(meta.data?.scholars || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          </div>

          <div
            onPaste={async (e) => {
              const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
              if (!f) return;
              e.preventDefault();
              try {
                const r = await fetch(`/api/upload?prefix=${encodeURIComponent(`scribe/${job.id}/`)}&name=custom-thumb`, {
                  method: 'POST', headers: { 'content-type': f.type }, body: f, credentials: 'include',
                });
                const j: any = await r.json();
                if (!r.ok) throw new Error(j.error || 'upload failed');
                setCustomThumb(j.key);
                setChosenKey(j.key);
                toast.push('Pasted thumbnail uploaded');
              } catch (er: any) { toast.push(er.message, 'error'); }
            }}
          >
            {arThumb?.arabic && (
              <div className="mb-2 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
                <span className="mt-0.5">⚠</span>
                <span>
                  This thumbnail contains <b>Arabic text</b>{arThumb.text ? <> (“{arThumb.text.slice(0, 60)}”)</> : null} — upload or paste an
                  English version before publishing.
                  {chosenKey && (
                    <a href={`https://cdn.deensubs.com/${chosenKey}`} download target="_blank" rel="noreferrer"
                      className="ml-1 underline underline-offset-2 hover:text-amber-100">Download original</a>
                  )}
                </span>
              </div>
            )}
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted">Thumbnail</p>
              <button type="button" onClick={() => thumbFileRef.current?.click()} className="text-[11px] text-muted hover:text-cream">
                Upload custom (or just Ctrl+V a copied image)
              </button>
              <input ref={thumbFileRef} type="file" accept="image/*" className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  try {
                    const r = await fetch(`/api/upload?prefix=${encodeURIComponent(`scribe/${job.id}/`)}&name=custom-thumb`, {
                      method: 'POST', headers: { 'content-type': f.type }, body: f, credentials: 'include',
                    });
                    const j: any = await r.json();
                    if (!r.ok) throw new Error(j.error || 'upload failed');
                    setCustomThumb(j.key);
                    setChosenKey(j.key);
                  } catch (er: any) { toast.push(er.message, 'error'); }
                }} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {!job.full_video && (() => {
                const schSlug = (meta.data?.scholars || []).find((s: any) => s.id === form.scholar_id)?.slug;
                if (!schSlug) return null;
                return (
                  <button key={schSlug} onClick={() => { setChosenKey(null); setChosenTs(null); }}
                    className={`relative overflow-hidden rounded-lg border-2 transition-all ${chosenKey === null ? 'border-gold' : 'border-transparent opacity-70 hover:opacity-100'}`}>
                    <img src={cardThumb?.dataUrl || `https://cdn.deensubs.com/scholars/cards/${schSlug}.jpg`} alt=""
                      className="aspect-video w-full object-cover"
                      onError={(e) => { const b = e.currentTarget.closest('button') as HTMLElement | null; if (b) b.style.display = 'none'; }} />
                    <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[10px] text-cream">{cardThumb ? 'Card + title · auto' : 'Scholar card · auto'}</span>
                  </button>
                );
              })()}
              {customThumb && (
                <button onClick={() => { setChosenKey(customThumb); setChosenTs(null); }}
                  className={`relative overflow-hidden rounded-lg border-2 transition-all ${chosenKey === customThumb ? 'border-gold' : 'border-transparent opacity-70 hover:opacity-100'}`}>
                  <img src={`https://cdn.deensubs.com/${customThumb}?v=${Date.now()}`} alt="" className="aspect-video w-full object-cover" />
                  <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[10px] text-cream">Custom</span>
                </button>
              )}
              {(cands || []).map((cand) => (
                <button
                  key={cand.key}
                  onClick={() => { setChosenTs(cand.ts); setChosenKey(null); }}
                  className={`relative overflow-hidden rounded-lg border-2 transition-all ${
                    chosenKey === null && chosenTs === cand.ts ? 'border-gold' : 'border-transparent opacity-70 hover:opacity-100'
                  }`}
                >
                  <img src={`https://cdn.deensubs.com/${cand.key}?v=${job.id}`} alt="" className="aspect-video w-full object-cover" />
                  <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] tabular-nums text-cream">
                    {Math.floor(cand.ts / 60)}:{String(cand.ts % 60).padStart(2, '0')}
                  </span>
                </button>
              ))}
              {cands === null && (
                <div className="flex aspect-video items-center justify-center gap-1.5 rounded-lg border border-hairline bg-inset text-[10px] text-muted">
                  <Spinner className="h-3 w-3" /> Extracting frames...
                </div>
              )}
            </div>
            {!!job.full_video && cands?.length === 0 && <p className="mt-1 text-[11px] text-red-400">Frame extraction failed{candErr ? ': ' + candErr : ''}.</p>}
            {!job.full_video && <p className="mt-1 text-[11px] text-faint">Audio-only job: the scholar's stage card with the title baked into its right zone is attached automatically; upload or paste an image to override.</p>}
            <p className="mt-1.5 text-[11px] text-faint">Responsive WebP variants (320/480/640) are generated on publish and mirrored to KV.</p>
          </div>

          {job.playlist_title && (
            <p className="text-[12px] text-muted">
              On publish, this video joins the playlist <span className="font-medium text-gold-bright">{job.playlist_title}</span>{job.playlist_pos != null ? ` at position ${job.playlist_pos + 1}` : ''}.
            </p>
          )}
          {err && <ErrorNote message={err} />}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              disabled={publishing || !form.title || !form.slug}
              onClick={async () => {
                setPublishing(true);
                setErr('');
                try {
                  // Audiobook without a manual image: bake the title onto the
                  // scholar card and publish that (falls back to the plain
                  // card server-side if this fails)
                  let thumbKey: string | undefined = chosenKey ?? undefined;
                  if (!job.full_video && !thumbKey && cardThumb) {
                    const up = await fetch(`/api/upload?prefix=${encodeURIComponent(`scribe/${job.id}/`)}&name=card-title`, {
                      method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: cardThumb.blob, credentials: 'include',
                    });
                    const uj: any = await up.json().catch(() => null);
                    if (up.ok && uj?.key) thumbKey = uj.key;
                  }
                  const r = await api(`/api/scribe/${job.id}/publish`, {
                    method: 'POST',
                    body: JSON.stringify({
                      ...form,
                      chapters: (form.chapters || []).filter((c: any) => c.title && c.title.trim())
                        .map((c: any) => ({ t: Math.max(0, Math.round(c.t || 0)), title: c.title.trim() })),
                      thumb_ts: thumbKey ? undefined : chosenTs ?? undefined, thumb_key: thumbKey,
                    }),
                  });
                  setDone(r);
                  toast.push(`Published /watch/${r.slug}`);
                } catch (e: any) {
                  setErr(e.message);
                }
                setPublishing(false);
              }}
            >
              {publishing ? 'Publishing...' : 'Publish video'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function JobDetail({ job }: { job: any }) {
  const [tab, setTab] = useState<'overview' | 'preview'>('overview');
  const [srt, setSrt] = useState<string | null>(null);
  const [dub, setDub] = useState<any>({ status: job.dub_status || 'none', key: job.dub_key });
  const [dubBusy, setDubBusy] = useState(false);
  const toast = useToast();

  // Poll dubbing progress while active
  useEffect(() => {
    if (dub.status !== 'dubbing') return;
    const t = setInterval(async () => {
      const r = await api(`/api/scribe/${job.id}/dub`).catch(() => null);
      if (r && r.status !== 'dubbing') {
        setDub(r);
        if (r.status === 'done') toast.push('Dub ready');
        if (r.status === 'error') toast.push('Dubbing failed: ' + (r.detail || ''), 'error');
      }
    }, 10000);
    return () => clearInterval(t);
  }, [dub.status, job.id]);
  const [publishOpen, setPublishOpen] = useState(false);
  const [fetchingVideo, setFetchingVideo] = useState(false);
  const isVideoSource = /\.(mp4|webm|mkv|mov)$/i.test(job.source_key || '');
  useEffect(() => {
    if (!job.srt_key) return;
    fetch(`/api/scribe/${job.id}/file?type=srt`)
      .then((r) => (r.ok ? r.text() : null))
      .then(setSrt)
      .catch(() => {});
  }, [job.id, job.srt_key]);

  return (
    <div className="border-t border-hairline pt-3">
      <div className="mb-3 flex items-center gap-1">
        {(['overview', 'preview'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1.5 text-[12px] font-medium capitalize transition-colors ${
              tab === t ? 'bg-soft text-cream' : 'text-muted hover:text-cream'
            }`}>
            {t === 'preview' ? 'Preview with subtitles' : t}
          </button>
        ))}
      </div>
      {tab === 'preview' ? (
        job.source_key ? <PreviewPlayer job={job} /> : <p className="py-6 text-center text-[13px] text-muted">Source media not available yet.</p>
      ) : (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3">
        {job.title && (
          <div>
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Title</p>
              <CopyButton text={job.title} />
            </div>
            <p className="mt-0.5 text-[13px] font-medium leading-snug text-cream">{job.title}</p>
          </div>
        )}
        {job.title_ar && (
          <div>
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Arabic title</p>
              <CopyButton text={job.title_ar} />
            </div>
            <p dir="rtl" className="mt-0.5 font-arabic text-[15px] leading-snug text-cream">{job.title_ar}</p>
          </div>
        )}
        {job.channel && (
          <div className="flex items-center gap-2">
            {job.channel_image_key && <img src={`https://cdn.deensubs.com/${job.channel_image_key}`} alt="" className="h-6 w-6 rounded-full border border-hairline object-cover" />}
            <span className="text-[12px] text-muted">{job.channel}</span>
            {job.yt_id && <span className="font-mono text-[10px] text-faint">yt:{job.yt_id}</span>}
          </div>
        )}
        {job.orig_description && (
          <details>
            <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-widest text-muted">Original description</summary>
            <p dir="auto" className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-[11.5px] leading-relaxed text-muted">{job.orig_description}</p>
          </details>
        )}
        {job.description && (
          <div>
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Description</p>
              <CopyButton text={job.description} />
            </div>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-cream/80">{job.description}</p>
          </div>
        )}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {!!job.speech_enhanced && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-violet-300" title="Audio restored with Sidon on a companion">
              SPEECH ENHANCED
            </span>
          )}
          {job.k4_status && job.k4_status !== 'none' && (
            <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${
              job.k4_status === 'done' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : job.k4_status === 'claimed' ? 'border-gold/40 bg-gold/10 text-gold-bright'
              : 'border-sky-500/30 bg-sky-500/10 text-sky-300'}`}
              title="Source has >1080p formats — run tools/encode-4k.py --queue on any machine to upgrade">
              {job.k4_status === 'done' ? '4K ✓' : job.k4_status === 'claimed' ? `4K encoding — ${job.k4_claimed_by || '…'}` : '4K available'}
            </span>
          )}
          {job.status === 'done' && (
            <button
              onClick={() => (window as any).__openEditor?.(job)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-soft px-2.5 py-1.5 text-[11px] font-medium text-cream/80 transition-all hover:bg-hover active:scale-[0.97]"
            >
              <Icon name="edit" className="h-3 w-3" /> Edit subtitles
            </button>
          )}
          {job.status === 'done' && job.published_slug && (
            <a href={`https://deensubs.com/watch/${job.published_slug}`} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-300 transition-all hover:bg-emerald-500/20 active:scale-[0.97]">
              <Icon name="external" className="h-3 w-3" /> Published — /watch/{job.published_slug}
            </a>
          )}
          {job.status === 'done' && !job.published_slug && (
            isVideoSource ? (
              <button
                onClick={() => setPublishOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gold px-2.5 py-1.5 text-[11px] font-semibold text-ink transition-all hover:bg-gold-bright active:scale-[0.97]"
              >
                <Icon name="video" className="h-3 w-3" /> Publish as video
              </button>
            ) : (
              <>
                <button
                  onClick={() => setPublishOpen(true)}
                  title="Publishes the audio with the karaoke transcript player — pick scholar, artwork, and title in the wizard"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gold px-2.5 py-1.5 text-[11px] font-semibold text-ink transition-all hover:bg-gold-bright active:scale-[0.97]"
                >
                  <Icon name="play" className="h-3 w-3" /> Publish audiobook
                </button>
                {!String(job.url || '').startsWith('upload://') && (
                  <button
                    disabled={fetchingVideo}
                    onClick={async () => {
                      setFetchingVideo(true);
                      try {
                        await api(`/api/scribe/${job.id}/fetch-video`, { method: 'POST' });
                        toast.push('Fetching video — publish unlocks when it lands');
                      } catch (e: any) {
                        toast.push(e.message, 'error');
                      }
                      setFetchingVideo(false);
                    }}
                    title="Downloads the video for this URL (transcript + subtitles reused), then Publish as video unlocks"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-soft px-2.5 py-1.5 text-[11px] font-semibold text-muted transition-all hover:text-cream active:scale-[0.97] disabled:opacity-50"
                  >
                    <Icon name="video" className="h-3 w-3" /> {fetchingVideo ? 'Starting...' : 'Fetch video instead'}
                  </button>
                )}
              </>
            )
          )}
          {job.status === 'done' && (
            dub.status === 'done' && dub.key ? (
              <a href={`/api/scribe/${job.id}/dub/file`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-300 transition-all hover:bg-emerald-500/20 active:scale-[0.97]">
                <Icon name="download" className="h-3 w-3" /> Dub audio
              </a>
            ) : dub.status === 'dubbing' ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-soft px-2.5 py-1.5 text-[11px] text-muted">
                <Spinner className="h-3 w-3" /> Dubbing...
              </span>
            ) : (
              <button
                disabled={dubBusy}
                onClick={async () => {
                  setDubBusy(true);
                  try {
                    await api(`/api/scribe/${job.id}/dub`, { method: 'POST', body: JSON.stringify({ lang: job.target_lang }) });
                    setDub({ status: 'dubbing' });
                    toast.push('Dubbing started — takes several minutes');
                  } catch (e: any) {
                    toast.push(e.message, 'error');
                  }
                  setDubBusy(false);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-soft px-2.5 py-1.5 text-[11px] font-medium text-cream/80 transition-all hover:bg-hover active:scale-[0.97]"
              >
                <Icon name="globe" className="h-3 w-3" /> {dubBusy ? 'Starting...' : `Dub ${String(job.target_lang).toUpperCase()}`}
              </button>
            )
          )}
          {job.status === 'done' && (
            <button
              onClick={async () => {
                if (!confirm('Re-translate with the current quality pipeline? Existing subtitles for this job are replaced (download + transcript reused).')) return;
                try {
                  await api(`/api/scribe/${job.id}/retranslate-all`, { method: 'POST' });
                  toast.push('Re-translation started');
                } catch (e: any) {
                  toast.push(e.message, 'error');
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-soft px-2.5 py-1.5 text-[11px] font-medium text-cream/80 transition-all hover:bg-hover active:scale-[0.97]"
            >
              <Icon name="refresh" className="h-3 w-3" /> Re-translate
            </button>
          )}
          {job.srt_key && (
            <a href={`/api/scribe/${job.id}/file?type=srt`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gold/25 bg-gold/10 px-2.5 py-1.5 text-[11px] font-semibold text-gold-bright transition-all hover:bg-gold/20 active:scale-[0.97]">
              <Icon name="download" className="h-3 w-3" /> {String(job.target_lang).toUpperCase()} subtitles
            </a>
          )}
          {job.srt_source_key && (
            <a href={`/api/scribe/${job.id}/file?type=source`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-soft px-2.5 py-1.5 text-[11px] font-medium text-cream/80 transition-all hover:bg-hover active:scale-[0.97]">
              <Icon name="download" className="h-3 w-3" /> Source subtitles
            </a>
          )}
          {job.asr_key && (
            <a href={`/api/scribe/${job.id}/file?type=asr`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-soft px-2.5 py-1.5 text-[11px] font-medium text-muted transition-all hover:bg-hover active:scale-[0.97]">
              <Icon name="download" className="h-3 w-3" /> Raw transcript
            </a>
          )}
        </div>
        <QualityCard job={job} />
      </div>
      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted">Subtitle preview</p>
        {srt ? (
          <pre className="max-h-64 overflow-y-auto rounded-xl border border-hairline bg-inset p-3 font-mono text-[11px] leading-relaxed text-cream/75">
            {srt.split('\n\n').slice(0, 10).join('\n\n')}
          </pre>
        ) : job.srt_key ? (
          <div className="flex h-24 items-center justify-center"><Spinner /></div>
        ) : (
          <p className="text-[12px] text-muted">Not ready yet.</p>
        )}
      </div>
    </div>
      )}
      <PublishModal job={job} open={publishOpen} onClose={() => setPublishOpen(false)} />
    </div>
  );
}

function CookiesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const status = useApi<any>(open ? '/api/scribe/cookies' : null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  return (
    <Modal open={open} onClose={onClose} title="yt-dlp cookies" wide>
      <p className="text-[12.5px] leading-relaxed text-muted">
        YouTube increasingly requires a signed-in session. Export your cookies with a "Get cookies.txt" browser
        extension while signed into YouTube, paste the file contents below, and every yt-dlp download will use them.
        yt-dlp itself self-updates to the latest release before runs.
      </p>
      <div className="mt-3 flex items-center gap-2">
        {status.data?.set ? (
          <Badge tone="green">active · {status.data.lines} cookies · updated {fmtAgo(status.data.updated)}</Badge>
        ) : (
          <Badge tone="dim">no cookies stored</Badge>
        )}
      </div>
      <textarea
        rows={8}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t...'}
        spellCheck={false}
        className="mt-3 w-full resize-y rounded-xl border border-hairline bg-inset p-3 font-mono text-[11px] leading-relaxed text-cream outline-none focus:border-gold/40"
      />
      {msg && <p className="mt-2 text-[12px] text-gold-bright">{msg}</p>}
      <div className="mt-4 flex justify-between">
        <Button
          variant="danger"
          disabled={busy || !status.data?.set}
          onClick={async () => {
            setBusy(true);
            await api('/api/scribe/cookies', { method: 'DELETE' });
            setMsg('Cookies cleared.');
            status.refetch();
            setBusy(false);
          }}
        >
          Clear stored cookies
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button
            disabled={busy || !text.trim()}
            onClick={async () => {
              setBusy(true);
              setMsg('');
              try {
                const r = await api('/api/scribe/cookies', { method: 'PUT', body: JSON.stringify({ cookies: text }) });
                setMsg(`Saved ${r.lines} cookies.`);
                setText('');
                status.refetch();
              } catch (e: any) {
                setMsg('Failed: ' + e.message);
              }
              setBusy(false);
            }}
          >
            {busy ? 'Saving...' : 'Save cookies'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default function Scribe() {
  const { data, loading, error, refetch } = useApi<any>('/api/scribe');
  const [url, setUrl] = useState('');
  const [lang, setLang] = useState('en');
  const [extraLangs, setExtraLangs] = useState<string[]>([]);
  const [fullVideo, setFullVideo] = useState(true);
  const [batch, setBatch] = useState<null | { title: string; entries: any[]; picked: Set<string>; ytId: string | null; makePlaylist: boolean; plTitle: string }>(null);
  const [probe, setProbe] = useState<any | null>(null);
  const [probing, setProbing] = useState(false);
  const [enumerating, setEnumerating] = useState(false);
  const [editorJob, setEditorJob] = useState<any | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<any | null>(null);
  const [cookiesOpen, setCookiesOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'done' | 'published' | 'error'>('all');
  const [q, setQ] = useState('');
  const toast = useToast();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Local file drag & drop → chunked upload → job with the download step pre-satisfied
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  const [upload, setUpload] = useState<{ name: string; pct: number; phase: string; queued: number } | null>(null);
  const upFileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    (window as any).__openEditor = (j: any) => setEditorJob(j);
    return () => { delete (window as any).__openEditor; };
  }, []);

  const jobs = data?.jobs || [];
  const anyRunning = jobs.some((j: any) => j.status === 'running' || j.status === 'queued');
  const weekAgo = Date.now() - 7 * 86400e3;
  const stats = {
    running: jobs.filter((j: any) => j.status === 'running' || j.status === 'queued').length,
    week: jobs.filter((j: any) => new Date((j.created_at || '').replace(' ', 'T') + 'Z').getTime() > weekAgo).length,
    minutes: Math.round(jobs.reduce((a: number, j: any) => a + (j.asr_seconds || 0), 0) / 60),
    cost: jobs.reduce((a: number, j: any) => a + (j.asr_seconds / 3600) * 0.4 + (j.llm_cost || (j.llm_tokens / 1e6) * 0.4), 0),
  };
  const shownJobs = jobs.filter((j: any) => {
    if (statusFilter === 'running' && !(j.status === 'running' || j.status === 'queued')) return false;
    // "done" means finished but not yet published; published jobs get their own filter
    if (statusFilter === 'done' && !(j.status === 'done' && !j.published_slug)) return false;
    if (statusFilter === 'published' && !(j.status === 'done' && j.published_slug)) return false;
    if (statusFilter === 'error' && j.status !== 'error') return false;
    if (q.trim() && !`${j.title || ''} ${j.url}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });
  const prevStatus = useRef<Record<string, string>>({});

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  }, []);
  useEffect(() => {
    for (const j of jobs) {
      const prev = prevStatus.current[j.id];
      if (prev && prev !== j.status && (j.status === 'done' || j.status === 'error')) {
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('DeenSubs Scribe', {
            body: j.status === 'done' ? `Done: ${j.title || j.url}` : `Failed: ${j.title || j.url}`,
          });
        }
      }
      prevStatus.current[j.id] = j.status;
    }
  }, [jobs]);

  // Poll while anything is in flight; tick the clock for live stage durations
  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (anyRunning) {
      timer.current = setInterval(() => {
        setNow(Date.now());
        refetch();
      }, 3000);
    }
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [anyRunning, refetch]);

  const looksLikePlaylist = /[?&]list=|\/playlist|\/@[\w.-]+|\/channel\//.test(url);

  // Paste intelligence: instant identity probe + container pre-warm
  useEffect(() => {
    setProbe(null);
    if (!/^https?:\/\/\S+$/.test(url.trim()) || looksLikePlaylist) return;
    const u = url.trim();
    setProbing(true);
    const t = setTimeout(async () => {
      api('/api/scribe/prewarm', { method: 'POST' }).catch(() => {});
      try {
        const fast = await api('/api/scribe/probe', { method: 'POST', body: JSON.stringify({ url: u }) });
        setProbe(fast);
        setProbing(false);
        // Deep probe fills duration + cost (container, a few seconds)
        if (!fast.duration) {
          const deep = await api('/api/scribe/probe', { method: 'POST', body: JSON.stringify({ url: u, deep: true }) });
          setProbe((cur: any) => (cur && cur.url === deep.url ? { ...cur, ...deep } : cur));
        }
      } catch {
        setProbing(false);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [url, looksLikePlaylist]);

  async function submit() {
    if (!url.trim() || submitting) return;
    if (looksLikePlaylist) return enumerate();
    setSubmitting(true);
    setSubmitErr('');
    try {
      const r = await api('/api/scribe', {
        method: 'POST',
        body: JSON.stringify({
          url: url.trim(),
          target_langs: [lang, ...extraLangs],
          full_video: fullVideo,
          title: probe?.title,
          channel: probe?.channel,
          thumb_url: probe?.thumb_url,
        }),
      });
      setUrl('');
      setProbe(null);
      setExpanded(r.job?.id || null);
      refetch();
    } catch (e: any) {
      setSubmitErr(e.message);
    }
    setSubmitting(false);
  }

  async function enumerate() {
    setEnumerating(true);
    setSubmitErr('');
    try {
      const r = await api('/api/scribe/enumerate', { method: 'POST', body: JSON.stringify({ url: url.trim() }) });
      if (r.error) throw new Error(r.error);
      setBatch({
        title: r.title || 'Playlist',
        entries: r.entries || [],
        picked: new Set(),
        ytId: r.yt_playlist_id || null,
        // Real playlist URLs default to creating a site playlist; channel imports don't
        makePlaylist: !!r.yt_playlist_id,
        plTitle: r.title || '',
      });
    } catch (e: any) {
      setSubmitErr(e.message);
    }
    setEnumerating(false);
  }

  const UP_EXT = /\.(mp4|webm|mkv|mov|m4a|mp3|wav|aac|ogg|opus|flac)$/i;

  async function uploadLocal(files: File[]) {
    const good = files.filter((f) => {
      if (!UP_EXT.test(f.name)) { toast.push(`${f.name}: unsupported type (video or audio files only)`, 'error'); return false; }
      if (!f.size) { toast.push(`${f.name}: empty file`, 'error'); return false; }
      return true;
    });
    for (let fi = 0; fi < good.length; fi++) {
      const file = good[fi];
      const queued = good.length - fi - 1;
      setUpload({ name: file.name, pct: 0, phase: 'Reading', queued });
      // Duration from the browser's decoder — free, and lets the pipeline skip a probe
      const duration = await new Promise<number>((resolve) => {
        const el = document.createElement('video');
        el.preload = 'metadata';
        const src = URL.createObjectURL(file);
        const done = (d: number) => { URL.revokeObjectURL(src); resolve(d); };
        el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? Math.round(el.duration) : 0);
        el.onerror = () => done(0);
        el.src = src;
      });
      let started: any = null;
      try {
        started = await api('/api/scribe/upload/start', {
          method: 'POST',
          body: JSON.stringify({ filename: file.name, content_type: file.type, size: file.size }),
        });
        const CHUNK = 32 * 1024 * 1024;
        const total = Math.ceil(file.size / CHUNK);
        const parts: { partNumber: number; etag: string }[] = [];
        for (let n = 1; n <= total; n++) {
          const blob = file.slice((n - 1) * CHUNK, Math.min(n * CHUNK, file.size));
          let uploaded: any = null;
          for (let attempt = 0; ; attempt++) {
            try {
              const r = await fetch(`/api/scribe/4k/upload/part?objkey=${encodeURIComponent(started.key)}&uploadId=${encodeURIComponent(started.uploadId)}&part=${n}`,
                { method: 'PUT', body: blob, credentials: 'include' });
              if (!r.ok) throw new Error(`part ${n}/${total}: HTTP ${r.status}`);
              uploaded = await r.json();
              break;
            } catch (e) {
              if (attempt >= 2) throw e;
            }
          }
          parts.push({ partNumber: uploaded.partNumber, etag: uploaded.etag });
          setUpload({ name: file.name, pct: Math.round((n / total) * 100), phase: 'Uploading', queued });
        }
        setUpload({ name: file.name, pct: 100, phase: 'Starting pipeline', queued });
        const fin = await api('/api/scribe/upload/finish', {
          method: 'POST',
          body: JSON.stringify({
            job_id: started.job_id, objkey: started.key, uploadId: started.uploadId, parts,
            filename: file.name, duration, target_langs: [lang, ...extraLangs],
          }),
        });
        setExpanded(fin.job?.id || null);
        refetch();
      } catch (e: any) {
        if (started) {
          api('/api/scribe/upload/finish', {
            method: 'POST',
            body: JSON.stringify({ job_id: started.job_id, objkey: started.key, uploadId: started.uploadId, abort: true }),
          }).catch(() => {});
        }
        toast.push(`${file.name}: ${e.message}`, 'error');
      }
    }
    setUpload(null);
  }

  return (
    <div className="space-y-5">
      {/* Composer */}
      <BlurFade>
        <div
          onDragEnter={(e) => { e.preventDefault(); dragDepth.current++; setDragOver(true); }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => { if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragOver(false); } }}
          onDrop={(e) => {
            e.preventDefault();
            dragDepth.current = 0;
            setDragOver(false);
            const fs = [...(e.dataTransfer?.files || [])];
            if (fs.length) uploadLocal(fs);
          }}
        >
        <GlowCard className="relative overflow-hidden p-6">
          {dragOver && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[inherit] border-2 border-dashed border-[#45b3a2] bg-[#45b3a2]/10">
              <p className="text-[13px] font-medium text-cream">Drop video / audio files to transcribe</p>
            </div>
          )}
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight text-cream">Add a video</h2>
              <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-muted">
                Direct links download at the edge. YouTube and blocked hosts spin up an isolated yt-dlp container
                that dials through the Padborg proxies (always the latest yt-dlp, with your cookies). ElevenLabs
                Scribe v2 transcribes, Gemini translates on word-index timing, and metadata is written from the
                full transcript. Or drag &amp; drop a local video / mp3 anywhere on this card.
              </p>
            </div>
            <button
              onClick={() => setCookiesOpen(true)}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-hairline bg-soft px-2.5 py-1.5 text-[11px] font-medium text-muted transition-colors hover:text-cream"
            >
              <Icon name="wrench" className="h-3.5 w-3.5" /> Cookies
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <input
              className={inputCls + ' min-w-64 flex-1 py-2.5 font-mono text-[12.5px]'}
              placeholder="https://youtube.com, x.com, tiktok.com, facebook.com — any yt-dlp site   or a direct .mp4 / .mp3 URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
            <select className={inputCls + ' w-32 py-2.5'} value={lang} onChange={(e) => setLang(e.target.value)}>
              {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
            <RouteSelect />
            <Button onClick={submit} disabled={submitting || enumerating || !url.trim()} className="px-5">
              {enumerating ? 'Listing...' : submitting ? 'Starting...' : looksLikePlaylist ? 'List videos' : 'Transcribe'}
            </Button>
            <button
              onClick={() => upFileRef.current?.click()}
              disabled={!!upload}
              className="flex items-center gap-1.5 rounded-lg border border-hairline bg-soft px-3 py-2.5 text-[12px] font-medium text-muted transition-colors hover:text-cream disabled:opacity-50"
              title="Upload a local video or audio file"
            >
              Upload file
            </button>
            <input
              ref={upFileRef} type="file" multiple className="hidden"
              accept="video/*,audio/*,.mkv,.mov,.m4a,.opus,.flac"
              onChange={(e) => {
                const fs = [...(e.target.files || [])];
                e.target.value = '';
                if (fs.length) uploadLocal(fs);
              }}
            />
          </div>
          {(probe || probing) && !looksLikePlaylist && (
            <div className="mt-3 flex items-center gap-3 rounded-xl border border-hairline bg-inset p-2.5">
              {probe?.thumb_url ? (
                <img src={probe.thumb_url} alt="" className="h-14 w-24 shrink-0 rounded-lg border border-hairline object-cover" />
              ) : (
                <div className="flex h-14 w-24 shrink-0 items-center justify-center rounded-lg border border-hairline bg-soft">
                  {probing ? <Spinner className="h-4 w-4" /> : <Icon name="video" className="h-4 w-4 text-faint" />}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-cream">{probe?.title || (probing ? 'Looking up video...' : url)}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted">
                  {probe?.channel && <span>{probe.channel}</span>}
                  {probe?.duration > 0 && <span className="tabular-nums">{fmtDuration(probe.duration)}</span>}
                  {probe?.est_cost != null && <span className="tabular-nums text-gold-bright">≈${probe.est_cost.toFixed(2)}</span>}
                  {probe?.bytes > 0 && <span className="tabular-nums">{(probe.bytes / 1048576).toFixed(0)} MB</span>}
                  {probe?.path && <Badge tone="dim" className="font-mono text-[9px]">{probe.path === 'yt-dlp' ? 'yt-dlp + proxy' : 'edge download'}</Badge>}
                  {probe && !probe.duration && probe.path === 'yt-dlp' && <span className="text-faint">probing duration...</span>}
                </div>
                {probe?.duplicate && (
                  <p className="mt-1 text-[11px] text-amber-400">
                    Already transcribed: "{probe.duplicate.title || probe.duplicate.id}" ({probe.duplicate.status}) — queueing again makes a duplicate.
                  </p>
                )}
              </div>
            </div>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <label className="flex items-center gap-1.5 text-[11px] text-muted">
              <input type="checkbox" checked={fullVideo} onChange={(e) => setFullVideo(e.target.checked)} className="accent-[#45b3a2]" />
              Full video (for publishing + clips)
            </label>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-faint">Also translate to:</span>
              {LANGS.filter((l) => l.code !== lang).map((l) => (
                <button key={l.code}
                  onClick={() => setExtraLangs((xs) => xs.includes(l.code) ? xs.filter((x) => x !== l.code) : [...xs, l.code])}
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                    extraLangs.includes(l.code) ? 'border-gold/40 bg-gold/10 text-gold-bright' : 'border-hairline text-faint hover:text-muted'
                  }`}>
                  {l.code}
                </button>
              ))}
            </div>
          </div>
          {upload && (
            <div className="mt-3 flex items-center gap-3 rounded-xl border border-hairline bg-inset p-2.5">
              <Spinner className="h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-cream">{upload.name}</p>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-soft">
                  <div className="h-full rounded-full bg-[#45b3a2] transition-all" style={{ width: upload.pct + '%' }} />
                </div>
              </div>
              <span className="shrink-0 text-[11px] tabular-nums text-muted">
                {upload.phase} · {upload.pct}%{upload.queued > 0 ? ` · ${upload.queued} more queued` : ''}
              </span>
            </div>
          )}
          {submitErr && <p className="mt-2 text-[12px] text-red-400">{submitErr}</p>}
        </GlowCard>
        </div>
      </BlurFade>

      {error && <ErrorNote message={error} onRetry={refetch} />}

      {/* Stats strip + filters */}
      {jobs.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-hairline bg-soft px-4 py-2.5">
          <span className="text-[12px] text-muted"><b className="text-cream">{stats.running}</b> running</span>
          <span className="text-[12px] text-muted"><b className="text-cream">{stats.week}</b> this week</span>
          <span className="text-[12px] text-muted"><b className="text-cream">{stats.minutes}</b> min transcribed</span>
          <span className="text-[12px] text-muted">≈<b className="text-gold-bright">${stats.cost.toFixed(2)}</b> spent</span>
          <div className="ml-auto flex items-center gap-1.5">
            {(['all', 'running', 'done', 'published', 'error'] as const).map((f) => (
              <button key={f} onClick={() => setStatusFilter(f)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium capitalize transition-colors ${
                  statusFilter === f ? 'border-gold/40 bg-gold/10 text-gold-bright' : 'border-hairline text-faint hover:text-muted'
                }`}>
                {f}
              </button>
            ))}
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter..."
              className="w-28 rounded-lg border border-hairline bg-inset px-2.5 py-1 text-[12px] text-cream outline-none placeholder:text-faint focus:border-gold/40"
            />
          </div>
        </div>
      )}

      {/* Jobs */}
      <div className="space-y-3">
        {loading && !jobs.length && (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl border border-hairline bg-soft" />
            ))}
          </div>
        )}
        {shownJobs.map((j: any, i: number) => (
          <BlurFade key={j.id} delay={Math.min(i * 0.03, 0.15)}>
            <GlowCard glow={false} className="overflow-hidden">
              <button
                className="block w-full p-4 text-left"
                onClick={() => setExpanded(expanded === j.id ? null : j.id)}
              >
                <div className="flex items-center gap-3">
                  {j.thumb_url ? (
                    <div className="relative hidden h-12 w-20 shrink-0 overflow-hidden rounded-lg border border-hairline sm:block">
                      <img src={j.thumb_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                      {j.step === 'download' && j.status === 'running' && (
                        <div className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
                          <div className="h-full bg-gold transition-all duration-500" style={{ width: `${j.download_pct || 0}%` }} />
                        </div>
                      )}
                    </div>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-cream" title={j.title || j.url}>
                      {j.title || j.url}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
                      {j.status === 'done' && <Badge tone="green">done</Badge>}
                      {j.status === 'error' && <Badge tone="red">failed</Badge>}
                      {j.status === 'running' && <Badge tone="gold">running</Badge>}
                      {j.status === 'queued' && <Badge tone="dim">queued</Badge>}
                      {j.channel && <span className="text-cream/60">{j.channel}</span>}
                      {j.playlist_title && (
                        <span className="inline-flex items-center gap-1 rounded bg-gold/10 px-1.5 py-0.5 text-[10px] font-medium text-gold-bright" title={`Joins playlist "${j.playlist_title}" on publish`}>
                          <Icon name="folder" className="h-2.5 w-2.5" /> {j.playlist_title}{j.playlist_pos != null ? ` · #${j.playlist_pos + 1}` : ''}
                        </span>
                      )}
                      {j.step === 'download' && j.status === 'running' && j.download_pct > 0 && (
                        <span className="tabular-nums text-gold-bright">{Math.round(j.download_pct)}%</span>
                      )}
                      {j.language_code && <span>{j.language_code} → {j.target_lang}</span>}
                      {j.download_method && <span className="font-mono text-[10px]">{j.download_method}</span>}
                      {j.duration > 0 && <span>{fmtDuration(j.duration)}</span>}
                      {(() => { try { const q = JSON.parse(j.quality || ''); return q?.grade ? (
                        <span className={`rounded px-1 font-bold ${q.grade === 'A' ? 'text-emerald-400' : q.grade === 'B' ? 'text-gold-bright' : q.grade === 'C' ? 'text-amber-400' : 'text-red-400'}`}>{q.grade}</span>
                      ) : null; } catch { return null; } })()}
                      {j.cue_count > 0 && <span>{j.cue_count} cues</span>}
                      {j.asr_seconds > 0 && (
                        <span className="tabular-nums" title="Estimated cost: ElevenLabs ASR + LLM tokens">
                          ~${((j.asr_seconds / 3600) * 0.4 + (j.llm_cost || (j.llm_tokens / 1e6) * 0.4)).toFixed(2)}
                        </span>
                      )}
                      <span>{fmtAgo(j.created_at)}</span>
                    </div>
                  </div>
                  <div className="hidden w-[340px] shrink-0 sm:block">
                    <Timeline job={j} now={now} />
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {j.status === 'error' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          api(`/api/scribe/${j.id}/resume`, { method: 'POST' })
                            .then(() => { toast.push('Resuming from last completed step'); refetch(); })
                            .catch((err) => toast.push(err.message, 'error'));
                        }}
                        title="Resume from last completed step (download/transcript reused)"
                        className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[11px] font-medium text-gold transition-colors hover:bg-gold-dim"
                      >
                        <Icon name="refresh" className="h-3.5 w-3.5" /> Resume
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDelete(j); }}
                      title="Delete job and files"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-red-500/10 hover:text-red-400"
                    >
                      <Icon name="trash" className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {j.error && <p className="mt-2 break-all text-[11px] leading-relaxed text-red-400/90">{j.error}</p>}
                <div className="mt-3 sm:hidden">
                  <Timeline job={j} now={now} />
                </div>
              </button>
              <AnimatePresence>
                {expanded === j.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-4">
                      <JobDetail job={j} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </GlowCard>
          </BlurFade>
        ))}
        {!loading && !shownJobs.length && (
          <div className="rounded-2xl border border-dashed border-hairline py-14 text-center">
            <Icon name="captions" className="mx-auto h-8 w-8 text-muted/30" />
            <p className="mt-3 text-[13px] text-muted">No transcriptions yet. Paste a URL above to start.</p>
          </div>
        )}
      </div>

      {batch && (
        <Modal open onClose={() => setBatch(null)} title={`${batch.title} — ${batch.entries.length} videos`} wide>
          <div className="mb-3 flex items-center gap-2">
            <Button variant="ghost" className="px-3 py-1.5 text-[12px]"
              onClick={() => setBatch({ ...batch, picked: new Set(batch.entries.map((e: any) => e.url)) })}>
              Select all
            </Button>
            <Button variant="ghost" className="px-3 py-1.5 text-[12px]" onClick={() => setBatch({ ...batch, picked: new Set() })}>
              Clear
            </Button>
            <span className="ml-auto text-[12px] text-muted">{batch.picked.size} selected</span>
          </div>
          <div className="max-h-96 space-y-0.5 overflow-y-auto">
            {batch.entries.map((e: any) => (
              <label key={e.url} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-hover">
                <input type="checkbox" className="accent-[#45b3a2]"
                  checked={batch.picked.has(e.url)}
                  onChange={() => {
                    const picked = new Set(batch.picked);
                    picked.has(e.url) ? picked.delete(e.url) : picked.add(e.url);
                    setBatch({ ...batch, picked });
                  }} />
                <span className="min-w-0 flex-1 truncate text-[13px] text-cream/85">{e.title}</span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-faint">{fmtDuration(e.duration)}</span>
              </label>
            ))}
          </div>
          <div className="mt-4 rounded-xl border border-hairline bg-inset p-3">
            <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-cream/85">
              <input type="checkbox" className="accent-[#45b3a2]" checked={batch.makePlaylist}
                onChange={(e) => setBatch({ ...batch, makePlaylist: e.target.checked })} />
              Create playlist on DeenSubs — each video joins it automatically when published, in this order
            </label>
            {batch.makePlaylist && (
              <input
                className={inputCls + ' mt-2'}
                placeholder="Playlist title"
                value={batch.plTitle}
                onChange={(e) => setBatch({ ...batch, plTitle: e.target.value })}
              />
            )}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setBatch(null)}>Cancel</Button>
            <Button disabled={!batch.picked.size || (batch.makePlaylist && !batch.plTitle.trim())} onClick={async () => {
              // Preserve the source playlist order regardless of click order
              const urls = batch.entries.map((en: any) => en.url).filter((u: string) => batch.picked.has(u));
              const r = await api('/api/scribe/batch', {
                method: 'POST',
                body: JSON.stringify({
                  urls,
                  target_langs: [lang, ...extraLangs],
                  full_video: fullVideo,
                  playlist: batch.makePlaylist && batch.plTitle.trim() ? {
                    title: batch.plTitle.trim(),
                    yt_id: batch.ytId,
                    // Context for the AI naming of a brand-new playlist (English title + description)
                    video_titles: batch.entries.filter((en: any) => batch.picked.has(en.url)).map((en: any) => en.title).filter(Boolean),
                    channel: batch.entries.find((en: any) => en.uploader)?.uploader || undefined,
                  } : undefined,
                }),
              });
              toast.push(`Queued ${r.created} jobs${r.playlist_id ? ' — playlist ready, videos join it on publish' : ''}`);
              setBatch(null);
              setUrl('');
              refetch();
            }}>
              Queue {batch.picked.size} jobs
            </Button>
          </div>
        </Modal>
      )}

      {editorJob && <SubtitleEditor job={editorJob} onClose={() => { setEditorJob(null); refetch(); }} />}

      <CookiesModal open={cookiesOpen} onClose={() => setCookiesOpen(false)} />

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete job">
        <p className="text-[13px] leading-relaxed text-cream/80">
          Delete this job and all its files (source media, transcript, SRTs, metadata) from R2?
          {confirmDelete?.status === 'running' && ' The running pipeline will be terminated.'}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button variant="danger" onClick={async () => {
            await api(`/api/scribe/${confirmDelete.id}`, { method: 'DELETE' });
            setConfirmDelete(null);
            refetch();
          }}>Delete</Button>
        </div>
      </Modal>
    </div>
  );
}
