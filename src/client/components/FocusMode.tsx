import { useCallback, useEffect, useRef, useState } from 'react';
import { entrySeconds } from '../../shared/report.js';
import { formatClock } from '../../shared/time.js';
import { formatCountdown } from '../../shared/pomodoro.js';
import { useApp } from '../ctx.js';
import { Collapse, Expand, Square, X } from '../icons.js';
import { ProjectDot } from '../ui.js';
import { AmbientMixer } from './AmbientMixer.js';
import type { PomoApi } from '../usePomodoro.js';

/** Controls fade after this long without input, like the iPhone's StandBy clock. */
const IDLE_MS = 3000;
/** The picture shifts a few pixels every minute so a lit pixel never stays in one place (OLED burn-in). */
const DRIFT: Array<[number, number]> = [[0, 0], [-10, -6], [8, -10], [10, 8], [-8, 10]];

interface WakeLockSentinelLike {
  release: () => Promise<void>;
}

/** Calm full-screen timer: soft light numerals on near-black, controls only when the pointer moves. */
export function FocusMode({ pomo, onClose }: { pomo: PomoApi; onClose: () => void }) {
  const { state, now, stopTimer } = useApp();
  const running = state.entries.find((e) => e.end === null);
  const project = state.projects.find((p) => p.id === running?.projectId);
  const rootRef = useRef<HTMLDivElement>(null);
  const [awake, setAwake] = useState(true);
  const [full, setFull] = useState(() => Boolean(document.fullscreenElement));
  const [drift, setDrift] = useState(0);
  const canFullscreen = typeof document.fullscreenEnabled === 'boolean' && document.fullscreenEnabled;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!running) onClose();
  }, [running, onClose]);

  // Show the controls on any input, hide them after a few quiet seconds.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const wake = () => {
      setAwake(true);
      clearTimeout(timer);
      timer = setTimeout(() => setAwake(false), IDLE_MS);
    };
    wake();
    const events = ['pointermove', 'pointerdown', 'keydown', 'touchstart'] as const;
    for (const e of events) window.addEventListener(e, wake, { passive: true });
    return () => {
      clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, wake);
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setDrift((d) => (d + 1) % DRIFT.length), 60_000);
    return () => clearInterval(t);
  }, []);

  // Keep the screen on while the focus view is open.
  useEffect(() => {
    let lock: WakeLockSentinelLike | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> } };
    const request = async () => {
      try {
        lock = (await nav.wakeLock?.request('screen')) ?? null;
      } catch {
        /* not allowed (battery saver, background tab): the screen just follows the system timeout */
      }
    };
    void request();
    const onVisible = () => document.visibilityState === 'visible' && void request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const onChange = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void rootRef.current?.requestFullscreen().catch(() => undefined);
  }, []);

  if (!running) return null;
  const [dx, dy] = DRIFT[drift];

  return (
    <div ref={rootRef} className={awake ? 'focus' : 'focus idle'} role="dialog" aria-label="Режим фокуса">
      <div className="focus-top">
        {canFullscreen && (
          <button className="focus-icon" onClick={toggleFullscreen} aria-label={full ? 'Выйти из полного экрана' : 'На весь экран'} title={full ? 'Выйти из полного экрана' : 'На весь экран'}>
            {full ? <Collapse size={20} /> : <Expand size={20} />}
          </button>
        )}
        <button className="focus-icon" onClick={onClose} aria-label="Закрыть режим фокуса" title="Закрыть (Esc)">
          <X size={20} />
        </button>
      </div>

      <div className="focus-body" style={{ transform: `translate(${dx}px, ${dy}px)` }}>
        {project && (
          <div className="focus-project">
            <ProjectDot color={project.color} size={8} /> {project.name}
          </div>
        )}
        <h1>{running.description || 'Без названия'}</h1>
        <div className="focus-clock">{formatClock(entrySeconds(running, now))}</div>
        <div className="focus-pomo">{pomo.session?.phase === 'work' ? `До перерыва ${formatCountdown(pomo.remaining)}` : ' '}</div>
        <div className="focus-actions">
          <button className="focus-btn" onClick={() => stopTimer()}>
            <Square size={14} solid /> Остановить
          </button>
          <AmbientMixer />
        </div>
      </div>
    </div>
  );
}
