import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { Keyboard, RotateCcw, X, Pencil } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { useTheme } from './theme.jsx';
import { useAuth } from '../pages/auth.jsx';
import { Button, Card } from './ui.jsx';
import {
  SHORTCUTS, activeShortcuts, comboCaps, comboFromEvent, comboOf, findConflict, handlerFor, isCapturing,
  isModifierKey, isTouchOnly, isTypingTarget, onShortcutsChanged, readOverrides, resetAllBindings, resetBinding,
  setBinding, setCapturing, setHandlers, siteKeysPaused, takeBinding, validateCombo, visibleTo,
} from '../lib/shortcuts.js';
import './shortcuts.css';

// How long Alt has to be HELD, alone, before the overlay appears. Long enough that Alt+Tab and
// a quick Alt+H never flash it, short enough that holding it to look feels immediate.
const HOLD_MS = 420;

/** True on a phone or tablet with no keyboard/mouse; kept live (a tablet can gain a keyboard). */
export function useTouchOnly() {
  const [v, setV] = useState(isTouchOnly);
  useEffect(() => {
    let mq = null;
    try { mq = window.matchMedia('(any-pointer: fine)'); } catch { return undefined; }
    const on = () => setV(isTouchOnly());
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return v;
}

/** The signed-in account's overrides, kept in step with any change made anywhere. */
function useOverrides(uid) {
  const [o, setO] = useState(() => readOverrides(uid));
  const [, setTick] = useState(0);
  useEffect(() => {
    setO(readOverrides(uid));
    // The tick also covers page handlers coming and going (same event), so the overlay's
    // "On this page" group follows the mounted page.
    return onShortcutsChanged(() => { setO(readOverrides(uid)); setTick((n) => n + 1); });
  }, [uid]);
  return o;
}

const uidOf = (user) => user?.id || null;

/**
 * A page's own shortcut actions (the `handler` rows in lib/shortcuts.js). Registered while the
 * page is mounted, so the overlay's "On this page" is never a list of things that are not here.
 * The functions may change every render; the registration does not.
 */
export function useShortcutHandlers(map) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    const wrapped = {};
    for (const id of Object.keys(ref.current || {})) wrapped[id] = () => ref.current?.[id]?.();
    return setHandlers(wrapped);
  }, []);
}

/**
 * palette row id → key caps, for the ⌘K list. Empty on a touch-only device: no key hints for
 * keys that are not there, and that includes inside the palette.
 */
export function useShortcutHints() {
  const { user } = useAuth();
  const overrides = useOverrides(uidOf(user));
  const touchOnly = useTouchOnly();
  return useMemo(() => {
    const m = new Map();
    if (touchOnly) return m;
    for (const s of SHORTCUTS) {
      if (!s.palette || !visibleTo(s, { user })) continue;
      const c = comboOf(s, overrides);
      if (c) m.set(s.palette, comboCaps(c));
    }
    return m;
  }, [user, overrides, touchOnly]);
}

export function Keys({ combo, caps, className = '' }) {
  const list = caps || comboCaps(combo);
  if (!list.length) return null;
  return (
    <span className={`sc-keys ${className}`}>
      {list.map((c, i) => <kbd key={i} className="sc-kbd">{c}</kbd>)}
    </span>
  );
}

const GROUPS = [
  ['page', (t) => t('sc.g.page', 'On this page')],
  ['nav', (t) => t('sc.g.nav', 'Go to')],
  ['act', (t) => t('sc.g.act', 'Actions')],
  ['os', (t) => t('sc.g.os', 'Dashboards in OS mode')],
];

/**
 * The global key handler and the hold-Alt overlay. Mounted once in App.
 *
 * Listens in the CAPTURE phase so a matched shortcut is consumed before a page's own window
 * listener can also react to it. Ignores every keystroke that is typing, every key while the
 * Settings panel is capturing a new combo, and everything on the studio's own surface.
 */
