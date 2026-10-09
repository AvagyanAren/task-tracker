import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { Board, Priority, Task } from '../../shared/types.js';
import { entrySeconds } from '../../shared/report.js';
import { dayKey, formatHM, isoToLocalTime, parseDuration } from '../../shared/time.js';
import { api, type TaskInput } from '../api.js';
import { confirmDialog } from '../confirm.js';
import { useApp } from '../ctx.js';
import { Check, CheckList, ChevronDown, Clock, Comment, Copy, Flag, Kanban, More, Pencil, Play, Plus, Square, Tag, Trash, X } from '../icons.js';
import { optMoveTask } from '../optimistic.js';
import { Dialog, Empty, ProjectDot, Segmented } from '../ui.js';
import { ContextMenu, type MenuItem } from './ContextMenu.js';
import { DateField, formatDayRu, Select } from './fields.js';
import { ProjectPicker } from './ProjectPicker.js';
import { TagPicker } from './TagPicker.js';

const PRIORITY_LABEL: Record<Priority, string> = { none: 'Без приоритета', low: 'Низкий', medium: 'Средний', high: 'Высокий' };
const BOARD_KEY = 'tempo.board';

const loadBoardId = () => {
  try {
    return localStorage.getItem(BOARD_KEY) ?? 'general';
  } catch {
    return 'general';
  }
};

/** Seconds of tracked time per task, from the time entries that remember their card. */
function useTaskTime() {
  const { state, now } = useApp();
  return useMemo(() => {
    const m = new Map<string, number>();
    for (const e of state.entries) if (e.taskId) m.set(e.taskId, (m.get(e.taskId) ?? 0) + entrySeconds(e, now));
    return m;
  }, [state.entries, now]);
}

function DueBadge({ task, today, done }: { task: Task; today: string; done: boolean }) {
  if (!task.dueDate) return null;
  const late = !done && task.dueDate < today;
  const soon = !done && task.dueDate === today;
  return (
    <span className={`task-due ${late ? 'late' : soon ? 'soon' : ''}`} title={late ? 'Срок прошёл' : 'Срок'}>
      {formatDayRu(task.dueDate).replace(/ \d{4}$/, '')}
    </span>
  );
}

