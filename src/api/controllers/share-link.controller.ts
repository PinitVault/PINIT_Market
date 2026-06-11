/**
 * PINIT-DNA — Smart Links Controller
 *
 * POST   /api/v1/share                    — Create share link
 * GET    /api/v1/share                    — List all share links
 * GET    /api/v1/share/:token             — Get link info (public, no auth)
 * GET    /api/v1/share/:token/logs        — Get full access logs
 * POST   /api/v1/share/:token/access      — Record access event (called by viewer page)
 * DELETE /api/v1/share/:token             — Revoke link
 * GET    /api/v1/share/vault/:vaultId     — Get links for a vault record
 * GET    /api/v1/share/timeline/:dnaId    — Get share events for timeline
 */

import { Request, Response, NextFunction } from 'express';
import { shareLinkService, geoFromIp } from '../../services/share/share-link.service';
import { VaultService }     from '../../services/vault/vault.service';
import { logger }           from '../../lib/logger';
import { prisma }           from '../../lib/prisma';
import { auditService }     from '../../services/audit/audit.service';
import { resolveClientIp, buildShareUrl, dumpIpHeaders, resolvePublicBaseUrl } from '../../lib/request-utils';
import {
  applyMasks,
  extractTextFromPdf,
  extractTextFromDocx,
  extractTextFromPlain,
  MaskingConfig,
} from '../../services/privacy/privacy-masking.service';

const vaultService = new VaultService();

// ── Create share link ─────────────────────────────────────────────────────────

export async function createShareLink(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const {
      vaultId, expiresIn, maxViews, allowDownload, requireName, note,
      oneTimeUse, maxDownloads, allowedCountries, allowedDeviceTypes, allowedIpPrefixes,
      requireOtp, recipientEmail,
      privacyMaskingEnabled, maskEmail, maskPhone, maskAadhaar, maskPan, maskAddress, maskCustomPatterns,
      requestLocation,
    } = req.body as {
      vaultId: string;
      expiresIn?: number | null;
      maxViews?: number | null;
      allowDownload?: boolean;
      requireName?: boolean;
      note?: string;
      oneTimeUse?: boolean;
      maxDownloads?: number | null;
      allowedCountries?: string[];
      allowedDeviceTypes?: string[];
      allowedIpPrefixes?: string[];
      requireOtp?: boolean;
      recipientEmail?: string;
      privacyMaskingEnabled?: boolean;
      maskEmail?: boolean;
      maskPhone?: boolean;
      maskAadhaar?: boolean;
      maskPan?: boolean;
      maskAddress?: boolean;
      maskCustomPatterns?: string[];
      requestLocation?: boolean;
    };

    if (!vaultId) { res.status(400).json({ success: false, error: 'vaultId is required' }); return; }

    const { devOtp, ...link } = await shareLinkService.create({
      vaultId, expiresIn, maxViews, allowDownload, requireName, note,
      oneTimeUse, maxDownloads, allowedCountries, allowedDeviceTypes, allowedIpPrefixes,
      requireOtp, recipientEmail,
      privacyMaskingEnabled, maskEmail, maskPhone, maskAadhaar, maskPan, maskAddress, maskCustomPatterns,
      requestLocation,
    });

    // Build the public share URL using resolvePublicBaseUrl priority chain:
    // PUBLIC_APP_URL env → NGROK_URL env → x-forwarded-host → req.host → localhost
    const shareUrl = buildShareUrl(req, link.token);
    logger.info('[SmartLink] Share URL generated', { shareUrl, token: link.token });

    res.status(201).json({
      success: true,
      shareUrl,
      token: link.token,
      link,
      // devOtp is only present when requireOtp+recipientEmail were set AND no
      // SMTP provider is configured — surfaced to the CREATOR so the demo
      // flow works end-to-end without email infrastructure.
      ...(devOtp ? { devOtp, devOtpNote: 'No SMTP configured — share this code with the recipient manually for the demo.' } : {}),
    });
  } catch (err) { next(err); }
}

// ── List all links ────────────────────────────────────────────────────────────

export async function listShareLinks(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const links = await shareLinkService.listAll();
    res.json({ success: true, count: links.length, links });
  } catch (err) { next(err); }
}

// ── Get link info (public — called by /s/:token page) ─────────────────────────

