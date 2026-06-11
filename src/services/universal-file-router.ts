/**
 * PINIT-DNA — Universal File Router
 *
 * Single entry point for all DNA generation in the Universal engine.
 *
 * Flow:
 *   FileInput → detect file type → enforce engine gate → route to engine
 *               → return UniversalRouterResult
 *
 * Phase 0 : IMAGE  (existing DnaOrchestrator — unchanged)
 * Phase 1 : TXT, CSV, JSON
 * Phase 2+: PDF, DOCX, PPTX, ZIP, VIDEO, AUDIO (stubs ready)
 */

import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { config } from '../config';

import { FileTypeDetector, DetectionResult } from './file-type-detector';
import { DnaOrchestrator } from './dna.orchestrator';
import { TxtDnaEngine }  from './engines/txt/txt-dna-engine';
import { CsvDnaEngine }  from './engines/csv/csv-dna-engine';
import { JsonDnaEngine } from './engines/json/json-dna-engine';
import { PdfDnaEngine }   from './engines/pdf/pdf-dna-engine';
import { DocxDnaEngine }  from './engines/docx/docx-dna-engine';
import { PptxDnaEngine }  from './engines/pptx/pptx-dna-engine';
import { ZipDnaEngine }   from './engines/zip/zip-dna-engine';
import { VideoDnaEngine } from './engines/video/video-dna-engine';
import { AudioDnaEngine } from './engines/audio/audio-dna-engine';
import { ImageInput } from '../types/dna.types';
import { UniversalRouterResult } from '../types/universal-engine.types';

// ─── Universal input type ────────────────────────────────────────────────────

export interface FileInput {
  filePath: string;
  originalName: string;
  /** MIME type as declared by the browser / OS */
  declaredMimeType: string;
  sizeBytes: number;
  buffer: Buffer;
}

// ─── Engine version ───────────────────────────────────────────────────────────

export const UNIVERSAL_ENGINE_VERSION = '2.0.0-universal';

// ─── Router ───────────────────────────────────────────────────────────────────

export class UniversalFileRouter {
  private readonly detector    = new FileTypeDetector();
  private readonly imageEngine = new DnaOrchestrator();
  private readonly txtEngine   = new TxtDnaEngine();
  private readonly csvEngine   = new CsvDnaEngine();
  private readonly jsonEngine  = new JsonDnaEngine();
  private readonly pdfEngine   = new PdfDnaEngine();
  private readonly docxEngine  = new DocxDnaEngine();
  private readonly pptxEngine  = new PptxDnaEngine();
  private readonly zipEngine   = new ZipDnaEngine();
  private readonly videoEngine = new VideoDnaEngine();
  private readonly audioEngine = new AudioDnaEngine();

  async route(file: FileInput): Promise<UniversalRouterResult> {
    // ── Detect file type ──────────────────────────────────────────────────────
    const detection = await this.detector.detect(
      file.buffer, file.originalName, file.declaredMimeType
    );

    logger.info('Universal router: file type detected', {
      fileType: detection.fileType, mimeType: detection.mimeType,
      detectedBy: detection.detectedBy, confidence: detection.confidence,
      engineStatus: detection.config.engineStatus, file: file.originalName,
    });

    // ── Engine gate ───────────────────────────────────────────────────────────
    if (detection.config.engineStatus !== 'LIVE') {
      throw new Error(
        `DNA engine for "${detection.config.displayName}" is not yet available. ` +
        `Planned for Phase ${detection.config.plannedPhase}. ` +
        `Currently supported: IMAGE, TXT, CSV, JSON, PDF, DOCX, PPTX, ZIP, VIDEO, AUDIO.`
      );
    }

    // ── Route ─────────────────────────────────────────────────────────────────
    switch (detection.fileType) {
      case 'IMAGE':
        return this.routeImage(file, detection);

      case 'TXT':
        return this.routeText('TXT', file, detection,
          (id) => this.txtEngine.generate(file, id));

      case 'CSV':
        return this.routeText('CSV', file, detection,
          (id) => this.csvEngine.generate(file, id));

      case 'JSON':
        return this.routeText('JSON', file, detection,
          (id) => this.jsonEngine.generate(file, id));

      // ── Phase 2: Document engines ─────────────────────────────────────────
      case 'PDF':
        return this.routeText('PDF',  file, detection,
          (id) => this.pdfEngine.generate(file, id));
      case 'DOCX':
        return this.routeText('DOCX', file, detection,
          (id) => this.docxEngine.generate(file, id));
      case 'PPTX':
        return this.routeText('PPTX', file, detection,
          (id) => this.pptxEngine.generate(file, id));
      case 'ZIP':
        return this.routeText('ZIP',   file, detection, (id) => this.zipEngine.generate(file, id));
      case 'VIDEO':
        return this.routeText('VIDEO', file, detection, (id) => this.videoEngine.generate(file, id));
      case 'AUDIO':
        return this.routeText('AUDIO', file, detection, (id) => this.audioEngine.generate(file, id));

      default:
        throw new Error(`No DNA engine registered for file type: ${detection.fileType}`);
    }
  }

