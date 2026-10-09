import type { Entry, State } from '../shared/types.js';

/**
 * Actions that keep working without a connection: start, stop and adding time by hand.
 * Each carries an id made in the browser and the moment the user acted, so the server can
 * recognise a request it already applied and keeps the real time, not the time of delivery.
 */
export type Op =
  | { kind: 'start'; id: string; at: string; description: string; projectId: string | null; tags: string[]; billable: boolean; taskId?: string | null }
  | { kind: 'stop'; id: string; at: string }
  | { kind: 'add'; id: string; description: string; projectId: string | null; tags: string[]; billable: boolean; start: string; end: string };

const QUEUE_KEY = 'tempo.queue.v1';
const CACHE_KEY = 'tempo.state.cache.v1';

export const newId = (): string => {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

/** What the screen shows: the server's data with the not-yet-sent actions applied. Applying twice changes nothing. */
export function applyQueue(state: State, ops: Op[]): State {
  if (ops.length === 0) return state;
  const entries: Entry[] = state.entries.map((e) => ({ ...e }));
  const byId = (id: string) => entries.find((e) => e.id === id);
  const closeAt = (e: Entry, at: string) => {
    e.end = Date.parse(at) > Date.parse(e.start) ? at : e.start;
  };
  for (const op of ops) {
    if (op.kind === 'start') {
      if (byId(op.id)) continue;
      const running = entries.find((e) => e.end === null);
      if (running) closeAt(running, op.at);
      entries.push({ id: op.id, description: op.description, projectId: op.projectId, tags: op.tags, billable: op.billable, start: op.at, end: null, source: 'timer', ...(op.taskId ? { taskId: op.taskId } : {}) });
    } else if (op.kind === 'stop') {
      const target = op.id ? byId(op.id) : entries.find((e) => e.end === null);
      if (target && target.end === null) closeAt(target, op.at);
    } else if (!byId(op.id)) {
      entries.push({ id: op.id, description: op.description, projectId: op.projectId, tags: op.tags, billable: op.billable, start: op.start, end: op.end, source: 'manual' });
    }
  }
  return { ...state, entries };
}

/** Removes an action that has not been sent yet (and the stop that belonged to it), e.g. a discarded accidental start. */
export function dropOpsFor(ops: Op[], entryId: string): Op[] {
  return ops.filter((o) => o.id !== entryId);
}

const read = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or full: the queue then lives only until the tab closes */
  }
};

export const loadQueue = (): Op[] => read<Op[]>(QUEUE_KEY, []);
export const saveQueue = (ops: Op[]) => write(QUEUE_KEY, ops);

/** Last data seen from the server, so the app can open without a connection. */
export const loadCache = (): State | null => read<State | null>(CACHE_KEY, null);
export const saveCache = (state: State) => write(CACHE_KEY, state);
export function clearOffline() {
  try {
    localStorage.removeItem(QUEUE_KEY);
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* nothing to clear */
  }
}
