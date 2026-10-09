import type { State } from '../shared/types.js';
import { gunzipSync, gzipSync } from 'node:zlib';
import { backupId, emptyState, KEEP_BACKUPS, normalize, validBackupId, type BackupInfo, type BackupStore, type StateStore } from './store.js';

/**
 * Online storage in Upstash Redis (connected through the Vercel Marketplace), reached
 * over its REST API, so no driver or open connection is needed in a serverless function.
 *
 * Layout (v2): the projects and the shard list live in `<p>:v2:meta`, and the time
 * entries are split into one document per month, `<p>:v2:e:YYYY-MM`. A write therefore
 * sends only the months that changed, and no single value ever grows past the REST
 * request limit however long the history gets. The pre-sharding single document
 * (`<p>:state`) is still read when nothing has been written in the new layout yet, and
 * is never modified, so it stays as a safety copy.
 *
 * Writes are compare-and-set over every key they touch: they apply only if each key
 * still holds exactly what this request read, otherwise the request re-reads and tries
 * again. The previous value of each changed key is kept under `<key>:bak`.
 */

// KEYS: none (ARGV[1] = meta key, ARGV[2] = shard key prefix). Returns { meta, shard1, shard2, ... }, '' = absent.
const READ_ALL = `
local meta = redis.call('GET', ARGV[1])
local out = { meta or '' }
if meta then
  local ok, m = pcall(cjson.decode, meta)
  if ok and type(m) == 'table' and type(m.shards) == 'table' then
    for _, k in ipairs(m.shards) do out[#out + 1] = redis.call('GET', ARGV[2] .. k) or '' end
  end
end
return out`;

// ARGV[1] = n, then n triples: key, expected current value ('' = absent), new value ('' = delete).
const CAS_MANY = `
local n = tonumber(ARGV[1])
for i = 0, n - 1 do
  local cur = redis.call('GET', ARGV[2 + i * 3])
  if cur == false then cur = '' end
  if cur ~= ARGV[3 + i * 3] then return 0 end
end
for i = 0, n - 1 do
  local key = ARGV[2 + i * 3]
  local cur = redis.call('GET', key)
  if cur then redis.call('SET', key .. ':bak', cur) end
  if ARGV[4 + i * 3] == '' then redis.call('DEL', key) else redis.call('SET', key, ARGV[4 + i * 3]) end
end
return 1`;

export interface RedisOptions {
  url: string;
  token: string;
  key?: string;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

/** Reads the connection from the variables the Vercel/Upstash integration creates. */
export function redisFromEnv(env: NodeJS.ProcessEnv = process.env): RedisOptions | null {
  // The integration can add a custom prefix (e.g. STORAGE_KV_REST_API_URL), so match by suffix.
  const pairs: Array<[RegExp, RegExp]> = [
    [/(^|_)KV_REST_API_URL$/, /(^|_)KV_REST_API_TOKEN$/],
    [/(^|_)UPSTASH_REDIS_REST_URL$/, /(^|_)UPSTASH_REDIS_REST_TOKEN$/]
  ];
  for (const [urlRe, tokenRe] of pairs) {
    const urlKey = Object.keys(env).find((k) => urlRe.test(k) && env[k]);
    if (!urlKey) continue;
    const prefix = urlKey.replace(urlRe, '');
    // Prefer the token with the same prefix; the read-only token is never used for writing.
    const tokenKey =
      Object.keys(env).find((k) => tokenRe.test(k) && k.startsWith(prefix) && env[k]) ?? Object.keys(env).find((k) => tokenRe.test(k) && env[k]);
    if (tokenKey) return { url: env[urlKey]!, token: env[tokenKey]! };
  }
  return null;
}

/** Month shard key of an entry, from its start time (UTC). */
export const shardOf = (start: string) => start.slice(0, 7);

export class RedisStore implements StateStore {
  private readonly meta: string;
  private readonly shardPrefix: string;
  private readonly legacy: string;
  private readonly backupIndex: string;
  private readonly backupPrefix: string;
  private readonly doFetch: typeof fetch;

  constructor(private readonly opts: RedisOptions) {
    const p = opts.key ?? 'tempo';
    this.meta = `${p}:v2:meta`;
    this.shardPrefix = `${p}:v2:e:`;
    this.legacy = `${p}:state`;
    this.backupIndex = `${p}:v2:baks`;
    this.backupPrefix = `${p}:v2:bak:`;
    this.doFetch = opts.fetchImpl ?? fetch;
  }

