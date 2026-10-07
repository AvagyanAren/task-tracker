import { addDays, dayKey, localToIso } from './time.js';
import type { Entry, Project, State } from './types.js';

export function entrySeconds(e: Entry, nowMs: number): number {
  const end = e.end ? Date.parse(e.end) : nowMs;
  return Math.max(0, Math.floor((end - Date.parse(e.start)) / 1000));
}

export interface ProjectRow {
  projectId: string | null;
  name: string;
  currency: string;
  rate: number;
  seconds: number;
  amount: number;
  entries: number;
}

export interface TaskRow {
  projectId: string | null;
  projectName: string;
  description: string;
  seconds: number;
  amount: number;
  currency: string;
}

export interface DayRow {
  day: string;
  seconds: number;
  amountByCurrency: Record<string, number>;
}

export interface Report {
  totalSeconds: number;
  billableSeconds: number;
  /** Money cannot be added across currencies, so it is kept per currency. */
  amountByCurrency: Record<string, number>;
  byProject: ProjectRow[];
  byTask: TaskRow[];
  byDay: DayRow[];
  entryCount: number;
}

export interface ReportQuery {
  /** Inclusive start / exclusive end, ISO instants. */
  from: string;
  to: string;
  projectId?: string | 'none' | null;
  /** Keep entries that carry ANY of these tags. */
  tags?: string[];
  billable?: boolean | null;
  /** Case-insensitive text in the description. */
  search?: string;
}

/** Entries of the period after all filters (shared by every report and export). */
export function filterEntries(state: State, q: ReportQuery): Entry[] {
  const fromMs = Date.parse(q.from);
  const toMs = Date.parse(q.to);
  const needle = (q.search ?? '').trim().toLowerCase();
  const tags = (q.tags ?? []).map((t) => t.toLowerCase());
  return state.entries.filter((e) => {
    const s = Date.parse(e.start);
    if (!(s >= fromMs && s < toMs)) return false;
    if (q.projectId === 'none' && e.projectId !== null) return false;
    if (q.projectId && q.projectId !== 'none' && e.projectId !== q.projectId) return false;
    if (q.billable === true && !e.billable) return false;
    if (q.billable === false && e.billable) return false;
    if (tags.length && !e.tags.some((t) => tags.includes(t.toLowerCase()))) return false;
    if (needle && !e.description.toLowerCase().includes(needle)) return false;
    return true;
  });
}

const money = (n: number) => Math.round(n * 100) / 100;

/**
 * Sums time and money for entries that START inside [from, to).
 * An entry that crosses midnight counts fully on the day it started.
 */
export function buildReport(state: State, q: ReportQuery, nowMs: number, offsetMin: number): Report {
  const projects = new Map<string, Project>(state.projects.map((p) => [p.id, p]));
  const picked = filterEntries(state, q);

  const rows = new Map<string, ProjectRow>();
  const tasks = new Map<string, TaskRow>();
  const days = new Map<string, DayRow>();
  const totals: Record<string, number> = {};
  let totalSeconds = 0;
  let billableSeconds = 0;

  for (const e of picked) {
    const seconds = entrySeconds(e, nowMs);
    const p = e.projectId ? projects.get(e.projectId) : undefined;
    const rate = p?.rate ?? 0;
    const currency = p?.currency ?? '';
    // Only billable time earns money.
    const amount = e.billable ? (seconds / 3600) * rate : 0;
    const pid = e.projectId ?? '';

    totalSeconds += seconds;
    if (e.billable) billableSeconds += seconds;
    if (amount > 0) totals[currency] = (totals[currency] ?? 0) + amount;

    const row = rows.get(pid) ?? {
      projectId: e.projectId,
      name: p?.name ?? 'Без проекта',
      currency,
      rate,
      seconds: 0,
      amount: 0,
      entries: 0
    };
    row.seconds += seconds;
    row.amount += amount;
    row.entries += 1;
    rows.set(pid, row);

    const desc = e.description.trim() || '(без названия)';
    const tkey = `${pid}\u0000${desc.toLowerCase()}`;
    const t = tasks.get(tkey) ?? {
      projectId: e.projectId,
      projectName: row.name,
      description: desc,
      seconds: 0,
      amount: 0,
      currency
    };
    t.seconds += seconds;
    t.amount += amount;
    tasks.set(tkey, t);

    const day = dayKey(e.start, offsetMin);
    const d = days.get(day) ?? { day, seconds: 0, amountByCurrency: {} };
    d.seconds += seconds;
    if (amount > 0) d.amountByCurrency[currency] = (d.amountByCurrency[currency] ?? 0) + amount;
    days.set(day, d);
  }

  const roundMap = (m: Record<string, number>) =>
    Object.fromEntries(Object.entries(m).map(([k, v]) => [k, money(v)]));

  return {
    totalSeconds,
    billableSeconds,
    amountByCurrency: roundMap(totals),
    byProject: [...rows.values()]
      .map((r) => ({ ...r, amount: money(r.amount) }))
      .sort((a, b) => b.seconds - a.seconds),
    byTask: [...tasks.values()]
      .map((t) => ({ ...t, amount: money(t.amount) }))
      .sort((a, b) => b.seconds - a.seconds),
    byDay: [...days.values()]
      .map((d) => ({ ...d, amountByCurrency: roundMap(d.amountByCurrency) }))
      .sort((a, b) => (a.day < b.day ? 1 : -1)),
    entryCount: picked.length
  };
}

export type Preset = 'today' | 'week' | 'lastWeek' | 'month' | 'lastMonth' | 'year' | 'all';

/** Period boundaries for a preset, in the person's local calendar (Monday-based weeks). */
export function presetRange(preset: Preset, nowMs: number, offsetMin: number): { fromDay: string; toDay: string } {
  const today = dayKey(nowMs, offsetMin);
  const [y, m, d] = today.split('-').map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Mon=0
  const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const prevMonth = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`;

  switch (preset) {
    case 'today':
      return { fromDay: today, toDay: today };
    case 'week':
      return { fromDay: addDays(today, -dow), toDay: addDays(today, 6 - dow) };
    case 'lastWeek':
      return { fromDay: addDays(today, -dow - 7), toDay: addDays(today, -dow - 1) };
    case 'month':
      return { fromDay: monthStart, toDay: addDays(nextMonth, -1) };
    case 'lastMonth':
      return { fromDay: prevMonth, toDay: addDays(monthStart, -1) };
    case 'year':
      return { fromDay: `${y}-01-01`, toDay: `${y}-12-31` };
    default:
      return { fromDay: '2000-01-01', toDay: '2100-12-31' };
  }
}

/** Inclusive local days -> [from, to) instants. */
export function dayRangeToQuery(fromDay: string, toDay: string, offsetMin: number): { from: string; to: string } {
  return { from: localToIso(fromDay, '00:00', offsetMin), to: localToIso(addDays(toDay, 1), '00:00', offsetMin) };
}
