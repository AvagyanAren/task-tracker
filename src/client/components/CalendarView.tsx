import { useEffect, useMemo, useRef, useState } from 'react';
import type { Entry } from '../../shared/types.js';
import { daySeconds, layoutDay, snap, weekDays, weekStart } from '../../shared/calendar.js';
import { addDays, dayKey, formatHM, isoToLocalTime, localToIso } from '../../shared/time.js';
import { useApp } from '../ctx.js';
import { ChevronLeft, ChevronRight } from '../icons.js';
import { EntryDialog } from './EntryDialog.js';

const HOUR_PX = 56;
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const minToTime = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function CalendarView() {
  const { state, now, tz } = useApp();
  const today = dayKey(now, tz);
  const [start, setStart] = useState(weekStart(today));
  const days = weekDays(start);
  const scroller = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ day: string; a: number; b: number } | null>(null);
  const [dialog, setDialog] = useState<{ entry?: Entry; prefill?: { start: string; end: string } } | null>(null);
  const projects = useMemo(() => new Map(state.projects.map((p) => [p.id, p])), [state.projects]);
  const byId = useMemo(() => new Map(state.entries.map((e) => [e.id, e])), [state.entries]);

  // Open at the working part of the day, not at midnight.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 7 * HOUR_PX;
  }, []);

  const columns = useMemo(
    () => days.map((d) => ({ day: d, blocks: layoutDay(state.entries, d, tz, now), seconds: daySeconds(state.entries, d, tz, now) })),
    [state.entries, days.join(), tz, now]
  );
  const weekTotal = columns.reduce((n, c) => n + c.seconds, 0);

  const minuteAt = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(24 * 60, snap(((e.clientY - rect.top) / HOUR_PX) * 60)));
  };

  const finishDrag = () => {
    if (!drag) return;
    let a = Math.min(drag.a, drag.b);
    let b = Math.max(drag.a, drag.b);
    if (b - a < 15) b = Math.min(24 * 60, a + 60); // a plain click makes a one-hour slot
    if (b - a < 15) a = b - 60;
    setDrag(null);
    setDialog({ prefill: { start: localToIso(drag.day, minToTime(a), tz), end: b >= 24 * 60 ? localToIso(addDays(drag.day, 1), '00:00', tz) : localToIso(drag.day, minToTime(b), tz) } });
  };

  const nowMin = (now - Date.parse(localToIso(today, '00:00', tz))) / 60_000;
  const weekLabel = `${days[0].split('-').reverse().slice(0, 2).join('.')} – ${days[6].split('-').reverse().join('.')}`;

  return (
    <div className="cal">
      <div className="cal-bar">
        <div className="row gap">
          <button className="btn icon subtle" onClick={() => setStart(addDays(start, -7))} aria-label="Предыдущая неделя">
            <ChevronLeft />
          </button>
          <button className="btn icon subtle" onClick={() => setStart(addDays(start, 7))} aria-label="Следующая неделя">
            <ChevronRight />
          </button>
          <button className="btn subtle" onClick={() => setStart(weekStart(today))}>
            Сегодня
          </button>
          <strong className="cal-title">{weekLabel}</strong>
        </div>
        <span className="muted">За неделю: <strong>{formatHM(weekTotal)}</strong></span>
      </div>


      <div className="cal-scroll" ref={scroller} onMouseUp={finishDrag} onMouseLeave={() => drag && finishDrag()}>
        <div className="cal-head">
          <div className="cal-gutter" />
          {columns.map((c, i) => (
            <div key={c.day} className={c.day === today ? 'cal-dayhead today' : 'cal-dayhead'}>
              <span>{WD[i]}</span>
              <strong>{Number(c.day.slice(8))}</strong>
              <em>{c.seconds ? formatHM(c.seconds) : ''}</em>
            </div>
          ))}
        </div>
        <div className="cal-grid" style={{ height: 24 * HOUR_PX }}>
          <div className="cal-gutter">
            {HOURS.map((h) => (
              <div key={h} className="cal-hour" style={{ height: HOUR_PX }}>
                <span>{h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}</span>
              </div>
            ))}
          </div>

          {columns.map((c) => (
            <div
              key={c.day}
              className={c.day === today ? 'cal-col today' : 'cal-col'}
              onMouseDown={(e) => {
                if (e.target !== e.currentTarget) return;
                const m = minuteAt(e);
                setDrag({ day: c.day, a: m, b: m });
              }}
              onMouseMove={(e) => drag && drag.day === c.day && setDrag({ ...drag, b: minuteAt(e) })}
            >
              {HOURS.map((h) => (
                <div key={h} className="cal-line" style={{ top: h * HOUR_PX }} />
              ))}

              {c.blocks.map((b) => {
                const e = byId.get(b.entryId)!;
                const p = e.projectId ? projects.get(e.projectId) : undefined;
                const top = (b.startMin / 60) * HOUR_PX;
                const height = Math.max(18, ((b.endMin - b.startMin) / 60) * HOUR_PX - 2);
                return (
                  <button
                    key={b.entryId}
                    className={`cal-block ${b.running ? 'running' : ''}`}
                    style={{
                      top,
                      height,
                      left: `calc(${(b.lane / b.lanes) * 100}% + 2px)`,
                      width: `calc(${100 / b.lanes}% - 4px)`,
                      ['--c' as string]: p?.color ?? 'var(--text-3)'
                    }}
                    onMouseDown={(ev) => ev.stopPropagation()}
                    onClick={() => setDialog({ entry: e })}
                    title={`${e.description || 'Без названия'} · ${isoToLocalTime(e.start, tz)}–${e.end ? isoToLocalTime(e.end, tz) : '…'}`}
                  >
                    <strong>{e.description || 'Без названия'}</strong>
                    {height > 40 && <span>{p?.name ?? 'Без проекта'}</span>}
                  </button>
                );
              })}

              {drag && drag.day === c.day && (
                <div
                  className="cal-drag"
                  style={{
                    top: (Math.min(drag.a, drag.b) / 60) * HOUR_PX,
                    height: Math.max(8, (Math.abs(drag.b - drag.a) / 60) * HOUR_PX)
                  }}
                />
              )}

              {c.day === today && nowMin >= 0 && nowMin <= 24 * 60 && <div className="cal-now" style={{ top: (nowMin / 60) * HOUR_PX }} />}
            </div>
          ))}
        </div>
      </div>
      <p className="hint">Потяните по пустому месту, чтобы добавить запись.</p>

      {dialog && <EntryDialog entry={dialog.entry} prefill={dialog.prefill} onClose={() => setDialog(null)} />}
    </div>
  );
}
