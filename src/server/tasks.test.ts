import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { Store } from './store.js';
import { mergeState } from './restore.js';
import type { State } from '../shared/types.js';

let server: Server;
let base: string;

beforeAll(async () => {
  server = createApp(new Store(join(mkdtempSync(join(tmpdir(), 'tracker-tasks-')), 'tracker.json'))).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as any };
}
const state = async () => (await call('GET', '/api/state')).body as State;

describe('доски', () => {
  it('общая доска есть всегда, с четырьмя колонками, и её нельзя удалить', async () => {
    const s = await state();
    const g = s.boards.find((b) => b.id === 'general')!;
    expect(g.projectId).toBeNull();
    expect(g.columns.map((c) => c.name)).toEqual(['К выполнению', 'В работе', 'На проверке', 'Готово']);
    expect((await call('DELETE', '/api/boards/general')).status).toBe(400);
    expect((await call('POST', '/api/boards', { name: 'Ещё одна общая' })).status).toBe(400);
  });

  it('одна доска на проект; колонки переименовываются, добавляются и удаляются без потери задач', async () => {
    const { body: p } = await call('POST', '/api/projects', { name: 'Доски' });
    const projectId = p.projects.find((x: any) => x.name === 'Доски').id;
    const made = await call('POST', '/api/boards', { projectId });
    expect(made.status).toBe(200);
    expect((await call('POST', '/api/boards', { projectId })).status).toBe(409);
    const board = made.body.state.boards.find((b: any) => b.id === made.body.id);
    expect(board.name).toBe('Доски');
    expect(board.columns).toHaveLength(4);

    const t = await call('POST', '/api/tasks', { boardId: board.id, columnId: board.columns[2].id, title: 'Проверить' });
    expect(t.body.state.tasks[0].projectId).toBe(projectId); // проект берётся с доски

    const cols = [{ id: board.columns[0].id, name: 'Идеи' }, { name: 'Новая' }];
    const edited = await call('PUT', `/api/boards/${board.id}`, { columns: cols });
    const after = edited.body.boards.find((b: any) => b.id === board.id);
    expect(after.columns.map((c: any) => c.name)).toEqual(['Идеи', 'Новая']);
    // задача удалённой колонки ушла в первую оставшуюся
    expect(edited.body.tasks.find((x: any) => x.id === t.body.id).columnId).toBe(after.columns[0].id);
    expect((await call('PUT', `/api/boards/${board.id}`, { columns: [] })).status).toBe(400);

    // проект с доской, на которой есть задачи, удалить нельзя; без задач можно
    expect((await call('DELETE', `/api/projects/${projectId}`)).status).toBe(409);
    await call('DELETE', `/api/tasks/${t.body.id}`);
    expect((await call('DELETE', `/api/projects/${projectId}`)).status).toBe(200);
    expect((await state()).boards.some((b) => b.id === board.id)).toBe(false);
  });
});

describe('карточки', () => {
  it('поля, порядок при переносе, комментарии', async () => {
    const g = (await state()).boards.find((b) => b.id === 'general')!;
    const [todo, doing] = g.columns;
    const mk = async (title: string) => (await call('POST', '/api/tasks', { boardId: 'general', columnId: todo.id, title })).body.id as string;
    const a = await mk('A');
    const b = await mk('B');
    const c = await mk('C');
    expect((await call('POST', '/api/tasks', { boardId: 'general', title: ' ' })).status).toBe(400);

    await call('PUT', `/api/tasks/${a}`, {
      description: 'Описание',
      checklist: [{ text: 'шаг 1', done: true }, { text: '' }, { text: 'шаг 2' }],
      dueDate: '2026-12-01',
      priority: 'high',
      tags: ['#срочно', 'срочно', 'api']
    });
    const t = (await state()).tasks.find((x) => x.id === a)!;
    expect(t).toMatchObject({ description: 'Описание', dueDate: '2026-12-01', priority: 'high', tags: ['срочно', 'api'] });
    expect(t.checklist.map((i) => i.text)).toEqual(['шаг 1', 'шаг 2']);
    expect((await call('PUT', `/api/tasks/${a}`, { dueDate: 'завтра' })).status).toBe(400);
    expect((await call('PUT', `/api/tasks/${a}`, { priority: 'x' })).status).toBe(400);

    // C в середину колонки «В работе», потом B наверх
    await call('POST', `/api/tasks/${c}/move`, { columnId: doing.id, index: 0 });
    await call('POST', `/api/tasks/${a}/move`, { columnId: doing.id, index: 1 });
    const s = await state();
    const col = (id: string) => s.tasks.filter((x) => x.columnId === id).sort((x, y) => x.order - y.order).map((x) => x.title);
    expect(col(doing.id)).toEqual(['C', 'A']);
    expect(col(todo.id)).toEqual(['B']);
    expect(s.tasks.find((x) => x.id === b)!.order).toBe(0);

    await call('POST', `/api/tasks/${a}/comments`, { text: 'Привет' });
    const withComment = (await state()).tasks.find((x) => x.id === a)!;
    expect(withComment.comments).toHaveLength(1);
    expect((await call('POST', `/api/tasks/${a}/comments`, { text: ' ' })).status).toBe(400);
    await call('DELETE', `/api/tasks/${a}/comments/${withComment.comments[0].id}`);
    expect((await state()).tasks.find((x) => x.id === a)!.comments).toHaveLength(0);
  });
});

