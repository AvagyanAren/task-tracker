import type { State } from '../shared/types.js';

/** Local previews of what the server is about to do, shown instantly while the request is in flight. */
export type Optimistic = (s: State) => State;

const nowIso = () => new Date().toISOString();

export const optStop = (): Optimistic => {
  const end = nowIso();
  return (s) => ({ ...s, entries: s.entries.map((e) => (e.end === null ? { ...e, end } : e)) });
};

export const optStart = (description: string, projectId: string | null, tags: string[], billable: boolean, taskId?: string | null): Optimistic => {
  const start = nowIso();
  return (s) => ({
    ...s,
    entries: [
      ...s.entries.map((e) => (e.end === null ? { ...e, end: start } : e)),
      { id: `tmp-${start}`, description, projectId, tags, billable, start, end: null, source: 'timer' as const, ...(taskId ? { taskId } : {}) }
    ]
  });
};

export const optRemove = (id: string): Optimistic => (s) => ({ ...s, entries: s.entries.filter((e) => e.id !== id) });

/** Same placement rule as the server: the card goes to `index` of the column, the rest are renumbered. */
export const optMoveTask =
  (taskId: string, columnId: string, index: number): Optimistic =>
  (s) => {
    const t = s.tasks.find((x) => x.id === taskId);
    if (!t) return s;
    const from = t.columnId;
    const target = s.tasks.filter((x) => x.boardId === t.boardId && x.columnId === columnId && x.id !== taskId).sort((a, b) => a.order - b.order);
    target.splice(Math.min(Math.max(index, 0), target.length), 0, t);
    const order = new Map(target.map((x, i) => [x.id, i]));
    if (from !== columnId) {
      s.tasks
        .filter((x) => x.boardId === t.boardId && x.columnId === from && x.id !== taskId)
        .sort((a, b) => a.order - b.order)
        .forEach((x, i) => order.set(x.id, i));
    }
    return { ...s, tasks: s.tasks.map((x) => (x.id === taskId ? { ...x, columnId, order: order.get(x.id)! } : order.has(x.id) ? { ...x, order: order.get(x.id)! } : x)) };
  };
