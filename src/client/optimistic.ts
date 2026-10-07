import type { State } from '../shared/types.js';

/** Local previews of what the server is about to do, shown instantly while the request is in flight. */
export type Optimistic = (s: State) => State;

const nowIso = () => new Date().toISOString();

export const optStop = (): Optimistic => {
  const end = nowIso();
  return (s) => ({ ...s, entries: s.entries.map((e) => (e.end === null ? { ...e, end } : e)) });
};

export const optStart = (description: string, projectId: string | null, tags: string[], billable: boolean): Optimistic => {
  const start = nowIso();
  return (s) => ({
    ...s,
    entries: [
      ...s.entries.map((e) => (e.end === null ? { ...e, end: start } : e)),
      { id: `tmp-${start}`, description, projectId, tags, billable, start, end: null, source: 'timer' as const }
    ]
  });
};

export const optRemove = (id: string): Optimistic => (s) => ({ ...s, entries: s.entries.filter((e) => e.id !== id) });
