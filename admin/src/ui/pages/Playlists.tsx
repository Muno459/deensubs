import { useMemo, useState } from 'react';
import { api, useApi } from '../lib/api';
import { fmtNum, fmtDuration, fmtDate, thumbUrl } from '../lib/format';
import { GlowCard, SectionTitle, PageLoader, ErrorNote, Button, Modal, Field, inputCls, Badge } from '../components/Primitives';
import { BlurFade } from '../components/BlurFade';
import { Icon } from '../components/Icon';
import { AiFillButton } from '../components/AiFill';
import { ImageField } from '../components/ImageField';
import { useToast } from '../components/Toast';

function PlaylistForm({ initial, onDone, onCancel, videos = [] }: { initial?: any; onDone: () => void; onCancel: () => void; videos?: any[] }) {
  const [form, setForm] = useState<any>(initial || { title: '', title_ar: '', description: '', cover_key: '' });
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  return (
    <div className="space-y-3.5">
      <div className="flex justify-end">
        <AiFillButton
          kind="playlist"
          payload={{ title: form.title, playlistId: form.id || null }}
          label="Name with AI"
          onFill={(r) => setForm((f: any) => ({ ...f, title: r.title || f.title, title_ar: r.title_ar || f.title_ar, description: r.description || f.description }))}
        />
      </div>
      <Field label="Title">
        <input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </Field>
      <Field label="Arabic title">
        <input dir="rtl" className={inputCls + ' font-arabic'} value={form.title_ar || ''} onChange={(e) => setForm({ ...form, title_ar: e.target.value })} />
      </Field>
      <Field label="Description">
        <textarea rows={3} className={inputCls + ' resize-y'} value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
      <ImageField
        label="Cover"
        hint="Optional — without one, the site uses the first video's thumbnail"
        prefix="thumbs/"
        aiPrompt={`Minimal elegant cover art for an Islamic lecture series titled "${form.title || 'Islamic lectures'}": subtle teal geometric girih pattern accents on a deep charcoal background, clean editorial composition, flat full-bleed artwork (no book mockup, no frame, no shadow), no text, no people`}
        value={form.cover_key || ''}
        onChange={(key) => setForm({ ...form, cover_key: key })}
        choices={videos.map((v: any) => ({ key: v.thumb_key, label: v.title }))}
      />
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button
          disabled={saving || !form.title}
          onClick={async () => {
            setSaving(true);
            try {
              if (form.id) await api(`/api/playlists/${form.id}`, { method: 'PUT', body: JSON.stringify(form) });
              else await api('/api/playlists', { method: 'POST', body: JSON.stringify(form) });
              toast.push(form.id ? 'Playlist updated' : 'Playlist created');
              onDone();
            } catch (e: any) {
              toast.push(e.message, 'error');
            }
            setSaving(false);
          }}
        >
          {saving ? 'Saving...' : form.id ? 'Save' : 'Create playlist'}
        </Button>
      </div>
    </div>
  );
}

