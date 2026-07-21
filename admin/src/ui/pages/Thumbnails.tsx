// Thumbnail translation queue: catalog artwork the vision scan flagged as
// carrying Arabic text. Each card takes a replacement by drag-and-drop or
// Ctrl+V (click to arm a card first), can be accepted as-is or skipped, and
// links the highest-quality original for the designer.
import { useEffect, useRef, useState } from 'react';
import { api, useApi } from '../lib/api';
import { fmtDate, thumbUrl } from '../lib/format';
import { GlowCard, PageLoader, ErrorNote, Button, Badge, Spinner } from '../components/Primitives';
import { BlurFade } from '../components/BlurFade';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';

type Item = { id: number; title: string; slug: string; thumb_key: string; media: string | null; created_at: string };
type Counts = { pending: number; unscanned: number; accepted: number; skipped: number; errors: number };

export default function Thumbnails() {
  const { data, loading, error, refetch } = useApi<{ items: Item[]; counts: Counts }>('/api/thumbs/review');
  const toast = useToast();
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState<Record<number, string>>({});
  const [scan, setScan] = useState<{ done: number; total: number } | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const scanRef = useRef(false);

  const counts = data?.counts;
  const items = data?.items || [];

  async function replace(v: Item, file: File | Blob) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { toast.push('jpeg / png / webp only', 'error'); return; }
    setBusy((b) => ({ ...b, [v.id]: 'Uploading + baking variants…' }));
    try {
      const r = await fetch(`/api/thumbs/${v.id}/replace`, {
        method: 'POST', headers: { 'content-type': file.type }, body: file, credentials: 'include',
      });
      const j: any = await r.json();
      if (!r.ok) throw new Error(j.error || 'replace failed');
      toast.push(`Thumbnail replaced for “${v.title.slice(0, 40)}”`);
      refetch();
    } catch (e: any) {
      toast.push(e.message, 'error');
    }
    setBusy((b) => { const n = { ...b }; delete n[v.id]; return n; });
  }

  async function flag(v: Item, status: 'accepted' | 'skipped') {
    try {
      await api(`/api/thumbs/${v.id}/flag`, { method: 'POST', body: JSON.stringify({ status }) });
      toast.push(status === 'accepted' ? 'Accepted as-is' : 'Skipped');
      refetch();
    } catch (e: any) { toast.push(e.message, 'error'); }
  }

  async function runScan() {
    if (scanRef.current) return;
    scanRef.current = true;
    const total = counts?.unscanned || 0;
    setScan({ done: 0, total });
    try {
      let remaining = total;
      let done = 0;
      while (remaining > 0) {
        const r: any = await api('/api/thumbs/scan', { method: 'POST' });
        done += r.scanned || 0;
        remaining = r.remaining ?? 0;
        setScan({ done, total });
        if (!r.scanned) break;
      }
      toast.push('Scan complete');
    } catch (e: any) { toast.push(e.message, 'error'); }
    scanRef.current = false;
    setScan(null);
    refetch();
  }

  // Ctrl+V pastes into the armed card
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (selected == null) return;
      const v = items.find((x) => x.id === selected);
      const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
      if (!v || !f) return;
      e.preventDefault();
      replace(v, f);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [selected, items]);

  if (loading) return <PageLoader />;
  if (error) return <ErrorNote message={error} onRetry={refetch} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-[13px] text-muted">
          <Badge tone="gold">{counts?.pending || 0} need translation</Badge>
          {!!counts?.unscanned && <Badge tone="dim">{counts.unscanned} unscanned</Badge>}
          {!!counts?.accepted && <Badge tone="dim">{counts.accepted} accepted</Badge>}
          {!!counts?.skipped && <Badge tone="dim">{counts.skipped} skipped</Badge>}
          {!!counts?.errors && <Badge tone="dim">{counts.errors} scan errors</Badge>}
        </div>
        <div className="ml-auto">
          <Button onClick={runScan} disabled={!!scan || !counts?.unscanned} className="flex items-center gap-1.5">
            {scan ? <><Spinner className="h-3.5 w-3.5" /> Scanning {scan.done}/{scan.total}…</>
                  : <><Icon name="sparkles" className="h-4 w-4" /> Scan {counts?.unscanned || 0} thumbnails</>}
          </Button>
        </div>
      </div>

      <p className="text-[12px] text-faint">
        Click a card to arm it, then Ctrl+V a copied image — or drag an image straight onto a card. Replacements bake
        responsive variants and purge caches automatically.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((v, i) => (
          <BlurFade key={v.id} delay={Math.min(i * 0.02, 0.3)}>
            <div
              className="cursor-pointer"
              onClick={() => setSelected(selected === v.id ? null : v.id)}
              onDragOver={(e) => { e.preventDefault(); setDragOver(v.id); }}
              onDragLeave={() => setDragOver((d) => (d === v.id ? null : d))}
              onDrop={(e) => {
                e.preventDefault(); setDragOver(null);
                const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/'));
                if (f) replace(v, f);
              }}
            >
            <GlowCard className={`group relative overflow-hidden transition-shadow ${selected === v.id ? 'ring-2 ring-gold' : ''}`}>
              <div className="relative aspect-video overflow-hidden rounded-t-2xl bg-inset">
                <img src={thumbUrl(v.thumb_key)} alt="" loading="lazy" className="h-full w-full object-cover" />
                {dragOver === v.id && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-t-2xl border-2 border-dashed border-gold bg-black/60 text-[13px] font-semibold text-gold-bright">
                    Drop English thumbnail
                  </div>
                )}
                {busy[v.id] && (
                  <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/70 text-[12px] text-cream">
                    <Spinner className="h-4 w-4" /> {busy[v.id]}
                  </div>
                )}
                {selected === v.id && !busy[v.id] && !dragOver && (
                  <span className="absolute left-2 top-2 rounded-md bg-gold px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink">
                    Ctrl+V to paste
                  </span>
                )}
                <span className="absolute bottom-2 left-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300 backdrop-blur">
                  Arabic text
                </span>
              </div>
              <div className="p-3.5">
                <p className="line-clamp-2 text-[13px] font-medium leading-snug text-cream" title={v.title}>{v.title}</p>
                <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">
                  <span>{v.media === 'audio' ? 'Audiobook' : 'Video'}</span>
                  <span className="ml-auto">{fmtDate(v.created_at)}</span>
                </div>
                <div className="mt-2 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => flag(v, 'accepted')} title="Accept as-is (Arabic is fine here)"
                    className="flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-medium text-muted transition-colors hover:bg-hover hover:text-gold-bright">
                    <Icon name="play" className="h-3 w-3 rotate-90" /> Accept
                  </button>
                  <button onClick={() => flag(v, 'skipped')} title="Skip for now"
                    className="flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-medium text-muted transition-colors hover:bg-hover hover:text-cream">
                    Skip
                  </button>
                  <div className="ml-auto flex gap-1">
                    <a href={`https://cdn.deensubs.com/${v.thumb_key}`} download target="_blank" rel="noreferrer"
                      title="Download original (highest quality)"
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-cream">
                      <Icon name="download" className="h-3.5 w-3.5" />
                    </a>
                    <a href={`https://deensubs.com/watch/${v.slug}`} target="_blank" rel="noreferrer" title="Open"
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-cream">
                      <Icon name="external" className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>
              </div>
            </GlowCard>
            </div>
          </BlurFade>
        ))}
      </div>

      {!items.length && (
        <p className="py-14 text-center text-[13px] text-muted">
          {counts?.unscanned
            ? 'Nothing flagged yet — run the scan to check the catalog for Arabic thumbnails.'
            : 'All thumbnails are clean. Nothing needs translation.'}
        </p>
      )}
    </div>
  );
}
