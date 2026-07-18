// Watch a Scribe job's media with the generated subtitles overlaid live —
// exactly how they'll read on the site, before publishing. Language
// switcher, synced cue list, click-to-seek.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { fmtDuration } from '../lib/format';
import { Spinner, Badge } from './Primitives';

type Cue = { start: number; end: number; text: string; source: string };

export function PreviewPlayer({ job }: { job: any }) {
  const langs: string[] = useMemo(() => {
    try { return JSON.parse(job.target_langs || '[]'); } catch { return [job.target_lang]; }
  }, [job]);
  const [lang, setLang] = useState<string>(langs[0] || job.target_lang);
  const [showSource, setShowSource] = useState(false);
  const [cues, setCues] = useState<Cue[] | null>(null);
  const [time, setTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCues(null);
    api(`/api/scribe/${job.id}/cues?lang=${lang}`)
      .then((r) => setCues(r.cues))
      .catch(() => setCues([]));
  }, [job.id, lang]);

  const activeIdx = useMemo(
    () => (cues ? cues.findIndex((c) => time >= c.start && time < c.end) : -1),
    [cues, time]
  );

  // Keep the active cue visible in the list
  useEffect(() => {
    if (activeIdx < 0 || !listRef.current) return;
    const el = listRef.current.children[activeIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeIdx]);

  const active = activeIdx >= 0 && cues ? cues[activeIdx] : null;
  const isVideo = /\.(mp4|webm|mkv|mov)$/i.test(job.source_key || '');

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <div>
        {/* Player with live subtitle overlay */}
        <div className="relative overflow-hidden rounded-xl border border-hairline bg-black">
          <video
            ref={videoRef}
            src={`https://cdn.deensubs.com/${job.source_key}`}
            controls
            className={isVideo ? 'aspect-video w-full' : 'h-16 w-full'}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          />
          {active && isVideo && (
            <div className="pointer-events-none absolute inset-x-0 bottom-14 flex justify-center px-6">
              <p
                dir="auto"
                className="max-w-[85%] rounded-md bg-black/75 px-3 py-1.5 text-center text-[15px] font-medium leading-snug text-white shadow-lg"
              >
                {showSource ? active.source : active.text}
              </p>
            </div>
          )}
        </div>
        {!isVideo && active && (
          <div className="mt-3 rounded-xl border border-hairline bg-panel p-4 text-center">
            <p dir="auto" className="text-[15px] font-medium leading-snug text-cream">{showSource ? active.source : active.text}</p>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {langs.map((l) => (
            <button
              key={l}
              onClick={() => { setLang(l); setShowSource(false); }}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                lang === l && !showSource ? 'border-gold/40 bg-gold/10 text-gold-bright' : 'border-hairline text-muted hover:text-cream'
              }`}
            >
              {l.toUpperCase()}
            </button>
          ))}
          <button
            onClick={() => setShowSource((s) => !s)}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
              showSource ? 'border-gold/40 bg-gold/10 text-gold-bright' : 'border-hairline text-muted hover:text-cream'
            }`}
          >
            {(job.language_code || 'source').toUpperCase()} original
          </button>
          {cues && <Badge tone="dim" className="ml-auto">{cues.length} cues</Badge>}
        </div>
      </div>

      {/* Cue rail */}
      <div className="max-h-[420px] overflow-y-auto rounded-xl border border-hairline bg-panel/60" ref={listRef}>
        {cues === null && <div className="flex h-32 items-center justify-center"><Spinner /></div>}
        {(cues || []).map((c, i) => (
          <button
            key={i}
            onClick={() => {
              const v = videoRef.current;
              if (v) { v.currentTime = c.start + 0.01; v.play().catch(() => {}); }
            }}
            className={`block w-full border-b border-white/[0.03] px-3 py-2 text-left transition-colors ${
              i === activeIdx ? 'bg-gold/[0.08]' : 'hover:bg-white/[0.02]'
            }`}
          >
            <span className="font-mono text-[10px] tabular-nums text-faint">{fmtDuration(c.start)}</span>
            <p dir="auto" className={`mt-0.5 text-[12px] leading-snug ${i === activeIdx ? 'text-gold-bright' : 'text-cream/80'}`}>
              {showSource ? c.source : c.text}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
