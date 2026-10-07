import { blank } from './blank.js';
import { describe, expect, it } from 'vitest';
import { buildReport, dayRangeToQuery, entrySeconds, presetRange } from './report.js';
import type { State } from './types.js';

const TZ = 240; // UTC+4
const state: State = {
  ...blank(),
  projects: [
    { id: 'p1', name: 'SFIT', rate: 25, currency: '$', color: '#fff', archived: false, createdAt: '' },
    { id: 'p2', name: 'Aviator', rate: 1000, currency: '₽', color: '#fff', archived: false, createdAt: '' }
  ],
  entries: [
    // 18.09 local: 8h SFIT
    { id: 'a', description: 'Overview', projectId: 'p1', tags: [], billable: true, start: '2026-09-18T07:51:00.000Z', end: '2026-09-18T15:51:00.000Z' },
    // 22.09: 4h40 + 4h SFIT, same task twice
    { id: 'b', description: 'Mobile', projectId: 'p1', tags: [], billable: true, start: '2026-09-22T07:40:00.000Z', end: '2026-09-22T12:20:00.000Z' },
    { id: 'c', description: 'mobile', projectId: 'p1', tags: [], billable: true, start: '2026-09-22T12:25:00.000Z', end: '2026-09-22T16:25:00.000Z' },
    // other project, other currency
    { id: 'd', description: 'Design', projectId: 'p2', tags: [], billable: true, start: '2026-09-22T05:00:00.000Z', end: '2026-09-22T07:30:00.000Z' },
    // no project
    { id: 'e', description: 'Misc', projectId: null, tags: [], billable: true, start: '2026-09-23T05:00:00.000Z', end: '2026-09-23T06:00:00.000Z' },
    // outside range
    { id: 'f', description: 'Old', projectId: 'p1', tags: [], billable: true, start: '2026-08-01T05:00:00.000Z', end: '2026-08-01T06:00:00.000Z' }
  ]
};
const range = dayRangeToQuery('2026-09-18', '2026-09-30', TZ);
const NOW = Date.parse('2026-10-06T00:00:00.000Z');

describe('отчёт', () => {
  const r = buildReport(state, range, NOW, TZ);

  it('часы и деньги по проектам считаются по ставке', () => {
    const sfit = r.byProject.find((x) => x.name === 'SFIT')!;
    expect(sfit.seconds).toBe(8 * 3600 + 16800 + 14400);
    expect(sfit.amount).toBe(Math.round(((8 * 3600 + 16800 + 14400) / 3600) * 25 * 100) / 100);
    const av = r.byProject.find((x) => x.name === 'Aviator')!;
    expect(av.amount).toBe(2500);
  });

  it('валюты не складываются, записи без проекта бесплатны', () => {
    expect(Object.keys(r.amountByCurrency).sort()).toEqual(['$', '₽']);
    expect(r.byProject.find((x) => x.projectId === null)!.amount).toBe(0);
    expect(r.entryCount).toBe(5);
  });

  it('запись вне периода не учитывается', () => {
    expect(r.byProject.reduce((n, x) => n + x.entries, 0)).toBe(5);
  });

  it('одинаковые задачи объединяются без учёта регистра', () => {
    const t = r.byTask.filter((x) => x.projectId === 'p1' && x.description.toLowerCase() === 'mobile');
    expect(t).toHaveLength(1);
    expect(t[0].seconds).toBe(16800 + 14400);
  });

  it('по дням: день по локальному времени, новые сверху', () => {
    expect(r.byDay.map((d) => d.day)).toEqual(['2026-09-23', '2026-09-22', '2026-09-18']);
    expect(r.byDay.find((d) => d.day === '2026-09-18')!.seconds).toBe(8 * 3600);
  });

  it('фильтр по проекту и «без проекта»', () => {
    expect(buildReport(state, { ...range, projectId: 'p2' }, NOW, TZ).entryCount).toBe(1);
    expect(buildReport(state, { ...range, projectId: 'none' }, NOW, TZ).entryCount).toBe(1);
  });

  it('границы: конец периода не включается, начало включается', () => {
    const edge = dayRangeToQuery('2026-09-18', '2026-09-18', TZ);
    const only18 = buildReport(state, edge, NOW, TZ);
    expect(only18.entryCount).toBe(1);
  });

  it('идущий таймер считается до «сейчас»', () => {
    const running = { id: 'x', description: '', projectId: 'p1', tags: [], billable: true, start: '2026-10-05T20:00:00.000Z', end: null };
    expect(entrySeconds(running, Date.parse('2026-10-05T22:30:00.000Z'))).toBe(9000);
  });
});

