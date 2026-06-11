/**
 * PINIT-DNA — DNA Router
 *
 * Route definitions for the 6-layer DNA fingerprint API.
 *
 * POST   /dna/generate        — Upload image → generate 6-layer DNA
 * POST   /dna/:id/verify      — Upload probe image → verify against stored DNA
 * GET    /dna/:id             — Retrieve DNA record summary
 */

import { Router } from 'express';
import { uploadSingle, uploadComparison } from '../middleware/upload.middleware';
import { listDnaRecords, generateDna, verifyDna, getDnaRecord, getSupportedTypes, getDuplicateAttempts } from '../controllers/dna.controller';
import { compareDna } from '../controllers/comparison.controller';

const router = Router();

/**
 * POST /dna/generate
 *
 * Multipart form-data: field "image" = the image file
 *
 * Response 201:
 * {
 *   success: true,
 *   dnaRecordId: "uuid",
 *   status: "COMPLETE",
 *   schemaVersion: "1.0.0",
 *   summary: { totalLayers, successfulLayers, failedLayers, totalProcessingMs },
 *   generatedAt: "ISO8601"
 * }
 */
router.get('/', listDnaRecords);

/**
 * GET /dna/supported-types
 *
 * Returns all file types the Universal DNA engine supports or plans to support.
 * Includes engineStatus (LIVE / PLANNED), MIME types, extensions, layer impls.
 * Must be registered BEFORE /:id to avoid route shadowing.
 */
router.get('/supported-types', getSupportedTypes);
/** GET /dna/duplicate-attempts — Admin: list all blocked duplicate upload attempts */
router.get('/duplicate-attempts', getDuplicateAttempts);

router.post('/generate', uploadSingle, generateDna);

/**
 * POST /dna/compare
 *
 * Multipart form-data:
 *   fileA — original file (any supported type)
 *   fileB — comparison file (any supported type)
 *
 * Response 200: DnaComparisonResult with forensic report
 */
router.post('/compare', uploadComparison, compareDna);

/**
 * POST /dna/:id/verify
 *
 * Multipart form-data: field "image" = the probe image to verify
 * Optional JSON body field: "layers" = array of layer names to check
 *
 * Response 200:
 * {
 *   success: true,
 *   dnaRecordId: "uuid",
 *   passed: true,
 *   confidenceScore: 0.87,
 *   layerResults: [...],
 *   verifiedAt: "ISO8601"
 * }
 */
router.post('/:id/verify', uploadSingle, verifyDna);

/**
 * GET /dna/:id
 *
 * Response 200:
 * {
 *   success: true,
 *   record: {
 *     id, status, schemaVersion,
 *     image: { filename, mimeType, sizeBytes, widthPx, heightPx },
 *     layers: { crypto, structural, perceptual, semantic, metadata, steganography },
 *     createdAt, updatedAt
 *   }
 * }
 */
router.get('/:id', getDnaRecord);

export { router as dnaRouter };
