import { useState } from 'react';
import { api, useApi } from '../lib/api';
import { fmtDate, fmtAgo } from '../lib/format';
import { GlowCard, PageLoader, ErrorNote, Table, Badge, Drawer, Spinner, SectionTitle, Modal, Button } from '../components/Primitives';
import { BlurFade } from '../components/BlurFade';
import { useToast } from '../components/Toast';

function Journey({ userId }: { userId: number }) {
  const { data, loading } = useApi<any>(`/api/users/${userId}/journey`);
  if (loading) return <div className="flex h-40 items-center justify-center"><Spinner /></div>;
  if (!data) return null;
  return (
    <div className="space-y-5">
      {data.comments?.length > 0 && (
        <div>
          <SectionTitle>Comments ({data.comments.length})</SectionTitle>
          <div className="space-y-2">
            {data.comments.slice(0, 10).map((c: any) => (
              <div key={c.id} className="rounded-lg border border-hairline bg-white/[0.02] p-2.5">
                <p className="text-[12px] leading-relaxed text-cream/85">{c.content}</p>
                <p className="mt-1 text-[11px] text-muted">on {c.video_title} · {fmtAgo(c.created_at)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {data.searches?.length > 0 && (
        <div>
          <SectionTitle>Searches</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {data.searches.map((s: any, i: number) => (
              <Badge key={i} tone={s.results === 0 ? 'red' : 'dim'}>{s.query}</Badge>
            ))}
          </div>
        </div>
      )}
      {data.pages?.length > 0 && (
        <div>
          <SectionTitle>Recent pages</SectionTitle>
          <div className="space-y-1">
            {data.pages.slice(0, 25).map((p: any, i: number) => (
              <div key={i} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-mono text-[11px] text-cream/75">{p.path}</span>
                <span className="shrink-0 text-[10px] text-muted">{fmtAgo(p.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {!data.comments?.length && !data.searches?.length && !data.pages?.length && (
        <p className="text-[13px] text-muted">No recorded activity.</p>
      )}
    </div>
  );
}

export default function Users() {
  const { data, loading, error, refetch } = useApi<any>('/api/users');
  const me = useApi<any>('/api/me');
  const [journeyUser, setJourneyUser] = useState<any | null>(null);
  const [confirmRole, setConfirmRole] = useState<{ user: any; role: string } | null>(null);
  const toast = useToast();

  if (loading) return <PageLoader />;
  if (error) return <ErrorNote message={error} onRetry={refetch} />;

  const users = data?.users || [];
  const myId = me.data?.user?.id;

  async function applyRole() {
    if (!confirmRole) return;
    try {
      await api(`/api/users/${confirmRole.user.id}/role`, { method: 'POST', body: JSON.stringify({ role: confirmRole.role }) });
      toast.push(`${confirmRole.user.name} is now ${confirmRole.role === 'admin' ? 'an admin' : 'a regular user'}`);
      refetch();
    } catch (e: any) {
      toast.push(e.message, 'error');
    }
    setConfirmRole(null);
  }

  return (
    <BlurFade>
      <GlowCard className="p-5">
        <p className="mb-3 text-[13px] text-muted">{users.length} registered users</p>
        <Table head={['User', 'Email', 'Comments', 'Joined', 'Role', '']}>
          {users.map((u: any) => (
            <tr key={u.id} className="transition-colors hover:bg-white/[0.02]">
              <td className="px-3 py-2.5">
                <button onClick={() => setJourneyUser(u)} className="flex items-center gap-2.5 text-left">
                  {u.avatar ? (
                    <img src={u.avatar} alt="" referrerPolicy="no-referrer" className="h-7 w-7 rounded-full border border-hairline" />
                  ) : (
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gold/10 text-[11px] font-bold text-gold">
                      {(u.name || '?')[0]}
                    </div>
                  )}
                  <span className="font-medium text-cream hover:text-gold-bright">{u.name}</span>
                </button>
              </td>
              <td className="px-3 py-2.5 text-muted">{u.email}</td>
              <td className="px-3 py-2.5 tabular-nums text-muted">{u.comment_count}</td>
              <td className="px-3 py-2.5 text-muted">{fmtDate(u.created_at)}</td>
              <td className="px-3 py-2.5">
                {u.id === myId ? (
                  <Badge tone="gold" className="gap-1">admin · you</Badge>
                ) : (
                  <select
                    value={u.role || 'user'}
                    onChange={(e) => setConfirmRole({ user: u, role: e.target.value })}
                    className="rounded-lg border border-hairline bg-black/30 px-2 py-1 text-[12px] text-cream outline-none transition-colors hover:border-hairline-strong focus:border-gold/40"
                  >
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                )}
              </td>
            </tr>
          ))}
        </Table>
        <Drawer
          open={!!journeyUser}
          onClose={() => setJourneyUser(null)}
          title={journeyUser ? `${journeyUser.name}` : ''}
        >
          {journeyUser && <Journey userId={journeyUser.id} />}
        </Drawer>
        <Modal open={!!confirmRole} onClose={() => { setConfirmRole(null); refetch(); }} title="Change role">
          {confirmRole && (
            <>
              <p className="text-[13px] leading-relaxed text-cream/80">
                {confirmRole.role === 'admin' ? (
                  <>Make <b className="text-cream">{confirmRole.user.name}</b> ({confirmRole.user.email}) an <b className="text-gold-bright">admin</b>? They get full access to this dashboard, the pipeline, and all data.</>
                ) : (
                  <>Remove admin access from <b className="text-cream">{confirmRole.user.name}</b>? They will no longer be able to sign in here.</>
                )}
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => { setConfirmRole(null); refetch(); }}>Cancel</Button>
                <Button variant={confirmRole.role === 'admin' ? 'gold' : 'danger'} onClick={applyRole}>
                  {confirmRole.role === 'admin' ? 'Make admin' : 'Remove admin'}
                </Button>
              </div>
            </>
          )}
        </Modal>
      </GlowCard>
    </BlurFade>
  );
}
