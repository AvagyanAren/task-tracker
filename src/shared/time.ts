const pad = (n: number) => String(n).padStart(2, '0');

/** 3725 -> "1:02:05" */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** 19800 -> "5ч 30м" */
export function formatHM(totalSeconds: number): string {
  const minutes = Math.round(Math.max(0, totalSeconds) / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}м`;
  return m === 0 ? `${h}ч` : `${h}ч ${m}м`;
}

/** Decimal hours, e.g. 5.5 */
export function hoursDecimal(totalSeconds: number): number {
  return Math.round((totalSeconds / 3600) * 100) / 100;
}

/**
 * Accepts "2:30", "2.5", "2,5", "90m", "1h 30m", "2ч 15м", "45" (minutes if > 24, hours otherwise).
 * Returns seconds, or null when it cannot be understood.
 */
export function parseDuration(input: string): number | null {
  const t = input.trim().toLowerCase().replace(',', '.');
  if (!t) return null;

  let m = /^(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?$/.exec(t);
  if (m) {
    const [h, mi, s] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
    return mi < 60 && s < 60 ? h * 3600 + mi * 60 + s : null;
  }

  m = /^(?:(\d+(?:\.\d+)?)\s*(?:h|ч|час[а-яё]*))?\s*(?:(\d+(?:\.\d+)?)\s*(?:m|min|м|мин[а-яё]*))?$/.exec(t);
  if (m && (m[1] || m[2])) return Math.round(Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60);

  m = /^(\d+(?:\.\d+)?)$/.exec(t);
  if (m) {
    const n = Number(m[1]);
    return Math.round(n > 24 ? n * 60 : n * 3600);
  }
  return null;
}

/** Calendar day ("2026-09-18") of an instant in a timezone given as minutes EAST of UTC. */
export function dayKey(iso: string | number, offsetMin: number): string {
  const ms = (typeof iso === 'number' ? iso : Date.parse(iso)) + offsetMin * 60_000;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Local wall-clock "YYYY-MM-DD" + "HH:MM" -> ISO instant. */
export function localToIso(day: string, time: string, offsetMin: number): string {
  const [y, mo, d] = day.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - offsetMin * 60_000).toISOString();
}

/** ISO instant -> local "HH:MM". */
export function isoToLocalTime(iso: string, offsetMin: number): string {
  const d = new Date(Date.parse(iso) + offsetMin * 60_000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/**
 * "09:30" typed as a new start for a RUNNING timer -> instant.
 * The start must be in the past, so a time later than "now" means yesterday.
 */
export function resolveStartTime(time: string, nowMs: number, offsetMin: number): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  const today = dayKey(nowMs, offsetMin);
  let ms = Date.parse(localToIso(today, `${m[1].padStart(2, '0')}:${m[2]}`, offsetMin));
  if (ms > nowMs) ms -= 24 * 3600_000;
  return new Date(ms).toISOString();
}
