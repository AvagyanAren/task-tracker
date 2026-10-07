import express from 'express';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Client, Entry, InvoiceRecord, Project, State } from '../shared/types.js';
import { computeTotals, lineAmount, nextInvoiceNumber } from '../shared/invoice.js';
import { createAuth } from './auth.js';
import { BackupError, mergeState, parseBackup } from './restore.js';
import type { StateStore } from './store.js';
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

/** An id made by the browser, so a request replayed after a lost connection is recognised and not applied twice. */
const cleanId = (v: unknown): string | null => (typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v) ? v : null);

/** When the user really pressed the button (kept if offline for a while); never in the future. */
const clientTime = (v: unknown): string => {
  const now = Date.now();
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return new Date(Number.isFinite(t) ? Math.min(t, now) : now).toISOString();
};

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
  if (body.clientId !== undefined) out.clientId = body.clientId === null || body.clientId === '' ? null : String(body.clientId);
  return out;
}

const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

function cleanClient(body: Record<string, unknown>, partial: boolean): Partial<Client> {
  const out: Partial<Client> = {};
  if (!partial || body.name !== undefined) {
    const name = str(body.name, 120);
    if (!name) throw new HttpError(400, 'Укажите название клиента.');
    out.name = name;
  }
  if (body.email !== undefined) out.email = str(body.email, 120);
  if (body.address !== undefined) out.address = str(body.address, 400);
  if (body.taxId !== undefined) out.taxId = str(body.taxId, 60);
  if (body.currency !== undefined) out.currency = str(body.currency, 8) || '$';
  if (body.dueDays !== undefined) out.dueDays = Math.round(num(body.dueDays, 0, 365, 14));
  if (body.notes !== undefined) out.notes = str(body.notes, 600);
  if (body.archived !== undefined) out.archived = Boolean(body.archived);
  return out;
}

const party = (v: unknown) => {
  const o = (v ?? {}) as Record<string, unknown>;
  return { name: str(o.name, 120), address: str(o.address, 400), email: str(o.email, 120) };
};

type Handler = (req: express.Request, res: express.Response) => Promise<unknown>;
/** Express 4 does not catch rejected promises; this passes them to the error handler. */
const h =
  (fn: Handler): express.RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

export interface AppOptions {
  /** Shared password for the online version. Empty = no login (local use). */
  password?: string;
}

