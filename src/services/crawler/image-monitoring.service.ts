/**
 * PINIT-DNA — Image Monitoring Service
 *
 * True image-specific monitoring pipeline:
 *
 *   Image Upload
 *   → pHash stored in perceptual_layers (Layer 3)
 *   → Monitor enrolled
 *   → Check Now triggered
 *   → Candidate discovery (FilenameSearch + Bing if configured)
 *   → Each candidate downloaded and validated (MIME, size)
 *   → pHash computed for each candidate
 *   → Hamming distance compared with stored pHash
 *   → Combined similarity score calculated
 *   → Match persisted to crawl_results
 *   → Alert generated if similarity ≥ threshold
 *
 * Match thresholds:
 *   ≥ 0.95 → DUPLICATE   (exact copy, possibly re-compressed)
 *   ≥ 0.80 → NEAR_MATCH  (same image, resized/filtered)
 *   ≥ 0.65 → POSSIBLE    (visually similar content)
 *   < 0.65 → NO_MATCH    (rejected, logged with reason)
 */

import { prisma }               from '../../lib/prisma';
import { logger }               from '../../lib/logger';
import { imageCandidateService } from './image-candidate.service';
import { FilenameSearchProvider } from './providers/filename-search.provider';
import { BingVisualSearchProvider } from './providers/bing-visual-search.provider';
import type { ImageSearchResult }   from './providers/image-search.provider';

// Match thresholds
const THRESHOLD_DUPLICATE  = 0.95;
const THRESHOLD_NEAR_MATCH = 0.80;
const THRESHOLD_POSSIBLE   = 0.65;
const MAX_CANDIDATES       = 30;

export interface ImageMatchResult {
  imageUrl:        string;
  pageUrl:         string;
  source:          string;
  pHashSimilarity: number;   // 0-1
  pHashDistance:   number;   // Hamming distance (lower = more similar)
  matchType:       'DUPLICATE' | 'NEAR_MATCH' | 'POSSIBLE';
}

export interface ImageMonitoringSummary {
  monitorRecordId:      string;
  filename:             string;
  urlsChecked:          number;
  candidatesDownloaded: number;
  candidatesFailed:     number;
  matchesFound:         number;
  highestSimilarity:    number;   // 0-100
  storedPHash:          string;
  matches:              ImageMatchResult[];
  rejections:           RejectionLog[];
  method:               'PHASH_COMPARISON';
  error?:               string;
}

export interface RejectionLog {
  url:    string;
  reason: string;
  score:  number;
}

export class ImageMonitoringService {

  // Providers tried in order; first configured one wins (Bing preferred if key set)
  private readonly providers = [
    new BingVisualSearchProvider(),
    new FilenameSearchProvider(),
  ];

  /** Returns true if this record is an image file */
  isImage(fileType: string | null | undefined, mimeType?: string | null): boolean {
    if (fileType === 'IMAGE') return true;
    if (mimeType?.startsWith('image/')) return true;
    return false;
  }

  // ─── Main entry point ─────────────────────────────────────────────────────

