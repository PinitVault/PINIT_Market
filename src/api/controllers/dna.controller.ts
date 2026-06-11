/**
 * PINIT-DNA — DNA Controller
 *
 * Handles HTTP concerns: parsing the request, loading the image buffer,
 * delegating to the orchestrator/verifier, and formatting the response.
 * No business logic lives here.
 */

import { Request, Response, NextFunction } from 'express';
import fs from 'fs/promises';
import { z } from 'zod';

import { DnaVerifier } from '../../services/dna.verifier';
import { UniversalVerifier } from '../../services/universal-verifier';
import { auditService }  from '../../services/audit/audit.service';
import { autoIndexer }   from '../../services/ai/auto-indexer.service';
import { UniversalFileRouter } from '../../services/universal-file-router';
import { duplicateCheckService } from '../../services/duplicate/duplicate-check.service';
import { prisma } from '../../lib/prisma';
import { AppError } from '../middleware/error.middleware';
import { logger } from '../../lib/logger';
import { SUPPORTED_FILE_TYPES } from '../../config/supported-file-types';
import {
  GenerateDnaResponse,
  VerifyDnaResponse,
  GetDnaRecordResponse,
  LayerName,
} from '../../types/dna.types';

const router             = new UniversalFileRouter();
const imageVerifier      = new DnaVerifier();
const universalVerifier  = new UniversalVerifier();

/** File types that use the image verifier (layer tables) */
const IMAGE_FILE_TYPES = new Set(['IMAGE', null, undefined]);

// ─── Validation schemas ───────────────────────────────────────────────────────

const layerNameEnum = z.enum([
  'cryptographic',
  'structural',
  'perceptual',
  'semantic',
  'metadata',
  'steganography',
]);

const verifyBodySchema = z.object({
  layers: z.array(layerNameEnum).optional(),
});

// ─── GET /dna ─────────────────────────────────────────────────────────────────

export async function listDnaRecords(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const records = await prisma.dnaRecord.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        schemaVersion: true,
        imageFilename: true,
        imageMimeType: true,
        imageSizeBytes: true,
        createdAt: true,
        vaultRecord: { select: { id: true } },
      },
    });

    res.status(200).json({
      success: true,
      count: records.length,
      records: records.map((r) => ({
        id:            r.id,
        status:        r.status,
        schemaVersion: r.schemaVersion,
        imageFilename: r.imageFilename,
        imageMimeType: r.imageMimeType,
        imageSizeBytes: r.imageSizeBytes,
        createdAt:     r.createdAt.toISOString(),
        vaultId:       r.vaultRecord?.id ?? null,
      })),
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /dna/generate ───────────────────────────────────────────────────────

export async function generateDna(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.file) {
    return next(new AppError(400, 'No file provided. Use multipart field name "image".'));
  }

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(req.file.path);
  } catch {
    return next(new AppError(500, 'Failed to read uploaded file from disk.'));
  }

  // ── DUPLICATE CHECK — must run BEFORE any DNA/vault/certificate work ────────
  // Computes SHA-256 instantly, queries CryptoLayer table, and for images also
  // runs a pHash near-duplicate scan. Returns 409 Conflict on any match.
  const dupResult = await duplicateCheckService.check(
    buffer,
    req.file.mimetype,
    req.file.originalname,
    req,
  );

  if (dupResult.isDuplicate) {
    // Clean up the temp file immediately
    await fs.unlink(req.file.path).catch(() => {});

    logger.warn('[DNA] Duplicate upload blocked', {
      matchType:        dupResult.matchType,
      existingRecordId: dupResult.existingRecordId,
      isHighRisk:       dupResult.isHighRisk,
    });

    res.status(409).json({
      success:   false,
      duplicate: true,
      error:     'This file already exists in the PINIT-DNA registry. Duplicate uploads are not permitted.',
      matchType:           dupResult.matchType,
      existingRecordId:    dupResult.existingRecordId,
      existingFilename:    dupResult.existingFilename,
      existingCreatedAt:   dupResult.existingCreatedAt,
      sha256Hash:          dupResult.sha256Hash,
      pHashSimilarity:     dupResult.pHashSimilarity,
      riskLevel:           dupResult.isHighRisk ? 'HIGH' : 'LOW',
    });
    return;
  }
  // ── End duplicate check ─────────────────────────────────────────────────────

  try {
    // UniversalFileRouter: detects file type → routes to correct engine
    const result = await router.route({
      filePath:        req.file.path,
      originalName:    req.file.originalname,
      declaredMimeType: req.file.mimetype,
      sizeBytes:       req.file.size,
      buffer,
    });

    const response: GenerateDnaResponse = {
      success:             true,
      dnaRecordId:         result.dnaRecordId,
      status:              result.status,
      schemaVersion:       result.schemaVersion,
      fileType:            result.fileType,
      engineVersion:       result.engineVersion,
      detectedBy:          result.detectedBy,
      detectionConfidence: result.detectionConfidence,
      summary: {
        totalLayers:       result.layerSummary.total,
        successfulLayers:  result.layerSummary.successful,
        failedLayers:      result.layerSummary.failed,
        totalProcessingMs: result.totalProcessingMs,
      },
      generatedAt: result.generatedAt.toISOString(),
    };

    // Fire-and-forget: auto-index in FAISS for semantic search
    autoIndexer.indexAfterDnaGeneration({
      dnaRecordId: result.dnaRecordId,
      filename:    req.file?.originalname ?? '',
      mimeType:    req.file?.mimetype ?? '',
      fileType:    result.fileType,
      buffer,
    });

    // Fire-and-forget audit log
    auditService.log({
      eventType: 'DNA_GENERATED', dnaRecordId: result.dnaRecordId,
      filename: req.file?.originalname, fileType: result.fileType,
      detail: { status: result.status, layers: result.layerSummary }, req,
    });

    res.status(201).json(response);
  } catch (err) {
    // "not yet implemented" errors from the router → 422
    if (err instanceof Error && err.message.includes('not yet available')) {
      return next(new AppError(422, err.message));
    }
    // Unknown file type → 415
    if (err instanceof Error && err.message.includes('Unsupported file type')) {
      return next(new AppError(415, err.message));
    }
    next(err);
  } finally {
    // Clean up temp file regardless of success/failure
    fs.unlink(req.file.path).catch((e) =>
      logger.warn('Failed to delete temp file', { path: req.file?.path, error: e })
    );
  }
}