export async function getShareLinkInfo(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const info = await shareLinkService.getPublicInfo(req.params['token']!);
    if (!info) { res.status(404).json({ success: false, error: 'Link not found' }); return; }
    res.json({ success: true, link: info });
  } catch (err) { next(err); }
}

// ── Get logs for a token ──────────────────────────────────────────────────────

export async function getShareLinkLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const link = await shareLinkService.getWithLogs(req.params['token']!);
    if (!link) { res.status(404).json({ success: false, error: 'Link not found' }); return; }

    // [DEBUG] Stage-4: log IP values in the last 5 logs being returned
    const sample = link.accessLogs.slice(0, 5).map(l => ({ action: l.action, ipAddress: l.ipAddress ?? 'NULL', createdAt: l.createdAt }));
    logger.debug('[IP-AUDIT] Stage-4 getShareLinkLogs returning', { token: req.params['token'], sample });

    res.json({ success: true, link });
  } catch (err) { next(err); }
}

// ── Record access event ───────────────────────────────────────────────────────

export async function recordAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.params['token']!;
    const { action, recipientName, timezone, sessionId, screenResolution, deviceFingerprint,
            gpsLat, gpsLng, gpsAccuracy, gpsCity, gpsTimestamp, locationShared } =
      req.body as {
        action?: string; recipientName?: string; timezone?: string; sessionId?: string;
        scrollDepth?: string; screenResolution?: string; deviceFingerprint?: string;
        gpsLat?: number; gpsLng?: number; gpsAccuracy?: number;
        gpsCity?: string; gpsTimestamp?: string; locationShared?: boolean;
      };

    const link = await shareLinkService.getPublicInfo(token);
    if (!link) { res.status(404).json({ success: false, error: 'Link not found' }); return; }

    const realIp = resolveClientIp(req);
    logger.debug('[IP-AUDIT] Stage-2 recordAccess', { token, action, ...dumpIpHeaders(req) });

    // ── Security events (copy/screenshot/print/idle/active) must ALWAYS be
    //    logged — even if the link is already revoked/consumed/expired.
    //    A one-time-use link revokes after VIEWED, but the recipient is still
    //    on the page and may attempt to copy/screenshot — we MUST capture that.
    const SECURITY_EVENTS = new Set([
      'COPY_ATTEMPT', 'SCREENSHOT_ATTEMPT', 'PRINT_ATTEMPT',
      'TAB_SWITCH', 'SCROLL', 'IDLE', 'ACTIVE',
    ]);
    const isSecurityEvent = SECURITY_EVENTS.has(action ?? '');

    // Block access if expired, exhausted, or signature invalid (tampered token)
    // — BUT let security/behaviour events through regardless
    if (!link.isActive && !isSecurityEvent) {
      const blockAction = !link.signatureValid ? 'BLOCKED_TAMPERED'
        : link.isExpired ? 'BLOCKED_EXPIRED' : 'BLOCKED_MAX_VIEWS';
      await shareLinkService.recordAccess({
        shareLinkId: (await shareLinkService.getWithLogs(token))!.id,
        action: blockAction,
        ipAddress: realIp,
        userAgent: req.headers['user-agent'],
        referrer:  req.headers['referer'],
        timezone, sessionId, screenResolution, deviceFingerprint,
      });
      res.status(403).json({
        success: false,
        error: !link.signatureValid ? 'Link signature invalid — possible tampering detected'
          : link.isExpired ? 'Link has expired' : 'Maximum views reached',
        blocked: true,
      });
      return;
    }

    const fullLink = await shareLinkService.getWithLogs(token);
    if (!fullLink) { res.status(404).json({ success: false, error: 'Link not found' }); return; }

    // ── Identity verification gate: OTP must be verified before any tracked
    //    access (other than the OTP verification call itself) is recorded.
    //    Security events are allowed through — if someone is on the viewer page
    //    they got past the gate already; don't block forensic events.
    if (link.requireOtp && !link.otpVerified && !isSecurityEvent) {
      res.status(403).json({ success: false, error: 'OTP verification required', blocked: true, requiresOtp: true });
      return;
    }

    // ── Policy enforcement: device / geo / IP allow-lists ─────────────────
    // Resolve geo + device for policy check (best-effort; cheap repeat call,
    // recordAccess will geolocate again for the persisted log — acceptable
    // duplication for correctness given ip-api.com has no auth/cost).
    const ua = req.headers['user-agent'] as string ?? '';
    const deviceGuess = /Mobi|Android/.test(ua) ? 'mobile' : /Tablet|iPad/.test(ua) ? 'tablet' : 'desktop';
    let geoCountry: string | null = null;
    if (fullLink.allowedCountries?.length && realIp) {
      const geo = await geoFromIp(realIp);
      geoCountry = geo.country ?? null;
    }
    const policyCheck = shareLinkService.checkPolicy(fullLink, {
      country: geoCountry, device: deviceGuess, ipAddress: realIp,
    });
    if (!policyCheck.allowed && !isSecurityEvent) {
      await shareLinkService.recordAccess({
        shareLinkId: fullLink.id,
        action: 'BLOCKED_POLICY',
        ipAddress: realIp,
        userAgent: ua,
        referrer:  req.headers['referer'],
        timezone, sessionId, screenResolution, deviceFingerprint,
      });
      res.status(403).json({ success: false, error: policyCheck.message, blocked: true, reason: policyCheck.reason });
      return;
    }

    await shareLinkService.recordAccess({
      shareLinkId:  fullLink.id,
      action:       action ?? 'VIEWED',
      recipientName,
      ipAddress:    realIp,
      userAgent:    req.headers['user-agent'],
      referrer:     req.headers['referer'],
      timezone, sessionId, screenResolution, deviceFingerprint,
      // GPS — only stored when user consented
      gpsLat:        gpsLat        ?? undefined,
      gpsLng:        gpsLng        ?? undefined,
      gpsAccuracy:   gpsAccuracy   ?? undefined,
      gpsCity:       gpsCity       ?? undefined,
      gpsTimestamp:  gpsTimestamp  ? new Date(gpsTimestamp) : undefined,
      locationShared: locationShared ?? false,
    });

    logger.info('[SmartLink] Access recorded', { token, action, ip: realIp, locationShared: locationShared ?? false });
    res.json({ success: true, link });
  } catch (err) { next(err); }
}

