import { blank } from '../shared/blank.js';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { RedisStore, redisFromEnv } from './redisStore.js';
import { emptyState } from './store.js';
import { BackupError, mergeState, parseBackup } from './restore.js';
import type { State } from '../shared/types.js';

/**
 * In-memory stand-in for the Upstash REST API. It understands GET and the two Lua
 * scripts the store sends, which it emulates in JS (the scripts themselves are tiny).
 */
function fakeUpstash(hooks: { beforeEval?: (kv: Map<string, string>) => void } = {}) {
  const kv = new Map<string, string>();
  const calls: string[] = [];
  const impl = (async (_url: string, init: RequestInit) => {
    const [cmd, script, , ...a] = JSON.parse(String(init.body)) as string[];
    calls.push(cmd);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    let result: unknown = null;
    if (cmd === 'GET') result = kv.get(script) ?? null;
    else if (cmd === 'SET') kv.set(script, String(JSON.parse(String(init.body))[2]));
    else if (cmd === 'DEL') kv.delete(script);
    else if (cmd === 'EVAL' && script.includes('cjson')) {
      const [metaKey, prefix] = a;
      const meta = kv.get(metaKey);
      const out = [meta ?? ''];
      if (meta) for (const k of (JSON.parse(meta).shards ?? []) as string[]) out.push(kv.get(prefix + k) ?? '');
      result = out;
    } else if (cmd === 'EVAL') {
      calls.push('WRITE');
      hooks.beforeEval?.(kv);
      const n = Number(a[0]);
      const triples = Array.from({ length: n }, (_, i) => a.slice(1 + i * 3, 4 + i * 3));
      const ok = triples.every(([key, expected]) => (kv.get(key) ?? '') === expected);
      if (ok) {
        for (const [key, , next] of triples) {
          const cur = kv.get(key);
          if (cur !== undefined) kv.set(key + ':bak', cur);
          if (next === '') kv.delete(key);
          else kv.set(key, next);
        }
      }
      result = ok ? 1 : 0;
    }
    return new Response(JSON.stringify({ result }), { status: 200 });
  }) as unknown as typeof fetch;
  return { kv, calls, impl };
}

const iso = (h: number) => new Date(Date.UTC(2026, 8, 10, h)).toISOString();
const project = (id: string, name: string) => ({ id, name, rate: 10, currency: '$', color: '#000', archived: false, createdAt: iso(0) });
const entry = (id: string, projectId: string | null, h = 8) => ({ id, description: id, projectId, tags: [], billable: true, start: iso(h), end: iso(h + 1) });

describe('redisFromEnv', () => {
  it('находит стандартные переменные и с произвольным префиксом', () => {
    expect(redisFromEnv({ KV_REST_API_URL: 'https://a', KV_REST_API_TOKEN: 't1' })).toEqual({ url: 'https://a', token: 't1' });
    expect(redisFromEnv({ UPSTASH_REDIS_REST_URL: 'https://b', UPSTASH_REDIS_REST_TOKEN: 't2' })).toEqual({ url: 'https://b', token: 't2' });
    expect(redisFromEnv({ STORAGE_KV_REST_API_URL: 'https://c', STORAGE_KV_REST_API_TOKEN: 't3', STORAGE_KV_REST_API_READ_ONLY_TOKEN: 'ro' })).toEqual({ url: 'https://c', token: 't3' });
    expect(redisFromEnv({ KV_REST_API_URL: 'https://a' })).toBeNull();
    expect(redisFromEnv({})).toBeNull();
  });
});

