import express from 'express';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Entry, Project, State } from '../shared/types.js';
import { Store } from './store.js';
import { importToggl } from './toggl.js';

class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

function cleanTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const t of v) {
    const tag = String(t).trim().replace(/^#/, '').slice(0, 40);
    if (tag && !out.some((x) => x.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out.slice(0, 20);
}

const isIso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));

function cleanProject(body: Record<string, unknown>, partial: boolean): Partial<Project> {
  const out: Partial<Project> = {};
  if (!partial || body.name !== undefined) {
    const name = String(body.name ?? '').trim();
    if (!name) throw new HttpError(400, 'Укажите название проекта.');
    out.name = name.slice(0, 120);
  }
  if (!partial || body.rate !== undefined) {
    const rate = Number(body.rate ?? 0);
    if (!Number.isFinite(rate) || rate < 0) throw new HttpError(400, 'Ставка должна быть числом не меньше нуля.');
    out.rate = Math.round(rate * 100) / 100;
  }
  if (body.currency !== undefined) out.currency = String(body.currency).trim().slice(0, 8) || '$';
  if (body.color !== undefined) out.color = String(body.color).slice(0, 20);
  if (body.archived !== undefined) out.archived = Boolean(body.archived);
  return out;
}

export function createApp(store: Store) {
  const app = express();
  app.use(express.json({ limit: '20mb' }));

  const snapshot = () => store.get();
  const nameTaken = (s: State, name: string, exceptId?: string) =>
    s.projects.some((p) => p.id !== exceptId && p.name.trim().toLowerCase() === name.trim().toLowerCase());
  const checkProject = (s: State, id: unknown) => {
    if (id === null || id === undefined || id === '') return null;
    if (!s.projects.some((p) => p.id === id)) throw new HttpError(400, 'Такого проекта нет.');
    return String(id);
  };

  app.get('/api/state', (_req, res) => res.json(snapshot()));

  /* ---------------- projects ---------------- */

  app.post('/api/projects', (req, res) => {
    const fields = cleanProject(req.body ?? {}, false);
    store.update((s) => {
      if (nameTaken(s, fields.name!)) throw new HttpError(409, 'Проект с таким названием уже есть.');
      s.projects.push({
        id: randomUUID(),
        name: fields.name!,
        rate: fields.rate ?? 0,
        currency: fields.currency ?? '$',
        color: fields.color ?? '#2f6feb',
        archived: false,
        createdAt: new Date().toISOString()
      });
    });
    res.json(snapshot());
  });

  app.put('/api/projects/:id', (req, res) => {
    const fields = cleanProject(req.body ?? {}, true);
    store.update((s) => {
      const p = s.projects.find((x) => x.id === req.params.id);
      if (!p) throw new HttpError(404, 'Проект не найден.');
      if (fields.name && nameTaken(s, fields.name, p.id)) throw new HttpError(409, 'Проект с таким названием уже есть.');
      Object.assign(p, fields);
    });
    res.json(snapshot());
  });

  app.delete('/api/projects/:id', (req, res) => {
    store.update((s) => {
      if (!s.projects.some((p) => p.id === req.params.id)) throw new HttpError(404, 'Проект не найден.');
      if (s.entries.some((e) => e.projectId === req.params.id)) {
        throw new HttpError(409, 'В проекте есть записи времени — его можно только архивировать.');
      }
      s.projects = s.projects.filter((p) => p.id !== req.params.id);
    });
    res.json(snapshot());
  });

  /* ---------------- timer ---------------- */

  app.post('/api/timer/start', (req, res) => {
    store.update((s) => {
      const now = new Date().toISOString();
      const running = s.entries.find((e) => e.end === null);
      if (running) running.end = now; // like Toggl: starting a new timer stops the old one
      s.entries.push({
        id: randomUUID(),
        description: String(req.body?.description ?? '').trim().slice(0, 500),
        projectId: checkProject(s, req.body?.projectId),
        tags: cleanTags(req.body?.tags),
        billable: req.body?.billable === undefined ? true : Boolean(req.body.billable),
        start: now,
        end: null,
        source: 'timer'
      });
    });
    res.json(snapshot());
  });

  app.post('/api/timer/stop', (_req, res) => {
    store.update((s) => {
      const running = s.entries.find((e) => e.end === null);
      if (running) running.end = new Date().toISOString();
    });
    res.json(snapshot());
  });

  /* ---------------- entries ---------------- */

  app.post('/api/entries', (req, res) => {
    const { start, end } = req.body ?? {};
    if (!isIso(start) || !isIso(end)) throw new HttpError(400, 'Укажите начало и конец.');
    if (Date.parse(end) <= Date.parse(start)) throw new HttpError(400, 'Конец должен быть позже начала.');
    store.update((s) => {
      s.entries.push({
        id: randomUUID(),
        description: String(req.body?.description ?? '').trim().slice(0, 500),
        projectId: checkProject(s, req.body?.projectId),
        tags: cleanTags(req.body?.tags),
        billable: req.body?.billable === undefined ? true : Boolean(req.body.billable),
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        source: 'manual'
      });
    });
    res.json(snapshot());
  });

  app.put('/api/entries/:id', (req, res) => {
    const b = req.body ?? {};
    store.update((s) => {
      const e = s.entries.find((x) => x.id === req.params.id);
      if (!e) throw new HttpError(404, 'Запись не найдена.');
      const next: Entry = { ...e };
      if (b.description !== undefined) next.description = String(b.description).trim().slice(0, 500);
      if (b.projectId !== undefined) next.projectId = checkProject(s, b.projectId);
      if (b.tags !== undefined) next.tags = cleanTags(b.tags);
      if (b.billable !== undefined) next.billable = Boolean(b.billable);
      if (b.start !== undefined) {
        if (!isIso(b.start)) throw new HttpError(400, 'Некорректное начало.');
        next.start = new Date(b.start).toISOString();
      }
      if (b.end !== undefined) {
        if (b.end === null) {
          if (s.entries.some((x) => x.id !== e.id && x.end === null)) {
            throw new HttpError(409, 'Уже идёт другой таймер.');
          }
          next.end = null;
        } else {
          if (!isIso(b.end)) throw new HttpError(400, 'Некорректный конец.');
          next.end = new Date(b.end).toISOString();
        }
      }
      if (next.end && Date.parse(next.end) <= Date.parse(next.start)) {
        throw new HttpError(400, 'Конец должен быть позже начала.');
      }
      if (next.end === null && Date.parse(next.start) > Date.now() + 60_000) {
        throw new HttpError(400, 'Начало идущего таймера не может быть в будущем.');
      }
      Object.assign(e, next);
    });
    res.json(snapshot());
  });

  app.delete('/api/entries/:id', (req, res) => {
    store.update((s) => {
      if (!s.entries.some((e) => e.id === req.params.id)) throw new HttpError(404, 'Запись не найдена.');
      s.entries = s.entries.filter((e) => e.id !== req.params.id);
    });
    res.json(snapshot());
  });

  /* ---------------- import ---------------- */

  app.post('/api/import/toggl', (req, res) => {
    const csv = String(req.body?.csv ?? '');
    const offset = Number(req.body?.tzOffsetMinutes ?? 0);
    if (!csv.trim()) throw new HttpError(400, 'Файл пустой.');
    if (!Number.isFinite(offset)) throw new HttpError(400, 'Некорректный часовой пояс.');
    const dryRun = Boolean(req.body?.dryRun);

    try {
      if (dryRun) {
        const summary = importToggl(structuredClone(snapshot()), csv, offset);
        return res.json({ dryRun: true, summary });
      }
      const summary = store.update((s) => importToggl(s, csv, offset));
      res.json({ dryRun: false, summary, state: snapshot() });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, err instanceof Error ? err.message : String(err));
    }
  });

  const staticDir = resolve(process.cwd(), 'dist/public');
  if (existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get('*', (_req, res) => res.sendFile(resolve(staticDir, 'index.html')));
  }

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Внутренняя ошибка: ${message}` });
  });

  return app;
}