export function TasksView() {
  const { state, tz, now, run, startTimer, stopTimer } = useApp();
  const [boardId, setBoardId] = useState(loadBoardId);
  const board: Board = state.boards.find((b) => b.id === boardId) ?? state.boards[0];
  const [openId, setOpenId] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [drag, setDrag] = useState<{ id: string; col: string; index: number } | null>(null);
  const time = useTaskTime();
  const today = dayKey(now, tz);
  const running = state.entries.find((e) => e.end === null);

  useEffect(() => {
    try {
      localStorage.setItem(BOARD_KEY, board.id);
    } catch {
      /* remembering the board is a convenience only */
    }
  }, [board.id]);

  const lastColumn = board.columns[board.columns.length - 1].id;
  const needle = query.trim().toLowerCase();
  const tasks = useMemo(() => state.tasks.filter((t) => t.boardId === board.id), [state.tasks, board.id]);
  const byColumn = (columnId: string) =>
    tasks
      .filter((t) => t.columnId === columnId)
      .sort((a, b) => a.order - b.order);
  const matches = (t: Task) => !needle || t.title.toLowerCase().includes(needle) || t.tags.some((g) => g.toLowerCase().includes(needle));
  const project = (id: string | null) => (id ? state.projects.find((p) => p.id === id) : undefined);
  const freeProjects = state.projects.filter((p) => !p.archived && !state.boards.some((b) => b.projectId === p.id));
  const open = state.tasks.find((t) => t.id === openId) ?? null;

  const toggleTimer = (t: Task) => {
    if (running?.taskId === t.id) void stopTimer();
    else void startTimer(t.title, t.projectId, t.tags, true, t.id);
  };

  const addTask = async (columnId: string, title: string) => {
    const text = title.trim();
    if (!text) return setAdding(null);
    await run(async () => (await api.createTask({ boardId: board.id, columnId, title: text })).state);
  };

  /* ---- drag and drop (mouse); on a phone the card dialog has a column picker ---- */

  const onDragOver = (e: DragEvent<HTMLElement>, col: string) => {
    if (!drag) return;
    e.preventDefault();
    const cards = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-card]')].filter((c) => c.dataset.card !== drag.id);
    let index = cards.length;
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        index = i;
        break;
      }
    }
    if (drag.col !== col || drag.index !== index) setDrag({ ...drag, col, index });
  };
  const onDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    if (!drag) return;
    const { id, col, index } = drag;
    setDrag(null);
    void run(() => api.moveTask(id, col, index), optMoveTask(id, col, index));
  };

  const cardMenu = (t: Task): MenuItem[] => {
    const isRunning = running?.taskId === t.id;
    return [
      { label: 'Открыть', icon: <Kanban size={15} />, onClick: () => setOpenId(t.id) },
      { label: isRunning ? 'Остановить таймер' : 'Запустить таймер', icon: isRunning ? <Square size={14} solid /> : <Play size={14} solid />, onClick: () => toggleTimer(t) },
      { label: t.completed ? 'Снять отметку «выполнена»' : 'Отметить выполненной', icon: <Check size={15} />, onClick: () => void run(() => api.updateTask(t.id, { completed: !t.completed })) },
      { kind: 'sep' },
      { kind: 'label', label: 'Переместить в' },
      ...board.columns.map((c): MenuItem => ({ label: c.name, checked: c.id === t.columnId, disabled: c.id === t.columnId, onClick: () => void run(() => api.moveTask(t.id, c.id), optMoveTask(t.id, c.id, Number.MAX_SAFE_INTEGER)) })),
      { kind: 'sep' },
      { kind: 'label', label: 'Приоритет' },
      ...(Object.keys(PRIORITY_LABEL) as Priority[]).map((p): MenuItem => ({ label: PRIORITY_LABEL[p], checked: t.priority === p, onClick: () => void run(() => api.updateTask(t.id, { priority: p })) })),
      { kind: 'sep' },
      { label: 'Создать копию', icon: <Copy size={15} />, onClick: () => void run(async () => (await api.duplicateTask(t.id)).state) },
      {
        label: 'Удалить',
        icon: <Trash size={15} />,
        danger: true,
        onClick: async () => {
          const ok = await confirmDialog({ title: 'Удалить задачу?', text: 'Записи времени останутся в истории, но перестанут быть связаны с карточкой.', confirmLabel: 'Удалить', danger: true });
          if (ok) void run(() => api.deleteTask(t.id));
        }
      }
    ];
  };

  const renderCard = (t: Task, col: string) => {
    const p = project(t.projectId);
    const done = col === lastColumn;
    const checked = t.checklist.filter((i) => i.done).length;
    const spent = time.get(t.id) ?? 0;
    const isRunning = running?.taskId === t.id;
    return (
      <div
        key={t.id}
        data-card={t.id}
        className={`task-card ${isRunning ? 'is-running' : ''} ${drag?.id === t.id ? 'dragging' : ''} ${matches(t) ? '' : 'dim'}`}
        draggable
        tabIndex={0}
        role="button"
        aria-label={`Задача: ${t.title}`}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', t.id);
          setDrag({ id: t.id, col, index: byColumn(col).findIndex((x) => x.id === t.id) });
        }}
        onDragEnd={() => setDrag(null)}
        onClick={() => setOpenId(t.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY, items: cardMenu(t) });
        }}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setOpenId(t.id);
          }
        }}
      >
        <div className="task-title">
          {t.priority !== 'none' && <span className={`prio ${t.priority}`} title={PRIORITY_LABEL[t.priority]} />}
          <span className={t.completed ? 'task-done' : ''}>{t.title}</span>
        </div>
        {(p || t.tags.length > 0) && (
          <div className="task-tags">
            {p && (
              <span className="proj">
                <ProjectDot color={p.color} size={8} /> {p.name}
              </span>
            )}
            {t.tags.map((g) => (
              <span className="tag" key={g}>
                #{g}
              </span>
            ))}
          </div>
        )}
        <div className="task-foot">
          {t.completed && (
            <span className="task-meta ok" title="Выполнена">
              <Check size={13} />
            </span>
          )}
          <span className="task-num">#{t.num}</span>
          <DueBadge task={t} today={today} done={done || t.completed} />
          {t.checklist.length > 0 && (
            <span className={`task-meta ${checked === t.checklist.length ? 'ok' : ''}`} title="Чек-лист">
              <CheckList size={13} /> {checked}/{t.checklist.length}
            </span>
          )}
          {t.comments.length > 0 && (
            <span className="task-meta" title="Комментарии">
              <Comment size={13} /> {t.comments.length}
            </span>
          )}
          {(spent > 0 || isRunning || t.estimate) && (
            <span className={`task-meta time ${isRunning ? 'live' : ''} ${t.estimate && spent > t.estimate ? 'over' : ''}`} title={t.estimate ? `Оценка ${formatHM(t.estimate)}` : 'Затрачено'}>
              {formatHM(spent)}
              {t.estimate ? ` / ${formatHM(t.estimate)}` : ''}
            </span>
          )}
          <button
            className={`btn icon ghost task-play ${isRunning ? 'on' : ''}`}
            title={isRunning ? 'Остановить таймер' : 'Запустить таймер'}
            aria-label={isRunning ? 'Остановить таймер' : 'Запустить таймер'}
            onClick={(e) => {
              e.stopPropagation();
              toggleTimer(t);
            }}
          >
            {isRunning ? <Square size={14} solid /> : <Play size={14} solid />}
          </button>
          <button
            className="btn icon ghost task-more"
            title="Действия"
            aria-label="Действия с задачей"
            aria-haspopup="menu"
            onClick={(e) => {
              e.stopPropagation();
              const r = e.currentTarget.getBoundingClientRect();
              setMenu({ x: r.left, y: r.bottom + 4, items: cardMenu(t) });
            }}
          >
            <More size={16} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="page tasks-page">
      <header className="page-head">
        <div>
          <h1>Задачи</h1>
        </div>
        <div className="row gap">
          <input className="task-search" type="search" placeholder="Найти задачу" aria-label="Найти задачу" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </header>

      <div className="board-bar">
        <div className="board-tabs" role="tablist" aria-label="Доски">
          {state.boards.map((b) => {
            const p = project(b.projectId);
            return (
              <button key={b.id} role="tab" aria-selected={b.id === board.id} className={b.id === board.id ? 'board-tab active' : 'board-tab'} onClick={() => setBoardId(b.id)}>
                {p ? <ProjectDot color={p.color} size={8} /> : <Kanban size={14} />}
                <span>{b.name}</span>
              </button>
            );
          })}
          <button className="board-tab add" onClick={() => setCreating(true)} disabled={freeProjects.length === 0} title={freeProjects.length === 0 ? 'У всех проектов уже есть доски' : 'Доска для проекта'}>
            <Plus size={14} />
            <span>Доска проекта</span>
          </button>
        </div>
        <button className="btn ghost" onClick={() => setSettings(true)}>
          <Pencil size={15} /> Колонки
        </button>
      </div>

      <div className="kanban" role="list" aria-label={`Доска «${board.name}»`}>
        {board.columns.map((col) => {
          const list = byColumn(col.id);
          // The dragged card stays in the DOM (the browser cancels a drag whose source disappears);
          // the line shows where it will land, counted among the other cards of the column.
          const items: React.ReactNode[] = [];
          let others = 0;
          const here = drag?.col === col.id;
          for (const t of list) {
            if (t.id !== drag?.id) {
              if (here && drag!.index === others) items.push(<div key="ph" className="drop-line" />);
              others++;
            }
            items.push(renderCard(t, col.id));
          }
          if (here && drag!.index >= others) items.push(<div key="ph" className="drop-line" />);
          return (
            <section key={col.id} role="listitem" className={`kcol ${drag?.col === col.id ? 'over' : ''}`} aria-label={col.name} onDragOver={(e) => onDragOver(e, col.id)} onDrop={onDrop} onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, items: [{ label: 'Добавить карточку', icon: <Plus size={15} />, onClick: () => setAdding(col.id) }] }); }}>
              <header className="kcol-head">
                <h3>{col.name}</h3>
                <span className="count">{list.length}</span>
              </header>
              <div className="kcol-body">
                {items}
                {list.length === 0 && !drag && adding !== col.id && <p className="kcol-empty muted">Пусто</p>}
              </div>
              {adding === col.id ? (
                <QuickAdd onSubmit={(t) => void addTask(col.id, t)} onCancel={() => setAdding(null)} />
              ) : (
                <button className="kcol-add" onClick={() => setAdding(col.id)}>
                  <Plus size={15} /> Добавить карточку
                </button>
              )}
            </section>
          );
        })}
      </div>

      {tasks.length === 0 && (
        <Empty icon={<Kanban size={28} />} title="Пока ни одной карточки">
          Добавьте карточку в любую колонку.
        </Empty>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {open && <TaskDialog key={open.id} task={open} board={board} onClose={() => setOpenId(null)} onToggleTimer={() => toggleTimer(open)} />}
      {settings && <BoardDialog board={board} onClose={() => setSettings(false)} onDeleted={() => setBoardId('general')} />}
      {creating && (
        <NewBoardDialog
          projects={freeProjects}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setBoardId(id);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}

function QuickAdd({ onSubmit, onCancel }: { onSubmit: (title: string) => void; onCancel: () => void }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <form
      className="quick-add"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(text);
        setText('');
      }}
    >
      <input ref={ref} value={text} placeholder="Название задачи" aria-label="Название новой задачи" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onCancel()} onBlur={() => !text.trim() && onCancel()} />
      <div className="row gap">
        <button className="btn primary" type="submit">
          Добавить
        </button>
        <button className="btn ghost" type="button" onMouseDown={(e) => e.preventDefault()} onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  );
}

