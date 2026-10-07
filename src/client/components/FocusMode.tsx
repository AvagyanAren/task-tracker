import { useEffect } from 'react';
import { entrySeconds } from '../../shared/report.js';
import { formatClock } from '../../shared/time.js';
import { formatCountdown } from '../../shared/pomodoro.js';
import { api } from '../api.js';
import { useApp } from '../ctx.js';
import { Square, X } from '../icons.js';
import { ProjectDot } from '../ui.js';
import { AmbientMixer } from './AmbientMixer.js';
import type { PomoApi } from '../usePomodoro.js';

/** Full-screen view with nothing but the running timer. Esc closes it. */
export function FocusMode({ pomo, onClose }: { pomo: PomoApi; onClose: () => void }) {
  const { state, now, run } = useApp();
  const running = state.entries.find((e) => e.end === null);
  const project = state.projects.find((p) => p.id === running?.projectId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!running) onClose();
  }, [running, onClose]);

  if (!running) return null;

  return (
    <div className="focus" role="dialog" aria-label="Режим фокуса">
      <button className="btn icon ghost focus-close" onClick={onClose} aria-label="Закрыть режим фокуса">
        <X size={22} />
      </button>
      <div className="focus-body">
        {project && (
          <div className="focus-project">
            <ProjectDot color={project.color} size={12} /> {project.name}
          </div>
        )}
        <h1>{running.description || 'Без названия'}</h1>
        <div className="focus-clock">{formatClock(entrySeconds(running, now))}</div>
        {pomo.session?.phase === 'work' && <div className="focus-pomo">🍅 до перерыва {formatCountdown(pomo.remaining)}</div>}
        <button className="btn stop big" onClick={() => run(() => api.stopTimer())}>
          <Square size={20} solid /> Остановить
        </button>
        <AmbientMixer />
        <p className="hint">Esc — вернуться</p>
      </div>
    </div>
  );
}
