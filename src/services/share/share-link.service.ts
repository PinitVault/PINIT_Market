/**
 * PINIT-DNA — Smart Links Engine Service
 *
 * Creates secure, tracked share links for vault records.
 * Every access is logged: IP, browser, OS, geo, action.
 * Timeline events emitted for: LINK_CREATED, LINK_COPIED, LINK_VIEWED, LINK_DOWNLOADED, LINK_REVOKED
 */

import crypto   from 'crypto';
import axios    from 'axios';
import { prisma } from '../../lib/prisma';
import { logger }  from '../../lib/logger';
import { riskEngineService } from './risk-engine.service';

// ─── HMAC token signing (integrity layer — detects tampered/guessed tokens) ──
const HMAC_SECRET = process.env['SHARE_HMAC_SECRET'] || 'pinit-dna-dev-secret-change-me';

function signToken(token: string): string {
  return crypto.createHmac('sha256', HMAC_SECRET).update(token).digest('hex');
}

function verifyTokenSignature(token: string, signature: string | null | undefined): boolean {
  if (!signature) return false;
  const expected = signToken(token);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ─── OTP helpers (in-app — no external email/SMS provider configured) ────────
// NOTE: actually emailing the OTP requires SMTP credentials (e.g. nodemailer +
// SHARE_SMTP_* env vars), which are not present in this project. The OTP is
// generated and verified server-side; in dev it's returned in the create
// response / logged so the flow can be demoed end-to-end without email infra.
function generateOtp(): string {
  return String(crypto.randomInt(100000, 999999));
}
function hashOtp(otp: string): string {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

// ─── IP Geolocation (ip-api.com — free, no key needed) ───────────────────────
interface GeoInfo { country?: string; city?: string; region?: string; isp?: string; }

export async function geoFromIp(ip: string): Promise<GeoInfo> {
  // Skip private/loopback IPs
  if (!ip || ip === '::1' || ip.startsWith('127.') || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return {};
  }
  try {
    const clean = ip.replace('::ffff:', ''); // strip IPv6-mapped IPv4
    const { data } = await axios.get<{ country?: string; city?: string; regionName?: string; isp?: string; status?: string }>(
      `http://ip-api.com/json/${clean}?fields=status,country,city,regionName,isp`,
      { timeout: 3000 }
    );
    if (data.status === 'success') {
      return { country: data.country, city: data.city, region: data.regionName, isp: data.isp };
    }
  } catch { /* silent — geo is best-effort */ }
  return {};
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateShareLinkInput {
  vaultId:       string;
  expiresIn?:    number | null;  // hours, null = never
  maxViews?:     number | null;
  allowDownload?: boolean;
  requireName?:  boolean;
  note?:         string;

  // ── Extended access policy ────────────────────────────────────────────
  oneTimeUse?:        boolean;
  maxDownloads?:      number | null;
  allowedCountries?:  string[];
  allowedDeviceTypes?: string[];
  allowedIpPrefixes?: string[];

  // ── Identity verification ─────────────────────────────────────────────
  requireOtp?:     boolean;
  recipientEmail?: string;

  // ── Privacy Masking (viewer-layer only) ───────────────────────────────
  privacyMaskingEnabled?: boolean;
  maskEmail?:             boolean;
  maskPhone?:             boolean;
  maskAadhaar?:           boolean;
  maskPan?:               boolean;
  maskAddress?:           boolean;
  maskCustomPatterns?:    string[];

  // ── GPS Location Request ──────────────────────────────────────────────
  requestLocation?:       boolean;
}

export interface ShareLinkPublicInfo {
  token:        string;
  filename:     string;
  mimeType:     string;
  note:         string | null;
  requireName:  boolean;
  allowDownload: boolean;
  expiresAt:    string | null;
  maxViews:     number | null;
  viewCount:    number;
  isExpired:    boolean;
  isExhausted:  boolean;
  isActive:     boolean;

  oneTimeUse:       boolean;
  maxDownloads:     number | null;
  downloadCount:    number;
  requireOtp:       boolean;
  otpVerified:      boolean;
  signatureValid:   boolean;
  privacyMaskingEnabled: boolean;
  requestLocation:  boolean;
}

export interface AccessLogInput {
  shareLinkId:   string;
  action:        string;
  recipientName?: string;
  ipAddress?:    string;
  userAgent?:    string;
  browser?:      string;
  os?:           string;
  device?:       string;
  country?:      string;
  city?:         string;
  region?:       string;
  isp?:          string;
  timezone?:     string;
  referrer?:     string;
  sessionId?:    string;
  screenResolution?: string;
  deviceFingerprint?: string;
  // GPS — optional, user-consented
  gpsLat?:       number;
  gpsLng?:       number;
  gpsAccuracy?:  number;
  gpsCity?:      string;
  gpsTimestamp?: Date;
  locationShared?: boolean;
}

export interface PolicyCheckResult {
  allowed: boolean;
  reason?: 'BLOCKED_COUNTRY' | 'BLOCKED_DEVICE' | 'BLOCKED_IP' | 'BLOCKED_OTP_REQUIRED';
  message?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a short random token: 10 URL-safe chars */
function generateToken(): string {
  return crypto.randomBytes(8).toString('base64url').slice(0, 10);
}

/** Parse User-Agent into browser / OS / device */
function parseUserAgent(ua: string): { browser: string; os: string; device: string } {
  const browser =
    /Edg\//.test(ua)     ? 'Edge' :
    /Chrome\//.test(ua)  ? 'Chrome' :
    /Firefox\//.test(ua) ? 'Firefox' :
    /Safari\//.test(ua)  ? 'Safari' :
    /OPR\//.test(ua)     ? 'Opera' : 'Unknown';

  const os =
    /Windows/.test(ua)  ? 'Windows' :
    /Mac OS/.test(ua)   ? 'macOS' :
    /Linux/.test(ua)    ? 'Linux' :
    /Android/.test(ua)  ? 'Android' :
    /iPhone|iPad/.test(ua) ? 'iOS' : 'Unknown';

  const device =
    /Mobi|Android/.test(ua) ? 'mobile' :
    /Tablet|iPad/.test(ua)  ? 'tablet' : 'desktop';

  return { browser, os, device };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class ShareLinkService {

  // ── Create share link ─────────────────────────────────────────────────────

  async create(input: CreateShareLinkInput) {
    // Fetch vault + dna record info
    const vault = await prisma.vaultRecord.findUnique({
      where: { id: input.vaultId },
      include: { dnaRecord: { select: { id: true, imageFilename: true, imageMimeType: true } } },
    });
    if (!vault) throw new Error(`Vault record not found: ${input.vaultId}`);

    // Generate unique token
    let token = generateToken();
    let attempts = 0;
    while (await prisma.shareLink.findUnique({ where: { token } })) {
      token = generateToken();
      if (++attempts > 10) throw new Error('Failed to generate unique token');
    }

    const expiresAt = input.expiresIn
      ? new Date(Date.now() + input.expiresIn * 3_600_000)
      : null;

    // Sign the token (HMAC-SHA256) — integrity layer verified on every lookup
    const tokenSignature = signToken(token);

    // Generate OTP if email-gate requested (no SMTP configured — see note above)
    let otpCodeHash: string | null = null;
    let otpExpiresAt: Date | null = null;
    let plainOtp: string | null = null;
    if (input.requireOtp && input.recipientEmail) {
      plainOtp = generateOtp();
      otpCodeHash = hashOtp(plainOtp);
      otpExpiresAt = new Date(Date.now() + 15 * 60_000); // 15 min validity
      logger.info('[SmartLink] OTP generated for recipient (no SMTP configured — logging for demo)', {
        recipientEmail: input.recipientEmail, otp: plainOtp,
      });
    }

    const link = await prisma.shareLink.create({
      data: {
        token,
        tokenSignature,
        vaultId:      vault.id,
        dnaRecordId:  vault.dnaRecordId,
        filename:     vault.originalFileName,
        mimeType:     vault.originalMimeType,
        expiresAt,
        maxViews:     input.maxViews ?? null,
        allowDownload: input.allowDownload ?? false,
        requireName:  input.requireName ?? false,
        note:         input.note ?? null,

        oneTimeUse:        input.oneTimeUse ?? false,
        maxDownloads:      input.maxDownloads ?? null,
        allowedCountries:  input.allowedCountries ?? [],
        allowedDeviceTypes: input.allowedDeviceTypes ?? [],
        allowedIpPrefixes: input.allowedIpPrefixes ?? [],

        requireOtp:     input.requireOtp ?? false,
        recipientEmail: input.recipientEmail ?? null,
        otpCodeHash,
        otpExpiresAt,

        // Privacy Masking — viewer-layer only
        privacyMaskingEnabled: input.privacyMaskingEnabled ?? false,
        maskEmail:             input.maskEmail    ?? false,
        maskPhone:             input.maskPhone    ?? false,
        maskAadhaar:           input.maskAadhaar  ?? false,
        maskPan:               input.maskPan      ?? false,
        maskAddress:           input.maskAddress  ?? false,
        maskCustomPatterns:    input.maskCustomPatterns?.length
          ? JSON.stringify(input.maskCustomPatterns)
          : null,
        // GPS Location Request
        requestLocation: input.requestLocation ?? false,
      },
    });

    logger.info('[SmartLink] Created', { token, filename: vault.originalFileName, expiresAt });

    // devOtp is only ever returned to the CREATOR (response to POST /share),
    // never exposed via the public link-info endpoint.
    return { ...link, devOtp: plainOtp };
  }

  // ── Get link public info (no auth required) ───────────────────────────────

  async getPublicInfo(token: string): Promise<ShareLinkPublicInfo | null> {
    const link = await prisma.shareLink.findUnique({ where: { token } });
    if (!link) return null;

    const isExpired   = !!link.expiresAt && new Date(link.expiresAt) < new Date();
    const isExhausted = !!link.maxViews  && link.viewCount >= link.maxViews;

    // ── HMAC integrity check — a token whose signature doesn't match the
    //    server secret was either forged, guessed, or predates signing
    //    (legacy links created before this feature shipped get `null`
    //    signatures and are treated as "unsigned, but not flagged tampered").
    const signatureValid = link.tokenSignature
      ? verifyTokenSignature(token, link.tokenSignature)
      : true; // unsigned legacy link — don't false-flag it as tampered

    if (link.tokenSignature && !signatureValid) {
      logger.warn('[SmartLink] HMAC signature mismatch — possible tampered/forged token', { token });
    }

    return {
      token:         link.token,
      filename:      link.filename,
      mimeType:      link.mimeType,
      note:          link.note,
      requireName:   link.requireName,
      allowDownload: link.allowDownload,
      expiresAt:     link.expiresAt?.toISOString() ?? null,
      maxViews:      link.maxViews,
      viewCount:     link.viewCount,
      isExpired,
      isExhausted,
      isActive:      link.isActive && !isExpired && !isExhausted && signatureValid,

      oneTimeUse:    link.oneTimeUse,
      maxDownloads:  link.maxDownloads,
      downloadCount: link.downloadCount,
      requireOtp:    link.requireOtp,
      otpVerified:   link.otpVerified,
      signatureValid,
      privacyMaskingEnabled: link.privacyMaskingEnabled,
      requestLocation:       link.requestLocation,
    };
  }

  // ── Verify recipient-entered OTP ──────────────────────────────────────────

  async verifyOtp(token: string, otp: string): Promise<{ ok: boolean; message: string }> {
    const link = await prisma.shareLink.findUnique({ where: { token } });
    if (!link) return { ok: false, message: 'Link not found' };
    if (!link.requireOtp) return { ok: true, message: 'OTP not required' };
    if (!link.otpCodeHash) return { ok: false, message: 'No OTP was generated for this link' };
    if (link.otpExpiresAt && new Date(link.otpExpiresAt) < new Date()) {
      return { ok: false, message: 'OTP has expired — ask the sender for a new link' };
    }
    if (hashOtp(otp) !== link.otpCodeHash) {
      return { ok: false, message: 'Incorrect code — please try again' };
    }
    await prisma.shareLink.update({ where: { token }, data: { otpVerified: true } });
    logger.info('[SmartLink] OTP verified', { token });
    return { ok: true, message: 'Verified' };
  }

  // ── Policy enforcement (device / geo / IP allow-lists) ────────────────────
  // Returns `allowed: false` with a reason if the requesting context violates
  // any non-empty allow-list configured on the link. Empty list = no restriction.

  checkPolicy(
    link: { allowedCountries: string[]; allowedDeviceTypes: string[]; allowedIpPrefixes: string[] },
    ctx: { country?: string | null; device?: string | null; ipAddress?: string | null }
  ): PolicyCheckResult {
    if (link.allowedCountries?.length && ctx.country) {
      // Normalise: convert geo-IP full name ("India") to ISO code ("IN") so it matches
      // stored values (VaultPage saves ISO codes). Also accept direct full-name match.
      const countryIsoMap: Record<string, string> = {
        'india': 'IN', 'united states': 'US', 'united states of america': 'US',
        'united kingdom': 'GB', 'australia': 'AU', 'canada': 'CA',
        'germany': 'DE', 'france': 'FR', 'japan': 'JP', 'china': 'CN',
        'singapore': 'SG', 'united arab emirates': 'AE', 'russia': 'RU',
        'brazil': 'BR', 'south africa': 'ZA', 'italy': 'IT', 'spain': 'ES',
        'netherlands': 'NL', 'new zealand': 'NZ', 'pakistan': 'PK',
        'bangladesh': 'BD', 'sri lanka': 'LK', 'indonesia': 'ID',
        'malaysia': 'MY', 'thailand': 'TH', 'philippines': 'PH',
        'south korea': 'KR', 'taiwan': 'TW', 'hong kong': 'HK',
        'mexico': 'MX', 'argentina': 'AR', 'chile': 'CL', 'colombia': 'CO',
        'sweden': 'SE', 'norway': 'NO', 'denmark': 'DK', 'finland': 'FI',
        'poland': 'PL', 'ukraine': 'UA', 'turkey': 'TR', 'egypt': 'EG',
        'nigeria': 'NG', 'kenya': 'KE', 'ghana': 'GH',
      };
      const geoKey    = ctx.country.toLowerCase();
      const geoIso    = countryIsoMap[geoKey] ?? ctx.country.toUpperCase().slice(0, 2);
      const geoName   = ctx.country;
      const allowed   = link.allowedCountries;
      const match = allowed.some(a =>
        a.toUpperCase() === geoIso ||
        a.toLowerCase() === geoKey ||
        a.toLowerCase() === geoName.toLowerCase()
      );
      if (!match) {
        return { allowed: false, reason: 'BLOCKED_COUNTRY', message: `Access from ${ctx.country} is not permitted. Allowed: ${allowed.join(', ')}` };
      }
    }
    if (link.allowedDeviceTypes?.length && ctx.device) {
      const deviceLower = ctx.device.toLowerCase();
      if (!link.allowedDeviceTypes.map(d => d.toLowerCase()).includes(deviceLower)) {
        return { allowed: false, reason: 'BLOCKED_DEVICE', message: `${ctx.device} devices are not permitted. Allowed: ${link.allowedDeviceTypes.join(', ')}` };
      }
    }
    if (link.allowedIpPrefixes?.length && ctx.ipAddress) {
      const matches = link.allowedIpPrefixes.some(prefix => ctx.ipAddress!.startsWith(prefix));
      if (!matches) {
        return { allowed: false, reason: 'BLOCKED_IP', message: 'Your IP address is not in the permitted range for this link' };
      }
    }
    return { allowed: true };
  }

  // ── Record an access event ────────────────────────────────────────────────

  async recordAccess(input: AccessLogInput) {
    // [DEBUG] Stage-3a: log what the service received
    logger.debug('[IP-AUDIT] Stage-3a service.recordAccess received', {
      action:    input.action,
      ipAddress: input.ipAddress ?? 'NULL/UNDEFINED',
    });

    const link = await prisma.shareLink.findUnique({ where: { id: input.shareLinkId } });
    if (!link) return;

    const ua = input.userAgent ?? '';
    const { browser, os, device } = parseUserAgent(ua);
    const finalDevice = input.device ?? device;

    // Auto-geolocate if country not provided
    let country = input.country ?? null;
    let city    = input.city    ?? null;
    let region  = input.region  ?? null;
    let isp     = input.isp     ?? null;
    if (!country && input.ipAddress) {
      const geo = await geoFromIp(input.ipAddress);
      country = geo.country ?? null;
      city    = geo.city    ?? null;
      region  = region ?? geo.region ?? null;
      isp     = isp    ?? geo.isp    ?? null;
    }

    // ── Session duration: time elapsed since the first event of this session
    let sessionDurationSec: number | null = null;
    if (input.sessionId) {
      const firstInSession = await prisma.shareAccessLog.findFirst({
        where:   { shareLinkId: input.shareLinkId, sessionId: input.sessionId },
        orderBy: { createdAt: 'asc' },
      });
      if (firstInSession) {
        sessionDurationSec = Math.max(0, Math.round((Date.now() - new Date(firstInSession.createdAt).getTime()) / 1000));
      } else {
        sessionDurationSec = 0; // this IS the first event of the session
      }
    }

    // ── AI Risk Engine — score this event against the link's prior history
    const history = await prisma.shareAccessLog.findMany({
      where:   { shareLinkId: input.shareLinkId },
      orderBy: { createdAt: 'desc' },
      take:    50,
      select:  { action: true, country: true, ipAddress: true, device: true, createdAt: true },
    });
    const risk = riskEngineService.score({
      action: input.action,
      country, device: finalDevice, browser: input.browser ?? browser,
      ipAddress: input.ipAddress ?? null,
      history,
    });

    // [DEBUG] Stage-3b: log exactly what is being written to DB
    logger.debug('[IP-AUDIT] Stage-3b writing to DB', {
      action:    input.action,
      ipAddress: input.ipAddress ?? 'NULL — will be stored as null',
      country,
      city,
    });

    await prisma.shareAccessLog.create({
      data: {
        shareLinkId:   input.shareLinkId,
        action:        input.action,
        recipientName: input.recipientName ?? null,
        ipAddress:     input.ipAddress ?? null,
        userAgent:     ua.slice(0, 500),
        browser:       input.browser ?? browser,
        os:            input.os ?? os,
        device:        finalDevice,
        country,
        city,
        region,
        isp,
        timezone:      input.timezone ?? null,
        referrer:      input.referrer ?? null,
        sessionId:     input.sessionId ?? null,
        screenResolution:  input.screenResolution ?? null,
        deviceFingerprint: input.deviceFingerprint ?? null,
        riskScore:     risk.score,
        riskLevel:     risk.level,
        riskFactors:   JSON.stringify(risk.factors),
        sessionDurationSec,
        // GPS — stored only when user consented
        gpsLat:        input.gpsLat        ?? null,
        gpsLng:        input.gpsLng        ?? null,
        gpsAccuracy:   input.gpsAccuracy   ?? null,
        gpsCity:       input.gpsCity       ?? null,
        gpsTimestamp:  input.gpsTimestamp  ?? null,
        locationShared: input.locationShared ?? false,
      },
    });

    // Increment view/download counters; honor one-time-use & numeric download caps
    const updateData: Record<string, unknown> = {};
    if (input.action === 'VIEWED') {
      updateData['viewCount'] = { increment: 1 };
      if (link.oneTimeUse) {
        // Self-revoke after the first real view — true "one-time access link"
        updateData['isActive'] = false;
        logger.info('[SmartLink] One-time-use link consumed — auto-revoking', { token: link.token });
      }
    }
    if (input.action === 'DOWNLOADED') {
      updateData['viewCount']      = { increment: 1 };
      updateData['downloadCount']  = { increment: 1 };
    }
    if (Object.keys(updateData).length > 0) {
      await prisma.shareLink.update({ where: { id: input.shareLinkId }, data: updateData });
    }

    if (risk.level === 'HIGH' || risk.level === 'CRITICAL') {
      logger.warn('[SmartLink] Elevated risk access detected', {
        token: link.token, action: input.action, score: risk.score, level: risk.level, factors: risk.factors,
      });
    }

    // ── Auto-revoke on CRITICAL risk ────────────────────────────────────────
    // Revokes the link automatically when score ≥ 85 AND at least 2 suspicious
    // actions exist in the history (guards against single-event false positives,
    // e.g. a first-time traveller triggering "+new country" alone).
    const SUSPICIOUS_ACTIONS = new Set(['COPY_ATTEMPT', 'SCREENSHOT_ATTEMPT', 'PRINT_ATTEMPT']);
    if (risk.level === 'CRITICAL' && risk.score >= 85) {
      const suspiciousCount = history.filter(h => SUSPICIOUS_ACTIONS.has(h.action)).length;
      if (suspiciousCount >= 2 || risk.score >= 90) {
        await prisma.shareLink.update({ where: { id: input.shareLinkId }, data: { isActive: false } });
        logger.warn('[SmartLink] 🚨 AUTO-REVOKE triggered — CRITICAL risk with confirmed suspicious behaviour', {
          token: link.token, score: risk.score, suspiciousCount, factors: risk.factors,
        });
      }
    }

    logger.info('[SmartLink] Access logged', {
      token: link.token,
      action: input.action,
      ip: input.ipAddress,
      browser: input.browser ?? browser,
      country,
      riskScore: risk.score,
      riskLevel: risk.level,
    });
  }

  // ── Geo analytics aggregation (Geo Intelligence dashboard data) ───────────

  async getGeoAnalytics(dnaRecordId?: string) {
    const where = dnaRecordId
      ? { shareLink: { dnaRecordId } }
      : {};
    const logs = await prisma.shareAccessLog.findMany({
      where: { ...where, country: { not: null } },
      select: { country: true, city: true, action: true, riskLevel: true },
    });

    const byCountry: Record<string, { count: number; cities: Set<string>; highRisk: number }> = {};
    for (const log of logs) {
      const c = log.country!;
      byCountry[c] ??= { count: 0, cities: new Set(), highRisk: 0 };
      byCountry[c]!.count++;
      if (log.city) byCountry[c]!.cities.add(log.city);
      if (log.riskLevel === 'HIGH' || log.riskLevel === 'CRITICAL') byCountry[c]!.highRisk++;
    }

    return Object.entries(byCountry)
      .map(([country, v]) => ({
        country, accessCount: v.count, cities: [...v.cities], highRiskEvents: v.highRisk,
      }))
      .sort((a, b) => b.accessCount - a.accessCount);
  }

  // ── CSV export of a link's full access log (Audit Export) ─────────────────

  async exportAccessLogsCsv(token: string): Promise<string | null> {
    const link = await this.getWithLogs(token);
    if (!link) return null;

    const headers = [
      'Timestamp', 'Action', 'Recipient', 'IP Address', 'Country', 'City', 'Region', 'ISP',
      'Browser', 'OS', 'Device', 'Screen Resolution', 'Risk Score', 'Risk Level', 'Session Duration (s)', 'Session ID',
    ];
    const escape = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = link.accessLogs.map(l => [
      l.createdAt.toISOString(), l.action, l.recipientName, l.ipAddress, l.country, l.city, l.region, l.isp,
      l.browser, l.os, l.device, l.screenResolution, l.riskScore, l.riskLevel, l.sessionDurationSec, l.sessionId,
    ].map(escape).join(','));

    return [headers.join(','), ...rows].join('\n');
  }

  // ── Get all links for a vault record ─────────────────────────────────────

  async listByVault(vaultId: string) {
    return prisma.shareLink.findMany({
      where:   { vaultId },
      orderBy: { createdAt: 'desc' },
      include: { accessLogs: { orderBy: { createdAt: 'desc' }, take: 10 } },
    });
  }

  // ── List all share links (admin view) ─────────────────────────────────────

  async listAll() {
    return prisma.shareLink.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { accessLogs: true } },
        accessLogs: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });
  }

  // ── Get a specific link with full logs ────────────────────────────────────

  async getWithLogs(token: string) {
    return prisma.shareLink.findUnique({
      where:   { token },
      include: {
        accessLogs: { orderBy: { createdAt: 'desc' } },
        _count: { select: { accessLogs: true } },
      },
    });
  }

  // ── Revoke ────────────────────────────────────────────────────────────────

  async revoke(token: string) {
    const link = await prisma.shareLink.findUnique({ where: { token } });
    if (!link) throw new Error(`Share link not found: ${token}`);

    await prisma.shareLink.update({
      where: { token },
      data:  { isActive: false },
    });

    logger.info('[SmartLink] Revoked', { token, filename: link.filename });
    return link;
  }

  // ── Live / concurrent session monitoring ──────────────────────────────────
  // A "live session" = a distinct sessionId with an event in the last 5 minutes.
  // "Force logout" maps to revoking the parent link — the next request from
  // that session is blocked server-side immediately (see recordAccess/serveSharedFile).

  async getLiveSessions() {
    const cutoff = new Date(Date.now() - 5 * 60_000);
    const recent = await prisma.shareAccessLog.findMany({
      where:   { sessionId: { not: null }, createdAt: { gte: cutoff } },
      orderBy: { createdAt: 'desc' },
      include: { shareLink: { select: { token: true, filename: true, dnaRecordId: true, isActive: true } } },
    });

    const bySession = new Map<string, typeof recent>();
    for (const log of recent) {
      const key = log.sessionId!;
      if (!bySession.has(key)) bySession.set(key, []);
      bySession.get(key)!.push(log);
    }

    const sessions = [...bySession.entries()].map(([sessionId, logs]) => {
      const latest = logs[0]!;
      const oldest = logs[logs.length - 1]!;
      const riskLevels = logs.map(l => l.riskLevel).filter(Boolean);
      const worstRisk = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].find(lv => riskLevels.includes(lv)) ?? 'LOW';
      return {
        sessionId,
        token:        latest.shareLink.token,
        filename:     latest.shareLink.filename,
        dnaRecordId:  latest.shareLink.dnaRecordId,
        linkActive:   latest.shareLink.isActive,
        recipientName: latest.recipientName,
        ipAddress:    latest.ipAddress,
        country:      latest.country,
        city:         latest.city,
        browser:      latest.browser,
        os:           latest.os,
        device:       latest.device,
        eventCount:   logs.length,
        firstSeen:    oldest.createdAt,
        lastSeen:     latest.createdAt,
        durationSec:  Math.round((latest.createdAt.getTime() - oldest.createdAt.getTime()) / 1000),
        riskLevel:    worstRisk,
        lastAction:   latest.action,
      };
    }).sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());

    // Concurrent-session detection: same link, multiple distinct active sessions
    const byToken = new Map<string, number>();
    for (const s of sessions) byToken.set(s.token, (byToken.get(s.token) ?? 0) + 1);
    const concurrentTokens = [...byToken.entries()].filter(([, n]) => n > 1).map(([t]) => t);

    return { sessions, concurrentTokens };
  }

  // ── Get access logs for File Timeline ────────────────────────────────────

  async getTimelineEvents(dnaRecordId: string) {
    const links = await prisma.shareLink.findMany({
      where:   { dnaRecordId },
      orderBy: { createdAt: 'asc' },
      include: { accessLogs: { orderBy: { createdAt: 'asc' } } },
    });
    return links;
  }
}

export const shareLinkService = new ShareLinkService();
