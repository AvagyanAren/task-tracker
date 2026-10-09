import type { State } from '../shared/types.js';
import { normalize } from './store.js';

export class BackupError extends Error {}

const isIso = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));

/** Checks that an uploaded file really is a Tempo backup before anything is overwritten. */
export function parseBackup(raw: unknown): State {
  if (!raw || typeof raw !== 'object') throw new BackupError('Файл не похож на резервную копию Tempo.');
  const o = raw as Partial<State>;
  if (!Array.isArray(o.projects) || !Array.isArray(o.entries)) throw new BackupError('Файл не похож на резервную копию Tempo.');
  for (const p of o.projects) {
    if (!p || typeof p.id !== 'string' || typeof p.name !== 'string' || !Number.isFinite(Number(p.rate))) {
      throw new BackupError('В файле повреждены проекты.');
    }
  }
  for (const e of o.entries) {
    if (!e || typeof e.id !== 'string' || !isIso(e.start) || (e.end !== null && !isIso(e.end))) {
      throw new BackupError('В файле повреждены записи времени.');
    }
  }
  return keepOneRunning(normalize(o));
}

/** At most one timer may run: older unfinished entries are closed at the next one's start. */
function keepOneRunning(s: State): State {
  const running = s.entries.filter((e) => e.end === null).sort((a, b) => (a.start < b.start ? -1 : 1));
  for (let i = 0; i < running.length - 1; i++) running[i].end = running[i + 1].start;
  return s;
}

export interface MergeSummary {
  projects: number;
  entries: number;
  skipped: number;
}

/**
 * Adds what the backup has and the database does not. Entries match by id (or by
 * Toggl import id), projects by id or name, so loading the same file twice adds nothing.
 */
export function mergeState(target: State, incoming: State): MergeSummary {
  const summary: MergeSummary = { projects: 0, entries: 0, skipped: 0 };
  const idMap = new Map<string, string>();

  for (const p of incoming.projects) {
    const same = target.projects.find((x) => x.id === p.id) ?? target.projects.find((x) => x.name.trim().toLowerCase() === p.name.trim().toLowerCase());
    if (same) {
      idMap.set(p.id, same.id);
    } else {
      target.projects.push({ ...p });
      idMap.set(p.id, p.id);
      summary.projects++;
    }
  }

  const ids = new Set(target.entries.map((e) => e.id));
  const external = new Set(target.entries.map((e) => e.externalId).filter(Boolean));
  for (const e of incoming.entries) {
    if (ids.has(e.id) || (e.externalId && external.has(e.externalId))) {
      summary.skipped++;
      continue;
    }
    target.entries.push({ ...e, projectId: e.projectId ? idMap.get(e.projectId) ?? null : null });
    summary.entries++;
  }

  // Clients match by id or name; invoices by id or number, so loading a file twice adds nothing.
  const clientMap = new Map<string, string>();
  for (const c of incoming.clients) {
    const same = target.clients.find((x) => x.id === c.id) ?? target.clients.find((x) => x.name.trim().toLowerCase() === c.name.trim().toLowerCase());
    if (same) clientMap.set(c.id, same.id);
    else {
      target.clients.push({ ...c });
      clientMap.set(c.id, c.id);
    }
  }
  for (const p of target.projects) if (p.clientId && clientMap.has(p.clientId)) p.clientId = clientMap.get(p.clientId)!;
  for (const inv of incoming.invoices) {
    if (target.invoices.some((x) => x.id === inv.id || x.number === inv.number)) continue;
    target.invoices.push({ ...inv, clientId: inv.clientId ? clientMap.get(inv.clientId) ?? null : null });
  }
  // Boards match by id, or by project (one board per project); tasks by id.
  const boardMap = new Map<string, string>();
  for (const b of incoming.boards) {
    const pid = b.projectId ? idMap.get(b.projectId) ?? null : null;
    const same = target.boards.find((x) => x.id === b.id) ?? target.boards.find((x) => x.projectId === pid && (pid !== null || x.id === 'general'));
    if (same) boardMap.set(b.id, same.id);
    else if (b.projectId && !pid) continue;
    else {
      target.boards.push({ ...b, projectId: pid });
      boardMap.set(b.id, b.id);
    }
  }
  for (const t of incoming.tasks) {
    if (target.tasks.some((x) => x.id === t.id)) continue;
    const boardId = boardMap.get(t.boardId);
    const board = target.boards.find((x) => x.id === boardId);
    if (!board) continue;
    const columnId = board.columns.some((c) => c.id === t.columnId) ? t.columnId : board.columns[0].id;
    target.tasks.push({ ...t, boardId: board.id, columnId, projectId: t.projectId ? idMap.get(t.projectId) ?? null : null });
  }
  keepOneRunning(target);
  return summary;
}