/* ---------------- card ---------------- */

/** Plain text with links made clickable. */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
            {p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

type Feed = 'all' | 'comments' | 'history' | 'time';

function TaskDialog({ task, board, onClose, onToggleTimer }: { task: Task; board: Board; onClose: () => void; onToggleTimer: () => void }) {
  const { state, run, now, tz } = useApp();
  const [title, setTitle] = useState(task.title);
  const [editingDesc, setEditingDesc] = useState(false);
  const [desc, setDesc] = useState(task.description);
  const [newItem, setNewItem] = useState('');
  const [comment, setComment] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [feed, setFeed] = useState<Feed>('all');
  const [estimate, setEstimate] = useState(task.estimate ? formatHM(task.estimate) : '');
  const known = useMemo(() => [...new Set([...state.entries.flatMap((e) => e.tags), ...state.tasks.flatMap((t) => t.tags)])], [state.entries, state.tasks]);
  const column = board.columns.find((c) => c.id === task.columnId);

  useEffect(() => setTitle(task.title), [task.title]);
  useEffect(() => setEstimate(task.estimate ? formatHM(task.estimate) : ''), [task.estimate]);

  const entries = state.entries.filter((e) => e.taskId === task.id).sort((a, b) => (a.start < b.start ? 1 : -1));
  const spent = entries.reduce((n, e) => n + entrySeconds(e, now), 0);
  const isRunning = entries.some((e) => e.end === null);
  const items = task.checklist;
  const done = items.filter((i) => i.done).length;

  const patch = (p: TaskInput) => run(() => api.updateTask(task.id, p));
  const at = (iso: string) => `${formatDayRu(dayKey(iso, tz)).replace(/ \d{4}$/, '')}, ${isoToLocalTime(iso, tz)}`;

  const saveTitle = () => {
    const t = title.trim();
    if (!t) return setTitle(task.title);
    if (t !== task.title) void patch({ title: t });
  };
  const saveEstimate = () => {
    const text = estimate.trim();
    if (!text) return void (task.estimate !== null && patch({ estimate: null }));
    const sec = parseDuration(text);
    if (sec === null) return setEstimate(task.estimate ? formatHM(task.estimate) : '');
    if (sec !== (task.estimate ?? 0)) void patch({ estimate: sec });
    else setEstimate(task.estimate ? formatHM(task.estimate) : '');
  };
  const setItems = (next: Task['checklist']) => void patch({ checklist: next });
  const addItem = () => {
    const text = newItem.trim();
    if (!text) return;
    setNewItem('');
    setItems([...items, { id: '', text, done: false }]);
  };
  const addComment = async () => {
    const text = comment.trim();
    if (!text) return;
    if (await run(() => api.addComment(task.id, text))) setComment('');
  };
  const remove = async () => {
    const ok = await confirmDialog({
      title: 'Удалить задачу?',
      text: entries.length ? 'Записи времени останутся в истории, но перестанут быть связаны с карточкой.' : 'Это действие нельзя отменить.',
      confirmLabel: 'Удалить',
      danger: true
    });
    if (ok && (await run(() => api.deleteTask(task.id)))) onClose();
  };
  const duplicate = () => void run(async () => (await api.duplicateTask(task.id)).state);

  type Row = { key: string; at: string; kind: Feed; node: React.ReactNode };
  const rows: Row[] = [];
  for (const c of task.comments)
    rows.push({
      key: `c${c.id}`,
      at: c.at,
      kind: 'comments',
      node: (
        <div className="feed-comment">
          <span className="avatar" aria-hidden>
            Я
          </span>
          <div className="feed-body">
            <div className="feed-meta">
              <strong>Вы</strong>
              <small className="muted">
                {at(c.at)}
                {c.editedAt ? ' · изменён' : ''}
              </small>
            </div>
            {editing?.id === c.id ? (
              <div className="form-stack">
                <textarea rows={3} autoFocus value={editing.text} onChange={(e) => setEditing({ id: c.id, text: e.target.value })} />
                <div className="row gap">
                  <button
                    className="btn primary"
                    onClick={async () => {
                      if (editing.text.trim() && (await run(() => api.editComment(task.id, c.id, editing.text)))) setEditing(null);
                    }}
                  >
                    Сохранить
                  </button>
                  <button className="btn ghost" onClick={() => setEditing(null)}>
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="feed-text">
                  <Linkified text={c.text} />
                </p>
                <div className="feed-actions">
                  <button className="linkbtn" onClick={() => setEditing({ id: c.id, text: c.text })}>
                    Изменить
                  </button>
                  <button className="linkbtn danger" onClick={() => void run(() => api.deleteComment(task.id, c.id))}>
                    Удалить
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )
    });
  for (const a of task.activity)
    rows.push({
      key: `a${a.id}`,
      at: a.at,
      kind: 'history',
      node: (
        <div className="feed-log">
          <i className="feed-dot" />
          <span>{a.text}</span>
          <small className="muted">{at(a.at)}</small>
        </div>
      )
    });
  for (const e of entries)
    rows.push({
      key: `t${e.id}`,
      at: e.start,
      kind: 'time',
      node: (
        <div className="feed-log">
          <Clock size={14} />
          <span>
            {e.end ? `Записано ${formatHM(entrySeconds(e, now))}` : 'Таймер идёт'} · {isoToLocalTime(e.start, tz)}–{e.end ? isoToLocalTime(e.end, tz) : '…'}
          </span>
          <small className="muted">{at(e.start)}</small>
        </div>
      )
    });
  const shown = rows.filter((r) => feed === 'all' || r.kind === feed).sort((a, b) => (a.at < b.at ? 1 : -1));

  const pct = task.estimate ? Math.min(100, (spent / task.estimate) * 100) : 0;
  const over = task.estimate !== null && spent > task.estimate;

  return (
    <Dialog title={`${board.name} · #${task.num}`} onClose={onClose} wide className="task-dialog">
      <div className="task-layout">
        <div className="task-main">
          <input
            className="task-title-input"
            aria-label="Название задачи"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setTitle(task.title);
            }}
          />

          <div className="task-actions">
            <button className={isRunning ? 'btn danger-solid' : 'btn primary'} onClick={onToggleTimer}>
              {isRunning ? <Square size={14} solid /> : <Play size={14} solid />}
              {isRunning ? 'Остановить таймер' : 'Запустить таймер'}
            </button>
            <div className="task-status">
              <Select<string> value={task.columnId} ariaLabel="Колонка" options={board.columns.map((c) => ({ value: c.id, label: c.name }))} onChange={(columnId) => void run(() => api.moveTask(task.id, columnId))} />
            </div>
            <button className={task.completed ? 'btn done-on' : 'btn'} aria-pressed={task.completed} onClick={() => void patch({ completed: !task.completed })}>
              <Check size={15} /> {task.completed ? 'Выполнена' : 'Отметить выполненной'}
            </button>
            <button className="btn ghost" onClick={duplicate} title="Создать копию">
              <Copy size={15} /> Копия
            </button>
            <button className="btn ghost danger" onClick={() => void remove()}>
              <Trash size={15} />
              <span className="sr-only">Удалить задачу</span>
            </button>
          </div>

          <section className="task-section">
            <h4>Описание</h4>
            {editingDesc ? (
              <div className="form-stack">
                <textarea rows={6} autoFocus value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Подробности, ссылки, критерии готовности" aria-label="Описание" />
                <div className="row gap">
                  <button
                    className="btn primary"
                    onClick={async () => {
                      if (desc === task.description || (await patch({ description: desc }))) setEditingDesc(false);
                    }}
                  >
                    Сохранить
                  </button>
                  <button
                    className="btn ghost"
                    onClick={() => {
                      setDesc(task.description);
                      setEditingDesc(false);
                    }}
                  >
                    Отмена
                  </button>
                </div>
              </div>
            ) : task.description ? (
              <div
                className="desc-view"
                role="button"
                tabIndex={0}
                aria-label="Изменить описание"
                onClick={() => {
                  setDesc(task.description);
                  setEditingDesc(true);
                }}
                onKeyDown={(e) => e.key === 'Enter' && (setDesc(task.description), setEditingDesc(true))}
              >
                <Linkified text={task.description} />
              </div>
            ) : (
              <button
                className="desc-empty"
                onClick={() => {
                  setDesc('');
                  setEditingDesc(true);
                }}
              >
                Добавить описание…
              </button>
            )}
          </section>

          <section className="task-section">
            <h4>
              Чек-лист {items.length > 0 && <em className="muted">· {done} из {items.length}</em>}
            </h4>
            {items.length > 0 && (
              <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done} aria-label="Выполнено пунктов">
                <i style={{ width: `${(done / items.length) * 100}%` }} />
              </div>
            )}
            <ul className="checklist">
              {items.map((i) => (
                <li key={i.id} className={i.done ? 'done' : ''}>
                  <label className="check">
                    <input type="checkbox" checked={i.done} onChange={() => setItems(items.map((x) => (x.id === i.id ? { ...x, done: !x.done } : x)))} />
                    <span>{i.text}</span>
                  </label>
                  <button className="btn icon ghost danger" aria-label={`Убрать пункт «${i.text}»`} onClick={() => setItems(items.filter((x) => x.id !== i.id))}>
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
            <div className="row gap">
              <input
                value={newItem}
                placeholder="Новый пункт"
                aria-label="Новый пункт чек-листа"
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addItem();
                  }
                }}
              />
              <button className="btn" type="button" onClick={addItem}>
                Добавить
              </button>
            </div>
          </section>

          <section className="task-section">
            <div className="row between wrap gap">
              <h4>Активность</h4>
              <Segmented<Feed>
                label="Показать"
                value={feed}
                onChange={setFeed}
                options={[
                  { value: 'all', label: 'Всё' },
                  { value: 'comments', label: `Комментарии${task.comments.length ? ` ${task.comments.length}` : ''}` },
                  { value: 'history', label: 'История' },
                  { value: 'time', label: 'Время' }
                ]}
              />
            </div>
            <div className="feed-new">
              <span className="avatar" aria-hidden>
                Я
              </span>
              <div className="form-stack">
                <textarea
                  rows={comment ? 3 : 1}
                  value={comment}
                  placeholder="Написать комментарий…"
                  aria-label="Новый комментарий"
                  onChange={(e) => setComment(e.target.value)}
                  onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && void addComment()}
                />
                {comment.trim() && (
                  <div className="row gap">
                    <button className="btn primary" onClick={() => void addComment()}>
                      Отправить
                    </button>
                    <small className="muted">Ctrl+Enter</small>
                  </div>
                )}
              </div>
            </div>
            <ul className="feed">
              {shown.map((r) => (
                <li key={r.key}>{r.node}</li>
              ))}
              {shown.length === 0 && <li className="muted small">Пока ничего нет.</li>}
            </ul>
          </section>
        </div>

        <aside className="task-side">
          <h4>Детали</h4>
          <dl className="details">
            <dt>Колонка</dt>
            <dd>{column?.name ?? '—'}</dd>
            <dt>Приоритет</dt>
            <dd>
              <Select<Priority> value={task.priority} ariaLabel="Приоритет" options={(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} onChange={(priority) => void patch({ priority })} />
            </dd>
            <dt>Срок</dt>
            <dd className="row gap">
              <DateField value={task.dueDate ?? ''} onChange={(dueDate) => void patch({ dueDate })} ariaLabel="Срок" />
              {task.dueDate && (
                <button className="btn icon ghost" aria-label="Убрать срок" onClick={() => void patch({ dueDate: null })}>
                  <X size={14} />
                </button>
              )}
            </dd>
            <dt>Проект</dt>
            <dd>
              {board.projectId ? <span className="proj-cell">{(() => { const p = state.projects.find((x) => x.id === board.projectId); return p ? <><ProjectDot color={p.color} />{p.name}</> : null; })()}</span> : <ProjectPicker projects={state.projects} value={task.projectId} onChange={(projectId) => void patch({ projectId })} includeId={task.projectId} />}
            </dd>
            <dt>Теги</dt>
            <dd>
              <TagPicker value={task.tags} known={known} onChange={(tags) => void patch({ tags })} />
            </dd>
          </dl>

          <h4>Учёт времени</h4>
          <div className="timetrack">
            <div className="progress tall" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Затрачено от оценки">
              <i className={over ? 'over' : ''} style={{ width: `${task.estimate ? pct : spent > 0 ? 100 : 0}%` }} />
            </div>
            <div className="row between">
              <span>
                <strong>{formatHM(spent)}</strong> <small className="muted">затрачено</small>
              </span>
              <small className={over ? 'late-text' : 'muted'}>{task.estimate ? `из ${formatHM(task.estimate)}` : 'без оценки'}</small>
            </div>
            <label className="field">
              <span>Оценка</span>
              <input
                value={estimate}
                placeholder="например 2ч 30м"
                aria-label="Оценка времени"
                onChange={(e) => setEstimate(e.target.value)}
                onBlur={saveEstimate}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            </label>
            {entries.length > 0 && <small className="muted">Записей времени: {entries.length}</small>}
          </div>

          <p className="muted small details-foot">
            Создана {at(task.createdAt)}
            <br />
            Обновлена {at(task.updatedAt || task.createdAt)}
          </p>
        </aside>
      </div>
    </Dialog>
  );
}

