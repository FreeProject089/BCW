import { createContext, useContext, useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

// White/orange (light) ↔ black/orange (dark). Persisted; applied on <html>.
const KEY = 'bcw_theme';
const ThemeCtx = createContext(null);
export const useTheme = () => useContext(ThemeCtx);

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem(KEY) || 'light'; } catch { return 'light'; }
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(KEY, theme); } catch {}
  }, [theme]);
  const toggle = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'));
  return <ThemeCtx.Provider value={{ theme, toggle }}>{children}</ThemeCtx.Provider>;
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button className="nav-link" onClick={toggle} title="Toggle theme" aria-label="Toggle theme">
      {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  );
}
