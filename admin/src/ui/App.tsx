import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api, useApi } from './lib/api';
import { cn } from './lib/cn';
import { Icon } from './components/Icon';
import { BorderBeam } from './components/BorderBeam';
import { Spinner } from './components/Primitives';
import { ToastProvider } from './components/Toast';
import { CommandK } from './components/CommandK';
import Dashboard from './pages/Dashboard';
import Analytics from './pages/Analytics';
import Watch from './pages/Watch';
import Videos from './pages/Videos';
import Audiobooks from './pages/Audiobooks';
import Thumbnails from './pages/Thumbnails';
import Playlists from './pages/Playlists';
import Comments from './pages/Comments';
import Users from './pages/Users';
import Visitors from './pages/Visitors';
import Searches from './pages/Searches';
import Sql from './pages/Sql';
import Tools from './pages/Tools';
import Ai from './pages/Ai';
import Scribe from './pages/Scribe';
import Clips from './pages/Clips';
import Catalog from './pages/Catalog';

type Me = { user: { id: number; name: string; email: string; avatar: string; role: string } | null; admin?: boolean };

const NAV: { group: string; items: { id: string; label: string; icon: string }[] }[] = [
  {
    group: 'Overview',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
      { id: 'analytics', label: 'Analytics', icon: 'chart' },
      { id: 'watch', label: 'Watch Data', icon: 'play' },
    ],
  },
  {
    group: 'Content',
    items: [
      { id: 'videos', label: 'Videos', icon: 'video' },
      { id: 'audio', label: 'Audiobooks', icon: 'headphones' },
      { id: 'thumbnails', label: 'Thumbnails', icon: 'image' },
      { id: 'playlists', label: 'Playlists', icon: 'folder' },
      { id: 'scribe', label: 'Scribe', icon: 'captions' },
      { id: 'clips', label: 'Clip Studio', icon: 'play' },
      { id: 'catalog', label: 'Catalog', icon: 'wrench' },
      { id: 'comments', label: 'Comments', icon: 'comment' },
    ],
  },
  {
    group: 'People',
    items: [
      { id: 'users', label: 'Users', icon: 'users' },
      { id: 'visitors', label: 'Visitors', icon: 'eye' },
      { id: 'searches', label: 'Searches', icon: 'search' },
    ],
  },
  {
    group: 'System',
    items: [
      { id: 'sql', label: 'SQL Console', icon: 'terminal' },
      { id: 'tools', label: 'Tools', icon: 'wrench' },
      { id: 'ai', label: 'Agent', icon: 'sparkles' },
    ],
  },
];

const PAGES: Record<string, React.ComponentType> = {
  dashboard: Dashboard,
  analytics: Analytics,
  watch: Watch,
  videos: Videos,
  audio: Audiobooks,
  thumbnails: Thumbnails,
  playlists: Playlists,
  scribe: Scribe,
  clips: Clips,
  catalog: Catalog,
  comments: Comments,
  users: Users,
  visitors: Visitors,
  searches: Searches,
  sql: Sql,
  tools: Tools,
  ai: Ai,
};

