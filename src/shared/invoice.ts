import { buildReport, type ReportQuery } from './report.js';
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
