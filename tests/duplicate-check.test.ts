/**
 * PINIT-DNA — Duplicate File Prevention Tests
 *
 * Test A: Same user uploads same file twice       → BLOCK (EXACT_HASH)
 * Test B: Different user uploads same file        → BLOCK + HIGH_RISK
 * Test C: Same file renamed                       → BLOCK (EXACT_HASH, hash unchanged)
 * Test D: Different file                          → ALLOW
 *
 * Run: npx jest duplicate-check.test --no-coverage
 */

import crypto from 'crypto';
import { duplicateCheckService } from '../src/services/duplicate/duplicate-check.service';
import { prisma } from '../src/lib/prisma';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create a minimal fake Express request */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeReq(ip = '127.0.0.1'): any {
  return {
    headers: { 'x-forwarded-for': ip, 'user-agent': 'jest-test/1.0' },
    ip,
    socket: { remoteAddress: ip },
  } as never;
}

/** Build a buffer with known content (deterministic sha256) */
function makeBuffer(content: string): Buffer {
  return Buffer.from(content, 'utf-8');
}

// ─── Mock prisma to avoid real DB calls ───────────────────────────────────────
// (integration tests can flip SKIP_MOCK=true to hit a real test DB)

// Mock prisma at module level so jest.mock is properly hoisted
jest.mock('../src/lib/prisma', () => ({
  prisma: {
    cryptoLayer:     { findFirst: jest.fn() },
    perceptualLayer: { findMany:  jest.fn() },
    dnaRecord:       { findFirst: jest.fn(), findUnique: jest.fn() },
    auditEvent:      { create: jest.fn(), findFirst: jest.fn() },
  },
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DuplicateCheckService', () => {

  const fileA = makeBuffer('This is the original file content — version A.');
  const fileB = makeBuffer('This is a COMPLETELY DIFFERENT file — version B!');
  const sha256A = crypto.createHash('sha256').update(fileA).digest('hex');

  const existingRecord = {
    id:            'existing-record-uuid-001',
    imageFilename: 'original-file.pdf',
    imageMimeType: 'application/pdf',
    createdAt:     new Date('2026-01-01T10:00:00Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: auditEvent.create always succeeds (fire-and-forget)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.auditEvent.create as jest.Mock).mockResolvedValue({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.auditEvent.findFirst as jest.Mock).mockResolvedValue(null);
    // Default: no exact match on dnaRecord (falls through to cryptoLayer fallback)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.dnaRecord.findFirst as jest.Mock).mockResolvedValue(null);
    // Default: no perceptual layer match
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.perceptualLayer.findMany as jest.Mock).mockResolvedValue([]);
  });

  // ── Test A: Same user uploads same file twice ──────────────────────────────

  test('Test A — same user uploads same file twice → BLOCK (EXACT_HASH)', async () => {
    // First upload is already in DB → cryptoLayer.findFirst returns a match
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.cryptoLayer.findFirst as jest.Mock).mockResolvedValue({
      sha256Hash: sha256A,
      dnaRecord:  existingRecord,
    });
    // Same IP as original uploader → LOW risk
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.auditEvent.findFirst as jest.Mock).mockResolvedValue({ ipAddress: '127.0.0.1' });

    const result = await duplicateCheckService.check(fileA, 'application/pdf', 'my-file.pdf', fakeReq('127.0.0.1'));

    expect(result.isDuplicate).toBe(true);
    expect(result.matchType).toBe('EXACT_HASH');
    expect(result.existingRecordId).toBe(existingRecord.id);
    expect(result.isHighRisk).toBe(false); // same IP = same user = LOW risk

    console.log('✅ Test A PASS — same user / same file blocked as EXACT_HASH, LOW risk');
  });

  // ── Test B: Different user uploads same file ───────────────────────────────

  test('Test B — different user uploads same file → BLOCK + HIGH RISK', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.cryptoLayer.findFirst as jest.Mock).mockResolvedValue({
      sha256Hash: sha256A,
      dnaRecord:  existingRecord,
    });
    // Original IP was 192.168.1.1, new uploader is from 203.0.113.55 → HIGH risk
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.auditEvent.findFirst as jest.Mock).mockResolvedValue({ ipAddress: '192.168.1.1' });

    const result = await duplicateCheckService.check(fileA, 'application/pdf', 'my-file.pdf', fakeReq('203.0.113.55'));

    expect(result.isDuplicate).toBe(true);
    expect(result.matchType).toBe('EXACT_HASH');
    expect(result.isHighRisk).toBe(true); // different IP = different user = HIGH risk

    console.log('✅ Test B PASS — different user / same file blocked as EXACT_HASH, HIGH risk');
  });

  // ── Test C: Same file renamed ──────────────────────────────────────────────
  // SHA-256 is computed from file CONTENT, not filename. A rename does not change
  // the hash. So a renamed file produces the same SHA-256 and is blocked.

  test('Test C — same file renamed → BLOCK (EXACT_HASH, hash unchanged by rename)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.cryptoLayer.findFirst as jest.Mock).mockResolvedValue({
      sha256Hash: sha256A,
      dnaRecord:  existingRecord,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.auditEvent.findFirst as jest.Mock).mockResolvedValue({ ipAddress: '127.0.0.1' });

    // Same bytes, different filename
    const result = await duplicateCheckService.check(fileA, 'application/pdf', 'totally-different-name.pdf', fakeReq('127.0.0.1'));

    expect(result.isDuplicate).toBe(true);
    expect(result.matchType).toBe('EXACT_HASH');
    // Verify hash is identical regardless of filename
    const hashOfRenamed = duplicateCheckService.computeSha256(fileA);
    expect(hashOfRenamed).toBe(sha256A);

    console.log('✅ Test C PASS — renamed file blocked (SHA-256 is content-based, not filename-based)');
  });

  // ── Test D: Different file ─────────────────────────────────────────────────

  test('Test D — different file → ALLOW', async () => {
    // No match in DB
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.cryptoLayer.findFirst as jest.Mock).mockResolvedValue(null);
    // No pHash matches
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.perceptualLayer.findMany as jest.Mock).mockResolvedValue([]);

    const result = await duplicateCheckService.check(fileB, 'application/pdf', 'different-file.pdf', fakeReq('127.0.0.1'));

    expect(result.isDuplicate).toBe(false);
    expect(result.matchType).toBeUndefined();

    console.log('✅ Test D PASS — unique file allowed through');
  });

  // ── SHA-256 determinism test ───────────────────────────────────────────────

  test('SHA-256 is deterministic — same content always produces same hash', () => {
    const h1 = duplicateCheckService.computeSha256(fileA);
    const h2 = duplicateCheckService.computeSha256(fileA);
    const h3 = duplicateCheckService.computeSha256(Buffer.from(fileA)); // copy

    expect(h1).toBe(h2);
    expect(h2).toBe(h3);
    expect(h1).toHaveLength(64); // SHA-256 hex = 64 chars

    console.log('✅ SHA-256 determinism PASS');
  });

  // ── fileA and fileB produce different hashes ───────────────────────────────

  test('Different files produce different SHA-256 hashes', () => {
    const hashA = duplicateCheckService.computeSha256(fileA);
    const hashB = duplicateCheckService.computeSha256(fileB);

    expect(hashA).not.toBe(hashB);

    console.log('✅ Hash uniqueness PASS — different files produce different hashes');
  });

});
