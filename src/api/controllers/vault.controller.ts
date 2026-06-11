/**
 * PINIT-DNA — Vault Controller
 *
 * POST /vault/store           — Encrypt image and store in vault
 * GET  /vault/:id             — Get vault record metadata
 * POST /vault/:id/retrieve    — Decrypt and return original image
 */

import { Request, Response, NextFunction } from 'express';
import fs from 'fs/promises';
import { VaultService } from '../../services/vault/vault.service';
import { AppError } from '../middleware/error.middleware';
import { logger } from '../../lib/logger';
import { auditService } from '../../services/audit/audit.service';
import { autoIndexer }  from '../../services/ai/auto-indexer.service';
import {
  detectSensitiveTypes,
  extractTextFromPdf,
  extractTextFromDocx,
  extractTextFromPlain,
} from '../../services/privacy/privacy-masking.service';

const vaultService = new VaultService();

// ─── GET /vault ───────────────────────────────────────────────────────────────

export async function listVaultRecords(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { prisma } = await import('../../lib/prisma');
    const records = await prisma.vaultRecord.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        dnaRecord: { select: { id: true, status: true, imageFilename: true } },
      },
    });

    res.status(200).json({
      success: true,
      count: records.length,
      vaults: records.map((r) => ({
        id:                  r.id,
        dnaRecordId:         r.dnaRecordId,
        originalFileName:    r.originalFileName,
        originalMimeType:    r.originalMimeType,
        encryptedSizeBytes:  r.encryptedSizeBytes,
        originalSizeBytes:   r.originalSizeBytes,
        encryptionAlgorithm: r.encryptionAlgorithm,
        keyDerivation:       r.keyDerivation,
        createdAt:           r.createdAt.toISOString(),
        dnaRecord: {
          id:       r.dnaRecord.id,
          status:   r.dnaRecord.status,
          filename: r.dnaRecord.imageFilename,
        },
      })),
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /vault/store ────────────────────────────────────────────────────────

export async function storeInVault(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.file) {
    return next(new AppError(400, 'No image file provided. Use multipart field name "image".'));
  }

  const { dnaRecordId } = req.body as { dnaRecordId?: string };
  if (!dnaRecordId?.trim()) {
    return next(new AppError(400, 'dnaRecordId is required in the request body.'));
  }

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(req.file.path);
  } catch {
    return next(new AppError(500, 'Failed to read uploaded file from disk.'));
  }

  try {
    const result = await vaultService.store({
      dnaRecordId:      dnaRecordId.trim(),
      imageBuffer:      buffer,
      originalFileName: req.file.originalname,
      originalMimeType: req.file.mimetype,
    });

    // Fire-and-forget: OCR + auto-index in FAISS after vault store
    autoIndexer.indexAfterVaultStore({
      dnaRecordId: result.dnaRecordId,
      vaultId:     result.vaultId,
      filename:    result.originalFileName,
      mimeType:    result.originalMimeType,
      buffer,
    });

    res.status(201).json({
      success: true,
      vaultId:             result.vaultId,
      dnaRecordId:         result.dnaRecordId,
      originalFileName:    result.originalFileName,
      originalMimeType:    result.originalMimeType,
      encryptedSizeBytes:  result.encryptedSizeBytes,
      originalSizeBytes:   result.originalSizeBytes,
      encryptionAlgorithm: result.encryptionAlgorithm,
      storedAt:            result.createdAt.toISOString(),
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      return next(new AppError(404, err.message));
    }
    if (err instanceof Error && err.message.includes('already in the vault')) {
      return next(new AppError(409, err.message));
    }
    next(err);
  } finally {
    // Clean up temp upload file
    fs.unlink(req.file.path).catch((e) =>
      logger.warn('Failed to delete temp file', { path: req.file?.path, error: e })
    );
  }
}

// ─── GET /vault/:id ───────────────────────────────────────────────────────────

export async function getVaultRecord(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const { id } = req.params;

  try {
    const record = await vaultService.getRecord(id);

    res.status(200).json({
      success: true,
      vault: {
        id:                  record.id,
        dnaRecordId:         record.dnaRecordId,
        originalFileName:    record.originalFileName,
        originalMimeType:    record.originalMimeType,
        encryptedSizeBytes:  record.encryptedSizeBytes,
        originalSizeBytes:   record.originalSizeBytes,
        encryptionAlgorithm: record.encryptionAlgorithm,
        keyDerivation:       record.keyDerivation,
        createdAt:           record.createdAt.toISOString(),
        dnaRecord: {
          id:            record.dnaRecord.id,
          status:        record.dnaRecord.status,
          schemaVersion: record.dnaRecord.schemaVersion,
        },
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      return next(new AppError(404, err.message));
    }
    next(err);
  }
}

// ─── POST /vault/:id/retrieve ─────────────────────────────────────────────────

export async function retrieveFromVault(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const { id } = req.params;

  try {
    const result = await vaultService.retrieve(id);

    // Stream the decrypted image back as binary
    res.set({
      'Content-Type':        result.originalMimeType,
      'Content-Length':      String(result.originalBuffer.length),
      'Content-Disposition': `attachment; filename="${result.originalFileName}"`,
      'X-Vault-Id':          result.vaultId,
      'X-Original-Size':     String(result.originalSizeBytes),
    });

    // Audit the retrieval
    auditService.log({
      eventType: 'VAULT_RETRIEVED', vaultId: id,
      filename: result.originalFileName, fileType: result.originalMimeType,
      detail: { sizeBytes: result.originalSizeBytes }, req,
    });

    res.status(200).send(result.originalBuffer);
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      return next(new AppError(404, err.message));
    }
    if (err instanceof Error && err.message.includes('Unsupported state')) {
      return next(new AppError(422, 'Vault file integrity check failed — auth tag mismatch. File may be tampered.'));
    }
    next(err);
  }
}

// ─── POST /vault/:id/scan-sensitive ───────────────────────────────────────────
// Decrypt the vault file, extract text, detect which sensitive types are present.
// Returns detection flags WITHOUT masking anything.
// Called by the share modal when the owner enables Privacy Masking.

export async function scanVaultFile(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { id } = req.params;
  try {
    const result = await vaultService.retrieve(id);
    const mime   = result.originalMimeType;
    const buffer = result.originalBuffer;

    // Image / video / audio — no text to extract
    const IMAGE_TYPES  = ['image/jpeg','image/png','image/gif','image/webp','image/bmp','image/tiff'];
    const BINARY_TYPES = ['video/','audio/','application/octet-stream'];
    const isImage  = IMAGE_TYPES.includes(mime);
    const isBinary = BINARY_TYPES.some(t => mime.startsWith(t));

    if (isImage || isBinary) {
      res.json({
        success: true,
        supported: false,
        reason: isImage ? 'Images do not contain extractable text — masking cannot be applied to this file.' : 'Binary file type — no text to scan.',
        email: false, phone: false, aadhaar: false, pan: false, address: false,
        hasAnyMatch: false,
      });
      return;
    }

    // Extract text based on MIME
    let text = '';
    try {
      if (mime === 'application/pdf') {
        text = await extractTextFromPdf(buffer);
      } else if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        text = await extractTextFromDocx(buffer);
      } else if (mime.startsWith('text/') || mime === 'application/json') {
        text = extractTextFromPlain(buffer);
      } else {
        res.json({ success: true, supported: false, reason: 'Unsupported file type for text extraction.',
          email: false, phone: false, aadhaar: false, pan: false, address: false, hasAnyMatch: false });
        return;
      }
    } catch {
      res.json({ success: true, supported: false, reason: 'Could not extract text from this file.',
        email: false, phone: false, aadhaar: false, pan: false, address: false, hasAnyMatch: false });
      return;
    }

    const detection = detectSensitiveTypes(text);
    logger.info('[Privacy] Scan complete', { vaultId: id, ...detection });
    res.json({ success: true, ...detection });
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      return next(new AppError(404, err.message));
    }
    next(err);
  }
}
