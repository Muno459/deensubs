import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { GlowCard, Button, Badge, Spinner } from '../components/Primitives';
import { Icon } from '../components/Icon';

type Activity = { name: string; args: string; ms?: number; ok?: boolean; running: boolean };
type Msg = {
  role: 'user' | 'assistant';
  content: string;
  activity?: Activity[];
  model?: string;
  error?: string;
  streaming?: boolean;
};

const STORAGE_KEY = 'deensubs-ai-chat-v2';

const SUGGESTIONS = [
  'How is the platform doing this week?',
  'What are people searching for that we do not have?',
  'List the recent Scribe jobs and their status',
  'Any videos missing subtitles or thumbnails?',
  'Show real-time traffic right now',
];

function render(md: string): string {
  return DOMPurify.sanitize(marked.parse(md, { async: false }) as string);
}

function toolLabel(name: string): string {
  return name.replace(/_/g, ' ');
}

export default function Ai() {
  const [messages, setMessages] = useState<Msg[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
  });
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30).map((m) => ({ ...m, streaming: false }))));
    } catch {}
  }, [messages]);

  function patchLast(patch: (m: Msg) => Msg) {
    setMessages((ms) => {
      const next = [...ms];
      const last = next[next.length - 1];
      if (last?.role === 'assistant') next[next.length - 1] = patch(last);
      return next;
    });
  }

  async function send(text?: string) {
    const prompt = (text ?? input).trim();
    if (!prompt || busy) return;
    setInput('');
    setBusy(true);

    const history = messages
      .filter((m) => m.content && !m.error)
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((ms) => [
      ...ms,
      { role: 'user', content: prompt },
      { role: 'assistant', content: '', activity: [], streaming: true },
    ]);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch('/api/ai/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, history }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';
          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith('data:')) continue;
            let e: any;
            try { e = JSON.parse(line.slice(5)); } catch { continue; }
            if (e.type === 'token') {
              patchLast((m) => ({ ...m, content: m.content + e.text }));
            } else if (e.type === 'tool_start') {
              patchLast((m) => ({ ...m, activity: [...(m.activity || []), { name: e.name, args: e.args, running: true }] }));
            } else if (e.type === 'tool_done') {
              patchLast((m) => ({
                ...m,
                activity: (m.activity || []).map((a) =>
                  a.name === e.name && a.running ? { ...a, running: false, ms: e.ms, ok: e.ok } : a
                ),
              }));
            } else if (e.type === 'done') {
              patchLast((m) => ({ ...m, model: e.model, streaming: false }));
            } else if (e.type === 'error') {
              patchLast((m) => ({ ...m, error: e.message, streaming: false }));
            }
          }
        }
        if (done) break;
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') patchLast((m) => ({ ...m, error: String(err.message || err), streaming: false }));
      else patchLast((m) => ({ ...m, streaming: false }));
    }
    patchLast((m) => ({ ...m, streaming: false }));
    abortRef.current = null;
    setBusy(false);
  }

  function stop() {
    abortRef.current?.abort();
  }

  function retry() {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    setMessages((ms) => {
      const idx = ms.map((m) => m.role).lastIndexOf('user');
      return ms.slice(0, idx);
    });
    setTimeout(() => send(lastUser.content), 0);
  }

  const lastAssistant = messages[messages.length - 1];

  return (
    <div className="mx-auto flex h-[calc(100vh-8.5rem)] max-w-3xl flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto pb-4 pr-1">
        {messages.length === 0 && (
          <div className="relative mt-10 overflow-hidden rounded-2xl border border-hairline bg-panel/60 p-8 text-center">
              <Icon name="sparkles" className="mx-auto h-8 w-8 text-gold" />
            <h2 className="mt-3 text-lg font-semibold text-cream">Admin Agent</h2>
            <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-muted">
              A tool-using agent on your live database: analytics, moderation, content gaps, cache — and it can
              start Scribe transcriptions and publish finished jobs as videos.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-hairline bg-soft px-3 py-1.5 text-[12px] text-cream/80 transition-colors hover:border-gold/30 hover:text-gold-bright"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl rounded-br-md bg-gold/15 px-4 py-2.5 text-[13.5px] leading-relaxed text-cream">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <GlowCard glow={false} className="w-full max-w-[94%] px-4 py-3">
                {/* Tool activity timeline */}
                {m.activity && m.activity.length > 0 && (
                  <div className="mb-2.5 space-y-1 border-l border-gold/20 pl-3">
                    <AnimatePresence initial={false}>
                      {m.activity.map((a, j) => (
                        <motion.div
                          key={j}
                          initial={{ opacity: 0, x: -6 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="flex items-center gap-2 text-[11px]"
                        >
                          {a.running ? (
                            <Spinner className="h-2.5 w-2.5 border" />
                          ) : a.ok === false ? (
                            <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                          ) : (
                            <span className="h-1.5 w-1.5 rounded-full bg-gold" />
                          )}
                          <span className={a.running ? 'text-gold-bright' : 'text-muted'}>
                            {toolLabel(a.name)}
                          </span>
                          {a.ms != null && <span className="tabular-nums text-muted/50">{a.ms}ms</span>}
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                )}

                {m.content ? (
                  <div className="md-body text-[13.5px] leading-relaxed text-cream/90" dangerouslySetInnerHTML={{ __html: render(m.content) }} />
                ) : m.streaming ? (
                  <div className="flex items-center gap-2 py-1 text-[12px] text-muted">
                    <Spinner className="h-3.5 w-3.5" /> thinking...
                  </div>
                ) : null}

                {m.error && <p className="mt-2 text-[12px] text-red-400">{m.error}</p>}

                {!m.streaming && (m.model || m.error) && (
                  <div className="mt-2 flex items-center gap-2">
                    {m.model && <Badge tone="dim" className="font-mono text-[9px]">{m.model}</Badge>}
                    {i === messages.length - 1 && (
                      <button onClick={retry} className="text-[10px] font-medium text-muted underline-offset-2 hover:text-gold-bright hover:underline">
                        retry
                      </button>
                    )}
                  </div>
                )}
              </GlowCard>
            </div>
          )
        )}
        <div ref={endRef} />
      </div>

      <div className="relative">
        <textarea
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Ask, analyze, or act: 'transcribe this URL', 'publish job xyz', 'find content gaps'..."
          className="w-full resize-none rounded-2xl border border-hairline bg-panel/80 py-3 pl-4 pr-32 text-[13.5px] leading-relaxed text-cream outline-none backdrop-blur transition-colors placeholder:text-muted/60 focus:border-gold/40"
        />
        <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
          {messages.length > 0 && !busy && (
            <button
              onClick={() => setMessages([])}
              title="Clear conversation"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-cream"
            >
              <Icon name="trash" className="h-3.5 w-3.5" />
            </button>
          )}
          {busy && lastAssistant?.streaming ? (
            <Button variant="ghost" onClick={stop} className="px-4 py-1.5">Stop</Button>
          ) : (
            <Button onClick={() => send()} disabled={busy || !input.trim()} className="px-4 py-1.5">Send</Button>
          )}
        </div>
      </div>
    </div>
  );
}
