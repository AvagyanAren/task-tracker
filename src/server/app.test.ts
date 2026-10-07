import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { Store } from './store.js';
import type { State } from '../shared/types.js';

let server: Server;
let base: string;
let file: string;

beforeAll(async () => {
  file = join(mkdtempSync(join(tmpdir(), 'tracker-')), 'tracker.json');
  server = createApp(new Store(file)).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: (await res.json()) as any };
}

beforeEach(async () => {
  // clean slate
  const { body } = await call('GET', '/api/state');
  for (const e of (body as State).entries) await call('DELETE', `/api/entries/${e.id}`);
  for (const p of (body as State).projects) await call('DELETE', `/api/projects/${p.id}`);
});

describe('проекты', () => {
  it('создание со ставкой, валидация и уникальность названия', async () => {
    const ok = await call('POST', '/api/projects', { name: 'SFIT', rate: 25.5, currency: '$' });
    expect(ok.status).toBe(200);
    expect(ok.body.projects[0]).toMatchObject({ name: 'SFIT', rate: 25.5, currency: '$', archived: false });

    expect((await call('POST', '/api/projects', { name: 'sfit' })).status).toBe(409);
    expect((await call('POST', '/api/projects', { name: '  ' })).status).toBe(400);
    expect((await call('POST', '/api/projects', { name: 'X', rate: -5 })).status).toBe(400);
    expect((await call('POST', '/api/projects', { name: 'Y', rate: 'abc' })).status).toBe(400);
  });

  it('смена ставки, архив; удалить можно только пустой проект', async () => {
    const { body } = await call('POST', '/api/projects', { name: 'A', rate: 10 });
    const id = body.projects[0].id;
    expect((await call('PUT', `/api/projects/${id}`, { rate: 30 })).body.projects[0].rate).toBe(30);
    expect((await call('PUT', `/api/projects/${id}`, { archived: true })).body.projects[0].archived).toBe(true);

    await call('POST', '/api/entries', { description: 't', projectId: id, start: '2026-09-18T08:00:00Z', end: '2026-09-18T09:00:00Z' });
    expect((await call('DELETE', `/api/projects/${id}`)).status).toBe(409);
  });
});

describe('таймер', () => {
  it('старт, стоп; новый старт останавливает прежний; идёт только один', async () => {
    const { body: p } = await call('POST', '/api/projects', { name: 'A', rate: 1 });
    const pid = p.projects[0].id;

    const s1 = await call('POST', '/api/timer/start', { description: 'первая', projectId: pid });
    expect(s1.body.entries.filter((e: any) => e.end === null)).toHaveLength(1);

    const s2 = await call('POST', '/api/timer/start', { description: 'вторая' });
    expect(s2.body.entries).toHaveLength(2);
    expect(s2.body.entries.filter((e: any) => e.end === null)).toHaveLength(1);
    expect(s2.body.entries.find((e: any) => e.description === 'первая').end).not.toBeNull();

    const stop = await call('POST', '/api/timer/stop');
    expect(stop.body.entries.every((e: any) => e.end !== null)).toBe(true);
    expect((await call('POST', '/api/timer/stop')).status).toBe(200); // повторная остановка безвредна
  });

  it('несуществующий проект отклоняется', async () => {
    expect((await call('POST', '/api/timer/start', { projectId: 'nope' })).status).toBe(400);
  });

  it('идущий таймер переживает перезапуск сервера (хранится в файле)', async () => {
    await call('POST', '/api/timer/start', { description: 'долгая' });
    const onDisk = JSON.parse(readFileSync(file, 'utf8')) as State;
    expect(onDisk.entries.some((e) => e.end === null && e.description === 'долгая')).toBe(true);
    const reopened = new Store(file).get();
    expect(reopened.entries.some((e) => e.end === null)).toBe(true);
  });
});

