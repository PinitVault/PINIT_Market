import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import {
  AuthUser, getAccessToken, parseJwt, clearTokens,
  apiLogin, apiLogout, apiCreateAccount, refreshAccessToken,
} from '../lib/auth';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  createAccount: () => Promise<AuthUser>;
  login: (shortId: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) { setLoading(false); return; }

    const parsed = parseJwt(token);
    if (!parsed) { clearTokens(); setLoading(false); return; }

    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      refreshAccessToken().then(t => {
        if (t) setUser(parseJwt(t));
        setLoading(false);
      });
    } else {
      setUser(parsed);
      setLoading(false);
    }
  }, []);

  async function createAccount(): Promise<AuthUser> {
    const u = await apiCreateAccount();
    setUser(u);
    return u;
  }

  async function login(shortId: string) {
    const u = await apiLogin(shortId);
    setUser(u);
  }

  async function logout() {
    await apiLogout();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, createAccount, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
