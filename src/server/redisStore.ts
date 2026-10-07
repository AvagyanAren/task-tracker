import type { State } from '../shared/types.js';
import { normalize, type StateStore } from './store.js';

/**
 * Online storage: the whole state is one JSON document in Upstash Redis
 * (connected through the Vercel Marketplace), reached over its REST API, so no
 * driver or open connection is needed in a serverless function.
 *
 * Writes are compare-and-set: the new document is stored only if the key still
 * holds exactly what this request read, otherwise it re-reads and tries again.
 * The previous version is kept under `<key>:bak` on every successful write.
 */

// KEYS[1] = data key, KEYS[2] = backup key, ARGV[1] = expected current value ('' = absent), ARGV[2] = new value
const CAS = `
local cur = redis.call('GET', KEYS[1])
if (cur == false and ARGV[1] == '') or cur == ARGV[1] then
  if cur ~= false then redis.call('SET', KEYS[2], cur) end
  redis.call('SET', KEYS[1], ARGV[2])
  return 1
end
return 0`;

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

export class RedisStore implements StateStore {
  private readonly key: string;
  private readonly doFetch: typeof fetch;

  constructor(private readonly opts: RedisOptions) {
    this.key = opts.key ?? 'tempo:state';
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

  private async read(): Promise<{ raw: string; state: State }> {
    const raw = await this.command<string | null>('GET', this.key);
    if (!raw) return { raw: '', state: { projects: [], entries: [] } };
    return { raw, state: normalize(JSON.parse(raw) as Partial<State>) };
  }

  async get(): Promise<State> {
    return (await this.read()).state;
  }

  async update<T>(fn: (draft: State) => T): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { raw, state } = await this.read();
      const draft = structuredClone(state);
      const result = fn(draft);
      const ok = await this.command<number>('EVAL', CAS, 2, this.key, `${this.key}:bak`, raw, JSON.stringify(draft));
      if (ok === 1) return result;
    }
    throw new Error('Данные одновременно изменились с другого устройства. Повторите действие.');
  }
}
