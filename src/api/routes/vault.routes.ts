/**
 * PINIT-DNA — Vault Routes
 *
 * POST   /vault/store         — Encrypt + store image in vault
 * GET    /vault/:id           — Get vault record metadata
 * POST   /vault/:id/retrieve  — Decrypt + return original image
 */

import { Router } from 'express';
import { uploadSingle } from '../middleware/upload.middleware';
import { listVaultRecords, storeInVault, getVaultRecord, retrieveFromVault, scanVaultFile } from '../controllers/vault.controller';
import { vaultIntegrityCheck } from '../controllers/integrity.controller';

const router = Router();

/**
 * POST /vault/store
 * Body: multipart/form-data
 *   - image:        File   — the original image to encrypt
 *   - dnaRecordId:  string — the DNA record to link
 *
 * Response 201:
 * {
 *   success: true,
 *   vaultId: "uuid",
 *   dnaRecordId: "uuid",
 *   encryptionAlgorithm: "AES-256-GCM",
 *   encryptedSizeBytes: 562044,
 *   originalSizeBytes: 562016,
 *   storedAt: "ISO8601"
 * }
 */
router.get('/', listVaultRecords);
/** GET /vault/integrity-check — Phase 4.6: check all vault files exist on disk */
router.get('/integrity-check', vaultIntegrityCheck);
router.post('/store', uploadSingle, storeInVault);

/**
 * GET /vault/:id
 * Response 200: vault record metadata (no file content)
 */
router.get('/:id', getVaultRecord);

/**
 * POST /vault/:id/retrieve
 * Response 200: binary stream of the decrypted original image
 * Headers:
 *   Content-Type: image/jpeg (original MIME)
 *   Content-Disposition: attachment; filename="original.jpg"
 *   X-Vault-Id: uuid
 */
router.post('/:id/retrieve', retrieveFromVault);

/**
 * POST /vault/:id/scan-sensitive
 * Decrypts the vault file, extracts text, and returns which sensitive data
 * types were detected (email / phone / aadhaar / pan / address).
 * Does NOT mask anything — read-only scan for the share modal UI.
 */
router.post('/:id/scan-sensitive', scanVaultFile);

export { router as vaultRouter };
