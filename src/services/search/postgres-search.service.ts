/**
 * PINIT-DNA — Postgres Full-Text Search Service
 * Replaces Python AI / sentence-transformers with native Postgres FTS.
 * Zero extra RAM, zero cost, always online.
 */

import { prisma } from '../../lib/prisma';

export interface SearchResult {
  dnaRecordId:       string;
  filename:          string;
  fileType:          string;
  snippet:           string;
  similarity:        number;
  similarityPercent: number;
  confidence:        { level: string; label: string; color: string };
  searchType:        string;
  indexedAt:         string;
  title:             string;
  author:            string;
  keywordScore:      number;
  semanticScore:     number;
  hybridScore:       number;
}

export interface SearchResponse {
  results:      SearchResult[];
  count:        number;
  totalIndexed: number;
  processingMs: number;
  query:        string;
}

function confidenceBadge(pct: number): SearchResult['confidence'] {
  if (pct >= 85) return { level: 'HIGH_CONFIDENCE', label: 'High Confidence', color: 'success' };
  if (pct >= 70) return { level: 'STRONG_MATCH',    label: 'Strong Match',    color: 'success' };
  if (pct >= 50) return { level: 'POSSIBLE_MATCH',  label: 'Possible Match',  color: 'warning' };
  return           { level: 'WEAK_MATCH',          label: 'Weak Match',      color: 'gray'    };
}

/**
 * Full-text + ILIKE search across DNA records.
 * Uses Postgres ts_rank for ranking and ILIKE as a fallback.
 */
export async function searchRecords(
  query: string,
  topK = 20,
  threshold = 0.0,
): Promise<SearchResponse> {
  const start = Date.now();
  const safe  = query.trim().replace(/['"\\]/g, ' ').slice(0, 200);

  type RawRow = {
    id:            string;
    imageFilename: string;
    fileType:      string | null;
    createdAt:     Date;
    extractedText: string | null;
    fts_rank:      number;
    ilike_hit:     boolean;
  };

  // Postgres FTS: rank by ts_rank on filename + fileType + OCR text,
  // with ILIKE fallback so partial-word matches still show up.
  const rows = await prisma.$queryRaw<RawRow[]>`
    SELECT
      d.id,
      d."imageFilename",
      d."fileType",
      d."createdAt",
      o."extractedText",
      COALESCE(
        ts_rank(
          to_tsvector('english',
            COALESCE(d."imageFilename", '') || ' ' ||
            COALESCE(d."fileType", '') || ' ' ||
            COALESCE(o."extractedText", '')
          ),
          plainto_tsquery('english', ${safe})
        ), 0
      ) AS fts_rank,
      (
        d."imageFilename" ILIKE ${'%' + safe + '%'}
        OR COALESCE(d."fileType", '') ILIKE ${'%' + safe + '%'}
        OR COALESCE(o."extractedText", '') ILIKE ${'%' + safe + '%'}
      ) AS ilike_hit
    FROM dna_records d
    LEFT JOIN ocr_records o ON o."dnaRecordId" = d.id
    WHERE
      (
        to_tsvector('english',
          COALESCE(d."imageFilename", '') || ' ' ||
          COALESCE(d."fileType", '') || ' ' ||
          COALESCE(o."extractedText", '')
        ) @@ plainto_tsquery('english', ${safe})
      )
      OR d."imageFilename" ILIKE ${'%' + safe + '%'}
      OR COALESCE(o."extractedText", '') ILIKE ${'%' + safe + '%'}
    ORDER BY fts_rank DESC, d."createdAt" DESC
    LIMIT ${topK}
  `;

  const totalIndexed = await prisma.dnaRecord.count();

  // Normalise rank to 0-100 similarity score
  const maxRank = rows.reduce((m, r) => Math.max(m, Number(r.fts_rank)), 0) || 1;

  const results: SearchResult[] = rows
    .map(r => {
      const ftsScore   = Number(r.fts_rank) / maxRank;
      const ilikeScore = r.ilike_hit ? 0.5 : 0;
      // Hybrid: FTS 70% + ILIKE 30%
      const hybrid  = ftsScore > 0 ? ftsScore * 0.7 + ilikeScore * 0.3 : ilikeScore * 0.6;
      const pct     = Math.round(Math.min(hybrid, 1) * 100);

      // Build snippet from OCR text or filename
      const text    = r.extractedText ?? '';
      const idx     = text.toLowerCase().indexOf(safe.toLowerCase());
      const snippet = idx >= 0
        ? '…' + text.slice(Math.max(0, idx - 60), idx + 120).trim() + '…'
        : text.slice(0, 150) || r.imageFilename;

      return {
        dnaRecordId:       r.id,
        filename:          r.imageFilename,
        fileType:          r.fileType ?? 'IMAGE',
        title:             r.imageFilename.replace(/\.[^.]+$/, '').replace(/[_\-]/g, ' '),
        author:            '',
        snippet,
        similarity:        hybrid,
        similarityPercent: pct,
        confidence:        confidenceBadge(pct),
        searchType:        ftsScore > 0 ? 'full-text' : 'keyword',
        indexedAt:         r.createdAt.toISOString(),
        keywordScore:      ilikeScore,
        semanticScore:     ftsScore,
        hybridScore:       hybrid,
      };
    })
    .filter(r => r.similarityPercent >= threshold);

  return {
    results,
    count:        results.length,
    totalIndexed,
    processingMs: Date.now() - start,
    query,
  };
}

export async function getSearchStats() {
  const total = await prisma.dnaRecord.count();
  return { totalIndexed: total, engine: 'postgres-fts', online: true };
}
