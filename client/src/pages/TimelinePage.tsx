/**
 * PINIT-DNA — File Timeline & History (Phase 4.3)
 * Route: /timeline
 *
 * Reads DNA records + vault records + session comparison reports.
 * Builds a chronological audit trail per file.
 * DOES NOT modify any existing logic.
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import {
  Clock, Dna, Lock, Search, GitCompare, Award,
  Shield, RefreshCw, Filter, ChevronDown, ChevronUp,
  Share2, Eye, Download, Copy, Ban,
} from 'lucide-react';
import axios from 'axios';
import { useApi } from '../hooks/useApi';
import { listDnaRecords, listVaultRecords, deriveFileType } from '../services/dashboard.api';
import { FileTypeBadge, Badge } from '../components/ui/Badge';
import { SkeletonCard } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { cn } from '../components/ui/utils';
import { API_BASE_URL } from '../config/api.config';
import type { DnaRecord, VaultRecord, ComparisonResult } from '../types/dashboard.types';

// ─── Event types ──────────────────────────────────────────────────────────────

interface AuditEvent {
  id: string;
  timestamp: string;
  type: 'DNA_GENERATED' | 'VAULT_STORED' | 'COMPARED' | 'CERTIFICATE' | 'SHARE_CREATED' | 'SHARE_ACCESSED' | 'SHARE_DOWNLOADED' | 'SHARE_COPIED' | 'SHARE_REVOKED';
  title: string;
  detail: string;
  icon: React.ReactNode;
  color: string;
  meta?: Record<string, string>;
}

interface FileHistory {
  filename: string;
  fileType: string;
  dnaRecordId: string;
  vaultId: string | null;
  events: AuditEvent[];
  lastActivity: string;
}

// ─── Build history from available data ────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildHistory(
  dnaRecords: DnaRecord[],
  vaultRecords: VaultRecord[],
  comparisons: ComparisonResult[],
  shareEventsByDna: Record<string, any[]> = {}
): FileHistory[] {
  const vaultByDna = new Map(vaultRecords.map(v => [v.dnaRecordId, v]));
  const histories: FileHistory[] = [];

  for (const r of dnaRecords) {
    const vault = vaultByDna.get(r.id);
    const events: AuditEvent[] = [];

    // DNA Generated
    events.push({
      id: `dna-${r.id}`,
      timestamp: r.createdAt,
      type: 'DNA_GENERATED',
      title: '6-Layer DNA Fingerprint Generated',
      detail: `${r.status} · ${deriveFileType(r)} · ${Math.round(r.imageSizeBytes / 1024)} KB`,
      icon: <Dna size={14} />, color: 'bg-dna-500/20 border-dna-500/40 text-dna-400',
      meta: { 'DNA Record ID': r.id, Status: r.status, 'Engine': r.engineVersion ?? '1.0.0' },
    });

    // Vault stored
    if (vault) {
      events.push({
        id: `vault-${vault.id}`,
        timestamp: vault.createdAt,
        type: 'VAULT_STORED',
        title: 'AES-256-GCM Encrypted & Vaulted',
        detail: `${vault.encryptionAlgorithm} · ${Math.round(vault.encryptedSizeBytes / 1024)} KB encrypted`,
        icon: <Lock size={14} />, color: 'bg-success/20 border-success/40 text-success',
        meta: { 'Vault ID': vault.id, Encryption: vault.encryptionAlgorithm, 'Key Derivation': vault.keyDerivation },
      });

      // Certificate (if vaulted)
      events.push({
        id: `cert-${vault.id}`,
        timestamp: vault.createdAt,
        type: 'CERTIFICATE',
        title: 'Ownership Certificate Available',
        detail: `CERT-DNA-${vault.id.slice(0, 8).toUpperCase()} · Available for download`,
        icon: <Award size={14} />, color: 'bg-purple/20 border-purple/40 text-purple',
        meta: { 'Certificate ID': `CERT-DNA-${vault.id.slice(0, 8).toUpperCase()}` },
      });
    }

    // Share link events
    const shareLinks = shareEventsByDna[r.id] ?? [];
    for (const link of shareLinks) {
      // Link created
      events.push({
        id: `share-created-${link.id}`,
        timestamp: link.createdAt,
        type: 'SHARE_CREATED',
        title: 'Smart Share Link Generated',
        detail: `Token: ${link.token} · ${link.expiresAt ? `Expires ${new Date(link.expiresAt).toLocaleDateString()}` : 'No expiry'}${link.maxViews ? ` · Max ${link.maxViews} views` : ''}`,
        icon: <Share2 size={14} />, color: 'bg-orange/20 border-orange/40 text-orange',
        meta: {
          Token: link.token,
          'Allow Download': link.allowDownload ? 'Yes' : 'No',
          'Require Name': link.requireName ? 'Yes' : 'No',
          Status: link.isActive ? 'ACTIVE' : 'REVOKED',
        },
      });

      // Build session → GPS map so GPS from VIEWED event propagates to all events in session
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sessionGps: Record<string, any> = {};
      for (const log of (link.accessLogs ?? [])) {
        if (log.locationShared && log.gpsLat != null && log.sessionId) {
          sessionGps[log.sessionId] = {
            gpsLat: log.gpsLat, gpsLng: log.gpsLng,
            gpsAccuracy: log.gpsAccuracy, gpsCity: log.gpsCity,
          };
        }
      }

      // Access log events
      for (const log of (link.accessLogs ?? [])) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const actionIcon: Record<string, any> = {
          VIEWED:              <Eye size={14} />,
          DOWNLOADED:          <Download size={14} />,
          COPIED:              <Copy size={14} />,
          COPY_ATTEMPT:        <Copy size={14} />,
          SCREENSHOT_ATTEMPT:  <Ban size={14} />,
          SCROLL:              <Eye size={14} />,
          TAB_SWITCH:          <Eye size={14} />,
          PRINT_ATTEMPT:       <Ban size={14} />,
          BLOCKED_EXPIRED:     <Ban size={14} />,
          BLOCKED_MAX_VIEWS:   <Ban size={14} />,
        };
        const actionColor: Record<string, string> = {
          VIEWED:             'bg-blue/20 border-blue/30 text-blue-400',
          DOWNLOADED:         'bg-success/20 border-success/40 text-success',
          COPIED:             'bg-dna-500/20 border-dna-500/40 text-dna-400',
          COPY_ATTEMPT:       'bg-warning/20 border-warning/40 text-warning',
          SCREENSHOT_ATTEMPT: 'bg-danger/20 border-danger/40 text-danger',
          SCROLL:             'bg-gray-500/10 border-gray-500/20 text-gray-400',
          TAB_SWITCH:         'bg-warning/10 border-warning/20 text-warning',
          PRINT_ATTEMPT:      'bg-danger/10 border-danger/20 text-danger',
          BLOCKED_EXPIRED:    'bg-danger/20 border-danger/40 text-danger',
          BLOCKED_MAX_VIEWS:  'bg-danger/20 border-danger/40 text-danger',
        };
        const actionLabel: Record<string, string> = {
          VIEWED:             'Link Viewed by Recipient',
          DOWNLOADED:         'File Downloaded via Link',
          COPIED:             'Link Copied',
          COPY_ATTEMPT:       '⚠ Copy Attempt Detected',
          SCREENSHOT_ATTEMPT: '🚨 Screenshot Attempt Detected',
          SCROLL:             'Scroll Activity',
          TAB_SWITCH:         'Tab Switch Detected',
          PRINT_ATTEMPT:      '🚨 Print Attempt Detected',
          BLOCKED_EXPIRED:    'Access Blocked — Link Expired',
          BLOCKED_MAX_VIEWS:  'Access Blocked — View Limit Reached',
        };

        // [DEBUG] Stage-5: log raw IP value from API before display logic
        console.debug('[IP-AUDIT] Stage-5 UI received log', { action: log.action, ipAddress: log.ipAddress ?? 'NULL', country: log.country });

        // Format IP — show friendly label for localhost
        const isLocalhost = !log.ipAddress || log.ipAddress === '::1' || log.ipAddress?.startsWith('127.');
        const ipDisplay   = isLocalhost ? '🖥 Local Dev' : `🌐 ${log.ipAddress}`;
        const geoDisplay  = log.country
          ? `📍 ${log.country}${log.city ? `, ${log.city}` : ''}`
          : isLocalhost ? '📍 Local Network' : '📍 Location unknown';

        const meta: Record<string, string> = { Token: link.token, Action: log.action };
        if (log.recipientName) meta['Recipient'] = log.recipientName;
        meta['IP Address'] = isLocalhost ? 'Local (::1)' : (log.ipAddress ?? 'Unknown');
        meta['Location']   = log.country ? `${log.country}${log.city ? `, ${log.city}` : ''}` : isLocalhost ? 'Local network' : 'Unknown';
        if (log.browser)   meta['Browser'] = log.browser;
        if (log.os)        meta['OS'] = log.os;
        if (log.timezone)  meta['Timezone'] = log.timezone;
        if (log.region)    meta['Region'] = log.region;
        if (log.isp)       meta['ISP'] = log.isp;
        if (log.screenResolution) meta['Screen'] = log.screenResolution;
        if (log.sessionDurationSec != null) meta['Session'] = `${log.sessionDurationSec}s`;
        // ── GPS Location — use own GPS or propagate from session's VIEWED event ──
        const gpsSource = log.locationShared && log.gpsLat != null
          ? log
          : (log.sessionId && sessionGps[log.sessionId]) ?? null;
        if (gpsSource) {
          const coords   = gpsSource.gpsLat != null && gpsSource.gpsLng != null
            ? `${Number(gpsSource.gpsLat).toFixed(5)}, ${Number(gpsSource.gpsLng).toFixed(5)}`
            : null;
          const accuracy = gpsSource.gpsAccuracy != null ? `±${Math.round(gpsSource.gpsAccuracy)}m` : null;
          const gpsCity  = gpsSource.gpsCity ?? null;
          meta['GPS Location'] = [gpsCity, coords, accuracy].filter(Boolean).join(' · ');
        }
        // ── AI Risk Engine output — surfaced per-event for the audit trail ──
        if (log.riskLevel) {
          meta['Risk'] = `${log.riskLevel}${log.riskScore != null ? ` (${log.riskScore})` : ''}`;
        }
        if (log.riskFactors) {
          try {
            const factors: string[] = JSON.parse(log.riskFactors);
            if (factors.length) meta['Risk Factors'] = factors.join('; ');
          } catch { /* not JSON — show raw */ if (log.riskFactors) meta['Risk Factors'] = log.riskFactors; }
        }

        events.push({
          id: `share-access-${log.id}`,
          timestamp: log.createdAt,
          type: log.action === 'DOWNLOADED'         ? 'SHARE_DOWNLOADED' :
                log.action === 'COPIED'             ? 'SHARE_COPIED'     : 'SHARE_ACCESSED',
          title: actionLabel[log.action] ?? `Link ${log.action}`,
          detail: [
            log.recipientName ? `By: ${log.recipientName}` : null,
            ipDisplay,
            geoDisplay,
            gpsSource
              ? `📡 GPS: ${gpsSource.gpsCity ?? `${Number(gpsSource.gpsLat).toFixed(3)}, ${Number(gpsSource.gpsLng).toFixed(3)}`} ±${Math.round(gpsSource.gpsAccuracy ?? 0)}m`
              : null,
            log.browser ? log.browser : null,
            log.os      ? log.os      : null,
          ].filter(Boolean).join(' · '),
          icon:  actionIcon[log.action]  ?? <Eye size={14} />,
          color: actionColor[log.action] ?? 'bg-gray-500/20 border-gray-500/40 text-gray-400',
          meta,
        });
      }
    }

    // Comparisons involving this DNA record
    for (const c of comparisons) {
      const involved = c.fileA.filename === r.imageFilename || c.fileB.filename === r.imageFilename;
      if (involved) {
        events.push({
          id: `cmp-${c.comparisonId}-${r.id}`,
          timestamp: c.comparedAt,
          type: 'COMPARED',
          title: `DNA Comparison · ${c.classification.replace('_', ' ')}`,
          detail: `${c.overallConfidenceScore}% confidence · ${c.tamperingDetected ? 'Tampering detected' : 'No tampering'}`,
          icon: <GitCompare size={14} />, color: 'bg-cyan/20 border-cyan/40 text-cyan',
          meta: {
            'Comparison ID': c.comparisonId.slice(0, 12),
            Classification: c.classification,
            Confidence: `${c.overallConfidenceScore}%`,
          },
        });
      }
    }

    // Sort events chronologically
    events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const lastActivity = events.length > 0 ? events[events.length - 1].timestamp : r.createdAt;

    histories.push({
      filename: r.imageFilename,
      fileType: deriveFileType(r),
      dnaRecordId: r.id,
      vaultId: vault?.id ?? null,
      events,
      lastActivity,
    });
  }

  // Sort by most recent activity
  return histories.sort((a, b) =>
    new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
  );
}