describe('записи', () => {
  it('ручное добавление, правка, удаление', async () => {
    const add = await call('POST', '/api/entries', { description: 'Задача', start: '2026-09-18T08:00:00Z', end: '2026-09-18T10:30:00Z' });
    expect(add.status).toBe(200);
    const id = add.body.entries[0].id;
    expect(add.body.entries[0].source).toBe('manual');

    const upd = await call('PUT', `/api/entries/${id}`, { description: 'Новое', end: '2026-09-18T11:00:00Z' });
    expect(upd.body.entries[0]).toMatchObject({ description: 'Новое', end: '2026-09-18T11:00:00.000Z' });

    expect((await call('PUT', `/api/entries/${id}`, { end: '2026-09-18T07:00:00Z' })).status).toBe(400);
    expect((await call('DELETE', `/api/entries/${id}`)).body.entries).toHaveLength(0);
    expect((await call('DELETE', `/api/entries/${id}`)).status).toBe(404);
  });

  it('конец раньше начала и мусорные даты отклоняются', async () => {
    expect((await call('POST', '/api/entries', { start: '2026-09-18T10:00:00Z', end: '2026-09-18T09:00:00Z' })).status).toBe(400);
    expect((await call('POST', '/api/entries', { start: 'вчера', end: 'сегодня' })).status).toBe(400);
  });

  it('отклонённое изменение ничего не портит', async () => {
    const add = await call('POST', '/api/entries', { description: 'Целая', start: '2026-09-18T08:00:00Z', end: '2026-09-18T10:00:00Z' });
    const id = add.body.entries[0].id;
    await call('PUT', `/api/entries/${id}`, { description: 'Сломанная', end: '2026-09-18T07:00:00Z' });
    expect((await call('GET', '/api/state')).body.entries[0].description).toBe('Целая');
  });
});

describe('импорт Toggl', () => {
  const csv =
    '﻿"User","Email","Client","Project","Task","Description","Billable","Start date","Start time","End date","End time","Duration","Tags"\r\n' +
    '"u","e","","SFIT","","Мобильная версия, портал","No","2026-09-22","11:40:00","2026-09-22","16:20:00","04:40:00",""\r\n' +
    '"u","e","","SFIT","","\tПлатежи","No","2026-09-29","13:21:00","2026-09-29","20:21:00","07:00:00",""\r\n' +
    '"u","e","","","","Без проекта","No","2026-09-23","19:30:00","2026-09-23","21:59:16","02:29:16",""\r\n' +
    '"u","e","","SFIT","","Ноль","No","2026-10-01","22:00:00","2026-10-01","22:00:00","00:00:00",""\r\n';

  it('предпросмотр ничего не сохраняет', async () => {
    const r = await call('POST', '/api/import/toggl', { csv, tzOffsetMinutes: 240, dryRun: true });
    expect(r.body.summary).toMatchObject({ newEntries: 3, duplicates: 0, zeroLength: 1, newProjects: ['SFIT'] });
    expect((await call('GET', '/api/state')).body.entries).toHaveLength(0);
  });

  it('импорт: проект создаётся, время переводится в UTC, повтор не дублирует', async () => {
    const r = await call('POST', '/api/import/toggl', { csv, tzOffsetMinutes: 240 });
    expect(r.body.summary.newEntries).toBe(3);
    expect(r.body.summary.newSeconds).toBe(16800 + 25200 + 8956);
    const e = r.body.state.entries.find((x: any) => x.description.startsWith('Мобильная'));
    expect(e.start).toBe('2026-09-22T07:40:00.000Z'); // 11:40 в UTC+4
    expect(e.source).toBe('toggl');
    expect(r.body.state.entries.find((x: any) => x.description === 'Платежи')).toBeTruthy(); // табуляция обрезана
    expect(r.body.state.projects.map((p: any) => p.name)).toEqual(['SFIT']);

    const again = await call('POST', '/api/import/toggl', { csv, tzOffsetMinutes: 240 });
    expect(again.body.summary).toMatchObject({ newEntries: 0, duplicates: 3 });
    expect(again.body.state.entries).toHaveLength(3);
  });

  it('проект сопоставляется с уже существующим по имени, ставка сохраняется', async () => {
    await call('POST', '/api/projects', { name: 'sfit', rate: 40 });
    const r = await call('POST', '/api/import/toggl', { csv, tzOffsetMinutes: 0 });
    expect(r.body.state.projects).toHaveLength(1);
    expect(r.body.state.projects[0].rate).toBe(40);
  });

  it('не-Toggl файл и пустой файл дают понятную ошибку', async () => {
    expect((await call('POST', '/api/import/toggl', { csv: 'a,b\n1,2' })).body.error).toMatch(/не похоже на экспорт/);
    expect((await call('POST', '/api/import/toggl', { csv: '' })).status).toBe(400);
  });
});

