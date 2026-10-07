import { randomUUID } from 'node:crypto';
import type { Entry, Project, State } from '../shared/types.js';

/** RFC 4180 CSV parser: quotes, doubled quotes, newlines inside quotes, BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v !== '')) rows.push(row);
  return rows;
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

const COLORS = ['#e57c04', '#2f6feb', '#17803d', '#c026d3', '#dc2626', '#0891b2', '#7c3aed', '#ca8a04'];

function toIso(date: string, time: string, offsetMin: number): number {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi, s] = time.split(':').map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, s || 0) - offsetMin * 60_000;
}

/**
 * Merges a Toggl "Detailed time entries" CSV into `state`.
 * Toggl exports wall-clock times without an offset, so the caller passes the
 * timezone they were recorded in (minutes east of UTC). Re-importing is safe:
 * every row gets a stable externalId and known ids are skipped.
 */
export function importToggl(state: State, csv: string, offsetMin: number): ImportSummary {
  const [header, ...rows] = parseCsv(csv);
  if (!header) throw new Error('Файл пустой.');
  const col = (name: string) => header.indexOf(name);
  const idx = {
    project: col('Project'),
    desc: col('Description'),
    sd: col('Start date'),
    st: col('Start time'),
    ed: col('End date'),
    et: col('End time'),
    dur: col('Duration'),
    tags: col('Tags')
  };
  const { dur: _dur, tags: _tags, ...required } = idx;
  if (Object.values(required).some((i) => i < 0)) {
    throw new Error('Это не похоже на экспорт Toggl: нет колонок Project, Description, Start date/time, End date/time.');
  }

  const projectsByName = new Map<string, Project>(state.projects.map((p) => [p.name.trim().toLowerCase(), p]));
  const known = new Set(state.entries.map((e) => e.externalId).filter(Boolean) as string[]);
  const summary: ImportSummary = {
    totalRows: rows.length,
    newEntries: 0,
    duplicates: 0,
    zeroLength: 0,
    newProjects: [],
    newSeconds: 0,
    from: null,
    to: null
  };

  const seenInFile = new Map<string, number>();
  for (const r of rows) {
    const startMs = toIso(r[idx.sd], r[idx.st], offsetMin);
    let endMs = toIso(r[idx.ed], r[idx.et], offsetMin);
    // Toggl's Duration is exact to the second while the printed clock times are
    // not always, so trust the duration when it is present.
    const dm = idx.dur >= 0 ? /^(\d+):(\d{2}):(\d{2})$/.exec((r[idx.dur] ?? '').trim()) : null;
    if (dm) endMs = startMs + (Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3])) * 1000;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    if (endMs - startMs < 1000) {
      summary.zeroLength++;
      continue;
    }

    const description = (r[idx.desc] ?? '').replace(/\s+/g, ' ').trim();
    const projectName = (r[idx.project] ?? '').trim();
    // Stable per row. Two genuinely different rows can share start, project and
    // text (Toggl allows it), so duration and an occurrence counter are part of the key.
    const base = `toggl:${r[idx.sd]} ${r[idx.st]}|${projectName}|${description}|${r[idx.dur] ?? ''}`;
    const seen = seenInFile.get(base) ?? 0;
    seenInFile.set(base, seen + 1);
    const externalId = seen === 0 ? base : `${base}#${seen}`;
    if (known.has(externalId)) {
      summary.duplicates++;
      continue;
    }
    known.add(externalId);

    let projectId: string | null = null;
    if (projectName) {
      let p = projectsByName.get(projectName.toLowerCase());
      if (!p) {
        p = {
          id: randomUUID(),
          name: projectName,
          rate: 0,
          currency: '$',
          color: COLORS[projectsByName.size % COLORS.length],
          archived: false,
          createdAt: new Date().toISOString()
        };
        projectsByName.set(projectName.toLowerCase(), p);
        state.projects.push(p);
        summary.newProjects.push(projectName);
      }
      projectId = p.id;
    }

    const entry: Entry = {
      id: randomUUID(),
      description,
      projectId,
      tags: idx.tags >= 0 ? (r[idx.tags] ?? '').split(',').map((t) => t.trim()).filter(Boolean) : [],
      // Toggl's own "Billable" flag is not imported: exports often mark everything "No", which would zero all money.
      billable: true,
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      source: 'toggl',
      externalId
    };
    state.entries.push(entry);
    summary.newEntries++;
    summary.newSeconds += Math.floor((endMs - startMs) / 1000);
    if (!summary.from || entry.start < summary.from) summary.from = entry.start;
    if (!summary.to || entry.start > summary.to) summary.to = entry.start;
  }
  return summary;
}