/* ---------------- boards ---------------- */

function NewBoardDialog({ projects, onClose, onCreated }: { projects: Array<{ id: string; name: string }>; onClose: () => void; onCreated: (id: string) => void }) {
  const { state, setState, fail } = useApp();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const create = async () => {
    try {
      const r = await api.createBoard({ projectId });
      setState(r.state);
      onCreated(r.id);
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  };
  void state;
  return (
    <Dialog title="Доска проекта" onClose={onClose}>
      <div className="form-stack">
        <p className="muted small">Одна доска на проект. Карточки на ней относятся к этому проекту.</p>
        <label className="field">
          <span>Проект</span>
          <Select<string> value={projectId} ariaLabel="Проект" options={projects.map((p) => ({ value: p.id, label: p.name }))} onChange={setProjectId} />
        </label>
        <div className="row end gap">
          <button className="btn ghost" onClick={onClose}>
            Отмена
          </button>
          <button className="btn primary" disabled={!projectId} onClick={() => void create()}>
            Создать доску
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function BoardDialog({ board, onClose, onDeleted }: { board: Board; onClose: () => void; onDeleted: () => void }) {
  const { state, run } = useApp();
  const [name, setName] = useState(board.name);
  const [cols, setCols] = useState<Array<{ id?: string; name: string }>>(board.columns);
  const [error, setError] = useState<string | null>(null);
  const count = (id?: string) => (id ? state.tasks.filter((t) => t.boardId === board.id && t.columnId === id).length : 0);
  const move = (i: number, d: number) => {
    const next = [...cols];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setCols(next);
  };
  const removeCol = async (i: number) => {
    const n = count(cols[i].id);
    if (cols.length === 1) return setError('На доске нужна хотя бы одна колонка.');
    if (n > 0 && !(await confirmDialog({ title: `Удалить колонку «${cols[i].name}»?`, text: `Карточки (${n}) перейдут в первую из оставшихся колонок.`, confirmLabel: 'Удалить', danger: true }))) return;
    setCols(cols.filter((_, k) => k !== i));
  };
  const save = async () => {
    if (!name.trim() || cols.some((c) => !c.name.trim())) return setError('У доски и колонок должны быть названия.');
    const ok = await run(() => api.updateBoard(board.id, { name, columns: cols.map((c) => ({ ...c, name: c.name.trim() })) }));
    if (ok) onClose();
  };
  const removeBoard = async () => {
    const n = state.tasks.filter((t) => t.boardId === board.id).length;
    const ok = await confirmDialog({ title: `Удалить доску «${board.name}»?`, text: n ? `Вместе с ней удалятся карточки (${n}). Записи времени останутся в истории.` : undefined, confirmLabel: 'Удалить', danger: true });
    if (ok && (await run(() => api.deleteBoard(board.id)))) {
      onDeleted();
      onClose();
    }
  };
  return (
    <Dialog title="Настройка доски" onClose={onClose}>
      <div className="form-stack">
        <label className="field">
          <span>Название доски</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="field">
          <span>Колонки</span>
          <ul className="col-edit">
            {cols.map((c, i) => (
              <li key={c.id ?? `n${i}`}>
                <input value={c.name} aria-label={`Колонка ${i + 1}`} onChange={(e) => setCols(cols.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
                <button className="btn icon ghost" aria-label="Выше (левее)" disabled={i === 0} onClick={() => move(i, -1)}>
                  <ChevronDown size={14} className="rot-up" />
                </button>
                <button className="btn icon ghost" aria-label="Ниже (правее)" disabled={i === cols.length - 1} onClick={() => move(i, 1)}>
                  <ChevronDown size={14} />
                </button>
                <button className="btn icon ghost danger" aria-label="Удалить колонку" onClick={() => void removeCol(i)}>
                  <Trash size={14} />
                </button>
              </li>
            ))}
          </ul>
          <button className="btn" type="button" onClick={() => setCols([...cols, { name: '' }])} disabled={cols.length >= 12}>
            <Plus size={14} /> Добавить колонку
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row between gap">
          {board.id !== 'general' ? (
            <button className="btn ghost danger" onClick={() => void removeBoard()}>
              <Trash size={15} /> Удалить доску
            </button>
          ) : (
            <span />
          )}
          <div className="row gap">
            <button className="btn ghost" onClick={onClose}>
              Отмена
            </button>
            <button className="btn primary" onClick={() => void save()}>
              Сохранить
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

void Flag;
void Tag;
