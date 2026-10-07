import { useCallback, useEffect, useMemo, useState } from 'react';
import type { State } from '../shared/types.js';
import { ambient } from './ambient.js';
import { api, tzOffset } from './api.js';
import { Ctx, type AppContext } from './ctx.js';
import { useHotkeys } from './hotkeys.js';
import { Briefcase, Chart, FileImport, Help, Settings as SettingsIcon, Timer } from './icons.js';
import { useSettings } from './settings.js';
import { useIdle, type IdleInfo } from './useIdle.js';
import { usePomodoro } from './usePomodoro.js';
import { BreakDialog } from './components/BreakDialog.js';
import { FocusMode } from './components/FocusMode.js';
import { HelpDialog } from './components/HelpDialog.js';
import { IdleDialog } from './components/IdleDialog.js';
import { Login } from './components/Login.js';
import { ImportView } from './components/ImportView.js';
import { ProjectsView } from './components/ProjectsView.js';
import { ReportsView } from './components/ReportsView.js';
import { SettingsDialog } from './components/SettingsDialog.js';
import { TimerPage } from './components/TimerPage.js';

type Tab = 'timer' | 'reports' | 'projects' | 'import';
const NAV: Array<{ tab: Tab; label: string; icon: React.ReactNode }> = [
  { tab: 'timer', label: 'Таймер', icon: <Timer size={19} /> },
  { tab: 'reports', label: 'Отчёты', icon: <Chart size={19} /> },
  { tab: 'projects', label: 'Проекты', icon: <Briefcase size={19} /> },
  { tab: 'import', label: 'Импорт', icon: <FileImport size={19} /> }
];