// ─── GET /dna/supported-types ─────────────────────────────────────────────────

export async function getSupportedTypes(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const types = SUPPORTED_FILE_TYPES.map((ft) => ({
      fileType:        ft.fileType,
      displayName:     ft.displayName,
      category:        ft.category,
      engineStatus:    ft.engineStatus,
      plannedPhase:    ft.plannedPhase,
      mimeTypes:       ft.mimeTypes,
      extensions:      ft.extensions,
      maxFileSizeMb:   Math.round(ft.maxFileSizeBytes / (1024 * 1024)),
      layers: {
        L2: ft.l2Implementation,
        L3: ft.l3Implementation,
        L4: ft.l4Implementation,
        L5: ft.l5Implementation,
        L6: ft.l6Implementation,
      },
    }));

    const live    = types.filter((t) => t.engineStatus === 'LIVE');
    const planned = types.filter((t) => t.engineStatus === 'PLANNED');

    res.status(200).json({
      success:        true,
      engineVersion:  '2.0.0-universal',
      totalSupported: types.length,
      live:           live.length,
      planned:        planned.length,
      types,
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /dna/:id/verify ─────────────────────────────────────────────────────

export async function verifyDna(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const { id } = req.params;

  if (!req.file) {
    return next(new AppError(400, 'No probe image provided. Use multipart field name "image".'));
  }

  const bodyParse = verifyBodySchema.safeParse(req.body);
  if (!bodyParse.success) {
    return next(new AppError(400, bodyParse.error.message));
  }

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(req.file.path);
  } catch {
    return next(new AppError(500, 'Failed to read uploaded file from disk.'));
  }

  try {
    // Look up the stored record's fileType to route to correct verifier
    const record = await prisma.dnaRecord.findUnique({
      where: { id }, select: { fileType: true },
    });

    if (!record) return next(new AppError(404, `DNA record not found: ${id}`));

    const isImage = IMAGE_FILE_TYPES.has(record.fileType as string | null | undefined);

    let result;
    if (isImage) {
      // Image records → existing DnaVerifier (uses separate layer tables)
      result = await imageVerifier.verify(
        id,
        { filePath: req.file.path, originalName: req.file.originalname,
          mimeType: req.file.mimetype, sizeBytes: req.file.size, buffer },
        bodyParse.data.layers as LayerName[] | undefined
      );
    } else {
      // TXT/CSV/JSON records → UniversalVerifier
      result = await universalVerifier.verify(id, {
        filePath: req.file.path, originalName: req.file.originalname,
        declaredMimeType: req.file.mimetype, sizeBytes: req.file.size, buffer,
      });
    }

    const response: VerifyDnaResponse = {
      success: true,
      dnaRecordId: result.dnaRecordId,
      passed: result.passed,
      confidenceScore: result.confidenceScore,
      layerResults: result.layerResults as VerifyDnaResponse['layerResults'],
      verifiedAt: result.verifiedAt.toISOString(),
    };

    res.status(200).json(response);
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      return next(new AppError(404, err.message));
    }
    next(err);
  } finally {
    fs.unlink(req.file.path).catch((e) =>
      logger.warn('Failed to delete temp file', { path: req.file?.path, error: e })
    );
  }
}

// ─── GET /dna/:id ─────────────────────────────────────────────────────────────

export async function getDnaRecord(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const { id } = req.params;

  try {
    const record = await prisma.dnaRecord.findUnique({
      where: { id },
      include: {
        cryptoLayer: { select: { id: true } },
        structuralLayer: { select: { id: true } },
        perceptualLayer: { select: { id: true } },
        semanticLayer: { select: { id: true } },
        metadataLayer: { select: { id: true } },
        stegoLayer: { select: { id: true } },
      },
    });

    if (!record) {
      return next(new AppError(404, `DNA record not found: ${id}`));
    }

    const response: GetDnaRecordResponse = {
      success: true,
      record: {
        id: record.id,
        status: record.status,
        schemaVersion: record.schemaVersion,
        image: {
          filename: record.imageFilename,
          mimeType: record.imageMimeType,
          sizeBytes: record.imageSizeBytes,
          widthPx: record.imageWidthPx,
          heightPx: record.imageHeightPx,
        },
        layers: {
          crypto: !!record.cryptoLayer,
          structural: !!record.structuralLayer,
          perceptual: !!record.perceptualLayer,
          semantic: !!record.semanticLayer,
          metadata: !!record.metadataLayer,
          steganography: !!record.stegoLayer,
        },
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      },
    };

    res.status(200).json(response);
  } catch (err) {
    next(err);
  }
}

// ─── GET /dna/duplicate-attempts ─────────────────────────────────────────────
// Admin dashboard: returns all DUPLICATE_UPLOAD_ATTEMPT audit events, newest first.

export async function getDuplicateAttempts(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const limit  = Math.min(parseInt(req.query['limit']  as string ?? '100', 10), 500);
    const offset = parseInt(req.query['offset'] as string ?? '0',   10);

    const [events, total] = await Promise.all([
      prisma.auditEvent.findMany({
        where:   { eventType: 'DUPLICATE_UPLOAD_ATTEMPT' },
        orderBy: { createdAt: 'desc' },
        take:    limit,
        skip:    offset,
      }),
      prisma.auditEvent.count({ where: { eventType: 'DUPLICATE_UPLOAD_ATTEMPT' } }),
    ]);

    res.json({
      success: true,
      total,
      count:  events.length,
      events: events.map((e) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const detail = (e.detail ?? {}) as Record<string, any>;
        return {
          id:                  e.id,
          timestamp:           e.createdAt.toISOString(),
          filename:            e.filename,
          fileType:            e.fileType,
          ipAddress:           e.ipAddress,
          browser:             e.browser,
          os:                  e.os,
          device:              e.device,
          matchType:           detail['matchType']           ?? null,
          riskLevel:           detail['riskLevel']           ?? 'LOW',
          sha256Hash:          detail['sha256Hash']          ?? null,
          existingDnaRecordId: detail['existingDnaRecordId'] ?? null,
          existingFilename:    detail['existingFilename']    ?? null,
          pHashSimilarity:     detail['pHashSimilarity']     ?? null,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
}

