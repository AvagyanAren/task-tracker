import { useEffect, useMemo, useState } from 'react';
import { Calendar, Check, ChevronDown, ChevronLeft, ChevronRight } from '../icons.js';
import { Popover } from '../ui.js';

/* ---------- Select: a listbox in the app's own style instead of the native <select> ---------- */

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  placeholder = 'Выберите…',
  ariaLabel
}: {
  value: T | '';
  options: Array<SelectOption<T>>;
  onChange: (v: T) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <Popover
      trigger={(open, toggle) => (
        <button type="button" className="select" onClick={toggle} aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel}>
          <span className={current ? '' : 'muted'}>{current?.label ?? placeholder}</span>
          <ChevronDown size={16} />
        </button>
      )}
    >
      {(close) => (
        <div className="menu" role="listbox">
          <div className="menu-list">
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={o.value === value ? 'menu-item active' : 'menu-item'}
                onClick={() => {
                  onChange(o.value);
                  close();
                }}
              >
                <span>{o.label}</span>
                {o.hint && <small className="muted">{o.hint}</small>}
                {o.value === value && <Check size={14} className="menu-check" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </Popover>
  );
}

/* ---------- DateField: Russian calendar popover, Monday first ---------- */

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const pad = (n: number) => String(n).padStart(2, '0');
const dayKeyOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function parseDay(day: string): { y: number; m: number; d: number } | null {
  const mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return mt ? { y: Number(mt[1]), m: Number(mt[2]), d: Number(mt[3]) } : null;
}

function todayKey(): string {
  const n = new Date();
  return dayKeyOf(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

export function formatDayRu(day: string): string {
  const p = parseDay(day);
  return p ? `${p.d} ${MONTHS_SHORT[p.m - 1]} ${p.y}` : '—';
}

function monthCells(y: number, m: number): Array<number | null> {
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: Array<number | null> = Array(lead).fill(null);
  for (let d = 1; d <= count; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);
  return cells;
}

function CalendarPanel({ value, onPick }: { value: string; onPick: (day: string) => void }) {
  const base = parseDay(value) ?? parseDay(todayKey())!;
  const [view, setView] = useState({ y: base.y, m: base.m });
  useEffect(() => setView({ y: base.y, m: base.m }), [base.y, base.m]);
  const cells = useMemo(() => monthCells(view.y, view.m), [view]);
  const today = todayKey();
  const shift = (n: number) =>
    setView((v) => {
      const t = v.y * 12 + (v.m - 1) + n;
      return { y: Math.floor(t / 12), m: (t % 12) + 1 };
    });

  return (
    <div className="datepanel">
      <div className="datepanel-head">
        <button type="button" className="btn icon ghost sm" onClick={() => shift(-1)} aria-label="Предыдущий месяц">
          <ChevronLeft size={16} />
        </button>
        <strong>
          {MONTHS[view.m - 1]} {view.y}
        </strong>
        <button type="button" className="btn icon ghost sm" onClick={() => shift(1)} aria-label="Следующий месяц">
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="datepanel-grid">
        {WEEKDAYS.map((w) => (
          <span key={w} className="datepanel-wd">
            {w}
          </span>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <span key={`e${i}`} />;
          const key = dayKeyOf(view.y, view.m, d);
          const cls = ['datepanel-day', key === value ? 'sel' : '', key === today ? 'today' : '', i % 7 >= 5 ? 'weekend' : ''].join(' ').trim();
          return (
            <button key={key} type="button" className={cls} onClick={() => onPick(key)} aria-pressed={key === value}>
              {d}
            </button>
          );
        })}
      </div>
      <div className="datepanel-foot">
        <button type="button" className="btn ghost sm" onClick={() => onPick(today)}>
          Сегодня
        </button>
      </div>
    </div>
  );
}

export function DateField({ value, onChange, ariaLabel }: { value: string; onChange: (day: string) => void; ariaLabel?: string }) {
  return (
    <Popover
      trigger={(open, toggle) => (
        <button type="button" className="select datefield" onClick={toggle} aria-haspopup="dialog" aria-expanded={open} aria-label={ariaLabel}>
          <span>{formatDayRu(value)}</span>
          <Calendar size={16} />
        </button>
      )}
    >
      {(close) => (
        <CalendarPanel
          value={value}
          onPick={(d) => {
            onChange(d);
            close();
          }}
        />
      )}
    </Popover>
  );
}

/* ---------- TimeField: 24-hour text input that accepts "930", "9.30", "9:30" ---------- */

export function normalizeTime(raw: string): string | null {
  const s = raw.trim().replace(/[.,\s]/g, ':');
  let h: number;
  let m: number;
  const colon = /^(\d{1,2}):(\d{1,2})$/.exec(s);
  if (colon) {
    h = Number(colon[1]);
    m = Number(colon[2]);
  } else if (/^\d{3,4}$/.test(s)) {
    h = Number(s.slice(0, -2));
    m = Number(s.slice(-2));
  } else if (/^\d{1,2}$/.test(s)) {
    h = Number(s);
    m = 0;
  } else return null;
  return h > 23 || m > 59 ? null : `${pad(h)}:${pad(m)}`;
}

export function TimeField({ value, onChange, ariaLabel, placeholder = '09:30' }: { value: string; onChange: (t: string) => void; ariaLabel?: string; placeholder?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    const t = normalizeTime(text);
    if (t) {
      setText(t);
      if (t !== value) onChange(t);
    } else setText(value);
  };
  return (
    <input
      className="timefield"
      inputMode="numeric"
      value={text}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), commit())}
    />
  );
}
