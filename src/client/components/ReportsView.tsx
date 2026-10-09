import { DateField } from './fields.js';
import { useMemo, useState } from 'react';
import { buildReport, dayRangeToQuery, entrySeconds, filterEntries, presetRange, type Preset, type ReportQuery } from '../../shared/report.js';
import { addDays, dayKey, formatHM, hoursDecimal, isoToLocalTime } from '../../shared/time.js';
import { useApp } from '../ctx.js';
import { pomodoroDays } from '../usePomodoro.js';
import { formatMoney, formatMoneyMap } from '../format.js';
import { Chart, Download, Invoice, Search } from '../icons.js';
import { InvoiceDialog } from './InvoiceDialog.js';
import { Empty, ProjectDot, Segmented } from '../ui.js';
import { ProjectPicker } from './ProjectPicker.js';
import { TagPicker } from './TagPicker.js';

const PRESETS: Array<[Preset, string]> = [
  ['today', 'Сегодня'],
  ['week', 'Неделя'],
  ['lastWeek', 'Прошлая неделя'],
  ['month', 'Месяц'],
  ['lastMonth', 'Прошлый месяц'],
  ['year', 'Год'],
  ['all', 'Всё время']
];

const sumMoney = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);

/** "▲ 12 % к прошлому периоду". Hidden when there is nothing to compare with. */
function Delta({ now, before, onAccent, single = true }: { now: number; before: number; onAccent?: boolean; single?: boolean }) {
  if (!single || before <= 0) return null;
  const pct = Math.round(((now - before) / before) * 100);
  const dir = pct === 0 ? 'flat' : pct > 0 ? 'up' : 'down';
  return (
    <span className={`delta delta-${dir} ${onAccent ? 'on-accent' : ''}`} title="Сравнение с предыдущим периодом такой же длины">
      {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '='} {Math.abs(pct)}% к прошлому периоду
    </span>
  );
}

const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
type Mode = 'summary' | 'detailed';
type BillFilter = 'all' | 'yes' | 'no';

/** /#reports+detailed opens the Detailed report straight away. */
const initialModeFromHash = (): Mode => (typeof location !== 'undefined' && location.hash.includes('detailed') ? 'detailed' : 'summary');

