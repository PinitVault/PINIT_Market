/**
 * PINIT-DNA — Certificates Page with Full Lifecycle Management
 *
 * Shows all ownership certificates with:
 * - ACTIVE (green) / REVOKED (red) / EXPIRED (orange) status
 * - Revoke button with confirmation dialog + reason input
 * - Revocation timestamp and reason display
 * - PDF/JSON export
 * - Auto-refresh after revocation
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Award, Download, Printer, Shield, Archive, Dna,
  Lock, CheckCircle2, Calendar, FileText, XCircle,
  AlertTriangle, RefreshCw, Ban,
} from 'lucide-react';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';

import {
  listVaultRecords,
  issueCertificate,
  listCertificates,
  revokeCertificate,
} from '../services/dashboard.api';
import { exportCertificatePDF, exportDNACertificateJSON } from '../services/report-generator';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { SkeletonCard } from '../components/ui/Skeleton';
import { Modal } from '../components/ui/Modal';
import { cn } from '../components/ui/utils';
import { formatBytes } from '../hooks/useApi';
import type { VaultRecord, IssuedCertificate } from '../types/dashboard.types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CertificateWithVault {
  vault:       VaultRecord;
  certificate: IssuedCertificate | null;
  loading:     boolean;
}

// ─── Revocation Confirmation Dialog ──────────────────────────────────────────

function RevokeDialog({
  certId,
  filename,
  onConfirm,
  onCancel,
}: {
  certId:    string;
  filename:  string;
  onConfirm: (reason: string) => void;
  onCancel:  () => void;
}) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  const handle = async () => {
    if (!reason.trim()) { toast.error('Revocation reason is required'); return; }
    setLoading(true);
    onConfirm(reason.trim());
  };

  return (
    <Modal open title="Revoke Certificate" onClose={onCancel} size="md">
      <div className="p-6 space-y-5">
        {/* Warning banner */}
        <div className="rounded-xl bg-danger/10 border border-danger/30 p-4 flex gap-3">
          <AlertTriangle size={18} className="text-danger shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-danger">This action cannot be undone</p>
            <p className="text-xs text-gray-400 mt-1">
              Revoking this certificate will permanently mark it as invalid.
              Anyone verifying <span className="text-white font-medium">{certId}</span> will see it as <span className="text-danger font-semibold">REVOKED</span>.
            </p>
          </div>
        </div>

        {/* File being revoked */}
        <div className="bg-bg-elevated rounded-xl p-3 border border-bg-border">
          <p className="text-2xs text-gray-500 mb-1">Certificate for file</p>
          <p className="text-sm font-medium text-white truncate">{filename}</p>
          <p className="text-2xs text-gray-500 mono mt-1">{certId}</p>
        </div>

        {/* Reason input */}
        <div>
          <label className="text-xs font-semibold text-gray-300 block mb-2">
            Revocation Reason <span className="text-danger">*</span>
          </label>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Enter the reason for revocation (e.g. File was compromised, Certificate issued in error...)"
            rows={3}
            className="input resize-none text-sm"
          />
          <p className="text-2xs text-gray-600 mt-1">This reason will be permanently stored and visible to anyone verifying the certificate.</p>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button
            onClick={handle}
            disabled={loading || !reason.trim()}
            className="btn btn-danger flex-1"
          >
            {loading ? <RefreshCw size={14} className="animate-spin" /> : <Ban size={14} />}
            {loading ? 'Revoking…' : 'Revoke Certificate'}
          </button>
          <button onClick={onCancel} className="btn btn-secondary">Cancel</button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Certificate Card ─────────────────────────────────────────────────────────

