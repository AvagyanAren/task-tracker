import { useMemo, useState } from 'react';
import type { Entry } from '../../shared/types.js';
import { entrySeconds } from '../../shared/report.js';
import { groupSimilar } from '../../shared/group.js';
import { addDays, dayKey, formatClock, formatHM, isoToLocalTime } from '../../shared/time.js';
import { api } from '../api.js';
import { useApp } from '../ctx.js';
import { formatDayTitle, formatMoneyMap } from '../format.js';
import { ChevronDown, ChevronRight, Dollar, Pencil, Play, Plus, Timer, Trash } from '../icons.js';
import { Empty, ProjectDot } from '../ui.js';
import { EntryDialog } from './EntryDialog.js';

const PAGE_DAYS = 10;

export function EntryList() {
  const { state, now, tz, run, deleteEntry, startTimer, settings } = useApp();
  const today = dayKey(now, tz);
  const yesterday = addDays(today, -1);
  const [visibleDays, setVisibleDays] = useState(PAGE_DAYS);
  const [dialog, setDialog] = useState<{ entry?: Entry } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const projects = useMemo(() => new Map(state.projects.map((p) => [p.id, p])), [state.projects]);

  const days = useMemo(() => {
    const byDay = new Map<string, Entry[]>();
    for (const e of state.entries) {
      const d = dayKey(e.start, tz);
      byDay.set(d, [...(byDay.get(d) ?? []), e]);
    }
    return [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([day, entries]) => ({ day, entries: entries.sort((a, b) => (a.start < b.start ? 1 : -1)) }));
  }, [state.entries, tz]);

  const money = (entries: Entry[]) => {
    const m: Record<string, number> = {};
    for (const e of entries) {
      const p = e.projectId ? projects.get(e.projectId) : undefined;
      if (p && e.billable && p.rate > 0) m[p.currency] = (m[p.currency] ?? 0) + (entrySeconds(e, now) / 3600) * p.rate;
    }
    return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(v * 100) / 100]));
  };

  const toggle = (key: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const Row = ({ e, nested }: { e: Entry; nested?: boolean }) => {
    const p = e.projectId ? projects.get(e.projectId) : undefined;
    return (
      <div className={`entry ${nested ? 'nested' : ''} ${e.end === null ? 'is-running' : ''}`}>
        <div className="entry-main">
          <span className="entry-desc">{e.description || <em className="muted">(без названия)</em>}</span>
          {p && (
            <span className="proj" style={{ color: p.color }}>
              <ProjectDot color={p.color} size={8} /> {p.name}
            </span>
          )}
          {e.tags.map((t) => (
            <span className="tag" key={t}>
              #{t}
            </span>
          ))}
        </div>
        <span className={e.billable ? 'bill on' : 'bill'} title={e.billable ? 'Оплачивается' : 'Не оплачивается'}>
          <Dollar size={15} />
        </span>
        <span className="entry-time">
          {isoToLocalTime(e.start, tz)} – {e.end ? isoToLocalTime(e.end, tz) : '…'}
        </span>
        <span className="entry-dur">{e.end ? formatClock(entrySeconds(e, now)) : 'идёт'}</span>
        <span className="entry-actions">
          <button className="btn icon ghost" title="Продолжить" onClick={() => startTimer(e.description, e.projectId, e.tags, e.billable)}>
            <Play size={15} solid />
          </button>
          <button className="btn icon ghost" title="Править" onClick={() => setDialog({ entry: e })}>
            <Pencil size={15} />
          </button>
          <button className="btn icon ghost danger" title="Удалить" onClick={() => deleteEntry(e.id)}>
            <Trash size={15} />
          </button>
        </span>
      </div>
    );
  };

  if (days.length === 0) {
    return (
      <Empty icon={<Timer size={30} />} title="Пока нет записей">
        Запустите таймер сверху, нажмите <strong>M</strong>, чтобы добавить время вручную, или загрузите историю на вкладке «Импорт».
      </Empty>
    );
  }

  return (
    <div className="entries">
      {days.slice(0, visibleDays).map(({ day, entries }) => {
        const seconds = entries.reduce((n, e) => n + entrySeconds(e, now), 0);
        const m = money(entries);
        const groups = settings.groupSimilar ? groupSimilar(entries) : entries.map((e) => ({ key: e.id, entries: [e] }));
        return (
          <section className="day-block" key={day}>
            <header className="day-head">
              <h3>{formatDayTitle(day, today, yesterday)}</h3>
              <span className="day-sum">
                {Object.keys(m).length > 0 && <span className="money">{formatMoneyMap(m)}</span>}
                <span className="total">{formatHM(seconds)}</span>
              </span>
            </header>

            <div className="day">
            {groups.map((g) => {
              if (g.entries.length === 1) return <Row key={g.key} e={g.entries[0]} />;
              const first = g.entries[0];
              const p = first.projectId ? projects.get(first.projectId) : undefined;
              const sec = g.entries.reduce((n, e) => n + entrySeconds(e, now), 0);
              const expanded = open.has(`${day}${g.key}`);
              return (
                <div key={g.key} className="entry-group">
                  <div className="entry grouphead">
                    <div className="entry-main">
                      <button className="btn icon ghost" onClick={() => toggle(`${day}${g.key}`)} aria-label={expanded ? 'Свернуть' : 'Развернуть'}>
                        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </button>
                      <span className="count">{g.entries.length}</span>
                      <span className="entry-desc">{first.description || <em className="muted">(без названия)</em>}</span>
                      {p && (
                        <span className="proj" style={{ color: p.color }}>
                          <ProjectDot color={p.color} size={8} /> {p.name}
                        </span>
                      )}
                      {first.tags.map((t) => (
                        <span className="tag" key={t}>
                          #{t}
                        </span>
                      ))}
                    </div>
                    <span className={first.billable ? 'bill on' : 'bill'}>
                      <Dollar size={15} />
                    </span>
                    <span className="entry-time">{g.entries.length} записей</span>
                    <span className="entry-dur">{formatClock(sec)}</span>
                    <span className="entry-actions">
                      <button className="btn icon ghost" title="Продолжить" onClick={() => startTimer(first.description, first.projectId, first.tags, first.billable)}>
                        <Play size={15} solid />
                      </button>
                    </span>
                  </div>
                  {expanded && g.entries.map((e) => <Row key={e.id} e={e} nested />)}
                </div>
              );
            })}
            </div>
          </section>
        );
      })}

      {days.length > visibleDays && (
        <button className="btn subtle center" onClick={() => setVisibleDays(visibleDays + PAGE_DAYS)}>
          <Plus size={15} /> Показать ещё
        </button>
      )}

      {dialog && <EntryDialog entry={dialog.entry} onClose={() => setDialog(null)} />}
    </div>
  );
}
