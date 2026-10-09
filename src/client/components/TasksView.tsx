import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { Board, Priority, Task } from '../../shared/types.js';
import { entrySeconds } from '../../shared/report.js';
import { dayKey, formatHM } from '../../shared/time.js';
import { api } from '../api.js';
import { confirmDialog } from '../confirm.js';
import { useApp } from '../ctx.js';
import { Check, CheckList, ChevronDown, Comment, Flag, Kanban, Pencil, Play, Plus, Square, Tag, Trash, X } from '../icons.js';
import { optMoveTask } from '../optimistic.js';
import { Dialog, Empty, ProjectDot } from '../ui.js';
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
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setOpenId(t.id);
          }
        }}
      >
        <div className="task-title">
          {t.priority !== 'none' && <span className={`prio ${t.priority}`} title={PRIORITY_LABEL[t.priority]} />}
          <span>{t.title}</span>
        </div>
        {(p || t.tags.length > 0) && (
          <div className="task-tags">
            {p && (
              <span className="proj" style={{ color: p.color }}>
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
          <DueBadge task={t} today={today} done={done} />
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
          {(spent > 0 || isRunning) && <span className={`task-meta time ${isRunning ? 'live' : ''}`}>{formatHM(spent)}</span>}
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
        </div>
      </div>
    );
  };

  return (
    <div className="page tasks-page">
      <header className="page-head">
        <div>
          <h1>Задачи</h1>
          <p className="muted">Карточки не запускают таймер сами: время идёт, только когда вы нажмёте ▶ на карточке.</p>
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
            <section key={col.id} role="listitem" className={`kcol ${drag?.col === col.id ? 'over' : ''}`} aria-label={col.name} onDragOver={(e) => onDragOver(e, col.id)} onDrop={onDrop}>
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
          Нажмите «Добавить карточку» в любой колонке. Тут же можно запустить таймер: он попадёт в историю и отчёты с названием карточки.
        </Empty>
      )}

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

function TaskDialog({ task, board, onClose, onToggleTimer }: { task: Task; board: Board; onClose: () => void; onToggleTimer: () => void }) {
  const { state, run, now, tz } = useApp();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [dueDate, setDueDate] = useState(task.dueDate ?? '');
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [tags, setTags] = useState(task.tags);
  const [projectId, setProjectId] = useState<string | null>(task.projectId);
  const [columnId, setColumnId] = useState(task.columnId);
  const [items, setItems] = useState(task.checklist);
  const [newItem, setNewItem] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const known = useMemo(() => [...new Set([...state.entries.flatMap((e) => e.tags), ...state.tasks.flatMap((t) => t.tags)])], [state.entries, state.tasks]);

  // The card reflects later server changes of the parts saved at once (comments).
  const live = state.tasks.find((t) => t.id === task.id) ?? task;
  const entries = state.entries.filter((e) => e.taskId === task.id).sort((a, b) => (a.start < b.start ? 1 : -1));
  const spent = entries.reduce((n, e) => n + entrySeconds(e, now), 0);
  const isRunning = entries.some((e) => e.end === null);

  const dirty =
    title !== task.title ||
    description !== task.description ||
    (dueDate || null) !== task.dueDate ||
    priority !== task.priority ||
    JSON.stringify(tags) !== JSON.stringify(task.tags) ||
    projectId !== task.projectId ||
    columnId !== task.columnId ||
    JSON.stringify(items.map(({ text, done }) => ({ text, done }))) !== JSON.stringify(task.checklist.map(({ text, done }) => ({ text, done })));

  const close = async () => {
    if (dirty && !(await confirmDialog({ title: 'Закрыть без сохранения?', text: 'Изменения в карточке пропадут.', confirmLabel: 'Закрыть', danger: true }))) return;
    onClose();
  };

  const save = async () => {
    if (!title.trim()) return setError('Укажите название задачи.');
    setError(null);
    const ok = await run(async () => {
      let s = await api.updateTask(task.id, { title, description, dueDate: dueDate || null, priority, tags, projectId, checklist: items });
      if (columnId !== task.columnId) s = await api.moveTask(task.id, columnId);
      return s;
    });
    if (ok) onClose();
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

  const addItem = () => {
    const text = newItem.trim();
    if (!text) return;
    setItems([...items, { id: `new-${items.length}-${Date.now()}`, text, done: false }]);
    setNewItem('');
  };
  const addComment = async () => {
    const text = comment.trim();
    if (!text) return;
    if (await run(() => api.addComment(task.id, text))) setComment('');
  };
  const done = items.filter((i) => i.done).length;

  return (
    <Dialog title="Задача" onClose={() => void close()} wide className="task-dialog">
      <div className="task-layout">
        <div className="form-stack">
          <label className="field">
            <span>Название</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="field">
            <span>Описание</span>
            <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Подробности, ссылки, критерии готовности" />
          </label>

          <div className="field">
            <span>
              Чек-лист {items.length > 0 && <em className="muted">· {done}/{items.length}</em>}
            </span>
            {items.length > 0 && (
              <div className="progress" aria-hidden>
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
                  <button className="btn icon ghost danger" aria-label="Убрать пункт" onClick={() => setItems(items.filter((x) => x.id !== i.id))}>
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
          </div>

          <div className="field">
            <span>Комментарии</span>
            <ul className="comments">
              {[...live.comments].reverse().map((c) => (
                <li key={c.id}>
                  <div className="comment-head">
                    <small className="muted">{formatDayRu(dayKey(c.at, tz))}, {new Date(c.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</small>
                    <button className="btn icon ghost danger" aria-label="Удалить комментарий" onClick={() => void run(() => api.deleteComment(task.id, c.id))}>
                      <Trash size={13} />
                    </button>
                  </div>
                  <p>{c.text}</p>
                </li>
              ))}
            </ul>
            <div className="row gap">
              <input value={comment} placeholder="Написать комментарий" aria-label="Новый комментарий" onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void addComment())} />
              <button className="btn" type="button" onClick={() => void addComment()}>
                Отправить
              </button>
            </div>
          </div>
        </div>

        <aside className="task-side form-stack">
          <div className="task-timer">
            <div>
              <small className="muted">Затрачено</small>
              <strong>{formatHM(spent)}</strong>
              {entries.length > 0 && <small className="muted"> · {entries.length} записей</small>}
            </div>
            <button className={isRunning ? 'btn danger-solid' : 'btn primary'} onClick={onToggleTimer}>
              {isRunning ? <Square size={14} solid /> : <Play size={14} solid />}
              {isRunning ? 'Остановить' : 'Запустить таймер'}
            </button>
          </div>

          <label className="field">
            <span>Колонка</span>
            <Select<string> value={columnId} ariaLabel="Колонка" options={board.columns.map((c) => ({ value: c.id, label: c.name }))} onChange={setColumnId} />
          </label>
          <label className="field">
            <span>Приоритет</span>
            <Select<Priority> value={priority} ariaLabel="Приоритет" options={(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} onChange={setPriority} />
          </label>
          <div className="field">
            <span>Срок</span>
            <div className="row gap">
              <DateField value={dueDate} onChange={setDueDate} ariaLabel="Срок" />
              {dueDate && (
                <button className="btn icon ghost" aria-label="Убрать срок" onClick={() => setDueDate('')}>
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
          <div className="field">
            <span>Проект</span>
            {board.projectId ? (
              <p className="muted small">Задана доской проекта.</p>
            ) : (
              <ProjectPicker projects={state.projects} value={projectId} onChange={setProjectId} includeId={task.projectId} />
            )}
          </div>
          <div className="field">
            <span>Теги</span>
            <TagPicker value={tags} known={known} onChange={setTags} />
          </div>
        </aside>
      </div>

      {error && <p className="error">{error}</p>}
      <div className="row between gap dialog-foot">
        <button className="btn ghost danger" onClick={() => void remove()}>
          <Trash size={15} /> Удалить
        </button>
        <div className="row gap">
          <button className="btn ghost" onClick={() => void close()}>
            Отмена
          </button>
          <button className="btn primary" onClick={() => void save()}>
            <Check size={15} /> Сохранить
          </button>
        </div>
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
        <p className="muted small">У каждого проекта может быть одна своя доска. Карточки на ней автоматически относятся к этому проекту. Общая доска есть всегда.</p>
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
