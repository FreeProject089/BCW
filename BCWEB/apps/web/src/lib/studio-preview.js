// "The whole page, with this block in place": the REAL page, in a frame.
//
// The studio used to mount ProjectPage / ShowcaseProjectPage / Home inside itself with the
// draft config. That was the page component without the site around it (no header, no footer,
// no 3D backdrop), at no device width, with media queries answering the STUDIO's window, and a
// page with no title, no blocks or the studio off had no tab, so the preview fell back to the
// Overview (PLAN-STUDIO-2026 bug B). Now the studio frames the real route (same origin, which
// Caddy allows: X-Frame-Options SAMEORIGIN, frame-ancestors 'self') at a device width, and
// hands it the draft by postMessage, origin checked on both sides.
//
// This file holds both halves of the conversation and the pure rules; it is tested in
// test/studio-preview.test.mjs.
import { useEffect, useState } from 'react';

/** The query parameter that makes a page listen for a draft. Nothing else changes with it. */
export const PREVIEW_PARAM = 'studioPreview';
/** The device widths a page preview offers, in CSS px. */
export const PAGE_DEVICES = { desktop: 1280, tablet: 820, phone: 390 };
const DRAFT = 'bcw-studio-draft';
const READY = 'bcw-studio-ready';

/** The real route a studio page lives on, with its tab and the preview flag. */
export function framedPreviewUrl(kind, ref, canvasId) {
  const q = (tab) => `?${tab ? `tab=${encodeURIComponent(tab)}&` : ''}${PREVIEW_PARAM}=1`;
  if (kind === 'home') return `/${q(null)}`;
  const tab = canvasId ? `c-${canvasId}` : null;
  if (kind === 'showcase') return `/project/${encodeURIComponent(String(ref || ''))}${q(tab)}`;
  return `/p/${encodeURIComponent(String(ref || ''))}${q(tab)}`;
}

/** The message the studio posts. `payload` is what the page's own `preview` prop takes. */
export const draftMessage = (kind, payload) => ({ type: DRAFT, kind, payload });

/**
 * Is this message one the framed page should take? Same origin, from the window that framed
 * it, of the right type and kind. Anything else is ignored: a page must never render a draft
 * another origin sent it.
 */
export function acceptDraft(e, kind, { origin, parent }) {
  if (!e || e.origin !== origin || e.source !== parent) return null;
  const d = e.data;
  if (!d || typeof d !== 'object' || d.type !== DRAFT || d.kind !== kind) return null;
  return d.payload && typeof d.payload === 'object' ? d.payload : null;
}

/** Is this message the framed page saying it is listening? (Studio side.) */
export function isReady(e, { origin, frame }) {
  return !!e && e.origin === origin && !!frame && e.source === frame && e.data?.type === READY;
}

/**
 * The canvases a page offers as tabs. Normally: studio on, a title and at least one block
 * (a canvas that would open onto nothing is not offered). In the studio's preview, the tab
 * being previewed is offered WHATEVER its state, titled `untitled` when it has no title, so a
 * page that is not public yet can still be looked at; the studio says why it is not public.
 */
export function canvasTabsFor(cfg, forceTab = null, untitled = 'Untitled page') {
  const list = Array.isArray(cfg?.canvases) ? cfg.canvases : [];
  const complete = (cv) => cv && cv.id && String(cv.title || '').trim() && Array.isArray(cv.blocks) && cv.blocks.length;
  const shown = cfg?.studioEnabled === true ? list.filter(complete) : [];
  if (!forceTab) return shown;
  const forced = list.find((cv) => cv && cv.id && `c-${cv.id}` === forceTab);
  if (!forced || shown.includes(forced)) return shown;
  return [...shown, { ...forced, title: String(forced.title || '').trim() || untitled }];
}

/** Why visitors do NOT see this page yet: a list of 'studio_off' | 'untitled' | 'empty' | 'section_off'. */
export function previewReasons(kind, cfg, canvas, section = null) {
  const out = [];
  if (kind === 'home') {
    if (section && section.enabled === false) out.push('section_off');
  } else {
    if (cfg?.studioEnabled !== true) out.push('studio_off');
    if (!String(canvas?.title || '').trim()) out.push('untitled');
  }
  if (!Array.isArray(canvas?.blocks) || !canvas.blocks.length) out.push('empty');
  return out;
}

/**
 * The framed page's half: when this window was framed by the studio (`?studioPreview=1`),
 * say so to the parent and take the drafts it posts. Returns the latest draft payload, or null
 * (not framed, or nothing received yet), in which case the page renders as it always does.
 * A draft identical to the last one is ignored, so a re-render of the studio does not refetch
 * or remount the page.
 */
export function useFramedDraft(kind) {
  const [draft, setDraft] = useState(null);
  useEffect(() => {
    if (typeof window === 'undefined' || window.parent === window) return undefined;
    let flagged = false;
    try { flagged = new URLSearchParams(window.location.search).has(PREVIEW_PARAM); } catch { flagged = false; }
    if (!flagged) return undefined;
    let last = '';
    const onMsg = (e) => {
      const payload = acceptDraft(e, kind, { origin: window.location.origin, parent: window.parent });
      if (!payload) return;
      const s = JSON.stringify(payload);
      if (s === last) return;
      last = s;
      setDraft(payload);
    };
    window.addEventListener('message', onMsg);
    window.parent.postMessage({ type: READY, kind }, window.location.origin);
    return () => window.removeEventListener('message', onMsg);
  }, [kind]);
  return draft;
}