  // ─── IMAGE adapter ────────────────────────────────────────────────────────

  private async routeImage(
    file: FileInput,
    detection: DetectionResult
  ): Promise<UniversalRouterResult> {
    const imageInput: ImageInput = {
      filePath: file.filePath, originalName: file.originalName,
      mimeType: detection.mimeType, sizeBytes: file.sizeBytes, buffer: file.buffer,
    };

    const result = await this.imageEngine.generate(imageInput, {
      fileType: 'IMAGE', engineVersion: UNIVERSAL_ENGINE_VERSION,
    });

    const successful = Object.values(result.layers).filter(l => l.success).length;

    return {
      dnaRecordId:         result.dnaRecordId,
      schemaVersion:       result.schemaVersion,
      fileType:            'IMAGE',
      engineVersion:       UNIVERSAL_ENGINE_VERSION,
      detectedBy:          detection.detectedBy,
      detectionConfidence: detection.confidence,
      status:              result.status,
      totalProcessingMs:   result.totalProcessingMs,
      generatedAt:         result.generatedAt,
      layerSummary: { total: 6, successful, failed: 6 - successful },
    };
  }

  // ─── Universal text/data adapter ─────────────────────────────────────────

  /**
   * Generic adapter for all Phase 1+ text-based engines.
   * Creates the DnaRecord, runs the engine, returns a UniversalRouterResult.
   */
  private async routeText(
    fileType: string,
    file: FileInput,
    detection: DetectionResult,
    runEngine: (id: string) => Promise<{ layers: { success: boolean }[]; status: string; totalProcessingMs: number; generatedAt: Date }>
  ): Promise<UniversalRouterResult> {
    const dnaRecordId = uuidv4();
    const sha256Hash  = crypto.createHash('sha256').update(file.buffer).digest('hex');

    // Create PENDING record so the engine can update it
    await prisma.dnaRecord.create({
      data: {
        id: dnaRecordId,
        imageFilename:  file.originalName,
        imageMimeType:  detection.mimeType,
        imageSizeBytes: file.sizeBytes,
        schemaVersion:  config.dna.schemaVersion,
        status:         'PENDING',
        fileType,
        engineVersion:  UNIVERSAL_ENGINE_VERSION,
        sha256Hash,
      },
    });

    await prisma.dnaRecord.update({
      where: { id: dnaRecordId }, data: { status: 'PROCESSING' },
    });

    const result = await runEngine(dnaRecordId);
    const successful = result.layers.filter(l => l.success).length;

    return {
      dnaRecordId,
      schemaVersion:       config.dna.schemaVersion,
      fileType,
      engineVersion:       UNIVERSAL_ENGINE_VERSION,
      detectedBy:          detection.detectedBy,
      detectionConfidence: detection.confidence,
      status:              result.status as 'COMPLETE' | 'PARTIAL' | 'FAILED',
      totalProcessingMs:   result.totalProcessingMs,
      generatedAt:         result.generatedAt,
      layerSummary: { total: 6, successful, failed: 6 - successful },
    };
  }
}
