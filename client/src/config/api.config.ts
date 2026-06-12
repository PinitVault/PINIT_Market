/**
 * PINIT-DNA — Centralised API Base URL
 *
 * Priority:
 *   1. VITE_API_BASE_URL env var  (set for ngrok / production)
 *   2. '/api/v1'                  (default — uses Vite proxy for local dev)
 *
 * DO NOT import axios here. Only export the base URL string.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _env = (import.meta as any).env as Record<string, string | undefined>;
export const API_BASE_URL: string =
  (_env['VITE_API_BASE_URL'])?.replace(/\/$/, '') ??
  (_env['PROD'] ? '/api/v1' : '/api/v1');
