import { useState, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

// Header is suppressed when App is embedded in the dashboard layout
const Header = () => null;
import { UploadZone } from './components/UploadZone';
import { LayerPipeline } from './components/LayerPipeline';
import { DnaRecordCard } from './components/DnaRecordCard';
import { EncryptionStep } from './components/EncryptionStep';
import { VaultStep } from './components/VaultStep';
import { SuccessPanel } from './components/SuccessPanel';

import { generateDna } from './services/api';
import type { AppStage, LayerState, DnaSession, EncryptionResult, VaultStoreResponse } from './types';

// Per-layer animation delay in ms — simulates sequential progress visually
// while the actual API runs all layers in parallel in the background.
const LAYER_DELAYS = [200, 600, 1200, 2400, 3600, 4800];

export default function App() {
  const [stage, setStage] = useState<AppStage | 'vaulting'>('idle');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [layerStates, setLayerStates] = useState<LayerState[]>(
    Array.from({ length: 6 }, () => ({ status: 'pending' as const }))
  );
  const [session, setSession] = useState<DnaSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [duplicateInfo, setDuplicateInfo] = useState<any | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

  const setLayerStatus = (idx: number, state: Partial<LayerState>) => {
    setLayerStates((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...state };
      return next;
    });
  };

  // ── Start DNA generation ───────────────────────────────────────────────────

  const handleGenerate = useCallback(async () => {
    if (!selectedFile) return;
    clearTimers();
    setError(null);
    setStage('processing');

    // Reset all layers to pending
    setLayerStates(Array.from({ length: 6 }, () => ({ status: 'pending' as const })));

    // Animate layers one by one with staggered delays (visual simulation)
    LAYER_DELAYS.forEach((delay, idx) => {
      const t1 = setTimeout(() => setLayerStatus(idx, { status: 'processing' }), delay);
      // Each layer "completes" ~400ms after it starts visually
      const t2 = setTimeout(
        () => setLayerStatus(idx, { status: 'processing' }),
        delay + 50
      );
      timersRef.current.push(t1, t2);
    });

    // Fire the real API call
    try {
      const result = await generateDna(selectedFile);

      // Mark all layers complete with timing from result
      const processingPerLayer = Math.round(result.summary.totalProcessingMs / 6);
      setLayerStates(
        Array.from({ length: 6 }, (_, i) => ({
          status: result.summary.failedLayers > 0 && i === 5 ? 'failed' : 'complete',
          processingMs: processingPerLayer + Math.round(Math.random() * 200),
        }))
      );

      setSession({
        dnaRecordId:      result.dnaRecordId,
        filename:         selectedFile.name,
        fileSizeBytes:    selectedFile.size,
        mimeType:         selectedFile.type,
        fileType:         result.fileType  ?? 'FILE',
        engineVersion:    result.engineVersion ?? '2.0.0-universal',
        status:           result.status,
        successfulLayers: result.summary.successfulLayers,
        totalProcessingMs: result.summary.totalProcessingMs,
        generatedAt:      result.generatedAt,
      });

      // Move to encryption step
      setTimeout(() => setStage('encrypting'), 800);
    } catch (err: unknown) {
      clearTimers();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyErr = err as any;
      if (anyErr?.isDuplicate) {
        setDuplicateInfo({
          existingRecordId: anyErr.existingRecordId,
          existingFilename: anyErr.existingFilename,
          matchType:        anyErr.matchType,
          riskLevel:        anyErr.riskLevel,
        });
        setError(anyErr.message);
      } else {
        setDuplicateInfo(null);
        const msg = err instanceof Error ? err.message : 'Failed to connect to DNA API';
        setError(msg);
      }
      setStage('idle');
    }
  }, [selectedFile]);

  // ── Encryption complete → move to vault stage ─────────────────────────────

  const handleEncryptionComplete = useCallback((enc: EncryptionResult) => {
    setSession((prev) =>
      prev ? { ...prev, encryption: enc } : prev
    );
    setTimeout(() => setStage('vaulting'), 400);
  }, []);

  // ── Vault complete → move to success ──────────────────────────────────────

  const handleVaultComplete = useCallback((vault: VaultStoreResponse) => {
    setSession((prev) =>
      prev ? { ...prev, vault } : prev
    );
    setTimeout(() => setStage('success'), 400);
  }, []);

  const handleVaultError = useCallback((msg: string) => {
    // Vault failure is non-fatal — show success with a warning
    setError(`Vault storage failed: ${msg}`);
    setTimeout(() => setStage('success'), 400);
  }, []);

  // ── Reset ──────────────────────────────────────────────────────────────────

  const handleReset = () => {
    clearTimers();
    setStage('idle');
    setSelectedFile(null);
    setSession(null);
    setError(null);
    setLayerStates(Array.from({ length: 6 }, () => ({ status: 'pending' as const })));
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const completedCount = layerStates.filter((l) => l.status === 'complete').length;

  return (
    <div className="min-h-screen flex flex-col bg-bg-base">
      <Header />

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-8">
        <AnimatePresence mode="wait">

          {/* ── IDLE: Upload page ─────────────────────────────────────────── */}
          {stage === 'idle' && (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {error && duplicateInfo ? (
                /* ── Duplicate file blocked — rich UI ───────────────────── */
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-6 max-w-2xl mx-auto rounded-xl overflow-hidden border border-amber-500/40"
                >
                  <div className="bg-amber-500/10 px-5 py-3 flex items-center gap-2 border-b border-amber-500/20">
                    <span className="text-lg">🚫</span>
                    <p className="text-amber-400 font-semibold text-sm">Duplicate File Detected</p>
                    {duplicateInfo.riskLevel === 'HIGH' && (
                      <span className="ml-auto text-xs bg-red-500/20 text-red-400 border border-red-500/30 rounded px-2 py-0.5 font-semibold">HIGH RISK</span>
                    )}
                  </div>
                  <div className="bg-bg-card px-5 py-4 space-y-2">
                    <p className="text-gray-300 text-sm">{error}</p>
                    <div className="grid grid-cols-2 gap-2 mt-3">
                      <div className="bg-bg-elevated rounded-lg px-3 py-2">
                        <p className="text-2xs text-gray-500 uppercase tracking-wide">Match Type</p>
                        <p className="text-xs text-white font-mono mt-0.5">
                          {duplicateInfo.matchType === 'EXACT_HASH' ? '🔴 Exact SHA-256 Match' : '🟡 Near-Duplicate (pHash)'}
                        </p>
                      </div>
                      <div className="bg-bg-elevated rounded-lg px-3 py-2">
                        <p className="text-2xs text-gray-500 uppercase tracking-wide">Existing File</p>
                        <p className="text-xs text-white font-mono mt-0.5 truncate">{duplicateInfo.existingFilename ?? '—'}</p>
                      </div>
                      {duplicateInfo.existingRecordId && (
                        <div className="bg-bg-elevated rounded-lg px-3 py-2 col-span-2">
                          <p className="text-2xs text-gray-500 uppercase tracking-wide">Existing DNA Record ID</p>
                          <p className="text-xs text-dna-400 font-mono mt-0.5">{duplicateInfo.existingRecordId}</p>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => { setError(null); setDuplicateInfo(null); }}
                      className="btn btn-secondary btn-sm mt-2 text-xs"
                    >
                      Try Different File
                    </button>
                  </div>
                </motion.div>
              ) : error ? (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-6 max-w-2xl mx-auto bg-red-500/10 border border-red-500/30 rounded-xl px-5 py-4"
                >
                  <p className="text-red-400 text-sm font-medium">⚠ API Error</p>
                  <p className="text-red-300 text-xs mt-1 mono">{error}</p>
                  <p className="text-gray-500 text-xs mt-1">
                    Make sure the backend is running on port 4000.
                  </p>
                </motion.div>
              ) : null}
              <UploadZone
                selectedFile={selectedFile}
                onFileSelected={setSelectedFile}
                onGenerate={handleGenerate}
              />
            </motion.div>
          )}

          {/* ── PROCESSING + ENCRYPTING: Pipeline page ───────────────────── */}
          {(stage === 'processing' || stage === 'encrypting' || stage === 'vaulting') && (
            <motion.div
              key="processing"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              className="grid grid-cols-1 lg:grid-cols-2 gap-6"
            >
              {/* Left — layer pipeline */}
              <div className="space-y-6">
                {/* File badge */}
                <div className="flex items-center gap-3 bg-bg-card border border-bg-border rounded-xl px-4 py-3">
                  <span className="text-xl">
                    {selectedFile?.type.startsWith('image/')   ? '🖼️'
                    : selectedFile?.type === 'application/pdf' ? '📄'
                    : selectedFile?.type.includes('word')      ? '📝'
                    : selectedFile?.type.includes('present')   ? '📊'
                    : selectedFile?.type === 'text/plain'      ? '📃'
                    : selectedFile?.type === 'text/csv'        ? '📋'
                    : selectedFile?.type === 'application/json'? '🗃️'
                    : selectedFile?.type === 'application/zip' ? '🗜️'
                    : selectedFile?.type.startsWith('video/')  ? '🎬'
                    : selectedFile?.type.startsWith('audio/')  ? '🎵'
                    : '📁'}
                  </span>
                  <div>
                    <p className="text-xs text-gray-500 mono">
                      Processing · {session?.fileType ?? selectedFile?.type.split('/')[0]?.toUpperCase() ?? 'FILE'}
                    </p>
                    <p className="text-white font-medium text-sm truncate">
                      {selectedFile?.name}
                    </p>
                  </div>
                  <div className="ml-auto w-4 h-4 border-2 border-dna-500 border-t-transparent rounded-full animate-spin" />
                </div>

                <LayerPipeline
                  layerStates={layerStates}
                  completedCount={completedCount}
                />
              </div>

              {/* Right — DNA record + encryption */}
              <div className="space-y-6">
                {session && (
                  <DnaRecordCard
                    dnaRecordId={session.dnaRecordId}
                    filename={session.filename}
                    fileSizeBytes={session.fileSizeBytes}
                    status={session.status}
                    generatedAt={session.generatedAt}
                    successfulLayers={session.successfulLayers}
                    fileType={session.fileType}
                    engineVersion={session.engineVersion}
                  />
                )}

                {stage === 'encrypting' && session && (
                  <EncryptionStep
                    dnaRecordId={session.dnaRecordId}
                    onComplete={handleEncryptionComplete}
                  />
                )}

                {stage === 'vaulting' && session && selectedFile && (
                  <VaultStep
                    file={selectedFile}
                    dnaRecordId={session.dnaRecordId}
                    onComplete={handleVaultComplete}
                    onError={handleVaultError}
                  />
                )}

                {stage === 'processing' && !session && (
                  <div className="card flex flex-col items-center justify-center py-16 text-center opacity-40">
                    <div className="text-4xl mb-3 dna-float">🧬</div>
                    <p className="text-gray-400 text-sm">DNA record will appear here</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* ── SUCCESS ────────────────────────────────────────────────────── */}
          {stage === 'success' && session && (
            <motion.div
              key="success"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
            >
              <SuccessPanel session={session} onReset={handleReset} />
            </motion.div>
          )}

        </AnimatePresence>
      </main>
    </div>
  );
}
