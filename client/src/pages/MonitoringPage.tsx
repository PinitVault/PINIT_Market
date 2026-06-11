/**
 * PINIT-DNA — Monitoring Dashboard
 * Route: /monitoring
 *
 * Monitor registered files for unauthorized copies on the internet.
 * Shows: active monitors, alerts, match confidence, crawl history.
 */

import { useState } from 'react';
import {
  Radio, Search, AlertTriangle, CheckCircle2, XCircle,
  RefreshCw, Play, Pause, Globe, Shield,
} from 'lucide-react';
import { format } from 'date-fns';
import axios from 'axios';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { API_BASE_URL } from '../config/api.config';
import { useApi } from '../hooks/useApi';
import { listDnaRecords, deriveFileType } from '../services/dashboard.api';
import { Badge, FileTypeBadge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { SkeletonCard } from '../components/ui/Skeleton';
import { Modal } from '../components/ui/Modal';
import { cn } from '../components/ui/utils';

interface MonitorRecord {
  id:            string;
  dnaRecordId:   string;
  filename:      string;
  fileType:      string;
  status:        string;
  totalChecks:   number;
  totalMatches:  number;
  lastCheckedAt: string | null;
  nextCheckAt:   string | null;
  crawlResults:  CrawlResult[];
  _count:        { crawlResults: number };
}

interface CrawlResult {
  id:          string;
  url:         string;
  pageTitle:   string;
  similarity:  number;
  matchType:   string;
  alertStatus: string;
  foundText:   string;
  checkedAt:   string;
  monitorRecord?: { filename: string; fileType: string; dnaRecordId: string };
}

interface Stats {
  totalMonitored:  number;
  activeMonitors:  number;
  pendingAlerts:   number;
  confirmedMatches:number;
}

const MATCH_COLOR: Record<string, string> = {
  DUPLICATE:  'text-danger',
  NEAR_MATCH: 'text-orange',
  POSSIBLE:   'text-warning',
  NO_MATCH:   'text-gray-500',
};

function AlertCard({ alert, onDismiss, onConfirm }: {
  alert: CrawlResult;
  onDismiss: () => void;
  onConfirm: () => void;
}) {
  const pct = Math.round(alert.similarity * 100);
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className={cn(
        'card border transition-all',
        alert.matchType === 'DUPLICATE'  ? 'border-danger/30 bg-danger/5'   :
        alert.matchType === 'NEAR_MATCH' ? 'border-orange/30 bg-orange/5'   :
        alert.matchType === 'POSSIBLE'   ? 'border-warning/30 bg-warning/5' : ''
      )}>
      <div className="flex items-start gap-3">
        <div className={cn('text-2xl shrink-0', MATCH_COLOR[alert.matchType])}>
          {alert.matchType === 'DUPLICATE' ? '🚨' : alert.matchType === 'NEAR_MATCH' ? '⚠️' : '🔍'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Badge variant={alert.matchType === 'DUPLICATE' ? 'danger' : alert.matchType === 'NEAR_MATCH' ? 'orange' : 'warning'}>
              {alert.matchType.replace('_', ' ')}
            </Badge>
            <span className={cn('text-lg font-bold mono', MATCH_COLOR[alert.matchType])}>{pct}%</span>
            {alert.monitorRecord && <FileTypeBadge type={alert.monitorRecord.fileType} />}
          </div>
          {alert.monitorRecord && (
            <p className="text-xs font-semibold text-white mb-1">{alert.monitorRecord.filename}</p>
          )}
          <p className="text-xs text-gray-400 truncate mb-1">{alert.pageTitle || 'No title'}</p>
          <a href={alert.url} target="_blank" rel="noreferrer"
            className="text-2xs text-dna-400 hover:underline truncate block mono">
            {alert.url.slice(0, 80)}{alert.url.length > 80 ? '…' : ''}
          </a>
          {alert.foundText && (
            <p className="text-2xs text-gray-500 mt-2 line-clamp-2">{alert.foundText.slice(0, 150)}</p>
          )}
          <p className="text-2xs text-gray-600 mt-1">
            Found {format(new Date(alert.checkedAt), 'MMM d, HH:mm')}
          </p>
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          <button onClick={onConfirm} className="btn btn-danger btn-sm text-2xs px-2 py-1">
            <CheckCircle2 size={11} /> Confirm
          </button>
          <button onClick={onDismiss} className="btn btn-secondary btn-sm text-2xs px-2 py-1">
            <XCircle size={11} /> Dismiss
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export function MonitoringPage() {
  const [monitors,  setMonitors]  = useState<MonitorRecord[]>([]);
  const [alerts,    setAlerts]    = useState<CrawlResult[]>([]);
  const [stats,     setStats]     = useState<Stats | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [enrollOpen,setEnrollOpen]= useState(false);
  const [checking,  setChecking]  = useState<string | null>(null);
  const [checkResult, setCheckResult] = useState<Record<string, unknown> | null>(null);
  const [enrollUrls,  setEnrollUrls]  = useState('');
  const [enrollingId, setEnrollingId] = useState<string | null>(null);

  const { data: dnaRecords } = useApi(listDnaRecords);

  const load = async () => {
    setLoading(true);
    try {
      const [mResp, aResp, sResp] = await Promise.all([
        axios.get(`${API_BASE_URL}/monitor`),
        axios.get(`${API_BASE_URL}/monitor/alerts?status=PENDING`),
        axios.get(`${API_BASE_URL}/monitor/stats`),
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setMonitors((mResp.data as any).monitors ?? []);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setAlerts((aResp.data as any).alerts ?? []);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setStats(sResp.data as any);
    } catch { toast.error('Failed to load monitoring data'); }
    finally { setLoading(false); }
  };

  useState(() => { load(); });

  const handleEnroll = async (dnaRecordId: string) => {
    setEnrollingId(dnaRecordId);
    try {
      const watchUrls = enrollUrls
        .split('\n')
        .map(u => u.trim())
        .filter(u => u.startsWith('http'));
      await axios.post(`${API_BASE_URL}/monitor/enroll/${dnaRecordId}`, { watchUrls });
      toast.success('File enrolled for monitoring');
      setEnrollOpen(false);
      setEnrollUrls('');
      load();
    } catch { toast.error('Enrollment failed'); }
    finally { setEnrollingId(null); }
  };

  const handleCheck = async (id: string, _filename: string) => {
    setChecking(id);
    try {
      const { data } = await axios.post(`${API_BASE_URL}/monitor/${id}/check`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = data as any;
      setCheckResult(d);
      toast.success(`Check complete: ${d.matchesFound} matches found`);
      load();
    } catch { toast.error('Check failed'); }
    finally { setChecking(null); }
  };

  const handleDismiss = async (alertId: string) => {
    await axios.post(`${API_BASE_URL}/monitor/alerts/${alertId}/dismiss`);
    setAlerts(prev => prev.filter(a => a.id !== alertId));
    toast.success('Alert dismissed');
  };

  const handleConfirm = async (alertId: string) => {
    await axios.post(`${API_BASE_URL}/monitor/alerts/${alertId}/confirm`);
    setAlerts(prev => prev.filter(a => a.id !== alertId));
    toast.success('Match confirmed as genuine');
  };

  const notMonitored = (dnaRecords ?? []).filter(r =>
    !monitors.some(m => m.dnaRecordId === r.id)
  );

  return (
    <div className="space-y-5 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Monitoring & Crawler</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Watch the internet for unauthorized copies of your registered files
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setEnrollOpen(true)} className="btn btn-primary btn-sm">
            <Radio size={14} /> Enroll File
          </button>
          <button onClick={load} disabled={loading} className="btn btn-secondary btn-sm">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Monitored Files', value: stats.totalMonitored, icon: <Shield size={16} className="text-dna-400" /> },
            { label: 'Active Monitors', value: stats.activeMonitors, icon: <Radio size={16} className="text-success" /> },
            { label: 'Pending Alerts', value: stats.pendingAlerts, icon: <AlertTriangle size={16} className="text-warning" /> },
            { label: 'Confirmed Matches', value: stats.confirmedMatches, icon: <AlertTriangle size={16} className="text-danger" /> },
          ].map(s => (
            <div key={s.label} className="card-sm flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-bg-elevated flex items-center justify-center">{s.icon}</div>
              <div>
                <p className="text-xl font-bold text-white">{s.value}</p>
                <p className="text-2xs text-gray-500">{s.label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pending alerts */}
      {alerts.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <AlertTriangle size={16} className="text-warning" />
            Pending Alerts ({alerts.length})
          </h2>
          <div className="space-y-3">
            {alerts.map(a => (
              <AlertCard key={a.id} alert={a}
                onDismiss={() => handleDismiss(a.id)}
                onConfirm={() => handleConfirm(a.id)} />
            ))}
          </div>
        </div>
      )}

      {/* Check result */}
      <AnimatePresence>
        {checkResult && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className={cn('card border', (checkResult as Record<string,unknown>)['matchesFound'] as number > 0 ? 'border-warning/30 bg-warning/5' : 'border-success/30 bg-success/5')}>
            <div className="flex items-center gap-3 mb-3">
              {(checkResult as Record<string,unknown>)['matchesFound'] as number > 0
                ? <AlertTriangle size={18} className="text-warning" />
                : <CheckCircle2 size={18} className="text-success" />}
              <div className="flex-1">
                <p className="font-semibold text-white">
                  Check Complete — {(checkResult as Record<string,unknown>)['matchesFound'] as number > 0
                    ? `${(checkResult as Record<string,unknown>)['matchesFound']} match(es) found!`
                    : 'No matches found'}
                </p>
                {(checkResult as Record<string,unknown>)['method'] === 'PHASH_COMPARISON' && (
                  <p className="text-2xs text-dna-400 mono mt-0.5">
                    🔬 pHash image comparison · stored: {String((checkResult as Record<string,unknown>)['storedPHash']).slice(0,16)}
                  </p>
                )}
              </div>
              <button onClick={() => setCheckResult(null)} className="ml-auto btn-ghost btn-icon">
                <XCircle size={14} />
              </button>
            </div>
            {/* Stats grid — image pipeline has extra fields */}
            <div className={cn('gap-3 text-center grid', (checkResult as Record<string,unknown>)['method'] === 'PHASH_COMPARISON' ? 'grid-cols-4' : 'grid-cols-3')}>
              {[
                { label: 'URLs Checked',       value: (checkResult as Record<string,unknown>)['urlsChecked'] },
                ...(((checkResult as Record<string,unknown>)['method'] === 'PHASH_COMPARISON') ? [
                  { label: 'Downloaded',        value: (checkResult as Record<string,unknown>)['candidatesDownloaded'] },
                ] : []),
                { label: 'Matches Found',      value: (checkResult as Record<string,unknown>)['matchesFound'] },
                { label: 'Highest Similarity', value: `${(checkResult as Record<string,unknown>)['highestSimilarity']}%` },
              ].map(s => (
                <div key={s.label} className="bg-bg-elevated rounded-lg p-2">
                  <p className="text-sm font-bold text-white">{String(s.value)}</p>
                  <p className="text-2xs text-gray-500">{s.label}</p>
                </div>
              ))}
            </div>
            {/* Image matches detail */}
            {(checkResult as Record<string,unknown>)['method'] === 'PHASH_COMPARISON' &&
             ((checkResult as Record<string,unknown>)['matches'] as unknown[])?.length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-2xs text-gray-500 font-semibold">MATCHED CANDIDATES</p>
                {((checkResult as Record<string,unknown>)['matches'] as Array<Record<string,unknown>>).map((m, i) => (
                  <div key={i} className="bg-bg-elevated rounded-lg p-2 flex items-center gap-3">
                    <span className={cn('text-xs font-bold mono shrink-0',
                      m['matchType'] === 'DUPLICATE' ? 'text-danger' :
                      m['matchType'] === 'NEAR_MATCH' ? 'text-orange' : 'text-warning'
                    )}>{Math.round((m['pHashSimilarity'] as number) * 100)}%</span>
                    <div className="flex-1 min-w-0">
                      <a href={String(m['imageUrl'])} target="_blank" rel="noreferrer"
                        className="text-2xs text-dna-400 hover:underline truncate block mono">
                        {String(m['imageUrl']).slice(0, 80)}…
                      </a>
                      <p className="text-2xs text-gray-600">Hamming dist: {String(m['pHashDistance'])} · {String(m['source'])}</p>
                    </div>
                    <Badge variant={m['matchType'] === 'DUPLICATE' ? 'danger' : m['matchType'] === 'NEAR_MATCH' ? 'orange' : 'warning'}>
                      {String(m['matchType']).replace('_',' ')}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
            {/* Image rejection summary */}
            {(checkResult as Record<string,unknown>)['method'] === 'PHASH_COMPARISON' &&
             ((checkResult as Record<string,unknown>)['rejections'] as unknown[])?.length > 0 && (
              <details className="mt-2">
                <summary className="text-2xs text-gray-600 cursor-pointer hover:text-gray-400">
                  {((checkResult as Record<string,unknown>)['rejections'] as unknown[]).length} candidates rejected (click to expand)
                </summary>
                <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                  {((checkResult as Record<string,unknown>)['rejections'] as Array<Record<string,unknown>>).slice(0,10).map((r, i) => (
                    <div key={i} className="flex gap-2 text-2xs">
                      <span className="text-gray-600 mono shrink-0">{Math.round((r['score'] as number)*100)}%</span>
                      <span className="text-gray-500 truncate">{String(r['reason'])}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Monitors list */}
      <div>
        <h2 className="text-sm font-semibold text-white mb-3">Monitored Files</h2>
        {loading ? (
          <div className="space-y-3">{Array.from({length:3}).map((_,i) => <SkeletonCard key={i} />)}</div>
        ) : monitors.length === 0 ? (
          <div className="card">
            <EmptyState icon={Radio} title="No files being monitored"
              description="Enroll files to start monitoring them for unauthorized copies"
              action={
                <button onClick={() => setEnrollOpen(true)} className="btn btn-primary btn-sm">
                  <Radio size={14} /> Enroll First File
                </button>
              }
            />
          </div>
        ) : (
          <div className="space-y-3">
            {monitors.map(m => (
              <div key={m.id} className="card">
                <div className="flex items-start gap-3">
                  <div className={cn('w-2 h-2 rounded-full mt-1.5 shrink-0',
                    m.status === 'ACTIVE'  ? 'bg-success animate-pulse' :
                    m.status === 'PAUSED'  ? 'bg-warning' : 'bg-gray-500'
                  )} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <FileTypeBadge type={m.fileType} />
                      <p className="text-sm font-semibold text-white truncate">{m.filename}</p>
                      <Badge variant={m.status === 'ACTIVE' ? 'success' : m.status === 'PAUSED' ? 'warning' : 'muted'}>
                        {m.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 text-2xs text-gray-500">
                      <span>{m.totalChecks} checks</span>
                      <span className={m.totalMatches > 0 ? 'text-warning' : ''}>{m.totalMatches} matches</span>
                      {m.lastCheckedAt && <span>Last: {format(new Date(m.lastCheckedAt), 'MMM d HH:mm')}</span>}
                      {m.nextCheckAt && <span>Next: {format(new Date(m.nextCheckAt), 'MMM d HH:mm')}</span>}
                    </div>
                    {/* Recent alerts */}
                    {m.crawlResults.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {m.crawlResults.slice(0,2).map(r => (
                          <div key={r.id} className="flex items-center gap-2 bg-bg-elevated rounded p-1.5">
                            <Globe size={10} className="text-gray-500 shrink-0" />
                            <span className="text-2xs text-gray-400 truncate">{r.url.slice(0,60)}…</span>
                            <span className={cn('text-2xs font-bold ml-auto', MATCH_COLOR[r.matchType])}>
                              {Math.round(r.similarity*100)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleCheck(m.id, m.filename)}
                      disabled={checking === m.id}
                      className="btn btn-secondary btn-sm text-xs"
                      title="Run check now"
                    >
                      {checking === m.id
                        ? <RefreshCw size={12} className="animate-spin" />
                        : <Search size={12} />}
                      {checking === m.id ? 'Checking…' : 'Check Now'}
                    </button>
                    {m.status === 'ACTIVE'
                      ? <button onClick={() => axios.post(`${API_BASE_URL}/monitor/${m.id}/pause`).then(load)} className="btn-ghost btn-icon"><Pause size={12} /></button>
                      : <button onClick={() => axios.post(`${API_BASE_URL}/monitor/${m.id}/resume`).then(load)} className="btn-ghost btn-icon"><Play size={12} /></button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Enroll modal */}
      <Modal open={enrollOpen} onClose={() => { setEnrollOpen(false); setEnrollUrls(''); }} title="Enroll File for Monitoring" size="md">
        <div className="p-5 space-y-3">
          <p className="text-xs text-gray-400">
            Select a file to monitor. The system will check the internet every 24 hours for unauthorized copies.
          </p>

          {notMonitored.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">All files are already enrolled for monitoring.</p>
          ) : (
            <div className="space-y-2 max-h-52 overflow-y-auto">
              {notMonitored.map(r => (
                <button key={r.id} onClick={() => handleEnroll(r.id)}
                  disabled={enrollingId === r.id}
                  className="w-full flex items-center gap-3 p-3 bg-bg-elevated hover:bg-bg-muted rounded-xl border border-bg-border transition-all text-left disabled:opacity-60">
                  <FileTypeBadge type={deriveFileType(r)} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{r.imageFilename}</p>
                    <p className="text-2xs text-gray-500 mono">{r.id.slice(0,12)}…</p>
                  </div>
                  {enrollingId === r.id
                    ? <RefreshCw size={14} className="text-dna-400 shrink-0 animate-spin" />
                    : <Radio size={14} className="text-dna-400 shrink-0" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
