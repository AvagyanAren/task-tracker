export interface PomodoroSettings {
  workMin: number;
  shortBreakMin: number;
  longBreakMin: number;
  /** Every Nth finished work interval is followed by the long break. */
  longEvery: number;
  /** Start the next work interval automatically when a break ends. */
  autoStart: boolean;
  /** Pomodoros per day to aim for. */
  dailyGoal: number;
  /** Soft, slowly fading bell instead of the sharp two-tone beep. */
  gentleSound: boolean;
}

export const DEFAULT_POMODORO: PomodoroSettings = {
  workMin: 25,
  shortBreakMin: 5,
  longBreakMin: 15,
  longEvery: 4,
  autoStart: false,
  dailyGoal: 8,
  gentleSound: true
};

/** Short advice shown during a break. */
export const BREAK_TIPS = [
  'Встаньте и разомните плечи и шею.',
  'Выпейте стакан воды.',
  'Посмотрите вдаль на 20 секунд — глазам нужен отдых от экрана.',
  'Сделайте несколько глубоких вдохов.',
  'Пройдитесь по комнате или выйдите на балкон.',
  'Потянитесь: руки вверх, затем наклон вперёд.',
  'Откройте окно и проветрите комнату.',
  'Закройте глаза на минуту.',
  'Не берите телефон — дайте голове передохнуть по-настоящему.'
];

export type PomodoroPhase = 'work' | 'break';

export interface PomodoroSession {
  phase: PomodoroPhase;
  /** Epoch ms when this phase began. */
  phaseStart: number;
  /** Work intervals finished so far (before the current one). */
  cycle: number;
  /** For a break: is it the long one? */
  long?: boolean;
}

export function phaseDurationMs(s: PomodoroSession, cfg: PomodoroSettings): number {
  const min = s.phase === 'work' ? cfg.workMin : s.long ? cfg.longBreakMin : cfg.shortBreakMin;
  return Math.max(1, min) * 60_000;
}

export function phaseEnd(s: PomodoroSession, cfg: PomodoroSettings): number {
  return s.phaseStart + phaseDurationMs(s, cfg);
}

export function remainingMs(s: PomodoroSession, cfg: PomodoroSettings, now: number): number {
  return Math.max(0, phaseEnd(s, cfg) - now);
}

/** Starts the first work interval. */
export function startSession(now: number): PomodoroSession {
  return { phase: 'work', phaseStart: now, cycle: 0 };
}

/**
 * The session after the current phase ends. Work -> break (long every Nth),
 * break -> `null`: the person decides when to start the next work interval.
 * The next phase starts exactly where the previous one ended, not "now",
 * so a late notification never shifts the schedule.
 */
export function advance(s: PomodoroSession, cfg: PomodoroSettings): PomodoroSession | null {
  const end = phaseEnd(s, cfg);
  if (s.phase === 'work') {
    const cycle = s.cycle + 1;
    return { phase: 'break', phaseStart: end, cycle, long: cycle % Math.max(1, cfg.longEvery) === 0 };
  }
  return null;
}

export function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
