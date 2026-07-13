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

// Clean sliding switch: a single high-contrast knob carrying the current mode's icon
// slides across a track that fills with the accent when dark. No overlapping icons.
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  return (
    <button onClick={toggle} title={dark ? 'Switch to light' : 'Switch to dark'} aria-label="Toggle theme" role="switch" aria-checked={dark}
      className="relative inline-block h-6 w-11 rounded-full transition-colors shrink-0 align-middle border"
      style={{ background: dark ? 'var(--primary)' : 'color-mix(in srgb, var(--text) 12%, transparent)', borderColor: 'var(--line-strong)' }}>
      <span className="absolute top-1/2 grid place-items-center w-[18px] h-[18px] rounded-full transition-transform duration-200 ease-out"
        style={{ left: 2, marginTop: -9, transform: dark ? 'translateX(20px)' : 'translateX(0)', background: '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }}>
        {dark ? <Moon size={11} className="text-[var(--primary)] fill-[var(--primary)]" /> : <Sun size={11} className="text-amber-500" />}
      </span>
    </button>
  );
}
