import { describe, expect, it } from 'vitest';
import { advance, DEFAULT_POMODORO, formatCountdown, phaseEnd, remainingMs, startSession, type PomodoroSession } from './pomodoro.js';
import { onUserState, promptApplies } from './idle.js';
import { groupSimilar, similarKey } from './group.js';
import { daySeconds, layoutDay, snap, weekDays, weekStart } from './calendar.js';
import { buildTimesheet, planCellEdit, rowKey } from './timesheet.js';
import type { Entry, State } from './types.js';

const e = (id: string, start: string, end: string | null, over: Partial<Entry> = {}): Entry => ({
  id, description: 'Задача', projectId: 'p', tags: [], billable: true, start, end, ...over
});

describe('Pomodoro', () => {
  const cfg = DEFAULT_POMODORO;
  it('25 минут работы, потом короткий перерыв, на 4-м — длинный, дальше решает человек', () => {
    let s: PomodoroSession | null = startSession(1_000);
    expect(remainingMs(s, cfg, 1_000)).toBe(25 * 60_000);
    expect(remainingMs(s, cfg, 1_000 + 26 * 60_000)).toBe(0);

    const out: Array<[string, boolean | undefined]> = [];
    for (let i = 0; i < 4; i++) {
      s = advance(s!, cfg)!; // work -> break
      out.push([s.phase, s.long]);
      s = advance(s, cfg) ? advance(s, cfg) : null; // break -> null
      s = startSession(1_000);
      s = { ...s, cycle: i + 1 };
    }
    expect(out.map((x) => x[1])).toEqual([false, false, false, true]);
  });

  it('перерыв начинается ровно там, где закончилась работа (не «сейчас»)', () => {
    const s = startSession(0);
    const br = advance(s, cfg)!;
    expect(br).toMatchObject({ phase: 'break', phaseStart: 25 * 60_000, cycle: 1 });
    expect(phaseEnd(br, cfg)).toBe(30 * 60_000);
    expect(advance(br, cfg)).toBeNull();
  });

  it('обратный отсчёт', () => {
    expect(formatCountdown(25 * 60_000)).toBe('25:00');
    expect(formatCountdown(59_001)).toBe('01:00');
    expect(formatCountdown(0)).toBe('00:00');
  });
});

describe('простой', () => {
  const T = 5 * 60_000;
  it('возврат после простоя даёт подсказку с началом простоя', () => {
    const now0 = 10_000_000;
    const a = onUserState({ idleSince: null }, 'idle', now0, T);
    expect(a.tracker.idleSince).toBe(now0 - T);
    const b = onUserState(a.tracker, 'active', now0 + 20 * 60_000, T);
    expect(b.prompt).toEqual({ idleStartMs: now0 - T, idleMs: 25 * 60_000 });
    expect(b.tracker.idleSince).toBeNull();
  });
  it('активность без простоя ничего не спрашивает', () => {
    expect(onUserState({ idleSince: null }, 'active', 1, T).prompt).toBeNull();
  });
  it('простой до старта таймера или короче минуты игнорируется', () => {
    expect(promptApplies({ idleStartMs: 100, idleMs: 600_000 }, 200)).toBe(false);
    expect(promptApplies({ idleStartMs: 500, idleMs: 30_000 }, 200)).toBe(false);
    expect(promptApplies({ idleStartMs: 500, idleMs: 600_000 }, 200)).toBe(true);
  });
});

describe('группировка похожих записей', () => {
  const list = [
    e('1', '2026-09-22T12:00:00Z', '2026-09-22T13:00:00Z', { description: 'Mobile' }),
    e('2', '2026-09-22T10:00:00Z', '2026-09-22T11:00:00Z', { description: 'mobile ' }),
    e('3', '2026-09-22T09:00:00Z', '2026-09-22T09:30:00Z', { description: 'Other' }),
    e('4', '2026-09-22T08:00:00Z', '2026-09-22T08:30:00Z', { description: 'Mobile', billable: false }),
    e('5', '2026-09-22T07:00:00Z', null, { description: 'Mobile' })
  ];
  it('регистр и пробелы не мешают; billable и тег различают; идущая запись не склеивается', () => {
    const g = groupSimilar(list);
    expect(g.map((x) => x.entries.map((y) => y.id))).toEqual([['1', '2'], ['3'], ['4'], ['5']]);
    expect(similarKey(list[0])).toBe(similarKey(list[1]));
    expect(similarKey({ ...list[0], tags: ['a'] })).not.toBe(similarKey(list[0]));
  });
});

