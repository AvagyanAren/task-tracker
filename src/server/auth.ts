import type { NextFunction, Request, Response } from 'express';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE = 'tempo_session';
const MAX_AGE_S = 30 * 24 * 3600;
const OPEN_PATHS = new Set(['/login', '/logout', '/session']);

const sha = (s: string) => createHash('sha256').update(s).digest();

export interface Auth {
  enabled: boolean;
  /** Mount on `/api`: blocks everything except login/logout/session. */
  guard: (req: Request, res: Response, next: NextFunction) => void;
  session: (req: Request, res: Response) => void;
  login: (req: Request, res: Response) => Promise<void>;
  logout: (req: Request, res: Response) => void;
}

/**
 * One shared password, set through the TRACKER_PASSWORD variable. After a correct
 * password the browser gets a signed, HttpOnly cookie valid for 30 days. The signing
 * key is derived from the password, so changing the password logs everyone out.
 * With no password configured (local use) everything stays open.
 */
export function createAuth(password: string | undefined): Auth {
  const enabled = Boolean(password);
  const key = createHmac('sha256', 'tempo-session-key').update(password ?? '').digest();
  const mac = (payload: string) => createHmac('sha256', key).update(payload).digest('hex');
  const failures: number[] = [];

  const issue = () => {
    const exp = Math.floor(Date.now() / 1000) + MAX_AGE_S;
    return `${exp}.${mac(String(exp))}`;
  };

  const valid = (token: string | undefined) => {
    if (!token) return false;
    const [exp, sig] = token.split('.');
    if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
    const want = Buffer.from(mac(exp));
    const got = Buffer.from(sig);
    return want.length === got.length && timingSafeEqual(want, got);
  };

  const cookieOf = (req: Request) => {
    for (const part of (req.headers.cookie ?? '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0 && part.slice(0, i).trim() === COOKIE) return decodeURIComponent(part.slice(i + 1).trim());
    }
    return undefined;
  };

  const authed = (req: Request) => !enabled || valid(cookieOf(req));
  const secure = (req: Request) => req.secure || req.headers['x-forwarded-proto'] === 'https';
  const setCookie = (req: Request, res: Response, value: string, maxAge: number) =>
    res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure(req) ? '; Secure' : ''}`);

  return {
    enabled,
    guard(req, res, next) {
      if (authed(req) || OPEN_PATHS.has(req.path)) return next();
      res.status(401).json({ error: 'Нужен вход.' });
    },
    session(req, res) {
      res.json({ authRequired: enabled, authenticated: authed(req) });
    },
    async login(req, res) {
      if (!enabled) {
        res.json({ authRequired: false, authenticated: true });
        return;
      }
      const recent = failures.filter((t) => Date.now() - t < 10 * 60_000);
      failures.length = 0;
      failures.push(...recent);
      if (recent.length >= 8) {
        res.status(429).json({ error: 'Слишком много попыток. Подождите несколько минут.' });
        return;
      }
      const given = String(req.body?.password ?? '');
      if (timingSafeEqual(sha(given), sha(password!))) {
        setCookie(req, res, issue(), MAX_AGE_S);
        res.json({ authRequired: true, authenticated: true });
        return;
      }
      failures.push(Date.now());
      await new Promise((r) => setTimeout(r, 700)); // slows down guessing
      res.status(401).json({ error: 'Неверный пароль.' });
    },
    logout(req, res) {
      setCookie(req, res, '', 0);
      res.json({ authRequired: enabled, authenticated: false });
    }
  };
}