describe('таймер из задачи', () => {
  it('запись берёт название, проект и теги карточки; перенос карточки таймер не трогает; переименование догоняет историю', async () => {
    const { body: p } = await call('POST', '/api/projects', { name: 'Время' });
    const projectId = p.projects.find((x: any) => x.name === 'Время').id;
    const g = (await state()).boards.find((b) => b.id === 'general')!;
    const id = (await call('POST', '/api/tasks', { boardId: 'general', title: 'Сверстать', projectId, tags: ['ui'] })).body.id as string;

    const started = (await call('POST', '/api/timer/start', { taskId: id })).body as State;
    const e = started.entries.find((x) => x.end === null)!;
    expect(e).toMatchObject({ description: 'Сверстать', projectId, tags: ['ui'], taskId: id });

    await call('POST', `/api/tasks/${id}/move`, { columnId: g.columns[3].id });
    expect((await state()).entries.find((x) => x.id === e.id)!.end).toBeNull();

    await call('PUT', `/api/tasks/${id}`, { title: 'Сверстать экран' });
    expect((await state()).entries.find((x) => x.id === e.id)!.description).toBe('Сверстать экран');
    expect((await call('POST', '/api/timer/start', { taskId: 'нет-такой' })).status).toBe(404);

    // удаление карточки оставляет время, но отвязывает его
    await call('DELETE', `/api/tasks/${id}`);
    const after = (await state()).entries.find((x) => x.id === e.id)!;
    expect(after.taskId).toBeNull();
    expect(after.description).toBe('Сверстать экран');
    await call('POST', '/api/timer/stop', {});
  });
});

describe('карточка как в Jira/Trello', () => {
  it('номер, история, оценка, выполнено, правка комментария, копия', async () => {
    const g = (await state()).boards.find((b) => b.id === 'general')!;
    const id = (await call('POST', '/api/tasks', { boardId: 'general', columnId: g.columns[0].id, title: 'Детали' })).body.id as string;
    let t = (await state()).tasks.find((x) => x.id === id)!;
    expect(t.num).toBeGreaterThan(0);
    expect(t.activity.map((a) => a.text)).toEqual(['Задача создана']);

    await call('PUT', `/api/tasks/${id}`, { priority: 'high', estimate: 5400, completed: true, dueDate: '2026-11-01' });
    await call('POST', `/api/tasks/${id}/move`, { columnId: g.columns[1].id });
    t = (await state()).tasks.find((x) => x.id === id)!;
    expect(t).toMatchObject({ estimate: 5400, completed: true });
    const log = t.activity.map((a) => a.text).join('|');
    expect(log).toContain('Приоритет: нет → высокий');
    expect(log).toContain('Оценка: 1.5 ч');
    expect(log).toContain('Перенесена: К выполнению → В работе');
    expect((await call('PUT', `/api/tasks/${id}`, { estimate: -5 })).status).toBe(400);
    await call('PUT', `/api/tasks/${id}`, { estimate: null });
    expect((await state()).tasks.find((x) => x.id === id)!.estimate).toBeNull();

    await call('POST', `/api/tasks/${id}/comments`, { text: 'раз' });
    const cid = (await state()).tasks.find((x) => x.id === id)!.comments[0].id;
    await call('PUT', `/api/tasks/${id}/comments/${cid}`, { text: 'два' });
    const c = (await state()).tasks.find((x) => x.id === id)!.comments[0];
    expect(c.text).toBe('два');
    expect(c.editedAt).toBeTruthy();

    await call('PUT', `/api/tasks/${id}`, { checklist: [{ text: 'a', done: true }] });
    const dup = (await call('POST', `/api/tasks/${id}/duplicate`)).body;
    const copy = (dup.state as State).tasks.find((x) => x.id === dup.id)!;
    expect(copy.title).toBe('Детали (копия)');
    expect(copy.num).toBeGreaterThan(t.num);
    expect(copy.checklist.map((i) => i.done)).toEqual([false]);
    expect(copy.comments).toHaveLength(0);
    expect(copy.columnId).toBe(g.columns[1].id);
  });
});

describe('копии', () => {
  it('слияние добавляет доски проектов и задачи один раз', () => {
    const base = (): State => ({
      projects: [{ id: 'p1', name: 'P', rate: 0, currency: '$', color: '#000', archived: false, createdAt: '2026-01-01T00:00:00Z' }],
      entries: [],
      clients: [],
      invoices: [],
      profile: { sender: { name: '', address: '', email: '', payment: '' }, lang: 'ru', dueDays: 14, notes: '' },
      boards: [{ id: 'general', name: 'Общая', projectId: null, columns: [{ id: 'c1', name: 'A' }], createdAt: '' }],
      tasks: []
    });
    const target = base();
    const incoming = base();
    incoming.boards.push({ id: 'b2', name: 'P', projectId: 'p1', columns: [{ id: 'x', name: 'X' }], createdAt: '' });
    incoming.tasks.push(
      { id: 't1', boardId: 'b2', columnId: 'x', title: 'T', description: '', checklist: [], dueDate: null, priority: 'none', tags: [], projectId: 'p1', comments: [], order: 0, num: 1, completed: false, estimate: null, activity: [], createdAt: '', updatedAt: '' },
      { id: 't2', boardId: 'general', columnId: 'gone', title: 'G', description: '', checklist: [], dueDate: null, priority: 'none', tags: [], projectId: null, comments: [], order: 0, num: 1, completed: false, estimate: null, activity: [], createdAt: '', updatedAt: '' }
    );
    mergeState(target, incoming);
    mergeState(target, incoming);
    expect(target.boards).toHaveLength(2);
    expect(target.tasks).toHaveLength(2);
    expect(target.tasks.find((t) => t.id === 't2')!.columnId).toBe('c1'); // неизвестная колонка → первая
  });
});
