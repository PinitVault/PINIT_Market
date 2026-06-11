import { useState, useEffect } from 'react';
import { Archive, Search, Lock, RefreshCw, Download, Eye, ExternalLink, Share2, Copy, Check, Clock, Ban } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import axios from 'axios';
import { useApi, formatBytes } from '../hooks/useApi';
import { listVaultRecords, retrieveFromVault } from '../services/dashboard.api';
import { SkeletonTable } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { API_BASE_URL } from '../config/api.config';
import type { VaultRecord } from '../types/dashboard.types';

function VaultDetailModal({ record, onClose }: { record: VaultRecord; onClose: () => void }) {
  const [retrieving, setRetrieving] = useState(false);

  const handleRetrieve = async () => {
    setRetrieving(true);
    try {
      const blob = await retrieveFromVault(record.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = record.originalFileName;
      a.click(); URL.revokeObjectURL(url);
      toast.success('File retrieved and decrypted successfully');
    } catch {
      toast.error('Failed to retrieve file from vault');
    } finally {
      setRetrieving(false);
    }
  };

  return (
    <Modal open title="Vault Record Details" onClose={onClose} size="lg">
      <div className="p-6 space-y-4">
        {/* File info */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Vault ID',            value: record.id,                     mono: true,  accent: true  },
            { label: 'DNA Record ID',        value: record.dnaRecordId,            mono: true,  accent: true  },
            { label: 'Original File',        value: record.originalFileName,       mono: false, accent: false },
            { label: 'MIME Type',            value: record.originalMimeType,       mono: true,  accent: false },
            { label: 'Original Size',        value: formatBytes(record.originalSizeBytes), mono: true, accent: false },
            { label: 'Encrypted Size',       value: formatBytes(record.encryptedSizeBytes), mono: true, accent: false },
            { label: 'Encryption',           value: record.encryptionAlgorithm,    mono: true,  accent: false },
            { label: 'Key Derivation',       value: record.keyDerivation,          mono: true,  accent: false },
            { label: 'Stored At',            value: format(new Date(record.createdAt), 'PPpp'), mono: false, accent: false },
          ].map(row => (
            <div key={row.label} className="bg-bg-elevated rounded-lg p-3">
              <p className="text-2xs text-gray-500 mono mb-1">{row.label}</p>
              <p className={`text-xs break-all ${row.mono ? 'mono' : ''} ${row.accent ? 'text-dna-400' : 'text-gray-200'}`}>
                {row.value}
              </p>
            </div>
          ))}
        </div>

        {/* Security info */}
        <div className="rounded-xl bg-success/5 border border-success/20 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Lock size={14} className="text-success" />
            <p className="text-xs font-semibold text-success">Encryption Details</p>
          </div>
          <p className="text-2xs text-gray-400">
            File is encrypted with AES-256-GCM. The encryption key is NEVER stored —
            it is re-derived on demand from the Vault ID using HKDF-SHA256.
            The authentication tag ensures tamper detection during decryption.
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            onClick={handleRetrieve}
            disabled={retrieving}
            className="btn btn-primary flex-1"
          >
            {retrieving ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
            {retrieving ? 'Decrypting…' : 'Retrieve & Decrypt'}
          </button>
          <button onClick={onClose} className="btn btn-secondary">
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Share Modal ─────────────────────────────────────────────────────────────

interface ShareCreated {
  shareUrl: string;
  token: string;
  devOtp?: string;
  devOtpNote?: string;
}

function ShareModal({ record, onClose }: { record: VaultRecord; onClose: () => void }) {
  const [expiresIn, setExpiresIn]       = useState<string>('168');  // 7 days
  const [maxViews, setMaxViews]         = useState<string>('');
  const [allowDownload, setAllowDownload] = useState(false);
  const [requireName, setRequireName]   = useState(false);
  const [note, setNote]                 = useState('');
  const [creating, setCreating]         = useState(false);
  const [created, setCreated]           = useState<ShareCreated | null>(null);
  const [copied, setCopied]             = useState(false);

  // ── Advanced policy controls (Smart Links audit additions) ────────────────
  const [showAdvanced, setShowAdvanced]   = useState(true);
  const [oneTimeUse, setOneTimeUse]       = useState(false);
  const [maxDownloads, setMaxDownloads]   = useState<string>('');
  const [allowedCountries, setAllowedCountries]     = useState<string>('');
  const [allowedDeviceTypes, setAllowedDeviceTypes] = useState<string>('');
  const [allowedIpPrefixes, setAllowedIpPrefixes]   = useState<string>('');
  const [requireOtp, setRequireOtp]       = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');

  // ── Privacy Masking controls ───────────────────────────────────────────────
  const [privacyMaskingEnabled, setPrivacyMaskingEnabled] = useState(false);
  const [maskEmail,   setMaskEmail]   = useState(false);
  const [maskPhone,   setMaskPhone]   = useState(false);
  const [maskAadhaar, setMaskAadhaar] = useState(false);
  const [maskPan,     setMaskPan]     = useState(false);
  const [maskAddress, setMaskAddress] = useState(false);
  // Auto-detection state
  const [scanning,       setScanning]      = useState(false);
  const [scanDone,       setScanDone]      = useState(false);
  const [scanSupported,  setScanSupported] = useState(true);
  const [scanMsg,        setScanMsg]       = useState('');
  const [detected, setDetected] = useState({ email: false, phone: false, aadhaar: false, pan: false, address: false });

  // ── GPS Location Request ───────────────────────────────────────────────────
  const [requestLocation, setRequestLocation] = useState(false);

  // ── Manage existing links — list + revoke (Smart Links audit: link revocation UI) ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [existingLinks, setExistingLinks] = useState<any[]>([]);
  const [loadingLinks, setLoadingLinks]   = useState(true);
  const [revokingToken, setRevokingToken] = useState<string | null>(null);

  const fetchLinks = async () => {
    setLoadingLinks(true);
    try {
      const { data } = await axios.get(`${API_BASE_URL}/share/vault/${record.id}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setExistingLinks((data as any).links ?? []);
    } catch (err) {
      console.error('[ShareModal] fetchLinks failed:', err);
      setExistingLinks([]);
    }
    finally { setLoadingLinks(false); }
  };

  useEffect(() => { fetchLinks(); }, [record.id]);

  const handleRevoke = async (token: string) => {
    setRevokingToken(token);
    try {
      await axios.delete(`${API_BASE_URL}/share/${token}`);
      toast.success('Link revoked — it will no longer grant access');
      await fetchLinks();
    } catch {
      toast.error('Failed to revoke link');
    } finally { setRevokingToken(null); }
  };

  // Country name → ISO code lookup for common countries
  const COUNTRY_ISO: Record<string, string> = {
    'india': 'IN', 'united states': 'US', 'usa': 'US', 'america': 'US',
    'united kingdom': 'GB', 'uk': 'GB', 'england': 'GB',
    'australia': 'AU', 'canada': 'CA', 'germany': 'DE', 'france': 'FR',
    'japan': 'JP', 'china': 'CN', 'singapore': 'SG', 'uae': 'AE',
    'united arab emirates': 'AE', 'russia': 'RU', 'brazil': 'BR',
    'south africa': 'ZA', 'italy': 'IT', 'spain': 'ES', 'netherlands': 'NL',
    'new zealand': 'NZ', 'pakistan': 'PK', 'bangladesh': 'BD', 'sri lanka': 'LK',
  };
  // Country list: converts full names to ISO codes (e.g. "India" → "IN")
  const splitCountryList = (v: string) => v.split(',').map(s => {
    const trimmed = s.trim();
    if (!trimmed) return '';
    if (/^[A-Z]{2,3}$/.test(trimmed)) return trimmed;
    const iso = COUNTRY_ISO[trimmed.toLowerCase()];
    return iso ?? trimmed.toUpperCase().slice(0, 2);
  }).filter(Boolean);

  // Device/IP list: simple split + lowercase (no ISO conversion)
  const splitSimpleList = (v: string) => v.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const { data } = await axios.post(`${API_BASE_URL}/share`, {
        vaultId:      record.id,
        expiresIn:    expiresIn ? Number(expiresIn) : null,
        maxViews:     maxViews  ? Number(maxViews)  : null,
        allowDownload,
        requireName,
        note: note.trim() || undefined,
        oneTimeUse,
        maxDownloads:       maxDownloads ? Number(maxDownloads) : null,
        allowedCountries:   splitCountryList(allowedCountries),
        allowedDeviceTypes: splitSimpleList(allowedDeviceTypes),
        allowedIpPrefixes:  splitSimpleList(allowedIpPrefixes),
        requireOtp,
        recipientEmail: recipientEmail.trim() || undefined,
        privacyMaskingEnabled,
        maskEmail:   privacyMaskingEnabled && maskEmail,
        maskPhone:   privacyMaskingEnabled && maskPhone,
        maskAadhaar: privacyMaskingEnabled && maskAadhaar,
        maskPan:     privacyMaskingEnabled && maskPan,
        maskAddress: privacyMaskingEnabled && maskAddress,
        requestLocation,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = data as any;
      setCreated({ shareUrl: d.shareUrl, token: d.token, devOtp: d.devOtp, devOtpNote: d.devOtpNote });
      toast.success('Share link created!');
      fetchLinks();
    } catch {
      toast.error('Failed to create share link');
    } finally { setCreating(false); }
  };

  const handleCopy = async () => {
    if (!created) return;
    await navigator.clipboard.writeText(created.shareUrl);
    setCopied(true);
    // Track copy event
    axios.post(`${API_BASE_URL}/share/${created.token}/access`, { action: 'COPIED' }).catch(() => {});
    setTimeout(() => setCopied(false), 2000);
    toast.success('Link copied to clipboard!');
  };

  return (
    <Modal open title="Generate Smart Share Link" onClose={onClose} size="md">
      <div className="p-5 space-y-4">
        {/* File info */}
        <div className="flex items-center gap-3 p-3 bg-bg-elevated rounded-xl border border-bg-border">
          <div className="w-8 h-8 bg-success/15 rounded-lg flex items-center justify-center shrink-0">
            <Lock size={14} className="text-success" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate">{record.originalFileName}</p>
            <p className="text-2xs text-gray-500">{formatBytes(record.originalSizeBytes)} · AES-256-GCM</p>
          </div>
          <Badge variant="success">Encrypted</Badge>
        </div>

        {/* Active links — manage / revoke (Smart Links audit: link revocation UI) */}
        {!created && (
          <div className="border border-bg-border rounded-xl overflow-hidden">
            <div className="px-3 py-2 bg-bg-elevated text-xs font-semibold text-gray-300 flex items-center justify-between">
              <span>Share Links for this File ({existingLinks.filter(l => l.isActive).length} active)</span>
              {loadingLinks && <RefreshCw size={11} className="animate-spin text-gray-500" />}
            </div>
            <div className="divide-y divide-bg-border max-h-44 overflow-y-auto">
              {!loadingLinks && existingLinks.length === 0 && (
                <p className="text-xs text-gray-500 px-3 py-3 text-center">No links created yet for this file</p>
              )}
              {existingLinks.map(link => (
                <div key={link.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs text-dna-400 mono truncate">{link.token}</p>
                    <p className="text-2xs text-gray-500">
                      {link.isActive ? 'Active' : 'Revoked'}
                      {typeof link.viewCount === 'number' ? ` · ${link.viewCount} views` : ''}
                      {link.expiresAt ? ` · expires ${new Date(link.expiresAt).toLocaleDateString()}` : ' · no expiry'}
                    </p>
                  </div>
                  {link.isActive ? (
                    <button
                      onClick={() => handleRevoke(link.token)}
                      disabled={revokingToken === link.token}
                      className="btn btn-secondary btn-sm text-2xs shrink-0 text-danger hover:bg-danger/10"
                    >
                      {revokingToken === link.token
                        ? <div className="w-3 h-3 border-2 border-danger border-t-transparent rounded-full animate-spin" />
                        : <Ban size={11} />}
                      Revoke
                    </button>
                  ) : (
                    <Badge variant="danger">Revoked</Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {!created ? (
          <>
            {/* Expiry */}
            <div>
              <label className="text-xs font-semibold text-gray-300 block mb-2">Link Expires After</label>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: '1 Hour',   value: '1'    },
                  { label: '24 Hours', value: '24'   },
                  { label: '7 Days',   value: '168'  },
                  { label: '30 Days',  value: '720'  },
                  { label: 'Never',    value: ''     },
                ].map(opt => (
                  <button key={opt.label}
                    onClick={() => setExpiresIn(opt.value)}
                    className={`text-xs py-2 rounded-lg border transition-all ${
                      expiresIn === opt.value
                        ? 'bg-dna-500/20 border-dna-500/40 text-dna-400'
                        : 'border-bg-border text-gray-500 hover:text-white'
                    }`}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Max views */}
            <div>
              <label className="text-xs font-semibold text-gray-300 block mb-1.5">
                Max Views <span className="text-gray-500 font-normal">(leave empty for unlimited)</span>
              </label>
              <input type="number" min="1" value={maxViews}
                onChange={e => setMaxViews(e.target.value)}
                placeholder="e.g. 5"
                className="input text-sm w-full"
              />
            </div>

            {/* Toggles */}
            <div className="space-y-2">
              {[
                { label: 'Allow Download',       desc: 'Recipient can download the file',           value: allowDownload, set: setAllowDownload },
                { label: 'Require Name',         desc: 'Recipient must enter their name to access', value: requireName,   set: setRequireName   },
              ].map(opt => (
                <div key={opt.label} className="flex items-center justify-between p-3 bg-bg-elevated rounded-xl border border-bg-border">
                  <div>
                    <p className="text-xs font-semibold text-white">{opt.label}</p>
                    <p className="text-2xs text-gray-500">{opt.desc}</p>
                  </div>
                  <button onClick={() => opt.set(!opt.value)}
                    className={`w-10 h-5 rounded-full transition-all relative ${opt.value ? 'bg-dna-500' : 'bg-bg-border'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${opt.value ? 'left-5' : 'left-0.5'}`} />
                  </button>
                </div>
              ))}
            </div>

            {/* Advanced policy controls */}
            <div className="border border-bg-border rounded-xl overflow-hidden">
              <button type="button" onClick={() => setShowAdvanced(v => !v)}
                className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-semibold text-gray-300 hover:text-white bg-bg-elevated">
                <span>Advanced Access Policies</span>
                <span className="text-gray-500">{showAdvanced ? '−' : '+'}</span>
              </button>
              {showAdvanced && (
                <div className="p-3 space-y-3 bg-bg-card">
                  {/* One-time use / max downloads */}
                  <div className="space-y-2">
                    {[
                      { label: 'One-Time Use',  desc: 'Link self-revokes after the first successful access', value: oneTimeUse, set: setOneTimeUse },
                      { label: 'Require Identity Verification (OTP)', desc: 'Recipient must enter a 6-digit code before viewing', value: requireOtp, set: setRequireOtp },
                    ].map(opt => (
                      <div key={opt.label} className="flex items-center justify-between p-3 bg-bg-elevated rounded-xl border border-bg-border">
                        <div>
                          <p className="text-xs font-semibold text-white">{opt.label}</p>
                          <p className="text-2xs text-gray-500">{opt.desc}</p>
                        </div>
                        <button onClick={() => opt.set(!opt.value)}
                          className={`w-10 h-5 rounded-full transition-all relative ${opt.value ? 'bg-dna-500' : 'bg-bg-border'}`}>
                          <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${opt.value ? 'left-5' : 'left-0.5'}`} />
                        </button>
                      </div>
                    ))}
                  </div>

                  {requireOtp && (
                    <div className="p-3 bg-dna-500/5 border border-dna-500/20 rounded-xl">
                      <p className="text-xs font-semibold text-dna-400 mb-1">ℹ️ How OTP works here</p>
                      <p className="text-2xs text-gray-400 leading-relaxed">
                        After you click <strong>"Generate Smart Link"</strong>, a 6-digit verification code will appear <strong>right here in the app</strong>. Share that code with your recipient manually (WhatsApp / Email / message). The recipient must enter it before they can view the file.
                      </p>
                      <label className="text-xs font-semibold text-gray-300 block mt-3 mb-1.5">
                        Recipient Email <span className="text-gray-500 font-normal">(optional — for your own records)</span>
                      </label>
                      <input type="email" value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)}
                        placeholder="recipient@example.com" className="input text-sm w-full" />
                    </div>
                  )}

                  <div>
                    <label className="text-xs font-semibold text-gray-300 block mb-1.5">
                      Max Downloads <span className="text-gray-500 font-normal">(leave empty for unlimited)</span>
                    </label>
                    <input type="number" min="1" value={maxDownloads}
                      onChange={e => setMaxDownloads(e.target.value)}
                      placeholder="e.g. 3" className="input text-sm w-full" />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-gray-300 block mb-1.5">
                      Allowed Countries <span className="text-gray-500 font-normal">(e.g. India, US, UK — empty = any country allowed)</span>
                    </label>
                    <input type="text" value={allowedCountries} onChange={e => setAllowedCountries(e.target.value)}
                      placeholder="India, US, UK" className="input text-sm w-full" />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-gray-300 block mb-1.5">
                      Allowed Device Types <span className="text-gray-500 font-normal">(comma-separated: desktop, mobile, tablet)</span>
                    </label>
                    <input type="text" value={allowedDeviceTypes} onChange={e => setAllowedDeviceTypes(e.target.value)}
                      placeholder="desktop, mobile" className="input text-sm w-full" />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-gray-300 block mb-1.5">
                      Allowed IP Prefixes <span className="text-gray-500 font-normal">(comma-separated, e.g. 10.0., 192.168.)</span>
                    </label>
                    <input type="text" value={allowedIpPrefixes} onChange={e => setAllowedIpPrefixes(e.target.value)}
                      placeholder="10.0., 192.168." className="input text-sm w-full" />
                  </div>
                </div>
              )}
            </div>

            {/* Note */}
            <div>
              <label className="text-xs font-semibold text-gray-300 block mb-1.5">
                Note to Recipient <span className="text-gray-500 font-normal">(optional)</span>
              </label>
              <textarea value={note} onChange={e => setNote(e.target.value)}
                placeholder="Please review this document carefully…"
                rows={2} className="input w-full text-sm resize-none"
              />
            </div>

            {/* ── Privacy Masking ───────────────────────────────────────── */}
            <div className="border border-bg-border rounded-xl overflow-hidden">
              <button type="button"
                onClick={async () => {
                  const next = !privacyMaskingEnabled;
                  setPrivacyMaskingEnabled(next);
                  if (next && !scanDone) {
                    // Auto-scan the file for sensitive data
                    setScanning(true);
                    setScanMsg('');
                    try {
                      const { data } = await axios.post(`${API_BASE_URL}/vault/${record.id}/scan-sensitive`);
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      const d = data as any;
                      setScanSupported(d.supported !== false);
                      if (d.supported === false) {
                        setScanMsg(d.reason ?? 'Masking not supported for this file type.');
                        setPrivacyMaskingEnabled(false);
                      } else {
                        setDetected({ email: !!d.email, phone: !!d.phone, aadhaar: !!d.aadhaar, pan: !!d.pan, address: !!d.address });
                        // Auto-enable only the types that were actually found
                        setMaskEmail(!!d.email);
                        setMaskPhone(!!d.phone);
                        setMaskAadhaar(!!d.aadhaar);
                        setMaskPan(!!d.pan);
                        setMaskAddress(!!d.address);
                        if (!d.hasAnyMatch) setScanMsg('No sensitive data detected in this file. You can still enable types manually if needed.');
                      }
                      setScanDone(true);
                    } catch {
                      setScanMsg('Could not scan file — you can enable masks manually.');
                      setScanDone(true);
                    } finally {
                      setScanning(false);
                    }
                  }
                }}
                className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-semibold text-gray-300 hover:text-white bg-bg-elevated">
                <span className="flex items-center gap-2">
                  <span className="text-purple-400">🔏</span> Privacy Masking
                  <span className="text-gray-500 font-normal">(auto-detects &amp; hides sensitive data)</span>
                </span>
                {scanning
                  ? <span className="text-xs text-purple-400 flex items-center gap-1"><div className="w-3 h-3 border border-purple-400 border-t-transparent rounded-full animate-spin" /> Scanning…</span>
                  : <span className={`text-xs px-2 py-0.5 rounded font-semibold ${privacyMaskingEnabled ? 'bg-purple-500/20 text-purple-400' : 'text-gray-500'}`}>
                      {privacyMaskingEnabled ? 'ON' : 'OFF'}
                    </span>
                }
              </button>

              {privacyMaskingEnabled && !scanning && (
                <div className="px-3 py-3 space-y-2 bg-bg-base">
                  <p className="text-2xs text-gray-500 mb-1">
                    Original file is <strong className="text-white">never modified</strong>. Masking applies only to the recipient's view.
                  </p>
                  {scanMsg && (
                    <p className={`text-2xs px-2 py-1.5 rounded ${detected.email || detected.phone || detected.aadhaar || detected.pan || detected.address ? 'text-green-400 bg-green-500/10' : 'text-yellow-400 bg-yellow-500/10'}`}>
                      {scanMsg}
                    </p>
                  )}
                  {scanSupported && (
                    <>
                      {[
                        { key: 'email',   label: 'Email Addresses',  desc: 'john@*** → ****@gmail.com',           val: maskEmail,   set: setMaskEmail,   found: detected.email   },
                        { key: 'phone',   label: 'Phone Numbers',    desc: '9876543210 → 98******10',              val: maskPhone,   set: setMaskPhone,   found: detected.phone   },
                        { key: 'aadhaar', label: 'Aadhaar Numbers',  desc: '1234 5678 9012 → XXXX XXXX 9012',     val: maskAadhaar, set: setMaskAadhaar, found: detected.aadhaar },
                        { key: 'pan',     label: 'PAN Numbers',      desc: 'ABCDE1234F → *****1234F',              val: maskPan,     set: setMaskPan,     found: detected.pan     },
                        { key: 'address', label: 'Addresses',        desc: 'Street/area info → [ADDRESS MASKED]', val: maskAddress, set: setMaskAddress, found: detected.address },
                      ].map(({ key, label, desc, val, set, found }) => (
                        <label key={key} className={`flex items-center justify-between cursor-pointer p-2 rounded-lg hover:bg-bg-elevated ${!found && scanDone ? 'opacity-50' : ''}`}>
                          <div className="flex items-center gap-2 flex-1">
                            <div>
                              <p className="text-xs text-gray-300 font-medium flex items-center gap-1.5">
                                {label}
                                {scanDone && (
                                  found
                                    ? <span className="text-2xs bg-green-500/20 text-green-400 border border-green-500/30 rounded px-1">Found ✓</span>
                                    : <span className="text-2xs bg-gray-500/10 text-gray-600 border border-gray-600/20 rounded px-1">Not found</span>
                                )}
                              </p>
                              <p className="text-2xs text-gray-500">{desc}</p>
                            </div>
                          </div>
                          <div
                            onClick={() => set((v: boolean) => !v)}
                            className={`w-8 h-4 rounded-full transition-colors relative cursor-pointer ${val ? 'bg-purple-500' : 'bg-bg-border'}`}
                          >
                            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${val ? 'left-4' : 'left-0.5'}`} />
                          </div>
                        </label>
                      ))}
                      {scanDone && !detected.email && !detected.phone && !detected.aadhaar && !detected.pan && !detected.address && (
                        <p className="text-2xs text-gray-600 text-center py-1">No sensitive data auto-detected — toggle manually if needed</p>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Image / unsupported file warning */}
              {!scanning && scanDone && !scanSupported && (
                <div className="px-3 py-3 bg-bg-base">
                  <p className="text-2xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded px-2 py-1.5">
                    📷 {scanMsg}
                  </p>
                </div>
              )}
            </div>

            {/* ── GPS Location Request ──────────────────────────────── */}
            <label className="flex items-center justify-between cursor-pointer px-3 py-2.5 rounded-xl border border-bg-border bg-bg-elevated hover:bg-bg-card">
              <div>
                <p className="text-xs font-semibold text-gray-300 flex items-center gap-2">
                  📍 Request Location
                  <span className="text-gray-500 font-normal">(optional — user can deny)</span>
                </p>
                <p className="text-2xs text-gray-500 mt-0.5">Ask recipient for GPS permission. More accurate than IP geolocation.</p>
              </div>
              <div
                onClick={() => setRequestLocation(v => !v)}
                className={`w-8 h-4 rounded-full transition-colors relative cursor-pointer shrink-0 ml-3 ${requestLocation ? 'bg-green-500' : 'bg-bg-border'}`}
              >
                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${requestLocation ? 'left-4' : 'left-0.5'}`} />
              </div>
            </label>

            <button onClick={handleCreate} disabled={creating} className="btn btn-primary w-full">
              {creating
                ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Generating…</>
                : <><Share2 size={14} /> Generate Smart Link</>}
            </button>
          </>
        ) : (
          /* Link created state */
          <div className="space-y-4">
            <div className="rounded-xl bg-success/5 border border-success/20 p-4 flex items-center gap-3">
              <Check size={18} className="text-success shrink-0" />
              <div>
                <p className="text-sm font-semibold text-success">Smart Link Generated!</p>
                <p className="text-2xs text-gray-400 mt-0.5">Access is tracked — every view is logged in File Timeline</p>
              </div>
            </div>

            {/* Dev OTP — surfaced because no SMTP provider is configured */}
            {created.devOtp && (
              <div className="rounded-xl bg-warning/5 border border-warning/20 p-3">
                <p className="text-2xs text-warning font-semibold mb-1">VERIFICATION CODE (share manually — no email service configured)</p>
                <p className="text-lg font-mono tracking-[0.4em] text-white">{created.devOtp}</p>
                {created.devOtpNote && <p className="text-2xs text-gray-500 mt-1">{created.devOtpNote}</p>}
              </div>
            )}

            {/* URL box */}
            <div className="bg-bg-elevated rounded-xl border border-bg-border p-3">
              <p className="text-2xs text-gray-500 mb-1.5 font-semibold">SHARE URL</p>
              <div className="flex items-center gap-2">
                <p className="text-xs text-dna-400 mono flex-1 truncate">{created.shareUrl}</p>
                <button onClick={handleCopy}
                  className={`btn btn-sm shrink-0 ${copied ? 'btn-secondary' : 'btn-primary'}`}>
                  {copied ? <><Check size={12} /> Copied!</> : <><Copy size={12} /> Copy</>}
                </button>
              </div>
            </div>

            {/* Share via */}
            <div className="grid grid-cols-3 gap-2">
              <a href={`https://wa.me/?text=${encodeURIComponent('Secure file: ' + created.shareUrl)}`}
                target="_blank" rel="noreferrer"
                className="btn btn-secondary btn-sm text-xs justify-center">
                WhatsApp
              </a>
              <a href={`mailto:?subject=Shared+File&body=${encodeURIComponent('Access this secure file: ' + created.shareUrl)}`}
                className="btn btn-secondary btn-sm text-xs justify-center">
                Email
              </a>
              <button onClick={handleCopy} className="btn btn-secondary btn-sm text-xs">
                <Copy size={11} /> Copy Link
              </button>
            </div>

            <div className="flex gap-2">
              <div className="flex items-center gap-1.5 text-2xs text-gray-500 bg-bg-elevated rounded-lg px-2 py-1.5">
                <Clock size={10} />
                {expiresIn ? `Expires in ${expiresIn}h` : 'Never expires'}
              </div>
              {maxViews && (
                <div className="flex items-center gap-1.5 text-2xs text-gray-500 bg-bg-elevated rounded-lg px-2 py-1.5">
                  <Eye size={10} /> Max {maxViews} views
                </div>
              )}
              {!allowDownload && (
                <div className="flex items-center gap-1.5 text-2xs text-gray-500 bg-bg-elevated rounded-lg px-2 py-1.5">
                  <Ban size={10} /> No download
                </div>
              )}
            </div>

            <p className="text-2xs text-gray-600 text-center">
              All access events appear in File Timeline with IP, browser, and location
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function VaultPage() {
  const { data: records, loading, error, refetch } = useApi(listVaultRecords);
  const [search, setSearch]   = useState('');
  const [selected, setSelected] = useState<VaultRecord | null>(null);
  const [sharing, setSharing]   = useState<VaultRecord | null>(null);

  const filtered = (records ?? []).filter(r =>
    r.originalFileName.toLowerCase().includes(search.toLowerCase()) ||
    r.id.toLowerCase().includes(search.toLowerCase()) ||
    r.dnaRecordId.toLowerCase().includes(search.toLowerCase())
  );

  if (error) return (
    <div className="flex items-center justify-center h-64 text-center">
      <div>
        <p className="text-danger text-sm mb-3">{error}</p>
        <button onClick={refetch} className="btn btn-secondary btn-sm">
          <RefreshCw size={13} /> Retry
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Vault Explorer</h1>
          <p className="text-sm text-gray-500 mt-0.5">AES-256-GCM encrypted file storage</p>
        </div>
        <div className="flex items-center gap-3">
          {!loading && records && (
            <div className="flex items-center gap-2">
              <Badge variant="purple">{records.length} records</Badge>
              <Badge variant="success" dot>AES-256-GCM</Badge>
            </div>
          )}
          <button onClick={refetch} disabled={loading} className="btn btn-secondary btn-sm">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Stats row */}
      {!loading && records && records.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="card-sm text-center">
            <p className="text-2xl font-bold text-purple">{records.length}</p>
            <p className="text-2xs text-gray-500 mt-1">Encrypted Files</p>
          </div>
          <div className="card-sm text-center">
            <p className="text-2xl font-bold text-success">
              {formatBytes(records.reduce((s, r) => s + r.encryptedSizeBytes, 0))}
            </p>
            <p className="text-2xs text-gray-500 mt-1">Total Encrypted Size</p>
          </div>
          <div className="card-sm text-center">
            <p className="text-2xl font-bold text-dna-400">100%</p>
            <p className="text-2xs text-gray-500 mt-1">Encryption Coverage</p>
          </div>
        </div>
      )}

      {/* Search + table */}
      <div className="card overflow-hidden p-0">
        <div className="flex items-center gap-3 p-4 border-b border-bg-border">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search by filename, vault ID, or DNA record ID…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input pl-9 text-sm"
            />
          </div>
          <Archive size={16} className="text-gray-500 shrink-0" />
        </div>

        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Vault ID</th>
                <th>Original Size</th>
                <th>Encryption</th>
                <th>Stored At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonTable rows={5} />
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      icon={Archive}
                      title="No vault records"
                      description="Encrypt and store files using the Generate DNA flow"
                    />
                  </td>
                </tr>
              ) : (
                filtered.map(r => (
                  <tr key={r.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <Lock size={12} className="text-success shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-white truncate max-w-[200px]">
                            {r.originalFileName}
                          </p>
                          <p className="text-2xs text-gray-500 mono">{r.originalMimeType}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="mono text-2xs text-dna-400">{r.id.slice(0, 16)}…</span>
                    </td>
                    <td>
                      <span className="mono text-xs">{formatBytes(r.originalSizeBytes)}</span>
                    </td>
                    <td>
                      <Badge variant="success">{r.encryptionAlgorithm}</Badge>
                    </td>
                    <td>
                      <span className="text-xs text-gray-400">
                        {format(new Date(r.createdAt), 'MMM d, yyyy · HH:mm')}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setSelected(r)}
                          className="btn-ghost btn-icon text-gray-500 hover:text-white"
                          title="View details"
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          onClick={() => setSharing(r)}
                          className="btn-ghost btn-icon text-gray-500 hover:text-dna-400"
                          title="Generate Smart Share Link"
                        >
                          <Share2 size={14} />
                        </button>
                        <a
                          href={`/api/v1/dna/${r.dnaRecordId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="btn-ghost btn-icon text-gray-500 hover:text-dna-400"
                          title="Open DNA record"
                        >
                          <ExternalLink size={14} />
                        </a>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <VaultDetailModal record={selected} onClose={() => setSelected(null)} />
      )}
      {sharing && (
        <ShareModal record={sharing} onClose={() => setSharing(null)} />
      )}
    </div>
  );
}
