import type { Client, InvoiceRecord, Profile, State } from '../shared/types.js';

/** Minutes EAST of UTC for the browser's current timezone (UTC+4 -> 240). */
export const tzOffset = () => -new Date().getTimezoneOffset();

/** The request never reached the server (offline, server down): safe to try again later. */
export class NetworkError extends Error {}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new NetworkError('Нет связи с сервером трекера.');
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
  clientId?: string | null;
}

export type ClientInput = Partial<Pick<Client, 'name' | 'email' | 'address' | 'taxId' | 'currency' | 'dueDays' | 'notes' | 'archived'>>;

export interface InvoiceInput {
  clientId: string | null;
  projectIds: string[];
  entryIds: string[];
  number?: string;
  status?: 'draft' | 'sent';
  lang: 'ru' | 'en';
  currency: string;
  issueDate: string;
  dueDate: string;
  periodFrom: string;
  periodTo: string;
  sender: Profile['sender'];
  client: { name: string; address: string; email: string; taxId: string };
  lines: Array<{ description: string; hours: number; rate: number }>;
  discountPct: number;
  taxPct: number;
  notes: string;
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

export interface BackupInfo {
  id: string;
  at: string;
  entries: number;
  projects: number;
}

export const api = {
  createClient: (c: ClientInput) => req<State>('POST', '/api/clients', c),
  updateClient: (id: string, c: ClientInput) => req<State>('PUT', `/api/clients/${id}`, c),
  deleteClient: (id: string) => req<State>('DELETE', `/api/clients/${id}`),
  saveProfile: (p: Partial<Profile>) => req<State>('PUT', '/api/profile', p),
  createInvoice: (b: InvoiceInput) => req<{ invoice: InvoiceRecord; state: State }>('POST', '/api/invoices', b),
  updateInvoice: (id: string, patch: { status?: 'draft' | 'sent' | 'paid'; dueDate?: string; notes?: string }) => req<State>('PUT', `/api/invoices/${id}`, patch),
  deleteInvoice: (id: string) => req<State>('DELETE', `/api/invoices/${id}`),
  backups: () => req<BackupInfo[]>('GET', '/api/backups'),
  createBackup: () => req<BackupInfo>('POST', '/api/backups'),
  restoreBackup: (id: string) => req<{ state: State; savedAs: string }>('POST', `/api/backups/${id}/restore`),
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
  startTimer: (description: string, projectId: string | null, tags: string[] = [], billable = true, own?: { id: string; at: string }) =>
    req<State>('POST', '/api/timer/start', { description, projectId, tags, billable, ...own }),
  stopTimer: (own?: { id: string; at: string }) => req<State>('POST', '/api/timer/stop', own ?? {}),
  addEntry: (e: {
    id?: string;
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