function useHashRoute(): [string, (r: string) => void] {
  const [route, setRoute] = useState(() => location.hash.replace(/^#\/?/, '') || 'dashboard');
  useEffect(() => {
    const onHash = () => setRoute(location.hash.replace(/^#\/?/, '') || 'dashboard');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const nav = useCallback((r: string) => {
    location.hash = '/' + r;
  }, []);
  return [route, nav];
}

function LiveChip() {
  const rt = useApi<any>('/api/realtime');
  const live = rt.data?.live?.length
    ? rt.data.live.reduce((a: number, r: any) => a + (r.visitors || r.live || 0), 0)
    : null;
  if (live == null) return null;
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-hairline bg-soft px-2.5 py-1 text-[11px] font-medium text-muted">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
      </span>
      {live} live
    </span>
  );
}

function Login({ denied }: { denied?: string }) {
  const loginUrl =
    'https://deensubs.com/auth/google?redirect=' + encodeURIComponent(location.origin + location.pathname);
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-hairline bg-panel p-8 text-center">
        <BorderBeam size={130} duration={11} />
        <p className="font-arabic text-3xl text-gold" dir="rtl">
          بسم الله
        </p>
        <h1 className="mt-3 text-xl font-semibold tracking-tight text-cream">DeenSubs Admin</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          {denied || 'Sign in with your admin Google account to continue.'}
        </p>
        <a
          href={loginUrl}
          className="mt-6 flex w-full items-center justify-center gap-2.5 rounded-lg bg-cream px-4 py-2.5 text-sm font-semibold text-ink transition-all hover:bg-white active:scale-[0.98]"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24">
            <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
            <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.996 10.996 0 001 12c0 1.77.42 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Sign in with Google
        </a>
        <a href="https://deensubs.com" className="mt-4 inline-block text-[12px] text-faint underline-offset-2 hover:text-cream hover:underline">
          Back to deensubs.com
        </a>
      </div>
    </div>
  );
}

export default function App() {
  const [me, setMe] = useState<Me | null | 'loading'>('loading');
  const [route, nav] = useHashRoute();
  const [theme, setTheme] = useState<string>(() => localStorage.getItem('ds-admin-theme') || 'light');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('ds-admin-theme', theme);
  }, [theme]);

  useEffect(() => {
    api<Me>('/api/me')
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  if (me === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-7 w-7" />
      </div>
    );
  }

  if (!me || !me.user) return <Login />;
  if (!me.admin)
    return <Login denied={`Signed in as ${me.user.email}, but this account is not an admin.`} />;

  const Page = PAGES[route] || Dashboard;
  const current = NAV.flatMap((g) => g.items).find((i) => i.id === route);
  const currentGroup = NAV.find((g) => g.items.some((i) => i.id === route));
  const flatNav = NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g.group })));

  return (
    <ToastProvider>
      <CommandK nav={flatNav} onNavigate={nav} />
      <div className="flex min-h-screen">
        {/* Sidebar */}
        <aside className="fixed inset-y-0 left-0 z-40 flex w-56 flex-col border-r border-hairline bg-ink">
          <div className="px-4 pb-3 pt-5">
            <a href="#/dashboard" className="flex items-baseline gap-2">
              <span className="text-[15px] font-semibold tracking-tight text-cream">DeenSubs</span>
              <span className="rounded border border-hairline bg-soft px-1 py-px text-[9px] font-semibold uppercase tracking-[0.14em] text-faint">
                Admin
              </span>
            </a>
          </div>
          <nav className="flex-1 overflow-y-auto px-2.5 pb-4">
            {NAV.map((group) => (
              <div key={group.group} className="mb-4">
                <p className="mb-1 px-2.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-faint/70">
                  {group.group}
                </p>
                <div className="space-y-px">
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => nav(item.id)}
                      className={cn(
                        'group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] transition-colors duration-150',
                        route === item.id ? 'text-cream' : 'text-muted hover:bg-hover hover:text-cream'
                      )}
                    >
                      {route === item.id && (
                        <motion.span
                          layoutId="nav-active"
                          className="absolute inset-0 rounded-lg bg-soft"
                          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                        />
                      )}
                      {route === item.id && (
                        <motion.span layoutId="nav-bar" className="absolute -left-2.5 h-4 w-0.5 rounded-full bg-gold" />
                      )}
                      <Icon name={item.icon} className={cn('relative h-4 w-4 shrink-0', route === item.id ? 'text-gold' : 'text-faint group-hover:text-muted')} />
                      <span className="relative">{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>
          <div className="border-t border-hairline p-2.5">
            <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
              {me.user.avatar ? (
                <img src={me.user.avatar} alt="" className="h-6 w-6 rounded-full border border-hairline" referrerPolicy="no-referrer" />
              ) : (
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gold/15 text-[10px] font-bold text-gold">
                  {me.user.name?.[0] || 'A'}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium text-cream">{me.user.name}</p>
              </div>
              <a href="https://deensubs.com/auth/logout" title="Sign out" className="text-faint transition-colors hover:text-red-400">
                <Icon name="logout" className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        </aside>

        {/* Main */}
        <main className="ml-56 min-w-0 flex-1">
          <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-hairline bg-ink/80 px-5 backdrop-blur-xl">
            <div className="flex items-baseline gap-2 text-[13px]">
              <span className="text-faint">{currentGroup?.group}</span>
              <span className="text-faint">/</span>
              <h1 className="font-medium text-cream">{current?.label || 'Dashboard'}</h1>
            </div>
            <div className="flex items-center gap-2">
              <LiveChip />
              <button
                onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
                title={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-hairline bg-soft text-muted transition-colors hover:text-cream"
              >
                <Icon name={theme === 'light' ? 'moon' : 'sun'} className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
                className="flex items-center gap-2 rounded-lg border border-hairline bg-soft px-2.5 py-1.5 text-[11px] text-faint transition-colors hover:border-hairline-strong hover:text-muted"
              >
                <Icon name="search" className="h-3 w-3" />
                Search
                <kbd className="rounded border border-hairline bg-soft px-1 font-mono text-[9px]">⌘K</kbd>
              </button>
              <a
                href="https://deensubs.com"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-lg border border-hairline bg-soft px-2.5 py-1.5 text-[11px] font-medium text-muted transition-colors hover:text-cream"
              >
                <Icon name="external" className="h-3 w-3" />
                Site
              </a>
            </div>
          </header>
          <div className="mx-auto max-w-6xl p-5">
            <AnimatePresence mode="wait">
              <motion.div
                key={route}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
              >
                <Page />
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
    </ToastProvider>
  );
}
