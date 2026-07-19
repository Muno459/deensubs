// Catalog: categories + scholars management (the missing CRUD)
import { useEffect, useRef, useState } from 'react';
import { api, useApi } from '../lib/api';
import { GlowCard, SectionTitle, PageLoader, Button, Modal, Field, inputCls, Badge, Spinner } from '../components/Primitives';
import { BlurFade } from '../components/BlurFade';
import { Icon } from '../components/Icon';
import { AiFillButton } from '../components/AiFill';
import { ImageField } from '../components/ImageField';
import { useToast } from '../components/Toast';

function CategoryForm({ initial, onDone, onCancel }: { initial?: any; onDone: () => void; onCancel: () => void }) {
  const [form, setForm] = useState<any>(initial || { name: '', name_ar: '', color: '#45b3a2' });
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  return (
    <div className="space-y-3.5">
      <div className="flex justify-end">
        <AiFillButton
          kind="category"
          payload={{ name: form.name }}
          onFill={(r) => setForm((f: any) => ({ ...f, name: r.name || f.name, name_ar: r.name_ar || f.name_ar, color: r.color || f.color }))}
        />
      </div>
      <Field label="Name">
        <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="Arabic name">
        <input dir="rtl" className={inputCls + ' font-arabic'} value={form.name_ar || ''} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} />
      </Field>
      <Field label="Color">
        <div className="flex items-center gap-2">
          <input type="color" value={form.color || '#45b3a2'} onChange={(e) => setForm({ ...form, color: e.target.value })}
            className="h-9 w-12 cursor-pointer rounded-lg border border-hairline bg-transparent" />
          <input className={inputCls + ' font-mono'} value={form.color || ''} onChange={(e) => setForm({ ...form, color: e.target.value })} />
        </div>
      </Field>
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button disabled={saving || !form.name} onClick={async () => {
          setSaving(true);
          try {
            if (form.id) await api(`/api/categories/${form.id}`, { method: 'PUT', body: JSON.stringify(form) });
            else await api('/api/categories', { method: 'POST', body: JSON.stringify(form) });
            toast.push('Category saved');
            onDone();
          } catch (e: any) { toast.push(e.message, 'error'); }
          setSaving(false);
        }}>{saving ? 'Saving...' : 'Save'}</Button>
      </div>
    </div>
  );
}

