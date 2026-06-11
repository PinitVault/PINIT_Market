/**
 * PINIT-DNA — Smart Links AI Risk Engine
 *
 * Heuristic, explainable risk scoring computed at write-time from the
 * access-log history of a share link + the incoming event's context.
 * No external ML service required — pure rule-based scoring over signals
 * that are already captured (geo, device, behavior, suspicious actions).
 *
 * Score: 0-100   Level: LOW < 30 <= MEDIUM < 60 <= HIGH < 85 <= CRITICAL
 */

import { logger } from '../../lib/logger';

export interface RiskInput {
  action: string;
  country?: string | null;
  city?: string | null;
  device?: string | null;
  browser?: string | null;
  ipAddress?: string | null;
  /** prior logs for this share link, most-recent-first */
  history: Array<{
    action: string;
    country: string | null;
    ipAddress: string | null;
    device: string | null;
    createdAt: Date;
  }>;
}

export interface RiskResult {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  factors: string[];
}

const SUSPICIOUS_ACTIONS = new Set([
  'COPY_ATTEMPT', 'SCREENSHOT_ATTEMPT', 'PRINT_ATTEMPT',
]);

function levelFor(score: number): RiskResult['level'] {
  if (score >= 85) return 'CRITICAL';
  if (score >= 60) return 'HIGH';
  if (score >= 30) return 'MEDIUM';
  return 'LOW';
}

export class RiskEngineService {

  /** Compute a heuristic risk score for the current access event. */
  score(input: RiskInput): RiskResult {
    let score = 0;
    const factors: string[] = [];
    const { history } = input;

    // ── 1. Direct suspicious action ──────────────────────────────────────
    if (SUSPICIOUS_ACTIONS.has(input.action)) {
      score += 25;
      factors.push(`Suspicious action detected: ${input.action.replace('_', ' ').toLowerCase()}`);
    }

    // ── 2. Repeated suspicious behavior in this link's history ───────────
    const priorSuspicious = history.filter(h => SUSPICIOUS_ACTIONS.has(h.action)).length;
    if (priorSuspicious >= 5) {
      score += 30;
      factors.push(`Repeated suspicious activity — ${priorSuspicious} prior copy/screenshot/print attempts`);
    } else if (priorSuspicious >= 2) {
      score += 15;
      factors.push(`Multiple suspicious attempts (${priorSuspicious}) earlier in this link's history`);
    }

    // ── 3. New / unusual country compared to prior access history ────────
    const knownCountries = new Set(history.map(h => h.country).filter(Boolean) as string[]);
    if (input.country && knownCountries.size > 0 && !knownCountries.has(input.country)) {
      score += 20;
      factors.push(`Access from a new country not seen before on this link: ${input.country}`);
    }
    if (knownCountries.size >= 3) {
      score += 10;
      factors.push(`Link has been accessed from ${knownCountries.size}+ different countries — wide distribution`);
    }

    // ── 4. New / unusual IP address ───────────────────────────────────────
    const knownIps = new Set(history.map(h => h.ipAddress).filter(Boolean) as string[]);
    if (input.ipAddress && knownIps.size >= 4 && !knownIps.has(input.ipAddress)) {
      score += 10;
      factors.push('Access from a new IP address after multiple distinct IPs already seen');
    }

    // ── 5. Rapid re-access (possible automated/bot behavior) ─────────────
    if (history.length > 0) {
      const last = history[0]!;
      const deltaMs = Date.now() - new Date(last.createdAt).getTime();
      if (deltaMs < 2_000 && (input.action === 'VIEWED' || input.action === 'DOWNLOADED')) {
        score += 15;
        factors.push('Two access events within 2 seconds — possible automated/bot access');
      }
    }

    // ── 6. Off-hours access (00:00–05:00 local server time) ──────────────
    const hour = new Date().getHours();
    if (hour >= 0 && hour < 5) {
      score += 8;
      factors.push('Access occurred during off-hours (00:00–05:00)');
    }

    // ── 7. High view-count velocity (many events in short window) ────────
    const recentWindow = history.filter(
      h => Date.now() - new Date(h.createdAt).getTime() < 60_000
    ).length;
    if (recentWindow >= 8) {
      score += 12;
      factors.push(`High event velocity — ${recentWindow} events in the last 60 seconds`);
    }

    score = Math.min(100, score);
    const level = levelFor(score);

    if (factors.length === 0) {
      factors.push('No anomalies detected — access pattern looks normal');
    }

    logger.debug('[RiskEngine] Scored access event', { action: input.action, score, level });

    return { score, level, factors };
  }
}

export const riskEngineService = new RiskEngineService();
