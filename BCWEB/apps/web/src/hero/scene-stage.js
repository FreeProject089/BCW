// Who draws the 3D scene on this page: ONE WebGL context, whoever asks.
//
// Two things can draw a scene: the site's backdrop (Hero3D, mounted by App.jsx on every page)
// and a studio page whose background is `scene3d` (ui/canvas-background.jsx). A page has one
// scene (PLAN-STUDIO-2026, 2.4): a page that brings its own takes the stage, the backdrop steps
// down (App.jsx stops rendering it, and its cleanup releases its context), and when the page
// goes away the backdrop comes back. Two canvases on one page that both ask (two home sections
// with a 3D background) do not get two contexts either: the FIRST claim draws live, the others
// get the still CSS drawing.
//
// A plain store rather than a React context: the claimant is deep in a page and App.jsx is the
// root, and a context would have to be provided above both by a component that does nothing
// else. No three.js here, on purpose: App.jsx imports this on every page.
let claims = [];
const listeners = new Set();
const emit = () => { for (const fn of listeners) fn(); };

/** Take the stage. Returns the function that gives it back (idempotent). */
export function claimStage(token) {
  const t = token || {};
  claims = [...claims, t];
  emit();
  return () => {
    if (!claims.includes(t)) return;
    claims = claims.filter((c) => c !== t);
    emit();
  };
}

/** Is any page scene claiming the stage? (App.jsx: then the site backdrop is not rendered.) */
export const stageClaimed = () => claims.length > 0;
/** Does THIS claim own the live scene? Only the first one does. */
export const ownsStage = (token) => claims[0] === token;

export function subscribeStage(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