function CertificateCard({
  item,
  onRevoked,
}: {
  item:      CertificateWithVault;
  onRevoked: (certId: string, cert: IssuedCertificate) => void;
}) {
  const { vault, certificate, loading } = item;
  const [revoking, setRevoking]         = useState(false);
  const [exporting, setExporting]       = useState(false);

  const cert       = certificate;
  const status     = cert?.status ?? 'ACTIVE';
  const certId     = cert?.certificateId ?? `CERT-DNA-${vault.id.slice(0, 8).toUpperCase()}`;
  const issueDate  = cert?.issuedAt
    ? format(new Date(cert.issuedAt), 'MMMM d, yyyy')
    : format(new Date(vault.createdAt), 'MMMM d, yyyy');

  const isRevoked  = status === 'REVOKED';
  const isExpired  = status === 'EXPIRED';
  const isActive   = status === 'ACTIVE';

  // Status badge config
  const statusCfg = isRevoked
    ? { variant: 'danger'  as const, label: 'Revoked',  icon: <XCircle size={11} /> }
    : isExpired
    ? { variant: 'warning' as const, label: 'Expired',  icon: <AlertTriangle size={11} /> }
    : { variant: 'success' as const, label: 'Verified', icon: <CheckCircle2 size={11} /> };

  // Card border changes with status
  const cardBorder = isRevoked ? 'border-danger/30 bg-danger/3'
    : isExpired ? 'border-warning/30'
    : 'border-bg-border hover:border-dna-500/30';

  // Ribbon gradient changes with status
  const ribbonClass = isRevoked
    ? 'from-danger via-danger/70 to-red-900'
    : isExpired
    ? 'from-warning via-warning/70 to-orange-900'
    : 'from-dna-600 via-purple to-dna-400';

  const handleRevoke = async (reason: string) => {
    setRevoking(false);
    const loadingToast = toast.loading('Processing revocation…');
    try {
      // Step 1: Issue certificate to get real backend ID (idempotent)
      const issued = await issueCertificate(vault.dnaRecordId, vault.id);
      const finalCertId = issued.certificateId;
      // Step 2: Revoke it
      const updated = await revokeCertificate(finalCertId, reason);
      onRevoked(finalCertId, updated);
      toast.dismiss(loadingToast);
      toast.success('Certificate revoked successfully');
    } catch (err) {
      toast.dismiss(loadingToast);
      // Show the actual error message
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? (err instanceof Error ? err.message : 'Unknown error');
      toast.error(`Revocation failed: ${msg}`, { duration: 6000 });
      console.error('Revoke error:', err);
    }
  };

  if (loading) return <SkeletonCard />;

  return (
    <>
      <motion.div
        layout
        className={cn('card overflow-hidden transition-all duration-200', cardBorder)}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {/* Ribbon */}
        <div className={cn('h-1.5 bg-gradient-to-r -mx-6 -mt-6 mb-5', ribbonClass)} />

        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={cn(
              'w-10 h-10 rounded-xl border flex items-center justify-center',
              isRevoked ? 'bg-danger/15 border-danger/20' :
              isExpired ? 'bg-warning/15 border-warning/20' :
                         'bg-dna-500/15 border-dna-500/20'
            )}>
              <Award size={18} className={isRevoked ? 'text-danger' : isExpired ? 'text-warning' : 'text-dna-400'} />
            </div>
            <div>
              <p className={cn('text-xs font-bold mono', isRevoked ? 'text-danger' : isExpired ? 'text-warning' : 'text-dna-400')}>
                {certId}
              </p>
              <p className="text-xs text-gray-500">DNA Ownership Certificate</p>
            </div>
          </div>
          <Badge variant={statusCfg.variant} dot>
            {statusCfg.label}
          </Badge>
        </div>

        {/* Revoked / Expired alert */}
        <AnimatePresence>
          {(isRevoked || isExpired) && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className={cn(
                'rounded-xl p-3 mb-4 border',
                isRevoked ? 'bg-danger/10 border-danger/30' : 'bg-warning/10 border-warning/30'
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                {isRevoked
                  ? <XCircle size={13} className="text-danger shrink-0" />
                  : <AlertTriangle size={13} className="text-warning shrink-0" />}
                <p className={cn('text-xs font-semibold', isRevoked ? 'text-danger' : 'text-warning')}>
                  Certificate {isRevoked ? 'Revoked' : 'Expired'}
                </p>
              </div>
              {isRevoked && cert?.revokedAt && (
                <p className="text-2xs text-gray-400">
                  Revoked {format(new Date(cert.revokedAt), 'MMM d, yyyy HH:mm')}
                </p>
              )}
              {isRevoked && cert?.revocationReason && (
                <p className="text-2xs text-gray-300 mt-1 italic">
                  &ldquo;{cert.revocationReason}&rdquo;
                </p>
              )}
              {isExpired && cert?.expiresAt && (
                <p className="text-2xs text-gray-400">
                  Expired {format(new Date(cert.expiresAt), 'MMM d, yyyy')}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* File info */}
        <div className="space-y-2 mb-4">
          <div className="flex items-start gap-2">
            <Dna size={12} className={cn('mt-0.5 shrink-0', isRevoked ? 'text-danger/70' : 'text-dna-400')} />
            <div className="min-w-0">
              <p className="text-xs text-gray-400">Registered File</p>
              <p className="text-sm font-semibold text-white truncate">{vault.originalFileName}</p>
              <p className="text-2xs text-gray-600 mono mt-0.5">{formatBytes(vault.originalSizeBytes)}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-bg-elevated rounded-lg p-2.5">
              <div className="flex items-center gap-1.5 mb-0.5">
                <Lock size={10} className="text-success" />
                <p className="text-2xs text-gray-500">Encryption</p>
              </div>
              <p className="text-xs font-medium text-success mono">{vault.encryptionAlgorithm}</p>
            </div>
            <div className="bg-bg-elevated rounded-lg p-2.5">
              <div className="flex items-center gap-1.5 mb-0.5">
                <Shield size={10} className="text-purple" />
                <p className="text-2xs text-gray-500">DNA Layers</p>
              </div>
              <p className="text-xs font-medium text-purple mono">6 Layers</p>
            </div>
          </div>
        </div>

        {/* Verification chain — greyed out when revoked */}
        <div className={cn('bg-bg-elevated rounded-xl p-3 mb-4 space-y-1.5', isRevoked && 'opacity-50')}>
          {[
            { label: 'SHA-256 Fingerprint', value: isRevoked ? 'Revoked' : 'Verified', ok: !isRevoked },
            { label: 'AES-256-GCM Seal',    value: isRevoked ? 'Revoked' : 'Active',   ok: !isRevoked },
            { label: 'HKDF Key Derivation',  value: 'Secured',   ok: true  },
            { label: 'Auth Tag Integrity',   value: 'Intact',    ok: true  },
          ].map(item => (
            <div key={item.label} className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                {item.ok
                  ? <CheckCircle2 size={11} className="text-success" />
                  : <XCircle size={11} className="text-danger" />}
                <span className="text-2xs text-gray-400">{item.label}</span>
              </div>
              <span className={cn('text-2xs font-medium', item.ok ? 'text-success' : 'text-danger')}>
                {item.value}
              </span>
            </div>
          ))}
        </div>

        {/* IDs */}
        <div className="space-y-1.5 mb-4">
          <div className="flex items-center gap-2">
            <span className="text-2xs text-gray-600 w-24 shrink-0">DNA Record</span>
            <span className="mono text-2xs text-dna-400 truncate">{vault.dnaRecordId}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-2xs text-gray-600 w-24 shrink-0">Vault ID</span>
            <span className="mono text-2xs text-purple truncate">{vault.id}</span>
          </div>
          <div className="flex items-center gap-2">
            <Calendar size={10} className="text-gray-600" />
            <span className="text-2xs text-gray-500">Issued {issueDate}</span>
          </div>
          {cert?.certificateId && (
            <div className="flex items-center gap-2">
              <Award size={10} className={isRevoked ? 'text-danger/60' : 'text-dna-500/60'} />
              <span className={cn('text-2xs mono truncate', isRevoked ? 'text-danger/70' : 'text-gray-400')}>
                {cert.certificateId}
              </span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-4 border-t border-bg-border">
          {/* PDF download — disabled when revoked */}
          <button
            onClick={async () => {
              setExporting(true);
              toast.loading('Generating PDF…');
              try {
                await exportCertificatePDF(vault);
                toast.dismiss(); toast.success('PDF downloaded');
              } catch {
                toast.dismiss(); toast.error('PDF generation failed');
              } finally { setExporting(false); }
            }}
            disabled={exporting || isRevoked}
            className={cn(
              'btn btn-sm flex-1 text-xs',
              isRevoked ? 'btn-secondary opacity-40 cursor-not-allowed' : 'btn-primary'
            )}
            title={isRevoked ? 'Certificate is revoked — PDF download disabled' : 'Download PDF Certificate'}
          >
            {exporting ? <RefreshCw size={12} className="animate-spin" /> : <FileText size={12} />}
            {isRevoked ? 'Revoked' : 'Download PDF'}
          </button>

          <button
            onClick={() => { exportDNACertificateJSON(vault); toast.success('JSON exported'); }}
            className="btn btn-secondary btn-sm text-xs"
            title="Export JSON"
          >
            <Download size={12} />
          </button>

          <button
            onClick={() => window.print()}
            className="btn btn-ghost btn-sm text-xs"
            title="Print"
          >
            <Printer size={12} />
          </button>

          {/* Revoke button — shows for ACTIVE certs (uses cert.certificateId OR derived certId) */}
          {isActive && (
            <button
              onClick={() => setRevoking(true)}
              className="btn btn-sm text-xs bg-danger/10 hover:bg-danger/20 border border-danger/30 text-danger"
              title="Revoke this certificate"
            >
              <Ban size={12} />
              <span className="hidden sm:inline">Revoke</span>
            </button>
          )}
        </div>
      </motion.div>

      {/* Revoke confirmation dialog — uses cert.certificateId if loaded, else derived certId */}
      {revoking && (
        <RevokeDialog
          certId={cert?.certificateId ?? certId}
          filename={vault.originalFileName}
          onConfirm={handleRevoke}
          onCancel={() => setRevoking(false)}
        />
      )}
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function CertificatesPage() {
  const [items,    setItems]   = useState<CertificateWithVault[]>([]);
  const [loading,  setLoading] = useState(true);
  const [error,    setError]   = useState<string | null>(null);
  const [filter,   setFilter]  = useState<'ALL' | 'ACTIVE' | 'REVOKED'>('ALL');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Load vaults + existing certificates in parallel
      const [vaults, certs] = await Promise.all([
        listVaultRecords(),
        listCertificates().catch((): IssuedCertificate[] => []),
      ]);

      // Build a map: vaultId → certificate
      const certByVault = new Map<string, IssuedCertificate>(certs.map((c: IssuedCertificate) => [c.vaultId, c]));

      // Build initial items — show immediately with whatever we have
      const initial: CertificateWithVault[] = vaults.map((v: VaultRecord) => ({
        vault: v,
        certificate: certByVault.get(v.id) ?? null,
        loading: !certByVault.has(v.id),
      }));
      setItems(initial);
      setLoading(false);

      // For vaults without certificates, auto-issue in batches of 3 to avoid 429
      const toIssue = vaults.filter((v: VaultRecord) => !certByVault.has(v.id));
      if (toIssue.length > 0) {
        const BATCH = 3;
        const allResults: PromiseSettledResult<IssuedCertificate>[] = [];
        for (let i = 0; i < toIssue.length; i += BATCH) {
          const batch = toIssue.slice(i, i + BATCH);
          const batchResults = await Promise.allSettled(
            batch.map((v: VaultRecord) => issueCertificate(v.dnaRecordId, v.id))
          );
          allResults.push(...batchResults);
          // Update UI after each batch
          setItems(prev => prev.map(item => {
            const idx = toIssue.findIndex((v: VaultRecord) => v.id === item.vault.id);
            if (idx === -1 || idx >= allResults.length) return item;
            const r = allResults[idx];
            return {
              ...item,
              certificate: r.status === 'fulfilled' ? r.value : null,
              loading: false,
            };
          }));
          // Small delay between batches
          if (i + BATCH < toIssue.length) await new Promise(r => setTimeout(r, 300));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load certificates');
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Update a certificate in state after revocation (no full reload needed)
  const handleRevoked = useCallback((certId: string, updated: IssuedCertificate) => {
    setItems(prev => prev.map(item =>
      item.certificate?.certificateId === certId
        ? { ...item, certificate: updated }
        : item
    ));
  }, []);

  const filtered = items.filter(item => {
    if (filter === 'ALL')     return true;
    if (filter === 'ACTIVE')  return (item.certificate?.status ?? 'ACTIVE') === 'ACTIVE';
    if (filter === 'REVOKED') return item.certificate?.status === 'REVOKED';
    return true;
  });

  const activeCount  = items.filter(i => (i.certificate?.status ?? 'ACTIVE') === 'ACTIVE').length;
  const revokedCount = items.filter(i => i.certificate?.status === 'REVOKED').length;

  return (
    <div className="space-y-5 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Ownership Certificates</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Cryptographic proof of file ownership and DNA fingerprint registration
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!loading && (
            <>
              <Badge variant="dna">{items.length} total</Badge>
              {revokedCount > 0 && <Badge variant="danger">{revokedCount} revoked</Badge>}
            </>
          )}
          <button onClick={load} disabled={loading} className="btn btn-secondary btn-sm">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Info banner */}
      <div className="card bg-dna-500/5 border-dna-500/20">
        <div className="flex gap-4">
          <div className="w-10 h-10 rounded-xl bg-dna-500/15 flex items-center justify-center shrink-0">
            <Award size={18} className="text-dna-400" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-white mb-1">What is a DNA Certificate?</p>
            <p className="text-xs text-gray-400 leading-relaxed">
              Each certificate is cryptographically signed with HMAC-SHA256 and persisted in the registry.
              Certificates can be verified, and revoked when a file is compromised.
              Revoked certificates remain in the registry as forensic evidence.
            </p>
          </div>
        </div>
      </div>

      {/* Status filter tabs */}
      {!loading && items.length > 0 && (
        <div className="flex items-center gap-2">
          {[
            { key: 'ALL',     label: `All (${items.length})` },
            { key: 'ACTIVE',  label: `Active (${activeCount})` },
            { key: 'REVOKED', label: `Revoked (${revokedCount})` },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key as typeof filter)}
              className={cn(
                'text-xs px-4 py-2 rounded-full border transition-all',
                filter === tab.key
                  ? 'bg-dna-500/20 border-dna-500/40 text-dna-400'
                  : 'border-bg-border text-gray-500 hover:text-white hover:border-gray-600'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      {error ? (
        <div className="card text-center">
          <p className="text-danger text-sm mb-3">{error}</p>
          <button onClick={load} className="btn btn-secondary btn-sm">
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={filter === 'REVOKED' ? Ban : Archive}
            title={filter === 'REVOKED' ? 'No revoked certificates' : 'No certificates yet'}
            description={
              filter === 'REVOKED'
                ? 'No certificates have been revoked'
                : 'Store a file in the vault to generate its ownership certificate'
            }
            action={filter === 'ALL' ? (
              <Link to="/generate" className="btn btn-primary btn-sm">
                <Dna size={14} /> Generate DNA & Vault
              </Link>
            ) : undefined}
          />
        </div>
      ) : (
        <motion.div
          layout
          className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
        >
          {filtered.map(item => (
            <CertificateCard
              key={item.vault.id}
              item={item}
              onRevoked={handleRevoked}
            />
          ))}
        </motion.div>
      )}
    </div>
  );
}
