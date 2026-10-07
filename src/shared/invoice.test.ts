import { blank } from './blank.js';
import { describe, expect, it } from 'vitest';
import {
  buildInvoiceLines,
  collectBillableLines,
  computeTotals,
  countInvoiced,
  displayStatus,
  formatInvoiceDate,
  formatInvoiceMoney,
  formatInvoiceNumber,
  invoiceTotal,
  lineAmount,
  nextCounterAfter,
  nextInvoiceNumber,
  roundSeconds
} from './invoice.js';
import type { State } from './types.js';

const iso = (h: number, m = 0, day = 10) => new Date(Date.UTC(2026, 8, day, h, m)).toISOString();

const state: State = {
  ...blank(),
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

describe('округление, скидка и налог', () => {
  it('округляет время вверх до шага', () => {
    expect(roundSeconds(50 * 60, '15')).toBe(60 * 60);
    expect(roundSeconds(60 * 60, '15')).toBe(60 * 60);
    expect(roundSeconds(61 * 60, '30')).toBe(90 * 60);
    expect(roundSeconds(10, 'none')).toBe(10);
  });
  it('считает итог: сумма, скидка с суммы, налог с остатка', () => {
    expect(computeTotals([{ amount: 100 }, { amount: 50 }], 10, 20)).toEqual({ subtotal: 150, discount: 15, tax: 27, total: 162 });
    expect(computeTotals([{ amount: 33.33 }], 0, 0).total).toBe(33.33);
    expect(computeTotals([{ amount: 100 }], 150, -5)).toMatchObject({ discount: 100, tax: 0, total: 0 }); // проценты зажаты в 0–100
  });
  it('следующий номер счёта не повторяет и не прыгает назад', () => {
    expect(nextInvoiceNumber([], 2026)).toBe('INV-2026-001');
    expect(nextInvoiceNumber(['INV-2026-001', 'INV-2026-007', 'своё', 'INV-2025-099'], 2026)).toBe('INV-2026-008');
  });
  it('просроченным считается только отправленный счёт с прошедшим сроком', () => {
    expect(displayStatus({ status: 'sent', dueDate: '2026-09-01' }, '2026-09-10')).toBe('overdue');
    expect(displayStatus({ status: 'paid', dueDate: '2026-09-01' }, '2026-09-10')).toBe('paid');
    expect(displayStatus({ status: 'draft', dueDate: '2026-09-01' }, '2026-09-10')).toBe('draft');
    expect(displayStatus({ status: 'sent', dueDate: '2026-09-10' }, '2026-09-10')).toBe('sent');
  });
  it('собирает строки по проектам, пропуская уже выставленное', () => {
    const s: State = {
      ...blank(),
      projects: [
        { id: 'a', name: 'A', rate: 10, currency: '$', color: '#000', archived: false, createdAt: iso(0) },
        { id: 'b', name: 'B', rate: 20, currency: '$', color: '#000', archived: false, createdAt: iso(0) }
      ],
      entries: [
        { id: '1', description: 'Дизайн', projectId: 'a', tags: [], billable: true, start: iso(8), end: iso(9, 20) },
        { id: '2', description: 'Дизайн', projectId: 'a', tags: [], billable: true, start: iso(10), end: iso(11) },
        { id: '3', description: 'Звонок', projectId: 'b', tags: [], billable: true, start: iso(12), end: iso(13), invoiceId: 'x' },
        { id: '4', description: 'Личное', projectId: 'a', tags: [], billable: false, start: iso(14), end: iso(15) }
      ]
    };
    const q = { from: iso(0), to: iso(23) };
    const lines = collectBillableLines(s, q, ['a', 'b'], Date.now(), 'none');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ projectId: 'a', description: 'Дизайн', hours: 2.33, entryIds: ['1', '2'] });
    expect(collectBillableLines(s, q, ['a', 'b'], Date.now(), '30')[0].hours).toBe(2.5);
    expect(collectBillableLines(s, q, ['a', 'b'], Date.now(), 'none', false)).toHaveLength(2);
    expect(countInvoiced(s, q, ['a', 'b'])).toBe(1);
  });
});
