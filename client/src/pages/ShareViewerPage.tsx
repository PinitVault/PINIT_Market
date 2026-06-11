/**
 * PINIT-DNA — Smart Link Secure Viewer
 * Route: /s/:token
 *
 * Public page — no auth required.
 * Recipient opens link → identity captured → file shown.
 * Tracks: VIEWED, DOWNLOADED events with IP/browser/geo.
 */

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Shield, Lock, Download, Eye, AlertTriangle, CheckCircle2, Clock, Ban } from 'lucide-react';
import axios from 'axios';
import { format } from 'date-fns';
import { API_BASE_URL } from '../config/api.config';
import * as docxPreview from 'docx-preview';
import { formatTextAsDocument, DOCUMENT_STYLES } from '../utils/document-formatter';

interface LinkInfo {
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
  // ── Extended policy / verification flags (Smart Links upgrade) ───────────
  oneTimeUse?:     boolean;
  maxDownloads?:   number | null;
  downloadCount?:  number;
  requireOtp?:     boolean;
  otpVerified?:    boolean;
  signatureValid?: boolean;
  // ── Privacy & Location ──────────────────────────────────────────────────
  privacyMaskingEnabled?: boolean;
  requestLocation?:       boolean;
}

// Generate a session ID for grouping events
function getSessionId(): string {
  let sid = sessionStorage.getItem('pinit_session');
  if (!sid) { sid = Math.random().toString(36).slice(2); sessionStorage.setItem('pinit_session', sid); }
  return sid;
}

// ── Lightweight device fingerprint (canvas + nav signals → SHA-256-ish hash)
// Not a forensic-grade fingerprint (no WebGL/audio probing) — a fast, stable
// per-browser signature good enough to spot "same device, different session".
function computeDeviceFingerprint(): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200; canvas.height = 40;
    const ctx = canvas.getContext('2d');
    let canvasSig = '';
    if (ctx) {
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillStyle = '#6366f1';
      ctx.fillRect(0, 0, 200, 40);
      ctx.fillStyle = '#fff';
      ctx.fillText('PINIT-DNA-FP-' + navigator.userAgent.slice(0, 20), 2, 2);
      canvasSig = canvas.toDataURL();
    }
    const raw = [
      navigator.userAgent, navigator.language,
      `${screen.width}x${screen.height}x${screen.colorDepth}`,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      String(navigator.hardwareConcurrency ?? ''),
      canvasSig,
    ].join('|');

    // Simple deterministic 32-bit hash → hex (no crypto.subtle dependency,
    // works synchronously in all browsers including non-secure contexts)
    let h = 0;
    for (let i = 0; i < raw.length; i++) {
      h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0;
    }
    return 'fp_' + (h >>> 0).toString(16) + '_' + raw.length.toString(16);
  } catch {
    return 'fp_unknown';
  }
}

function getScreenResolution(): string {
  try { return `${screen.width}x${screen.height}`; } catch { return ''; }
}

