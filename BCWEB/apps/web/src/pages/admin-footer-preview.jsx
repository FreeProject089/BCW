// N13 (agent-topbar-N): the footer editor's Live preview, drawn by the REAL footer.
//
// It was a hand-drawn list: column titles and link labels as plain text, in a grid that only
// imitated the desktop and phone layouts. Everything else the editor changes (brand, logo,
// tagline, social icons, newsletter box, service status, phone layout, the brand block on a
// phone, the bottom bar) was not in it at all, so the preview answered a question about half
// the footer. It is now <Footer preview> from App.jsx, the component visitors get, fed the
// draft exactly as GET /footer would hand it over (the config while "Use this footer" is on,
// nothing, hence the built-in footer, while it is off), inside a frame of the device's width
// (ui/preview-frame.jsx: a 375px frame is a 375px viewport, so the footer's own phone rules,
// in CSS and in its matchMedia, apply as they do on a phone).
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import PreviewFrame from '../ui/preview-frame.jsx';
import { useI18n } from '../i18n.jsx';
import { useTheme } from '../ui/theme.jsx';
import { Footer } from '../App.jsx';

const DIM = { desktop: { w: 1280, h: 720 }, mobile: { w: 375, h: 760 } };

export default function LiveFooterPreview({ draft, device }) {
  const { t, lang } = useI18n();
  const theme = useTheme()?.theme || 'dark';
  const wrapRef = useRef(null);
  const [wrapW, setWrapW] = useState(0);
  // Measured on mount as well as on resize (a ResizeObserver never fires in a background tab).
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const read = () => setWrapW(el.clientWidth);
    read();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read);
    ro?.observe(el);
    window.addEventListener('resize', read);
    return () => { ro?.disconnect(); window.removeEventListener('resize', read); };
  }, []);
  // A link must not take the ADMIN away from the editor, and the newsletter must not subscribe
  // anybody: links and submit buttons are stopped here, before react-router reads the click.
  // The phone accordions (plain buttons) still open, which is part of what is being previewed.
  const onClickCapture = useCallback((e) => {
    if (e.target?.closest?.('a, button[type="submit"], input[type="submit"]')) e.preventDefault();
  }, []);
  const phone = device === 'mobile';
  const dim = DIM[phone ? 'mobile' : 'desktop'];
  const bezel = phone ? 20 : 0;
  const scale = wrapW > bezel ? Math.min(1, (wrapW - bezel) / dim.w) : 1;
  const cfg = draft?.enabled ? draft : null;
  return (
    <div ref={wrapRef}>
      <div className={phone ? 'flex justify-center' : ''}>
        <div className={phone ? 'rounded-[2.2rem] border-[10px] border-[var(--line-strong)] overflow-hidden shadow-lg' : 'rounded-xl border border-[var(--line)] overflow-hidden'}
          style={{ background: 'var(--bg-solid)' }}>
          <PreviewFrame key={device} width={dim.w} height={dim.h} scale={scale} theme={theme} htmlAttrs={{ lang }}
            title={t('afoot.pv.title', 'Live preview of the footer')} onClickCapture={onClickCapture}>
            {/* The footer at the bottom of a page, as it always is: pushed down by the page. */}
            <div className="min-h-screen flex flex-col justify-end" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
              <Footer preview={{ cfg }} />
            </div>
          </PreviewFrame>
        </div>
      </div>
    </div>
  );
}
