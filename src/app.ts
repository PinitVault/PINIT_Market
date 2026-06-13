/**
 * PINIT-DNA — Application Entry Point
 */

import 'express-async-errors';
import fs   from 'fs';
import path from 'path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { config } from './config';
import { logger } from './lib/logger';
import { dnaRouter }               from './api/routes/dna.routes';
import { vaultRouter }             from './api/routes/vault.routes';
import { intelligenceRouter }      from './api/routes/intelligence.routes';
import { certificateMgmtRouter }   from './api/routes/certificate-mgmt.routes';
import { forensicDiffRouter }      from './api/routes/forensic-diff.routes';
import { aiRouter }               from './api/routes/ai.routes';
import { monitoringRouter }        from './api/routes/monitoring.routes';
import { shareRouter }            from './api/routes/share.routes';
import { authRouter }             from './api/routes/auth.routes';
import { getHealthReport }         from './lib/health';
import { vaultScheduler }         from './services/scheduler/vault-scheduler.service';
import { startPythonAI } from './lib/python-ai-process';
import { errorMiddleware } from './api/middleware/error.middleware';

const app = express();

// ─── Static UI ────────────────────────────────────────────────────────────────
// Serve React build (client/dist) if it exists, otherwise fall back to public/
const reactBuildPath = path.join(__dirname, '..', 'client', 'dist');
const publicPath     = path.join(__dirname, '..', 'public');

if (fs.existsSync(reactBuildPath)) {
  app.use(express.static(reactBuildPath));
} else {
  app.use(express.static(publicPath));
}

// ─── Trust proxy (Render uses 1 hop, ngrok uses 1 hop)
app.set('trust proxy', 1);

// ─── Security headers ─────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Allows: localhost (any port) + ALL ngrok domains + optional custom domain
app.use(cors({
  origin: (origin, callback) => {
    // No origin = server-to-server, Postman, curl → always allow
    if (!origin) return callback(null, true);

    const allowed =
      origin.includes('localhost')       ||
      origin.includes('127.0.0.1')       ||
      origin.includes('ngrok.io')        ||
      origin.includes('ngrok-free.app')  ||
      origin.includes('ngrok-free.dev')  ||
      origin.includes('ngrok.app')       ||
      origin.includes('vercel.app')      ||
      origin.includes('onrender.com')    ||   // ← Render deployments
      (!!process.env['ALLOWED_ORIGIN'] && origin === process.env['ALLOWED_ORIGIN']);

    if (allowed) return callback(null, true);

    // Log denied origins for debugging — do NOT throw, just deny
    logger.warn('CORS: origin denied', { origin });
    return callback(null, false);   // ← returns 403, NOT 500
  },
  credentials: true,
}));

// ─── Request logging ──────────────────────────────────────────────────────────
app.use(
  morgan('dev', {
    stream: { write: (msg) => logger.http(msg.trim()) },
  })
);

// ─── Body parsers ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Rate limiting ────────────────────────────────────────────────────────────
// Skip rate limiting for public share viewer endpoints (no auth needed)
const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max:      config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders:   false,
  skip: (req) => req.path.startsWith('/api/v1/share/') && req.method === 'GET',
});
app.use(apiLimiter);

// ─── Health check (Phase 6 — detailed) ────────────────────────────────────────
app.get('/health', async (_req, res) => {
  const report = await getHealthReport();
  const httpStatus = report.status === 'healthy' ? 200 : report.status === 'degraded' ? 207 : 503;
  res.status(httpStatus).json(report);
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use(`${config.apiPrefix}/dna`,          dnaRouter);
app.use(`${config.apiPrefix}/vault`,        vaultRouter);
app.use(`${config.apiPrefix}/intelligence`, intelligenceRouter);
app.use(`${config.apiPrefix}/certificates`, certificateMgmtRouter);
app.use(`${config.apiPrefix}/forensic`,    forensicDiffRouter);
app.use(`${config.apiPrefix}/ai`,         aiRouter);
app.use(`${config.apiPrefix}/monitor`,   monitoringRouter);
app.use(`${config.apiPrefix}/share`,     shareRouter);
app.use(`${config.apiPrefix}/auth`,      authRouter);

// ─── React SPA catch-all ─────────────────────────────────────────────────────
// Serves index.html for /dashboard, /compare, /vault etc. (client-side routing)
app.get('*', (_req, res) => {
  const reactIndex = path.join(__dirname, '..', 'client', 'dist', 'index.html');
  if (fs.existsSync(reactIndex)) {
    res.sendFile(reactIndex);
  } else {
    res.status(404).json({ success: false, error: 'Route not found' });
  }
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use(errorMiddleware);

// ─── Start server ─────────────────────────────────────────────────────────────
if (require.main === module) {
  const server = app.listen(config.port, () => {
    logger.info('PINIT-DNA API running', {
      port:   config.port,
      env:    config.env,
      prefix: config.apiPrefix,
      engineVersion: config.dna.engineVersion,
    });

    // Phase 5: Start scheduled tasks
    vaultScheduler.start();

    // Pre-warm sharp/libvips so the first real upload request doesn't hang
    // waiting for native thread-pool initialization (critical on Render cold start).
    setTimeout(() => {
      import('sharp').then(({ default: sharp }) => {
        const dummy = Buffer.from([0xff, 0xff, 0xff]); // 1×1 white pixel RGB
        sharp(dummy, { raw: { width: 1, height: 1, channels: 3 } })
          .toFormat('jpeg')
          .toBuffer()
          .then(() => logger.info('sharp warm-up complete'))
          .catch(() => logger.warn('sharp warm-up failed (non-fatal)'));
      }).catch(() => {});
    }, 500);

    // Python AI and auto-reindex are disabled in production (free tier: 512MB RAM limit).
    // Enable locally with ENABLE_AI=true.
    if (process.env['ENABLE_AI'] === 'true') {
      startPythonAI();

      setTimeout(async () => {
        try {
          const { prisma: db } = await import('./lib/prisma');
          const { aiService }  = await import('./services/ai/ai-embeddings.service');
          const online = await aiService.isOnline();
          if (!online) return;
          const records = await db.dnaRecord.findMany({
            select: {
              id: true, imageFilename: true, fileType: true,
              ocrRecord: { select: { extractedText: true } },
            },
          });
          let indexed = 0;
          const BATCH = 10;
          for (let i = 0; i < records.length; i += BATCH) {
            await Promise.all(records.slice(i, i + BATCH).map(async (r) => {
              try {
                const ocrText = r.ocrRecord?.extractedText;
                const text = ocrText && ocrText.length > 50
                  ? `${r.imageFilename} ${ocrText}`
                  : r.imageFilename.replace(/\.[^.]+$/, '').replace(/[_\-\.]/g, ' ').trim();
                await aiService.indexDocument({
                  dnaRecordId: r.id, filename: r.imageFilename,
                  fileType: r.fileType ?? 'IMAGE', text,
                });
                indexed++;
              } catch { /* non-fatal */ }
            }));
          }
          logger.info(`Auto-reindex complete: ${indexed}/${records.length} documents indexed`);
        } catch (err) {
          logger.debug('Auto-reindex failed (non-fatal)', { error: String(err) });
        }
      }, 20_000);
    } else {
      logger.info('Python AI disabled — set ENABLE_AI=true to enable');
    }

    // Phase 6: Register graceful shutdown (also stops Python AI)
    const { registerGracefulShutdown } = require('./lib/graceful-shutdown');
    registerGracefulShutdown(server);
  });
}

export { app };
