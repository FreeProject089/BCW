// The OS mode switch (M1): the preference, the "is it on here" hook and the header switch.
//
// This file is the only part of the OS mode that is NOT in the lazy chunk, because SideDash
// has to know whether to load that chunk at all. Keep it small: storage, one hook, one
// button. Everything drawn in OS mode lives in os-shell.jsx.
//
// The preference is per account (per browser, like the shortcut bindings) and per dashboard:
// somebody can want windows on the admin, with its forty screens, and the plain list on their
// own five-tab dashboard. Classic is the default everywhere.
//
// Below 768px the mode is OFF whatever the preference says: a desktop of overlapping windows
// on a phone is a simulation of a PC, not a way to work. The preference is kept, so the same
// account on a laptop still gets its windows.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppWindow } from 'lucide-react';
import { useI18n } from '../../i18n.jsx';
import { useAuth } from '../../pages/auth.jsx';

const PREF_PREFIX = 'bcw.os.v1:';
const LAYOUT_PREFIX = 'bcw.os.layout.v1:';
const EVENT = 'bcw:os-prefs-changed';
export const OS_MIN_WIDTH = 768;
export const WALLPAPERS = ['scene', 'gradient', 'plain'];

const uidOf = (user) => (user?.id ? String(user.id) : 'anon');
export const layoutKey = (scope, uid) => `${LAYOUT_PREFIX}${scope}:${uid || 'anon'}`;

/** { admin: bool, dashboard: bool, wallpaper, and the look (N-os): icons, bar, labels,
 *  seconds, anim } for this account, on this browser. */
export function readOsPrefs(uid) {
  const out = { admin: false, dashboard: false, wallpaper: 'scene', icons: 'md', bar: 'bottom', labels: true, seconds: false, anim: true };
  try {
    const v = JSON.parse(localStorage.getItem(`${PREF_PREFIX}${uid || 'anon'}`) || '{}');
    if (v && typeof v === 'object') {
      out.admin = v.admin === true;
      out.dashboard = v.dashboard === true;
      if (WALLPAPERS.includes(v.wallpaper)) out.wallpaper = v.wallpaper;
      // N-os (agent-os-N): the look of the desktop, set from Personalise.
      if (['sm', 'md', 'lg'].includes(v.icons)) out.icons = v.icons;
      if (v.bar === 'top') out.bar = 'top';
      out.labels = v.labels !== false;
      out.seconds = v.seconds === true;
      out.anim = v.anim !== false;
      // fin N-os (agent-os-N)
    }
  } catch { /* private window or storage refused: classic, this session */ }
  return out;
}

export function writeOsPrefs(uid, patch) {
  const next = { ...readOsPrefs(uid), ...patch };
  try { localStorage.setItem(`${PREF_PREFIX}${uid || 'anon'}`, JSON.stringify(next)); } catch { /* this session only */ }
  try { window.dispatchEvent(new CustomEvent(EVENT)); } catch { /* no window */ }
  return next;
}

/** Forget the window layout of one dashboard ("Reset layout"). */
export function clearOsLayout(scope, uid) {
  try { localStorage.removeItem(layoutKey(scope, uid)); } catch { /* nothing kept */ }
}

function subscribeWide(cb) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia(`(min-width: ${OS_MIN_WIDTH}px)`);
  mq.addEventListener?.('change', cb);
  return () => mq.removeEventListener?.('change', cb);
}
const wideNow = () => {
  try { return window.matchMedia(`(min-width: ${OS_MIN_WIDTH}px)`).matches; } catch { return true; }
};

/** Is the screen wide enough for the OS mode? Live: rotating a tablet switches. */
export function useOsWide() {
  return useSyncExternalStore(subscribeWide, wideNow, () => true);
}

/** The account's OS preferences, kept in sync across the header switch and Settings. */
export function useOsPrefs() {
  const { user } = useAuth();
  const uid = uidOf(user);
  const [prefs, setPrefs] = useState(() => readOsPrefs(uid));
  useEffect(() => {
    setPrefs(readOsPrefs(uid));
    const h = () => setPrefs(readOsPrefs(uid));
    window.addEventListener(EVENT, h);
    window.addEventListener('storage', h);
    return () => { window.removeEventListener(EVENT, h); window.removeEventListener('storage', h); };
  }, [uid]);
  return { uid, prefs, set: (patch) => setPrefs(writeOsPrefs(uid, patch)) };
}

/**
 * For one dashboard (`scope` = 'admin' | 'dashboard'): is the OS mode switched on, can this
 * screen show it, and the setter. `active` is the only thing SideDash needs.
 */
export function useOsMode(scope) {
  const { uid, prefs, set } = useOsPrefs();
  const wide = useOsWide();
  const on = !!scope && prefs[scope] === true;
  return { uid, on, wide, active: on && wide, wallpaper: prefs.wallpaper, prefs, setPrefs: set, set: (v) => scope && set({ [scope]: !!v }), setWallpaper: (w) => set({ wallpaper: w }) };
}

/** The header switch. Hidden below 768px, where the mode cannot be on. */
export function OsModeSwitch({ on, onChange, className = '' }) {
  const { t } = useI18n();
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
      title={t('os.switch.title', 'Show this dashboard as a desktop with windows, a taskbar and a start menu. Classic stays the default.')}
      className={`hidden md:inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm border border-[var(--control-border)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] transition-colors press ${className}`}>
      <AppWindow size={15} className="text-[var(--accent-ink)] shrink-0" aria-hidden />
      <span className="whitespace-nowrap">{t('os.switch', 'OS mode')}</span>
      <span aria-hidden className={`relative w-8 h-[18px] rounded-full shrink-0 transition-colors ${on ? 'bg-[var(--primary)]' : 'bg-[var(--surface-3)] border border-[var(--line-strong)]'}`}>
        <span className={`absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[14px]' : ''}`} />
      </span>
    </button>
  );
}