export function ReportsView() {
  const { state, now, tz, settings } = useApp();
  const initial = presetRange('week', now, tz);
  const [mode, setMode] = useState<Mode>(initialModeFromHash());
  const [preset, setPreset] = useState<Preset | 'custom'>('week');
  const [fromDay, setFromDay] = useState(initial.fromDay);
  const [toDay, setToDay] = useState(initial.toDay);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [bill, setBill] = useState<BillFilter>('all');
  const [search, setSearch] = useState('');
  const [invoiceOpen, setInvoiceOpen] = useState(typeof location !== 'undefined' && location.hash.includes('invoice'));
  const pick = (p: Preset) => {
    const r = presetRange(p, now, tz);
    setPreset(p);
    setFromDay(r.fromDay);
    setToDay(r.toDay);
  };

  const query = useMemo<ReportQuery>(
    () => ({
      ...dayRangeToQuery(fromDay, toDay < fromDay ? fromDay : toDay, tz),
      projectId,
      tags,
      billable: bill === 'all' ? null : bill === 'yes',
      search
    }),
    [fromDay, toDay, projectId, tags, bill, search, tz]
  );

  const report = useMemo(() => buildReport(state, query, now, tz), [state, query, now, tz]);
  // The period of the same length right before this one, with the same filters, for "+12 %" hints.
  const prev = useMemo(() => {
    if (preset === 'all') return null;
    const last = toDay < fromDay ? fromDay : toDay;
    const n = Math.round((Date.parse(last) - Date.parse(fromDay)) / 86400000) + 1;
    return buildReport(state, { ...query, ...dayRangeToQuery(addDays(fromDay, -n), addDays(fromDay, -1), tz) }, now, tz);
  }, [preset, state, query, fromDay, toDay, now, tz]);
  const filtersOn = projectId !== null || tags.length > 0 || bill !== 'all' || search.trim() !== '';
  const resetFilters = () => {
    setProjectId(null);
    setTags([]);
    setBill('all');
    setSearch('');
  };
  const projects = useMemo(() => new Map(state.projects.map((p) => [p.id, p])), [state.projects]);
  const knownTags = useMemo(() => [...new Set(state.entries.flatMap((e) => e.tags))], [state.entries]);
  const detailed = useMemo(
    () => (mode === 'detailed' ? filterEntries(state, query).sort((a, b) => (a.start < b.start ? 1 : -1)) : []),
    [mode, state, query]
  );

  const pomodoros = useMemo(() => {
    const last = toDay < fromDay ? fromDay : toDay;
    return Object.entries(pomodoroDays()).reduce((n, [day, c]) => (day >= fromDay && day <= last ? n + c : n), 0);
  }, [fromDay, toDay]);

  const exportCsv = () => {
    const rows = filterEntries(state, query)
      .sort((a, b) => (a.start < b.start ? -1 : 1))
      .map((e) => {
        const p = e.projectId ? projects.get(e.projectId) : undefined;
        const sec = entrySeconds(e, now);
        return [
          dayKey(e.start, tz),
          isoToLocalTime(e.start, tz),
          e.end ? isoToLocalTime(e.end, tz) : '',
          p?.name ?? '',
          e.description,
          e.tags.join('; '),
          e.billable ? 'да' : 'нет',
          hoursDecimal(sec),
          p && e.billable ? Math.round((sec / 3600) * p.rate * 100) / 100 : 0,
          p?.currency ?? ''
        ]
          .map(csvCell)
          .join(',');
      });
    const header = ['Дата', 'Начало', 'Конец', 'Проект', 'Задача', 'Теги', 'Оплачиваемое', 'Часы', 'Сумма', 'Валюта'].map(csvCell).join(',');
    const blob = new Blob(['﻿' + [header, ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `time-report_${fromDay}_${toDay}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Отчёты</h1>
        </div>
        <div className="row gap">
          <Segmented<Mode>
            label="Тип отчёта"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'summary', label: 'Сводный' },
              { value: 'detailed', label: 'Подробный' }
            ]}
          />
          <button className="btn subtle" onClick={exportCsv} disabled={report.entryCount === 0}>
            <Download size={16} /> CSV
          </button>
          <button className="btn primary" onClick={() => setInvoiceOpen(true)} disabled={report.entryCount === 0}>
            <Invoice size={16} /> Инвойс
          </button>
        </div>
      </header>

      <section className="panel filters">
        <div className="chips-row">
          {PRESETS.map(([p, label]) => (
            <button key={p} className={preset === p ? 'chip active' : 'chip'} onClick={() => pick(p)}>
              {label}
            </button>
          ))}
        </div>
        <div className="filter-row">
          <label className="field">
            <span>С</span>
            <DateField value={fromDay} onChange={(d) => { setPreset('custom'); setFromDay(d); }} />
          </label>
          <label className="field">
            <span>По (включительно)</span>
            <DateField value={toDay} onChange={(d) => { setPreset('custom'); setToDay(d); }} />
          </label>
          <div className="field">
            <span>Проект</span>
            <ProjectPicker projects={state.projects} value={projectId} onChange={setProjectId} noneLabel="Все проекты" />
          </div>
          <div className="field">
            <span>Теги</span>
            <TagPicker value={tags} known={knownTags} onChange={setTags} />
          </div>
          <div className="field">
            <span>Оплата</span>
            <Segmented<BillFilter>
              label="Оплата"
              value={bill}
              onChange={setBill}
              options={[
                { value: 'all', label: 'Все' },
                { value: 'yes', label: '$' , title: 'Только оплачиваемые' },
                { value: 'no', label: 'Не $', title: 'Только неоплачиваемые' }
              ]}
            />
          </div>
          <label className="field grow">
            <span>Поиск</span>
            <span className="input-icon">
              <Search size={15} />
              <input placeholder="Текст в описании" value={search} onChange={(e) => setSearch(e.target.value)} />
            </span>
          </label>
          {filtersOn && (
            <button className="btn ghost sm" onClick={resetFilters}>
              Сбросить
            </button>
          )}
        </div>
      </section>

      <div className="stats">
        <div className="stat">
          <span className="stat-label">Всего времени</span>
          <strong className="stat-value">{formatHM(report.totalSeconds)}</strong>
          <span className="muted">{hoursDecimal(report.totalSeconds)} ч · записей {report.entryCount}</span>
          {prev && <Delta now={report.totalSeconds} before={prev.totalSeconds} />}
        </div>
        <div className="stat">
          <span className="stat-label">Оплачиваемое</span>
          <strong className="stat-value">{formatHM(report.billableSeconds)}</strong>
          <span className="muted">
            {report.totalSeconds ? Math.round((report.billableSeconds / report.totalSeconds) * 100) : 0}% от всего времени
          </span>
          {prev && <Delta now={report.billableSeconds} before={prev.billableSeconds} />}
        </div>
        {pomodoros > 0 && (
          <div className="stat">
            <span className="stat-label">Помидоры</span>
            <strong className="stat-value">{pomodoros}</strong>
            <span className="muted">≈ {formatHM(pomodoros * settings.pomodoro.workMin * 60)} фокуса</span>
          </div>
        )}
        <div className="stat accent">
          <span className="stat-label">К оплате</span>
          <strong className="stat-value">{formatMoneyMap(report.amountByCurrency)}</strong>
          <span>часы × ставка проекта</span>
          {prev && <Delta now={sumMoney(report.amountByCurrency)} before={sumMoney(prev.amountByCurrency)} onAccent single={Object.keys({ ...report.amountByCurrency, ...prev.amountByCurrency }).length <= 1} />}
        </div>
      </div>

      {report.entryCount === 0 ? (
        <Empty icon={<Chart size={28} />} title="За этот период записей нет">
          Выберите другой период или сбросьте фильтры.
        </Empty>
      ) : mode === 'summary' ? (
        <Summary report={report} fromDay={fromDay} toDay={toDay < fromDay ? fromDay : toDay} />
      ) : (
        <section className="panel flush">
          <table className="table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Задача</th>
                <th>Проект</th>
                <th>Время</th>
                <th className="num">Длит.</th>
                <th className="num">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {detailed.map((e) => {
                const p = e.projectId ? projects.get(e.projectId) : undefined;
                const sec = entrySeconds(e, now);
                return (
                  <tr key={e.id}>
                    <td className="nowrap">{dayKey(e.start, tz).split('-').reverse().join('.')}</td>
                    <td>
                      {e.description || <em className="muted">Без названия</em>}
                      {e.tags.map((t) => (
                        <span key={t} className="tag">#{t}</span>
                      ))}
                    </td>
                    <td className="nowrap">{p ? <span className="proj-cell"><ProjectDot color={p.color} />{p.name}</span> : <span className="muted">—</span>}</td>
                    <td className="nowrap muted">
                      {isoToLocalTime(e.start, tz)}–{e.end ? isoToLocalTime(e.end, tz) : '…'}
                    </td>
                    <td className="num">{formatHM(sec)}</td>
                    <td className="num">{p && e.billable && p.rate > 0 ? formatMoney(Math.round((sec / 3600) * p.rate * 100) / 100, p.currency) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {invoiceOpen && <InvoiceDialog query={query} fromDay={fromDay} toDay={toDay} onClose={() => setInvoiceOpen(false)} />}
    </div>
  );
}

function Summary({ report, fromDay, toDay }: { report: ReturnType<typeof buildReport>; fromDay: string; toDay: string }) {
  const { state } = useApp();
  const colorOf = (id: string | null) => (id ? state.projects.find((p) => p.id === id)?.color : undefined) ?? 'var(--text-3)';
  // Show every day of a short period (empty ones too) so the bars keep a sensible width and rhythm.
  const known = new Map(report.byDay.map((d) => [d.day, d.seconds]));
  let days: Array<{ day: string; seconds: number }> = [...report.byDay].sort((a, b) => (a.day < b.day ? -1 : 1));
  const span = Math.round((Date.parse(toDay) - Date.parse(fromDay)) / 86_400_000) + 1;
  if (span >= 1 && span <= 62) days = Array.from({ length: span }, (_, i) => { const d = addDays(fromDay, i); return { day: d, seconds: known.get(d) ?? 0 }; });
  return (
    <>
      <div className="charts">
        <section className="panel">
          <h3>По дням</h3>
          <BarChart days={days} />
        </section>
        <section className="panel">
          <h3>По проектам</h3>
          <Donut rows={report.byProject.map((r) => ({ label: r.name, value: r.seconds, color: colorOf(r.projectId) }))} total={report.totalSeconds} />
        </section>
      </div>

      <section className="panel flush">
        <table className="table">
          <thead>
            <tr>
              <th>Проект</th>
              <th className="num">Часы</th>
              <th className="num">Ставка</th>
              <th className="num">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {report.byProject.map((r) => (
              <tr key={r.projectId ?? 'none'}>
                <td>
                  <span className="proj-cell">
                    <ProjectDot color={colorOf(r.projectId)} />
                    {r.name}
                  </span>
                </td>
                <td className="num">
                  {formatHM(r.seconds)} <span className="muted">({hoursDecimal(r.seconds)})</span>
                </td>
                <td className="num">{r.projectId ? formatMoney(r.rate, r.currency) : '—'}</td>
                <td className="num">
                  <strong>{r.amount > 0 ? formatMoney(r.amount, r.currency) : '—'}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel flush">
        <table className="table">
          <thead>
            <tr>
              <th>Задача</th>
              <th className="num">Время</th>
              <th className="num">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {report.byTask.map((t, i) => (
              <tr key={i}>
                <td>
                  {t.description || <em className="muted">Без названия</em>} <span className="muted">· {t.projectName}</span>
                </td>
                <td className="num">{formatHM(t.seconds)}</td>
                <td className="num">{t.amount > 0 ? formatMoney(t.amount, t.currency) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function BarChart({ days }: { days: Array<{ day: string; seconds: number }> }) {
  const W = 560;
  const H = 190;
  const pad = { l: 34, r: 6, t: 8, b: 24 };
  const maxH = Math.max(1, ...days.map((d) => d.seconds / 3600));
  const step = Math.max(1, Math.ceil(maxH / 4));
  const top = step * Math.ceil(maxH / step);
  const bw = (W - pad.l - pad.r) / days.length;
  const y = (h: number) => pad.t + (1 - h / top) * (H - pad.t - pad.b);
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step);
  const every = Math.ceil(days.length / 12);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="barchart" role="img" aria-label="Часы по дням">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
          <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="axis">{t}ч</text>
        </g>
      ))}
      {days.map((d, i) => {
        const h = d.seconds / 3600;
        const w = Math.min(bw * 0.62, 44);
        const x = pad.l + i * bw + (bw - w) / 2;
        return (
          <g key={d.day}>
            <rect x={x} y={y(h)} width={w} height={Math.max(0, H - pad.b - y(h))} rx={Math.min(6, w / 2)} className="bar">
              <title>{`${d.day.split('-').reverse().join('.')} — ${formatHM(d.seconds)}`}</title>
            </rect>
            {i % every === 0 && (
              <text x={x + w / 2} y={H - 7} textAnchor="middle" className="axis">
                {d.day.slice(8)}.{d.day.slice(5, 7)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function Donut({ rows, total }: { rows: Array<{ label: string; value: number; color: string }>; total: number }) {
  const R = 54;
  const C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 140 140" className="donut" role="img" aria-label="Доли проектов">
        <circle cx="70" cy="70" r={R} className="donut-bg" />
        {rows.map((r, i) => {
          const len = total ? (r.value / total) * C : 0;
          const el = (
            <circle
              key={i}
              cx="70"
              cy="70"
              r={R}
              fill="none"
              stroke={r.color}
              strokeWidth="16"
              strokeDasharray={`${Math.max(0, len - 1.5)} ${C}`}
              strokeDashoffset={-acc}
              transform="rotate(-90 70 70)"
            />
          );
          acc += len;
          return el;
        })}
        <text x="70" y="68" textAnchor="middle" className="donut-total">{formatHM(total)}</text>
        <text x="70" y="85" textAnchor="middle" className="axis">всего</text>
      </svg>
      <ul className="legend">
        {rows.slice(0, 6).map((r, i) => (
          <li key={i}>
            <ProjectDot color={r.color} />
            <span className="legend-name">{r.label}</span>
            <span className="muted">{total ? Math.round((r.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