describe('хранилище', () => {
  it('повреждённый файл: данные берутся из резервной копии', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tracker-bak-'));
    const f = join(dir, 'tracker.json');
    const s = new Store(f);
    s.update((d) => void d.projects.push({ id: '1', name: 'A', rate: 1, currency: '$', color: '#fff', archived: false, createdAt: '' }));
    s.update((d) => void d.projects.push({ id: '2', name: 'B', rate: 1, currency: '$', color: '#fff', archived: false, createdAt: '' }));
    writeFileSync(f, '{ битый json');
    expect(new Store(f).get().projects.length).toBeGreaterThanOrEqual(1);
  });

  it('повреждённый файл без копии — ошибка, а не молчаливый сброс данных', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tracker-bad-'));
    const f = join(dir, 'tracker.json');
    writeFileSync(f, 'не json');
    expect(() => new Store(f)).toThrow(/повреждён/);
  });
});

describe('импорт: одинаковые строки', () => {
  it('две разные записи с одним началом и текстом не склеиваются, а повтор их не дублирует', async () => {
    const head = '"User","Project","Description","Start date","Start time","End date","End time","Duration"\n';
    const csv =
      head +
      '"u","P","Задача","2026-03-04","17:52:55","2026-03-04","19:12:51","01:19:56"\n' +
      '"u","P","Задача","2026-03-04","17:52:55","2026-03-04","17:52:57","00:00:02"\n' +
      '"u","P","Задача","2026-03-04","17:52:55","2026-03-04","17:52:57","00:00:02"\n';
    const first = await call('POST', '/api/import/toggl', { csv, tzOffsetMinutes: 0 });
    expect(first.body.summary.newEntries).toBe(3);
    const second = await call('POST', '/api/import/toggl', { csv, tzOffsetMinutes: 0 });
    expect(second.body.summary).toMatchObject({ newEntries: 0, duplicates: 3 });
  });

  it('длительность из колонки Duration важнее округлённого времени конца', async () => {
    const head = '"Project","Description","Start date","Start time","End date","End time","Duration"\n';
    const csv = head + '"P","X","2026-09-30","15:22:00","2026-09-30","18:22:00","03:00:29"\n';
    const r = await call('POST', '/api/import/toggl', { csv, tzOffsetMinutes: 0 });
    expect(r.body.summary.newSeconds).toBe(3 * 3600 + 29);
  });
});