describe('календарь', () => {
  it('неделя начинается с понедельника', () => {
    expect(weekStart('2026-10-07')).toBe('2026-10-05');
    expect(weekStart('2026-10-11')).toBe('2026-10-05');
    expect(weekDays('2026-10-05')).toHaveLength(7);
    expect(weekDays('2026-10-05')[6]).toBe('2026-10-11');
  });

  it('запись через полночь режется по дням, сумма сохраняется', () => {
    const tz = 240;
    const night = e('n', '2026-09-22T19:00:00Z', '2026-09-22T21:00:00Z'); // 23:00–01:00 по UTC+4
    const d1 = layoutDay([night], '2026-09-22', tz, 0);
    const d2 = layoutDay([night], '2026-09-23', tz, 0);
    expect(d1[0]).toMatchObject({ startMin: 23 * 60, endMin: 24 * 60 });
    expect(d2[0]).toMatchObject({ startMin: 0, endMin: 60 });
    expect(daySeconds([night], '2026-09-22', tz, 0) + daySeconds([night], '2026-09-23', tz, 0)).toBe(7200);
  });

  it('пересекающиеся записи встают в соседние колонки, непересекающиеся — нет', () => {
    const a = e('a', '2026-09-22T08:00:00Z', '2026-09-22T10:00:00Z');
    const b = e('b', '2026-09-22T09:00:00Z', '2026-09-22T11:00:00Z');
    const c = e('c', '2026-09-22T12:00:00Z', '2026-09-22T13:00:00Z');
    const blocks = layoutDay([a, b, c], '2026-09-22', 0, 0);
    const by = Object.fromEntries(blocks.map((x) => [x.entryId, x]));
    expect(by.a).toMatchObject({ lane: 0, lanes: 2 });
    expect(by.b).toMatchObject({ lane: 1, lanes: 2 });
    expect(by.c).toMatchObject({ lane: 0, lanes: 1 });
  });

  it('идущий таймер тянется до «сейчас»; чужой день пуст', () => {
    const run = e('r', '2026-09-22T08:00:00Z', null);
    const now = Date.parse('2026-09-22T09:30:00Z');
    expect(layoutDay([run], '2026-09-22', 0, now)[0]).toMatchObject({ running: true, endMin: 9 * 60 + 30 });
    expect(layoutDay([run], '2026-09-23', 0, now)).toEqual([]);
  });

  it('привязка к сетке 15 минут', () => {
    expect(snap(7)).toBe(0);
    expect(snap(8)).toBe(15);
    expect(snap(61)).toBe(60);
  });
});

describe('timesheet', () => {
  const days = weekDays('2026-09-21');
  const state: State = {
    projects: [],
    entries: [
      e('1', '2026-09-22T08:00:00Z', '2026-09-22T10:00:00Z', { description: 'Mobile' }),
      e('2', '2026-09-22T11:00:00Z', '2026-09-22T12:00:00Z', { description: 'mobile' }),
      e('3', '2026-09-24T08:00:00Z', '2026-09-24T09:30:00Z', { description: 'Mobile' }),
      e('4', '2026-09-23T08:00:00Z', '2026-09-23T09:00:00Z', { description: 'Платежи' }),
      e('5', '2026-10-30T08:00:00Z', '2026-10-30T09:00:00Z', { description: 'Вне недели' })
    ]
  };
  const rows = buildTimesheet(state, days, 0, 0);

  it('строки по задачам (без учёта регистра), клетки по дням, суммы', () => {
    expect(rows.map((r) => r.description)).toEqual(['Mobile', 'Платежи']);
    expect(rows[0].cells[1].seconds).toBe(3 * 3600); // вторник: 2ч + 1ч
    expect(rows[0].cells[3].seconds).toBe(5400); // четверг
    expect(rows[0].totalSeconds).toBe(3 * 3600 + 5400);
  });

  it('пустая добавленная строка видна', () => {
    const r = buildTimesheet(state, days, 0, 0, [{ projectId: 'p', description: 'Новая' }]);
    expect(r.find((x) => x.description === 'Новая')!.totalSeconds).toBe(0);
    expect(rowKey('p', ' Новая ')).toBe(rowKey('p', 'новая'));
  });

  it('правка клетки: создать, изменить, удалить, ничего не менять', () => {
    expect(planCellEdit({ seconds: 0, entries: [] }, '2026-09-25', 7200, 0)).toEqual({
      kind: 'create', start: '2026-09-25T09:00:00.000Z', end: '2026-09-25T11:00:00.000Z'
    });
    expect(planCellEdit({ seconds: 0, entries: [] }, '2026-09-25', 0, 0)).toEqual({ kind: 'none' });
    const one = rows[0].cells[3];
    expect(planCellEdit(one, days[3], 7200, 0)).toEqual({ kind: 'resize', id: '3', end: '2026-09-24T10:00:00.000Z' });
    expect(planCellEdit(one, days[3], 0, 0)).toEqual({ kind: 'delete', id: '3' });
    expect(planCellEdit(one, days[3], 5400, 0)).toEqual({ kind: 'none' });
  });

  it('клетка с несколькими записями или с таймером не правится (нет потери данных)', () => {
    expect(planCellEdit(rows[0].cells[1], days[1], 3600, 0).kind).toBe('blocked');
    const running = { seconds: 10, entries: [e('r', '2026-09-22T08:00:00Z', null)] };
    expect(planCellEdit(running, days[1], 3600, 0).kind).toBe('blocked');
  });
});
