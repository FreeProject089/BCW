// A same-origin iframe that renders React children with the page's own stylesheets.
//
// WHY AN IFRAME
//
// The admin's topbar Live preview used to be a hand-drawn imitation of the topbar, and it
// drifted: it showed "Log out" and "Sign in" together, then a phone menu the phone never had.
// The fix is to render the REAL components. But the real topbar is responsive by media query
// (`lg:`, `sm:`, `md:hidden`), and a media query reads the VIEWPORT, not the box it sits in.
// Inside a 700px admin column the "mobile" preview would be the desktop bar squeezed, and the
// desktop preview would be whatever the admin's window happens to be.
//
// An iframe has its own viewport. The same components, portalled into a 375px frame, lay out
// exactly as they do on a 375px phone: the hamburger appears, the bottom bar docks to the
// bottom of the frame (it is `position: fixed`, and fixed is relative to the frame), and the
// pills collapse to icons below 1250px. React context crosses a portal, so the router, i18n
// and auth all still work, and React attaches its event listeners to a portal's container,
// so clicks inside the frame reach the components.
//
// Styles are copied, not re-requested: every <style> and stylesheet <link> in the page head is
// cloned into the frame and re-cloned when the head changes (vite adds a <style> per lazily
// loaded module in dev, and the site theme is a <style> that the Site theme editor rewrites).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const SRC = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';

function syncHead(doc) {
  if (!doc?.head) return;
  doc.head.querySelectorAll('[data-pv-copy]').forEach((n) => n.remove());
  document.head.querySelectorAll('style, link[rel="stylesheet"]').forEach((n) => {
    const c = n.cloneNode(true);
    c.setAttribute('data-pv-copy', '');
    doc.head.appendChild(c);
  });
}

/**
 * @param width   the frame's CSS viewport width (the width the components lay out at)
 * @param height  the frame's viewport height
 * @param scale   visual scale applied to the frame (layout width stays `width`)
 * @param theme   'light' | 'dark', written to the frame's <html data-theme>
 * @param htmlAttrs  extra attributes for the frame's <html> (lang, dir)
 */
export default function PreviewFrame({ width, height, scale = 1, theme, htmlAttrs = {}, title, children, onClickCapture, className = '' }) {
  const ref = useRef(null);
  const [mount, setMount] = useState(null);

  // The body the portal renders into, once the empty document has loaded.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ready = () => {
      const doc = el.contentDocument;
      if (!doc?.body) return;
      syncHead(doc);
      // The page's <html> carries switches the stylesheet keys on (translucent surfaces,
      // reduced motion…). Copy them, then let the preview's own theme win.
      for (const a of Array.from(document.documentElement.attributes)) {
        if (a.name !== 'data-theme') doc.documentElement.setAttribute(a.name, a.value);
      }
      doc.body.className = document.body.className;
      doc.body.style.margin = '0';
      setMount(doc.body);
    };
    // Only the srcdoc document counts. A fresh iframe first holds an about:blank document that
    // is already "complete"; mounting into it would portal into a body the srcdoc load is
    // about to throw away.
    if (el.contentDocument?.URL === 'about:srcdoc' && el.contentDocument.readyState === 'complete') ready();
    el.addEventListener('load', ready);
    return () => el.removeEventListener('load', ready);
  }, []);

  // Keep the stylesheets in step with the page.
  useEffect(() => {
    if (!mount) return undefined;
    const doc = mount.ownerDocument;
    const mo = new MutationObserver(() => syncHead(doc));
    mo.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, [mount]);

  useEffect(() => {
    const doc = mount?.ownerDocument;
    if (!doc) return;
    if (theme) doc.documentElement.setAttribute('data-theme', theme);
    for (const [k, v] of Object.entries(htmlAttrs)) doc.documentElement.setAttribute(k, v);
  }, [mount, theme, htmlAttrs]);

  // Capture-phase listener inside the frame's document, so a caller can stop links navigating
  // before react-router's own handler reads `defaultPrevented`.
  useEffect(() => {
    const doc = mount?.ownerDocument;
    if (!doc || !onClickCapture) return undefined;
    doc.addEventListener('click', onClickCapture, true);
    return () => doc.removeEventListener('click', onClickCapture, true);
  }, [mount, onClickCapture]);

  return (
    <div className={className} style={{ width: width * scale, height: height * scale, overflow: 'hidden' }}>
      <iframe ref={ref} title={title} srcDoc={SRC}
        style={{ width, height, border: 0, display: 'block', transform: `scale(${scale})`, transformOrigin: 'top left', background: 'transparent' }} />
      {mount && createPortal(children, mount)}
    </div>
  );
}