describe('теги, billable и правка бегущего таймера', () => {
  it('теги чистятся, billable по умолчанию включён', async () => {
    const r = await call('POST', '/api/entries', {
      description: 'x', start: '2026-09-18T08:00:00Z', end: '2026-09-18T09:00:00Z', tags: [' #ui ', 'UI', '', 'fix']
    });
    expect(r.body.entries[0].tags).toEqual(['ui', 'fix']);
    expect(r.body.entries[0].billable).toBe(true);
  });

  it('таймер стартует с тегами и billable=false; правка этих полей', async () => {
    const s = await call('POST', '/api/timer/start', { description: 'созвон', tags: ['meeting'], billable: false });
    const e = s.body.entries.find((x: any) => x.end === null);
    expect(e).toMatchObject({ tags: ['meeting'], billable: false });
    const u = await call('PUT', `/api/entries/${e.id}`, { tags: ['a', 'b'], billable: true });
    expect(u.body.entries.find((x: any) => x.id === e.id)).toMatchObject({ tags: ['a', 'b'], billable: true });
    await call('POST', '/api/timer/stop');
  });

  it('начало бегущего таймера можно сдвинуть назад, но не в будущее', async () => {
    const s = await call('POST', '/api/timer/start', { description: 'забыл включить' });
    const e = s.body.entries.find((x: any) => x.end === null);
    const past = new Date(Date.now() - 20 * 60_000).toISOString();
    const ok = await call('PUT', `/api/entries/${e.id}`, { start: past });
    expect(ok.status).toBe(200);
    const future = new Date(Date.now() + 3600_000).toISOString();
    expect((await call('PUT', `/api/entries/${e.id}`, { start: future })).status).toBe(400);
    await call('POST', '/api/timer/stop');
  });

  it('старые файлы без tags/billable читаются с значениями по умолчанию', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tracker-old-'));
    const f = join(dir, 'tracker.json');
    writeFileSync(f, JSON.stringify({ projects: [], entries: [{ id: '1', description: 'старая', projectId: null, start: '2026-01-01T00:00:00Z', end: '2026-01-01T01:00:00Z' }] }));
    expect(new Store(f).get().entries[0]).toMatchObject({ tags: [], billable: true });
  });

  it('импорт Toggl: теги берутся, billable не обнуляет деньги', async () => {
    const head = '"Project","Description","Billable","Start date","Start time","End date","End time","Duration","Tags"\n';
    const csv = head + '"P","X","No","2026-09-30","15:00:00","2026-09-30","16:00:00","01:00:00","ui, fix"\n';
    const r = await call('POST', '/api/import/toggl', { csv, tzOffsetMinutes: 0 });
    expect(r.body.state.entries.find((x: any) => x.description === 'X')).toMatchObject({ tags: ['ui', 'fix'], billable: true });
  });
});

