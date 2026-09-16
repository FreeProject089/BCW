// The site's GRADIENTS, as data.
//
// Every gradient on this site was written straight into index.css. Two of its ends were
// tokens (--primary / --primary-2), so a superadmin could recolour them — but nothing else
// was reachable: not the angle, not the stop positions, not how many stops there are, and
// not `.gradient-text`'s THIRD stop, which is a literal `#fbbf24`. That last one is the one
// people notice, because it is the headline on the landing page: pick a blue theme and the
// heading still fades into amber, and there is no field anywhere that explains why.
//
// So gradients get the same treatment the page glows already got: the geometry becomes a
// stored list, the stylesheet reads `var(--grad-x, <the shipped default>)`, and a site that
// never configures one renders byte-identically to before.
//
// A stop's colour may be a literal OR one of the accent tokens, so a gradient can stay tied
// to the accent pair and follow it when the accent changes. That is the default everywhere:
// the shipped look is the accent sweep.

/** The accent references a stop may use by name, instead of freezing a hex. */
export const STOP_REFS = ['var(--primary)', 'var(--primary-2)', 'var(--text)', 'var(--bg)'];

// Same rule as every other themed value, and it is the theme's own allowlist rather than a
// second shape check — a gradient stop lands in `.btn-primary { background: … }`, which is
// precisely a property that will fetch a `url()` if one reaches it. `safeColour` is the one
// place that decides what a colour is; this file does not get its own opinion.
import { safeColour } from './theme-colour.js';

