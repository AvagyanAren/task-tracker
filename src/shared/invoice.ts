import { buildReport, entrySeconds, filterEntries, type ReportQuery } from './report.js';
import type { State } from './types.js';

export type Lang = 'ru' | 'en';

export interface InvoiceLine {
  /** Stable key (task text + project) so edits survive re-renders. */
  key: string;
  description: string;
  seconds: number;
  /** Decimal hours rounded to 2 places: what the client can verify with a calculator. */
  hours: number;
  rate: number;
  amount: number;
}

export interface InvoiceLines {
  projectId: string;
  currency: string;
  rate: number;
  lines: InvoiceLine[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Amount of one line: hours (2 decimals) x rate, so the paper adds up exactly. */
export function lineAmount(seconds: number, rate: number): { hours: number; amount: number } {
  const hours = round2(seconds / 3600);
  return { hours, amount: round2(hours * rate) };
}

export function invoiceTotal(lines: Array<{ amount: number }>): number {
  return round2(lines.reduce((n, l) => n + l.amount, 0));
}

/**
 * Billable work of one project in the period, one line per task text.
 * Only billable entries are invoiced; `rateOverride` replaces the project's rate on this invoice only.
 */
export function buildInvoiceLines(
  state: State,
  query: ReportQuery,
  projectId: string,
  nowMs: number,
  offsetMin: number,
  rateOverride?: number
): InvoiceLines | null {
  const project = state.projects.find((p) => p.id === projectId);
  if (!project) return null;
  const rate = rateOverride ?? project.rate;
  const report = buildReport(state, { ...query, projectId, billable: true }, nowMs, offsetMin);
  const lines = report.byTask
    .filter((t) => t.projectId === projectId && t.seconds > 0)
    .map((t) => ({
      key: `${projectId}|${t.description}`,
      description: t.description,
      seconds: t.seconds,
      rate,
      ...lineAmount(t.seconds, rate)
    }));
  return { projectId, currency: project.currency, rate, lines };
}

/** INV-2026-007 */
export function formatInvoiceNumber(year: number, n: number): string {
  return `INV-${year}-${String(n).padStart(3, '0')}`;
}

/** Counter value that follows an invoice number made by `formatInvoiceNumber`, else null. */
export function nextCounterAfter(number: string, year: number): number | null {
  const m = new RegExp(`^INV-${year}-(\\d+)$`).exec(number.trim());
  return m ? Number(m[1]) + 1 : null;
}

const SYMBOLS_BEFORE = new Set(['$', '€', '£']);

export function formatInvoiceMoney(amount: number, currency: string, lang: Lang): string {
  const n = amount.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (!currency) return n;
  return lang === 'en' && SYMBOLS_BEFORE.has(currency) ? `${currency}${n}` : `${n} ${currency}`;
}

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-09-30" -> "30.09.2026" (ru) or "30 Sep 2026" (en). */
export function formatInvoiceDate(day: string, lang: Lang): string {
  const [y, m, d] = day.split('-');
  if (!y || !m || !d) return day;
  return lang === 'ru' ? `${d}.${m}.${y}` : `${Number(d)} ${MONTHS_EN[Number(m) - 1]} ${y}`;
}

export function formatInvoiceHours(hours: number, lang: Lang): string {
  return hours.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ---------------- invoices built from entries ---------------- */

/** How tracked time is rounded before it is billed: up to the next 15 / 30 / 60 minutes, or not at all. */
export type Rounding = 'none' | '15' | '30' | '60';

export function roundSeconds(seconds: number, rounding: Rounding): number {
  if (rounding === 'none') return seconds;
  const step = Number(rounding) * 60;
  return Math.ceil(seconds / step) * step;
}

export interface Totals {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}

/** Subtotal, then discount on it, then tax on what is left: the order printed on the paper. */
export function computeTotals(lines: Array<{ amount: number }>, discountPct: number, taxPct: number): Totals {
  const subtotal = invoiceTotal(lines);
  const discount = round2((subtotal * Math.max(0, Math.min(100, discountPct))) / 100);
  const taxable = round2(subtotal - discount);
  const tax = round2((taxable * Math.max(0, Math.min(100, taxPct))) / 100);
  return { subtotal, discount, tax, total: round2(taxable + tax) };
}

export interface BillableLine {
  key: string;
  projectId: string;
  projectName: string;
  description: string;
  seconds: number;
  entryIds: string[];
  rate: number;
  hours: number;
  amount: number;
}

/**
 * Billable, not yet invoiced work of the given projects in the period, one line per
 * project + task text. `skipInvoiced: false` also brings back entries already on an invoice.
 */
export function collectBillableLines(
  state: State,
  query: ReportQuery,
  projectIds: string[],
  nowMs: number,
  rounding: Rounding,
  skipInvoiced = true
): BillableLine[] {
  const ids = new Set(projectIds);
  const byKey = new Map<string, BillableLine>();
  for (const e of filterEntries(state, { ...query, projectId: null, billable: true })) {
    if (!e.projectId || !ids.has(e.projectId) || (skipInvoiced && e.invoiceId)) continue;
    const project = state.projects.find((p) => p.id === e.projectId);
    if (!project) continue;
    const description = e.description.trim();
    const key = `${e.projectId}|${description}`;
    const line =
      byKey.get(key) ??
      ({ key, projectId: project.id, projectName: project.name, description, seconds: 0, entryIds: [], rate: project.rate, hours: 0, amount: 0 } as BillableLine);
    line.seconds += entrySeconds(e, nowMs);
    line.entryIds.push(e.id);
    byKey.set(key, line);
  }
  return [...byKey.values()]
    .map((l) => {
      const { hours, amount } = lineAmount(roundSeconds(l.seconds, rounding), l.rate);
      return { ...l, hours, amount };
    })
    .filter((l) => l.hours > 0) // a few seconds round to 0.00 h: nothing to bill
    .sort((a, b) => a.projectName.localeCompare(b.projectName) || a.description.localeCompare(b.description));
}

/** Number of entries in the period that are billable but already on an invoice. */
export function countInvoiced(state: State, query: ReportQuery, projectIds: string[]): number {
  const ids = new Set(projectIds);
  return filterEntries(state, { ...query, projectId: null, billable: true }).filter((e) => e.projectId && ids.has(e.projectId) && e.invoiceId).length;
}

/** Next free INV-YYYY-NNN: one more than the highest used this year, so numbers never repeat or skip back. */
export function nextInvoiceNumber(existing: string[], year: number): string {
  let max = 0;
  for (const n of existing) {
    const next = nextCounterAfter(n, year);
    if (next !== null) max = Math.max(max, next - 1);
  }
  return formatInvoiceNumber(year, max + 1);
}

/** "Overdue" is derived: sent and past the due date. */
export type InvoiceDisplayStatus = 'draft' | 'sent' | 'overdue' | 'paid';
export function displayStatus(inv: { status: 'draft' | 'sent' | 'paid'; dueDate: string }, today: string): InvoiceDisplayStatus {
  return inv.status === 'sent' && inv.dueDate < today ? 'overdue' : inv.status;
}
