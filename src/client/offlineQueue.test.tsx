import { describe, expect, it } from 'vitest';
import { blank } from '../shared/blank.js';
import type { State } from '../shared/types.js';
import { applyQueue, dropOpsFor, type Op } from './offlineQueue.js';

const base: State = { ...blank(), projects: [], entries: [] };
const start = (id: string, at: string, description = ''): Op => ({ kind: 'start', id, at, description, projectId: null, tags: [], billable: true });

describe('очередь действий без сети', () => {
  it('старт и стоп применяются поверх данных сервера и в нужном порядке', () => {
    const s = applyQueue(base, [start('a', '2026-10-07T10:00:00.000Z', 'A'), { kind: 'stop', id: 'a', at: '2026-10-07T11:00:00.000Z' }, start('b', '2026-10-07T11:00:00.000Z', 'B')]);
    expect(s.entries.map((e) => [e.id, e.end])).toEqual([['a', '2026-10-07T11:00:00.000Z'], ['b', null]]);
  });
  it('новый старт останавливает идущий таймер в момент нажатия', () => {
    const withRunning: State = { ...base, entries: [{ id: 'r', description: '', projectId: null, tags: [], billable: true, start: '2026-10-07T09:00:00.000Z', end: null }] };
    const s = applyQueue(withRunning, [start('n', '2026-10-07T10:30:00.000Z')]);
    expect(s.entries.find((e) => e.id === 'r')!.end).toBe('2026-10-07T10:30:00.000Z');
  });
  it('повторное применение ничего не меняет (запрос мог уже дойти до сервера)', () => {
    const ops: Op[] = [start('a', '2026-10-07T10:00:00.000Z'), { kind: 'stop', id: 'a', at: '2026-10-07T10:20:00.000Z' }, { kind: 'add', id: 'm', description: 'x', projectId: null, tags: [], billable: true, start: '2026-10-07T08:00:00.000Z', end: '2026-10-07T09:00:00.000Z' }];
    const once = applyQueue(base, ops);
    expect(applyQueue(once, ops)).toEqual(once);
    expect(once.entries).toHaveLength(2);
  });
  it('стоп не уходит раньше старта, а брошенный старт убирается вместе со стопом', () => {
    const s = applyQueue(base, [start('a', '2026-10-07T10:00:00.000Z'), { kind: 'stop', id: 'a', at: '2026-10-07T09:00:00.000Z' }]);
    expect(s.entries[0].end).toBe('2026-10-07T10:00:00.000Z');
    expect(dropOpsFor([start('a', 'x'), { kind: 'stop', id: 'a', at: 'y' }, start('b', 'z')], 'a')).toHaveLength(1);
  });
});