export function safeStop(v) {
  const s = String(v ?? '').trim();
  if (!s || s.length > 120) return null;
  if (STOP_REFS.includes(s)) return s;
  // A BARE `var(--x)` is narrower here than in a page token. `safeColour` allows any theme
  // token because a derived surface is legitimately `color-mix(in srgb, var(--text) 12%, …)`,
  // but the API's gradient schema allows only the four accent references by exact string —
  // and a client that accepted `var(--anything)` would render a preview the save then
  // refuses. Which is the drift this whole allowlist exists to stop, so it does not get to
  // start here. A var() INSIDE a color-mix still goes through, as the server allows.
  if (/^var\(/i.test(s)) return null;
  return safeColour(s);
}

/**
 * The gradients the site actually paints with.
 *
 * `css` is the shipped default, written here in the SAME form the stylesheet falls back to —
 * the two must agree, or "reset to default" would change the look. `uses` is what the token
 * covers, so the editor can say what a change will hit rather than leaving it to be found.
 */
export const GRADIENTS = [
  {
    name: '--grad-primary', angle: 120,
    label: { en: 'Primary button', fr: 'Bouton principal' },
    affects: { en: 'Every primary button, the range slider’s knob, and anything filled with the brand.',
               fr: 'Tous les boutons principaux, le curseur des sliders, et tout ce qui est rempli avec la marque.' },
    stops: [{ color: 'var(--primary)' }, { color: 'var(--primary-2)' }],
  },
  {
    name: '--grad-text', angle: 110,
    label: { en: 'Gradient headings', fr: 'Titres en dégradé' },
    affects: { en: 'The landing page’s headline and every .gradient-text, its third stop was a hardcoded amber no theme could reach.',
               fr: 'Le titre de la page d’accueil et tout .gradient-text, sa troisième butée était un ambre en dur qu’aucun thème n’atteignait.' },
    stops: [{ color: 'var(--primary)' }, { color: 'var(--primary-2)', at: 70 }, { color: '#fbbf24' }],
  },
  {
    name: '--grad-bar', angle: 90,
    label: { en: 'Progress bars', fr: 'Barres de progression' },
    affects: { en: 'Upload/update progress fills and quota bars.', fr: 'Les barres de progression (envois, mises à jour) et de quota.' },
    stops: [{ color: 'var(--primary)' }, { color: 'var(--primary-2)' }],
  },
];

export const GRADIENTS_BY_NAME = Object.fromEntries(GRADIENTS.map((g) => [g.name, g]));
export const GRADIENT_NAMES = GRADIENTS.map((g) => g.name);

/**
 * One gradient spec → one CSS `linear-gradient(...)`.
 *
 * Returns null rather than a broken gradient when there is nothing usable to emit: a
 * gradient needs two stops, and one that emitted a single colour would silently paint a flat
 * block where the design expects a sweep.
 *
 * @param {{angle?: number, stops?: Array<{color: string, at?: number}>}} spec
 */
export function gradientCss(spec) {
  if (!spec || typeof spec !== 'object') return null;
  const angle = Number.isFinite(Number(spec.angle)) ? Math.max(0, Math.min(360, Number(spec.angle))) : 120;
  const stops = (Array.isArray(spec.stops) ? spec.stops : [])
    .slice(0, 8)
    .map((s) => {
      const color = safeStop(s?.color);
      if (!color) return null;
      // An unset position is left OUT rather than guessed: the browser distributes evenly,
      // and inventing percentages would make "I never touched the positions" and "I set them
      // to the even values" two different stored themes that look the same.
      const at = Number(s?.at);
      return Number.isFinite(at) ? `${color} ${Math.max(-100, Math.min(200, at))}%` : color;
    })
    .filter(Boolean);
  if (stops.length < 2) return null;
  return `linear-gradient(${angle}deg, ${stops.join(', ')})`;
}

/** The whole bag → the CSS declarations for a `:root` block. Unknown names are dropped. */
export function gradientVars(map) {
  if (!map || typeof map !== 'object') return '';
  return GRADIENT_NAMES
    .map((n) => [n, gradientCss(map[n])])
    .filter(([, css]) => css)
    .map(([n, css]) => `${n}:${css}`)
    .join(';');
}

/** The shipped spec for one gradient — what "reset" gives back, and what the editor starts from. */
export const defaultSpec = (name) => {
  const g = GRADIENTS_BY_NAME[name];
  return g ? { angle: g.angle, stops: g.stops.map((s) => ({ ...s })) } : null;
};

/**
 * Ready-made looks, so a superadmin who wants "something other than the accent sweep" is not
 * left to invent stop positions. Each is a function of the gradient's own default angle, so
 * a preset applied to the heading gradient stays a heading gradient.
 */
export const GRADIENT_PRESETS = [
  {
    id: 'accent', label: { en: 'Accent sweep', fr: 'Balayage d’accent' },
    build: (g) => ({ angle: g.angle, stops: [{ color: 'var(--primary)' }, { color: 'var(--primary-2)' }] }),
  },
  {
    id: 'shipped', label: { en: 'As shipped', fr: 'Tel que livré' },
    build: (g) => defaultSpec(g.name),
  },
  {
    id: 'flat', label: { en: 'Flat accent', fr: 'Accent plat' },
    // Two identical stops rather than one: gradientCss needs two, and a flat fill is a
    // legitimate choice (some brands do not do gradients at all).
    build: (g) => ({ angle: g.angle, stops: [{ color: 'var(--primary)' }, { color: 'var(--primary)' }] }),
  },
  {
    id: 'sharp', label: { en: 'Hard split', fr: 'Coupure nette' },
    build: (g) => ({ angle: g.angle, stops: [{ color: 'var(--primary)', at: 50 }, { color: 'var(--primary-2)', at: 50 }] }),
  },
  {
    id: 'fade', label: { en: 'Fade to page', fr: 'Fondu vers la page' },
    build: (g) => ({ angle: g.angle, stops: [{ color: 'var(--primary)' }, { color: 'var(--bg)' }] }),
  },
  {
    id: 'tri', label: { en: 'Three-stop', fr: 'Trois butées' },
    build: (g) => ({ angle: g.angle, stops: [{ color: 'var(--primary)' }, { color: 'var(--primary-2)', at: 60 }, { color: 'var(--text)' }] }),
  },
];