// ── Verify OTP code entered by recipient ──────────────────────────────────────

export async function verifyShareOtp(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.params['token']!;
    const { otp } = req.body as { otp?: string };
    if (!otp) { res.status(400).json({ success: false, error: 'OTP code is required' }); return; }

    const result = await shareLinkService.verifyOtp(token, otp);
    if (!result.ok) { res.status(400).json({ success: false, error: result.message }); return; }
    res.json({ success: true, message: result.message });
  } catch (err) { next(err); }
}

// ── Geo analytics aggregation ──────────────────────────────────────────────────

export async function getGeoAnalytics(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dnaRecordId = req.query['dnaRecordId'] as string | undefined;
    const analytics = await shareLinkService.getGeoAnalytics(dnaRecordId);
    res.json({ success: true, analytics });
  } catch (err) { next(err); }
}

// ── CSV audit export ────────────────────────────────────────────────────────────

export async function exportShareLogsCsv(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.params['token']!;
    const csv = await shareLinkService.exportAccessLogsCsv(token);
    if (csv === null) { res.status(404).json({ success: false, error: 'Link not found' }); return; }

    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="share-audit-${token}.csv"`,
    });
    res.send(csv);
  } catch (err) { next(err); }
}

// ── Live / concurrent session monitoring ───────────────────────────────────────

export async function getLiveSessions(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await shareLinkService.getLiveSessions();
    res.json({ success: true, ...data });
  } catch (err) { next(err); }
}

// ── Force logout (= revoke link → next request from any session is blocked) ────

export async function forceLogoutLink(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const link = await shareLinkService.revoke(req.params['token']!);
    logger.info('[SmartLink] Force logout — link revoked', { token: link.token });
    res.json({ success: true, message: 'All active sessions for this link have been terminated', token: link.token });
  } catch (err) { next(err); }
}

// ── Serve the actual file via share link ──────────────────────────────────────
// ALL restrictions enforced here — this is the single file-serving gate.

export async function serveSharedFile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.params['token']!;
    const info  = await shareLinkService.getPublicInfo(token);

    if (!info || !info.isActive) {
      res.status(403).json({ success: false, error: 'Link is inactive, expired, or exhausted' });
      return;
    }

    // OTP gate — file must not be served until the recipient verifies their code
    if (info.requireOtp && !info.otpVerified) {
      res.status(403).json({ success: false, error: 'OTP verification required', requiresOtp: true });
      return;
    }

    const fullLink = await shareLinkService.getWithLogs(token);
    if (!fullLink) { res.status(404).json({ success: false, error: 'Link not found' }); return; }

    // ── Policy enforcement: device / geo / IP allow-lists ─────────────────────
    const realIp = resolveClientIp(req);
    logger.debug('[IP-AUDIT] Stage-2 serveSharedFile', { token, ...dumpIpHeaders(req) });

    const ua = req.headers['user-agent'] as string ?? '';
    const deviceGuess = /Mobi|Android/.test(ua) ? 'mobile' : /Tablet|iPad/.test(ua) ? 'tablet' : 'desktop';
    let geoCountry: string | null = null;
    if (fullLink.allowedCountries?.length && realIp) {
      const geo = await geoFromIp(realIp);
      geoCountry = geo.country ?? null;
    }
    const policyCheck = shareLinkService.checkPolicy(fullLink, { country: geoCountry, device: deviceGuess, ipAddress: realIp });
    if (!policyCheck.allowed) {
      res.status(403).json({ success: false, error: policyCheck.message, blocked: true });
      return;
    }

    // ── Signature / tamper check ──────────────────────────────────────────────
    if (!info.signatureValid) {
      res.status(403).json({ success: false, error: 'Link signature invalid — possible tampering detected' });
      return;
    }

    // ── maxDownloads enforcement ───────────────────────────────────────────────
    if (fullLink.maxDownloads != null && fullLink.downloadCount >= fullLink.maxDownloads) {
      res.status(403).json({ success: false, error: 'Maximum downloads reached for this link', blocked: true });
      return;
    }

    // Log the view
    await shareLinkService.recordAccess({
      shareLinkId: fullLink.id,
      action:      'VIEWED',
      ipAddress:   realIp,
      userAgent:   req.headers['user-agent'],
      referrer:    req.headers['referer'],
    });

    // Retrieve decrypted file from vault and stream it
    const result = await vaultService.retrieve(fullLink.vaultId);

    // ── Content-Disposition: inline (view in browser) vs attachment (force download)
    // When allowDownload=false, serve inline only — no download header.
    // When allowDownload=true, serve as attachment so browser triggers save dialog.
    const disposition = fullLink.allowDownload
      ? `attachment; filename="${fullLink.filename}"`
      : `inline; filename="${fullLink.filename}"`;

    res.set({
      'Content-Type':        fullLink.mimeType,
      'Content-Disposition': disposition,
      'X-Share-Token':       token,
      'Cache-Control':       'no-store',
      // Prevent browser from caching — ensures policy checks run every time
      'Pragma':              'no-cache',
      'Expires':             '0',
    });
    res.send(result.originalBuffer);
  } catch (err) { next(err); }
}

// ── Get links for a vault ─────────────────────────────────────────────────────

export async function getVaultShareLinks(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const links = await shareLinkService.listByVault(req.params['vaultId']!);
    res.json({ success: true, count: links.length, links });
  } catch (err) { next(err); }
}

// ── Get timeline events for a DNA record ──────────────────────────────────────

export async function getShareTimeline(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const events = await shareLinkService.getTimelineEvents(req.params['dnaId']!);
    res.json({ success: true, events });
  } catch (err) { next(err); }
}

// ── Revoke ─────────────────────────────────────────────────────────────────────

export async function revokeShareLink(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const link = await shareLinkService.revoke(req.params['token']!);
    res.json({ success: true, message: 'Share link revoked', token: link.token });
  } catch (err) { next(err); }
}

// ── Debug / Test Report ───────────────────────────────────────────────────────
// GET /share/debug/report
// Returns a full diagnostic: public URL, IP headers, last DB value.

export async function debugReport(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const publicBase  = resolvePublicBaseUrl(req);
    const sampleToken = 'EXAMPLE_TOKEN';
    const sampleUrl   = `${publicBase}/s/${sampleToken}`;
    const ipHeaders   = dumpIpHeaders(req);

    // Fetch last 3 access log IPs from DB for comparison
    const lastLogs = await prisma.shareAccessLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { ipAddress: true, action: true, createdAt: true, shareLink: { select: { token: true } } },
    });

    res.json({
      success: true,
      report: {
        publicDomain:  publicBase,
        sampleShareUrl: sampleUrl,
        envVars: {
          PUBLIC_APP_URL: process.env['PUBLIC_APP_URL'] ?? 'NOT SET',
          NGROK_URL:      process.env['NGROK_URL']      ?? 'NOT SET',
          FRONTEND_URL:   process.env['FRONTEND_URL']   ?? 'NOT SET (removed)',
        },
        ipHeaders,
        lastStoredIps: lastLogs.map(l => ({
          action:    l.action,
          ipAddress: l.ipAddress ?? 'NULL in DB',
          token:     l.shareLink.token,
          at:        l.createdAt,
        })),
      },
    });
  } catch (err) { next(err); }
}

// ── Privacy Masking — Serve masked file text ──────────────────────────────────
// GET /share/:token/masked-text
// Returns extracted + masked plain text (never the original file bytes).

export async function getMaskedText(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token } = req.params;
    const sessionId = req.query['sessionId'] as string | undefined;

    const fullLink = await prisma.shareLink.findUnique({ where: { token } });
    if (!fullLink || !fullLink.privacyMaskingEnabled) {
      res.status(404).json({ success: false, error: 'Masking not enabled for this link' });
      return;
    }

    // Check if this session has an approved unmask request
    let isUnmasked = false;
    if (sessionId) {
      const approved = await prisma.unmaskRequest.findFirst({
        where: { shareToken: token, sessionId, status: 'APPROVED' },
      });
      isUnmasked = !!approved;
    }

    // Decrypt the vault file (read-only — original never modified)
    const vaultResult = await vaultService.retrieve(fullLink.vaultId);
    const buffer = vaultResult.originalBuffer;
    const mime   = fullLink.mimeType;

    let rawText = '';
    if (mime === 'application/pdf') {
      rawText = await extractTextFromPdf(buffer);
    } else if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      rawText = await extractTextFromDocx(buffer);
    } else if (mime.startsWith('text/') || mime === 'application/json') {
      rawText = extractTextFromPlain(buffer);
    } else {
      res.status(422).json({ success: false, error: 'File type does not support text masking' });
      return;
    }

    let displayText = rawText;
    if (!isUnmasked) {
      const maskConfig: MaskingConfig = {
        maskEmail:          fullLink.maskEmail,
        maskPhone:          fullLink.maskPhone,
        maskAadhaar:        fullLink.maskAadhaar,
        maskPan:            fullLink.maskPan,
        maskAddress:        fullLink.maskAddress,
        maskCustomPatterns: fullLink.maskCustomPatterns
          ? (JSON.parse(fullLink.maskCustomPatterns) as string[])
          : [],
      };
      displayText = applyMasks(rawText, maskConfig);
    }

    if (isUnmasked) {
      auditService.log({ eventType: 'UNMASK_VIEWED', filename: fullLink.filename, req });
    }

    res.json({ success: true, text: displayText, isUnmasked, filename: fullLink.filename, mimeType: mime });
  } catch (err) { next(err); }
}

// ── Privacy Masking — Request unmasked access ─────────────────────────────────
// POST /share/:token/unmask-request

export async function requestUnmask(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token } = req.params;
    const { recipientName, sessionId } = req.body as { recipientName?: string; sessionId?: string };

    const fullLink = await prisma.shareLink.findUnique({ where: { token } });
    if (!fullLink) { res.status(404).json({ success: false, error: 'Link not found' }); return; }

    const ua    = req.headers['user-agent'] ?? '';
    const device = /Mobi|Android/.test(ua) ? 'mobile' : /Tablet|iPad/.test(ua) ? 'tablet' : 'desktop';
    const ip    = resolveClientIp(req);

    // Check for existing pending request from this session
    const existing = await prisma.unmaskRequest.findFirst({
      where: { shareToken: token, sessionId: sessionId ?? '', status: 'PENDING' },
    });
    if (existing) {
      res.json({ success: true, requestId: existing.id, status: 'PENDING', message: 'Request already pending' });
      return;
    }

    const unmaskReq = await prisma.unmaskRequest.create({
      data: {
        shareToken:    token,
        recipientName: recipientName ?? null,
        sessionId:     sessionId ?? null,
        ipAddress:     ip,
        device,
        browser:       ua.match(/Chrome|Firefox|Safari|Edge|Opera/)?.[0] ?? null,
        os:            /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : null,
        status:        'PENDING',
      },
    });

    auditService.log({ eventType: 'UNMASK_REQUESTED', filename: fullLink.filename, req,
      detail: { shareToken: token, sessionId, recipientName } });

    res.status(201).json({ success: true, requestId: unmaskReq.id, status: 'PENDING' });
  } catch (err) { next(err); }
}

// ── Privacy Masking — Check unmask status for a session ──────────────────────
// GET /share/:token/unmask-status?sessionId=xxx

export async function getUnmaskStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token } = req.params;
    const sessionId = req.query['sessionId'] as string | undefined;

    const request = await prisma.unmaskRequest.findFirst({
      where: { shareToken: token, sessionId: sessionId ?? '' },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, status: request?.status ?? 'NONE', requestId: request?.id ?? null });
  } catch (err) { next(err); }
}

// ── Privacy Masking — List all unmask requests (owner dashboard) ──────────────
// GET /share/unmask-requests

export async function listUnmaskRequests(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const requests = await prisma.unmaskRequest.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { shareLink: { select: { filename: true, token: true } } },
    });
    res.json({ success: true, requests });
  } catch (err) { next(err); }
}

// ── Privacy Masking — Approve / Reject unmask request ────────────────────────
// POST /share/unmask-requests/:id/approve
// POST /share/unmask-requests/:id/reject

export async function reviewUnmaskRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const action  = req.body['action'] as 'approve' | 'reject';
    const note    = req.body['note'] as string | undefined;

    if (!['approve', 'reject'].includes(action)) {
      res.status(400).json({ success: false, error: 'action must be approve or reject' });
      return;
    }

    const status = action === 'approve' ? 'APPROVED' : 'REJECTED';
    const updated = await prisma.unmaskRequest.update({
      where: { id },
      data: { status, reviewedAt: new Date(), reviewNote: note ?? null },
      include: { shareLink: { select: { filename: true } } },
    });

    auditService.log({
      eventType: action === 'approve' ? 'UNMASK_APPROVED' : 'UNMASK_REJECTED',
      filename: updated.shareLink.filename,
      req,
      detail: { requestId: id, recipientName: updated.recipientName, sessionId: updated.sessionId },
    });

    res.json({ success: true, status, requestId: id });
  } catch (err) { next(err); }
}

// ── Global Share Analytics — all metrics for dashboard ────────────────────────
// GET /share/analytics/global
export async function getGlobalShareStats(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const logs = await prisma.shareAccessLog.findMany({
      select: {
        action: true, country: true, city: true,
        sessionDurationSec: true, sessionId: true,
        riskScore: true, riskLevel: true,
        ipAddress: true, createdAt: true,
        shareLink: { select: { dnaRecordId: true } },
      },
    });

    const byAction = (a: string) => logs.filter(l => l.action === a).length;
    const uniqueSet = (fn: (l: typeof logs[0]) => string | null | undefined) =>
      new Set(logs.map(fn).filter(Boolean)).size;

    const viewed   = logs.filter(l => l.action === 'VIEWED');
    const avgViewTime = viewed.length
      ? Math.round(viewed.reduce((s, l) => s + (l.sessionDurationSec ?? 0), 0) / viewed.length)
      : 0;

    // Risk score distribution
    const riskDist = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
    for (const l of logs) {
      const k = (l.riskLevel ?? 'LOW') as keyof typeof riskDist;
      if (k in riskDist) riskDist[k]++;
    }

    // Unique recipients = unique (ip + sessionId) combos
    const uniqueRecipients = new Set(logs.map(l => `${l.ipAddress}|${l.sessionId}`)).size;

    res.json({
      success: true,
      stats: {
        totalViews:           byAction('VIEWED'),
        uniqueRecipients,
        countriesReached:     uniqueSet(l => l.country),
        citiesReached:        uniqueSet(l => l.city),
        avgViewTimeSec:       avgViewTime,
        downloads:            byAction('DOWNLOADED'),
        blockedDownloads:     byAction('BLOCKED_DOWNLOAD'),
        printAttempts:        byAction('PRINT_ATTEMPT'),
        copyAttempts:         byAction('COPY_ATTEMPT'),
        screenshotAttempts:   byAction('SCREENSHOT_ATTEMPT'),
        riskDistribution:     riskDist,
        // Not yet tracked — future feature placeholders
        pageCompletion:       null,
        forwardChains:        null,
        leakIncidents:        null,
        leakSources:          null,
      },
    });
  } catch (err) { next(err); }
}