export default function App() {
  const [state, setState] = useState<State | null>(null);
  const [tab, setTab] = useState<Tab>('timer');
  const [now, setNow] = useState(Date.now());
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const [settings, setSettings] = useSettings();
  const [dialog, setDialog] = useState<'settings' | 'help' | null>(null);
  const [focus, setFocus] = useState(false);
  const [idle, setIdle] = useState<IdleInfo | null>(null);
  const tz = tzOffset();

  const [auth, setAuth] = useState<'checking' | 'login' | 'ok'>('checking');
  const [authRequired, setAuthRequired] = useState(false);

  const boot = useCallback(() => {
    api
      .session()
      .then(async (s) => {
        setAuthRequired(s.authRequired);
        if (s.authRequired && !s.authenticated) return setAuth('login');
        setState(await api.state());
        setAuth('ok');
      })
      .catch((e: Error) => setToast({ text: e.message, error: true }));
  }, []);

  useEffect(boot, [boot]);

  // A request answered 401 (session expired or password changed): back to the login screen.
  useEffect(() => {
    const onUnauthorized = () => {
      setState(null);
      setAuth('login');
    };
    window.addEventListener('tempo:unauthorized', onUnauthorized);
    return () => window.removeEventListener('tempo:unauthorized', onUnauthorized);
  }, []);

  const logout = useCallback(() => {
    void api.logout().then(() => {
      setState(null);
      setAuth('login');
    });
  }, []);

  const running = state?.entries.find((e) => e.end === null);
  const isRunning = Boolean(running);

  // Tick every second only while a timer is running.
  useEffect(() => {
    setNow(Date.now());
    if (!isRunning) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  useEffect(() => {
    document.title = isRunning ? '● Tempo — идёт таймер' : 'Tempo — трекер времени';
  }, [isRunning]);

  const show = useCallback((text: string, error: boolean) => {
    setToast({ text, error });
    setTimeout(() => setToast((t) => (t?.text === text ? null : t)), error ? 6000 : 3000);
  }, []);
  const fail = useCallback((m: string) => show(m, true), [show]);
  const notify = useCallback((m: string) => show(m, false), [show]);

  const run = useCallback(
    async (fn: () => Promise<State>) => {
      try {
        setState(await fn());
        return true;
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [fail]
  );

  const emptyState = useMemo<State>(() => ({ projects: [], entries: [] }) as unknown as State, []);
  const pomo = usePomodoro({ state: state ?? emptyState, now, cfg: settings.pomodoro, run });

  useIdle({
    enabled: settings.idleEnabled,
    minutes: settings.idleMinutes,
    running,
    onPrompt: setIdle
  });

  // Background sounds follow the work: on during a work interval (or a running
  // timer without Pomodoro), silent on breaks.
  const a = settings.ambient;
  const working = pomo.enabled ? pomo.session?.phase === 'work' : isRunning;
  const playing = a.enabled && (a.when === 'always' || working);
  const mixKey = JSON.stringify(a.mix);
  useEffect(() => {
    ambient.set({ mix: a.mix, master: a.master, playing });
  }, [mixKey, a.master, playing]);

  const goTimer = () => setTab('timer');
  useHotkeys(settings.hotkeys, {
    start: () => {
      goTimer();
      setTimeout(() => window.dispatchEvent(new Event('tempo:focus-desc')), 0);
    },
    stop: () => {
      if (running) void run(api.stopTimer);
    },
    manual: () => {
      goTimer();
      setTimeout(() => window.dispatchEvent(new CustomEvent('tempo:mode', { detail: 'manual' })), 0);
    },
    continueLast: () => {
      if (!state || running) return;
      const last = [...state.entries].sort((a, b) => (a.start < b.start ? 1 : -1))[0];
      if (last) void run(() => api.startTimer(last.description, last.projectId, last.tags, last.billable));
    },
    help: () => setDialog('help')
  });

  if (auth === 'login') return <Login onDone={boot} />;

  if (!state) {
    return (
      <div className="boot">
        {toast ? <p className="error">{toast.text}</p> : <p className="muted">Загрузка…</p>}
      </div>
    );
  }

  const ctx: AppContext = { state, now, tz, settings, setSettings, run, setState, fail, notify, authRequired, logout };

  return (
    <Ctx.Provider value={ctx}>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-mark">
              <Timer size={18} />
            </span>
            <span className="brand-name">Tempo</span>
          </div>

          <nav className="nav" aria-label="Разделы">
            {NAV.map((n) => (
              <button key={n.tab} className={tab === n.tab ? 'nav-item active' : 'nav-item'} onClick={() => setTab(n.tab)}>
                {n.icon}
                <span>{n.label}</span>
                {n.tab === 'timer' && isRunning && <i className="live" aria-label="Идёт таймер" />}
              </button>
            ))}
          </nav>

          <div className="sidebar-foot">
            <button className="nav-item" onClick={() => setDialog('help')}>
              <Help size={19} />
              <span>Горячие клавиши</span>
            </button>
            <button className="nav-item" onClick={() => setDialog('settings')}>
              <SettingsIcon size={19} />
              <span>Настройки</span>
            </button>
          </div>
        </aside>

        <main className="content">
          {tab === 'timer' && <TimerPage pomo={pomo} onFocus={() => setFocus(true)} />}
          {tab === 'reports' && <ReportsView />}
          {tab === 'projects' && <ProjectsView />}
          {tab === 'import' && <ImportView onGoReports={() => setTab('reports')} />}
        </main>

        {toast && (
          <div className={toast.error ? 'toast error' : 'toast'} role={toast.error ? 'alert' : 'status'} onClick={() => setToast(null)}>
            {toast.text}
          </div>
        )}

        {dialog === 'settings' && <SettingsDialog onClose={() => setDialog(null)} />}
        {dialog === 'help' && <HelpDialog onClose={() => setDialog(null)} />}
        {focus && <FocusMode pomo={pomo} onClose={() => setFocus(false)} />}
        {idle && <IdleDialog info={idle} onClose={() => setIdle(null)} />}
        <BreakDialog pomo={pomo} />
      </div>
    </Ctx.Provider>
  );
}