describe('периоды', () => {
  const now = Date.parse('2026-10-07T10:00:00.000Z'); // среда
  it('неделя с понедельника по воскресенье', () => {
    expect(presetRange('week', now, 0)).toEqual({ fromDay: '2026-10-05', toDay: '2026-10-11' });
    expect(presetRange('lastWeek', now, 0)).toEqual({ fromDay: '2026-09-28', toDay: '2026-10-04' });
  });
  it('месяцы, включая январь/декабрь', () => {
    expect(presetRange('month', now, 0)).toEqual({ fromDay: '2026-10-01', toDay: '2026-10-31' });
    expect(presetRange('lastMonth', now, 0)).toEqual({ fromDay: '2026-09-01', toDay: '2026-09-30' });
    expect(presetRange('lastMonth', Date.parse('2026-01-15T00:00:00Z'), 0)).toEqual({ fromDay: '2025-12-01', toDay: '2025-12-31' });
    expect(presetRange('month', Date.parse('2026-12-15T00:00:00Z'), 0).toDay).toBe('2026-12-31');
  });
  it('«сегодня» учитывает часовой пояс', () => {
    expect(presetRange('today', Date.parse('2026-10-06T21:00:00Z'), 240).fromDay).toBe('2026-10-07');
  });
});

describe('billable, теги и фильтры', () => {
  const st: State = {
    ...blank(),
    projects: [{ id: 'p', name: 'P', rate: 100, currency: '$', color: '#fff', archived: false, createdAt: '' }],
    entries: [
      { id: '1', description: 'Дизайн экрана', projectId: 'p', tags: ['ui'], billable: true, start: '2026-09-22T08:00:00.000Z', end: '2026-09-22T10:00:00.000Z' },
      { id: '2', description: 'Созвон', projectId: 'p', tags: ['meeting'], billable: false, start: '2026-09-22T11:00:00.000Z', end: '2026-09-22T12:00:00.000Z' },
      { id: '3', description: 'Правки', projectId: 'p', tags: ['UI', 'fix'], billable: true, start: '2026-09-23T08:00:00.000Z', end: '2026-09-23T09:00:00.000Z' }
    ]
  };
  const q = dayRangeToQuery('2026-09-01', '2026-09-30', 0);

  it('деньги только за billable, часы — за всё', () => {
    const r = buildReport(st, q, NOW, 0);
    expect(r.totalSeconds).toBe(4 * 3600);
    expect(r.billableSeconds).toBe(3 * 3600);
    expect(r.amountByCurrency['$']).toBe(300);
  });

  it('фильтры по тегу (без учёта регистра), billable и тексту', () => {
    expect(buildReport(st, { ...q, tags: ['ui'] }, NOW, 0).entryCount).toBe(2);
    expect(buildReport(st, { ...q, tags: ['meeting', 'fix'] }, NOW, 0).entryCount).toBe(2);
    expect(buildReport(st, { ...q, billable: false }, NOW, 0).entryCount).toBe(1);
    expect(buildReport(st, { ...q, search: 'ПРАВКИ' }, NOW, 0).entryCount).toBe(1);
    expect(buildReport(st, { ...q, tags: ['ui'], billable: true, search: 'экран' }, NOW, 0).entryCount).toBe(1);
  });
});
