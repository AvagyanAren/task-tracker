import type { Entry } from './types.js';

export interface EntryGroup {
  key: string;
  entries: Entry[];
}

/** Same description (any case), project, tags and billable flag -> one group. */
export function similarKey(e: Entry): string {
  return [
    e.description.trim().toLowerCase(),
    e.projectId ?? '',
    [...e.tags].map((t) => t.toLowerCase()).sort().join(','),
    e.billable ? '1' : '0'
  ].join('\u0000');
}

/**
 * Groups entries (already sorted newest first) keeping the order of each
 * group's most recent entry. A running entry is never merged, it stays visible.
 */
export function groupSimilar(entries: Entry[]): EntryGroup[] {
  const groups: EntryGroup[] = [];
  const byKey = new Map<string, EntryGroup>();
  for (const e of entries) {
    if (e.end === null) {
      groups.push({ key: `running:${e.id}`, entries: [e] });
      continue;
    }
    const key = similarKey(e);
    const g = byKey.get(key);
    if (g) g.entries.push(e);
    else {
      const created = { key, entries: [e] };
      byKey.set(key, created);
      groups.push(created);
    }
  }
  return groups;
}
