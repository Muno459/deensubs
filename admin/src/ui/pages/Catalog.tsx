// Catalog: categories + scholars management (the missing CRUD)
import { useRef, useState } from 'react';
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

function ScholarForm({ initial, onDone, onCancel }: { initial?: any; onDone: () => void; onCancel: () => void }) {
  const [form, setForm] = useState<any>(initial || { name: '', slug: '', title: '', bio: '', photo: '', photo_hero: '' });
  const [saving, setSaving] = useState(false);
  const [magic, setMagic] = useState<'idle' | 'uploading' | 'generating'>('idle');
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  async function runMagic(f: File) {
    if (!f.type.startsWith('image/')) return;
    setMagic('uploading');
    try {
      const up = await fetch(`/api/upload?prefix=scholars/&name=${encodeURIComponent((form.name || 'scholar') + '-ref')}`, {
        method: 'POST', headers: { 'content-type': f.type }, body: f, credentials: 'include',
      });
      const uj: any = await up.json();
      if (!up.ok) throw new Error(uj.error || 'upload failed');
      setMagic('generating');
      const r = await api('/api/ai/image', {
        method: 'POST',
        body: JSON.stringify({ kind: 'scholar_magic', imageKey: uj.key, name: form.name || 'scholar' }),
      });
      setForm((fm: any) => ({ ...fm, photo: r.photo, photo_hero: r.photo_hero }));
      toast.push('Portrait + hero generated — likeness untouched, review below');
    } catch (e: any) {
      toast.push(e.message, 'error');
    }
    setMagic('idle');
  }

  return (
    <div className="space-y-3.5" onPaste={(e) => {
      const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
      if (f) { e.preventDefault(); runMagic(f); }
    }}>
      <div className="flex justify-end">
        <AiFillButton
          kind="scholar"
          payload={{ name: form.name }}
          note="AI draft — verify facts before saving"
          onFill={(r) => setForm((f: any) => ({
            ...f,
            slug: f.id ? f.slug : r.slug || f.slug,
            title: r.title || f.title,
            bio: r.bio || f.bio,
          }))}
        />
      </div>
      <Field label="Name">
        <input className={inputCls} value={form.name} onChange={(e) => setForm({
          ...form, name: e.target.value,
          slug: form.id ? form.slug : e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
        })} />
      </Field>
      {!form.id && (
        <Field label="Slug">
          <input className={inputCls + ' font-mono'} value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
        </Field>
      )}
      <Field label="Title" hint="e.g. Professor at the Islamic University of Madinah">
        <input className={inputCls} value={form.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </Field>
      <Field label="Bio">
        <textarea rows={3} className={inputCls + ' resize-y'} value={form.bio || ''} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
      </Field>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={magic !== 'idle'}
        className="flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-gold/40 bg-gold/[0.04] px-4 py-6 text-center transition-colors hover:bg-gold/[0.08] disabled:opacity-70"
      >
        {magic !== 'idle' ? (
          <span className="inline-flex items-center gap-2 text-[13px] text-gold-bright">
            <Spinner className="h-4 w-4" /> {magic === 'uploading' ? 'Uploading reference...' : 'Doing the magic — portrait + hero (~2 min)...'}
          </span>
        ) : (
          <>
            <Icon name="sparkles" className="h-5 w-5 text-gold-bright" />
            <span className="text-[13px] font-medium text-cream">Paste (Ctrl+V) or click to upload a reference photo</span>
            <span className="text-[11px] text-muted">Branded square portrait + wide hero generate automatically — the face is preserved exactly</span>
          </>
        )}
      </button>
      <input ref={fileRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) runMagic(f); }} />
      <ImageField label="Photo" prefix="scholars/" gradeable value={form.photo || ''} onChange={(key) => setForm({ ...form, photo: key })} />
      <ImageField label="Hero photo" hint="Wide banner used on the scholar page" prefix="scholars/" gradeable value={form.photo_hero || ''} onChange={(key) => setForm({ ...form, photo_hero: key })} />
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button disabled={saving || !form.name} onClick={async () => {
          setSaving(true);
          try {
            if (form.id) await api(`/api/scholars/${form.id}`, { method: 'PUT', body: JSON.stringify(form) });
            else await api('/api/scholars', { method: 'POST', body: JSON.stringify(form) });
            toast.push('Scholar saved');
            onDone();
          } catch (e: any) { toast.push(e.message, 'error'); }
          setSaving(false);
        }}>{saving ? 'Saving...' : 'Save'}</Button>
      </div>
    </div>
  );
}

export default function Catalog() {
  const meta = useApi<any>('/api/meta');
  const [editCat, setEditCat] = useState<any | 'new' | null>(null);
  const [editScholar, setEditScholar] = useState<any | 'new' | null>(null);
  const toast = useToast();

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
          <ScholarForm initial={editScholar === 'new' ? undefined : editScholar} onCancel={() => setEditScholar(null)}
            onDone={() => { setEditScholar(null); meta.refetch(); }} />
        )}
      </Modal>
    </div>
  );
}
