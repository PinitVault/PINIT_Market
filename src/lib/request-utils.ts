/**
 * PINIT-DNA — Request Utility Helpers
 *
 * resolveClientIp(req)       — single source of truth for IP extraction
 * resolvePublicBaseUrl(req)  — single source of truth for public app URL
 *
 * Priority for IP:
 *   1. x-forwarded-for (first non-private IP)
 *   2. x-real-ip
 *   3. cf-connecting-ip  (Cloudflare)
 *   4. req.ip            (Express trust-proxy parsed)
 *   5. req.socket.remoteAddress
 *
 * Priority for public base URL:
 *   1. PUBLIC_APP_URL  env var
 *   2. NGROK_URL       env var  (legacy alias)
 *   3. x-forwarded-host / x-forwarded-proto headers  (ngrok/proxy sets these)
 *   4. Host request header  (same machine, any port)
 *   5. http://localhost:PORT  (dev fallback only)
 */

import { Request } from 'express';
import { logger }  from './logger';

// ─── Private / loopback ranges — never store as "real" IP ────────────────────
const PRIVATE_PREFIXES = ['127.', '10.', '192.168.', '172.16.', '172.17.',
  '172.18.', '172.19.', '172.20.', '172.21.', '172.22.', '172.23.',
  '172.24.', '172.25.', '172.26.', '172.27.', '172.28.', '172.29.',
  '172.30.', '172.31.', 'fc', 'fd'];

function isPrivate(ip: string): boolean {
  if (!ip) return true;
  const normalized = ip.replace(/^::ffff:/, ''); // strip IPv4-mapped IPv6
  if (normalized === '::1') return true;          // loopback
  return PRIVATE_PREFIXES.some(p => normalized.startsWith(p));
}

/**
 * Extract the best available client IP from the request.
 * Always returns a string (never null/undefined).
 * Returns '::1' for local requests — that is correct and expected.
 */
export function resolveClientIp(req: Request): string {
  // x-forwarded-for may contain a comma-separated list: "client, proxy1, proxy2"
  // First entry is the original client IP (when trust proxy is enabled).
  const xff = req.headers['x-forwarded-for'] as string | undefined;
  if (xff) {
    const candidates = xff.split(',').map(s => s.trim()).filter(Boolean);
    // Prefer first public IP in the list
    const publicIp = candidates.find(ip => !isPrivate(ip));
    if (publicIp) {
      logger.debug('[resolveClientIp] from x-forwarded-for (public)', { ip: publicIp });
      return publicIp;
    }
    // All are private — still use the first one (e.g. local dev behind ngrok)
    if (candidates[0]) {
      logger.debug('[resolveClientIp] from x-forwarded-for (private/local)', { ip: candidates[0] });
      return candidates[0];
    }
  }

  const xri = req.headers['x-real-ip'] as string | undefined;
  if (xri) {
    logger.debug('[resolveClientIp] from x-real-ip', { ip: xri });
    return xri.trim();
  }

  const cf = req.headers['cf-connecting-ip'] as string | undefined;
  if (cf) {
    logger.debug('[resolveClientIp] from cf-connecting-ip', { ip: cf });
    return cf.trim();
  }

  if (req.ip) {
    logger.debug('[resolveClientIp] from req.ip', { ip: req.ip });
    return req.ip;
  }

  const socket = req.socket?.remoteAddress ?? '::1';
  logger.debug('[resolveClientIp] from socket.remoteAddress', { ip: socket });
  return socket;
}

/**
 * Resolve the public-facing base URL of the application.
 *
 * Used for generating share links, emails, etc.
 * Never returns localhost in production.
 */
export function resolvePublicBaseUrl(req: Request): string {
  // ── 1. Explicit env var — highest priority ────────────────────────────────
  const envUrl = process.env['PUBLIC_APP_URL'] ?? process.env['NGROK_URL'];
  if (envUrl) {
    const url = envUrl.replace(/\/$/, ''); // strip trailing slash
    logger.debug('[resolvePublicBaseUrl] from env', { url });
    return url;
  }

  // ── 2. Proxy headers (ngrok / reverse proxy set these) ───────────────────
  const xfProto = req.headers['x-forwarded-proto'] as string | undefined;
  const xfHost  = req.headers['x-forwarded-host']  as string | undefined;
  if (xfHost) {
    const proto = xfProto?.split(',')[0]?.trim() ?? 'https';
    const host  = xfHost.split(',')[0]?.trim();
    const url   = `${proto}://${host}`;
    logger.debug('[resolvePublicBaseUrl] from x-forwarded-host', { url });
    return url;
  }

  // ── 3. Request Host header + Express protocol ────────────────────────────
  const host = req.get('host');
  if (host && !host.startsWith('localhost') && !host.startsWith('127.')) {
    const url = `${req.protocol}://${host}`;
    logger.debug('[resolvePublicBaseUrl] from request host', { url });
    return url;
  }

  // ── 4. localhost dev fallback ─────────────────────────────────────────────
  const port = process.env['PORT'] ?? '4000';
  const url  = `http://localhost:${port}`;
  logger.debug('[resolvePublicBaseUrl] fallback to localhost', { url });
  return url;
}

/**
 * Build a full share viewer URL: <publicBase>/s/<token>
 */
export function buildShareUrl(req: Request, token: string): string {
  const base = resolvePublicBaseUrl(req);
  return `${base}/s/${token}`;
}

/**
 * Debug dump of all IP-related headers — used in test report endpoint.
 */
export function dumpIpHeaders(req: Request) {
  return {
    'x-forwarded-for':  req.headers['x-forwarded-for']  ?? 'MISSING',
    'x-real-ip':        req.headers['x-real-ip']         ?? 'MISSING',
    'cf-connecting-ip': req.headers['cf-connecting-ip']  ?? 'MISSING',
    'x-forwarded-host': req.headers['x-forwarded-host']  ?? 'MISSING',
    'x-forwarded-proto':req.headers['x-forwarded-proto'] ?? 'MISSING',
    'req.ip':           req.ip                            ?? 'NULL',
    'socket.remote':    req.socket?.remoteAddress         ?? 'NULL',
    'resolved':         resolveClientIp(req),
  };
}
