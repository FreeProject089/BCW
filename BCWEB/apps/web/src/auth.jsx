import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try { const { user } = await api.get('/me'); setUser(user); }
    catch (e) {
      // Only a real auth failure logs the user out. A rate-limit (429) or a transient
      // network/5xx error must NOT clear the session — otherwise a burst of requests
      // (e.g. uploading a folder) would spuriously sign the user out.
      if (e?.status === 401) setUser(null);
    }
    finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, []);

  // Returns { twoFactorRequired: true, tempToken } when the account has 2FA
  // enabled — the caller must then call loginWith2fa() to actually get a session.
  const login = async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    if (res?.twoFactorRequired) return res;
    await refresh();
    return res;
  };
  const loginWith2fa = async (tempToken, code) => { await api.post('/auth/login/2fa', { tempToken, code }); await refresh(); };
  const register = async (email, password, displayName, pow) => { await api.post('/auth/register', { email, password, displayName, pow }); await refresh(); };
  const logout = async () => { await api.post('/auth/logout'); setUser(null); };

  return <Ctx.Provider value={{ user, loading, login, loginWith2fa, register, logout, refresh }}>{children}</Ctx.Provider>;
}