export function createApp(store: StateStore, options: AppOptions = {}) {
  const app = express();
  app.use(express.json({ limit: '20mb' }));

  const auth = createAuth(options.password);
  app.post('/api/login', h((req, res) => auth.login(req, res)));
  app.post('/api/logout', (req, res) => auth.logout(req, res));
  app.get('/api/session', (req, res) => auth.session(req, res));

  // Called by the daily Vercel cron (see vercel.json) before the login gate. If CRON_SECRET is
  // set, Vercel sends it as a bearer token and anything else is refused. The copy is idempotent.
  app.get(
    '/api/cron/backup',
    h(async (req, res) => {
      const secret = process.env.CRON_SECRET;
      if (secret && req.headers.authorization !== `Bearer ${secret}`) throw new HttpError(401, 'Нет доступа.');
      if (!store.backups) throw new HttpError(501, 'Это хранилище не умеет делать копии.');
      res.json(await store.backups.create('daily'));
    })
  );

  app.use('/api', auth.guard);

  const snapshot = async (): Promise<State> => store.get();
  const nameTaken = (s: State, name: string, exceptId?: string) =>
    s.projects.some((p) => p.id !== exceptId && p.name.trim().toLowerCase() === name.trim().toLowerCase());
  const checkProject = (s: State, id: unknown) => {
    if (id === null || id === undefined || id === '') return null;
    if (!s.projects.some((p) => p.id === id)) throw new HttpError(400, 'Такого проекта нет.');
    return String(id);
  };

  app.get('/api/state', h(async (_req, res) => res.json(await snapshot())));

  /* ---------------- projects ---------------- */

  app.post(
    '/api/projects',
    h(async (req, res) => {
      const fields = cleanProject(req.body ?? {}, false);
      await store.update((s) => {
        if (nameTaken(s, fields.name!)) throw new HttpError(409, 'Проект с таким названием уже есть.');
        const clientId = fields.clientId ?? null;
        if (clientId && !s.clients.some((c) => c.id === clientId)) throw new HttpError(400, 'Такого клиента нет.');
        s.projects.push({
          id: randomUUID(),
          clientId,
          name: fields.name!,
          rate: fields.rate ?? 0,
          currency: fields.currency ?? '$',
          color: fields.color ?? '#2f6feb',
          archived: false,
          createdAt: new Date().toISOString()
        });
      });
      res.json(await snapshot());
    })
  );

  app.put(
    '/api/projects/:id',
    h(async (req, res) => {
      const fields = cleanProject(req.body ?? {}, true);
      await store.update((s) => {
        const p = s.projects.find((x) => x.id === req.params.id);
        if (!p) throw new HttpError(404, 'Проект не найден.');
        if (fields.name && nameTaken(s, fields.name, p.id)) throw new HttpError(409, 'Проект с таким названием уже есть.');
        if (fields.clientId && !s.clients.some((c) => c.id === fields.clientId)) throw new HttpError(400, 'Такого клиента нет.');
        Object.assign(p, fields);
      });
      res.json(await snapshot());
    })
  );

  app.delete(
    '/api/projects/:id',
    h(async (req, res) => {
      await store.update((s) => {
        if (!s.projects.some((p) => p.id === req.params.id)) throw new HttpError(404, 'Проект не найден.');
        if (s.entries.some((e) => e.projectId === req.params.id)) {
          throw new HttpError(409, 'В проекте есть записи времени — его можно только архивировать.');
        }
        s.projects = s.projects.filter((p) => p.id !== req.params.id);
      });
      res.json(await snapshot());
    })
  );

  /* ---------------- timer ---------------- */

  app.post(
    '/api/timer/start',
    h(async (req, res) => {
      const id = cleanId(req.body?.id) ?? randomUUID();
      const now = clientTime(req.body?.at);
      await store.update((s) => {
        if (s.entries.some((e) => e.id === id)) return; // the same request arrived again
        const running = s.entries.find((e) => e.end === null);
        if (running) running.end = Date.parse(now) > Date.parse(running.start) ? now : running.start; // like Toggl: starting a new timer stops the old one
        s.entries.push({
          id,
          description: String(req.body?.description ?? '').trim().slice(0, 500),
          projectId: checkProject(s, req.body?.projectId),
          tags: cleanTags(req.body?.tags),
          billable: req.body?.billable === undefined ? true : Boolean(req.body.billable),
          start: now,
          end: null,
          source: 'timer'
        });
      });
      res.json(await snapshot());
    })
  );

  app.post(
    '/api/timer/stop',
    h(async (req, res) => {
      const id = cleanId(req.body?.id);
      const at = clientTime(req.body?.at);
      await store.update((s) => {
        // With an id, stop exactly that entry (an already stopped or missing one is left alone).
        const target = id ? s.entries.find((e) => e.id === id) : s.entries.find((e) => e.end === null);
        if (target && target.end === null) target.end = Date.parse(at) > Date.parse(target.start) ? at : target.start;
      });
      res.json(await snapshot());
    })
  );

  /* ---------------- entries ---------------- */

  app.post(
    '/api/entries',
    h(async (req, res) => {
      const { start, end } = req.body ?? {};
      if (!isIso(start) || !isIso(end)) throw new HttpError(400, 'Укажите начало и конец.');
      if (Date.parse(end) <= Date.parse(start)) throw new HttpError(400, 'Конец должен быть позже начала.');
      const id = cleanId(req.body?.id) ?? randomUUID();
      await store.update((s) => {
        if (s.entries.some((e) => e.id === id)) return; // the same request arrived again
        s.entries.push({
          id,
          description: String(req.body?.description ?? '').trim().slice(0, 500),
          projectId: checkProject(s, req.body?.projectId),
          tags: cleanTags(req.body?.tags),
          billable: req.body?.billable === undefined ? true : Boolean(req.body.billable),
          start: new Date(start).toISOString(),
          end: new Date(end).toISOString(),
          source: 'manual'
        });
      });
      res.json(await snapshot());
    })
  );

  app.put(
    '/api/entries/:id',
    h(async (req, res) => {
      const b = req.body ?? {};
      await store.update((s) => {
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
      res.json(await snapshot());
    })
  );

  app.delete(
    '/api/entries/:id',
    h(async (req, res) => {
      await store.update((s) => {
        if (!s.entries.some((e) => e.id === req.params.id)) throw new HttpError(404, 'Запись не найдена.');
        s.entries = s.entries.filter((e) => e.id !== req.params.id);
      });
      res.json(await snapshot());
    })
  );

  /* ---------------- import ---------------- */

  app.post(
    '/api/import/toggl',
    h(async (req, res) => {
      const csv = String(req.body?.csv ?? '');
      const offset = Number(req.body?.tzOffsetMinutes ?? 0);
      if (!csv.trim()) throw new HttpError(400, 'Файл пустой.');
      if (!Number.isFinite(offset)) throw new HttpError(400, 'Некорректный часовой пояс.');
      const dryRun = Boolean(req.body?.dryRun);

      try {
        if (dryRun) {
          const summary = importToggl(structuredClone(await snapshot()), csv, offset);
          return res.json({ dryRun: true, summary });
        }
        const summary = await store.update((s) => importToggl(s, csv, offset));
        res.json({ dryRun: false, summary, state: await snapshot() });
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new HttpError(400, err instanceof Error ? err.message : String(err));
      }
    })
  );

  /* ---------------- clients ---------------- */

  app.post(
    '/api/clients',
    h(async (req, res) => {
      const f = cleanClient(req.body ?? {}, false);
      await store.update((s) => {
        if (s.clients.some((c) => c.name.trim().toLowerCase() === f.name!.toLowerCase())) throw new HttpError(409, 'Клиент с таким названием уже есть.');
        s.clients.push({
          id: randomUUID(),
          name: f.name!,
          email: f.email ?? '',
          address: f.address ?? '',
          taxId: f.taxId ?? '',
          currency: f.currency ?? '$',
          dueDays: f.dueDays ?? s.profile.dueDays,
          notes: f.notes ?? '',
          archived: false,
          createdAt: new Date().toISOString()
        });
      });
      res.json(await snapshot());
    })
  );

  app.put(
    '/api/clients/:id',
    h(async (req, res) => {
      const f = cleanClient(req.body ?? {}, true);
      await store.update((s) => {
        const c = s.clients.find((x) => x.id === req.params.id);
        if (!c) throw new HttpError(404, 'Клиент не найден.');
        if (f.name && s.clients.some((x) => x.id !== c.id && x.name.trim().toLowerCase() === f.name!.toLowerCase())) throw new HttpError(409, 'Клиент с таким названием уже есть.');
        Object.assign(c, f);
      });
      res.json(await snapshot());
    })
  );

  app.delete(
    '/api/clients/:id',
    h(async (req, res) => {
      await store.update((s) => {
        const i = s.clients.findIndex((x) => x.id === req.params.id);
        if (i < 0) throw new HttpError(404, 'Клиент не найден.');
        if (s.projects.some((p) => p.clientId === req.params.id) || s.invoices.some((v) => v.clientId === req.params.id)) {
          throw new HttpError(409, 'У клиента есть проекты или счета. Уберите их или переведите клиента в архив.');
        }
        s.clients.splice(i, 1);
      });
      res.json(await snapshot());
    })
  );

  /* ---------------- profile (sender details and invoice defaults) ---------------- */

  app.put(
    '/api/profile',
    h(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      await store.update((s) => {
        if (b.sender !== undefined) s.profile.sender = { ...party(b.sender), payment: str((b.sender as Record<string, unknown>)?.payment, 800) };
        if (b.lang !== undefined) s.profile.lang = b.lang === 'en' ? 'en' : 'ru';
        if (b.dueDays !== undefined) s.profile.dueDays = Math.round(num(b.dueDays, 0, 365, 14));
        if (b.notes !== undefined) s.profile.notes = str(b.notes, 1200);
      });
      res.json(await snapshot());
    })
  );

  /* ---------------- invoices ---------------- */

  app.post(
    '/api/invoices',
    h(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const rawLines = Array.isArray(b.lines) ? (b.lines as Array<Record<string, unknown>>) : [];
      if (rawLines.length === 0) throw new HttpError(400, 'В счёте нет позиций.');
      if (!isDay(b.issueDate) || !isDay(b.dueDate) || !isDay(b.periodFrom) || !isDay(b.periodTo)) throw new HttpError(400, 'Проверьте даты счёта.');
      const lines = rawLines.map((l) => {
        const hours = Math.round(num(l.hours, 0, 100000, 0) * 100) / 100;
        const rate = Math.round(num(l.rate, 0, 1000000, 0) * 100) / 100;
        return { description: str(l.description, 300), hours, rate, amount: lineAmount(hours * 3600, rate).amount };
      });
      const discountPct = num(b.discountPct, 0, 100, 0);
      const taxPct = num(b.taxPct, 0, 100, 0);
      const totals = computeTotals(lines, discountPct, taxPct);
      const status = b.status === 'sent' ? 'sent' : 'draft';
      const now = new Date().toISOString();
      let created!: InvoiceRecord;
      await store.update((s) => {
        const clientId = b.clientId ? String(b.clientId) : null;
        if (clientId && !s.clients.some((c) => c.id === clientId)) throw new HttpError(400, 'Такого клиента нет.');
        const year = Number(String(b.issueDate).slice(0, 4));
        const number = str(b.number, 40) || nextInvoiceNumber(s.invoices.map((v) => v.number), year);
        if (s.invoices.some((v) => v.number === number)) throw new HttpError(409, `Счёт с номером ${number} уже есть.`);
        const entryIds = (Array.isArray(b.entryIds) ? (b.entryIds as unknown[]) : []).map(String);
        const taken = new Set(entryIds);
        const already = s.entries.find((e) => taken.has(e.id) && e.invoiceId && s.invoices.some((v) => v.id === e.invoiceId));
        if (already) throw new HttpError(409, 'Часть записей уже есть в другом счёте. Обновите страницу.');
        created = {
          id: randomUUID(),
          number,
          status,
          clientId,
          projectIds: (Array.isArray(b.projectIds) ? (b.projectIds as unknown[]) : []).map(String),
          lang: b.lang === 'en' ? 'en' : 'ru',
          currency: str(b.currency, 8),
          issueDate: b.issueDate as string,
          dueDate: b.dueDate as string,
          periodFrom: b.periodFrom as string,
          periodTo: b.periodTo as string,
          sentAt: status === 'sent' ? now : null,
          paidAt: null,
          sender: { ...party(b.sender), payment: str((b.sender as Record<string, unknown>)?.payment, 800) },
          client: { ...party(b.client), taxId: str((b.client as Record<string, unknown>)?.taxId, 60) },
          lines,
          totalHours: Math.round(lines.reduce((n, l) => n + l.hours, 0) * 100) / 100,
          ...totals,
          discountPct,
          taxPct,
          notes: str(b.notes, 1200),
          entryIds,
          createdAt: now
        };
        s.invoices.push(created);
        for (const e of s.entries) if (taken.has(e.id)) e.invoiceId = created.id;
      });
      res.json({ invoice: created, state: await snapshot() });
    })
  );

  /** A finished invoice is not edited line by line (delete and re-issue instead); only its status, due date and notes change. */
  app.put(
    '/api/invoices/:id',
    h(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      await store.update((s) => {
        const inv = s.invoices.find((x) => x.id === req.params.id);
        if (!inv) throw new HttpError(404, 'Счёт не найден.');
        if (b.status !== undefined) {
          if (b.status !== 'draft' && b.status !== 'sent' && b.status !== 'paid') throw new HttpError(400, 'Неизвестный статус.');
          const now = new Date().toISOString();
          inv.status = b.status;
          inv.sentAt = b.status === 'draft' ? null : inv.sentAt ?? now;
          inv.paidAt = b.status === 'paid' ? now : null;
        }
        if (b.dueDate !== undefined) {
          if (!isDay(b.dueDate)) throw new HttpError(400, 'Проверьте срок оплаты.');
          inv.dueDate = b.dueDate;
        }
        if (b.notes !== undefined) inv.notes = str(b.notes, 1200);
      });
      res.json(await snapshot());
    })
  );

  app.delete(
    '/api/invoices/:id',
    h(async (req, res) => {
      await store.update((s) => {
        const i = s.invoices.findIndex((x) => x.id === req.params.id);
        if (i < 0) throw new HttpError(404, 'Счёт не найден.');
        const id = s.invoices[i].id;
        s.invoices.splice(i, 1);
        for (const e of s.entries) if (e.invoiceId === id) e.invoiceId = null; // the time can be invoiced again
      });
      res.json(await snapshot());
    })
  );

  /* ---------------- backup / restore ---------------- */

  app.get(
    '/api/backup',
    h(async (_req, res) => {
      res.setHeader('Content-Disposition', `attachment; filename="tempo-backup-${new Date().toISOString().slice(0, 10)}.json"`);
      res.json(await snapshot());
    })
  );

  /** mode "merge" adds what is missing; "replace" swaps the whole database for the file. */
  app.post(
    '/api/restore',
    h(async (req, res) => {
      const mode = req.body?.mode === 'replace' ? 'replace' : 'merge';
      let incoming: State;
      try {
        incoming = parseBackup(req.body?.state);
      } catch (err) {
        if (err instanceof BackupError) throw new HttpError(400, err.message);
        throw err;
      }
      const summary = await store.update((s) => {
        if (mode === 'replace') {
          const result = { projects: incoming.projects.length, entries: incoming.entries.length, skipped: 0 };
          s.projects = incoming.projects;
          s.entries = incoming.entries;
          s.clients = incoming.clients;
          s.invoices = incoming.invoices;
          s.profile = incoming.profile;
          return result;
        }
        return mergeState(s, incoming);
      });
      res.json({ mode, summary, state: await snapshot() });
    })
  );

  /* ---------------- automatic copies ---------------- */

  const backups = () => {
    if (!store.backups) throw new HttpError(501, 'Это хранилище не умеет делать копии.');
    return store.backups;
  };

  app.get('/api/backups', h(async (_req, res) => res.json(await backups().list())));
  app.post('/api/backups', h(async (_req, res) => res.json(await backups().create('manual'))));
  app.get(
    '/api/backups/:id',
    h(async (req, res) => {
      const state = await backups().read(String(req.params.id));
      if (!state) throw new HttpError(404, 'Такой копии нет.');
      res.setHeader('Content-Disposition', `attachment; filename="tempo-copy-${String(req.params.id)}.json"`);
      res.json(state);
    })
  );
  /** Puts a copy back. The current data is saved as a fresh copy first, so this can itself be undone. */
  app.post(
    '/api/backups/:id/restore',
    h(async (req, res) => {
      const copy = await backups().read(String(req.params.id));
      if (!copy) throw new HttpError(404, 'Такой копии нет.');
      const before = await backups().create('manual');
      await store.update((s) => {
        s.projects = copy.projects;
        s.entries = copy.entries;
        s.clients = copy.clients;
        s.invoices = copy.invoices;
        s.profile = copy.profile;
      });
      res.json({ state: await snapshot(), savedAs: before.id });
    })
  );

  /* ---------------- static files (local server) ---------------- */

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