  async runCheck(monitorRecordId: string): Promise<ImageMonitoringSummary> {
    const monitor = await prisma.monitorRecord.findUnique({
      where: { id: monitorRecordId },
      include: {
        dnaRecord: {
          include: {
            perceptualLayer: true,
            cryptoLayer:     true,
          },
        },
      },
    });

    if (!monitor) throw new Error(`Monitor record not found: ${monitorRecordId}`);

    const { filename } = monitor;
    const stored = monitor.dnaRecord.perceptualLayer;

    logger.info('[ImageMonitor] ─── Starting image monitoring check ───', {
      filename,
      monitorRecordId,
      hasPHash:   !!stored,
      pHash64:    stored?.pHash64 ?? 'MISSING',
      watchUrls:  monitor.watchUrls.length,
    });

    // Guard: cannot compare without stored pHash
    if (!stored?.pHash64) {
      logger.error('[ImageMonitor] STOP — No pHash in database', {
        filename,
        reason: 'perceptualLayer record missing or pHash64 is empty',
        action: 'Re-generate DNA for this file to populate perceptual_layers table',
      });
      await this.updateMonitorTimestamps(monitor);
      return this.emptyResult(monitorRecordId, filename,
        'No pHash stored — re-generate DNA to fix');
    }

    // ── Step 1: Discover candidate image URLs ──────────────────────────────

    const allCandidates: ImageSearchResult[] = [];

    // User-provided direct URLs take priority (always checked first)
    for (const url of monitor.watchUrls) {
      allCandidates.push({ imageUrl: url, pageUrl: url, source: 'DIRECT_URL' });
      logger.debug('[ImageMonitor] Direct URL enrolled', { url });
    }

    // Provider-based discovery
    for (const provider of this.providers) {
      if (!provider.isConfigured()) {
        logger.info(`[ImageMonitor] Provider "${provider.name}" not configured — skipping`);
        continue;
      }
      logger.info(`[ImageMonitor] Running provider: ${provider.name}`);
      const found = await provider.findCandidates(filename, stored.pHash64);
      logger.info(`[ImageMonitor] ${provider.name} discovered ${found.length} candidates`);
      allCandidates.push(...found);
      break; // Use first configured provider only (prevents rate-limit stacking)
    }

    // Deduplicate by imageUrl
    const seen = new Set<string>();
    const candidates = allCandidates.filter(c => {
      if (seen.has(c.imageUrl)) return false;
      seen.add(c.imageUrl);
      return true;
    }).slice(0, MAX_CANDIDATES);

    logger.info(`[ImageMonitor] Processing ${candidates.length} unique candidates`, { filename });

    // ── Step 2: Download + pHash compare each candidate ───────────────────

    const matches:    ImageMatchResult[] = [];
    const rejections: RejectionLog[]    = [];
    let urlsChecked       = 0;
    let downloaded        = 0;
    let failed            = 0;
    let highestSimilarity = 0;

    for (const candidate of candidates) {
      urlsChecked++;

      logger.debug(`[ImageMonitor] [${urlsChecked}/${candidates.length}] Downloading`, {
        url:    candidate.imageUrl.slice(0, 120),
        source: candidate.source,
      });

      const img = await imageCandidateService.download(
        candidate.imageUrl,
        candidate.pageUrl,
        candidate.source
      );

      // Track failures
      if (img.downloadStatus !== 'SUCCESS') {
        failed++;
        const reason = `Download ${img.downloadStatus}: ${img.error ?? 'unknown'}`;
        logger.debug('[ImageMonitor] REJECTED — download failed', {
          url: candidate.imageUrl.slice(0, 120),
          status: img.downloadStatus,
          error:  img.error,
        });
        rejections.push({ url: candidate.imageUrl, reason, score: 0 });

        await prisma.crawlResult.create({
          data: {
            monitorRecordId,
            url:         candidate.imageUrl.slice(0, 1000),
            pageTitle:   `DOWNLOAD_FAILED: ${img.downloadStatus}`,
            foundText:   img.error ?? '',
            textLength:  0,
            similarity:  0,
            matchType:   'NO_MATCH',
            alertStatus: 'DISMISSED',
          },
        });
        continue;
      }

      downloaded++;

      // ── pHash comparison ───────────────────────────────────────────────
      const pHashSim  = imageCandidateService.combinedPHashSimilarity(
        { pHash64: img.pHash64, aHash64: img.aHash64, dHash64: img.dHash64 },
        { pHash64: stored.pHash64, aHash64: stored.aHash64, dHash64: stored.dHash64 },
      );
      const pHashDist = imageCandidateService.hammingDistance(img.pHash64, stored.pHash64);

      if (pHashSim > highestSimilarity) highestSimilarity = pHashSim;

      // ── Determine match type ───────────────────────────────────────────
      let matchType: 'DUPLICATE' | 'NEAR_MATCH' | 'POSSIBLE' | 'NO_MATCH' = 'NO_MATCH';
      if      (pHashSim >= THRESHOLD_DUPLICATE)  matchType = 'DUPLICATE';
      else if (pHashSim >= THRESHOLD_NEAR_MATCH) matchType = 'NEAR_MATCH';
      else if (pHashSim >= THRESHOLD_POSSIBLE)   matchType = 'POSSIBLE';

      const isMatch = matchType !== 'NO_MATCH';

      // Structured log — one line per candidate with full decision trace
      logger.info('[ImageMonitor] Candidate scored', {
        url:            candidate.imageUrl.slice(0, 100),
        source:         candidate.source,
        candidatePHash: img.pHash64,
        storedPHash:    stored.pHash64,
        pHashDistance:  pHashDist,
        pHashSim:       `${(pHashSim * 100).toFixed(1)}%`,
        matchType,
        accepted:       isMatch,
        rejectionReason: isMatch
          ? null
          : `pHash similarity ${(pHashSim * 100).toFixed(1)}% < ${(THRESHOLD_POSSIBLE * 100).toFixed(0)}% minimum threshold`,
      });

      if (!isMatch) {
        rejections.push({
          url:    candidate.imageUrl,
          reason: `pHash ${(pHashSim * 100).toFixed(1)}% < 65% threshold (Hamming dist ${pHashDist})`,
          score:  pHashSim,
        });
      }

      // Persist result (all candidates — matches and rejections)
      await prisma.crawlResult.create({
        data: {
          monitorRecordId,
          url:       candidate.imageUrl.slice(0, 1000),
          pageTitle: [
            `[${matchType}]`,
            `pHash: ${(pHashSim * 100).toFixed(1)}%`,
            `Dist: ${pHashDist}`,
            `Source: ${candidate.source}`,
          ].join(' | '),
          foundText: JSON.stringify({
            candidatePHash:  img.pHash64,
            candidateAHash:  img.aHash64,
            candidateDHash:  img.dHash64,
            storedPHash:     stored.pHash64,
            storedAHash:     stored.aHash64,
            storedDHash:     stored.dHash64,
            pHashDistance:   pHashDist,
            pHashSimilarity: pHashSim,
            source:          candidate.source,
            pageUrl:         candidate.pageUrl,
            mimeType:        img.mimeType,
            sizeBytes:       img.sizeBytes,
          }),
          textLength:  0,
          similarity:  pHashSim,
          matchType,
          alertStatus: isMatch ? 'PENDING' : 'DISMISSED',
        },
      });

      if (isMatch && matchType !== 'NO_MATCH') {
        matches.push({
          imageUrl:        candidate.imageUrl,
          pageUrl:         candidate.pageUrl,
          source:          candidate.source,
          pHashSimilarity: pHashSim,
          pHashDistance:   pHashDist,
          matchType,
        });
      }
    }

    // ── Step 3: Update monitor record ─────────────────────────────────────
    await this.updateMonitorTimestamps(monitor, matches.length);

    const summary: ImageMonitoringSummary = {
      monitorRecordId,
      filename,
      urlsChecked,
      candidatesDownloaded: downloaded,
      candidatesFailed:     failed,
      matchesFound:         matches.length,
      highestSimilarity:    Math.round(highestSimilarity * 100),
      storedPHash:          stored.pHash64,
      matches,
      rejections,
      method: 'PHASH_COMPARISON',
    };

    logger.info('[ImageMonitor] ─── Check complete ───', {
      filename,
      urlsChecked,
      candidatesDownloaded: downloaded,
      candidatesFailed:     failed,
      matchesFound:         matches.length,
      highestSimilarity:    `${Math.round(highestSimilarity * 100)}%`,
      storedPHash:          stored.pHash64,
    });

    return summary;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async updateMonitorTimestamps(
    monitor: { id: string; checkEveryHrs: number },
    matchCount?: number,
  ): Promise<void> {
    if (matchCount === undefined) matchCount = 0;
    const nextCheck = new Date(Date.now() + monitor.checkEveryHrs * 3_600_000);
    await prisma.monitorRecord.update({
      where: { id: monitor.id },
      data: {
        lastCheckedAt: new Date(),
        nextCheckAt:   nextCheck,
        totalChecks:   { increment: 1 },
        totalMatches:  { increment: matchCount },
      },
    });
  }

  private emptyResult(
    monitorRecordId: string,
    filename: string,
    error: string,
  ): ImageMonitoringSummary {
    return {
      monitorRecordId,
      filename,
      urlsChecked:          0,
      candidatesDownloaded: 0,
      candidatesFailed:     0,
      matchesFound:         0,
      highestSimilarity:    0,
      storedPHash:          '',
      matches:              [],
      rejections:           [],
      method:               'PHASH_COMPARISON',
      error,
    };
  }
}

export const imageMonitoringService = new ImageMonitoringService();
