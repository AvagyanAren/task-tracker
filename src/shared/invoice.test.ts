import { describe, expect, it } from 'vitest';
import {
  buildInvoiceLines,
  formatInvoiceDate,
  formatInvoiceMoney,
  formatInvoiceNumber,
  invoiceTotal,
  lineAmount,
  nextCounterAfter
} from './invoice.js';
import type { State } from './types.js';

const iso = (h: number, m = 0, day = 10) => new Date(Date.UTC(2026, 8, day, h, m)).toISOString();

const state: State = {
  projects: [
    { id: 'p1', name: 'SFIT', rate: 25, currency: '$', color: '#000', archived: false, createdAt: iso(0) },
    { id: 'p2', name: 'Other', rate: 40, currency: '€', color: '#111', archived: false, createdAt: iso(0) }
  ],
  entries: [
    { id: 'a', description: 'Mobile', projectId: 'p1', tags: [], billable: true, start: iso(8), end: iso(10, 20) },
    { id: 'b', description: 'Mobile', projectId: 'p1', tags: [], billable: true, start: iso(11), end: iso(12) },
    { id: 'c', description: 'Payments', projectId: 'p1', tags: [], billable: true, start: iso(13), end: iso(14, 20) },
    { id: 'd', description: 'Internal', projectId: 'p1', tags: [], billable: false, start: iso(15), end: iso(16) },
    { id: 'e', description: 'Elsewhere', projectId: 'p2', tags: [], billable: true, start: iso(8), end: iso(9) }
  ]
} as State;

const query = { from: iso(0, 0, 1), to: iso(0, 0, 30) };

describe('инвойс', () => {
  it('одна строка на задачу, только оплачиваемое и только выбранный проект', () => {
    const r = buildInvoiceLines(state, query, 'p1', Date.now(), 0)!;
    expect(r.currency).toBe('$');
    expect(r.lines.map((l) => [l.description, l.seconds])).toEqual(
      expect.arrayContaining([
        ['Mobile', 3 * 3600 + 20 * 60],
        ['Payments', 3600 + 20 * 60]
      ])
    );
    expect(r.lines).toHaveLength(2);
  });

  it('сумма строки = часы (2 знака) × ставка, итог = сумма строк', () => {
    expect(lineAmount(3 * 3600 + 20 * 60, 25)).toEqual({ hours: 3.33, amount: 83.25 });
    const r = buildInvoiceLines(state, query, 'p1', Date.now(), 0)!;
    expect(invoiceTotal(r.lines)).toBe(83.25 + 33.25);
  });

  it('ставка может быть изменена только для этого инвойса', () => {
    const r = buildInvoiceLines(state, query, 'p1', Date.now(), 0, 30)!;
    expect(r.rate).toBe(30);
    expect(state.projects[0].rate).toBe(25);
    expect(r.lines.every((l) => l.rate === 30)).toBe(true);
  });

  it('неизвестный проект даёт null', () => {
    expect(buildInvoiceLines(state, query, 'nope', Date.now(), 0)).toBeNull();
  });

  it('нумерация и форматирование', () => {
    expect(formatInvoiceNumber(2026, 7)).toBe('INV-2026-007');
    expect(nextCounterAfter('INV-2026-007', 2026)).toBe(8);
    expect(nextCounterAfter('СЧЁТ-1', 2026)).toBeNull();
    expect(formatInvoiceDate('2026-09-30', 'ru')).toBe('30.09.2026');
    expect(formatInvoiceDate('2026-09-03', 'en')).toBe('3 Sep 2026');
    expect(formatInvoiceMoney(1234.5, '$', 'en')).toBe('$1,234.50');
    expect(formatInvoiceMoney(1234.5, '$', 'ru')).toBe('1 234,50 $');
  });
});
