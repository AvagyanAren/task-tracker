import { useMemo, useState } from 'react';
import { Check, Folder } from '../icons.js';
import type { Project } from '../../shared/types.js';
import { Popover, ProjectDot } from '../ui.js';

interface Props {
  projects: Project[];
  value: string | null;
  onChange: (id: string | null) => void;
  /** Label of the "no project" choice; also the button text when nothing is chosen. */
  noneLabel?: string;
  includeId?: string | null;
  compact?: boolean;
  /** Timer-bar look: an icon button until a project is chosen, then a chip with its name. */
  bar?: boolean;
}

export function ProjectPicker({ projects, value, onChange, noneLabel = 'Без проекта', includeId, compact, bar }: Props) {
  const [q, setQ] = useState('');
  const current = projects.find((p) => p.id === value);
  const list = useMemo(
    () =>
      projects
        .filter((p) => !p.archived || p.id === includeId || p.id === value)
        .filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())),
    [projects, q, includeId, value]
  );

  return (
    <Popover
      trigger={(open, toggle) => (
        bar && !current ? (
          <button type="button" className="icon-tool" onClick={toggle} aria-expanded={open} aria-label="Проект" title="Проект">
            <Folder size={18} />
          </button>
        ) : (
          <button
            type="button"
            className={`pick ${current ? 'has' : ''} ${compact ? 'compact' : ''}`}
            onClick={toggle}
            aria-expanded={open}
            aria-label={bar && current ? `Проект: ${current.name}` : undefined}
            title={bar && current ? (current.rate > 0 ? `${current.name} · ${current.rate} ${current.currency}/ч` : current.name) : undefined}
          >
            {current ? <ProjectDot color={current.color} /> : <Folder size={16} />}
            <span>{current ? current.name : noneLabel}</span>
          </button>
        )
      )}
    >
      {(close) => (
        <div className="menu">
          <input
            className="menu-search"
            autoFocus
            placeholder="Найти проект…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="menu-list">
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                onChange(null);
                close();
              }}
            >
              <Folder size={14} /> {noneLabel}
              {value === null && <Check size={14} className="menu-check" />}
            </button>
            {list.map((p) => (
              <button
                type="button"
                key={p.id}
                className="menu-item"
                onClick={() => {
                  onChange(p.id);
                  close();
                }}
              >
                <ProjectDot color={p.color} /> {p.name}
                {p.archived && <span className="muted"> · архив</span>}
                {value === p.id && <Check size={14} className="menu-check" />}
              </button>
            ))}
            {list.length === 0 && <div className="menu-empty">Ничего не найдено</div>}
          </div>
        </div>
      )}
    </Popover>
  );
}
