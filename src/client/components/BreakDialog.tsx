import { useMemo } from 'react';
import { BREAK_TIPS, formatCountdown } from '../../shared/pomodoro.js';
import { Coffee } from '../icons.js';
import type { PomoApi } from '../usePomodoro.js';

/** Shown during a Pomodoro break and when it ends (unless auto-start is on). */
export function BreakDialog({ pomo }: { pomo: PomoApi }) {
  const onBreak = pomo.session?.phase === 'break';
  // A new tip for every break, stable while the countdown ticks.
  const tip = useMemo(() => BREAK_TIPS[Math.floor(Math.random() * BREAK_TIPS.length)], [pomo.session?.phaseStart]);
  if (!onBreak && !pomo.finished) return null;
  const long = pomo.session?.long;
  const goalLine = pomo.goal > 0 ? ` Сегодня ${pomo.doneToday} из ${pomo.goal}.` : '';

  return (
    <div className="overlay soft">
      <div className="dialog break" role="dialog" aria-label="Перерыв">
        <div className="break-icon">
          <Coffee size={30} />
        </div>
        {onBreak ? (
          <>
            <h2>{long ? 'Длинный перерыв' : 'Перерыв'}</h2>
            <div className="big-count">{formatCountdown(pomo.remaining)}</div>
            <p className="muted">Помидор завершён, время записано.{goalLine}</p>
            <p className="tip">{tip}</p>
            <div className="stack-buttons">
              <button className="btn subtle" onClick={pomo.skipBreak}>
                Пропустить перерыв
              </button>
            </div>
          </>
        ) : (
          <>
            <h2>Перерыв закончился</h2>
            <p className="muted">Продолжить с той же задачей?{goalLine}</p>
            <div className="stack-buttons">
              <button className="btn primary" onClick={pomo.resume}>
                Начать следующий помидор
              </button>
              <button className="btn ghost" onClick={pomo.dismiss}>
                Не сейчас
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
