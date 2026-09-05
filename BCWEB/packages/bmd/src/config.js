// One place to point B.MD at a host application.
//
// Everything specific to one site by VALUE rather than by import lives here: the `app:` logo
// paths, the URL policy, and whether icons may be fetched from a CDN. It was three separate
// mechanisms — a `configureMarkdown({ appIcons })` that only did icons, a hard-coded jsdelivr
// URL, and a sanitiser schema you had to edit — so a project adopting the kit had one knob
// and two forks.
//
// Module-level rather than a context, deliberately: `IconGlyph` is exported and used OUTSIDE
// `<Markdown>` (icon pickers, reaction rows), where no provider is in scope. Call
// `configureMarkdown` once, at import time, before anything renders.
import { createContext } from 'react';

/**
 * What this renderer needs from the app around it — and the reason it is a context and not
 * three imports.
 *
 * `lang` is here because two blocks label themselves, and reaching into the host app's i18n
 * provider is an import that only works in one repo. `Roadmap` and `Replay` are the OVERRIDES:
 * B.MD ships a working component for each (roadmap.jsx, replay.jsx), and a project with a
 * better one passes it in.
 */
export const MarkdownConfig = createContext({
  lang: 'en',
  /** ({ data, title, lang }) => node — replaces the built-in `:::roadmap`. */
  Roadmap: null,
  /** ({ src, title, autoplay, loop }) => node — replaces the built-in `:::replay`. */
  Replay: null,
});

const DEFAULTS = {
  /** `app:<key>` → an image URL. */
  appIcons: { bmm: '/icons/bmm.png', bsm: '/icons/bsm.png', bi: '/icons/bi.svg', installer: '/icons/bi.svg', bc: '/logo.png' },
  /** `app:<key>` → the name a picker shows beside the mark. */
  appIconLabels: { bmm: 'BetterModsManager', bsm: 'BetterSoundMaker', bi: 'BetterInstaller', bc: 'BetterCommunity' },
  /**
   * Where an icon that is not bundled comes from.
   *
   * `null` for either family turns it off: the glyph falls back to a neutral one and NOTHING
   * is fetched. That is the switch a project behind a strict CSP — or one that would rather
   * not tell a third party which page a reader is on — actually needs, and the alternative
   * was editing two template literals in the middle of a renderer.
   */
  cdn: {
    lucide: (name) => `https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/${name}.svg`,
    brand: (slug) => `https://cdn.simpleicons.org/${slug}`,
    // Phosphor, drawn as a mask like lucide. `name` arrives as `<weight>/<file>` — see
    // phosphorRef in icons.jsx — so a project can point this at its own copy of the assets.
    phosphor: (path) => `https://cdn.jsdelivr.net/npm/@phosphor-icons/core@2/assets/${path}.svg`,
  },
  /**
   * Where authored URLs may point. See url.js for what each field does.
   *
   * Empty by default: a documentation platform whose authors are staff should not need an
   * allowlist, and one whose authors are the public very much does.
   */
  policy: {
    /** Hostnames (and their subdomains) links may point at. Empty = any https host. */
    allowHosts: null,
    /** The same, for `:::file` download buttons, when it should be narrower. */
    allowDownloadHosts: null,
    /** Protocols, as a RegExp or an array of scheme names. Default: http(s), mailto, tel, xmpp, irc. */
    allowProtocols: null,
    /** (url, { kind, host }) => url — a last-chance rewrite, e.g. through a redirect notice. */
    rewrite: null,
  },
  /** Which iframes survive sanitising. One regexp, because the answer is a list of hosts. */
  allowIframes: /^https:\/\/(www\.)?youtube(-nocookie)?\.com\//i,
};

let CURRENT = { ...DEFAULTS };

/**
 * Point B.MD at your project. Call once, at import time.
 *
 * Merged one level deep so `configureMarkdown({ cdn: { lucide: null } })` keeps the brand
 * loader — a shallow replace would silently switch off the half you did not mention.
 */
export function configureMarkdown(next = {}) {
  CURRENT = {
    ...CURRENT,
    ...next,
    appIcons: next.appIcons ? { ...next.appIcons } : CURRENT.appIcons,
    appIconLabels: next.appIconLabels ? { ...next.appIconLabels } : CURRENT.appIconLabels,
    cdn: next.cdn ? { ...CURRENT.cdn, ...next.cdn } : CURRENT.cdn,
    policy: next.policy ? { ...CURRENT.policy, ...next.policy } : CURRENT.policy,
  };
}

/** The whole current configuration, for a caller that wants to read one field. */
export const markdownConfig = () => CURRENT;

/** The URL policy, as url.js expects it. */
export const urlPolicy = () => CURRENT.policy;

/** `app:<key>` → its image URL, or '' when the host never configured one. */
export const appIcon = (key) => CURRENT.appIcons[key] || '';
/** `app:<key>` → its display name, falling back to the key. */
export const appIconLabel = (key) => CURRENT.appIconLabels?.[key] || key;

/**
 * Add (or override) app icons at runtime — what the site does once its admin-managed list
 * arrives with the theme. Additive: the bundled marks stay unless a stored entry names the
 * same key, in which case the stored image wins (a redesigned logo needs no deploy).
 */
export function registerAppIcons(list = []) {
  const icons = { ...CURRENT.appIcons }, labels = { ...CURRENT.appIconLabels };
  for (const it of Array.isArray(list) ? list : []) {
    if (!it?.key || !it?.url) continue;
    icons[it.key] = it.url;
    if (it.label) labels[it.key] = it.label;
  }
  CURRENT = { ...CURRENT, appIcons: icons, appIconLabels: labels };
}

/**
 * The `app:` keys worth offering in a picker.
 *
 * A function, not a const: a const is computed once at module load, which is BEFORE the host
 * app has had a chance to call `configureMarkdown` — so a project that supplied its own icons
 * would get a picker listing ours.
 */
export const appIconKeys = () => Object.keys(CURRENT.appIcons).filter((k) => k !== 'installer');

/** The URL for a remote icon, or '' when that family is switched off. */
export function cdnIconUrl(family, name) {
  const fn = CURRENT.cdn?.[family];
  return typeof fn === 'function' ? String(fn(name) || '') : '';
}
