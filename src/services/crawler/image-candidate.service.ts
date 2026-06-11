/**
 * PINIT-DNA — Image Candidate Service
 *
 * Downloads candidate images from URLs discovered by search providers.
 * Validates MIME type and size before processing.
 * Computes pHash (pHash64, aHash64, dHash64) for comparison.
 *
 * pHash algorithm mirrors layer3.perceptual.ts exactly —
 * same DCT logic, same hash format, same bit ordering.
 */

import axios    from 'axios';
import sharp    from 'sharp';
import { logger } from '../../lib/logger';

export type DownloadStatus = 'SUCCESS' | 'FAILED' | 'INVALID_MIME' | 'TOO_LARGE' | 'TIMEOUT';

export interface CandidateImage {
  url:            string;
  pageUrl:        string;
  source:         string;
  downloadStatus: DownloadStatus;
  error?:         string;

  // Set only when downloadStatus === 'SUCCESS'
  mimeType:   string;
  sizeBytes:  number;
  pHash64:    string;
  aHash64:    string;
  dHash64:    string;
}

const VALID_MIMES   = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp']);
const MAX_SIZE      = 15 * 1024 * 1024; // 15 MB
const DL_TIMEOUT    = 12_000;
const USER_AGENT    = 'PINIT-DNA/2.0 (+https://pinit-dna.com; image-fingerprint-verifier)';

export class ImageCandidateService {

  // ─── Download + fingerprint ───────────────────────────────────────────────

  async download(imageUrl: string, pageUrl: string, source: string): Promise<CandidateImage> {
    const base = { url: imageUrl, pageUrl, source, mimeType: '', sizeBytes: 0,
                   pHash64: '', aHash64: '', dHash64: '' };
    try {
      const resp = await axios.get<ArrayBuffer>(imageUrl, {
        responseType: 'arraybuffer',
        timeout:      DL_TIMEOUT,
        headers: {
          'User-Agent': USER_AGENT,
          'Accept':     'image/*,*/*',
        },
      });

      const mimeType = (resp.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      const buffer   = Buffer.from(resp.data);

      if (!VALID_MIMES.has(mimeType) && !this.isImageByBytes(buffer)) {
        return { ...base, mimeType, downloadStatus: 'INVALID_MIME',
                 error: `Not an image: ${mimeType}` };
      }

      if (buffer.length > MAX_SIZE) {
        return { ...base, mimeType, sizeBytes: buffer.length,
                 downloadStatus: 'TOO_LARGE', error: `${buffer.length} bytes > ${MAX_SIZE}` };
      }

      const [pHash64, aHash64, dHash64] = await Promise.all([
        this.computePHash64(buffer),
        this.computeAHash64(buffer),
        this.computeDHash64(buffer),
      ]);

      return { ...base, mimeType, sizeBytes: buffer.length,
               pHash64, aHash64, dHash64, downloadStatus: 'SUCCESS' };

    } catch (err) {
      const msg = String(err instanceof Error ? err.message : err);
      const status: DownloadStatus =
        msg.includes('timeout') || msg.includes('ETIMEDOUT') ? 'TIMEOUT' :
        msg.includes('too large') || msg.includes('maxContentLength') ? 'TOO_LARGE' :
        'FAILED';
      return { ...base, downloadStatus: status, error: msg.slice(0, 300) };
    }
  }

  // ─── Hamming distance + similarity ───────────────────────────────────────

  hammingDistance(a: string, b: string): number {
    if (!a || !b || a.length !== b.length) return 64;
    let dist = 0;
    for (let i = 0; i < a.length; i++) {
      const xor = parseInt(a[i], 16) ^ parseInt(b[i], 16);
      dist += this.popcount4(xor);
    }
    return dist;
  }

  pHashSimilarity(a: string, b: string, totalBits = 64): number {
    if (!a || !b) return 0;
    const dist = this.hammingDistance(a, b);
    return Math.max(0, 1 - dist / totalBits);
  }

  /**
   * Combined pHash similarity — mirrors PerceptualLayer.verify() weighting:
   *   pHash64  60% (DCT-based, most discriminative)
   *   aHash64  20% (average hash, fast pre-filter)
   *   dHash64  20% (difference hash, brightness-robust)
   */
  combinedPHashSimilarity(
    probe:  { pHash64: string; aHash64: string; dHash64: string },
    stored: { pHash64: string; aHash64: string; dHash64: string }
  ): number {
    const p = this.pHashSimilarity(probe.pHash64, stored.pHash64, 64);
    const a = this.pHashSimilarity(probe.aHash64, stored.aHash64, 64);
    const d = this.pHashSimilarity(probe.dHash64, stored.dHash64, 64);
    return p * 0.6 + a * 0.2 + d * 0.2;
  }

  // ─── pHash algorithms (identical to layer3.perceptual.ts) ────────────────

  private async computePHash64(buffer: Buffer): Promise<string> {
    try {
      const SIZE = 32, HASH_SIZE = 8;
      const pixels = await this.toGrayscale(buffer, SIZE, SIZE);
      const dct    = this.dct2d(pixels, SIZE);
      const block: number[] = [];
      for (let y = 0; y < HASH_SIZE; y++)
        for (let x = 0; x < HASH_SIZE; x++)
          block.push(dct[y * SIZE + x]);
      const mean = block.slice(1).reduce((s, v) => s + v, 0) / (block.length - 1);
      return this.bitsToHex(block.map(v => v > mean ? 1 : 0));
    } catch (err) {
      logger.debug('[Candidate] pHash64 failed', { error: String(err).slice(0, 100) });
      return '';
    }
  }

  private async computeAHash64(buffer: Buffer): Promise<string> {
    try {
      const pixels = await this.toGrayscale(buffer, 8, 8);
      const mean   = pixels.reduce((s, v) => s + v, 0) / pixels.length;
      return this.bitsToHex(pixels.map(p => p > mean ? 1 : 0));
    } catch { return ''; }
  }

  private async computeDHash64(buffer: Buffer): Promise<string> {
    try {
      const pixels = await this.toGrayscale(buffer, 9, 8);
      const bits: number[] = [];
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++)
          bits.push(pixels[y * 9 + x] > pixels[y * 9 + x + 1] ? 1 : 0);
      return this.bitsToHex(bits);
    } catch { return ''; }
  }

