// The keyboard-shortcut registry: ONE list, read by the global key handler, the hold-Alt
// overlay, the ⌘K palette (the key hint beside a row) and the Settings rebind panel.
//
// WHAT A SHORTCUT MAY DO
// Navigate, or press a button the page already has. Nothing else. A shortcut is a faster way
// to reach a screen, never a way around the rule that guards it: "Admin" only navigates to
// /admin, which is still <Protected> in the router and whose every call is still authorised by
// the API. The `when` predicates below only decide what is DRAWN in the overlay and the
// settings list, and they are the nav's own predicates (lib/roles.js), imported, never
// re-derived: a key that appears for somebody the topbar hides the button from would be the
// preview/topbar drift all over again.
//
// WHY ALT
// Every rebindable shortcut carries Alt. Bare keys belong to the pages that already use them
// (the studio: G, 0, +, -, Space; the lookalike-picture review: J, K, A, C…), and Ctrl/⌘ belongs
// to the browser and to text editing. Alt is the one modifier the site can own, and it is also
// the key you hold to SEE the list. Ctrl+Alt is refused because on Windows that IS AltGr, the
// key a French keyboard types @, # and { with.
//
// Storage is per account (per browser): a map of overrides keyed by the signed-in user's id,
// or "anon". Only overrides are stored, so a default changed in a later release reaches
// everybody who never touched that row.

import { utilAllowed } from './roles.js';

const EVENT = 'bcw:shortcuts-changed';
const KEY_PREFIX = 'bcw.shortcuts.v1:';

// ── Combos ─────────────────────────────────────────────────────────────────────
// Canonical text: modifiers in a fixed order, then the key, lowercase: "alt+h", "alt+shift+n",
// "alt+/", "ctrl+k", "alt+arrowup". A symbol key never carries "shift": on one layout "/" needs
// Shift and on another it does not, and the character is what the person pressed.