export function ShareViewerPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo]           = useState<LinkInfo | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [name, setName]           = useState('');
  const [nameSubmitted, setNameSubmitted] = useState(false);
  const [fileUrl, setFileUrl]     = useState('');
  const [downloading, setDownloading] = useState(false);
  const [fileLoadError, setFileLoadError] = useState<string | null>(null);

  // ── GPS Location state ────────────────────────────────────────────────────
  const [locationAsked,  setLocationAsked]  = useState(false);  // screen shown
  const [locationDone,   setLocationDone]   = useState(false);  // screen dismissed
  const [gpsData, setGpsData] = useState<{
    lat: number; lng: number; accuracy: number; city?: string; timestamp: string;
  } | null>(null);

  // ── Privacy Masking state ──────────────────────────────────────────────────
  const [maskedText, setMaskedText]           = useState<string | null>(null);
  const [isMasked, setIsMasked]               = useState(false);
  const [unmaskStatus, setUnmaskStatus]       = useState<'NONE'|'PENDING'|'APPROVED'|'REJECTED'>('NONE');
  const [unmaskRequesting, setUnmaskRequesting] = useState(false);
  const [_unmaskRequestId, setUnmaskRequestId] = useState<string | null>(null);

  const hasTracked = useRef(false);
  const [trackingReady, setTrackingReady] = useState(false);
  const [isIdleBlur, setIsIdleBlur] = useState(false);   // blur overlay on inactivity
  const nameRef = useRef('');
  useEffect(() => { nameRef.current = name; }, [name]);

  // ── OTP / email-verification gate state ───────────────────────────────────
  const [otp, setOtp]               = useState('');
  const [otpError, setOtpError]     = useState('');
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpVerifiedLocal, setOtpVerifiedLocal] = useState(false);

  const submitOtp = async () => {
    if (!token || !otp.trim()) return;
    setOtpVerifying(true);
    setOtpError('');
    try {
      await axios.post(`${API_BASE_URL}/share/${token}/verify-otp`, { otp: otp.trim() });
      setOtpVerifiedLocal(true);
      // Refresh link info so `info.otpVerified` reflects server state
      const { data } = await axios.get(`${API_BASE_URL}/share/${token}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setInfo((data as any).link);
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setOtpError((err as any)?.response?.data?.error ?? 'Verification failed. Please try again.');
    } finally {
      setOtpVerifying(false);
    }
  };

  // ── Load link info ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    axios.get(`${API_BASE_URL}/share/${token}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(({ data }) => setInfo((data as any).link))
      .catch(() => setError('Link not found or has been removed.'))
      .then(() => setLoading(false), () => setLoading(false));
  }, [token]);

  // ── Decide once that tracking can start (info loaded, name gate passed,
  //    link active at the moment of arrival). This flag is a one-way switch:
  //    once true it never flips back to false, so the listener-attachment
  //    effect below never tears down its handlers mid-session (which was the
  //    bug — `info` mutating later, e.g. viewCount incrementing and isActive
  //    flipping false, was re-running the effect, running its cleanup, and
  //    then bailing out early without re-attaching anything). ───────────────
  useEffect(() => {
    if (trackingReady || !info) return;
    if (info.requireName && !nameSubmitted) return;
    if (info.requireOtp && !info.otpVerified && !otpVerifiedLocal) return;
    if (!info.isActive) return;
    // Wait for location decision if requested (allow or deny — just must be decided)
    if (info.requestLocation && !locationDone) return;
    setTrackingReady(true);
  }, [info, nameSubmitted, otpVerifiedLocal, trackingReady, locationDone]);

  // ── Attach all behavioral tracking listeners (runs exactly once) ──────────
  useEffect(() => {
    if (!trackingReady || hasTracked.current) return;
    hasTracked.current = true;

    const sid = getSessionId();
    const tz  = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const screenRes = getScreenResolution();
    const fingerprint = computeDeviceFingerprint();

    const track = (action: string, extra?: Record<string, string>) =>
      axios.post(`${API_BASE_URL}/share/${token}/access`, {
        action, recipientName: nameRef.current || undefined,
        timezone: tz, sessionId: sid,
        screenResolution: screenRes, deviceFingerprint: fingerprint,
        // GPS — send on VIEWED only if user consented
        ...(action === 'VIEWED' && gpsData ? {
          gpsLat:       gpsData.lat,
          gpsLng:       gpsData.lng,
          gpsAccuracy:  gpsData.accuracy,
          gpsCity:      gpsData.city,
          gpsTimestamp: gpsData.timestamp,
          locationShared: true,
        } : {}),
        ...(action === 'VIEWED' && !gpsData && info?.requestLocation ? { locationShared: false } : {}),
        ...extra,
      }).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[SmartLink] track failed', action, err?.message);
      });

    // Initial view
    track('VIEWED');

    // ── Mouse activity / idle detection ───────────────────────────────────
    // Fires IDLE once after 60s of no mouse/keyboard/scroll activity, and
    // ACTIVE again when the user resumes — gives a coarse "engaged vs.
    // walked-away" signal without continuous mouse-position streaming
    // (which would flood the audit log for no real benefit).
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let isIdle = false;
    const IDLE_MS = 60_000;
    const resetIdle = () => {
      if (isIdle) {
        isIdle = false;
        setIsIdleBlur(false);   // remove blur overlay
        track('ACTIVE');
      }
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        isIdle = true;
        setIsIdleBlur(true);    // show blur overlay after 60s inactivity
        track('IDLE');
      }, IDLE_MS);
    };
    resetIdle();
    const activityEvents: Array<keyof DocumentEventMap> = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'];
    for (const evt of activityEvents) document.addEventListener(evt, resetIdle, { passive: true });

    // ── Scroll depth tracking ─────────────────────────────────────────────
    const scrollMilestones = new Set<number>();
    const onScroll = () => {
      const denom = document.documentElement.scrollHeight - window.innerHeight;
      const pct = denom > 0
        ? Math.round((window.scrollY / denom) * 100)
        : 100;
      for (const milestone of [10, 25, 50, 75, 100]) {
        if (pct >= milestone && !scrollMilestones.has(milestone)) {
          scrollMilestones.add(milestone);
          track('SCROLL', { scrollDepth: `${milestone}%` });
        }
      }
      // Also fire once if user scrolled at all (denom=0 means page fits screen — mark as 100% read)
      if (denom === 0 && !scrollMilestones.has(100)) {
        scrollMilestones.add(100);
        track('SCROLL', { scrollDepth: '100%' });
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    // ── Copy attempt detection ─────────────────────────────────────────────
    // The 'copy' DOM event only fires when there's an active selection to
    // copy — and the viewer intentionally sets `user-select: none`, so it
    // may never fire. Detect the keyboard shortcut directly as the primary
    // signal, and also keep the native 'copy' event as a backup.
    const onCopy = () => track('COPY_ATTEMPT');
    document.addEventListener('copy', onCopy);

    // ── Keyboard-based detection: copy, screenshot, devtools ──────────────
    const copyCooldown = { last: 0 };
    const screenshotCooldown = { last: 0 };
    const onKeyDown = (e: KeyboardEvent) => {
      const now = Date.now();
      const key = e.key?.toLowerCase?.() ?? '';

      // Ctrl+C / Cmd+C — copy shortcut
      const isCopyShortcut = (e.ctrlKey || e.metaKey) && key === 'c';
      if (isCopyShortcut && now - copyCooldown.last > 1000) {
        copyCooldown.last = now;
        track('COPY_ATTEMPT');
      }

      // Screenshot shortcuts — PrintScreen (often only fires on keyup on
      // Windows), Win+Shift+S, Win+PrtScn, Mac Cmd+Shift+3/4/5, DevTools
      const isScreenshot =
        e.key === 'PrintScreen' ||
        (e.metaKey && e.shiftKey && ['3', '4', '5', 's'].includes(key)) || // Mac
        (e.ctrlKey && e.shiftKey && key === 's') ||                         // Win Snipping (older)
        (e.metaKey && key === 'printscreen') ||                             // Win+PrtScn
        (e.key === 'F12') ||                                                // DevTools
        ((e.ctrlKey || e.metaKey) && e.shiftKey && key === 'i');            // DevTools (Ctrl+Shift+I)
      if (isScreenshot && now - screenshotCooldown.last > 1000) {
        screenshotCooldown.last = now;
        track('SCREENSHOT_ATTEMPT');
      }
    };
    document.addEventListener('keydown', onKeyDown);

    // PrintScreen frequently only emits a `keyup` event (no keydown) on
    // Windows — listen there too as a fallback.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'PrintScreen') {
        const now = Date.now();
        if (now - screenshotCooldown.last > 1000) {
          screenshotCooldown.last = now;
          track('SCREENSHOT_ATTEMPT');
        }
      }
    };
    document.addEventListener('keyup', onKeyUp);

    // ── Tab switch / visibility change ────────────────────────────────────
    const onVisibility = () => {
      if (document.hidden) track('TAB_SWITCH');
    };
    document.addEventListener('visibilitychange', onVisibility);

    // ── Win+PrtSc heuristic: OS-level screenshot causes a very brief window
    //    blur (<300 ms) that is invisible to the user but detectable here.
    //    We record the blur time and if focus returns within 300ms we treat it
    //    as a screenshot attempt (Win+PrtSc / Snipping Tool / screen-record
    //    start all share this signature).
    let blurAt = 0;
    const onWinBlur = () => { blurAt = Date.now(); };
    const onWinFocus = () => {
      const elapsed = Date.now() - blurAt;
      if (blurAt > 0 && elapsed < 300) {
        const now = Date.now();
        if (now - screenshotCooldown.last > 1000) {
          screenshotCooldown.last = now;
          track('SCREENSHOT_ATTEMPT');
        }
      }
      blurAt = 0;
    };
    window.addEventListener('blur', onWinBlur);
    window.addEventListener('focus', onWinFocus);

    // ── Print detection ───────────────────────────────────────────────────
    // `beforeprint` doesn't fire reliably in every browser for Ctrl+P —
    // also hook matchMedia('print') as a cross-browser fallback.
    const onPrint = () => track('PRINT_ATTEMPT');
    window.addEventListener('beforeprint', onPrint);

    let mql: MediaQueryList | null = null;
    const onPrintMql = (e: MediaQueryListEvent) => { if (e.matches) track('PRINT_ATTEMPT'); };
    try {
      mql = window.matchMedia('print');
      mql.addEventListener?.('change', onPrintMql);
    } catch { /* not supported — ignore */ }

    return () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onWinBlur);
      window.removeEventListener('focus', onWinFocus);
      window.removeEventListener('beforeprint', onPrint);
      mql?.removeEventListener?.('change', onPrintMql);
      if (idleTimer) clearTimeout(idleTimer);
      for (const evt of activityEvents) document.removeEventListener(evt, resetIdle);
    };
  }, [trackingReady, token]);

  // ── Download handler ───────────────────────────────────────────────────────
  const handleDownload = async () => {
    if (!info?.allowDownload || !token) return;
    setDownloading(true);
    try {
      const resp = await axios.get<Blob>(`${API_BASE_URL}/share/${token}/file`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(resp.data);
      const a   = document.createElement('a');
      a.href = url; a.download = info.filename; a.click();
      URL.revokeObjectURL(url);

      // Track download
      await axios.post(`${API_BASE_URL}/share/${token}/access`, {
        action: 'DOWNLOADED', recipientName: name || undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        sessionId: getSessionId(),
      }).catch(() => {});
    } catch {
      alert('Download failed. The file may have been removed.');
    } finally { setDownloading(false); }
  };

  // ── Text/CSV/JSON content state — must be declared before any conditional returns ──
  const [textContent, setTextContent] = useState<string | null>(null);

  // ── Load file for inline view ──────────────────────────────────────────────
  const fileBlobRef    = useRef<Blob | null>(null);
  const fileLoadedRef  = useRef(false);   // prevents re-fetch when info updates
  useEffect(() => {
    if (!info?.isActive) return;
    if (info.requireName && !nameSubmitted) return;
    if (fileLoadedRef.current) return;   // already loaded — don't re-fetch on info updates
    fileLoadedRef.current = true;
    axios.get<Blob>(`${API_BASE_URL}/share/${token}/file`, { responseType: 'blob' })
      .then(({ data }) => {
        fileBlobRef.current = data;
        const url = URL.createObjectURL(data);
        setFileUrl(url);
      })
      .catch((err) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const status = (err as any)?.response?.status;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const msg    = (err as any)?.response?.data?.error;
        if (status === 403) {
          setFileLoadError(msg ?? 'Access denied: your country, device, or IP is not permitted by the sender\'s policy.');
        } else if (status === 410) {
          setFileLoadError(msg ?? 'This link has been revoked or has reached its download limit.');
        } else {
          setFileLoadError('Failed to load the file. The server may be unreachable.');
        }
      });
  }, [info, nameSubmitted, token]);

  // ── Load text content when it's a text/csv/json file ─────────────────────
  useEffect(() => {
    const mt = info?.mimeType ?? '';
    const fn = info?.filename?.toLowerCase() ?? '';
    const isTextFile = mt === 'text/plain' || mt === 'text/csv' || mt === 'application/json'
      || ['.txt','.csv','.json','.md','.log'].some(e => fn.endsWith(e));
    if (!fileUrl || !isTextFile || !fileBlobRef.current) return;
    fileBlobRef.current.text().then(t => setTextContent(t)).catch(() => {});
  }, [fileUrl, info]);

  // ── Privacy Masking: load masked text when masking is enabled ─────────────
  useEffect(() => {
    if (!info?.privacyMaskingEnabled || !info.isActive) return;
    if (info.requireName && !nameSubmitted) return;
    const sid = getSessionId();
    axios.get(`${API_BASE_URL}/share/${token}/masked-text?sessionId=${sid}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(({ data }: { data: any }) => {
        setMaskedText(data.text ?? '');
        setIsMasked(!data.isUnmasked);
      })
      .catch(() => setMaskedText(''));
  }, [info, nameSubmitted, token]);

  // ── Privacy Masking: poll unmask request status every 5s ──────────────────
  useEffect(() => {
    if (!info?.privacyMaskingEnabled) return;
    if (unmaskStatus === 'APPROVED') return;
    const sid = getSessionId();
    const interval = setInterval(async () => {
      try {
        const { data } = await axios.get(`${API_BASE_URL}/share/${token}/unmask-status?sessionId=${sid}`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s = (data as any).status as string;
        if (s === 'APPROVED' || s === 'REJECTED') {
          setUnmaskStatus(s as 'APPROVED' | 'REJECTED');
          clearInterval(interval);
          if (s === 'APPROVED') {
            // Reload masked text (now unmasked)
            const { data: d } = await axios.get(`${API_BASE_URL}/share/${token}/masked-text?sessionId=${sid}`);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            setMaskedText((d as any).text ?? '');
            setIsMasked(false);
          }
        }
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(interval);
  }, [info, token, unmaskStatus]);

  // ── Privacy Masking: request unmasked access ───────────────────────────────
  const handleRequestUnmask = async () => {
    if (unmaskRequesting) return;
    setUnmaskRequesting(true);
    try {
      const sid = getSessionId();
      const { data } = await axios.post(`${API_BASE_URL}/share/${token}/unmask-request`, {
        recipientName: name || undefined,
        sessionId: sid,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setUnmaskRequestId((data as any).requestId);
      setUnmaskStatus('PENDING');
    } catch { /* ignore */ }
    finally { setUnmaskRequesting(false); }
  };

  // ── Render DOCX inline using docx-preview ─────────────────────────────────
  const docxContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const mimeType = info?.mimeType ?? '';
    const filename = info?.filename ?? '';
    const isDocxFile = mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      || filename.toLowerCase().endsWith('.docx');
    if (!fileUrl || !isDocxFile || !docxContainerRef.current || !fileBlobRef.current) return;
    const container = docxContainerRef.current;
    container.innerHTML = '';
    docxPreview.renderAsync(fileBlobRef.current, container, undefined, {
      className: 'docx-viewer',
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: false,
      useBase64URL: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
    }).catch(() => {});
  }, [fileUrl]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen bg-bg-base flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-dna-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-400 text-sm">Verifying secure link…</p>
      </div>
    </div>
  );

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error || !info) return (
    <div className="min-h-screen bg-bg-base flex items-center justify-center">
      <div className="text-center max-w-sm mx-auto p-6">
        <div className="w-16 h-16 bg-danger/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertTriangle size={28} className="text-danger" />
        </div>
        <h1 className="text-white font-bold text-lg mb-2">Link Not Found</h1>
        <p className="text-gray-400 text-sm">{error || 'This link does not exist or has been removed.'}</p>
      </div>
    </div>
  );

  // ── Expired / exhausted ────────────────────────────────────────────────────
  if (!info.isActive) return (
    <div className="min-h-screen bg-bg-base flex items-center justify-center">
      <div className="text-center max-w-sm mx-auto p-6">
        <div className="w-16 h-16 bg-warning/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <Ban size={28} className="text-warning" />
        </div>
        <h1 className="text-white font-bold text-lg mb-2">
          {info.isExpired ? 'Link Expired' : 'View Limit Reached'}
        </h1>
        <p className="text-gray-400 text-sm">
          {info.isExpired
            ? 'This share link has expired and is no longer accessible.'
            : `This link was limited to ${info.maxViews} views and has been exhausted.`}
        </p>
        <div className="mt-4 px-4 py-2 bg-bg-elevated rounded-lg border border-bg-border inline-block">
          <p className="text-2xs text-gray-500 mono">{token}</p>
        </div>
      </div>
    </div>
  );

  // ── Name gate ──────────────────────────────────────────────────────────────
  if (info.requireName && !nameSubmitted) return (
    <div className="min-h-screen bg-bg-base flex items-center justify-center">
      <div className="max-w-sm w-full mx-auto p-6">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-dna-500/15 rounded-full flex items-center justify-center mx-auto mb-4">
            <Shield size={28} className="text-dna-400" />
          </div>
          <h1 className="text-white font-bold text-lg">PINIT-DNA Secure File</h1>
          <p className="text-gray-400 text-sm mt-1">{info.filename}</p>
        </div>
        <div className="card space-y-4">
          <p className="text-sm text-gray-300">Please enter your name to access this document:</p>
          <input
            type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="Your full name"
            className="input w-full"
            onKeyDown={e => e.key === 'Enter' && name.trim() && setNameSubmitted(true)}
          />
          <button
            onClick={() => setNameSubmitted(true)} disabled={!name.trim()}
            className="btn btn-primary w-full"
          >
            <Eye size={15} /> Access Document
          </button>
        </div>
      </div>
    </div>
  );

  // ── OTP / identity verification gate ───────────────────────────────────────
  if (info.requireOtp && !info.otpVerified && !otpVerifiedLocal) return (
    <div className="min-h-screen bg-bg-base flex items-center justify-center">
      <div className="max-w-sm w-full mx-auto p-6">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-dna-500/15 rounded-full flex items-center justify-center mx-auto mb-4">
            <Shield size={28} className="text-dna-400" />
          </div>
          <h1 className="text-white font-bold text-lg">Verify Your Identity</h1>
          <p className="text-gray-400 text-sm mt-1">
            Enter the 6-digit verification code sent to you to access "{info.filename}"
          </p>
        </div>
        <div className="card space-y-4">
          <input
            type="text" inputMode="numeric" maxLength={6} value={otp}
            onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            className="input w-full text-center tracking-[0.5em] text-lg font-mono"
            onKeyDown={e => e.key === 'Enter' && otp.trim().length === 6 && !otpVerifying && submitOtp()}
          />
          {otpError && <p className="text-sm text-red-400">{otpError}</p>}
          <button
            onClick={submitOtp} disabled={otp.trim().length !== 6 || otpVerifying}
            className="btn btn-primary w-full"
          >
            {otpVerifying ? 'Verifying…' : <><Shield size={15} /> Verify Code</>}
          </button>
          <p className="text-xs text-gray-500 text-center">
            Didn't receive a code? Contact the person who shared this link with you.
          </p>
        </div>
      </div>
    </div>
  );

  // ── GPS Location Permission Gate ──────────────────────────────────────────
  if (info.requestLocation && !locationDone) {
    const handleAllow = () => {
      if (!navigator.geolocation) {
        setLocationDone(true); // browser doesn't support it — skip
        return;
      }
      setLocationAsked(true);
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const { latitude: lat, longitude: lng, accuracy } = pos.coords;
          // Reverse-geocode using free nominatim API
          let city: string | undefined;
          try {
            const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`);
            const j = await r.json() as { address?: { city?: string; town?: string; village?: string; county?: string } };
            city = j.address?.city ?? j.address?.town ?? j.address?.village ?? j.address?.county;
          } catch { /* non-fatal */ }
          setGpsData({ lat, lng, accuracy, city, timestamp: new Date().toISOString() });
          setLocationDone(true);
        },
        () => {
          // User denied — continue without GPS
          setLocationDone(true);
        },
        { timeout: 10000, maximumAge: 60000 }
      );
    };

    return (
      <div className="min-h-screen bg-bg-base flex items-center justify-center">
        <div className="max-w-sm w-full mx-auto p-6">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-green-500/15 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">📍</span>
            </div>
            <h1 className="text-white font-bold text-lg">Location Sharing</h1>
            <p className="text-gray-400 text-sm mt-2">
              The owner of this document has requested your location for audit purposes.
            </p>
            <p className="text-gray-500 text-xs mt-1">
              This is optional — you can skip and still access the document.
            </p>
          </div>
          <div className="card space-y-3">
            <div className="bg-bg-elevated rounded-xl p-3 text-2xs text-gray-400 space-y-1">
              <p>✅ Your approximate GPS location</p>
              <p>✅ Accuracy radius in metres</p>
              <p>✅ Timestamp of capture</p>
              <p className="text-gray-600 mt-2">❌ Your exact address is never stored</p>
              <p className="text-gray-600">❌ Location is not shared with anyone else</p>
            </div>
            <button
              onClick={handleAllow}
              disabled={locationAsked}
              className="btn btn-primary w-full"
            >
              {locationAsked
                ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Getting location…</>
                : <>📍 Allow Location Sharing (Recommended)</>
              }
            </button>
            <button
              onClick={() => setLocationDone(true)}
              className="btn btn-secondary w-full text-gray-400"
            >
              Skip — Continue without location
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Secure Viewer — file-type classification ───────────────────────────────
  const mime     = info?.mimeType ?? '';
  const filename = info?.filename?.toLowerCase() ?? '';
  const isImage  = mime.startsWith('image/');
  const isPDF    = mime === 'application/pdf';
  const isDocx   = mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                   || filename.endsWith('.docx');
  const isVideo  = mime.startsWith('video/') || ['.mp4','.webm','.mov','.avi','.mkv'].some(e => filename.endsWith(e));
  const isAudio  = mime.startsWith('audio/') || ['.mp3','.wav','.ogg','.flac','.aac','.m4a'].some(e => filename.endsWith(e));
  const isText   = mime === 'text/plain' || mime === 'text/csv' || mime === 'application/json'
                   || ['.txt','.csv','.json','.md','.log'].some(e => filename.endsWith(e));

  return (
    <div className="min-h-screen bg-bg-base flex flex-col"
      onContextMenu={e => e.preventDefault()}  // Block right-click
    >
      {/* ── Print-hide style: hides content from browser print dialog ────── */}
      <style>{`@media print { .print-hide { display: none !important; } }`}</style>

      {/* ── Idle blur overlay — shown after 60s of no activity ─────────────
           Clicking anywhere dismisses it (resetIdle fires via document listener) */}
      {isIdleBlur && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center"
          style={{ backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', background: 'rgba(15,23,42,0.55)' }}
        >
          <div className="text-center">
            <div className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Lock size={28} className="text-white" />
            </div>
            <p className="text-white font-bold text-lg mb-1">Session Paused</p>
            <p className="text-white/60 text-sm">Move your mouse or press any key to resume</p>
          </div>
        </div>
      )}

      {/* Header bar */}
      <div className="bg-bg-card border-b border-bg-border px-4 py-3 flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-dna-500/20 rounded-lg flex items-center justify-center">
            <Lock size={13} className="text-dna-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white truncate max-w-[200px]">{info.filename}</p>
            <p className="text-2xs text-gray-500">PINIT-DNA Secure Viewer</p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Expiry */}
          {info.expiresAt && (
            <div className="flex items-center gap-1 text-2xs text-gray-500 border border-bg-border rounded px-2 py-1">
              <Clock size={10} />
              Expires {format(new Date(info.expiresAt), 'MMM d')}
            </div>
          )}
          {/* Max views */}
          {info.maxViews && (
            <div className="flex items-center gap-1 text-2xs text-gray-500 border border-bg-border rounded px-2 py-1">
              <Eye size={10} />
              {info.viewCount}/{info.maxViews} views
            </div>
          )}
          {/* Verified badge */}
          <div className="flex items-center gap-1 text-2xs text-success border border-success/30 bg-success/5 rounded px-2 py-1">
            <CheckCircle2 size={10} />
            Verified
          </div>
          {/* Download button */}
          {info.allowDownload && (
            <button onClick={handleDownload} disabled={downloading}
              className="btn btn-secondary btn-sm text-xs">
              <Download size={12} />
              {downloading ? 'Downloading…' : 'Download'}
            </button>
          )}
        </div>
      </div>

      {/* Note from sender */}
      {info.note && (
        <div className="bg-dna-500/5 border-b border-dna-500/20 px-4 py-2">
          <p className="text-xs text-dna-300">📝 {info.note}</p>
        </div>
      )}

      {/* ── Privacy Masking banner (shown when masking is active) ──────────── */}
      {info.privacyMaskingEnabled && (
        <div className={`px-4 py-2 flex items-center gap-3 text-xs border-b ${isMasked ? 'bg-purple-500/10 border-purple-500/30' : 'bg-green-500/10 border-green-500/30'}`}>
          <span>{isMasked ? '🔏' : '🔓'}</span>
          <span className={isMasked ? 'text-purple-300' : 'text-green-300'}>
            {isMasked
              ? 'Privacy Masking is active — some sensitive data is hidden.'
              : 'Unmasked access granted — full document is visible.'}
          </span>
          {isMasked && unmaskStatus === 'NONE' && (
            <button onClick={handleRequestUnmask} disabled={unmaskRequesting}
              className="ml-auto btn btn-sm text-xs bg-purple-500/20 border border-purple-500/30 text-purple-300 hover:bg-purple-500/30">
              {unmaskRequesting ? 'Requesting…' : '🔑 Request Unmasked Access'}
            </button>
          )}
          {isMasked && unmaskStatus === 'PENDING' && (
            <span className="ml-auto text-yellow-400 text-xs animate-pulse">⏳ Approval pending from owner…</span>
          )}
          {isMasked && unmaskStatus === 'REJECTED' && (
            <span className="ml-auto text-red-400 text-xs">❌ Access request was rejected</span>
          )}
        </div>
      )}

      {/* File viewer area — print-hide hides content from browser print dialog */}
      <div className="print-hide flex-1 flex items-start justify-center p-4 overflow-auto"
        style={{ userSelect: 'none', position: 'relative' }}
      >
        {fileLoadError ? (
          <div className="mt-20 max-w-sm mx-auto text-center">
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Ban size={28} className="text-red-400" />
            </div>
            <h2 className="text-white font-bold text-lg mb-2">Access Blocked</h2>
            <p className="text-gray-400 text-sm">{fileLoadError}</p>
            <p className="text-2xs text-gray-600 mt-3 border border-bg-border rounded-lg px-3 py-2 inline-block">
              Contact the file owner if you believe this is a mistake.
            </p>
          </div>
        ) : !fileUrl ? (
          <div className="flex items-center gap-3 mt-20 text-gray-500">
            <div className="w-5 h-5 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">Loading file…</span>
          </div>
        ) : isImage ? (
          <img
            src={fileUrl} alt={info.filename}
            className="max-w-full max-h-[80vh] object-contain rounded-xl shadow-2xl"
            draggable={false}
            onDragStart={e => e.preventDefault()}
          />
        ) : isPDF ? (
          info.privacyMaskingEnabled && maskedText !== null ? (
            /* ── PDF with masking: styled document renderer ── */
            <div className="w-full max-w-4xl overflow-auto rounded-xl shadow-xl border border-purple-500/20"
              style={{ maxHeight: 'calc(100vh - 160px)', background: '#fff' }}>
              <style>{DOCUMENT_STYLES}</style>
              <div
                className="doc-viewer"
                dangerouslySetInnerHTML={{ __html: formatTextAsDocument(maskedText || '') }}
              />
            </div>
          ) : (
            <iframe src={fileUrl} title={info.filename}
              className="w-full rounded-xl border border-bg-border"
              style={{ height: 'calc(100vh - 140px)' }} />
          )
        ) : isDocx ? (
          info.privacyMaskingEnabled && maskedText !== null ? (
            /* ── DOCX with masking: styled document renderer ── */
            <div className="w-full max-w-4xl overflow-auto rounded-xl shadow-xl border border-purple-500/20"
              style={{ maxHeight: 'calc(100vh - 160px)', background: '#fff' }}>
              <style>{DOCUMENT_STYLES}</style>
              <div
                className="doc-viewer"
                dangerouslySetInnerHTML={{ __html: formatTextAsDocument(maskedText || '') }}
              />
            </div>
          ) : (
            /* ── DOCX: rendered inline via docx-preview ── */
            <div ref={docxContainerRef}
              className="w-full bg-white rounded-xl shadow-xl overflow-auto"
              style={{ minHeight: '70vh', maxHeight: 'calc(100vh - 140px)', padding: '8px' }} />
          )
        ) : isVideo ? (
          /* ── VIDEO: native HTML5 player — controls enabled but download blocked ── */
          <div className="w-full max-w-4xl">
            <video
              src={fileUrl}
              controls
              controlsList="nodownload nofullscreen noremoteplayback"
              disablePictureInPicture
              className="w-full rounded-xl shadow-2xl border border-bg-border"
              style={{ maxHeight: 'calc(100vh - 160px)' }}
              onContextMenu={e => e.preventDefault()}
            >
              Your browser does not support inline video playback.
            </video>
            <p className="text-2xs text-gray-500 text-center mt-2">
              🔒 Protected · Access tracked and logged
            </p>
          </div>
        ) : isAudio ? (
          /* ── AUDIO: native HTML5 audio player ── */
          <div className="w-full max-w-xl mt-12">
            <div className="card p-6 text-center space-y-4">
              <div className="w-16 h-16 bg-dna-500/15 rounded-full flex items-center justify-center mx-auto">
                <Shield size={28} className="text-dna-400" />
              </div>
              <p className="text-white font-semibold">{info.filename}</p>
              <audio
                src={fileUrl}
                controls
                controlsList="nodownload"
                className="w-full"
                onContextMenu={e => e.preventDefault()}
              >
                Your browser does not support inline audio playback.
              </audio>
              <p className="text-2xs text-gray-500">🔒 Protected · Access tracked and logged</p>
            </div>
          </div>
        ) : isText ? (
          /* ── TEXT / CSV / JSON ── */
          <div className="w-full max-w-4xl overflow-auto rounded-xl shadow-xl border border-bg-border"
            style={{ maxHeight: 'calc(100vh - 160px)' }}>
            {info.privacyMaskingEnabled && maskedText !== null ? (
              <>
                <style>{DOCUMENT_STYLES}</style>
                <div
                  className="doc-viewer"
                  dangerouslySetInnerHTML={{ __html: formatTextAsDocument(maskedText) }}
                />
              </>
            ) : (
              <pre
                className="bg-bg-card p-4 text-xs text-gray-300 font-mono"
                style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
              >
                {textContent ?? 'Loading…'}
              </pre>
            )}
            <p className="text-2xs text-gray-500 text-center mt-2">
              🔒 Protected · Access tracked and logged
            </p>
          </div>
        ) : (
          /* ── FALLBACK: ZIP, PPTX, unknown — show secure download card ── */
          <div className="card text-center py-12 max-w-sm">
            <Lock size={32} className="text-dna-400 mx-auto mb-3" />
            <p className="text-white font-semibold mb-1">{info.filename}</p>
            <p className="text-sm text-gray-400 mb-4">
              This file type cannot be previewed in the browser.
            </p>
            {info.allowDownload ? (
              <button onClick={handleDownload} disabled={downloading} className="btn btn-primary">
                <Download size={14} /> Secure Download
              </button>
            ) : (
              <p className="text-xs text-gray-500 border border-bg-border rounded-lg px-3 py-2">
                Download is disabled by the sender for this link.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Full-coverage watermark — survives Win+PrtSc / screen recording.
           Each tile shows token + date so every captured frame is traceable. */}
      <div
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none select-none overflow-hidden"
        style={{ zIndex: 1000 }}
      >
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"
          style={{ position: 'absolute', inset: 0 }}>
          <defs>
            <pattern id="wm" x="0" y="0" width="320" height="120" patternUnits="userSpaceOnUse"
              patternTransform="rotate(-30)">
              <text x="0" y="24" fontFamily="monospace" fontSize="11" fill="#818cf8" opacity="0.18">
                PINIT-DNA · {token}
              </text>
              <text x="0" y="44" fontFamily="monospace" fontSize="9" fill="#818cf8" opacity="0.12">
                {name || 'Viewer'} · {new Date().toLocaleDateString('en-IN')}
              </text>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#wm)" />
        </svg>
      </div>

      {/* Footer */}
      <div className="bg-bg-card border-t border-bg-border px-4 py-2 flex items-center justify-between">
        <p className="text-2xs text-gray-600">
          Protected by PINIT-DNA Smart Links · Access is tracked and logged
        </p>
        <p className="text-2xs text-gray-600 mono">{token}</p>
      </div>
    </div>
  );
}
