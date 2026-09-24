// N13 (agent-topbar-N): the home page editor's "Preview my changes", at a device width.
//
// Two things were wrong with it. It handed the page only `{ sections, variant }`, and the page
// takes its draft as the WHOLE config (home.jsx: `homeCfg = draft || savedCfg`), so the suite
// row's style and hand-added rows and every custom section were simply absent: the preview
// showed the default suite and no custom block at all, whatever the editor held. And it was
// drawn inline in the admin's own window, so its media queries answered the admin's width:
// an admin on a desktop could never see the phone page, the one most visitors get.
// Now the page gets the same object Save sends, and it is drawn in a frame of the chosen
// device's width (ui/preview-frame.jsx), where the page's own responsive rules apply.
import { Suspense, lazy, useLayoutEffect, useRef, useState } from 'react';
import PreviewFrame from '../ui/preview-frame.jsx';
import { useI18n, I18nDraft } from '../i18n.jsx';
import { useTheme } from '../ui/theme.jsx';

const HomeLive = lazy(() => import('./home.jsx').then((m) => ({ default: m.Home })));
export const HOME_PV_DEVICES = { desktop: 1280, mobile: 390 };

// The frame copies the page's <html> classes when it loads, and the page carries `js-anim` once
// the home page has been drawn anywhere in this tab: every section then waits at opacity 0 for
// a scroll-reveal whose observer belongs to the ADMIN's window, which cannot see a scroll inside
// the frame. Measured: 12 of 12 sections invisible in the phone frame. A preview is for reading
// the page, so in the frame every section is simply shown.
function ShowEverything() {
  const ref = useRef(null);
  useLayoutEffect(() => { ref.current?.ownerDocument?.documentElement.classList.remove('js-anim'); });
  return <span ref={ref} hidden />;
}

/**
 * @param text    the copy overrides being edited (what the page's i18n resolves first)
 * @param draft   { sections, variant, suite, customSections }: what Save would send
 * @param device  'desktop' | 'mobile'
 */
export default function LiveHomePreview({ text, draft, device }) {
  const { t, lang } = useI18n();
  const theme = useTheme()?.theme || 'dark';
  const wrapRef = useRef(null);
  const [wrapW, setWrapW] = useState(0);
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
  const phone = device === 'mobile';
  const w = HOME_PV_DEVICES[phone ? 'mobile' : 'desktop'];
  const bezel = phone ? 20 : 0;
  const scale = wrapW > bezel ? Math.min(1, (wrapW - bezel) / w) : 1;
  // What the eye gets is about 70% of the window, whatever the scale: the frame's own
  // viewport is that divided by the scale, so a scaled-down desktop page shows more of itself.
  const visH = Math.round(Math.min(900, Math.max(360, (typeof window !== 'undefined' ? window.innerHeight : 800) * 0.7)));
  const h = Math.round(visH / scale);
  // Links stay in the frame's page, they must not move the admin off the editor.
  const onClickCapture = (e) => { if (e.target?.closest?.('a')) e.preventDefault(); };
  return (
    <div ref={wrapRef}>
      <div className={phone ? 'flex justify-center' : ''}>
        <div className={phone ? 'rounded-[2.2rem] border-[10px] border-[var(--line-strong)] overflow-hidden shadow-lg' : 'rounded-xl border border-[var(--line)] overflow-hidden'}
          style={{ background: 'var(--bg-solid)' }}>
          <PreviewFrame key={device} width={w} height={h} scale={scale} theme={theme} htmlAttrs={{ lang }}
            title={t('hp.preview.t', 'Your home page, unsaved')} onClickCapture={onClickCapture}>
            {/* The page's own frame: <main>'s width and padding from App.jsx. */}
            <div className="min-h-screen" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
              <ShowEverything />
              <div className="w-full max-w-6xl mx-auto px-4 py-10">
                <Suspense fallback={<div className="p-10 text-center text-[var(--muted)]">…</div>}>
                  <I18nDraft over={text}>
                    <HomeLive draft={draft} />
                  </I18nDraft>
                </Suspense>
              </div>
            </div>
          </PreviewFrame>
        </div>
      </div>
    </div>
  );
}
