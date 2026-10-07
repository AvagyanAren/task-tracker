import { useMemo } from 'react';
import { buildReport, dayRangeToQuery, presetRange } from '../../shared/report.js';
import { addDays, dayKey, formatHM } from '../../shared/time.js';
import { useApp } from '../ctx.js';
import { formatMoneyMap } from '../format.js';

const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export function SidePanel() {
  const { state, now, tz } = useApp();
  const today = dayKey(now, tz);

  const { day, week, bars } = useMemo(() => {
    const d = presetRange('today', now, tz);
    const w = presetRange('week', now, tz);
    const rep = (a: string, b: string) => buildReport(state, dayRangeToQuery(a, b, tz), now, tz);
    const weekRep = rep(w.fromDay, w.toDay);
    const bySec = new Map(weekRep.byDay.map((x) => [x.day, x.seconds]));
    const days = Array.from({ length: 7 }, (_, i) => addDays(w.fromDay, i));
    return {
      day: rep(d.fromDay, d.toDay),
      week: weekRep,
      bars: days.map((x, i) => ({ day: x, label: WD[i], seconds: bySec.get(x) ?? 0 }))
    };
  }, [state, now, tz]);

  const max = Math.max(3600, ...bars.map((b) => b.seconds));

  return (
    <aside className="side">
      <div className="panel">
        <h3>Сегодня</h3>
        <div className="big">{formatHM(day.totalSeconds)}</div>
        <div className="sub">{formatMoneyMap(day.amountByCurrency)}</div>
      </div>
      <div className="panel">
        <h3>Эта неделя</h3>
        <div className="big">{formatHM(week.totalSeconds)}</div>
        <div className="sub">{formatMoneyMap(week.amountByCurrency)}</div>
        <div className="minibars" aria-label="Часы по дням недели">
          {bars.map((b) => (
            <div key={b.day} className={b.day === today ? 'minibar today' : 'minibar'} title={`${b.label}: ${formatHM(b.seconds)}`}>
              <div className="minibar-fill" style={{ height: `${Math.max(4, (b.seconds / max) * 100)}%` }} />
              <span>{b.label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="panel hintbox">
        <h3>Горячие клавиши</h3>
        <p>
          <kbd className="kbd">N</kbd> старт · <kbd className="kbd">S</kbd> стоп · <kbd className="kbd">M</kbd> вручную · <kbd className="kbd">C</kbd> продолжить
        </p>
      </div>
    </aside>
  );
}
