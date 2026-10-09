import { useMemo, useState } from 'react';
import { Check, Plus, Tag } from '../icons.js';
import { Popover } from '../ui.js';

interface Props {
  value: string[];
  /** Every tag known so far (from all entries). */
  known: string[];
  onChange: (tags: string[]) => void;
  compact?: boolean;
  /** Timer-bar look: an icon button until a tag is chosen. */
  bar?: boolean;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function TagPicker({ value, known, onChange, compact, bar }: Props) {
  const [q, setQ] = useState('');
  const all = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of [...known, ...value]) if (!m.has(t.toLowerCase())) m.set(t.toLowerCase(), t);
    return [...m.values()].sort((a, b) => a.localeCompare(b));
  }, [known, value]);
  const shown = all.filter((t) => t.toLowerCase().includes(q.trim().toLowerCase()));
  const canCreate = q.trim() !== '' && !all.some((t) => same(t, q.trim()));

  const toggle = (t: string) =>
    onChange(value.some((v) => same(v, t)) ? value.filter((v) => !same(v, t)) : [...value, t]);

  return (
    <Popover
      trigger={(open, tg) => (
        bar && value.length === 0 ? (
          <button type="button" className="icon-tool" onClick={tg} aria-expanded={open} aria-label="Теги" title="Теги">
            <Tag size={18} />
          </button>
        ) : (
          <button
            type="button"
            className={`pick ${value.length ? 'has' : ''} ${compact ? 'compact' : ''}`}
            onClick={tg}
            aria-expanded={open}
            aria-label={value.length ? `Теги: ${value.join(', ')}` : undefined}
            title="Теги"
          >
            <Tag size={16} />
            {value.length > 0 && <span>{value.length === 1 ? value[0] : `${value.length} тега`}</span>}
            {!compact && value.length === 0 && <span>Теги</span>}
          </button>
        )
      )}
    >
      {() => (
        <div className="menu">
          <input
            className="menu-search"
            autoFocus
            placeholder="Найти или создать тег…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canCreate) {
                e.preventDefault();
                toggle(q.trim().replace(/^#/, ''));
                setQ('');
              }
            }}
          />
          <div className="menu-list">
            {canCreate && (
              <button
                type="button"
                className="menu-item accent"
                onClick={() => {
                  toggle(q.trim().replace(/^#/, ''));
                  setQ('');
                }}
              >
                <Plus size={14} /> Создать «{q.trim().replace(/^#/, '')}»
              </button>
            )}
            {shown.map((t) => (
              <button type="button" key={t} className="menu-item" onClick={() => toggle(t)}>
                <span className="tag-hash">#</span>
                {t}
                {value.some((v) => same(v, t)) && <Check size={14} className="menu-check" />}
              </button>
            ))}
            {shown.length === 0 && !canCreate && <div className="menu-empty">Тегов пока нет — введите название</div>}
          </div>
        </div>
      )}
    </Popover>
  );
}
