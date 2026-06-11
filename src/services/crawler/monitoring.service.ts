/**
 * PINIT-DNA — Monitoring Service
 *
 * Manages the monitoring queue.
 * For each monitored file:
 *   1. Crawl registered URLs + auto-generated search URLs
 *   2. Extract text from crawled pages
 *   3. Compare against FAISS index (similarity search)
 *   4. Store results + generate alerts for matches
 */

import { prisma }      from '../../lib/prisma';
import { logger }      from '../../lib/logger';
import { webCrawler }  from './web-crawler.service';
import { aiService }   from '../ai/ai-embeddings.service';
import { imageMonitoringService } from './image-monitoring.service';
import type { ImageMonitoringSummary } from './image-monitoring.service';

export interface MonitoringSummary {
  monitorRecordId: string;
  filename:        string;
  urlsChecked:     number;
  matchesFound:    number;
  highestSimilarity: number;
  alerts:          AlertItem[];
}

export interface AlertItem {
  url:        string;
  pageTitle:  string;
  similarity: number;
  matchType:  string;
  text:       string;
}

export class MonitoringService {

  // ─── Register a file for monitoring ──────────────────────────────────────

  async enroll(dnaRecordId: string, watchUrls: string[] = []): Promise<string> {
    const record = await prisma.dnaRecord.findUnique({
      where: { id: dnaRecordId },
      select: { imageFilename: true, fileType: true },
    });
    if (!record) throw new Error(`DNA record not found: ${dnaRecordId}`);

    // Check if already enrolled
    const existing = await prisma.monitorRecord.findFirst({
      where: { dnaRecordId, status: { not: 'STOPPED' } },
    });
    if (existing) return existing.id;

    const monitor = await prisma.monitorRecord.create({
      data: {
        dnaRecordId,
        filename:     record.imageFilename,
        fileType:     record.fileType ?? 'UNKNOWN',
        status:       'ACTIVE',
        checkEveryHrs: 24,
        nextCheckAt:  new Date(Date.now() + 60_000), // first check in 1 minute
        watchUrls,
      },
    });

    logger.info('File enrolled for monitoring', { filename: record.imageFilename, id: monitor.id });
    return monitor.id;
  }

  // ─── Run monitoring check for one record ─────────────────────────────────

  async runCheck(monitorRecordId: string): Promise<MonitoringSummary | ImageMonitoringSummary> {
    const monitor = await prisma.monitorRecord.findUnique({
      where: { id: monitorRecordId },
      include: { dnaRecord: { include: { ocrRecord: true } } },
    });

    if (!monitor) throw new Error(`Monitor record not found: ${monitorRecordId}`);

    const filename = monitor.filename;

    // ── Route image files to the dedicated image monitoring pipeline ──────────
    if (imageMonitoringService.isImage(monitor.fileType, monitor.dnaRecord.imageMimeType)) {
      logger.info('[Monitor] Routing to IMAGE monitoring pipeline', { filename, fileType: monitor.fileType });
      return imageMonitoringService.runCheck(monitorRecordId);
    }

    logger.info('[Monitor] Routing to TEXT monitoring pipeline', { filename, fileType: monitor.fileType });
    logger.info('Running monitoring check', { filename, id: monitorRecordId });

    // Get OCR text for keyword generation
    const ocrText = monitor.dnaRecord.ocrRecord?.extractedText ?? '';
    const keywords = this.extractKeywords(ocrText, filename);

    // Build URLs to check
    const urlsToCheck: string[] = [
      ...monitor.watchUrls,
      ...webCrawler.generateSearchUrls(filename, keywords),
    ];

    const alerts: AlertItem[] = [];
    let highestSimilarity = 0;

    // Crawl each URL
    const crawlResults = await webCrawler.crawlUrls(urlsToCheck);

    for (const result of crawlResults) {
      if (!result.text || result.wordCount < 10) continue;

      // Compare crawled text against FAISS index
      let similarity = 0;
      let matchType  = 'NO_MATCH';

      try {
        const searchResults = await aiService.search(result.text.slice(0, 500), 3, 0.40);
        const topMatch = searchResults.results?.find(
          (r: { dnaRecordId: string; similarity: number }) => r.dnaRecordId === monitor.dnaRecordId
        );

        if (topMatch) {
          similarity = topMatch.similarity;
          if      (similarity >= 0.92) matchType = 'DUPLICATE';
          else if (similarity >= 0.75) matchType = 'NEAR_MATCH';
          else if (similarity >= 0.50) matchType = 'POSSIBLE';
          else                          matchType = 'NO_MATCH';
        }
      } catch { /* AI offline — skip similarity */ }

      // Also do simple keyword matching
      if (matchType === 'NO_MATCH' && ocrText.length > 50) {
        const kws = keywords.slice(0, 5);
        const hits = kws.filter(k => result.text.toLowerCase().includes(k.toLowerCase())).length;
        if (hits >= 3) {
          similarity = Math.max(similarity, 0.55 + (hits / kws.length) * 0.15);
          matchType  = 'POSSIBLE';
        }
      }

      if (similarity > highestSimilarity) highestSimilarity = similarity;

      // Save crawl result
      await prisma.crawlResult.create({
        data: {
          monitorRecordId,
          url:         result.url,
          pageTitle:   result.title.slice(0, 200),
          foundText:   result.text.slice(0, 2000),
          textLength:  result.wordCount,
          similarity,
          matchType,
          alertStatus: matchType !== 'NO_MATCH' ? 'PENDING' : 'DISMISSED',
        },
      });

      if (matchType !== 'NO_MATCH') {
        alerts.push({
          url:        result.url,
          pageTitle:  result.title,
          similarity: Math.round(similarity * 100),
          matchType,
          text:       result.text.slice(0, 300),
        });
      }
    }

    // Update monitor record
    const nextCheck = new Date(Date.now() + monitor.checkEveryHrs * 3600_000);
    await prisma.monitorRecord.update({
      where: { id: monitorRecordId },
      data: {
        lastCheckedAt: new Date(),
        nextCheckAt:   nextCheck,
        totalChecks:   { increment: 1 },
        totalMatches:  { increment: alerts.length },
      },
    });

    logger.info('Monitoring check complete', {
      filename, urlsChecked: urlsToCheck.length,
      matchesFound: alerts.length, highestSimilarity,
    });

    return {
      monitorRecordId,
      filename,
      urlsChecked:       urlsToCheck.length,
      matchesFound:      alerts.length,
      highestSimilarity: Math.round(highestSimilarity * 100),
      alerts,
    };
  }