describe('копии данных через API', () => {
  it('создать, показать, скачать и восстановить с сохранением текущего состояния', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bak-'));
    const store = new Store(join(dir, 'tracker.json'));
    const server = createApp(store).listen(0);
    await new Promise((r) => server.once('listening', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = (m: string, p: string, body?: unknown) =>
      fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    try {
      await call('POST', '/api/projects', { name: 'Первый' });
      const made = (await (await call('POST', '/api/backups')).json()) as { id: string; projects: number };
      expect(made.projects).toBe(1);
      expect(((await (await call('GET', '/api/backups')).json()) as unknown[]).length).toBeGreaterThanOrEqual(1);

      await call('POST', '/api/projects', { name: 'Второй' });
      const back = await call('POST', `/api/backups/${made.id}/restore`);
      const result = (await back.json()) as { state: { projects: unknown[] }; savedAs: string };
      expect(result.state.projects).toHaveLength(1);
      // состояние до восстановления не потеряно: оно лежит в новой копии
      const saved = (await (await call('GET', `/api/backups/${result.savedAs}`)).json()) as { projects: unknown[] };
      expect(saved.projects).toHaveLength(2);
      expect((await call('GET', '/api/backups/..%2Fsecret')).status).toBe(404);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

describe('защита настоящих данных', () => {
  it('тесты не могут открыть data/tracker.json', () => {
    expect(() => new Store(join(process.cwd(), 'data/tracker.json'))).toThrow(/настоящий файл данных/);
  });
});

describe('клиенты и счета', () => {
  it('клиент → проект → счёт: номер, итоги, пометка записей, смена статуса, удаление возвращает время', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inv-'));
    const store = new Store(join(dir, 'tracker.json'));
    const server = createApp(store).listen(0);
    await new Promise((r) => server.once('listening', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = async (m: string, p: string, body?: unknown) => {
      const res = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, json: (await res.json()) as any };
    };
    try {
      const c = await call('POST', '/api/clients', { name: 'Acme', email: 'a@acme.io', currency: '$', dueDays: 10 });
      const clientId = c.json.clients[0].id as string;
      expect((await call('POST', '/api/clients', { name: 'acme' })).status).toBe(409);

      const p = await call('POST', '/api/projects', { name: 'Сайт', rate: 30, clientId });
      const projectId = p.json.projects[0].id as string;
      expect(p.json.projects[0].clientId).toBe(clientId);
      expect((await call('POST', '/api/projects', { name: 'Битый', clientId: 'nope' })).status).toBe(400);
      expect((await call('DELETE', `/api/clients/${clientId}`)).status).toBe(409); // есть проект

      const e = await call('POST', '/api/entries', { description: 'Вёрстка', projectId, start: '2026-09-10T08:00:00.000Z', end: '2026-09-10T10:00:00.000Z' });
      const entryId = e.json.entries[0].id as string;

      const make = (extra: object = {}) =>
        call('POST', '/api/invoices', {
          clientId,
          projectIds: [projectId],
          entryIds: [entryId],
          issueDate: '2026-09-30',
          dueDate: '2026-10-10',
          periodFrom: '2026-09-01',
          periodTo: '2026-09-30',
          currency: '$',
          lines: [{ description: 'Вёрстка', hours: 2, rate: 30 }],
          discountPct: 10,
          taxPct: 20,
          sender: { name: 'Я' },
          client: { name: 'Acme' },
          ...extra
        });
      const inv = await make();
      expect(inv.json.invoice).toMatchObject({ number: 'INV-2026-001', status: 'draft', subtotal: 60, discount: 6, tax: 10.8, total: 64.8 });
      expect(inv.json.state.entries[0].invoiceId).toBe(inv.json.invoice.id);
      expect((await make({ number: 'INV-2026-001' })).status).toBe(409); // номер занят
      expect((await make({ number: 'INV-2026-009' })).status).toBe(409); // записи уже в счёте
      expect((await make({ lines: [] })).status).toBe(400);
      expect((await make({ entryIds: [] })).json.invoice.number).toBe('INV-2026-002'); // следующий номер выдаётся сам

      const id = inv.json.invoice.id as string;
      const sent = await call('PUT', `/api/invoices/${id}`, { status: 'sent' });
      expect(sent.json.invoices.find((v: any) => v.id === id)).toMatchObject({ status: 'sent' });
      const paid = await call('PUT', `/api/invoices/${id}`, { status: 'paid' });
      expect(paid.json.invoices.find((v: any) => v.id === id).paidAt).not.toBeNull();
      expect((await call('PUT', `/api/invoices/${id}`, { status: 'weird' })).status).toBe(400);

      const del = await call('DELETE', `/api/invoices/${id}`);
      expect(del.json.entries[0].invoiceId).toBeNull(); // время снова можно выставить
      expect(del.json.invoices.some((v: any) => v.id === id)).toBe(false);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

describe('повтор запросов после обрыва связи', () => {
  it('старт, стоп и ручная запись с id применяются один раз и берут время нажатия', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'idem-'));
    const store = new Store(join(dir, 'tracker.json'));
    const server = createApp(store).listen(0);
    await new Promise((r) => server.once('listening', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = async (p: string, body: unknown) => (await (await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()) as State;
    try {
      const at = new Date(Date.now() - 3600_000).toISOString();
      await post('/api/timer/start', { id: 'offline-1', at, description: 'A' });
      const again = await post('/api/timer/start', { id: 'offline-1', at, description: 'A' });
      expect(again.entries).toHaveLength(1);
      expect(again.entries[0].start).toBe(at);

      const stopAt = new Date(Date.now() - 1800_000).toISOString();
      const stopped = await post('/api/timer/stop', { id: 'offline-1', at: stopAt });
      expect(stopped.entries[0].end).toBe(stopAt);
      // повторный стоп того же id ничего не меняет, даже с другим временем
      expect((await post('/api/timer/stop', { id: 'offline-1', at: new Date().toISOString() })).entries[0].end).toBe(stopAt);

      const manual = { id: 'manual-0001', description: 'M', start: '2026-10-01T08:00:00.000Z', end: '2026-10-01T09:00:00.000Z' };
      await post('/api/entries', manual);
      expect((await post('/api/entries', manual)).entries.filter((e) => e.id === 'manual-0001')).toHaveLength(1);

      // время из будущего (сбитые часы) обрезается до «сейчас»
      const future = await post('/api/timer/start', { id: 'future-0001', at: new Date(Date.now() + 86400_000).toISOString() });
      expect(Date.parse(future.entries.find((e) => e.id === 'future-0001')!.start)).toBeLessThanOrEqual(Date.now());
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
