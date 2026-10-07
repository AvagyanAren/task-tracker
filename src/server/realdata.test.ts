import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildReport, dayRangeToQuery } from '../shared/report.js';
import { importToggl } from './toggl.js';
import type { State } from '../shared/types.js';

/** Runs only when a real Toggl export is placed at data/toggl-sample.csv. */
const file = 'data/toggl-sample.csv';

describe.skipIf(!existsSync(file))('реальный экспорт Toggl', () => {
  const state: State = { projects: [], entries: [] };
  let summary: ReturnType<typeof importToggl>;
  beforeAll(() => {
    summary = importToggl(state, readFileSync(file, 'utf8'), 240);
  });
  const now = Date.parse('2026-10-06T00:00:00Z');

  it('все строки либо импортированы, либо осознанно пропущены', () => {
    expect(summary.newEntries + summary.zeroLength + summary.duplicates).toBe(summary.totalRows);
    expect(summary.duplicates).toBe(0);
  });

  it('проекты совпадают с Toggl', () => {
    expect(state.projects.map((p) => p.name).sort()).toEqual(['Aviator', 'PharmaB2B', 'SFIT']);
  });

  it('SFIT за всё время ≈ 416.7 ч (как в Toggl)', () => {
    const sfit = state.projects.find((p) => p.name === 'SFIT')!;
    const r = buildReport(state, { ...dayRangeToQuery('2000-01-01', '2100-01-01', 240), projectId: sfit.id }, now, 240);
    expect(r.totalSeconds / 3600).toBeGreaterThan(416.6);
    expect(r.totalSeconds / 3600).toBeLessThan(416.8);
  });

  it('SFIT с 18.09 = 65ч 13м (с точностью до секунд записей) и деньги по ставке', () => {
    const sfit = state.projects.find((p) => p.name === 'SFIT')!;
    sfit.rate = 20;
    sfit.currency = '$';
    const r = buildReport(state, { ...dayRangeToQuery('2026-09-18', '2026-10-05', 240), projectId: sfit.id }, now, 240);
    // 65ч 13м как в списке, плюс секунды, которые Toggl хранит в записях (03:00:29 и т.п.)
    expect(Math.abs(r.totalSeconds / 60 - (65 * 60 + 13))).toBeLessThan(1.5);
    expect(r.amountByCurrency['$']).toBe(Math.round((r.totalSeconds / 3600) * 20 * 100) / 100);
  });

  it('повторный импорт того же файла ничего не добавляет', () => {
    const again = importToggl(state, readFileSync(file, 'utf8'), 240);
    expect(again.newEntries).toBe(0);
    expect(again.duplicates).toBe(summary.newEntries);
  });
});
