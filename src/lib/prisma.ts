/**
 * PINIT-DNA — Prisma Client Singleton
 *
 * Exports a single PrismaClient instance. In development, re-uses the instance
 * across hot-reloads to avoid exhausting the connection pool.
 */

import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

// Add connection timeouts so slow DB connections fail fast (avoids Render's proxy dropping the TCP
// connection after 30 s, which the browser reports as "Network Error" rather than an HTTP error).
const _rawDbUrl = process.env['DATABASE_URL'] ?? '';
if (_rawDbUrl && !_rawDbUrl.includes('connect_timeout')) {
  const _sep = _rawDbUrl.includes('?') ? '&' : '?';
  process.env['DATABASE_URL'] = `${_rawDbUrl}${_sep}connect_timeout=10&pool_timeout=5&connection_limit=3`;
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
    ],
  });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(prisma as any).$on('error', (e: { message: string }) => logger.error('Prisma error', { message: e.message }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(prisma as any).$on('warn',  (e: { message: string }) => logger.warn('Prisma warning', { message: e.message }));

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
