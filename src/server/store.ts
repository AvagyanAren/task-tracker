import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { State } from '../shared/types.js';

/** Fills fields that older files do not have yet. */
function normalize(raw: Partial<State>): State {
  return {
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
export class Store {
  private state: State;

  constructor(private readonly file: string) {
    this.state = this.load();
  }

  private load(): State {
    if (!existsSync(this.file)) return { projects: [], entries: [] };
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

  /** Runs `fn` on a copy; the change is kept and saved only if it does not throw. */
  update<T>(fn: (draft: State) => T): T {
    const draft: State = structuredClone(this.state);
    const result = fn(draft);
    this.save(draft);
    this.state = draft;
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
