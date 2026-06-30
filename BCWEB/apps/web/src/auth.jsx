import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try { const { user } = await api.get('/me'); setUser(user); }
    catch { setUser(null); }
    finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, []);

  const login = async (email, password) => { await api.post('/auth/login', { email, password }); await refresh(); };
  const register = async (email, password, displayName) => { await api.post('/auth/register', { email, password, displayName }); await refresh(); };
  const logout = async () => { await api.post('/auth/logout'); setUser(null); };

  return <Ctx.Provider value={{ user, loading, login, register, logout, refresh }}>{children}</Ctx.Provider>;
}
