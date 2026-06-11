/**
 * PINIT-DNA — Central Configuration
 *
 * All environment variables are validated and typed here.
 * Import `config` throughout the app — never read process.env directly.
 */

import dotenv from 'dotenv';
import path from 'path';
import { ALL_ACCEPTED_MIME_TYPES, GLOBAL_MAX_FILE_SIZE_BYTES } from './supported-file-types';

dotenv.config();

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function optionalInt(key: string, fallback: number): number {
  const value = process.env[key];
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) throw new Error(`Env var ${key} must be an integer, got: ${value}`);
  return parsed;
}

export const config = {
  env: optional('NODE_ENV', 'development') as 'development' | 'production' | 'test',
  port: optionalInt('PORT', 4000),
  apiPrefix: optional('API_PREFIX', '/api/v1'),

  db: {
    url: required('DATABASE_URL'),
  },

  upload: {
    /**
     * Phase 0+: all supported MIME types are accepted at the upload boundary.
     * The UniversalFileRouter enforces which types have live engines.
     * Override via ALLOWED_FILE_TYPES env var (comma-separated) if needed.
     */
    allowedMimeTypes: process.env['ALLOWED_FILE_TYPES']
      ? process.env['ALLOWED_FILE_TYPES'].split(',')
      : ALL_ACCEPTED_MIME_TYPES,
    /**
     * Global ceiling — the largest single-type max (500 MB for ZIP/VIDEO).
     * Per-type ceilings are enforced by the router after detection.
     */
    maxFileSizeBytes: optionalInt('MAX_FILE_SIZE', GLOBAL_MAX_FILE_SIZE_BYTES),
    tempDir: path.resolve(optional('UPLOAD_TEMP_DIR', './tmp/uploads')),
  },

  dna: {
    schemaVersion: optional('DNA_SCHEMA_VERSION', '1.0.0'),
    /** Universal engine version — bumped each phase */
    engineVersion: optional('DNA_ENGINE_VERSION', '2.0.0-universal'),
  },

  stego: {
    signatureSecret: optional('LSB_SIGNATURE_SECRET', 'dev_secret_change_in_prod'),
  },

  vault: {
    // Master secret for HKDF key derivation — never stored derived keys
    masterSecret: optional('VAULT_MASTER_SECRET', 'dev_vault_secret_change_in_prod'),
    // Directory where AES-256-GCM encrypted vault files are stored
    storageDir: path.resolve(optional('VAULT_STORAGE_DIR', './vault/encrypted')),
  },

  rateLimit: {
    windowMs: optionalInt('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000), // 15 min
    max: optionalInt('RATE_LIMIT_MAX', 2000),
  },

  log: {
    level: optional('LOG_LEVEL', 'debug'),
  },
} as const;

export type Config = typeof config;
