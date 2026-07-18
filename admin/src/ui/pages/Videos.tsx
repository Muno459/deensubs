import { useMemo, useState } from 'react';
import { api, useApi } from '../lib/api';
import { fmtNum, fmtDuration, fmtDate, fmtBytes, thumbUrl } from '../lib/format';
import {
  GlowCard, SectionTitle, PageLoader, ErrorNote, Button, Modal, Field, inputCls, Badge, Spinner,
} from '../components/Primitives';
import { BlurFade } from '../components/BlurFade';
import { BorderBeam } from '../components/BorderBeam';
import { Icon } from '../components/Icon';

type Video = {
  id: number; title: string; title_ar: string | null; slug: string; description: string | null;
  category_id: number | null; scholar_id: number | null; source: string | null; duration: number;
  video_key: string; srt_key: string | null; srt_ar_key: string | null; thumb_key: string | null;
  views: number; likes: number; created_at: string;
  category_name?: string; category_color?: string; scholar_name?: string;
};

const EMPTY: Partial<Video> = {
  title: '', title_ar: '', slug: '', description: '', source: '', duration: 0,
  video_key: '', srt_key: '', srt_ar_key: '', thumb_key: '', category_id: null, scholar_id: null,
};

function R2Picker({ open, onClose, prefix, onPick }: { open: boolean; onClose: () => void; prefix: string; onPick: (key: string) => void }) {
  const { data, loading } = useApi<any>(open ? `/api/r2?prefix=${encodeURIComponent(prefix)}` : null);
  return (
    <Modal open={open} onClose={onClose} title={`Browse R2 · ${prefix || 'root'}`}>
      {loading ? (
        <div className="flex h-40 items-center justify-center"><Spinner /></div>
      ) : (
        <div className="max-h-96 space-y-1 overflow-y-auto">
          {(data?.objects || []).map((o: any) => (
            <button
              key={o.key}
              onClick={() => { onPick(o.key); onClose(); }}
              className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-gold/10"
            >
              <span className="min-w-0 truncate font-mono text-[12px] text-cream/85">{o.key}</span>
              <span className="shrink-0 text-[11px] text-muted">{fmtBytes(o.size)}</span>
            </button>
          ))}
          {!data?.objects?.length && <p className="p-3 text-[13px] text-muted">Nothing under this prefix.</p>}
        </div>
      )}
    </Modal>
  );
}

function KeyField({ label, value, onChange, prefix }: { label: string; value: string; onChange: (v: string) => void; prefix: string }) {
  const [browsing, setBrowsing] = useState(false);
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <input className={inputCls + ' font-mono'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={prefix + '...'} />
        <Button variant="ghost" className="shrink-0 px-3" onClick={() => setBrowsing(true)}>
          <Icon name="folder" className="h-4 w-4" />
        </Button>
      </div>
      <R2Picker open={browsing} onClose={() => setBrowsing(false)} prefix={prefix} onPick={onChange} />
    </Field>
  );
}

