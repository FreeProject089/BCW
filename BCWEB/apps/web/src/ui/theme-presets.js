// Complete looks for the site theme.
//
// A preset used to be two colours. That was the whole theme once; it is not any more — the
// theme now carries per-mode page colours, a surface ramp derived from them, three gradients
// and a set of status tints. And because picking a preset CLEARS the other bags (so it renders
// as designed rather than over somebody's half-finished edit), a two-colour preset actively
// reset the page back to the shipped cream and near-black. "Pick a look" produced a new accent
// on the old page.
//
// So a preset is a look: an accent pair, the page and text colour for each mode, and the
// gradients where they are part of the identity. Everything else still derives — `surfaceVars`
// builds the ~15 surface, line and ink tokens from `bg` + `text`, so a preset stays a handful
// of decisions rather than a frozen copy of the stylesheet.
//
// Contrast is not left to taste. Every `text` on its `bg` clears WCAG AA for body text (4.5:1),
// and the editor shows the measured ratio beside the fields — a pastel accent that cannot be
// written on is a real outcome and the panel says so rather than hiding it.
//
// ABOUT THE PANTONE NAMES: Pantone's libraries are proprietary and the exact sRGB coordinates
// are licensed data. The three below are the widely-published approximations, used as NAMES and
// starting points. They are not, and must not be presented as, official Pantone values —
// anything colour-critical needs a real Pantone reference, not this file.

/** The `light`/`dark` a preset may carry: the two colours everything else derives from. */
const page = (bg, text) => ({ bg, text });
/** An accent sweep at a given angle — the shape all three gradients take by default. */
const sweep = (angle) => ({ angle, stops: [{ color: 'var(--primary)' }, { color: 'var(--primary-2)' }] });
/** The three gradients as one accent sweep, which is what most looks want: the shipped
 *  `--grad-text` ends on a fixed amber, and that is exactly the stop a new palette should not
 *  inherit. */
const accentGradients = () => ({
  '--grad-primary': sweep(120),
  '--grad-text': { angle: 110, stops: [{ color: 'var(--primary)' }, { color: 'var(--primary-2)', at: 70 }, { color: 'var(--primary)' }] },
  '--grad-bar': sweep(90),
});

export const THEME_PRESETS = [
  {
    id: 'bcw', name: 'BetterCommunity', sub: 'Default', accent: '#f97316', accent2: '#f59e0b',
    // The shipped look, and the only preset that carries NO page colours or gradients on
    // purpose: picking it has to give back exactly what the stylesheet defines, including the
    // amber third stop in the heading gradient. A copy of the built-ins here would freeze them.
  },
  {
    id: 'midnight', name: 'Midnight', sub: 'Deep blue, dark-first',
    accent: '#6366f1', accent2: '#8b5cf6',
    light: page('#f2f3f9', '#14161f'), dark: page('#0a0b12', '#eceefb'),
    gradients: accentGradients(),
  },
  {
    id: 'forest', name: 'Forest', sub: 'Green, calm',
    accent: '#10b981', accent2: '#65a30d',
    light: page('#f1f6f1', '#121a14'), dark: page('#080d0a', '#e8f2ea'),
    gradients: accentGradients(),
  },
  {
    id: 'ocean', name: 'Ocean', sub: 'Cyan and teal',
    accent: '#0891b2', accent2: '#14b8a6',
    light: page('#eff6f8', '#0e1a1d'), dark: page('#061014', '#e4f1f4'),
    gradients: accentGradients(),
  },
  {
    id: 'ember', name: 'Ember', sub: 'Warm red',
    accent: '#dc2626', accent2: '#ea580c',
    light: page('#faf1ef', '#1a1210'), dark: page('#120907', '#f6e9e5'),
    gradients: accentGradients(),
  },
  {
    id: 'grape', name: 'Grape', sub: 'Purple and magenta',
    accent: '#9333ea', accent2: '#db2777',
    light: page('#f7f1fa', '#170f1c'), dark: page('#0e0713', '#f0e6f6'),
    gradients: accentGradients(),
  },
  {
    id: 'slate', name: 'Slate', sub: 'Neutral, minimal',
    // The one look with no hue in the page at all: the accent is the only colour on screen,
    // which is what a documentation or a dashboard site usually wants.
    accent: '#475569', accent2: '#0ea5e9',
    light: page('#f4f5f7', '#14171c'), dark: page('#0b0d10', '#e9ecf1'),
    gradients: accentGradients(),
  },
  {
    id: 'mono', name: 'Monochrome', sub: 'One colour, no gradient',
    accent: '#111827', accent2: '#111827',
    light: page('#f6f6f6', '#111827'), dark: page('#0a0a0a', '#f2f2f2'),
    // Deliberately FLAT: two identical stops. A brand that does not do gradients is a real
    // choice, and it cannot be expressed by picking colours alone.
    gradients: {
      '--grad-primary': { angle: 120, stops: [{ color: 'var(--primary)' }, { color: 'var(--primary)' }] },
      '--grad-text': { angle: 110, stops: [{ color: 'var(--primary)' }, { color: 'var(--primary)' }] },
      '--grad-bar': { angle: 90, stops: [{ color: 'var(--primary)' }, { color: 'var(--primary)' }] },
    },
  },
  {
    id: 'sand', name: 'Sand', sub: 'Warm neutral, editorial',
    accent: '#b45309', accent2: '#d97706',
    light: page('#f7f3ec', '#1c1710'), dark: page('#12100c', '#f2ece1'),
    gradients: accentGradients(),
  },
  {
    id: 'rose', name: 'Rose', sub: 'Soft pink',
    accent: '#e11d48', accent2: '#f43f5e',
    light: page('#faf0f2', '#1c1013'), dark: page('#120709', '#f6e7ea'),
    gradients: accentGradients(),
  },

  // ── Pantone Colours of the Year, as starting points ─────────────────────────────────
  // Kept because they are useful prompts, trimmed to the three that actually read as a site
  // rather than as a swatch. Each carries a page pair so it is a look and not a lone accent.
  {
    id: 'coty-2020', name: 'Classic Blue', sub: 'Colour of the Year 2020',
    accent: '#0f4c81', accent2: '#1a6ba8',
    light: page('#f0f3f7', '#101720'), dark: page('#070b11', '#e6edf5'),
    gradients: accentGradients(),
  },
  {
    id: 'coty-2023', name: 'Viva Magenta', sub: '2023',
    accent: '#be3455', accent2: '#d9556f',
    light: page('#faf0f2', '#1b1013'), dark: page('#120709', '#f5e7ea'),
    gradients: accentGradients(),
  },
  {
    id: 'coty-2025', name: 'Mocha Mousse', sub: '2025',
    accent: '#a47864', accent2: '#bf9483',
    light: page('#f7f2ee', '#1a1512'), dark: page('#120e0b', '#f0e8e2'),
    gradients: accentGradients(),
  },
];