  private async command<T>(...args: Array<string | number>): Promise<T> {
    const res = await this.doFetch(this.opts.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.opts.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args)
    });
    const body = (await res.json().catch(() => ({}))) as { result?: T; error?: string };
    if (!res.ok || body.error) throw new Error(`Хранилище недоступно: ${body.error ?? res.status}`);
    return body.result as T;
  }

  /** Reads everything; `raw` holds the stored string of every key, for the compare-and-set. */
  private async read(): Promise<{ raw: Map<string, string>; state: State }> {
    const out = await this.command<string[]>('EVAL', READ_ALL, 0, this.meta, this.shardPrefix);
    const raw = new Map<string, string>();
    const metaRaw = out[0] ?? '';
    if (!metaRaw) {
      // Nothing in the sharded layout yet: fall back to the old single document.
      const old = await this.command<string | null>('GET', this.legacy);
      return { raw, state: old ? normalize(JSON.parse(old) as Partial<State>) : emptyState() };
    }
    raw.set(this.meta, metaRaw);
    const meta = JSON.parse(metaRaw) as Partial<State> & { shards?: string[] };
    const entries: State['entries'] = [];
    (meta.shards ?? []).forEach((name, i) => {
      const doc = out[i + 1] ?? '';
      raw.set(this.shardPrefix + name, doc);
      if (doc) entries.push(...(JSON.parse(doc) as State['entries']));
    });
    return { raw, state: normalize({ ...meta, projects: meta.projects ?? [], entries }) };
  }

  private backupKey(id: string) {
    return this.backupPrefix + id;
  }

  private serialize(state: State): Map<string, string> {
    const byShard = new Map<string, State['entries']>();
    for (const e of state.entries) {
      const k = shardOf(e.start);
      (byShard.get(k) ?? byShard.set(k, []).get(k)!).push(e);
    }
    const docs = new Map<string, string>();
    const names = [...byShard.keys()].sort();
    for (const name of names) docs.set(this.shardPrefix + name, JSON.stringify(byShard.get(name)));
    docs.set(this.meta, JSON.stringify({ v: 2, projects: state.projects, clients: state.clients, invoices: state.invoices, boards: state.boards, tasks: state.tasks, profile: state.profile, shards: names }));
    return docs;
  }

  async get(): Promise<State> {
    return (await this.read()).state;
  }

  /** Copies are gzip+base64 documents under `<p>:v2:bak:<id>`; `<p>:v2:baks` lists them. */
  readonly backups: BackupStore = {
    create: async (kind = 'manual') => {
      const state = (await this.read()).state;
      const info: BackupInfo = { id: backupId(kind), at: new Date().toISOString(), entries: state.entries.length, projects: state.projects.length };
      const packed = gzipSync(JSON.stringify(state)).toString('base64');
      await this.command('SET', this.backupKey(info.id), packed);
      const index = (await this.backups.list()).filter((b) => b.id !== info.id);
      const next = [info, ...index].sort((a, b) => (a.id < b.id ? 1 : -1));
      for (const old of next.slice(KEEP_BACKUPS)) await this.command('DEL', this.backupKey(old.id));
      await this.command('SET', this.backupIndex, JSON.stringify(next.slice(0, KEEP_BACKUPS)));
      return info;
    },
    list: async () => {
      const raw = await this.command<string | null>('GET', this.backupIndex);
      return raw ? (JSON.parse(raw) as BackupInfo[]) : [];
    },
    read: async (id) => {
      if (!validBackupId(id)) return null;
      const packed = await this.command<string | null>('GET', this.backupKey(id));
      return packed ? normalize(JSON.parse(gunzipSync(Buffer.from(packed, 'base64')).toString('utf8')) as Partial<State>) : null;
    }
  };

  async update<T>(fn: (draft: State) => T): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { raw, state } = await this.read();
      const draft = structuredClone(state);
      const result = fn(draft);
      const next = this.serialize(draft);

      const args: Array<string | number> = [];
      let n = 0;
      for (const [key, doc] of next) {
        if (doc !== (raw.get(key) ?? '')) {
          args.push(key, raw.get(key) ?? '', doc);
          n++;
        }
      }
      for (const [key, old] of raw) {
        if (old && !next.has(key)) {
          args.push(key, old, '');
          n++;
        }
      }
      if (n === 0) return result;
      const ok = await this.command<number>('EVAL', CAS_MANY, 0, n, ...args);
      if (ok === 1) return result;
    }
    throw new Error('Данные одновременно изменились с другого устройства. Повторите действие.');
  }
}
