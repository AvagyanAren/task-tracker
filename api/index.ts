/**
 * Vercel serverless entry point. Every /api/* request is rewritten here
 * (see vercel.json) and handed to the same Express app the local server uses,
 * with Upstash Redis as the database. Without the database the function refuses
 * to serve anything.
 */
import express from 'express';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../src/server/app.js';
import { RedisStore, redisFromEnv } from '../src/server/redisStore.js';

function build(): express.Express {
  // No password by default. Setting TRACKER_PASSWORD in Vercel turns the login screen back on.
  const password = process.env.TRACKER_PASSWORD || undefined;
  const redis = redisFromEnv();

  if (!redis) {
    const broken = express();
    broken.use((_req, res) =>
      res.status(503).json({ error: 'Онлайн-версия не настроена. Подключите базу Upstash Redis в Vercel: Storage → Marketplace → Upstash Redis.' })
    );
    return broken;
  }
  return createApp(new RedisStore(redis), { password });
}

let app: express.Express | undefined;

export default function handler(req: IncomingMessage, res: ServerResponse) {
  app ??= build();
  return (app as unknown as (r: IncomingMessage, s: ServerResponse) => void)(req, res);
}
