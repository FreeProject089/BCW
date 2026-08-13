import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../lib/api.js';

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
  // Re-fetch the profile when the tab regains focus, so a role/permission change an admin
  // just made takes effect (new access + admin tabs) WITHOUT the user logging out and back
  // in. Throttled to at most once every 20s so it can't hammer the API. Only while signed in.
  useEffect(() => {
    let last = 0;
    const onFocus = () => { if (user && Date.now() - last > 20000) { last = Date.now(); refresh(); } };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') onFocus(); });
    return () => window.removeEventListener('focus', onFocus);
    // eslint-disable-next-line
  }, [user?.id]);

  // Returns { twoFactorRequired: true, tempToken } when the account has 2FA
  // enabled — the caller must then call loginWith2fa() to actually get a session.
  const login = async (email, password, onStep) => {
    let res;
    try {
      res = await api.post('/auth/login', { email, password });
    } catch (e) {
      // After a few recent failures on this address the server asks for a proof of
      // work. It hands back the challenge with the refusal, so the retry costs one
      // extra round trip and no extra request for the challenge itself.
      //
      // Retried ONCE. A loop here would turn a server that always answers
      // pow_required into a client that mines forever.
      if (e?.data?.error !== 'pow_required' || !e?.data?.challenge) throw e;
      onStep?.('pow');
      const { solvePow } = await import('../lib/pow.js');
      const pow = await solvePow(async () => ({ challenge: e.data.challenge, difficulty: e.data.difficulty }));
      res = await api.post('/auth/login', { email, password, pow });
    }
    if (res?.twoFactorRequired) return res;
    await refresh();
    return res;
  };
  const loginWith2fa = async (tempToken, code) => { await api.post('/auth/login/2fa', { tempToken, code }); await refresh(); };
  const register = async (email, password, displayName, pow) => { await api.post('/auth/register', { email, password, displayName, pow }); await refresh(); };
  const logout = async () => { await api.post('/auth/logout'); setUser(null); };

  return <Ctx.Provider value={{ user, loading, login, loginWith2fa, register, logout, refresh }}>{children}</Ctx.Provider>;
}