function getStoredComparisons(): ComparisonResult[] {
  try { return JSON.parse(sessionStorage.getItem('pinit_dna_reports') ?? '[]'); }
  catch { return []; }
}

// ─── File history card ────────────────────────────────────────────────────────

function FileHistoryCard({ history, expanded, onToggle }: { history: FileHistory; expanded: boolean; onToggle: () => void }) {

  const typeColor: Record<string, string> = {
    DNA_GENERATED:   'bg-dna-500/20 border-dna-500/40 text-dna-400',
    VAULT_STORED:    'bg-success/20 border-success/40 text-success',
    COMPARED:        'bg-cyan/20 border-cyan/40 text-cyan',
    CERTIFICATE:     'bg-purple/20 border-purple/40 text-purple',
    SHARE_CREATED:   'bg-orange/20 border-orange/40 text-orange',
    SHARE_ACCESSED:  'bg-blue/20 border-blue/30 text-blue-400',
    SHARE_DOWNLOADED:'bg-success/20 border-success/40 text-success',
    SHARE_COPIED:    'bg-dna-500/20 border-dna-500/40 text-dna-400',
    SHARE_REVOKED:   'bg-danger/20 border-danger/40 text-danger',
  };

  const typeIcon: Record<string, React.ReactNode> = {
    DNA_GENERATED:   <Dna size={14} />,
    VAULT_STORED:    <Lock size={14} />,
    COMPARED:        <GitCompare size={14} />,
    CERTIFICATE:     <Award size={14} />,
    SHARE_CREATED:   <Share2 size={14} />,
    SHARE_ACCESSED:  <Eye size={14} />,
    SHARE_DOWNLOADED:<Download size={14} />,
    SHARE_COPIED:    <Copy size={14} />,
    SHARE_REVOKED:   <Ban size={14} />,
  };

  return (
    <div className="card overflow-hidden p-0">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-bg-elevated/40 transition-colors"
      >
        <FileTypeBadge type={history.fileType} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">{history.filename}</p>
          <p className="text-xs text-gray-500 mono mt-0.5">
            {history.dnaRecordId.slice(0, 16)}… · {history.events.length} events
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1">
            {history.events.some(e => e.type === 'VAULT_STORED') && (
              <Badge variant="success">Vaulted</Badge>
            )}
            {history.events.some(e => e.type === 'COMPARED') && (
              <Badge variant="info">Compared</Badge>
            )}
          </div>
          <span className="text-xs text-gray-500">
            {formatDistanceToNow(new Date(history.lastActivity), { addSuffix: true })}
          </span>
          {expanded ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
        </div>
      </button>

      {/* Timeline */}
      {expanded && (
        <div className="border-t border-bg-border px-4 py-4">
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-[18px] top-0 bottom-0 w-px bg-bg-border" />

            <div className="space-y-4">
              {history.events.map((event, i) => (
                <div key={event.id} className="relative flex gap-3">
                  {/* Icon bubble */}
                  <div className={cn(
                    'relative z-10 w-9 h-9 rounded-full border flex items-center justify-center shrink-0',
                    typeColor[event.type] ?? 'bg-bg-elevated border-bg-border text-gray-400'
                  )}>
                    {typeIcon[event.type] ?? <Clock size={14} />}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 pb-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white">{event.title}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{event.detail}</p>
                      </div>
                      <span className="text-2xs text-gray-600 mono shrink-0 mt-0.5">
                        {format(new Date(event.timestamp), 'MMM d, HH:mm')}
                      </span>
                    </div>

                    {/* Metadata pills */}
                    {event.meta && Object.keys(event.meta).length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {Object.entries(event.meta).map(([k, v]) => (
                          <div key={k} className={cn(
                            'border rounded-lg px-2.5 py-1',
                            k === 'Risk' && /HIGH|CRITICAL/.test(v)
                              ? 'bg-danger/10 border-danger/30'
                              : k === 'Risk' && /MEDIUM/.test(v)
                              ? 'bg-warning/10 border-warning/30'
                              : 'bg-bg-elevated border-bg-border'
                          )}>
                            <span className="text-2xs text-gray-500">{k}: </span>
                            <span className={cn(
                              'text-2xs mono',
                              k === 'Risk' && /HIGH|CRITICAL/.test(v) ? 'text-danger'
                                : k === 'Risk' && /MEDIUM/.test(v) ? 'text-warning'
                                : 'text-gray-300'
                            )}>
                              {v.length > 60 ? v.slice(0, 60) + '…' : v}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Audit export — Smart Links CSV download per share token */}
                    {event.type === 'SHARE_CREATED' && event.meta?.['Token'] && (
                      <a
                        href={`${API_BASE_URL}/share/${event.meta['Token']}/export`}
                        target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1.5 mt-2 text-2xs text-dna-400 hover:text-dna-300 underline underline-offset-2"
                      >
                        <Download size={11} /> Export full audit log (CSV)
                      </a>
                    )}
                  </div>

                  {/* Connector dot */}
                  {i < history.events.length - 1 && (
                    <div className="absolute left-[17px] top-9 w-2 h-2 rounded-full bg-bg-border" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function TimelinePage() {
  const { data: dnaRecords, loading: loadDna, error: errDna, refetch } = useApi(listDnaRecords);
  const { data: vaultRecords, loading: loadVault }                      = useApi(listVaultRecords);
  const [search, setSearch]     = useState('');
  const [filterType, setFilterType] = useState('ALL');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [shareEventsByDna, setShareEventsByDna] = useState<Record<string, any[]>>({});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [geoAnalytics, setGeoAnalytics] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [liveSessions, setLiveSessions] = useState<{ live: any[]; concurrent: any[] }>({ live: [], concurrent: [] });

  const comparisons = useMemo(getStoredComparisons, []);
  const loading = loadDna || loadVault;

  // Lifted expand state — keyed by dnaRecordId so it survives auto-refresh re-renders
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Track the last-known total log count to detect new events
  const lastLogCount = useRef(0);

  // Fetch geo + live sessions once on mount (these rarely change mid-session)
  useEffect(() => {
    axios.get(`${API_BASE_URL}/share/analytics/geo`)
      .then(({ data }) => setGeoAnalytics((data as any).analytics ?? []))  // eslint-disable-line @typescript-eslint/no-explicit-any
      .catch(() => {});
    axios.get(`${API_BASE_URL}/share/sessions/live`)
      .then(({ data }) => setLiveSessions({ live: (data as any).live ?? [], concurrent: (data as any).concurrent ?? [] }))  // eslint-disable-line @typescript-eslint/no-explicit-any
      .catch(() => {});
  }, []);

  // Poll share events every 20s — only update state when new logs actually arrive
  useEffect(() => {
    const fetchLinks = () => {
      axios.get(`${API_BASE_URL}/share`)
        .then(({ data }) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const links: any[] = (data as any).links ?? [];
          const totalLogs = links.reduce((s: number, l: any) => s + (l.accessLogs?.length ?? 0), 0);  // eslint-disable-line @typescript-eslint/no-explicit-any

          // Only update state if new events arrived — avoids unnecessary re-renders
          if (totalLogs === lastLogCount.current) return;
          lastLogCount.current = totalLogs;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const map: Record<string, any[]> = {};
          for (const link of links) {
            if (!map[link.dnaRecordId]) map[link.dnaRecordId] = [];
            map[link.dnaRecordId].push(link);
          }
          setShareEventsByDna(map);
        })
        .catch(() => {});
    };
    fetchLinks();
    const id = setInterval(fetchLinks, 20_000);
    return () => clearInterval(id);
  }, []);

  const histories = useMemo(() => {
    if (!dnaRecords || !vaultRecords) return [];
    return buildHistory(dnaRecords, vaultRecords, comparisons, shareEventsByDna);
  }, [dnaRecords, vaultRecords, comparisons, shareEventsByDna]);

  const filtered = useMemo(() => histories.filter(h =>
    (filterType === 'ALL' || h.fileType === filterType) &&
    h.filename.toLowerCase().includes(search.toLowerCase())
  ), [histories, filterType, search]);

  const fileTypes = useMemo(() =>
    ['ALL', ...[...new Set(histories.map(h => h.fileType))]], [histories]);

  const totalEvents = histories.reduce((s, h) => s + h.events.length, 0);

  return (
    <div className="space-y-5 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">File Timeline & Audit Trail</h1>
          <p className="text-sm text-gray-500 mt-0.5">Complete lifecycle history for every registered file</p>
        </div>
        <div className="flex items-center gap-2">
          {!loading && <Badge variant="dna">{histories.length} files · {totalEvents} events</Badge>}
          <button onClick={refetch} disabled={loading} className="btn btn-secondary btn-sm">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 flex-wrap">
        {[
          { color: 'bg-dna-500/20 border-dna-500/40 text-dna-400', icon: <Dna size={12} />, label: 'DNA Generated' },
          { color: 'bg-success/20 border-success/40 text-success', icon: <Lock size={12} />, label: 'Vault Stored' },
          { color: 'bg-cyan/20 border-cyan/40 text-cyan',          icon: <GitCompare size={12} />, label: 'Compared' },
          { color: 'bg-purple/20 border-purple/40 text-purple',    icon: <Award size={12} />, label: 'Certificate' },
        ].map(item => (
          <div key={item.label} className="flex items-center gap-2">
            <div className={cn('w-6 h-6 rounded-full border flex items-center justify-center', item.color)}>
              {item.icon}
            </div>
            <span className="text-xs text-gray-400">{item.label}</span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text" placeholder="Search by filename…"
            value={search} onChange={e => setSearch(e.target.value)}
            className="input pl-9 text-sm"
          />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Filter size={13} className="text-gray-500" />
          {fileTypes.map(t => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={cn(
                'text-xs px-3 py-1.5 rounded-full border transition-all',
                filterType === t
                  ? 'bg-dna-500/20 border-dna-500/40 text-dna-400'
                  : 'border-bg-border text-gray-500 hover:text-white'
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Stats row */}
      {!loading && histories.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { icon: <Dna size={16} className="text-dna-400" />, label: 'Files Tracked', value: histories.length },
            { icon: <Lock size={16} className="text-success" />, label: 'Files Vaulted', value: histories.filter(h => h.vaultId).length },
            { icon: <GitCompare size={16} className="text-cyan" />, label: 'Comparisons', value: comparisons.length },
            { icon: <Shield size={16} className="text-purple" />, label: 'Total Events', value: totalEvents },
          ].map(item => (
            <div key={item.label} className="card-sm flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-bg-elevated flex items-center justify-center">{item.icon}</div>
              <div>
                <p className="text-lg font-bold text-white">{item.value}</p>
                <p className="text-2xs text-gray-500">{item.label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Geo Intelligence + Live Session Monitoring widgets */}
      {(geoAnalytics.length > 0 || liveSessions.live.length > 0 || liveSessions.concurrent.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Geo analytics */}
          {geoAnalytics.length > 0 && (
            <div className="card">
              <p className="text-xs font-semibold text-white mb-3">🌍 Geo Intelligence — Access by Country</p>
              <div className="space-y-2">
                {geoAnalytics.slice(0, 6).map((g, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <div className="min-w-0">
                      <span className="text-gray-300">{g.country ?? 'Unknown'}</span>
                      {g.cities?.length > 0 && (
                        <span className="text-gray-600 ml-1.5">· {g.cities.slice(0, 3).join(', ')}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {g.riskCount > 0 && <Badge variant="danger">{g.riskCount} risky</Badge>}
                      <span className="text-gray-500 mono">{g.count} events</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Live / concurrent sessions */}
          {(liveSessions.live.length > 0 || liveSessions.concurrent.length > 0) && (
            <div className="card">
              <p className="text-xs font-semibold text-white mb-3">🟢 Session Monitoring — Live Activity</p>
              <div className="space-y-2">
                {liveSessions.live.length === 0 && (
                  <p className="text-2xs text-gray-500">No active sessions in the last 5 minutes</p>
                )}
                {liveSessions.live.slice(0, 6).map((s, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-gray-300 mono">{(s.token ?? '').slice(0, 12)}…</span>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500">{s.recipientName ?? s.country ?? 'Anonymous'}</span>
                      <Badge variant="success">live</Badge>
                    </div>
                  </div>
                ))}
                {liveSessions.concurrent.length > 0 && (
                  <div className="pt-2 mt-2 border-t border-bg-border">
                    <p className="text-2xs text-warning font-semibold mb-1">⚠ Concurrent sessions detected</p>
                    {liveSessions.concurrent.slice(0, 4).map((c, i) => (
                      <div key={i} className="flex items-center justify-between text-2xs text-gray-400">
                        <span className="mono">{(c.token ?? '').slice(0, 12)}…</span>
                        <span>{c.sessionCount} sessions</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Timeline */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : errDna ? (
        <div className="card text-center">
          <p className="text-danger text-sm">{errDna}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Clock}
            title="No timeline events"
            description="Generate DNA fingerprints to start building your audit trail"
          />
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(h => (
            <FileHistoryCard
              key={h.dnaRecordId}
              history={h}
              expanded={expandedIds.has(h.dnaRecordId)}
              onToggle={() => toggleExpanded(h.dnaRecordId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
