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
  appIcons: { bmm: '/icons/bmm.png', bsm: '/icons/bsm.png', bi: '/icons/bi.png', installer: '/icons/bi.png', bc: '/logo.png' },
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
