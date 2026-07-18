// Image key input done properly: live preview + upload + browse R2 +
// optional contextual choices (e.g. pick one of the playlist's thumbnails).
// Replaces every raw "cover key / photo key" text input.
import { useRef, useState } from 'react';
import { useApi } from '../lib/api';
import { Field, Spinner, Modal } from './Primitives';
import { fmtBytes } from '../lib/format';
import { Icon } from './Icon';
import { useToast } from './Toast';

const CDN = 'https://cdn.deensubs.com/';

export function R2Picker({ open, onClose, prefix, onPick }: { open: boolean; onClose: () => void; prefix: string; onPick: (key: string) => void }) {
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

const btnCls = 'inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-soft px-2.5 py-1.5 text-[11px] font-medium text-cream/80 transition-all hover:bg-hover active:scale-[0.97] disabled:opacity-50';

export function ImageField({
  label,
  value,
  onChange,
  prefix,
  hint,
  choices,
  aiPrompt,
  gradeable,
}: {
  label: string;
  value: string;
  onChange: (key: string) => void;
  prefix: string;
  hint?: string;
  choices?: { key: string; label?: string }[];
  /** When set, shows a Generate button producing brand art from this prompt */
  aiPrompt?: string;
  /** Shows Re-grade: deterministic v2 de-tint (works on real-person portraits) */
  gradeable?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const toast = useToast();
  const options = (choices || []).filter((c) => c.key);

  async function aiCall(kind: string, extra: any, doneMsg: string) {
    setAiBusy(kind);
    try {
      const r = await fetch('/api/ai/image', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ kind, prefix, ...extra }),
      });
      const j: any = await r.json();
      if (!r.ok) throw new Error(j.error || 'AI image failed');
      onChange(j.key);
      toast.push(doneMsg);
    } catch (e: any) {
      toast.push(e.message, 'error');
    }
    setAiBusy(null);
  }

  async function upload(f: File) {
    setUploading(true);
    try {
      const r = await fetch(`/api/upload?prefix=${encodeURIComponent(prefix)}&name=${encodeURIComponent(f.name)}`, {
        method: 'POST',
        headers: { 'content-type': f.type },
        body: f,
        credentials: 'include',
      });
      const j: any = await r.json();
      if (!r.ok) throw new Error(j.error || 'Upload failed');
      onChange(j.key);
      toast.push('Image uploaded');
    } catch (e: any) {
      toast.push(e.message, 'error');
    }
    setUploading(false);
  }

  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-3">
        <div className="h-14 w-24 shrink-0 overflow-hidden rounded-lg border border-hairline bg-inset">
          {value ? (
            <img src={CDN + value} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] text-faint">none</div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()} className={btnCls}>
            {uploading ? <Spinner className="h-3 w-3" /> : <Icon name="plus" className="h-3 w-3" />}
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
          {options.length > 0 && (
            <button type="button" onClick={() => setChoosing(true)} className={btnCls}>
              <Icon name="video" className="h-3 w-3" /> Choose
            </button>
          )}
          <button type="button" onClick={() => setBrowsing(true)} className={btnCls}>
            <Icon name="folder" className="h-3 w-3" /> Browse
          </button>
          {aiPrompt && (
            <button type="button" disabled={aiBusy !== null} onClick={() => aiCall('generate', { prompt: aiPrompt, name: label }, 'Generated')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gold/30 bg-gold/10 px-2.5 py-1.5 text-[11px] font-medium text-gold-bright transition-all hover:bg-gold/20 active:scale-[0.97] disabled:opacity-50">
              {aiBusy === 'generate' ? <Spinner className="h-3 w-3" /> : <Icon name="sparkles" className="h-3 w-3" />}
              {aiBusy === 'generate' ? 'Generating (~30s)...' : 'Generate'}
            </button>
          )}
          {gradeable && value && (
            <button type="button" disabled={aiBusy !== null} onClick={() => aiCall('grade', { imageKey: value }, 'Re-graded to the v2 brand — golden tint removed')}
              title="Neutralize the old golden tint (deterministic, keeps likeness exactly)"
              className="inline-flex items-center gap-1.5 rounded-lg border border-gold/30 bg-gold/10 px-2.5 py-1.5 text-[11px] font-medium text-gold-bright transition-all hover:bg-gold/20 active:scale-[0.97] disabled:opacity-50">
              {aiBusy === 'grade' ? <Spinner className="h-3 w-3" /> : <Icon name="sparkles" className="h-3 w-3" />}
              {aiBusy === 'grade' ? 'Grading...' : 'Re-grade'}
            </button>
          )}
          {value && (
            <button type="button" onClick={() => onChange('')} className={btnCls}>
              Clear
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }}
        />
      </div>
      <R2Picker open={browsing} onClose={() => setBrowsing(false)} prefix={prefix} onPick={onChange} />
      <Modal open={choosing} onClose={() => setChoosing(false)} title="Choose an image">
        <div className="grid max-h-96 grid-cols-3 gap-2 overflow-y-auto">
          {options.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => { onChange(c.key); setChoosing(false); }}
              className={`group overflow-hidden rounded-lg border text-left transition-colors ${value === c.key ? 'border-gold/60' : 'border-hairline hover:border-gold/40'}`}
            >
              <img src={CDN + c.key} alt="" loading="lazy" className="aspect-video w-full object-cover" />
              {c.label && <p className="truncate px-1.5 py-1 text-[10px] text-muted group-hover:text-cream">{c.label}</p>}
            </button>
          ))}
        </div>
      </Modal>
    </Field>
  );
}
