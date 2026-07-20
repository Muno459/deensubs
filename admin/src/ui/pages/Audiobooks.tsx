// Audiobooks tab: published audio releases (videos.media='audio'), first-class
// instead of buried between videos. Cards lead with the listening facts —
// enhancement state, chapters, transcript languages — and carry the
// audiobook-specific action: rebuilding the karaoke transcript in place.
import { useMemo, useState } from 'react';
import { api, useApi } from '../lib/api';
import { fmtNum, fmtDuration, fmtDate, thumbUrl } from '../lib/format';
import { GlowCard, PageLoader, ErrorNote, Button, Modal, inputCls, Badge } from '../components/Primitives';
import { BlurFade } from '../components/BlurFade';
import { BorderBeam } from '../components/BorderBeam';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { VideoForm, type Video } from './Videos';

type Audiobook = Video & {
  media?: string;
  speech_enhanced?: number;
  orig_key?: string | null;
  chapters?: string | null;
  srt_langs?: string | null;
};

const jobIdOf = (v: Audiobook) => (v.video_key?.match(/^scribe\/([^/]+)\//) || [])[1] || null;

function chapterCount(v: Audiobook): number {
  try { const a = JSON.parse(v.chapters || '[]'); return Array.isArray(a) ? a.length : 0; } catch { return 0; }
}

function langsOf(v: Audiobook): string[] {
  try { const a = JSON.parse(v.srt_langs || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
}

export default function Audiobooks() {
  const { data, loading, error, refetch } = useApi<{ videos: Audiobook[] }>('/api/videos');
  const meta = useApi<any>('/api/meta');
  const toast = useToast();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Partial<Audiobook> | null>(null);
  const [deleting, setDeleting] = useState<Audiobook | null>(null);
  const [rebuilding, setRebuilding] = useState<number | null>(null);

  const books = useMemo(() => (data?.videos || []).filter((v) => v.media === 'audio'), [data]);
  const filtered = useMemo(() => {
    if (!q.trim()) return books;
    const needle = q.toLowerCase();
    return books.filter((v) =>
      v.title?.toLowerCase().includes(needle) ||
      v.slug?.includes(needle) ||
      v.scholar_name?.toLowerCase().includes(needle)
    );
  }, [books, q]);

  const totalSec = useMemo(() => books.reduce((a, v) => a + (v.duration || 0), 0), [books]);

  if (loading) return <PageLoader />;
  if (error) return <ErrorNote message={error} onRetry={refetch} />;

  async function rebuild(v: Audiobook) {
    const jobId = jobIdOf(v);
    if (!jobId) { toast.push('No scribe job behind this audiobook', 'error'); return; }
    setRebuilding(v.id);
    try {
      const r = await api(`/api/scribe/${jobId}/rebuild-transcript`, { method: 'POST' });
      toast.push(`Transcript rebuilt — ${r.aligned ?? '?'} units word-mapped${r.speakers ? `, voices: ${r.speakers.join(', ')}` : ''}`);
      refetch();
    } catch (e: any) {
      toast.push(e.message, 'error');
    }
    setRebuilding(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Icon name="search" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted/60" />
          <input
            className={inputCls + ' pl-9'}
            placeholder={`Search ${books.length} audiobooks (${fmtDuration(totalSec)} total)...`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Button onClick={() => (location.hash = '/scribe')} className="flex items-center gap-1.5">
          <Icon name="plus" className="h-4 w-4" /> New audiobook
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((v, i) => (
          <BlurFade key={v.id} delay={Math.min(i * 0.02, 0.3)}>
            <GlowCard className="group overflow-hidden">
              <div className="relative aspect-video overflow-hidden rounded-t-2xl bg-inset">
                {v.thumb_key ? (
                  <img src={thumbUrl(v.thumb_key)} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <Icon name="headphones" className="h-8 w-8 text-muted/30" />
                  </div>
                )}
                <span className="absolute bottom-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-cream backdrop-blur">
                  {fmtDuration(v.duration)}
                </span>
                {!!v.speech_enhanced && (
                  <span className="absolute left-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-300 backdrop-blur">
                    Speech Enhanced
                  </span>
                )}
              </div>
              <div className="p-3.5">
                <p className="line-clamp-2 text-[13px] font-medium leading-snug text-cream" title={v.title}>{v.title}</p>
                {v.scholar_name && <p className="mt-0.5 text-[11px] text-muted">{v.scholar_name}</p>}
                <div className="mt-2 flex items-center gap-3 text-[11px] text-muted">
                  <span>{fmtNum(v.views)} plays</span>
                  <span>{fmtNum(v.likes)} likes</span>
                  <span className="ml-auto">{fmtDate(v.created_at)}</span>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  {chapterCount(v) ? <Badge tone="gold">{chapterCount(v)} chapters</Badge> : <Badge tone="dim">no chapters</Badge>}
                  {langsOf(v).map((l) => <Badge key={l} tone="gold">{l.toUpperCase()}</Badge>)}
                  {!!v.orig_key && <Badge tone="dim">orig kept</Badge>}
                  <div className="ml-auto flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <a
                      href={`https://deensubs.com/watch/${v.slug}`} target="_blank" rel="noreferrer"
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-cream" title="Open player"
                    >
                      <Icon name="external" className="h-3.5 w-3.5" />
                    </a>
                    <a
                      href={`https://deensubs.com/api/media/transcripts/${v.slug}-en.txt`} target="_blank" rel="noreferrer"
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-cream" title="Transcript (.txt)"
                    >
                      <Icon name="download" className="h-3.5 w-3.5" />
                    </a>
                    <button
                      onClick={() => rebuild(v)}
                      disabled={rebuilding === v.id}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-gold-bright disabled:opacity-50"
                      title="Rebuild transcript (segmentation, speakers, word map — no credits)"
                    >
                      <Icon name="refresh" className={'h-3.5 w-3.5' + (rebuilding === v.id ? ' animate-spin' : '')} />
                    </button>
                    <button
                      onClick={() => setEditing(v)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-gold-bright" title="Edit"
                    >
                      <Icon name="edit" className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleting(v)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-red-500/10 hover:text-red-400" title="Delete"
                    >
                      <Icon name="trash" className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </GlowCard>
          </BlurFade>
        ))}
      </div>
      {!filtered.length && (
        <p className="py-10 text-center text-[13px] text-muted">
          {books.length ? 'No audiobooks match.' : 'No audiobooks yet — publish an audio job from Scribe.'}
        </p>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit audiobook" wide>
        <div className="pointer-events-none absolute inset-0 rounded-2xl">
          <BorderBeam size={180} duration={14} />
        </div>
        {editing && (
          <VideoForm
            initial={editing}
            meta={meta.data}
            onCancel={() => setEditing(null)}
            onDone={() => { setEditing(null); refetch(); }}
          />
        )}
      </Modal>

      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Delete audiobook">
        <p className="text-[13px] leading-relaxed text-cream/80">
          Delete <span className="font-semibold text-cream">{deleting?.title}</span>? This removes the database entry
          (media files in R2 are kept).
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
          <Button
            variant="danger"
            onClick={async () => {
              if (!deleting) return;
              await api(`/api/videos/${deleting.id}`, { method: 'DELETE' });
              setDeleting(null);
              refetch();
            }}
          >
            Delete
          </Button>
        </div>
      </Modal>
    </div>
  );
}
