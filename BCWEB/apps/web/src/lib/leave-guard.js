// "You have unsaved changes" for every admin editor, from one place.
//
// Three ways out of an editor lose a draft, and each needs its own catch:
//   1. Closing the tab or reloading: `beforeunload`, the only thing a browser lets a page say.
//   2. An in-app link (the topbar, a "see the page" link, the guide link): a capture-phase click
//      listener on the document, which holds the click, asks, and replays it if the answer is
//      "leave". Replaying the SAME element's click is what keeps react-router, target, modifiers
//      and every per-link handler exactly as they were: nothing here re-implements navigation.
//   3. Switching admin section: SideDash's own `set(id)` asks `confirmLeave()` first. It is a
//      button, not a link, so (2) never sees it.
//
// The app is a <BrowserRouter>, not a data router, so react-router's useBlocker is not
// available; this is the small, explicit version of it.
//
// A guard is registered by an editor while it is dirty (SaveBar does it), with the dialog and
// the translator of the component that registered it, because the question is asked from
// module code that has no React context of its own.

const guards = new Map(); // id -> { dialog, t, label }
let seq = 0;
let bypass = false;

export const hasDirtyGuard = () => guards.size > 0;

/** Ask whether to leave, if anything is dirty. Resolves true when it is fine to go. */
export async function confirmLeave() {
  if (!guards.size) return true;
  const list = [...guards.values()];
  const { dialog, t } = list[list.length - 1];
  const names = list.map((g) => g.label).filter(Boolean);
  if (!dialog?.confirm) return true;
  return dialog.confirm({
    title: t('savebar.leave.t', 'Leave without saving?'),
    message: names.length
      ? t('savebar.leave.mn', 'Unsaved changes in: {names}. They will be lost.').replace('{names}', names.join(', '))
      : t('savebar.leave.m', 'You have unsaved changes on this screen. They will be lost.'),
    okLabel: t('savebar.leave.ok', 'Discard and leave'),
    danger: true,
  });
}

function onBeforeUnload(e) {
  if (!guards.size) return undefined;
  e.preventDefault();
  e.returnValue = '';
  return '';
}

function onClickCapture(e) {
  if (bypass || !guards.size || e.defaultPrevented) return;
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target?.closest?.('a[href]');
  if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
  // Only links that leave this screen. An in-page anchor or a link to the very same URL
  // does not lose anything.
  let url;
  try { url = new URL(a.href, window.location.href); } catch { return; }
  if (url.origin !== window.location.origin) return; // a different site: beforeunload asks
  if (url.pathname === window.location.pathname && url.search === window.location.search) return;
  e.preventDefault();
  e.stopPropagation();
  confirmLeave().then((ok) => {
    if (!ok) return;
    bypass = true;
    try { a.click(); } finally { bypass = false; }
  });
}

let installed = 0;
function install() {
  if (installed++ > 0 || typeof window === 'undefined') return;
  window.addEventListener('beforeunload', onBeforeUnload);
  document.addEventListener('click', onClickCapture, true);
}
function uninstall() {
  if (--installed > 0 || typeof window === 'undefined') return;
  window.removeEventListener('beforeunload', onBeforeUnload);
  document.removeEventListener('click', onClickCapture, true);
}

/**
 * Register a dirty editor. Returns the function that unregisters it.
 * @param {{ dialog: any, t: Function, label?: string }} ctx
 */
export function registerDirty(ctx) {
  const id = ++seq;
  guards.set(id, ctx);
  install();
  return () => { if (guards.delete(id)) uninstall(); };
}
