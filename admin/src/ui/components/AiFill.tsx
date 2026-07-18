// One-tap AI fill for any form: calls /api/ai/fill and hands back the draft.
import { useState } from 'react';
import { api } from '../lib/api';
import { Icon } from './Icon';
import { Spinner } from './Primitives';
import { useToast } from './Toast';

export function AiFillButton({
  kind,
  payload,
  onFill,
  label = 'Fill with AI',
  note,
  className = '',
}: {
  kind: string;
  payload: any;
  onFill: (r: any) => void;
  label?: string;
  note?: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await api('/api/ai/fill', { method: 'POST', body: JSON.stringify({ kind, ...payload }) });
          onFill(r);
          if (note) toast.push(note);
        } catch (e: any) {
          toast.push(e.message, 'error');
        }
        setBusy(false);
      }}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-gold/30 bg-gold/10 px-2.5 py-1.5 text-[11px] font-medium text-gold-bright transition-all hover:bg-gold/20 active:scale-[0.97] disabled:opacity-50 ${className}`}
    >
      {busy ? <Spinner className="h-3 w-3" /> : <Icon name="sparkles" className="h-3 w-3" />}
      {busy ? 'Thinking...' : label}
    </button>
  );
}
