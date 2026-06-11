/**
 * PINIT-DNA — Duplicate Upload Attempts Dashboard
 * Route: /duplicate-attempts
 *
 * Admin view: shows every DUPLICATE_UPLOAD_ATTEMPT event, newest first.
 * Displays: filename, existing DNA ID, match type, risk level, IP, device, timestamp.
 */

import { useState } from 'react';
import { format } from 'date-fns';
import { Shield, RefreshCw, AlertTriangle, Copy, CheckCircle2 } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { API_BASE_URL } from '../config/api.config';
import axios from 'axios';
import { Badge } from '../components/ui/Badge';
import { SkeletonCard } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DuplicateAttempt {
  id:                  string;
  timestamp:           string;
  filename:            string | null;
  fileType:            string | null;
  ipAddress:           string | null;
  browser:             string | null;
  os:                  string | null;
  device:              string | null;
  matchType:           'EXACT_HASH' | 'NEAR_DUPLICATE_PHASH' | null;
  riskLevel:           'HIGH' | 'LOW';
  sha256Hash:          string | null;
  existingDnaRecordId: string | null;
  existingFilename:    string | null;
  pHashSimilarity:     number | null;
}

// ─── Fetch function ───────────────────────────────────────────────────────────

async function fetchDuplicateAttempts(): Promise<DuplicateAttempt[]> {
  const { data } = await axios.get(`${API_BASE_URL}/dna/duplicate-attempts?limit=200`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any).events ?? [];
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function DuplicateAttemptsPage() {
  const { data: attempts, loading, error, refetch } = useApi(fetchDuplicateAttempts);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  };

  const highRiskCount = (attempts ?? []).filter(a => a.riskLevel === 'HIGH').length;

  return (
    <div className="space-y-5 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Shield size={20} className="text-red-400" />
            Duplicate Upload Attempts
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            All blocked duplicate upload attempts — forensic audit trail
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!loading && attempts && (
            <>
              <Badge variant="danger">{attempts.length} total blocked</Badge>
              {highRiskCount > 0 && (
                <Badge variant="danger">⚠ {highRiskCount} HIGH RISK</Badge>
              )}
            </>
          )}
          <button onClick={refetch} disabled={loading} className="btn btn-secondary btn-sm">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Stats row */}
      {!loading && attempts && attempts.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Total Blocked',      value: attempts.length,                                          color: 'text-red-400' },
            { label: 'High Risk',          value: highRiskCount,                                             color: 'text-red-500' },
            { label: 'Exact Hash Matches', value: attempts.filter(a => a.matchType === 'EXACT_HASH').length, color: 'text-amber-400' },
            { label: 'Near Duplicates',    value: attempts.filter(a => a.matchType === 'NEAR_DUPLICATE_PHASH').length, color: 'text-yellow-400' },
          ].map(s => (
            <div key={s.label} className="card p-4 text-center">
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-gray-500 mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : error ? (
        <div className="card p-6 text-center">
          <AlertTriangle size={28} className="text-red-400 mx-auto mb-2" />
          <p className="text-red-400 text-sm">Failed to load duplicate attempts</p>
          <button onClick={refetch} className="btn btn-secondary btn-sm mt-3">Retry</button>
        </div>
      ) : !attempts || attempts.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="No Duplicate Attempts"
          description="No duplicate upload attempts have been detected. The registry is clean."
        />
      ) : (
        <div className="space-y-3">
          {attempts.map((a) => (
            <div key={a.id}
              className={`card border ${a.riskLevel === 'HIGH' ? 'border-red-500/40 bg-red-500/5' : 'border-bg-border'}`}
            >
              <div className="p-4">
                {/* Row 1: filename + risk + time */}
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <Shield size={15} className={a.riskLevel === 'HIGH' ? 'text-red-400 shrink-0' : 'text-amber-400 shrink-0'} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{a.filename ?? 'Unknown file'}</p>
                      <p className="text-2xs text-gray-500">{a.fileType ?? '—'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {a.riskLevel === 'HIGH' && (
                      <span className="text-xs bg-red-500/20 text-red-400 border border-red-500/30 rounded px-2 py-0.5 font-semibold">
                        HIGH RISK
                      </span>
                    )}
                    <span className={`text-xs rounded px-2 py-0.5 font-mono border ${
                      a.matchType === 'EXACT_HASH'
                        ? 'bg-red-500/10 text-red-400 border-red-500/20'
                        : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                    }`}>
                      {a.matchType === 'EXACT_HASH' ? '🔴 Exact Match' : '🟡 Near-Duplicate'}
                    </span>
                    <span className="text-2xs text-gray-500">
                      {format(new Date(a.timestamp), 'MMM d, HH:mm:ss')}
                    </span>
                  </div>
                </div>

                {/* Row 2: tags */}
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {a.ipAddress && (
                    <span className="tag">IP: {a.ipAddress}</span>
                  )}
                  {a.browser && <span className="tag">{a.browser}</span>}
                  {a.os      && <span className="tag">{a.os}</span>}
                  {a.device  && <span className="tag">{a.device}</span>}
                  {a.pHashSimilarity != null && (
                    <span className="tag">Similarity: {(a.pHashSimilarity * 100).toFixed(1)}%</span>
                  )}
                </div>

                {/* Row 3: existing record info */}
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                  {a.existingFilename && (
                    <div className="bg-bg-elevated rounded-lg px-3 py-2">
                      <p className="text-2xs text-gray-500 uppercase tracking-wide">Existing File in Registry</p>
                      <p className="text-xs text-white mono mt-0.5 truncate">{a.existingFilename}</p>
                    </div>
                  )}
                  {a.existingDnaRecordId && (
                    <div className="bg-bg-elevated rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-2xs text-gray-500 uppercase tracking-wide">Existing DNA Record ID</p>
                        <p className="text-xs text-dna-400 mono mt-0.5 truncate">{a.existingDnaRecordId}</p>
                      </div>
                      <button
                        onClick={() => copy(a.existingDnaRecordId!, a.id)}
                        className="shrink-0 p-1.5 rounded hover:bg-bg-border text-gray-500 hover:text-white transition-colors"
                        title="Copy DNA Record ID"
                      >
                        {copiedId === a.id ? <CheckCircle2 size={12} className="text-success" /> : <Copy size={12} />}
                      </button>
                    </div>
                  )}
                  {a.sha256Hash && (
                    <div className="bg-bg-elevated rounded-lg px-3 py-2 md:col-span-2">
                      <p className="text-2xs text-gray-500 uppercase tracking-wide">File SHA-256</p>
                      <p className="text-xs text-gray-400 mono mt-0.5 truncate">{a.sha256Hash}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
