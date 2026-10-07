import type { Project } from '../shared/types.js';

export function formatMoney(amount: number, currency: string): string {
  const n = amount.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return currency ? `${n} ${currency}` : n;
}

export function formatMoneyMap(map: Record<string, number>): string {
  const parts = Object.entries(map).map(([cur, v]) => formatMoney(v, cur));
  return parts.length ? parts.join(' + ') : '—';
}

export const activeProjects = (projects: Project[]) => projects.filter((p) => !p.archived);

export function formatDayTitle(day: string, today: string, yesterday: string): string {
  if (day === today) return 'Сегодня';
  if (day === yesterday) return 'Вчера';
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: y === new Date().getFullYear() ? undefined : 'numeric',
    timeZone: 'UTC'
  });
}
