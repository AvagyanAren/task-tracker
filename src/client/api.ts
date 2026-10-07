import type { State } from '../shared/types.js';

/** Minutes EAST of UTC for the browser's current timezone (UTC+4 -> 240). */
export const tzOffset = () => -new Date().getTimezoneOffset();

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new Error('Нет связи с сервером трекера. Запущен ли start.bat?');
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  // The session expired (or the password changed): the app shows the login screen.
  if (res.status === 401 && path !== '/api/login') window.dispatchEvent(new Event('tempo:unauthorized'));
  if (!res.ok) {
    const msg = (data as { error?: string } | undefined)?.error;
    throw new Error(msg ?? `Ошибка сервера (${res.status}).`);
  }
  return data as T;
}

export interface ProjectInput {
  name?: string;
  rate?: number;
  currency?: string;
  color?: string;
  archived?: boolean;
}

export interface ImportSummary {
  totalRows: number;
  newEntries: number;
  duplicates: number;
  zeroLength: number;
  newProjects: string[];
  newSeconds: number;
  from: string | null;
  to: string | null;
}

export interface SessionInfo {
  authRequired: boolean;
  authenticated: boolean;
}

export interface RestoreResult {
  mode: 'merge' | 'replace';
  summary: { projects: number; entries: number; skipped: number };
  state: State;
}

export const api = {
  session: () => req<SessionInfo>('GET', '/api/session'),
  login: (password: string) => req<SessionInfo>('POST', '/api/login', { password }),
  logout: () => req<SessionInfo>('POST', '/api/logout'),
  /** Full database as an object, to save as a backup file. */
  backup: () => req<State>('GET', '/api/backup'),
  restore: (state: unknown, mode: 'merge' | 'replace') => req<RestoreResult>('POST', '/api/restore', { state, mode }),
  state: () => req<State>('GET', '/api/state'),
  createProject: (p: ProjectInput) => req<State>('POST', '/api/projects', p),
  updateProject: (id: string, p: ProjectInput) => req<State>('PUT', `/api/projects/${id}`, p),
  deleteProject: (id: string) => req<State>('DELETE', `/api/projects/${id}`),
  startTimer: (description: string, projectId: string | null, tags: string[] = [], billable = true) =>
    req<State>('POST', '/api/timer/start', { description, projectId, tags, billable }),
  stopTimer: () => req<State>('POST', '/api/timer/stop'),
  addEntry: (e: {
    description: string;
    projectId: string | null;
    start: string;
    end: string;
    tags?: string[];
    billable?: boolean;
  }) => req<State>('POST', '/api/entries', e),
  updateEntry: (
    id: string,
    e: {
      description?: string;
      projectId?: string | null;
      start?: string;
      end?: string | null;
      tags?: string[];
      billable?: boolean;
    }
  ) => req<State>('PUT', `/api/entries/${id}`, e),
  deleteEntry: (id: string) => req<State>('DELETE', `/api/entries/${id}`),
  importPreview: (csv: string) =>
    req<{ summary: ImportSummary }>('POST', '/api/import/toggl', { csv, tzOffsetMinutes: tzOffset(), dryRun: true }),
  importToggl: (csv: string) =>
    req<{ summary: ImportSummary; state: State }>('POST', '/api/import/toggl', { csv, tzOffsetMinutes: tzOffset() })
};
