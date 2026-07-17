// One reader for the desktop topbar layout, imported by BOTH the real topbar (App.jsx) and
// the admin Live preview (admin.jsx). The two used to drift; the fix everywhere in this app is
// a single shared source, not two copies of the same rule.
//
// nav.config.layout = { align, density, labels }. Every field is optional; missing → the
// defaults below, which reproduce the current look, so an install with no layout set is
// unchanged.

export const DEFAULT_LAYOUT = { align: 'start', density: 'comfortable', labels: 'both' };

export function readLayout(layout) {
  const l = layout || {};
  return {
    align: ['start', 'center', 'end'].includes(l.align) ? l.align : DEFAULT_LAYOUT.align,
    density: ['comfortable', 'compact'].includes(l.density) ? l.density : DEFAULT_LAYOUT.density,
    labels: ['both', 'icons'].includes(l.labels) ? l.labels : DEFAULT_LAYOUT.labels,
  };
}

// Classes for the nav's position in the bar. The topbar is [logo | nav | utilities]; the nav
// lives in a flex-1 track, and this sets where the pills sit inside it.
export function navAlignClass(align) {
  return align === 'center' ? 'justify-center' : align === 'end' ? 'justify-end' : 'justify-start';
}

// Per-pill spacing/padding. Compact tightens the gaps and padding so more items fit before the
// bar has to scroll; comfortable is the roomy default.
export function pillDensity(density) {
  return density === 'compact'
    ? { gap: 'gap-0.5', pad: '!px-2 !py-1.5', railGap: 'gap-0.5' }
    : { gap: 'gap-1', pad: '', railGap: 'gap-1' };
}

// labels === 'icons' hides the text next to each icon (still in the DOM for screen readers via
// the existing title/aria-label, just visually hidden). Returns the class to put on the label
// span; 'both' shows it.
export function labelClass(labels) {
  return labels === 'icons' ? 'sr-only' : '';
}
