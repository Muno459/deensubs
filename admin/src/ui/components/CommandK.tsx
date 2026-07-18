// ⌘K command palette: navigation, quick actions, entity search.
import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api';
import { Icon } from './Icon';
import { useToast } from './Toast';

type NavItem = { id: string; label: string; icon: string; group: string };

export function CommandK({
  nav,
  onNavigate,
}: {
  nav: NavItem[];
  onNavigate: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [videos, setVideos] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const toast = useToast();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Lazy-load videos for search once the palette opens
  useEffect(() => {
    if (open && !videos.length) {
      api('/api/videos').then((r) => setVideos(r.videos || [])).catch(() => {});
    }
    if (!open) setQuery('');
  }, [open]);

  function run(fn: () => void) {
    setOpen(false);
    fn();
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[90] flex items-start justify-center bg-black/60 pt-[16vh] backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setOpen(false)}
        >
          <motion.div
            className="w-full max-w-lg overflow-hidden rounded-xl border border-hairline-strong bg-raised shadow-2xl"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
          >
            <Command label="Command palette" shouldFilter>
              <Command.Input value={query} onValueChange={setQuery} placeholder="Search pages, videos, actions..." autoFocus />
              <Command.List>
                <Command.Empty>Nothing found.</Command.Empty>

                <Command.Group heading="Pages">
                  {nav.map((n) => (
                    <Command.Item key={n.id} value={`${n.label} ${n.group}`} onSelect={() => run(() => onNavigate(n.id))}>
                      <Icon name={n.icon} className="h-4 w-4 text-faint" />
                      {n.label}
                      <span className="ml-auto text-[10px] uppercase tracking-wider text-faint">{n.group}</span>
                    </Command.Item>
                  ))}
                </Command.Group>

                <Command.Group heading="Actions">
                  <Command.Item
                    value="purge cache kv fresh"
                    onSelect={() =>
                      run(async () => {
                        try {
                          const r = await api('/api/purge-cache', { method: 'POST' });
                          toast.push(`Purged ${r.deleted} cache keys`);
                        } catch (e: any) {
                          toast.push('Purge failed: ' + e.message, 'error');
                        }
                      })
                    }
                  >
                    <Icon name="refresh" className="h-4 w-4 text-faint" />
                    Purge KV cache
                  </Command.Item>
                  <Command.Item value="new transcription scribe add video url" onSelect={() => run(() => onNavigate('scribe'))}>
                    <Icon name="captions" className="h-4 w-4 text-faint" />
                    New transcription
                  </Command.Item>
                  <Command.Item value="ask ai agent" onSelect={() => run(() => onNavigate('ai'))}>
                    <Icon name="sparkles" className="h-4 w-4 text-faint" />
                    Ask the agent
                  </Command.Item>
                  <Command.Item
                    value="open site deensubs.com"
                    onSelect={() => run(() => window.open('https://deensubs.com', '_blank'))}
                  >
                    <Icon name="external" className="h-4 w-4 text-faint" />
                    Open deensubs.com
                  </Command.Item>
                </Command.Group>

                {query.length > 1 && videos.length > 0 && (
                  <Command.Group heading="Videos">
                    {videos.slice(0, 200).map((v) => (
                      <Command.Item
                        key={v.id}
                        value={`video ${v.title} ${v.slug}`}
                        onSelect={() => run(() => window.open(`https://deensubs.com/watch/${v.slug}`, '_blank'))}
                      >
                        <Icon name="video" className="h-4 w-4 text-faint" />
                        <span className="truncate">{v.title}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
              </Command.List>
            </Command>
            <div className="flex items-center gap-3 border-t border-hairline px-4 py-2 text-[10px] text-faint">
              <span>↑↓ navigate</span>
              <span>⏎ select</span>
              <span>esc close</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
