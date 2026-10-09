import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { State } from '../shared/types.js';
import { generalBoard } from '../shared/blank.js';

export interface BackupInfo {
  /** `YYYY-MM-DD` for the daily copy, `YYYY-MM-DDTHHMMSS` for manual and pre-restore copies. */
  id: string;
  at: string;
  entries: number;
  projects: number;
}

/** Point-in-time copies of the whole database, kept next to the data itself. */
export interface BackupStore {
  /** Snapshot now. `kind: 'daily'` overwrites today's copy, anything else gets its own id. */
  create(kind?: 'daily' | 'manual'): Promise<BackupInfo>;
  /** Newest first. */
  list(): Promise<BackupInfo[]>;
  read(id: string): Promise<State | null>;
}

/** How many copies are kept before the oldest are dropped. */
export const KEEP_BACKUPS = 20;

export const backupId = (kind: 'daily' | 'manual', now = new Date()) =>
  kind === 'daily' ? now.toISOString().slice(0, 10) : now.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', 'T');

export const validBackupId = (id: string) => /^\d{4}-\d{2}-\d{2}$|^\d{8}T\d{6}$/.test(id);

/**
 * What the API needs from a database. The file store answers synchronously, the
 * Redis store asynchronously; the app awaits both, so either can be plugged in.
 */
export interface StateStore {
  /** Present when the storage can keep point-in-time copies. */
  backups?: BackupStore;
  get(): State | Promise<State>;
  /** Runs `fn` on a copy; the change is kept and saved only if it does not throw. */
  update<T>(fn: (draft: State) => T): T | Promise<T>;
}

/** Fills fields that older files do not have yet. */
export const emptyProfile = (): State['profile'] => ({
  sender: { name: '', address: '', email: '', payment: '' },
  lang: 'ru',
  dueDays: 14,
  notes: ''
});

export const emptyState = (): State => ({ projects: [], entries: [], clients: [], invoices: [], profile: emptyProfile(), boards: [generalBoard()], tasks: [] });

/** Keeps the general board present (older files and fresh databases have none). */
function boards(raw: unknown): State['boards'] {
  const list = Array.isArray(raw) ? (raw as State['boards']) : [];
  return list.some((b) => b.id === 'general') ? list : [generalBoard(), ...list];
}

export function normalize(raw: Partial<State>): State {
  const out = normalizeRaw(raw);
  // Cards from before numbering get a number in the order they were made.
  let max = Math.max(0, ...out.tasks.map((t) => t.num));
  for (const t of [...out.tasks].filter((x) => !x.num).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))) t.num = ++max;
  return out;
}

function normalizeRaw(raw: Partial<State>): State {
  const base = emptyProfile();
  const p = (raw.profile ?? {}) as Partial<State['profile']>;
  return {
    clients: Array.isArray(raw.clients) ? raw.clients : [],
    invoices: Array.isArray(raw.invoices) ? raw.invoices : [],
    boards: boards(raw.boards),
    tasks: (Array.isArray(raw.tasks) ? raw.tasks : []).map((t, i) => ({
      ...t,
      description: t.description ?? '',
      checklist: t.checklist ?? [],
      dueDate: t.dueDate ?? null,
      priority: t.priority ?? 'none',
      tags: t.tags ?? [],
      projectId: t.projectId ?? null,
      comments: t.comments ?? [],
      order: Number.isFinite(t.order) ? t.order : i,
      num: t.num ?? 0,
      completed: Boolean(t.completed),
      estimate: t.estimate ?? null,
      activity: t.activity ?? [],
      updatedAt: t.updatedAt ?? t.createdAt ?? ''
    })),
    profile: { ...base, ...p, sender: { ...base.sender, ...(p.sender ?? {}) } },
    projects: Array.isArray(raw.projects) ? raw.projects : [],
    entries: (Array.isArray(raw.entries) ? raw.entries : []).map((e) => ({
      ...e,
      tags: Array.isArray(e.tags) ? e.tags : [],
      billable: e.billable === undefined ? true : Boolean(e.billable)
    }))
  };
}

/**
 * The whole database is one JSON file. Writes go to a temp file first and are
 * renamed into place, and the previous version is kept as `<file>.bak`, so a
 * crash in the middle of a save can never leave a half-written file.
 */
export class Store implements StateStore {
  private state: State;

  constructor(private readonly file: string) {
    // Tests must never touch the real database (once a test wiped the real data file).
    if (process.env.VITEST && resolve(file) === resolve(process.cwd(), 'data/tracker.json')) {
      throw new Error('Тест пытается открыть настоящий файл данных data/tracker.json. Используйте временную папку.');
    }
    this.state = this.load();
  }

  private load(): State {
    if (!existsSync(this.file)) return emptyState();
    try {
      return normalize(JSON.parse(readFileSync(this.file, 'utf8')) as Partial<State>);
    } catch (err) {
      const bak = `${this.file}.bak`;
      if (existsSync(bak)) {
        // Main file is damaged: fall back to the last good copy instead of starting empty.
        return normalize(JSON.parse(readFileSync(bak, 'utf8')) as Partial<State>);
      }
      throw new Error(`Файл данных повреждён: ${this.file} (${err instanceof Error ? err.message : err})`);
    }
  }

  get(): State {
    return this.state;
  }

  /** Copies live in `<data dir>/backups/<id>.json`; the daily one is also taken automatically. */
  readonly backups: BackupStore = {
    create: async (kind = 'manual') => {
      const dir = join(dirname(this.file), 'backups');
      mkdirSync(dir, { recursive: true });
      const info: BackupInfo = { id: backupId(kind), at: new Date().toISOString(), entries: this.state.entries.length, projects: this.state.projects.length };
      writeFileSync(join(dir, `${info.id}.json`), JSON.stringify({ info, state: this.state }), 'utf8');
      const all = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().reverse();
      for (const old of all.slice(KEEP_BACKUPS)) rmSync(join(dir, old), { force: true });
      return info;
    },
    list: async () => {
      const dir = join(dirname(this.file), 'backups');
      if (!existsSync(dir)) return [];
      return readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .reverse()
        .map((f) => (JSON.parse(readFileSync(join(dir, f), 'utf8')) as { info: BackupInfo }).info);
    },
    read: async (id) => {
      const file = join(dirname(this.file), 'backups', `${id}.json`);
      return validBackupId(id) && existsSync(file) ? normalize((JSON.parse(readFileSync(file, 'utf8')) as { state: State }).state) : null;
    }
  };

  /** Takes the daily copy once per day, on the first save. */
  private async dailyBackup() {
    const dir = join(dirname(this.file), 'backups');
    if (!existsSync(join(dir, `${backupId('daily')}.json`))) await this.backups.create('daily');
  }

  /** Runs `fn` on a copy; the change is kept and saved only if it does not throw. */
  update<T>(fn: (draft: State) => T): T {
    const draft: State = structuredClone(this.state);
    const result = fn(draft);
    this.save(draft);
    this.state = draft;
    void this.dailyBackup().catch(() => undefined);
    return result;
  }

  private save(state: State) {
    mkdirSync(dirname(this.file), { recursive: true });
    if (existsSync(this.file)) copyFileSync(this.file, `${this.file}.bak`);
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    renameSync(tmp, this.file);
  }
}
