import axios from 'axios';

const BASE = '/api/v1/auth';

export interface AuthUser {
  sub: string;
  shortId: string;
  name: string;
  role: string;
}

export function getAccessToken(): string | null {
  return localStorage.getItem('pinit_access_token');
}

export function getRefreshToken(): string | null {
  return localStorage.getItem('pinit_refresh_token');
}

export function saveTokens(access: string, refresh: string) {
  localStorage.setItem('pinit_access_token', access);
  localStorage.setItem('pinit_refresh_token', refresh);
}

export function clearTokens() {
  localStorage.removeItem('pinit_access_token');
  localStorage.removeItem('pinit_refresh_token');
}

export function parseJwt(token: string): AuthUser | null {
  try {
    const p = JSON.parse(atob(token.split('.')[1]));
    return { sub: p.sub, shortId: p.shortId, name: p.name, role: p.role };
  } catch {
    return null;
  }
}

export async function apiCreateAccount(): Promise<AuthUser> {
  const res = await axios.post(`${BASE}/create`);
  const { accessToken, refreshToken } = (res.data as any).data;
  saveTokens(accessToken, refreshToken);
  return parseJwt(accessToken)!;
}

export async function apiLogin(shortId: string): Promise<AuthUser> {
  const res = await axios.post(`${BASE}/login`, { shortId });
  const { accessToken, refreshToken } = (res.data as any).data;
  saveTokens(accessToken, refreshToken);
  return parseJwt(accessToken)!;
}

export async function apiLogout() {
  const refreshToken = getRefreshToken();
  clearTokens();
  if (refreshToken) await axios.post(`${BASE}/logout`, { refreshToken }).catch(() => {});
}

export async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  try {
    const res = await axios.post(`${BASE}/refresh`, { refreshToken });
    const { accessToken, refreshToken: newRefresh } = (res.data as any).data;
    saveTokens(accessToken, newRefresh);
    return accessToken;
  } catch {
    clearTokens();
    return null;
  }
}