function ScholarForm({ initial, onDone, onCancel, staged, onStagedConsumed }: { initial?: any; onDone: () => void; onCancel: () => void; staged?: File | null; onStagedConsumed?: () => void }) {
  const [form, setForm] = useState<any>(initial || { name: '', slug: '', title: '', bio: '', photo: '', photo_hero: '' });
  const [saving, setSaving] = useState(false);
  const [cutout, setCutout] = useState<'idle' | 'running' | 'done' | 'error'>(initial?.photo ? 'done' : 'idle');
  const [profile, setProfile] = useState<'idle' | 'running' | 'done' | 'error'>(initial?.bio ? 'done' : 'idle');
  const fileRef = useRef<HTMLInputElement>(null);
  const pending = useRef<File | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  async function runAll(f: File) {
    const name = (nameRef.current?.value || form.name || '').trim();
    if (!name) {
      pending.current = f;
      toast.push('Type the name — the AI takes it from there');
      nameRef.current?.focus();
      return;
    }
    // Cutout + profile draft run in parallel; fields fill themselves
    setCutout('running');
    (async () => {
      try {
        const up = await fetch(`/api/upload?prefix=scholars/&name=${encodeURIComponent(name + '-ref')}`, {
          method: 'POST', headers: { 'content-type': f.type }, body: f, credentials: 'include',
        });
        const uj: any = await up.json();
        if (!up.ok) throw new Error(uj.error || 'upload failed');
        const r = await api('/api/ai/image', { method: 'POST', body: JSON.stringify({ kind: 'scholar_magic', imageKey: uj.key, name }) });
        setForm((fm: any) => ({ ...fm, photo: r.photo, photo_hero: r.photo_hero }));
        setCutout('done');
      } catch (e: any) { setCutout('error'); toast.push(e.message, 'error'); }
    })();
    if (!form.id && profile !== 'done') {
      setProfile('running');
      (async () => {
        try {
          const fill = await api('/api/ai/fill', { method: 'POST', body: JSON.stringify({ kind: 'scholar', name }) });
          setForm((fm: any) => ({
            ...fm,
            slug: fm.id ? fm.slug : fm.slug || fill.slug || '',
            title: fm.title || fill.title || '',
            bio: fm.bio || fill.bio || '',
          }));
          setProfile('done');
        } catch { setProfile('error'); }
      })();
    }
  }

  useEffect(() => {
    if (staged) { runAll(staged); onStagedConsumed?.(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staged]);

  const [sparkle, setSparkle] = useState<string | null>(null);
  async function sparkleFill(field: 'name' | 'title' | 'bio') {
    if (!form.name.trim()) { toast.push('Type at least a rough name first'); return; }
    setSparkle(field);
    try {
      const r = await api('/api/ai/fill', { method: 'POST', body: JSON.stringify({ kind: 'scholar', name: form.name }) });
      setForm((fm: any) => ({ ...fm, [field]: r[field] || fm[field] }));
    } catch (e: any) { toast.push(e.message, 'error'); }
    setSparkle(null);
  }
  const sparkleBtn = (field: 'name' | 'title' | 'bio') => (
    <button type="button" disabled={sparkle !== null} onClick={() => sparkleFill(field)}
      title={field === 'name' ? 'Format the name properly' : `AI-draft the ${field}`}
      className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-faint transition-colors hover:bg-gold/10 hover:text-gold-bright">
      {sparkle === field ? <Spinner className="h-3 w-3" /> : <Icon name="sparkles" className="h-3 w-3" />}
    </button>
  );

  const chip = (state: string, labels: Record<string, string>) => (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
      state === 'done' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
      : state === 'running' ? 'border-gold/40 bg-gold/10 text-gold-bright'
      : state === 'error' ? 'border-red-500/40 bg-red-500/10 text-red-400'
      : 'border-hairline bg-soft text-faint'}`}>
      {state === 'running' && <Spinner className="h-3 w-3" />}
      {labels[state] || labels.idle}
    </span>
  );

  return (
    <div className="space-y-3.5">
      <Field label="Name">
        <div className="relative">
          <input
            ref={nameRef}
            className={inputCls + ' pr-9'}
            value={form.name}
            placeholder="Sheikh ..."
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter' && pending.current) { const f = pending.current; pending.current = null; runAll(f); } }}
            onBlur={() => { if (pending.current && form.name.trim()) { const f = pending.current; pending.current = null; runAll(f); } }}
          />
          {sparkleBtn('name')}
        </div>
      </Field>

      {cutout === 'idle' && !form.photo ? (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-gold/40 bg-gold/[0.04] px-4 py-7 text-center transition-colors hover:bg-gold/[0.08]"
        >
          <Icon name="sparkles" className="h-5 w-5 text-gold-bright" />
          <span className="text-[13px] font-medium text-cream">Paste a photo (Ctrl+V) — or click to upload</span>
          <span className="text-[11px] text-muted">AI extends the scene, cuts them out (the face stays the real photo), drafts the title and bio — allow 2–4 min</span>
        </button>
      ) : (
        <div className="flex items-center gap-3">
          <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-hairline bg-[repeating-conic-gradient(#8882_0_25%,transparent_0_50%)] bg-[length:16px_16px]">
            {form.photo ? (
              <img src={`https://cdn.deensubs.com/${form.photo}?v=${Date.now()}`} alt="" className="h-full w-full object-contain" />
            ) : (
              <div className="flex h-full w-full items-center justify-center"><Spinner className="h-5 w-5" /></div>
            )}
          </div>
          <div className="space-y-1.5">
            <div className="flex flex-wrap gap-1.5">
              {chip(cutout, { idle: 'Cutout', running: 'Cutting out (~2 min)...', done: 'Cutout ready', error: 'Cutout failed' })}
              {!form.id && chip(profile, { idle: 'Profile', running: 'Drafting bio...', done: 'Profile drafted', error: 'Profile failed' })}
            </div>
            <button type="button" onClick={() => fileRef.current?.click()} className="text-[11px] text-muted hover:text-cream">
              Use a different photo
            </button>
          </div>
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) runAll(f); }} />

      <Field label="Title" hint="Role/affiliation — AI drafts it, you verify">
        <div className="relative">
          <input className={inputCls + ' pr-9'} value={form.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          {sparkleBtn('title')}
        </div>
      </Field>
      <Field label="Bio">
        <div className="relative">
          <textarea rows={3} className={inputCls + ' resize-y pr-9'} value={form.bio || ''} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
          {sparkleBtn('bio')}
        </div>
      </Field>

      <details className="rounded-lg border border-hairline bg-soft/40 px-3 py-2">
        <summary className="cursor-pointer text-[11px] font-medium text-muted">Advanced</summary>
        <div className="mt-2 space-y-3">
          {!form.id && (
            <Field label="Slug">
              <input className={inputCls + ' font-mono'} value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
            </Field>
          )}
          {form.photo && form.photo === form.photo_hero ? (
            <>
              <ImageField label="Image (card + page)" hint="One cutout serves both — the site styles each context"
                prefix="scholars/" gradeable value={form.photo || ''}
                onChange={(key) => setForm({ ...form, photo: key, photo_hero: key })} />
              <button type="button" className="text-[11px] text-muted hover:text-cream"
                onClick={() => setForm({ ...form, photo_hero: form.photo })}>
                Need a different page image? <span className="text-gold-bright" onClick={(e) => { e.stopPropagation(); setForm({ ...form, photo_hero: '' }); }}>Split into two</span>
              </button>
            </>
          ) : (
            <>
              <ImageField label="Photo (cards)" prefix="scholars/" gradeable value={form.photo || ''} onChange={(key) => setForm({ ...form, photo: key })} />
              <ImageField label="Hero photo (scholar page)" prefix="scholars/" gradeable value={form.photo_hero || ''} onChange={(key) => setForm({ ...form, photo_hero: key })} />
              {form.photo && (
                <button type="button" className="text-[11px] text-muted hover:text-cream"
                  onClick={() => setForm({ ...form, photo_hero: form.photo })}>
                  Use the same image for both
                </button>
              )}
            </>
          )}
        </div>
      </details>

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button disabled={saving || !form.name || cutout === 'running'} onClick={async () => {
          setSaving(true);
          try {
            const payload = { ...form, slug: form.slug || form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') };
            if (form.id) await api(`/api/scholars/${form.id}`, { method: 'PUT', body: JSON.stringify(payload) });
            else await api('/api/scholars', { method: 'POST', body: JSON.stringify(payload) });
            toast.push('Scholar saved');
            onDone();
          } catch (e: any) { toast.push(e.message, 'error'); }
          setSaving(false);
        }}>{saving ? 'Saving...' : form.id ? 'Save changes' : 'Add scholar'}</Button>
      </div>
    </div>
  );
}

