import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Entry, State } from '../shared/types.js';
import { ambient } from './ambient.js';
import { api, NetworkError, tzOffset } from './api.js';
import { applyQueue, clearOffline, dropOpsFor, loadCache, loadQueue, newId, saveCache, saveQueue, type Op } from './offlineQueue.js';
import { Ctx, type AppContext } from './ctx.js';
import { useHotkeys } from './hotkeys.js';
import { type Optimistic } from './optimistic.js';
import { Briefcase, Chart, ChevronLeft, FileImport, Help, Invoice, Kanban, Settings as SettingsIcon, Timer } from './icons.js';
import { useSettings } from './settings.js';
import { useIdle, type IdleInfo } from './useIdle.js';
import { usePomodoro } from './usePomodoro.js';
import { BreakDialog } from './components/BreakDialog.js';
import { FocusMode } from './components/FocusMode.js';
import { HelpDialog } from './components/HelpDialog.js';
import { IdleDialog } from './components/IdleDialog.js';
import { SyncBadge } from './components/SyncBadge.js';
import { MiniTimer } from './components/MiniTimer.js';
import { ConfirmHost } from './components/ConfirmHost.js';
import { Logo } from './components/Logo.js';
import { Login } from './components/Login.js';
import { ImportView } from './components/ImportView.js';
import { InvoicesView } from './components/InvoicesView.js';
import { ProjectsView } from './components/ProjectsView.js';
import { ReportsView } from './components/ReportsView.js';
import { SettingsDialog } from './components/SettingsDialog.js';
import { TasksView } from './components/TasksView.js';
import { TimerPage } from './components/TimerPage.js';

type Tab = 'timer' | 'tasks' | 'reports' | 'invoices' | 'projects' | 'import';
const NAV: Array<{ tab: Tab; label: string; icon: React.ReactNode }> = [
  { tab: 'timer', label: 'Таймер', icon: <Timer size={19} /> },
  { tab: 'tasks', label: 'Задачи', icon: <Kanban size={19} /> },
  { tab: 'reports', label: 'Отчёты', icon: <Chart size={19} /> },
  { tab: 'invoices', label: 'Счета', icon: <Invoice size={19} /> },
  { tab: 'projects', label: 'Проекты', icon: <Briefcase size={19} /> },
  { tab: 'import', label: 'Импорт', icon: <FileImport size={19} /> }
];