  private async toGrayscale(buffer: Buffer, w: number, h: number): Promise<number[]> {
    const raw = await sharp(buffer)
      .resize(w, h, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer();
    return Array.from(raw);
  }

  private dct2d(pixels: number[], size: number): number[] {
    const rowDct = new Float64Array(size * size);
    for (let y = 0; y < size; y++) {
      const row = Array.from({ length: size }, (_, x) => pixels[y * size + x]);
      const d   = this.dct1d(row);
      for (let x = 0; x < size; x++) rowDct[y * size + x] = d[x];
    }
    const result = new Float64Array(size * size);
    for (let x = 0; x < size; x++) {
      const col = Array.from({ length: size }, (_, y) => rowDct[y * size + x]);
      const d   = this.dct1d(col);
      for (let y = 0; y < size; y++) result[y * size + x] = d[y];
    }
    return Array.from(result);
  }

  private dct1d(signal: number[]): number[] {
    const N = signal.length;
    const r = new Float64Array(N);
    for (let k = 0; k < N; k++) {
      let sum = 0;
      for (let n = 0; n < N; n++)
        sum += signal[n] * Math.cos((Math.PI / N) * (n + 0.5) * k);
      r[k] = sum;
    }
    return Array.from(r);
  }

  private bitsToHex(bits: number[]): string {
    let hex = '';
    for (let i = 0; i < bits.length; i += 4) {
      const n = (bits[i] ?? 0) * 8 + (bits[i+1] ?? 0) * 4 +
                (bits[i+2] ?? 0) * 2 + (bits[i+3] ?? 0);
      hex += n.toString(16);
    }
    return hex;
  }

  private popcount4(n: number): number {
    return ((n >> 3) & 1) + ((n >> 2) & 1) + ((n >> 1) & 1) + (n & 1);
  }

  /** Detect image by magic bytes (fallback when Content-Type is wrong) */
  private isImageByBytes(buf: Buffer): boolean {
    if (buf.length < 4) return false;
    // JPEG: FF D8 FF
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true;
    // PNG: 89 50 4E 47
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true;
    // WebP: RIFF....WEBP
    if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return true;
    return false;
  }
}

export const imageCandidateService = new ImageCandidateService();
