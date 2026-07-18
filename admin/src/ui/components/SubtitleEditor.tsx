// Full-screen subtitle editor: source ↔ translation, QA flags, per-cue
// retranslation, synced video preview. Saving re-renders the SRTs in R2.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { fmtDuration } from '../lib/format';
import { Button, Spinner, Badge } from './Primitives';
import { Icon } from './Icon';
import { useToast } from './Toast';

type Cue = { start: number; end: number; text: string; source: string };

function qaFlags(c: Cue): string[] {
  const flags: string[] = [];
  const dur = c.end - c.start;
  const cps = dur > 0 ? c.text.length / dur : 0;
  if (cps > 25) flags.push(`CPS ${Math.round(cps)}`);
  if (c.text.length > 90) flags.push('long');
  if (dur > 0.5 && c.source.length > 25 && c.text.length < c.source.length * 0.25) flags.push('short?');
  if (/,\s*$/.test(c.text)) flags.push('trailing ,');
  return flags;
}

export function SubtitleEditor({ job, onClose }: { job: any; onClose: () => void }) {
  const [cues, setCues] = useState<Cue[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [active, setActive] = useState(-1);
  const videoRef = useRef<HTMLVideoElement>(null);
  const toast = useToast();

  useEffect(() => {
    api(`/api/scribe/${job.id}/cues`).then((r) => setCues(r.cues)).catch((e) => toast.push(e.message, 'error'));
  }, [job.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const flagged = useMemo(() => (cues || []).map((c) => qaFlags(c)), [cues]);
  const flaggedCount = flagged.filter((f) => f.length).length;

  function update(i: number, text: string) {
    setCues((cs) => cs!.map((c, j) => (j === i ? { ...c, text } : c)));
    setDirty(true);
  }

  async function save() {
    if (!cues || saving) return;
    setSaving(true);
    try {
      await api(`/api/scribe/${job.id}/cues`, { method: 'PUT', body: JSON.stringify({ cues }) });
      setDirty(false);
      toast.push('Saved — SRT files re-rendered');
    } catch (e: any) {
      toast.push(e.message, 'error');
    }
    setSaving(false);
  }

  async function retranslate(i: number) {
    if (!cues) return;
    setBusy(i);
    try {
      const ctx = [cues[i - 1]?.text, cues[i + 1]?.text].filter(Boolean).join(' … ');
      const r = await api(`/api/scribe/${job.id}/retranslate`, {
        method: 'POST',
        body: JSON.stringify({ source: cues[i].source, current: cues[i].text, target_lang: job.target_lang, context: ctx }),
      });
      update(i, r.translation);
    } catch (e: any) {
      toast.push(e.message, 'error');
    }
    setBusy(null);
  }

  function seekTo(i: number) {
    setActive(i);
    const v = videoRef.current;
    if (v && cues) {
      v.currentTime = cues[i].start;
      v.play().catch(() => {});
    }
  }

  // Highlight the cue under the playhead
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !cues) return;
    const onTime = () => {
      const t = v.currentTime;
      const i = cues.findIndex((c) => t >= c.start && t < c.end);
      if (i >= 0 && i !== active) setActive(i);
    };
    v.addEventListener('timeupdate', onTime);
    return () => v.removeEventListener('timeupdate', onTime);
  }, [cues, active]);

  const list = cues || [];

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-ink">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-hairline px-4">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="text-[13px] text-muted hover:text-cream">← Back</button>
          <span className="text-faint">/</span>
          <h2 className="max-w-md truncate text-[13px] font-medium text-cream">{job.title || job.id}</h2>
          <Badge tone="dim">{list.length} cues</Badge>
          {flaggedCount > 0 && <Badge tone="red">{flaggedCount} flagged</Badge>}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-muted">
            <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} className="accent-[#c4a44c]" />
            flagged only
          </label>
          <Button onClick={save} disabled={!dirty || saving} className="px-4 py-1.5">
            {saving ? 'Saving...' : dirty ? 'Save changes' : 'Saved'}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Cue list */}
        <div className="min-w-0 flex-1 overflow-y-auto px-4 py-3">
          {!cues && <div className="flex h-40 items-center justify-center"><Spinner /></div>}
          <div className="mx-auto max-w-3xl space-y-1">
            {list.map((c, i) => {
              const flags = flagged[i] || [];
              if (onlyFlagged && !flags.length) return null;
              return (
                <div
                  key={i}
                  className={`group rounded-lg border px-3 py-2 transition-colors ${
                    active === i ? 'border-gold/40 bg-gold/[0.05]' : 'border-transparent hover:border-hairline hover:bg-white/[0.015]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <button onClick={() => seekTo(i)} className="font-mono text-[10px] tabular-nums text-faint hover:text-gold-bright">
                      {fmtDuration(c.start)} → {fmtDuration(c.end)}
                    </button>
                    {flags.map((f) => <Badge key={f} tone="red" className="px-1.5 py-0 text-[9px]">{f}</Badge>)}
                    <button
                      onClick={() => retranslate(i)}
                      disabled={busy !== null}
                      title="Retranslate this cue with AI"
                      className="ml-auto flex h-6 w-6 items-center justify-center rounded text-faint opacity-0 transition-all hover:bg-gold/10 hover:text-gold-bright group-hover:opacity-100"
                    >
                      {busy === i ? <Spinner className="h-3 w-3" /> : <Icon name="sparkles" className="h-3 w-3" />}
                    </button>
                  </div>
                  <p dir="auto" className="mt-1 font-arabic text-[13px] leading-snug text-muted">{c.source}</p>
                  <textarea
                    value={c.text}
                    onChange={(e) => update(i, e.target.value)}
                    rows={Math.max(1, Math.ceil(c.text.length / 60))}
                    className="mt-1 w-full resize-none rounded-md border border-transparent bg-transparent text-[13.5px] leading-snug text-cream outline-none transition-colors focus:border-gold/30 focus:bg-black/30 focus:px-2 focus:py-1"
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Video preview */}
        <div className="hidden w-[380px] shrink-0 border-l border-hairline p-4 lg:block">
          <video
            ref={videoRef}
            src={`https://cdn.deensubs.com/${job.source_key}`}
            controls
            className="w-full rounded-xl border border-hairline bg-black"
          />
          {active >= 0 && list[active] && (
            <div className="mt-3 rounded-xl border border-hairline bg-panel p-3">
              <p className="text-[10px] uppercase tracking-wider text-faint">Now showing</p>
              <p className="mt-1 text-[13px] leading-snug text-cream">{list[active].text}</p>
            </div>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-faint">
            Click a timestamp to seek. ⌘S saves. Flags: CPS over 25, lines over 90 chars, suspiciously short
            translations, trailing commas.
          </p>
        </div>
      </div>
    </div>
  );
}