export default function App() {
  const [state, setState] = useState<State | null>(null);
  // Deep links such as /#reports or /#settings open that screen straight away.
  const hash = typeof location === 'undefined' ? '' : location.hash.replace('#', '');
  const [tab, setTab] = useState<Tab>((NAV.some((n) => n.tab === hash.split('+')[0]) ? hash.split('+')[0] : 'timer') as Tab);
  const [now, setNow] = useState(Date.now());
  const [toast, setToast] = useState<{ text: string; error: boolean; action?: { label: string; onClick: () => void } } | null>(null);
  const [settings, setSettings] = useSettings();
  const [dialog, setDialog] = useState<'settings' | 'help' | null>(hash.includes('settings') ? 'settings' : hash.includes('help') ? 'help' : null);
  const [focus, setFocus] = useState(false);
  // The desktop sidebar can shrink to icons; the choice is remembered on this device.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('tempo.sidebar') === '1';
    } catch {
      return false;
    }
  });
  const toggleSidebar = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem('tempo.sidebar', c ? '0' : '1');
      } catch {
        /* remembering is a convenience only */
      }
      return !c;
    });
  const [idle, setIdle] = useState<IdleInfo | null>(null);
  const tz = tzOffset();

  // Every state that reaches the screen goes through commit(): entries waiting for their
  // delayed delete are hidden even when a server answer still contains them.
  const stateRef = useRef<State | null>(null);
  const pendingDelete = useRef(new Map<string, { entry: Entry; timer: ReturnType<typeof setTimeout> }>());
  // Actions made offline wait here and are shown on top of the server's data until they are sent.
  const queueRef = useRef<Op[]>(loadQueue());
  const [pending, setPending] = useState(queueRef.current.length);
  const commit = useCallback((s: State) => {
    const hide = pendingDelete.current;
    const visible = hide.size ? { ...s, entries: s.entries.filter((e) => !hide.has(e.id)) } : s;
    const next = applyQueue(visible, queueRef.current);
    stateRef.current = next;
    setState(next);
    saveCache(next);
  }, []);
  const setQueue = useCallback((ops: Op[]) => {
    queueRef.current = ops;
    saveQueue(ops);
    setPending(ops.length);
  }, []);

  const [auth, setAuth] = useState<'checking' | 'login' | 'ok'>('checking');
  const [authRequired, setAuthRequired] = useState(false);

  const boot = useCallback(() => {
    api
      .session()
      .then(async (s) => {
        setAuthRequired(s.authRequired);
        if (s.authRequired && !s.authenticated) return setAuth('login');
        commit(await api.state());
        setAuth('ok');
      })
      .catch((e: Error) => {
        // No connection: open with the data last seen on this device, changes are queued.
        const cached = e instanceof NetworkError ? loadCache() : null;
        if (cached) {
          commit(cached);
          setAuth('ok');
          setToast({ text: 'Нет связи с сервером. Показаны данные, сохранённые на этом устройстве.', error: false });
        } else setToast({ text: e instanceof NetworkError ? 'Нет связи с сервером трекера.' : e.message, error: true });
      });
  }, [commit]);

  useEffect(boot, [boot]);

  // A request answered 401 (session expired or password changed): back to the login screen.
  useEffect(() => {
    const onUnauthorized = () => {
      clearOffline();
      queueRef.current = [];
      stateRef.current = null;
      setState(null);
      setAuth('login');
    };
    window.addEventListener('tempo:unauthorized', onUnauthorized);
    return () => window.removeEventListener('tempo:unauthorized', onUnauthorized);
  }, []);

  const logout = useCallback(() => {
    void api.logout().then(() => {
      clearOffline();
      queueRef.current = [];
      setPending(0);
      stateRef.current = null;
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
    const label = NAV.find((n) => n.tab === tab)?.label ?? 'Tempo';
    document.title = `${isRunning ? '● ' : ''}${label} — Tempo`;
  }, [isRunning, tab]);

  // The address follows the section, so a reload or a shared link opens the same screen.
  useEffect(() => {
    if (location.hash.replace('#', '').split('+')[0] !== tab) history.replaceState(null, '', `#${tab}`);
  }, [tab]);

  const show = useCallback((text: string, error: boolean, action?: { label: string; onClick: () => void }) => {
    setToast({ text, error, action });
    setTimeout(() => setToast((t) => (t?.text === text ? null : t)), error || action ? 6000 : 3000);
  }, []);
  const fail = useCallback((m: string) => show(m, true), [show]);
  const notify = useCallback((m: string) => show(m, false), [show]);

  // One gentle reminder per timer that has been running for hours (a forgotten timer is the classic mistake).
  const remindedFor = useRef<string | null>(null);
  useEffect(() => {
    const h = settings.longTimerHours;
    if (!running || h <= 0 || remindedFor.current === running.id) return;
    const hours = (now - Date.parse(running.start)) / 3_600_000;
    if (hours >= h) {
      remindedFor.current = running.id;
      show(`Таймер идёт уже ${Math.floor(hours)} ч. Не забыли его остановить?`, false);
    }
  }, [now, running, settings.longTimerHours, show]);


  // With `optimistic` the screen changes at once; the server answer then replaces it, or
  // the previous state is put back if the request fails.
  const run = useCallback(
    async (fn: () => Promise<State>, optimistic?: Optimistic) => {
      const before = stateRef.current;
      if (optimistic && before) commit(optimistic(before));
      try {
        commit(await fn());
        return true;
      } catch (err) {
        if (optimistic && before) commit(before);
        fail(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [commit, fail]
  );

  const deleteEntry = useCallback(
    (id: string) => {
      const entry = stateRef.current?.entries.find((e) => e.id === id);
      if (!entry || !stateRef.current) return;
      const finish = async () => {
        pendingDelete.current.delete(id);
        try {
          commit(await api.deleteEntry(id));
        } catch (err) {
          commit(stateRef.current!); // shows the entry again
          fail(err instanceof Error ? err.message : String(err));
        }
      };
      const timer = setTimeout(() => void finish(), 6000);
      pendingDelete.current.set(id, { entry, timer });
      commit(stateRef.current);
      show('Запись удалена', false, {
        label: 'Отменить',
        onClick: () => {
          clearTimeout(timer);
          pendingDelete.current.delete(id);
          commit({ ...stateRef.current!, entries: [...stateRef.current!.entries, entry] });
          setToast(null);
        }
      });
    },
    [commit, fail, show]
  );

  /* ---------- actions that work offline ---------- */

  const sendOp = (op: Op): Promise<State> => {
    if (op.kind === 'start') return api.startTimer(op.description, op.projectId, op.tags, op.billable, { id: op.id, at: op.at }, op.taskId);
    if (op.kind === 'stop') return api.stopTimer({ id: op.id, at: op.at });
    return api.addEntry({ id: op.id, description: op.description, projectId: op.projectId, tags: op.tags, billable: op.billable, start: op.start, end: op.end });
  };

  const flushing = useRef(false);
  const flush = useCallback(async () => {
    if (flushing.current || queueRef.current.length === 0) return;
    flushing.current = true;
    try {
      while (queueRef.current.length > 0) {
        const op = queueRef.current[0];
        try {
          const fresh = await sendOp(op);
          setQueue(queueRef.current.slice(1));
          commit(fresh);
        } catch (err) {
          if (err instanceof NetworkError) break; // still offline: keep everything, try later
          // The server refused this action (e.g. its project was deleted): drop it, keep going.
          setQueue(queueRef.current.slice(1));
          fail(`Действие, сделанное без связи, не удалось применить: ${err instanceof Error ? err.message : err}`);
          void api.state().then(commit, () => undefined);
        }
      }
    } finally {
      flushing.current = false;
    }
  }, [commit, fail, setQueue]);

  useEffect(() => {
    if (pending === 0) return;
    const again = () => void flush();
    window.addEventListener('online', again);
    const t = setInterval(again, 10_000);
    return () => {
      window.removeEventListener('online', again);
      clearInterval(t);
    };
  }, [pending, flush]);
  useEffect(() => void flush(), [flush]); // actions left from the last session

  const perform = useCallback(
    async (op: Op): Promise<boolean> => {
      // Something is already waiting to be sent: queue behind it so the order is kept.
      if (queueRef.current.length > 0) {
        setQueue([...queueRef.current, op]);
        commit(stateRef.current!);
        void flush();
        return true;
      }
      const before = stateRef.current;
      if (before) commit(applyQueue(before, [op]));
      try {
        commit(await sendOp(op));
        return true;
      } catch (err) {
        if (err instanceof NetworkError) {
          setQueue([op]);
          if (before) commit(before);
          show('Нет связи. Действие сохранено на этом устройстве и уйдёт, когда сеть вернётся.', false);
          return true;
        }
        if (before) commit(before);
        fail(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [commit, fail, flush, setQueue, show]
  );

  const startTimer = useCallback(
    (description: string, projectId: string | null, tags: string[], billable: boolean, taskId?: string | null) =>
      perform({ kind: 'start', id: newId(), at: new Date().toISOString(), description, projectId, tags, billable, ...(taskId ? { taskId } : {}) }),
    [perform]
  );
  const stopTimer = useCallback(() => {
    const running = stateRef.current?.entries.find((e) => e.end === null);
    return perform({ kind: 'stop', id: running?.id ?? '', at: new Date().toISOString() });
  }, [perform]);
  const addEntry = useCallback(
    (e: { description: string; projectId: string | null; tags: string[]; billable: boolean; start: string; end: string }) => perform({ kind: 'add', id: newId(), ...e }),
    [perform]
  );
  const discardEntry = useCallback(
    async (id: string) => {
      // Never reached the server: just forget it.
      if (queueRef.current.some((o) => o.id === id && o.kind !== 'stop')) {
        setQueue(dropOpsFor(queueRef.current, id));
        const s = stateRef.current!;
        commit({ ...s, entries: s.entries.filter((e) => e.id !== id) });
        return true;
      }
      return run(() => api.deleteEntry(id), (s) => ({ ...s, entries: s.entries.filter((e) => e.id !== id) }));
    },
    [commit, run, setQueue]
  );

  const emptyState = useMemo<State>(() => ({ projects: [], entries: [], boards: [], tasks: [] }) as unknown as State, []);
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
      if (running) void stopTimer();
    },
    manual: () => {
      goTimer();
      setTimeout(() => window.dispatchEvent(new CustomEvent('tempo:mode', { detail: 'manual' })), 0);
    },
    continueLast: () => {
      if (!state || running) return;
      const last = [...state.entries].sort((a, b) => (a.start < b.start ? 1 : -1))[0];
      if (last) void startTimer(last.description, last.projectId, last.tags, last.billable, last.taskId);
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

  const ctx: AppContext = { state, now, tz, settings, setSettings, run, deleteEntry, startTimer, stopTimer, addEntry, discardEntry, pending, setState: commit, fail, notify, authRequired, logout };

  return (
    <Ctx.Provider value={ctx}>
      <div className={collapsed ? 'shell collapsed' : 'shell'}>
        <aside className="sidebar">
          <div className="brand">
            <Logo size={32} />
            <span className="brand-name">Tempo</span>
            <button className="sidebar-toggle" onClick={toggleSidebar} aria-expanded={!collapsed} aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'} title={collapsed ? 'Развернуть меню' : 'Свернуть меню'}>
              <ChevronLeft size={16} />
            </button>
          </div>

          <nav className="nav" aria-label="Разделы">
            {NAV.map((n) => (
              <button key={n.tab} aria-current={tab === n.tab ? 'page' : undefined} className={`${tab === n.tab ? 'nav-item active' : 'nav-item'} ${n.tab === 'import' ? 'nav-desktop' : ''}`} title={collapsed ? n.label : undefined} onClick={() => setTab(n.tab)}>
                {n.icon}
                <span>{n.label}</span>
                {n.tab === 'timer' && isRunning && <i className="nav-live" aria-label="Идёт таймер" />}
              </button>
            ))}
          </nav>

          <div className="sidebar-foot">
            <button className="nav-item" title={collapsed ? 'Горячие клавиши' : undefined} onClick={() => setDialog('help')}>
              <Help size={19} />
              <span>Горячие клавиши</span>
            </button>
            <button className="nav-item" title={collapsed ? 'Настройки' : undefined} onClick={() => setDialog('settings')}>
              <SettingsIcon size={19} />
              <span>Настройки</span>
            </button>
          </div>
        </aside>

        {running && tab !== 'timer' && <MiniTimer entry={running} onOpen={() => setTab('timer')} />}

        <main className="content">
          {tab === 'timer' && <TimerPage pomo={pomo} onFocus={() => setFocus(true)} />}
          {tab === 'tasks' && <TasksView />}
          {tab === 'reports' && <ReportsView />}
          {tab === 'invoices' && <InvoicesView />}
          {tab === 'projects' && <ProjectsView />}
          {tab === 'import' && <ImportView onGoReports={() => setTab('reports')} />}
        </main>

        {toast && (
          <div className={toast.error ? 'toast error' : 'toast'} role={toast.error ? 'alert' : 'status'} onClick={() => setToast(null)}>
            <span>{toast.text}</span>
            {toast.action && (
              <button
                className="toast-action"
                onClick={(e) => {
                  e.stopPropagation();
                  toast.action!.onClick();
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}

        {dialog === 'settings' && <SettingsDialog onClose={() => setDialog(null)} />}
        {dialog === 'help' && <HelpDialog onClose={() => setDialog(null)} />}
        {focus && <FocusMode pomo={pomo} onClose={() => setFocus(false)} />}
        {idle && <IdleDialog info={idle} onClose={() => setIdle(null)} />}
        <BreakDialog pomo={pomo} />
        <SyncBadge pending={pending} onRetry={() => void flush()} />
        <ConfirmHost />
      </div>
    </Ctx.Provider>
  );
}
