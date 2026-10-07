import { useMemo, useState } from 'react';
import { weekDays, weekStart } from '../../shared/calendar.js';
import { buildTimesheet, planCellEdit, rowKey } from '../../shared/timesheet.js';
import { addDays, dayKey, formatClock, parseDuration } from '../../shared/time.js';
import { api } from '../api.js';
import { useApp } from '../ctx.js';
import { ChevronLeft, ChevronRight, Plus, Table } from '../icons.js';
import { Empty, ProjectDot } from '../ui.js';
import { ProjectPicker } from './ProjectPicker.js';

const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const hm = (sec: number) => (sec > 0 ? formatClock(sec).replace(/:\d\d$/, '') : '');

export function TimesheetView() {
  const { state, now, tz, run, fail } = useApp();
  const today = dayKey(now, tz);
  const [start, setStart] = useState(weekStart(today));
  const days = weekDays(start);
  const [extra, setExtra] = useState<Array<{ projectId: string | null; description: string }>>([]);
  const [newProject, setNewProject] = useState<string | null>(null);
  const [newDesc, setNewDesc] = useState('');
  const projects = useMemo(() => new Map(state.projects.map((p) => [p.id, p])), [state.projects]);

  const rows = useMemo(() => buildTimesheet(state, days, tz, now, extra), [state, days.join(), tz, now, extra]);
  const colTotals = days.map((_, i) => rows.reduce((n, r) => n + r.cells[i].seconds, 0));
  const grand = colTotals.reduce((n, s) => n + s, 0);

  const commit = async (rowIdx: number, dayIdx: number, text: string) => {
    const row = rows[rowIdx];
    const cell = row.cells[dayIdx];
    const sec = text.trim() === '' ? 0 : parseDuration(text);
    if (sec === null) return fail('Не понял время. Примеры: 2:30, 2.5, 90m.');
    const op = planCellEdit(cell, days[dayIdx], sec, tz);
    switch (op.kind) {
      case 'none':
        return;
      case 'blocked':
        return fail(op.reason);
      case 'create':
        await run(() => api.addEntry({ description: row.description, projectId: row.projectId, start: op.start, end: op.end }));
        return;
      case 'resize':
        await run(() => api.updateEntry(op.id, { end: op.end }));
        return;
      case 'delete':
        await run(() => api.deleteEntry(op.id));
        return;
    }
  };

  const addRow = () => {
    if (!newDesc.trim() && !newProject) return;
    setExtra((x) => [...x, { projectId: newProject, description: newDesc.trim() }]);
    setNewDesc('');
  };

  return (
    <div className="ts">
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
          <strong className="cal-title">
            {days[0].split('-').reverse().slice(0, 2).join('.')} – {days[6].split('-').reverse().join('.')}
          </strong>
        </div>
        <span className="muted">
          Итого: <strong>{hm(grand) || '0:00'}</strong>
        </span>
      </div>

      <div className="ts-wrap">
        <table className="ts-table">
          <thead>
            <tr>
              <th className="ts-task">Задача</th>
              {days.map((d, i) => (
                <th key={d} className={d === today ? 'today' : ''}>
                  <span>{WD[i]}</span>
                  <strong>{Number(d.slice(8))}</strong>
                </th>
              ))}
              <th className="ts-total">Итого</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => {
              const p = r.projectId ? projects.get(r.projectId) : undefined;
              return (
                <tr key={r.key}>
                  <td className="ts-task">
                    <div className="ts-name">{r.description || <em className="muted">(без названия)</em>}</div>
                    <div className="ts-proj" style={{ color: p?.color }}>
                      <ProjectDot color={p?.color} size={8} /> {p?.name ?? 'Без проекта'}
                    </div>
                  </td>
                  {r.cells.map((c, di) => {
                    const locked = c.entries.length > 1 || c.entries.some((e) => e.end === null);
                    return (
                      <td key={days[di]} className={days[di] === today ? 'today' : ''}>
                        <input
                          key={`${r.key}${di}${c.seconds}`}
                          className={locked ? 'ts-cell locked' : 'ts-cell'}
                          defaultValue={hm(c.seconds)}
                          placeholder="–"
                          title={c.entries.length > 1 ? `${c.entries.length} записей — правьте в списке или календаре` : c.entries.some((e) => e.end === null) ? 'Идёт таймер' : ''}
                          onBlur={(e) => e.target.value !== hm(c.seconds) && void commit(ri, di, e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                          aria-label={`${r.description || 'Без названия'}, ${WD[di]}`}
                        />
                      </td>
                    );
                  })}
                  <td className="ts-total">{hm(r.totalSeconds) || '–'}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9}>
                  <Empty icon={<Table size={28} />} title="На этой неделе записей нет">
                    Добавьте строку ниже и вносите часы прямо в клетки.
                  </Empty>
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td className="ts-task">Итого за день</td>
              {colTotals.map((s, i) => (
                <td key={days[i]}>{hm(s) || '–'}</td>
              ))}
              <td className="ts-total">{hm(grand) || '–'}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="ts-add">
        <ProjectPicker projects={state.projects} value={newProject} onChange={setNewProject} />
        <input
          placeholder="Название задачи для новой строки"
          value={newDesc}
          onChange={(e) => setNewDesc(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addRow()}
        />
        <button className="btn subtle" onClick={addRow}>
          <Plus size={15} /> Добавить строку
        </button>
      </div>
      <p className="hint">Введите время в клетку (2:30, 2.5, 90m) и нажмите Enter. Пустая клетка удаляет запись. Клетки с несколькими записями правятся в списке.</p>
    </div>
  );
}