function VideoForm({ initial, meta, onDone, onCancel }: { initial: Partial<Video>; meta: any; onDone: () => void; onCancel: () => void }) {
  const [form, setForm] = useState<Partial<Video>>({ ...EMPTY, ...initial });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: keyof Video, v: any) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    if (!form.title || !form.slug || !form.video_key) { setErr('Title, slug and video key are required.'); return; }
    setSaving(true); setErr('');
    try {
      if (form.id) await api(`/api/videos/${form.id}`, { method: 'PUT', body: JSON.stringify(form) });
      else await api('/api/videos', { method: 'POST', body: JSON.stringify(form) });
      onDone();
    } catch (e: any) { setErr(e.message); }
    setSaving(false);
  }

  return (
    <div className="space-y-3.5">
      <Field label="Title">
        <input className={inputCls} value={form.title || ''} onChange={(e) => {
          const title = e.target.value;
          setForm((f) => ({
            ...f, title,
            slug: f.id ? f.slug : title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
          }));
        }} />
      </Field>
      <Field label="Arabic title">
        <input dir="rtl" className={inputCls + ' font-arabic'} value={form.title_ar || ''} onChange={(e) => set('title_ar', e.target.value)} />
      </Field>
      <Field label="Slug">
        <input className={inputCls + ' font-mono'} value={form.slug || ''} onChange={(e) => set('slug', e.target.value)} />
      </Field>
      <Field label="Description">
        <textarea rows={3} className={inputCls + ' resize-y'} value={form.description || ''} onChange={(e) => set('description', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          <select className={inputCls} value={form.category_id ?? ''} onChange={(e) => set('category_id', e.target.value ? parseInt(e.target.value) : null)}>
            <option value="">None</option>
            {(meta?.categories || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Scholar">
          <select className={inputCls} value={form.scholar_id ?? ''} onChange={(e) => set('scholar_id', e.target.value ? parseInt(e.target.value) : null)}>
            <option value="">None</option>
            {(meta?.scholars || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Source / speaker">
          <input className={inputCls} value={form.source || ''} onChange={(e) => set('source', e.target.value)} />
        </Field>
        <Field label="Duration (seconds)">
          <input type="number" className={inputCls} value={form.duration || 0} onChange={(e) => set('duration', parseInt(e.target.value) || 0)} />
        </Field>
      </div>
      <KeyField label="Video key" prefix="videos/" value={form.video_key || ''} onChange={(v) => set('video_key', v)} />
      <KeyField label="Subtitles (EN)" prefix="subs/" value={form.srt_key || ''} onChange={(v) => set('srt_key', v)} />
      <KeyField label="Subtitles (AR)" prefix="subs/" value={form.srt_ar_key || ''} onChange={(v) => set('srt_ar_key', v)} />
      <KeyField label="Thumbnail" prefix="thumbs/" value={form.thumb_key || ''} onChange={(v) => set('thumb_key', v)} />
      {err && <ErrorNote message={err} />}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? 'Saving...' : form.id ? 'Save changes' : 'Add video'}</Button>
      </div>
    </div>
  );
}

function ScholarForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [form, setForm] = useState<any>({ name: '', slug: '', title: '', bio: '', photo: '', photo_hero: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  return (
    <div className="space-y-3.5">
      <Field label="Name">
        <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, slug: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') })} />
      </Field>
      <Field label="Slug">
        <input className={inputCls + ' font-mono'} value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
      </Field>
      <Field label="Title" hint="e.g. Professor at the Islamic University of Madinah">
        <input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </Field>
      <Field label="Bio">
        <textarea rows={3} className={inputCls + ' resize-y'} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
      </Field>
      <KeyField label="Photo" prefix="scholars/" value={form.photo} onChange={(v) => setForm({ ...form, photo: v })} />
      <KeyField label="Hero photo" prefix="scholars/" value={form.photo_hero} onChange={(v) => setForm({ ...form, photo_hero: v })} />
      {err && <ErrorNote message={err} />}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button
          disabled={saving || !form.name || !form.slug}
          onClick={async () => {
            setSaving(true); setErr('');
            try { await api('/api/scholars', { method: 'POST', body: JSON.stringify(form) }); onDone(); }
            catch (e: any) { setErr(e.message); }
            setSaving(false);
          }}
        >
          {saving ? 'Saving...' : 'Add scholar'}
        </Button>
      </div>
    </div>
  );
}

export default function Videos() {
  const { data, loading, error, refetch } = useApi<{ videos: Video[] }>('/api/videos');
  const meta = useApi<any>('/api/meta');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Partial<Video> | null>(null);
  const [addingScholar, setAddingScholar] = useState(false);
  const [deleting, setDeleting] = useState<Video | null>(null);

  const filtered = useMemo(() => {
    const videos = data?.videos || [];
    if (!q.trim()) return videos;
    const needle = q.toLowerCase();
    return videos.filter((v) =>
      v.title?.toLowerCase().includes(needle) ||
      v.slug?.includes(needle) ||
      v.source?.toLowerCase().includes(needle) ||
      v.category_name?.toLowerCase().includes(needle)
    );
  }, [data, q]);

  if (loading) return <PageLoader />;
  if (error) return <ErrorNote message={error} onRetry={refetch} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Icon name="search" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted/60" />
          <input
            className={inputCls + ' pl-9'}
            placeholder={`Search ${data?.videos?.length || 0} videos...`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Button variant="ghost" onClick={() => setEditing({ ...EMPTY })}>Manual entry</Button>
        <Button onClick={() => (location.hash = '/scribe')} className="flex items-center gap-1.5">
          <Icon name="plus" className="h-4 w-4" /> Add video
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((v, i) => (
          <BlurFade key={v.id} delay={Math.min(i * 0.02, 0.3)}>
            <GlowCard className="group overflow-hidden">
              <div className="relative aspect-video overflow-hidden rounded-t-2xl bg-black/40">
                {v.thumb_key ? (
                  <img src={thumbUrl(v.thumb_key)} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <Icon name="video" className="h-8 w-8 text-muted/30" />
                  </div>
                )}
                <span className="absolute bottom-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-cream backdrop-blur">
                  {fmtDuration(v.duration)}
                </span>
                {v.category_name && (
                  <span className="absolute left-2 top-2 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide backdrop-blur"
                    style={{ background: 'rgba(5,5,7,0.7)', color: v.category_color || '#c4a44c' }}>
                    {v.category_name}
                  </span>
                )}
              </div>
              <div className="p-3.5">
                <p className="line-clamp-2 text-[13px] font-medium leading-snug text-cream" title={v.title}>{v.title}</p>
                <div className="mt-2 flex items-center gap-3 text-[11px] text-muted">
                  <span>{fmtNum(v.views)} views</span>
                  <span>{fmtNum(v.likes)} likes</span>
                  <span className="ml-auto">{fmtDate(v.created_at)}</span>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  {v.srt_key ? <Badge tone="gold">EN</Badge> : <Badge tone="dim">no EN</Badge>}
                  {v.srt_ar_key ? <Badge tone="gold">AR</Badge> : <Badge tone="dim">no AR</Badge>}
                  <div className="ml-auto flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <a
                      href={`https://deensubs.com/watch/${v.slug}`} target="_blank" rel="noreferrer"
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-white/[0.06] hover:text-cream" title="Open"
                    >
                      <Icon name="external" className="h-3.5 w-3.5" />
                    </a>
                    <button
                      onClick={() => setEditing(v)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-white/[0.06] hover:text-gold-bright" title="Edit"
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
      {!filtered.length && <p className="py-10 text-center text-[13px] text-muted">No videos match.</p>}

      {/* Edit/add modal */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit video' : 'Add video'} wide>
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

      {/* Add scholar modal */}
      <Modal open={addingScholar} onClose={() => setAddingScholar(false)} title="Add scholar">
        <ScholarForm onCancel={() => setAddingScholar(false)} onDone={() => { setAddingScholar(false); meta.refetch(); }} />
      </Modal>

      {/* Delete confirm */}
      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Delete video">
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
