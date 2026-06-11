/**
 * PINIT-DNA — Enhanced Audit Trail Service (Phase 5.5)
 *
 * Captures detailed forensic audit events per the requirement:
 *   - File open, scroll depth, download, share events
 *   - Device fingerprint, IP address, browser, OS details
 *   - Session duration, screen capture attempts, idle periods
 *
 * Stored in AuditEvent table in PostgreSQL.
 * Zero dependency on ELK — Winston + DB is sufficient for current phase.
 */

import { Request } from 'express';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { resolveClientIp } from '../../lib/request-utils';

export type AuditEventType =
  | 'DNA_GENERATED'
  | 'DNA_VERIFIED'
  | 'DNA_COMPARED'
  | 'VAULT_STORED'
  | 'VAULT_RETRIEVED'
  | 'VAULT_INTEGRITY_CHECK'
  | 'CERTIFICATE_ISSUED'
  | 'CERTIFICATE_REVOKED'
  | 'CERTIFICATE_VERIFIED'
  | 'OCR_EXTRACTED'
  | 'SEMANTIC_SEARCH'
  | 'LINEAGE_RECORDED'
  | 'FILE_VIEWED'
  | 'FILE_DOWNLOADED'
  | 'FILE_SHARED'
  | 'SCREEN_CAPTURE_ATTEMPTED'
  | 'INTEGRITY_CHECK_RUN'
  | 'VAULT_BACKUP_RUN'
  | 'DUPLICATE_UPLOAD_ATTEMPT'
  | 'MASKING_ENABLED'
  | 'UNMASK_REQUESTED'
  | 'UNMASK_APPROVED'
  | 'UNMASK_REJECTED'
  | 'UNMASK_VIEWED';

export interface AuditEventData {
  eventType:    AuditEventType;
  dnaRecordId?: string;
  vaultId?:     string;
  filename?:    string;
  fileType?:    string;
  detail?:      Record<string, unknown>;
  req?:         Request;
}

export class AuditService {
  /**
   * Log a forensic audit event with full device + IP context.
   */
  async log(data: AuditEventData): Promise<void> {
    try {
      const deviceInfo = this.extractDeviceInfo(data.req);

      await prisma.auditEvent.create({
        data: {
          eventType:   data.eventType,
          dnaRecordId: data.dnaRecordId ?? null,
          vaultId:     data.vaultId    ?? null,
          filename:    data.filename   ?? null,
          fileType:    data.fileType   ?? null,
          ipAddress:   deviceInfo.ip,
          userAgent:   deviceInfo.userAgent,
          browser:     deviceInfo.browser,
          os:          deviceInfo.os,
          device:      deviceInfo.device,
          detail:      data.detail ? (data.detail as object) : undefined,
        },
      });

      logger.debug('Audit event logged', {
        eventType: data.eventType,
        dnaRecordId: data.dnaRecordId?.slice(0, 8),
        ip: deviceInfo.ip,
      });
    } catch (err) {
      // Non-fatal — never block the main flow for audit logging
      logger.warn('Audit log failed (non-fatal)', { error: String(err) });
    }
  }

  /**
   * Extract IP, browser, OS, and device info from Express request.
   */
  private extractDeviceInfo(req?: Request) {
    if (!req) return { ip: null, userAgent: null, browser: null, os: null, device: null };

    const ua        = req.headers['user-agent'] ?? '';
    const ip = resolveClientIp(req);

    // Simple UA parsing (no external library needed)
    const browser   = this.parseBrowser(ua);
    const os        = this.parseOs(ua);
    const device    = this.parseDevice(ua);

    return { ip, userAgent: ua || null, browser, os, device };
  }

  private parseBrowser(ua: string): string | null {
    if (ua.includes('Chrome') && !ua.includes('Edg'))  return 'Chrome';
    if (ua.includes('Firefox'))   return 'Firefox';
    if (ua.includes('Safari') && !ua.includes('Chrome')) return 'Safari';
    if (ua.includes('Edg'))       return 'Edge';
    if (ua.includes('OPR'))       return 'Opera';
    if (ua.includes('Brave'))     return 'Brave';
    return ua ? 'Unknown' : null;
  }

  private parseOs(ua: string): string | null {
    if (ua.includes('Windows NT 10')) return 'Windows 10';
    if (ua.includes('Windows NT 11')) return 'Windows 11';
    if (ua.includes('Windows'))  return 'Windows';
    if (ua.includes('Mac OS X')) return 'macOS';
    if (ua.includes('Linux'))    return 'Linux';
    if (ua.includes('Android'))  return 'Android';
    if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
    return null;
  }

  private parseDevice(ua: string): string | null {
    if (ua.includes('Mobile') || ua.includes('iPhone')) return 'Mobile';
    if (ua.includes('iPad') || ua.includes('Tablet'))   return 'Tablet';
    return 'Desktop';
  }

  /**
   * Get audit events for a specific DNA record.
   */
  async getEventsForRecord(dnaRecordId: string) {
    return prisma.auditEvent.findMany({
      where:   { dnaRecordId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /**
   * Get recent audit events across the system.
   */
  async getRecentEvents(limit = 50) {
    return prisma.auditEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Export audit log as CSV string.
   */
  async exportCsv(params?: { from?: string; to?: string; eventType?: string }): Promise<string> {
    const where: Record<string, unknown> = {};
    if (params?.from || params?.to) {
      where['createdAt'] = {};
      if (params.from) (where['createdAt'] as Record<string, unknown>)['gte'] = new Date(params.from);
      if (params.to)   (where['createdAt'] as Record<string, unknown>)['lte'] = new Date(params.to);
    }
    if (params?.eventType) where['eventType'] = params.eventType;

    const events = await prisma.auditEvent.findMany({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      where: where as any,
      orderBy: { createdAt: 'desc' },
      take: 10000,
    });

    const headers = ['id','eventType','userId','dnaRecordId','vaultId','filename','fileType','ipAddress','browser','os','device','createdAt'];
    const rows = events.map(e => [
      e.id, e.eventType, e.userId ?? '', e.dnaRecordId ?? '',
      e.vaultId ?? '', e.filename ?? '', e.fileType ?? '',
      e.ipAddress ?? '', e.browser ?? '', e.os ?? '', e.device ?? '',
      e.createdAt.toISOString(),
    ].map(v => `"${String(v).replace(/"/g, '""')}"`));

    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }

  /**
   * Get audit statistics.
   */
  async getStats() {
    const [total, byType] = await Promise.all([
      prisma.auditEvent.count(),
      prisma.auditEvent.groupBy({
        by:      ['eventType'],
        _count:  { eventType: true },
        orderBy: { _count: { eventType: 'desc' } },
      }),
    ]);

    return {
      total,
      byEventType: byType.map(t => ({ eventType: t.eventType, count: t._count.eventType })),
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────
export const auditService = new AuditService();