export default function Catalog() {
  const meta = useApi<any>('/api/meta');
  const [editCat, setEditCat] = useState<any | 'new' | null>(null);
  const [editScholar, setEditScholar] = useState<any | 'new' | null>(null);
  const [staged, setStaged] = useState<File | null>(null);
  const toast = useToast();

  // Paste a photo ANYWHERE on this page → the add-scholar flow opens with it
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
      if (!f) return;
      e.preventDefault();
      setStaged(f);
      setEditScholar((cur: any) => cur ?? 'new');
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  if (meta.loading) return <PageLoader />;
  const cats = meta.data?.categories || [];
  const scholars = meta.data?.scholars || [];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <BlurFade>
        <GlowCard className="p-5">
          <SectionTitle right={<Button className="px-3 py-1.5 text-[12px]" onClick={() => setEditCat('new')}>Add</Button>}>
            Categories ({cats.length})
          </SectionTitle>
          <div className="space-y-1">
            {cats.map((c: any) => (
              <div key={c.id} className="group flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-hover">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: c.color || '#45b3a2' }} />
                <span className="text-[13px] text-cream">{c.name}</span>
                {c.name_ar && <span dir="rtl" className="font-arabic text-[13px] text-muted">{c.name_ar}</span>}
                <span className="ml-auto font-mono text-[10px] text-faint">/{c.slug}</span>
                <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button onClick={() => setEditCat(c)} className="flex h-6 w-6 items-center justify-center rounded text-muted hover:text-gold-bright">
                    <Icon name="edit" className="h-3 w-3" />
                  </button>
                  <button
                    onClick={async () => {
                      try { await api(`/api/categories/${c.id}`, { method: 'DELETE' }); toast.push('Category deleted'); meta.refetch(); }
                      catch (e: any) { toast.push(e.message, 'error'); }
                    }}
                    className="flex h-6 w-6 items-center justify-center rounded text-muted hover:text-red-400">
                    <Icon name="trash" className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </GlowCard>
      </BlurFade>

      <BlurFade delay={0.05}>
        <GlowCard className="p-5">
          <SectionTitle right={<Button className="px-3 py-1.5 text-[12px]" onClick={() => setEditScholar('new')}>Add</Button>}>
            Scholars ({scholars.length})
          </SectionTitle>
          <div className="space-y-1">
            {scholars.map((s: any) => (
              <div key={s.id} className="group flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-hover">
                {s.photo ? (
                  <img src={`https://cdn.deensubs.com/${s.photo}`} alt="" className="h-7 w-7 rounded-full border border-hairline object-cover" />
                ) : (
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gold/10 text-[11px] font-bold text-gold">{s.name?.[0]}</div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-[13px] text-cream">{s.name}</p>
                  {s.title && <p className="truncate text-[10px] text-faint">{s.title}</p>}
                </div>
                <div className="ml-auto flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button onClick={() => setEditScholar(s)} className="flex h-6 w-6 items-center justify-center rounded text-muted hover:text-gold-bright">
                    <Icon name="edit" className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
            {!scholars.length && <Badge tone="dim">No scholars yet</Badge>}
          </div>
        </GlowCard>
      </BlurFade>

      <Modal open={!!editCat} onClose={() => setEditCat(null)} title={editCat === 'new' ? 'Add category' : 'Edit category'}>
        {editCat && (
          <CategoryForm initial={editCat === 'new' ? undefined : editCat} onCancel={() => setEditCat(null)}
            onDone={() => { setEditCat(null); meta.refetch(); }} />
        )}
      </Modal>
      <Modal open={!!editScholar} onClose={() => setEditScholar(null)} title={editScholar === 'new' ? 'Add scholar' : 'Edit scholar'}>
        {editScholar && (
          <ScholarForm staged={staged} onStagedConsumed={() => setStaged(null)} initial={editScholar === 'new' ? undefined : editScholar} onCancel={() => setEditScholar(null)}
            onDone={() => { setEditScholar(null); meta.refetch(); }} />
        )}
      </Modal>
    </div>
  );
}