describe('RedisStore', () => {
  it('пустая база, запись, чтение и резервная копия предыдущей версии', async () => {
    const f = fakeUpstash();
    const store = new RedisStore({ url: 'https://x', token: 'tok', fetchImpl: f.impl });
    expect(await store.get()).toEqual(emptyState());

    await store.update((s) => void s.projects.push(project('p1', 'A')));
    await store.update((s) => void s.projects.push(project('p2', 'B')));
    expect((await store.get()).projects.map((p) => p.name)).toEqual(['A', 'B']);
    expect(JSON.parse(f.kv.get('tempo:v2:meta:bak')!).projects).toHaveLength(1);
  });

  it('если функция бросила ошибку, ничего не записывается', async () => {
    const f = fakeUpstash();
    const store = new RedisStore({ url: 'https://x', token: 'tok', fetchImpl: f.impl });
    await expect(store.update(() => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(f.calls).not.toContain('WRITE');
  });

  it('одновременная запись с другого устройства не теряется: чтение и попытка повторяются', async () => {
    let injected = false;
    const f = fakeUpstash({
      beforeEval: (kv) => {
        if (injected) return;
        injected = true;
        kv.set('tempo:v2:meta', JSON.stringify({ v: 2, projects: [project('other', 'FromPhone')], shards: [] }));
      }
    });
    const store = new RedisStore({ url: 'https://x', token: 'tok', fetchImpl: f.impl });
    await store.update((s) => void s.projects.push(project('mine', 'FromPC')));
    expect((await store.get()).projects.map((p) => p.name).sort()).toEqual(['FromPC', 'FromPhone']);
  });

  it('записи раскладываются по месяцам, и запись трогает только изменённый месяц', async () => {
    const f = fakeUpstash();
    const store = new RedisStore({ url: 'https://x', token: 'tok', fetchImpl: f.impl });
    const m = (month: number, id: string) => ({ ...entry(id, null), start: new Date(Date.UTC(2026, month, 5, 8)).toISOString(), end: new Date(Date.UTC(2026, month, 5, 9)).toISOString() });
    await store.update((s) => void s.entries.push(m(6, 'jul'), m(7, 'aug'), m(8, 'sep')));
    expect(JSON.parse(f.kv.get('tempo:v2:meta')!).shards).toEqual(['2026-07', '2026-08', '2026-09']);
    expect([...f.kv.keys()].filter((k) => k.startsWith('tempo:v2:e:') && !k.endsWith(':bak'))).toHaveLength(3);

    const before = f.kv.get('tempo:v2:e:2026-07');
    await store.update((s) => void s.entries.push({ ...m(8, 'sep2') }));
    expect(f.kv.get('tempo:v2:e:2026-07')).toBe(before);
    expect(f.kv.has('tempo:v2:e:2026-07:bak')).toBe(false);
    expect((await store.get()).entries.map((e) => e.id).sort()).toEqual(['aug', 'jul', 'sep', 'sep2']);
  });

  it('пустой месяц удаляется, а удалённая запись не возвращается', async () => {
    const f = fakeUpstash();
    const store = new RedisStore({ url: 'https://x', token: 'tok', fetchImpl: f.impl });
    await store.update((s) => void s.entries.push(entry('a', null)));
    await store.update((s) => void s.entries.splice(0, 1));
    expect(f.kv.has('tempo:v2:e:2026-09')).toBe(false);
    expect((await store.get()).entries).toEqual([]);
  });

  it('старый единый документ читается и переезжает в новую раскладку, оставаясь нетронутым', async () => {
    const f = fakeUpstash();
    const legacy = JSON.stringify({ projects: [project('p1', 'Old')], entries: [entry('e1', 'p1')] });
    f.kv.set('tempo:state', legacy);
    const store = new RedisStore({ url: 'https://x', token: 'tok', fetchImpl: f.impl });
    expect((await store.get()).entries).toHaveLength(1);
    await store.update((s) => void s.entries.push(entry('e2', 'p1', 12)));
    expect((await store.get()).entries.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
    expect(f.kv.get('tempo:state')).toBe(legacy);
  });

  it('без изменений ничего не пишется', async () => {
    const f = fakeUpstash();
    const store = new RedisStore({ url: 'https://x', token: 'tok', fetchImpl: f.impl });
    await store.update((s) => void s.projects.push(project('p1', 'A')));
    const writes = f.calls.filter((c) => c === 'WRITE').length;
    await store.update(() => undefined);
    expect(f.calls.filter((c) => c === 'WRITE').length).toBe(writes);
  });

  it('копии: суточная перезаписывается, ручные получают свой номер, список новее-первым, чтение и порог хранения', async () => {
    const f = fakeUpstash();
    const store = new RedisStore({ url: 'https://x', token: 'tok', fetchImpl: f.impl });
    await store.update((s) => void s.entries.push(entry('a', null)));
    const day1 = await store.backups.create('daily');
    await store.update((s) => void s.entries.push(entry('b', null, 12)));
    const day2 = await store.backups.create('daily');
    expect(day2.id).toBe(day1.id);
    expect(day2.entries).toBe(2);
    expect((await store.backups.list()).map((b) => b.id)).toEqual([day1.id]);
    expect((await store.backups.read(day1.id))!.entries).toHaveLength(2);
    expect(await store.backups.read('../etc')).toBeNull();
  });

  it('ошибка хранилища превращается в понятное сообщение', async () => {
    const bad = (async () => new Response(JSON.stringify({ error: 'WRONGPASS' }), { status: 401 })) as unknown as typeof fetch;
    const store = new RedisStore({ url: 'https://x', token: 'tok', fetchImpl: bad });
    await expect(store.get()).rejects.toThrow(/Хранилище недоступно/);
  });
});

describe('онлайн-версия: пароль', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const f = fakeUpstash();
    const store = new RedisStore({ url: 'https://x', token: 'tok', fetchImpl: f.impl });
    server = createApp(store, { password: 'correct horse battery' }).listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const call = (method: string, path: string, body?: unknown, cookie?: string) =>
    fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });

  it('без входа данные закрыты, статус сессии открыт', async () => {
    expect((await call('GET', '/api/state')).status).toBe(401);
    expect((await call('POST', '/api/projects', { name: 'X' })).status).toBe(401);
    expect((await call('GET', '/api/backup')).status).toBe(401);
    const s = await (await call('GET', '/api/session')).json();
    expect(s).toEqual({ authRequired: true, authenticated: false });
  });

  it('неверный пароль не пускает, верный выдаёт защищённую куку', async () => {
    const bad = await call('POST', '/api/login', { password: 'nope' });
    expect(bad.status).toBe(401);
    expect(bad.headers.get('set-cookie')).toBeNull();

    const ok = await call('POST', '/api/login', { password: 'correct horse battery' });
    expect(ok.status).toBe(200);
    const raw = ok.headers.get('set-cookie')!;
    expect(raw).toMatch(/HttpOnly/);
    expect(raw).toMatch(/SameSite=Lax/);
    const cookie = raw.split(';')[0];

    const state = await call('GET', '/api/state', undefined, cookie);
    expect(state.status).toBe(200);
    expect(((await (await call('GET', '/api/session', undefined, cookie)).json()) as { authenticated: boolean }).authenticated).toBe(true);

    // подделанная кука не проходит
    const forged = cookie.replace(/\.[0-9a-f]+$/i, '.' + '0'.repeat(64));
    expect((await call('GET', '/api/state', undefined, forged)).status).toBe(401);

    // выход гасит куку
    const out = await call('POST', '/api/logout', undefined, cookie);
    expect(out.headers.get('set-cookie')).toMatch(/Max-Age=0/);
  });

  it('с кукой работают создание проекта и резервная копия', async () => {
    const login = await call('POST', '/api/login', { password: 'correct horse battery' });
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const created = await call('POST', '/api/projects', { name: 'Online', rate: 30 }, cookie);
    expect(created.status).toBe(200);
    const backup = await call('GET', '/api/backup', undefined, cookie);
    expect(backup.headers.get('content-disposition')).toMatch(/tempo-backup-/);
    expect(((await backup.json()) as State).projects.some((p) => p.name === 'Online')).toBe(true);
  });
});

