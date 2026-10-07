import { entrySeconds } from './report.js';
import { addDays, localToIso } from './time.js';
import type { Entry } from './types.js';

export interface Block {
  entryId: string;
  /** Minutes from local midnight of the shown day. */
  startMin: number;
  endMin: number;
  /** Column among overlapping blocks. */
  lane: number;
  lanes: number;
  running: boolean;
}

/** Monday of the week that contains `day`. */
export function weekStart(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return addDays(day, -dow);
}

export const weekDays = (start: string): string[] => Array.from({ length: 7 }, (_, i) => addDays(start, i));

/**
 * Blocks of one local day. Entries that cross midnight are clipped to the day,
 * and overlapping blocks are split into side-by-side lanes.
 */
export function layoutDay(entries: Entry[], day: string, offsetMin: number, nowMs: number): Block[] {
  const dayStart = Date.parse(localToIso(day, '00:00', offsetMin));
  const dayEnd = Date.parse(localToIso(addDays(day, 1), '00:00', offsetMin));

  const raw = entries
    .map((e) => {
      const s = Date.parse(e.start);
      const en = e.end ? Date.parse(e.end) : nowMs;
      return { e, s: Math.max(s, dayStart), en: Math.min(Math.max(en, s), dayEnd), raw: s };
    })
    .filter((x) => x.en > x.s)
    .sort((a, b) => a.s - b.s || b.en - a.en);

  const blocks: Block[] = [];
  let cluster: Block[] = [];
  let clusterEnd = -1;
  let laneEnds: number[] = [];

  const flush = () => {
    for (const b of cluster) b.lanes = laneEnds.length;
    blocks.push(...cluster);
    cluster = [];
    laneEnds = [];
    clusterEnd = -1;
  };

  for (const x of raw) {
    const startMin = (x.s - dayStart) / 60_000;
    const endMin = (x.en - dayStart) / 60_000;
    if (cluster.length > 0 && startMin >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(endMin);
    } else laneEnds[lane] = endMin;
    clusterEnd = Math.max(clusterEnd, endMin);
    cluster.push({ entryId: x.e.id, startMin, endMin, lane, lanes: 1, running: x.e.end === null });
  }
  flush();
  return blocks;
}

/** Total seconds shown on a day (clipped to it). */
export function daySeconds(entries: Entry[], day: string, offsetMin: number, nowMs: number): number {
  return Math.round(layoutDay(entries, day, offsetMin, nowMs).reduce((n, b) => n + (b.endMin - b.startMin) * 60, 0));
}

export { entrySeconds };

/** Snaps minutes to a step (default 15). */
export const snap = (min: number, step = 15) => Math.round(min / step) * step;