function PlaylistDetail({ playlist, onBack, onChanged }: { playlist: any; onBack: () => void; onChanged: () => void }) {
  const detail = useApi<any>(`/api/playlists/${playlist.id}`);
  const allVideos = useApi<any>('/api/videos');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(false);
  const toast = useToast();

  const videos = detail.data?.videos || [];
  const inList = new Set(videos.map((v: any) => v.id));
  const candidates = useMemo(() => {
    const list = (allVideos.data?.videos || []).filter((v: any) => !inList.has(v.id));
    if (!q.trim()) return list.slice(0, 8);
    const needle = q.toLowerCase();
    return list.filter((v: any) => v.title?.toLowerCase().includes(needle)).slice(0, 8);
  }, [allVideos.data, q, detail.data]);

  async function move(videoId: number, dir: -1 | 1) {
    const ids = videos.map((v: any) => v.id);
    const i = ids.indexOf(videoId);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await api(`/api/playlists/${playlist.id}/order`, { method: 'PUT', body: JSON.stringify({ video_ids: ids }) });
    detail.refetch();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="flex items-center gap-1 text-[12px] text-muted hover:text-cream">
          ← Playlists
        </button>
        <span className="text-faint">/</span>
        <h2 className="text-[15px] font-semibold text-cream">{detail.data?.playlist?.title || playlist.title}</h2>
        <Badge tone="dim">{videos.length} videos</Badge>
        <button onClick={() => setEditing(true)} className="ml-auto text-[12px] text-muted underline-offset-2 hover:text-gold-bright hover:underline">
          Edit details
        </button>
      </div>

      {detail.loading ? (
        <PageLoader />
      ) : (
        <GlowCard glow={false} className="p-4">
          <SectionTitle>Videos, in order</SectionTitle>
          <div className="space-y-1.5">
            {videos.map((v: any, i: number) => (
              <div key={v.id} className="group flex items-center gap-3 rounded-lg p-1.5 transition-colors hover:bg-hover">
                <span className="w-6 text-center font-mono text-[11px] text-faint">{i + 1}</span>
                {v.thumb_key ? (
                  <img src={thumbUrl(v.thumb_key)} alt="" loading="lazy" className="h-9 w-16 shrink-0 rounded-md border border-hairline object-cover" />
                ) : (
                  <div className="flex h-9 w-16 shrink-0 items-center justify-center rounded-md border border-hairline bg-soft">
                    <Icon name="video" className="h-3.5 w-3.5 text-faint" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-cream">{v.title}</p>
                  <p className="text-[11px] text-faint">{fmtNum(v.views)} views · {fmtDuration(v.duration)}</p>
                </div>
                <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button onClick={() => move(v.id, -1)} disabled={i === 0} title="Move up"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover disabled:opacity-30">↑</button>
                  <button onClick={() => move(v.id, 1)} disabled={i === videos.length - 1} title="Move down"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover disabled:opacity-30">↓</button>
                  <button
                    onClick={async () => {
                      await api(`/api/playlists/${playlist.id}/videos/${v.id}`, { method: 'DELETE' });
                      detail.refetch();
                      onChanged();
                    }}
                    title="Remove from playlist"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-red-500/10 hover:text-red-400"
                  >
                    <Icon name="trash" className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
            {!videos.length && <p className="py-6 text-center text-[13px] text-muted">Empty playlist. Add videos below.</p>}
          </div>

          <div className="mt-4 border-t border-hairline pt-4">
            <SectionTitle>Add videos</SectionTitle>
            <input className={inputCls} placeholder="Search videos to add..." value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="mt-2 space-y-1">
              {candidates.map((v: any) => (
                <button
                  key={v.id}
                  onClick={async () => {
                    await api(`/api/playlists/${playlist.id}/videos`, { method: 'POST', body: JSON.stringify({ video_id: v.id }) });
                    toast.push('Added to playlist');
                    detail.refetch();
                    onChanged();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-gold/[0.06]"
                >
                  <Icon name="plus" className="h-3.5 w-3.5 shrink-0 text-gold" />
                  <span className="min-w-0 truncate text-[13px] text-cream/85">{v.title}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-faint">{fmtDuration(v.duration)}</span>
                </button>
              ))}
              {!candidates.length && <p className="py-3 text-center text-[12px] text-faint">No matches.</p>}
            </div>
          </div>
        </GlowCard>
      )}

      <Modal open={editing} onClose={() => setEditing(false)} title="Edit playlist">
        {editing && (
          <PlaylistForm
            initial={detail.data?.playlist}
            onCancel={() => setEditing(false)}
            onDone={() => { setEditing(false); detail.refetch(); onChanged(); }}
          />
        )}
      </Modal>
    </div>
  );
}

function AiPlaylistReview({ suggestions, onClose, onDone }: { suggestions: any[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<any[]>(suggestions.map((s) => ({ ...s, picked: true })));
  const [applying, setApplying] = useState(false);
  const picked = rows.filter((r) => r.picked && r.title.trim() && r.video_ids?.length);
  return (
    <Modal open onClose={onClose} title="AI playlist proposals" wide>
      <div className="space-y-2.5">
        {rows.map((r, i) => (
          <div key={i} className={`rounded-xl border p-3 transition-colors ${r.picked ? 'border-gold/30 bg-gold/5' : 'border-hairline opacity-60'}`}>
            <div className="flex items-center gap-2.5">
              <input type="checkbox" checked={r.picked}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, picked: e.target.checked } : x)))} />
              <input className={inputCls + ' flex-1'} value={r.title}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
              <Badge tone="dim">{r.video_ids?.length || 0} videos</Badge>
            </div>
            {r.description && <p className="mt-1.5 pl-7 text-[12px] text-muted">{r.description}</p>}
          </div>
        ))}
        {!rows.length && <p className="py-6 text-center text-[13px] text-muted">The AI found nothing coherent to propose.</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={applying || !picked.length}
            onClick={async () => {
              setApplying(true);
              try {
                const r = await api('/api/playlists/ai-apply', {
                  method: 'POST',
                  body: JSON.stringify({ playlists: picked.map(({ title, description, video_ids }) => ({ title, description, video_ids })) }),
                });
                toast.push(`Created ${r.created.length} playlist${r.created.length === 1 ? '' : 's'}`);
                onDone();
              } catch (e: any) { toast.push(e.message, 'error'); }
              setApplying(false);
            }}>
            {applying ? 'Creating…' : `Create ${picked.length} playlist${picked.length === 1 ? '' : 's'}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default function Playlists() {
  const { data, loading, error, refetch } = useApi<any>('/api/playlists');
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<any | null>(null);
  const [deleting, setDeleting] = useState<any | null>(null);
  const [review, setReview] = useState<any[] | null>(null);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const toast = useToast();

  const runAi = async (kind: string, payload: any, label: string) => {
    setAiBusy(label);
    try {
      const r = await api('/api/ai/fill', { method: 'POST', body: JSON.stringify({ kind, ...(payload || {}) }) });
      const list = Array.isArray(r?.playlists) ? r.playlists : [];
      if (!list.length) toast.push('No proposals came back', 'error');
      else setReview(list);
    } catch (e: any) { toast.push(e.message, 'error'); }
    setAiBusy(null);
  };

  if (open) return <PlaylistDetail playlist={open} onBack={() => setOpen(null)} onChanged={refetch} />;
  if (loading) return <PageLoader />;
  if (error) return <ErrorNote message={error} onRetry={refetch} />;

  const playlists = data?.playlists || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted">{playlists.length} playlists</p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" disabled={!!aiBusy} onClick={() => runAi('playlist-suggest', undefined, 'suggest')} className="flex items-center gap-1.5">
            <Icon name="sparkles" className="h-4 w-4" /> {aiBusy === 'suggest' ? 'Thinking…' : 'Suggest playlists'}
          </Button>
          <Button onClick={() => setCreating(true)} className="flex items-center gap-1.5">
            <Icon name="plus" className="h-4 w-4" /> New playlist
          </Button>
        </div>
      </div>

      {review && <AiPlaylistReview suggestions={review} onClose={() => setReview(null)} onDone={() => { setReview(null); refetch(); }} />}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {playlists.map((p: any, i: number) => (
          <BlurFade key={p.id} delay={Math.min(i * 0.03, 0.2)}>
            <GlowCard className="group cursor-pointer p-4" >
              <button className="block w-full text-left" onClick={() => setOpen(p)}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-medium text-cream group-hover:text-gold-bright">{p.title}</p>
                    {p.title_ar && <p dir="rtl" className="mt-0.5 truncate text-right font-arabic text-[13px] text-muted">{p.title_ar}</p>}
                  </div>
                  <Badge tone="dim">{p.video_count}</Badge>
                </div>
                {p.description && <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-muted">{p.description}</p>}
                <p className="mt-2 text-[11px] text-faint">{fmtDate(p.created_at)} · /{p.slug}</p>
              </button>
              <div className="mt-2 flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  onClick={() => runAi('playlist-split', { playlist_id: p.id }, `split-${p.id}`)}
                  disabled={!!aiBusy}
                  className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted hover:bg-hover hover:text-gold-bright disabled:opacity-50"
                  title="AI: segment this playlist into several smaller ones (originals kept)"
                >
                  <Icon name="sparkles" className="h-3 w-3" /> {aiBusy === `split-${p.id}` ? 'Splitting…' : 'AI split'}
                </button>
                <button
                  onClick={() => setDeleting(p)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-red-500/10 hover:text-red-400"
                  title="Delete playlist"
                >
                  <Icon name="trash" className="h-3.5 w-3.5" />
                </button>
              </div>
            </GlowCard>
          </BlurFade>
        ))}
      </div>
      {!playlists.length && (
        <div className="rounded-2xl border border-dashed border-hairline py-14 text-center">
          <Icon name="folder" className="mx-auto h-8 w-8 text-faint/40" />
          <p className="mt-3 text-[13px] text-muted">No playlists yet. Group lectures into series and courses.</p>
        </div>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="New playlist">
        <PlaylistForm onCancel={() => setCreating(false)} onDone={() => { setCreating(false); refetch(); }} />
      </Modal>

      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Delete playlist">
        <p className="text-[13px] leading-relaxed text-cream/80">
          Delete <span className="font-semibold text-cream">{deleting?.title}</span>? Videos themselves are not affected.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
          <Button variant="danger" onClick={async () => {
            await api(`/api/playlists/${deleting.id}`, { method: 'DELETE' });
            toast.push('Playlist deleted');
            setDeleting(null);
            refetch();
          }}>Delete</Button>
        </div>
      </Modal>
    </div>
  );
}