const MOD_ORDER = ['ctrl', 'meta', 'alt', 'shift'];
const CODE_KEYS = {
  Slash: '/', Comma: ',', Period: '.', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`', Space: 'space',
};
const MODIFIER_KEYS = new Set(['Alt', 'AltGraph', 'Control', 'Shift', 'Meta', 'OS', 'Hyper', 'Super', 'CapsLock', 'Fn']);

export const isModifierKey = (e) => MODIFIER_KEYS.has(e?.key);

/** The canonical combo for a keydown, or null for a lone modifier. */
export function comboFromEvent(e) {
  if (!e || MODIFIER_KEYS.has(e.key)) return null;
  let key = String(e.key || '');
  // With Alt/Option held, macOS types a different character (⌥H is "˙"), so the PHYSICAL key
  // is the only stable answer there. Everywhere else the character wins, which is what makes
  // Alt+A mean the key printed A on an AZERTY keyboard too.
  const ascii = /^[\x21-\x7e]$/.test(key);
  if (!ascii || key === ' ') {
    const c = String(e.code || '');
    if (/^Key[A-Z]$/.test(c)) key = c.slice(3).toLowerCase();
    else if (/^Digit[0-9]$/.test(c)) key = c.slice(5);
    else if (CODE_KEYS[c]) key = CODE_KEYS[c];
    else key = key.toLowerCase();
  } else {
    key = key.toLowerCase();
  }
  if (!key || key === 'unidentified' || key === 'dead') return null;
  const symbol = key.length === 1 && !/[a-z0-9]/.test(key);
  const mods = [];
  if (e.ctrlKey) mods.push('ctrl');
  if (e.metaKey) mods.push('meta');
  if (e.altKey) mods.push('alt');
  if (e.shiftKey && !symbol) mods.push('shift');
  return [...mods, key].join('+');
}

export function parseCombo(combo) {
  const parts = String(combo || '').split('+');
  // "alt++" is Alt and the plus key.
  let key = parts.pop();
  if (key === '' && parts[parts.length - 1] === '') { parts.pop(); key = '+'; }
  const mods = new Set(parts);
  return { key, ctrl: mods.has('ctrl'), meta: mods.has('meta'), alt: mods.has('alt'), shift: mods.has('shift') };
}

export const isMac = () => {
  try { return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || ''); } catch { return false; }
};

const KEY_NAMES = { arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', space: 'Space', escape: 'Esc', enter: 'Enter', delete: 'Del', backspace: '⌫', tab: 'Tab' };

/** The key caps to draw for a combo: ["Alt", "H"], or ["⌥", "H"] on a Mac. */
export function comboCaps(combo, mac = isMac()) {
  if (!combo) return [];
  const p = parseCombo(combo);
  const caps = [];
  if (p.ctrl) caps.push(mac ? '⌃' : 'Ctrl');
  if (p.meta) caps.push(mac ? '⌘' : 'Win');
  if (p.alt) caps.push(mac ? '⌥' : 'Alt');
  if (p.shift) caps.push(mac ? '⇧' : 'Shift');
  caps.push(KEY_NAMES[p.key] || (p.key.length === 1 ? p.key.toUpperCase() : p.key));
  return caps;
}

/** "Ctrl+K", or "⌘K" on a Mac, for the palette's own key. */
export const paletteCombo = () => (isMac() ? 'meta+k' : 'ctrl+k');

// Combos the browser or the OS keeps for itself: binding one would either never fire or take
// away something people rely on. Alt+D/E/F are Chrome's and Edge's address bar and menu,
// Alt+arrows are Back/Forward, Alt+Home is the home page.
const RESERVED = new Set([
  'alt+d', 'alt+e', 'alt+f', 'alt+arrowleft', 'alt+arrowright', 'alt+home', 'alt+tab', 'alt+space',
  'alt+escape', 'alt+f4', 'alt+enter',
]);

/**
 * Is this combo acceptable as a rebind at all? (Conflicts are a separate question.)
 * → { ok: true } | { ok: false, reason: 'needs-alt' | 'altgr' | 'reserved' }
 */
export function validateCombo(combo) {
  const p = parseCombo(combo);
  if (!p.alt) return { ok: false, reason: 'needs-alt' };
  if (p.ctrl) return { ok: false, reason: 'altgr' };
  if (RESERVED.has(combo)) return { ok: false, reason: 'reserved' };
  return { ok: true };
}

// ── The registry ──────────────────────────────────────────────────────────────
// Kinds:
//   to      — navigate there
//   action  — a built-in action run by the host (theme, language, scroll to top, palette)
//   handler — a PAGE action: shown and live only while a mounted page registered a handler
//             for this id (useShortcutHandlers), so "On this page" is always true
//   fixed   — informational: a key another component owns (⌘K, the studio's keys). Listed so
//             the overlay tells the whole truth and a rebind cannot collide with it; never
//             rebindable, never run by the host.
//
// `when(ctx)` decides who SEES it; ctx = { user }. `route` limits a fixed row to a path.
// `palette` is the id of the matching ⌘K row, so the palette can draw the key beside it.
// Labels are literal t() calls so the i18n checker can see them.

const signedIn = (k) => ({ user }) => utilAllowed(k, user);

export const SHORTCUTS = [
  // Go to
  { id: 'go.home', group: 'nav', combo: 'alt+h', to: '/', palette: 'page:/', label: (t) => t('sc.go.home', 'Home') },
  { id: 'go.catalog', group: 'nav', combo: 'alt+c', to: '/catalog', palette: 'page:/catalog', label: (t) => t('sc.go.catalog', 'Catalog') },
  { id: 'go.repos', group: 'nav', combo: 'alt+r', to: '/repos', palette: 'page:/repos', label: (t) => t('sc.go.repos', 'Server-Repos') },
  { id: 'go.blog', group: 'nav', combo: 'alt+b', to: '/blog', palette: 'page:/blog', label: (t) => t('sc.go.blog', 'Blog') },
  { id: 'go.docs', group: 'nav', combo: 'alt+g', to: '/docs', palette: 'page:/docs', label: (t) => t('sc.go.docs', 'Documentation') },
  { id: 'go.faq', group: 'nav', combo: 'alt+q', to: '/faq', palette: 'page:/faq', label: (t) => t('sc.go.faq', 'FAQ') },
  { id: 'go.hosting', group: 'nav', combo: '', to: '/hosting', palette: 'page:/hosting', label: (t) => t('sc.go.hosting', 'Hosting') },
  { id: 'go.contact', group: 'nav', combo: '', to: '/contact', palette: 'page:/contact', label: (t) => t('sc.go.contact', 'Contact') },
  { id: 'go.notifications', group: 'nav', combo: 'alt+n', to: '/notifications', palette: 'page:/notifications', when: signedIn('notifications'), label: (t) => t('sc.go.notifications', 'Notifications') },
  { id: 'go.dashboard', group: 'nav', combo: 'alt+m', to: '/dashboard', palette: 'act:dashboard', when: signedIn('dashboard'), label: (t) => t('sc.go.dashboard', 'My dashboard') },
  { id: 'go.profile', group: 'nav', combo: 'alt+p', to: '/profile', palette: 'page:/profile', when: signedIn('profile'), label: (t) => t('sc.go.profile', 'My profile') },
  { id: 'go.admin', group: 'nav', combo: 'alt+a', to: '/admin', palette: 'act:admin', when: signedIn('admin'), label: (t) => t('sc.go.admin', 'Admin dashboard') },
  { id: 'go.settings', group: 'nav', combo: 'alt+,', to: '/settings', palette: 'page:/settings', label: (t) => t('sc.go.settings', 'Settings') },
  // Actions
  { id: 'act.theme', group: 'act', combo: 'alt+t', action: 'theme', palette: 'act:theme', label: (t) => t('sc.act.theme', 'Toggle dark / light theme') },
  { id: 'act.lang', group: 'act', combo: 'alt+l', action: 'lang', palette: 'act:lang', label: (t) => t('sc.act.lang', 'Switch language') },
  { id: 'act.top', group: 'act', combo: 'alt+u', action: 'top', palette: 'act:top', label: (t) => t('sc.act.top', 'Scroll to top') },
  { id: 'act.palette', group: 'act', combo: 'ctrl+k', fixed: true, label: (t) => t('sc.act.palette', 'Search everything (command palette)') },
  // On this page: registered by the page that owns the action.
  { id: 'docs.search', group: 'page', combo: 'alt+/', handler: true, label: (t) => t('sc.docs.search', 'Search the documentation') },
  { id: 'docs.sidebar', group: 'page', combo: 'alt+s', handler: true, label: (t) => t('sc.docs.sidebar', 'Show or hide the docs sidebar') },
  // The dashboards' OS mode (M1, ui/os/os-shell.jsx): live only while a dashboard is shown as
  // windows. Letters, not arrows or Tab: Alt+Tab and Alt+arrows belong to the OS and the browser.
  { id: 'os.launcher', group: 'os', combo: 'alt+o', handler: true, label: (t) => t('sc.os.launcher', 'Open the start menu and search') },
  { id: 'os.next', group: 'os', combo: 'alt+j', handler: true, label: (t) => t('sc.os.next', 'Next window') },
  { id: 'os.prev', group: 'os', combo: 'alt+k', handler: true, label: (t) => t('sc.os.prev', 'Previous window') },
  // The studio's own keys (editor/canvas-studio.jsx). Listed, never run from here.
  { id: 'studio.keys', group: 'page', combo: '?', fixed: true, route: /^\/studio\//, label: (t) => t('sc.studio.keys', 'Studio: every key') },
  { id: 'studio.pan', group: 'page', combo: 'space', fixed: true, route: /^\/studio\//, label: (t) => t('sc.studio.pan', 'Studio: hold to pan') },
  { id: 'studio.grid', group: 'page', combo: 'g', fixed: true, route: /^\/studio\//, label: (t) => t('sc.studio.grid', 'Studio: grid on or off') },
  { id: 'studio.fit', group: 'page', combo: '0', fixed: true, route: /^\/studio\//, label: (t) => t('sc.studio.fit', 'Studio: fit to screen') },
  { id: 'studio.undo', group: 'page', combo: 'ctrl+z', fixed: true, route: /^\/studio\//, label: (t) => t('sc.studio.undo', 'Studio: undo') },
  { id: 'studio.dup', group: 'page', combo: 'ctrl+d', fixed: true, route: /^\/studio\//, label: (t) => t('sc.studio.dup', 'Studio: duplicate') },
];

const BY_ID = new Map(SHORTCUTS.map((s) => [s.id, s]));
export const shortcutById = (id) => BY_ID.get(id) || null;

/** The studio owns the keyboard on its own surface: the site's Alt keys stand down there. */
export const siteKeysPaused = (path) => /^\/studio\//.test(path || '');

// ── Page handlers ─────────────────────────────────────────────────────────────
// A mounted page registers the functions behind its `handler` rows. Module state plus one
// event, like the palette's open bus: lifting this into React context would re-render the
// whole shell whenever a page mounted.
const handlers = new Map();
export function setHandlers(map) {
  for (const [id, fn] of Object.entries(map || {})) if (typeof fn === 'function') handlers.set(id, fn);
  changed();
  return () => { for (const id of Object.keys(map || {})) if (handlers.get(id) === map[id]) handlers.delete(id); changed(); };
}
export const handlerFor = (id) => handlers.get(id) || null;

// While the Settings panel is listening for a new combo, every key belongs to it: the host
// must not also navigate on the Alt+H somebody is trying to assign.
let capturing = false;
export const setCapturing = (v) => { capturing = !!v; };
export const isCapturing = () => capturing;

// ── Bindings (per account, this browser) ─────────────────────────────────────
const keyFor = (uid) => `${KEY_PREFIX}${uid || 'anon'}`;

export function readOverrides(uid) {
  try {
    const v = JSON.parse(localStorage.getItem(keyFor(uid)) || '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out = {};
    for (const [id, c] of Object.entries(v)) if (BY_ID.has(id) && !BY_ID.get(id).fixed && typeof c === 'string') out[id] = c;
    return out;
  } catch { return {}; }
}

function writeOverrides(uid, map) {
  try { localStorage.setItem(keyFor(uid), JSON.stringify(map)); } catch { /* private window: this session only */ }
  changed();
}

function changed() { try { window.dispatchEvent(new CustomEvent(EVENT)); } catch { /* no window */ } }
export function onShortcutsChanged(fn) {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

/** The combo in force for one shortcut: the override if there is one ('' = switched off). */
export function comboOf(s, overrides) {
  if (!s) return '';
  if (s.id === 'act.palette') return paletteCombo();
  if (!s.fixed && Object.prototype.hasOwnProperty.call(overrides || {}, s.id)) return overrides[s.id];
  return s.combo || '';
}

/**
 * Who else already answers to this combo? Checked against EVERY row, including the ones this
 * person cannot see and the fixed ones: a binding has to be unique for the account, not just
 * for today's role, and a page's own key must never be shadowed.
 */
export function findConflict(id, combo, overrides) {
  if (!combo) return null;
  for (const s of SHORTCUTS) {
    if (s.id === id) continue;
    if (comboOf(s, overrides) === combo || (s.fixed && s.combo === combo)) return s;
  }
  return null;
}

export function setBinding(uid, id, combo) {
  const s = BY_ID.get(id);
  if (!s || s.fixed) return;
  const o = readOverrides(uid);
  if ((s.combo || '') === combo) delete o[id]; else o[id] = combo;
  writeOverrides(uid, o);
}

/** Bind `id` to `combo` and switch the row that held it off, in one write. */
export function takeBinding(uid, id, combo, fromId) {
  const o = readOverrides(uid);
  const s = BY_ID.get(id); const other = BY_ID.get(fromId);
  if (!s || s.fixed) return;
  if (other && !other.fixed) o[fromId] = '';
  if ((s.combo || '') === combo) delete o[id]; else o[id] = combo;
  writeOverrides(uid, o);
}

export function resetBinding(uid, id) {
  const o = readOverrides(uid);
  delete o[id];
  writeOverrides(uid, o);
}

export function resetAllBindings(uid) { writeOverrides(uid, {}); }

// ── Who sees what, where ─────────────────────────────────────────────────────
export function visibleTo(s, ctx) { return !s.when || !!s.when(ctx || {}); }

/**
 * The rows live right now on `path` for this viewer, with their combos resolved.
 * `includeUnbound` keeps rows with no key (the Settings list wants them; the overlay not).
 */
export function activeShortcuts({ user, path, overrides, includeUnbound = false }) {
  const out = [];
  for (const s of SHORTCUTS) {
    if (!visibleTo(s, { user })) continue;
    if (s.route && !s.route.test(path || '')) continue;
    if (s.handler && !handlers.has(s.id)) continue;
    const combo = comboOf(s, overrides);
    if (!combo && !includeUnbound) continue;
    out.push({ ...s, combo });
  }
  return out;
}

// ── Environment ───────────────────────────────────────────────────────────────
/**
 * A device with no keyboard to speak of: no input that can hover and no fine pointer. Every
 * key hint is hidden there (the overlay, the palette's hints, the Settings panel), because a
 * hint for a key you do not have is noise. A touchscreen laptop still has a trackpad, so it
 * keeps them.
 */
export function isTouchOnly() {
  try {
    const mm = window.matchMedia;
    if (!mm) return false;
    return !mm('(any-hover: hover)').matches && !mm('(any-pointer: fine)').matches;
  } catch { return false; }
}

/** Is the keystroke going into something that takes text? Then it is typing, not a shortcut. */
export function isTypingTarget(el) {
  if (!el || el === document.body) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'].includes(type);
  }
  const role = el.getAttribute?.('role');
  return role === 'textbox' || role === 'combobox' || role === 'searchbox';
}
