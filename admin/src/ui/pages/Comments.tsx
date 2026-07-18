import { useState } from 'react';
import { api, useApi } from '../lib/api';
import { fmtAgo } from '../lib/format';
import { GlowCard, PageLoader, ErrorNote, Button, Badge } from '../components/Primitives';
import { BlurFade } from '../components/BlurFade';
import { Icon } from '../components/Icon';

export default function Comments() {
  const { data, loading, error, refetch } = useApi<any>('/api/comments');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  if (loading) return <PageLoader />;
  if (error) return <ErrorNote message={error} onRetry={refetch} />;

  const comments = data?.comments || [];

  function toggle(id: number) {
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function deleteOne(id: number) {
    await api(`/api/comments/${id}`, { method: 'DELETE' });
    refetch();
  }

  async function deleteSelected() {
    setBusy(true);
    await api('/api/comments/bulk-delete', { method: 'POST', body: JSON.stringify({ ids: [...selected] }) });
    setSelected(new Set());
    setBusy(false);
    refetch();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted">{comments.length} most recent comments</p>
        {selected.size > 0 && (
          <Button variant="danger" onClick={deleteSelected} disabled={busy}>
            {busy ? 'Deleting...' : `Delete ${selected.size} selected`}
          </Button>
        )}
      </div>
      <div className="space-y-2.5">
        {comments.map((c: any, i: number) => (
          <BlurFade key={c.id} delay={Math.min(i * 0.02, 0.25)}>
            <GlowCard glow={false} className={selected.has(c.id) ? 'border-gold/40 bg-gold/[0.04]' : ''}>
              <div className="flex items-start gap-3 p-3.5">
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={() => toggle(c.id)}
                  className="mt-1.5 h-3.5 w-3.5 accent-[#c4a44c]"
                />
                {c.user_avatar ? (
                  <img src={c.user_avatar} alt="" referrerPolicy="no-referrer" className="mt-0.5 h-8 w-8 shrink-0 rounded-full border border-hairline" />
                ) : (
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold/10 text-[12px] font-bold text-gold">
                    {(c.user_name || c.author || '?')[0]}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-[13px] font-medium text-cream">{c.user_name || c.author || 'Anonymous'}</span>
                    <span className="text-[11px] text-muted/70">{fmtAgo(c.created_at)}</span>
                    {c.parent_id && <Badge tone="dim">reply</Badge>}
                  </div>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-cream/85">{c.content}</p>
                  {c.video_title && (
                    <a
                      href={`https://deensubs.com/watch/${c.video_slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block text-[11px] text-gold/70 hover:text-gold-bright"
                    >
                      on {c.video_title}
                    </a>
                  )}
                </div>
                <button
                  onClick={() => deleteOne(c.id)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-red-500/10 hover:text-red-400"
                  title="Delete comment"
                >
                  <Icon name="trash" className="h-4 w-4" />
                </button>
              </div>
            </GlowCard>
          </BlurFade>
        ))}
        {!comments.length && <p className="py-10 text-center text-[13px] text-muted">No comments yet.</p>}
      </div>
    </div>
  );
}
