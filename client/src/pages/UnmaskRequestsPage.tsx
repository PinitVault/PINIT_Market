/**
 * PINIT-DNA — Privacy Masking: Unmask Requests Dashboard
 * Route: /unmask-requests
 *
 * Owner view — approve or reject recipient requests to see full unmasked content.
 */

import { useState } from 'react';
import { format } from 'date-fns';
import { Shield, RefreshCw, CheckCircle2, XCircle, Clock, Eye, AlertTriangle } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { API_BASE_URL } from '../config/api.config';
import axios from 'axios';
import { SkeletonCard } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';

// ─── Types ────────────────────────────────────────────────────────────────────

interface UnmaskRequest {
  id:            string;
  createdAt:     string;
  reviewedAt:    string | null;
  shareToken:    string;
  recipientName: string | null;
  sessionId:     string | null;
  ipAddress:     string | null;
  device:        string | null;
  browser:       string | null;
  os:            string | null;
  status:        'PENDING' | 'APPROVED' | 'REJECTED';
  reviewNote:    string | null;
  shareLink:     { filename: string; token: string };
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

async function fetchRequests(): Promise<UnmaskRequest[]> {
  const { data } = await axios.get(`${API_BASE_URL}/share/unmask-requests`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any).requests ?? [];
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function UnmaskRequestsPage() {
  const { data: requests, loading, error, refetch } = useApi(fetchRequests);
  const [reviewing, setReviewing] = useState<string | null>(null);

  const review = async (id: string, action: 'approve' | 'reject') => {
    setReviewing(id);
    try {
      await axios.post(`${API_BASE_URL}/share/unmask-requests/${id}/review`, { action });
      refetch();
    } finally {
      setReviewing(null);
    }
  };

  const pending  = (requests ?? []).filter(r => r.status === 'PENDING');
  const reviewed = (requests ?? []).filter(r => r.status !== 'PENDING');

  const statusBadge = (s: string) => {
    if (s === 'PENDING')  return <span className="text-xs bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 rounded px-2 py-0.5">⏳ Pending</span>;
    if (s === 'APPROVED') return <span className="text-xs bg-green-500/15 text-green-400 border border-green-500/30 rounded px-2 py-0.5">✅ Approved</span>;
    return                       <span className="text-xs bg-red-500/15 text-red-400 border border-red-500/30 rounded px-2 py-0.5">❌ Rejected</span>;
  };

  return (
    <div className="space-y-5 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Shield size={20} className="text-purple-400" />
            Unmask Access Requests
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Recipients requesting to view full unmasked document content
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!loading && pending.length > 0 && (
            <span className="text-xs bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 rounded-full px-3 py-1 font-semibold animate-pulse">
              {pending.length} pending
            </span>
          )}
          <button onClick={refetch} disabled={loading} className="btn btn-secondary btn-sm">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}</div>
      ) : error ? (
        <div className="card p-6 text-center">
          <AlertTriangle size={28} className="text-red-400 mx-auto mb-2" />
          <p className="text-red-400 text-sm">Failed to load requests</p>
          <button onClick={refetch} className="btn btn-secondary btn-sm mt-3">Retry</button>
        </div>
      ) : !requests || requests.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="No Unmask Requests"
          description="No recipients have requested unmasked access yet." />
      ) : (
        <div className="space-y-6">

          {/* Pending requests */}
          {pending.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-yellow-400 mb-3 flex items-center gap-2">
                <Clock size={14} /> Pending Review ({pending.length})
              </h2>
              <div className="space-y-3">
                {pending.map(r => (
                  <div key={r.id} className="card border border-yellow-500/30 bg-yellow-500/5 p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-sm font-semibold text-white">
                          {r.recipientName ?? 'Anonymous Recipient'}
                        </p>
                        <p className="text-xs text-purple-400 mono mt-0.5">📄 {r.shareLink.filename}</p>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {r.ipAddress && <span className="tag">IP: {r.ipAddress}</span>}
                          {r.device    && <span className="tag">{r.device}</span>}
                          {r.browser   && <span className="tag">{r.browser}</span>}
                          {r.os        && <span className="tag">{r.os}</span>}
                          <span className="tag">🕐 {format(new Date(r.createdAt), 'MMM d, HH:mm')}</span>
                        </div>
                        <p className="text-2xs text-gray-500 mono mt-1">Session: {r.sessionId ?? '—'}</p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button
                          onClick={() => review(r.id, 'approve')}
                          disabled={reviewing === r.id}
                          className="btn btn-sm bg-green-500/20 border border-green-500/30 text-green-400 hover:bg-green-500/30"
                        >
                          {reviewing === r.id ? <div className="w-3 h-3 border border-green-400 border-t-transparent rounded-full animate-spin" /> : <CheckCircle2 size={13} />}
                          Approve
                        </button>
                        <button
                          onClick={() => review(r.id, 'reject')}
                          disabled={reviewing === r.id}
                          className="btn btn-sm bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30"
                        >
                          <XCircle size={13} /> Reject
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Reviewed requests */}
          {reviewed.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
                <Eye size={14} /> Review History ({reviewed.length})
              </h2>
              <div className="space-y-2">
                {reviewed.map(r => (
                  <div key={r.id} className="card p-3 flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-sm text-white">{r.recipientName ?? 'Anonymous'}</p>
                      <p className="text-xs text-gray-500">{r.shareLink.filename} · {format(new Date(r.createdAt), 'MMM d, HH:mm')}</p>
                    </div>
                    {statusBadge(r.status)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
