// BetterCommunity Web API. Boots Fastify, wires Postgres (Prisma) + Redis, and
// registers the feature routes. See ARCHITECTURE.md for the design.

import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { db } from './lib.mjs';
import authRoutes from './routes/auth.mjs';
import catalogRoutes from './routes/catalog.mjs';
import miscRoutes from './routes/misc.mjs';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true, credentials: true });
await app.register(cookie);
await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

app.get('/health', async () => {
  let dbOk = false;
  try { await (await db()).$queryRaw`SELECT 1`; dbOk = true; } catch { /* not ready */ }
  return { ok: true, db: dbOk, ts: Date.now() };
});

await app.register(authRoutes);
await app.register(catalogRoutes);
await app.register(miscRoutes);

const port = Number(process.env.PORT || 3000);
app.listen({ port, host: '0.0.0.0' })
  .then(() => app.log.info(`BCWEB API listening on :${port}`))
  .catch((e) => { app.log.error(e); process.exit(1); });
