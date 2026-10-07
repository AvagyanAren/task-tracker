import { entrySeconds } from './report.js';
import { dayKey, localToIso } from './time.js';
import type { Entry, State } from './types.js';

export interface TimesheetCell {
  seconds: number;
  entries: Entry[];
}

export interface TimesheetRow {
  key: string;
  projectId: string | null;
  description: string;
  cells: TimesheetCell[];
  totalSeconds: number;
}

export const rowKey = (projectId: string | null, description: string) =>
  `${projectId ?? ''}\u0000${description.trim().toLowerCase()}`;

/** Rows = distinct (project, task); columns = the 7 days of the week. */
export function buildTimesheet(
  state: State,
  days: string[],
  offsetMin: number,
  nowMs: number,
  extraRows: Array<{ projectId: string | null; description: string }> = []
): TimesheetRow[] {
  const rows = new Map<string, TimesheetRow>();
  const ensure = (projectId: string | null, description: string) => {
    const key = rowKey(projectId, description);
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        projectId,
        description: description.trim(),
        cells: days.map(() => ({ seconds: 0, entries: [] })),
        totalSeconds: 0
      };
      rows.set(key, row);
    }
    return row;
  };

  for (const e of state.entries) {
    const i = days.indexOf(dayKey(e.start, offsetMin));
    if (i < 0) continue;
    const row = ensure(e.projectId, e.description);
    const sec = entrySeconds(e, nowMs);
    row.cells[i].seconds += sec;
    row.cells[i].entries.push(e);
    row.totalSeconds += sec;
  }
  for (const x of extraRows) ensure(x.projectId, x.description);

  return [...rows.values()].sort((a, b) => b.totalSeconds - a.totalSeconds || a.description.localeCompare(b.description));
}

export type CellOp =
  | { kind: 'none' }
  | { kind: 'create'; start: string; end: string }
  | { kind: 'resize'; id: string; end: string }
  | { kind: 'delete'; id: string }
  | { kind: 'blocked'; reason: string };

/**
 * What to do so that one cell shows `seconds`. Cells with several entries or a
 * running timer are not edited here: merging them would silently lose detail.
 */
export function planCellEdit(cell: TimesheetCell, day: string, seconds: number, offsetMin: number): CellOp {
  if (cell.entries.some((e) => e.end === null)) {
    return { kind: 'blocked', reason: 'В этой клетке идёт таймер — остановите его.' };
  }
  if (cell.entries.length > 1) {
    return { kind: 'blocked', reason: 'В клетке несколько записей — правьте их в списке или календаре.' };
  }
  const [only] = cell.entries;
  if (!only) {
    if (seconds <= 0) return { kind: 'none' };
    const start = localToIso(day, '09:00', offsetMin);
    return { kind: 'create', start, end: new Date(Date.parse(start) + seconds * 1000).toISOString() };
  }
  if (seconds <= 0) return { kind: 'delete', id: only.id };
  if (seconds === entrySeconds(only, 0)) return { kind: 'none' };
  return { kind: 'resize', id: only.id, end: new Date(Date.parse(only.start) + seconds * 1000).toISOString() };
}
