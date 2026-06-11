/**
 * PINIT-DNA API Service
 * Connects to the backend at localhost:4000 via Vite proxy.
 */

import axios from 'axios';
import type { GenerateDnaResponse } from '../types';
import { API_BASE_URL } from '../config/api.config';

const client = axios.create({ baseURL: API_BASE_URL });

/**
 * Upload an image and generate its 6-layer DNA fingerprint.
 * Calls: POST /api/v1/dna/generate
 */
export async function generateDna(file: File): Promise<GenerateDnaResponse> {
  const form = new FormData();
  form.append('image', file);

  try {
    const { data } = await client.post<GenerateDnaResponse>('/dna/generate', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  } catch (err: unknown) {
    // 409 Conflict = duplicate file — surface as a typed error with extra context
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const axiosErr = err as any;
    if (axiosErr?.response?.status === 409) {
      const body = axiosErr.response.data ?? {};
      const dupErr = new Error(body.error ?? 'Duplicate file detected') as Error & {
        isDuplicate: boolean;
        existingRecordId?: string;
        existingFilename?: string;
        matchType?: string;
        riskLevel?: string;
      };
      dupErr.isDuplicate        = true;
      dupErr.existingRecordId   = body.existingRecordId;
      dupErr.existingFilename   = body.existingFilename;
      dupErr.matchType          = body.matchType;
      dupErr.riskLevel          = body.riskLevel;
      throw dupErr;
    }
    throw err;
  }
}

/**
 * Get a stored DNA record.
 * Calls: GET /api/v1/dna/:id
 */
export async function getDnaRecord(id: string) {
  const { data } = await client.get(`/dna/${id}`);
  return data;
}

/**
 * Encrypt image and store in vault.
 * Calls: POST /api/v1/vault/store
 */
export async function storeInVault(file: File, dnaRecordId: string) {
  const form = new FormData();
  form.append('image', file);
  form.append('dnaRecordId', dnaRecordId);

  const { data } = await client.post('/vault/store', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

/**
 * Get vault record metadata.
 * Calls: GET /api/v1/vault/:id
 */
export async function getVaultRecord(vaultId: string) {
  const { data } = await client.get(`/vault/${vaultId}`);
  return data;
}
