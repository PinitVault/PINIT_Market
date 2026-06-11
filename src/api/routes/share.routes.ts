import { Router } from 'express';
import {
  createShareLink,
  listShareLinks,
  getShareLinkInfo,
  getShareLinkLogs,
  recordAccess,
  serveSharedFile,
  getVaultShareLinks,
  getShareTimeline,
  revokeShareLink,
  verifyShareOtp,
  getGeoAnalytics,
  exportShareLogsCsv,
  getLiveSessions,
  forceLogoutLink,
  getMaskedText,
  requestUnmask,
  getUnmaskStatus,
  listUnmaskRequests,
  reviewUnmaskRequest,
  debugReport,
} from '../controllers/share-link.controller';

export const shareRouter = Router();

// ── Fixed-path routes FIRST (must precede the /:token wildcard below) ────────
shareRouter.post('/',                          createShareLink);
shareRouter.get('/',                           listShareLinks);
shareRouter.get('/vault/:vaultId',             getVaultShareLinks);
shareRouter.get('/timeline/:dnaId',            getShareTimeline);
shareRouter.get('/analytics/geo',              getGeoAnalytics);
shareRouter.get('/sessions/live',              getLiveSessions);
shareRouter.get('/debug/report',               debugReport);              // ── Diagnostic: URL + IP test report
shareRouter.get('/unmask-requests',            listUnmaskRequests);       // ── Privacy Masking — owner dashboard
shareRouter.post('/unmask-requests/:id/review', reviewUnmaskRequest);    // ── Privacy Masking — approve / reject

// ── Token-scoped routes ───────────────────────────────────────────────────────
shareRouter.get('/:token',                     getShareLinkInfo);
shareRouter.get('/:token/logs',                getShareLinkLogs);
shareRouter.get('/:token/export',              exportShareLogsCsv);
shareRouter.post('/:token/access',             recordAccess);
shareRouter.post('/:token/verify-otp',         verifyShareOtp);
shareRouter.get('/:token/file',                serveSharedFile);
shareRouter.get('/:token/masked-text',         getMaskedText);            // ── Privacy Masking — masked content
shareRouter.post('/:token/unmask-request',     requestUnmask);            // ── Privacy Masking — request access
shareRouter.get('/:token/unmask-status',       getUnmaskStatus);          // ── Privacy Masking — check approval
shareRouter.delete('/:token',                  revokeShareLink);
shareRouter.post('/:token/force-logout',       forceLogoutLink);
