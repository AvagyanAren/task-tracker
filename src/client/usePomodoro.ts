import { useCallback, useEffect, useRef, useState } from 'react';
import {
  advance,
  phaseEnd,
  remainingMs,
  startSession,
  type PomodoroSession,
  type PomodoroSettings
} from '../shared/pomodoro.js';
import { dayKey } from '../shared/time.js';
import type { Entry, State } from '../shared/types.js';
import { api, tzOffset } from './api.js';
import { askNotificationPermission, chime, systemNotify } from './sound.js';

const KEY = 'tempo.pomodoro.v1';

interface Persisted {
  enabled: boolean;
  session: PomodoroSession | null;
  last: { description: string; projectId: string | null; tags: string[]; billable: boolean } | null;
  /** Work intervals finished in the current series (drives the long break). */
  cycle: number;
  /** Finished pomodoros per local day (YYYY-MM-DD). */
  done: Record<string, number>;
}

const EMPTY: Persisted = { enabled: false, session: null, last: null, cycle: 0, done: {} };

function read(): Persisted {
  try {
    return { ...EMPTY, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Persisted>) };
  } catch {
    return EMPTY;
  }
}

/** Finished pomodoros per day, for reports. */
export function pomodoroDays(): Record<string, number> {
  return read().done ?? {};
}

export interface PomoApi {
  enabled: boolean;
  session: PomodoroSession | null;
  /** Milliseconds left in the current phase. */
  remaining: number;
  toggle: () => void;
  /** Break finished or skipped: offer to continue. */
  finished: boolean;
  /** Start the next work interval with the same task. */
  resume: () => void;
  skipBreak: () => void;
  dismiss: () => void;
  /** Pomodoros finished today. */
  doneToday: number;
  goal: number;
}

interface Deps {
  state: State;
  now: number;
  cfg: PomodoroSettings;
  run: (fn: () => Promise<State>) => Promise<boolean>;
}

/**
 * Pomodoro on top of the normal timer. While the mode is on, starting a timer
 * begins a work interval; when it ends the timer is stopped at the exact end
 * time and a break runs. Afterwards the next interval starts by itself
 * (auto-start) or the person chooses to continue.
 */
export function usePomodoro({ state, now, cfg, run }: Deps): PomoApi {
  const [p, setP] = useState<Persisted>(read);
  const [finished, setFinished] = useState(false);
  const running: Entry | undefined = state.entries.find((e) => e.end === null);
  const stopping = useRef(false);

  const save = useCallback((next: Persisted) => {
    setP(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  // Mode on + a timer starts -> a work interval begins (the series keeps its count).
  useEffect(() => {
    if (p.enabled && running && !p.session && !finished) {
      save({ ...p, session: { ...startSession(Date.now()), cycle: p.cycle } });
    }
  }, [p.enabled, running?.id, p.session, finished]);

  // The timer was stopped by hand during work -> cancel the interval.
  useEffect(() => {
    if (p.session?.phase === 'work' && !running && !stopping.current) {
      save({ ...p, session: null });
    }
  }, [running?.id, p.session?.phase]);

  const startNext = useCallback(
    (from: Persisted) => {
      const l = from.last;
      return run(() => api.startTimer(l?.description ?? '', l?.projectId ?? null, l?.tags ?? [], l?.billable ?? true));
    },
    [run]
  );

  // Phase boundaries.
  useEffect(() => {
    const s = p.session;
    if (!s || remainingMs(s, cfg, now) > 0) return;

    if (s.phase === 'work') {
      if (stopping.current) return;
      stopping.current = true;
      const endIso = new Date(phaseEnd(s, cfg)).toISOString();
      const last = running
        ? { description: running.description, projectId: running.projectId, tags: running.tags, billable: running.billable }
        : p.last;
      void (async () => {
        if (running && Date.parse(endIso) > Date.parse(running.start)) {
          await run(() => api.updateEntry(running.id, { end: endIso }));
        }
        chime(cfg.gentleSound);
        systemNotify('Помидор завершён', 'Время перерыва.');
        const day = dayKey(Date.parse(endIso), tzOffset());
        save({ ...p, session: advance(s, cfg), last, cycle: s.cycle + 1, done: { ...p.done, [day]: (p.done[day] ?? 0) + 1 } });
        stopping.current = false;
      })();
    } else {
      chime(cfg.gentleSound);
      systemNotify('Перерыв закончился', cfg.autoStart ? 'Следующий помидор начался.' : 'Можно возвращаться к работе.');
      const next = { ...p, session: null };
      save(next);
      if (cfg.autoStart && p.last) void startNext(next);
      else setFinished(true);
    }
  }, [now, p.session, cfg.workMin, cfg.shortBreakMin, cfg.longBreakMin, cfg.autoStart]);

  const toggle = useCallback(() => {
    if (p.enabled) {
      save({ ...p, enabled: false, session: null, cycle: 0 });
      setFinished(false);
    } else {
      void askNotificationPermission();
      save({ ...p, enabled: true });
    }
  }, [p, save]);

  const resume = useCallback(() => {
    setFinished(false);
    const next = { ...p, session: null };
    save(next);
    void startNext(next);
  }, [p, save, startNext]);

  const skipBreak = useCallback(() => {
    save({ ...p, session: null });
    if (cfg.autoStart && p.last) void startNext(p);
    else setFinished(true);
  }, [p, save, cfg.autoStart, startNext]);

  const dismiss = useCallback(() => setFinished(false), []);

  const today = dayKey(now, tzOffset());
  return {
    enabled: p.enabled,
    session: p.session,
    remaining: p.session ? remainingMs(p.session, cfg, now) : 0,
    toggle,
    finished,
    resume,
    skipBreak,
    dismiss,
    doneToday: p.done[today] ?? 0,
    goal: cfg.dailyGoal
  };
}