export default function ShortcutsHost() {
  const { t, lang, setLang } = useI18n();
  const theme = useTheme();
  const { user } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const overrides = useOverrides(uidOf(user));
  const touchOnly = useTouchOnly();
  const [overlay, setOverlay] = useState(false);

  const live = useRef(null);
  live.current = { user, path: loc.pathname, overrides, nav, theme, lang, setLang, touchOnly };

  useEffect(() => {
    let timer = null;
    let shown = false;
    const show = (v) => { shown = v; setOverlay(v); };
    const cancel = () => { clearTimeout(timer); timer = null; };
    const run = (s) => {
      const L = live.current;
      if (s.to) L.nav(s.to);
      else if (s.action === 'theme') L.theme?.toggle?.();
      else if (s.action === 'lang') L.setLang(L.lang === 'fr' ? 'en' : 'fr');
      else if (s.action === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
      else if (s.handler) handlerFor(s.id)?.();
    };
    const onDown = (e) => {
      const L = live.current;
      if (isCapturing() || e.isComposing || e.defaultPrevented) return;
      if (e.key === 'Alt') {
        cancel();
        if (e.repeat || e.ctrlKey || e.metaKey || L.touchOnly || isTypingTarget(document.activeElement)) return;
        timer = setTimeout(() => show(true), HOLD_MS);
        return;
      }
      if (isModifierKey(e)) return; // Shift joining a held Alt: still deciding
      cancel();
      if (!e.altKey) { if (shown) show(false); return; }
      const combo = comboFromEvent(e);
      if (!combo || siteKeysPaused(L.path)) return;
      if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
      const s = activeShortcuts({ user: L.user, path: L.path, overrides: L.overrides }).find((x) => !x.fixed && x.combo === combo);
      if (!s) return;
      e.preventDefault();
      e.stopPropagation();
      if (shown) show(false);
      run(s);
    };
    const onUp = (e) => {
      if (e.key !== 'Alt') return;
      cancel();
      // Only after a deliberate hold: a quick tap still reaches the browser (Firefox's menu
      // bar, Chrome's menu), because that is somebody using the browser, not the site.
      if (shown) { e.preventDefault(); show(false); }
    };
    const hide = () => { cancel(); if (shown) show(false); };
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    window.addEventListener('blur', hide);
    window.addEventListener('pointerdown', hide, true);
    document.addEventListener('visibilitychange', hide);
    return () => {
      cancel();
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
      window.removeEventListener('blur', hide);
      window.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('visibilitychange', hide);
    };
  }, []);

  if (!overlay || touchOnly || typeof document === 'undefined') return null;
  const paused = siteKeysPaused(loc.pathname);
  const list = activeShortcuts({ user, path: loc.pathname, overrides })
    .filter((s) => !paused || s.group === 'page' || s.id === 'act.palette');
  return createPortal(
    <div className="sc-overlay" role="dialog" aria-modal="false" aria-labelledby="sc-overlay-t">
      <div className="sc-panel">
        <div className="sc-head">
          <Keyboard size={16} className="text-[var(--accent-ink)]" aria-hidden />
          <span id="sc-overlay-t" className="font-semibold text-sm">{t('sc.overlay.t', 'Keyboard shortcuts')}</span>
          <span className="ms-auto text-[11px] text-[var(--faint)]">{t('sc.overlay.release', 'Release Alt to close')}</span>
        </div>
        <div className="sc-cols">
          {GROUPS.map(([g, label]) => {
            const rows = list.filter((s) => s.group === g);
            if (!rows.length) return null;
            return (
              <section key={g} className="sc-group">
                <h3 className="sc-group-t">{label(t)}</h3>
                {rows.map((s) => (
                  <div key={s.id} className="sc-row">
                    <span className="sc-row-l">{s.label(t)}</span>
                    <Keys combo={s.combo} />
                  </div>
                ))}
              </section>
            );
          })}
        </div>
        <div className="sc-foot">
          {paused
            ? t('sc.overlay.paused', 'The site keys are paused in the studio, which has its own.')
            : t('sc.overlay.foot', 'Change or turn off any of these in Settings, Keyboard shortcuts.')}
        </div>
      </div>
    </div>,
    document.body,
  );
}

const REASONS = {
  'needs-alt': (t) => t('sc.err.alt', 'Include Alt, so the key never collides with typing or a page’s own keys.'),
  altgr: (t) => t('sc.err.altgr', 'Ctrl+Alt is AltGr on many keyboards (it types @, # and {), so it cannot be a shortcut.'),
  reserved: (t) => t('sc.err.reserved', 'Your browser keeps this one for itself.'),
};

/** Settings → Keyboard shortcuts: every row this account can see, each one rebindable. */
export function ShortcutsCard({ className = '' }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const uid = uidOf(user);
  const overrides = useOverrides(uid);
  const touchOnly = useTouchOnly();
  const [editing, setEditing] = useState(null); // shortcut id listening for keys
  const [pending, setPending] = useState(null); // { combo, error?, conflict? }

  useEffect(() => {
    if (!editing) return undefined;
    setCapturing(true);
    const onKey = (e) => {
      if (isModifierKey(e)) return; // wait for the whole chord
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape' && !e.altKey) { setEditing(null); setPending(null); return; }
      const combo = comboFromEvent(e);
      if (!combo) return;
      const v = validateCombo(combo);
      if (!v.ok) { setPending({ combo, error: v.reason }); return; }
      const other = findConflict(editing, combo, readOverrides(uid));
      if (other) { setPending({ combo, conflict: other }); return; }
      setBinding(uid, editing, combo);
      setEditing(null); setPending(null);
    };
    // A released Alt would otherwise hand focus to the browser's menu in the middle of this.
    const onUp = (e) => { if (e.key === 'Alt') e.preventDefault(); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onUp, true);
    return () => {
      setCapturing(false);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onUp, true);
    };
  }, [editing, uid]);

  if (touchOnly) return null;

  const rows = SHORTCUTS.filter((s) => !s.route && visibleTo(s, { user }));
  const overridden = Object.keys(overrides).length > 0;
  const stop = () => { setEditing(null); setPending(null); };

  return (
    <Card className={`p-4 sm:p-5 ${className}`} id="shortcuts">
      <div className="flex items-center gap-2.5 mb-2 pb-2.5 border-b border-[var(--line)]">
        <span className="grid place-items-center w-7 h-7 rounded-lg tint-primary border b-primary shrink-0"><Keyboard size={14} className="text-[var(--accent-ink)]" /></span>
        <span className="text-sm font-semibold">{t('sc.set.t', 'Keyboard shortcuts')}</span>
        {overridden && (
          <Button size="sm" variant="ghost" className="ms-auto" onClick={() => { stop(); resetAllBindings(uid); }}>
            <RotateCcw size={13} /> {t('sc.set.resetall', 'Reset all')}
          </Button>
        )}
      </div>
      <p className="text-xs text-[var(--muted)] mb-2">{t('sc.set.s', 'Hold Alt on any page to see the shortcuts that work there. Saved in this browser, for this account.')}</p>
      <div className="sc-set-cols">
        {GROUPS.map(([g, label]) => {
          const list = rows.filter((s) => s.group === g);
          if (!list.length) return null;
          return (
            <section key={g}>
              <h3 className="sc-group-t mt-2">{g === 'page' ? t('sc.g.docs', 'In the documentation') : label(t)}</h3>
              {list.map((s) => {
                const combo = comboOf(s, overrides);
                const isEditing = editing === s.id;
                const changed = Object.prototype.hasOwnProperty.call(overrides, s.id);
                return (
                  <div key={s.id} className={`sc-set-row ${isEditing ? 'is-editing' : ''}`}>
                    <div className="flex items-center gap-2 min-h-[36px]">
                      <span className="flex-1 min-w-0 text-[13px] break-words">{s.label(t)}</span>
                      {isEditing
                        ? <span className="sc-listening" aria-live="polite">{t('sc.set.listen', 'Press the new keys…')}</span>
                        : combo ? <Keys combo={combo} /> : <span className="text-[11px] text-[var(--faint)]">{t('sc.set.none', 'Off')}</span>}
                      {!s.fixed && (
                        <span className="flex items-center shrink-0">
                          {isEditing ? (
                            <button type="button" className="sc-icon-btn" onClick={stop} aria-label={t('common.cancel', 'Cancel')} title={t('common.cancel', 'Cancel')}><X size={13} /></button>
                          ) : (
                            <button type="button" className="sc-icon-btn" onClick={() => { setPending(null); setEditing(s.id); }}
                              aria-label={t('sc.set.change', 'Change')} title={t('sc.set.change', 'Change')}><Pencil size={13} /></button>
                          )}
                          {!isEditing && combo && (
                            <button type="button" className="sc-icon-btn" onClick={() => setBinding(uid, s.id, '')}
                              aria-label={t('sc.set.off', 'Turn off')} title={t('sc.set.off', 'Turn off')}><X size={13} /></button>
                          )}
                          {!isEditing && changed && (
                            <button type="button" className="sc-icon-btn" onClick={() => resetBinding(uid, s.id)}
                              aria-label={t('sc.set.reset', 'Back to the default')} title={t('sc.set.reset', 'Back to the default')}><RotateCcw size={13} /></button>
                          )}
                        </span>
                      )}
                    </div>
                    {isEditing && pending?.error && (
                      <div className="sc-msg is-error" role="alert"><Keys combo={pending.combo} /> {REASONS[pending.error](t)}</div>
                    )}
                    {isEditing && pending?.conflict && (
                      <div className="sc-msg" role="alert">
                        <span><Keys combo={pending.combo} /> {t('sc.conflict', 'is already used by “{name}”.').replace('{name}', pending.conflict.label(t))}</span>
                        <span className="flex flex-wrap gap-2 mt-1.5">
                          {!pending.conflict.fixed && (
                            <Button size="sm" variant="primary" onClick={() => { takeBinding(uid, s.id, pending.combo, pending.conflict.id); stop(); }}>
                              {t('sc.conflict.take', 'Use it here, turn the other off')}
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => setPending(null)}>{t('sc.conflict.other', 'Try another')}</Button>
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </Card>
  );
}