  // ─── Run all due checks ───────────────────────────────────────────────────

  async runDueChecks(): Promise<void> {
    const due = await prisma.monitorRecord.findMany({
      where: {
        status:     'ACTIVE',
        nextCheckAt: { lte: new Date() },
      },
      take: 10, // max 10 at a time
    });

    if (due.length === 0) return;

    logger.info(`Running ${due.length} due monitoring checks`);

    for (const m of due) {
      await this.runCheck(m.id).catch(err =>
        logger.warn('Monitor check failed', { id: m.id, error: String(err) })
      );
    }
  }

  // ─── List all monitors + recent alerts ───────────────────────────────────

  async listMonitors() {
    return prisma.monitorRecord.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        crawlResults: {
          where:   { matchType: { not: 'NO_MATCH' } },
          orderBy: { createdAt: 'desc' },
          take:    5,
        },
        _count: { select: { crawlResults: true } },
      },
    });
  }

  async getAlerts(status = 'PENDING') {
    return prisma.crawlResult.findMany({
      where:   { alertStatus: status, matchType: { not: 'NO_MATCH' } },
      orderBy: { similarity: 'desc' },
      include: {
        monitorRecord: { select: { filename: true, fileType: true, dnaRecordId: true } },
      },
      take: 50,
    });
  }

  async dismissAlert(crawlResultId: string): Promise<void> {
    await prisma.crawlResult.update({
      where: { id: crawlResultId },
      data:  { alertStatus: 'DISMISSED' },
    });
  }

  async confirmAlert(crawlResultId: string): Promise<void> {
    await prisma.crawlResult.update({
      where: { id: crawlResultId },
      data:  { alertStatus: 'CONFIRMED' },
    });
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  async getStats() {
    const [total, active, pending, confirmed] = await Promise.all([
      prisma.monitorRecord.count(),
      prisma.monitorRecord.count({ where: { status: 'ACTIVE' } }),
      prisma.crawlResult.count({ where: { alertStatus: 'PENDING', matchType: { not: 'NO_MATCH' } } }),
      prisma.crawlResult.count({ where: { alertStatus: 'CONFIRMED' } }),
    ]);

    return { totalMonitored: total, activeMonitors: active, pendingAlerts: pending, confirmedMatches: confirmed };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private extractKeywords(text: string, filename: string): string[] {
    const words = new Map<string, number>();

    // From OCR text
    const textWords = text.toLowerCase().match(/[a-z]{4,}/g) ?? [];
    for (const w of textWords) words.set(w, (words.get(w) ?? 0) + 1);

    // From filename
    const nameWords = filename.toLowerCase().replace(/\.[^.]+$/, '').split(/[_\-\s]/);
    for (const w of nameWords) if (w.length > 3) words.set(w, (words.get(w) ?? 0) + 5);

    // Stop words to exclude
    const stop = new Set(['that','this','with','from','have','been','they','their',
      'what','will','when','more','than','your','also','which','into','then','some']);

    return [...words.entries()]
      .filter(([w]) => !stop.has(w))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([w]) => w);
  }
}

export const monitoringService = new MonitoringService();