describe('загрузка данных из файла', () => {
  it('проверяет, что файл — копия Tempo', () => {
    expect(() => parseBackup(null)).toThrow(BackupError);
    expect(() => parseBackup({ foo: 1 })).toThrow(BackupError);
    expect(() => parseBackup({ projects: [{ id: 1 }], entries: [] })).toThrow(/проекты/);
    expect(() => parseBackup({ projects: [], entries: [{ id: 'a', start: 'xx', end: null }] })).toThrow(/записи/);
    expect(parseBackup({ projects: [], entries: [] })).toEqual(emptyState());
  });

  it('слияние добавляет недостающее и не дублирует при повторной загрузке', () => {
    const target: State = { ...blank(), projects: [project('p1', 'SFIT')], entries: [entry('e1', 'p1')] };
    const incoming: State = {
      ...blank(),
      // тот же проект под другим id + новый проект
      projects: [project('other-id', 'sfit'), project('p9', 'New')],
      entries: [entry('e1', 'other-id'), entry('e2', 'other-id', 10), entry('e3', 'p9', 12)]
    };
    const first = mergeState(target, incoming);
    expect(first).toEqual({ projects: 1, entries: 2, skipped: 1 });
    // записи проекта «sfit» привязаны к существующему p1
    expect(target.entries.find((e) => e.id === 'e2')!.projectId).toBe('p1');

    const again = mergeState(target, incoming);
    expect(again).toEqual({ projects: 0, entries: 0, skipped: 3 });
    expect(target.entries).toHaveLength(3);
  });

  it('импортированные из Toggl записи не задваиваются по externalId', () => {
    const target: State = { ...blank(), projects: [], entries: [{ ...entry('a', null), externalId: 'toggl:1' }] };
    const incoming: State = { ...blank(), projects: [], entries: [{ ...entry('b', null), externalId: 'toggl:1' }] };
    expect(mergeState(target, incoming).entries).toBe(0);
  });

  it('больше одного идущего таймера не остаётся', () => {
    const s = parseBackup({
      projects: [],
      entries: [
        { id: 'a', description: '', projectId: null, start: iso(8), end: null },
        { id: 'b', description: '', projectId: null, start: iso(9), end: null }
      ]
    });
    expect(s.entries.filter((e) => e.end === null)).toHaveLength(1);
    expect(s.entries.find((e) => e.id === 'a')!.end).toBe(iso(9));
  });
});
