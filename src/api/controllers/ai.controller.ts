/**
 * PINIT-DNA — Search Controller
 * Uses Postgres full-text search — no Python AI, no extra RAM.
 */

import { Request, Response, NextFunction } from 'express';
import { searchRecords, getSearchStats } from '../../services/search/postgres-search.service';
import { auditService } from '../../services/audit/audit.service';

// ─── GET /ai/health ───────────────────────────────────────────────────────────

export async function aiHealth(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const stats = await getSearchStats();
    res.status(200).json({
      success: true,
      ai: { ...stats },
    });
  } catch (err) { next(err); }
}

// ─── GET /ai/stats ────────────────────────────────────────────────────────────

export async function aiStats(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const stats = await getSearchStats();
    res.status(200).json({ success: true, stats });
  } catch (err) { next(err); }
}

// ─── POST /ai/search ──────────────────────────────────────────────────────────

export async function semanticSearch(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { query, topK, threshold } = req.body as {
    query?: string; topK?: number; threshold?: number;
  };

  if (!query?.trim()) {
    res.status(400).json({ success: false, error: 'query is required' });
    return;
  }

  try {
    const response = await searchRecords(query, topK ?? 20, Math.round((threshold ?? 0.5) * 100));

    await auditService.log({
      eventType: 'SEMANTIC_SEARCH',
      detail: { query, resultCount: response.count, engine: 'postgres-fts' },
      req,
    });

    res.status(200).json({ success: true, ...response });
  } catch (err) { next(err); }
}

// ─── POST /ai/index/:dnaRecordId — no-op (Postgres searches live data) ────────

export async function indexDocument(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ success: true, message: 'Postgres FTS indexes live data — no manual indexing needed' });
}

// ─── POST /ai/embed — not applicable ─────────────────────────────────────────

export async function generateEmbedding(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ success: true, message: 'Embeddings not used — Postgres FTS engine active' });
}

// ─── POST /ai/duplicates ──────────────────────────────────────────────────────

export async function detectDuplicates(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { text } = req.body as { text?: string };
  if (!text?.trim()) {
    res.status(400).json({ success: false, error: 'text is required' });
    return;
  }
  try {
    const response = await searchRecords(text, 5, 70);
    res.status(200).json({ success: true, duplicates: response.results, count: response.count });
  } catch (err) { next(err); }
}

// ─── POST /ai/similar ────────────────────────────────────────────────────────

export async function findSimilar(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { query, topK } = req.body as { query?: string; topK?: number };
  if (!query?.trim()) {
    res.status(400).json({ success: false, error: 'query is required' });
    return;
  }
  try {
    const response = await searchRecords(query, topK ?? 5, 0);
    res.status(200).json({ success: true, data: response.results });
  } catch (err) { next(err); }
}
