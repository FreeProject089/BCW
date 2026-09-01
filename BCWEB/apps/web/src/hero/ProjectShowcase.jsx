import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
// Three icons, drawn here rather than imported from lucide-react.
//
// Measured, not guessed: adding `import { ArrowRight, Pause, Play } from 'lucide-react'` to
// this file — a file that is only ever loaded lazily — put 6 KB gzip onto the ENTRY chunk
// and took the bundle 5 KB over its budget. Rollup pulls lucide's shared module up into the
// common parent as soon as a second chunk wants it, so the cost lands on every visitor,
// including the ones who never see a showcase. Dropping the import put the entry back to a
// byte-identical build. Three paths are not worth that.
const Icon = ({ size = 15, children }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const ArrowRight = (p) => <Icon {...p}><path d="M5 12h14M12 5l7 7-7 7" /></Icon>;
const Pause = (p) => <Icon {...p}><path d="M7 4v16M17 4v16" /></Icon>;
const Play = (p) => <Icon {...p}><path d="M6 3l14 9-14 9V3z" /></Icon>;
import { useI18n } from '../i18n.jsx';
// Dynamically, and not only to defer rrweb.
//
// project.jsx imports this statically. A second STATIC import from here made it a module
// shared by two lazy chunks, which Rollup answers by hoisting into the entry — so adding a
// showcase that most visitors never see put a session-replay player into the bundle every
// visitor downloads. Measured: +5 KB gzip on the entry, over the budget. As a dynamic
// import it stays where it belongs.
const RrwebPreview = lazy(() => import('./RrwebPreview.jsx'));

// The projects, shown instead of described.
//
// Both landing pages opened with a paragraph about the site. A paragraph is what a site
// says about itself; what a visitor is deciding is whether the thing looks like something
// they want, and that is answered by watching it move.
//
// Vertical, because the list is a list: one project sits in the frame, the next arrives
// from below, and the rail down the side says how many there are and where you are in
// them. A horizontal carousel reads as "more of the same thing"; a vertical one reads as
// going down a list, which is what this is.
//
// Every piece of media here is admin-supplied. Nothing is fetched that the config did not
// name, nothing is rendered as HTML, and a `.bmmreplay` goes through the same RrwebPreview
// the rest of the site uses rather than a second player.

/** Milliseconds a panel holds before the next one arrives, when nothing interrupts. */
const FALLBACK_MS = 6000;

/**
 * One panel's media.
 *
 * `fit` is the zoom: `cover` fills the frame and crops, `contain` shows all of it and
 * letterboxes. `scale` is the fine adjustment on top — a screenshot with a lot of chrome
 * around the interesting part is worth pushing past the edges, and a wide one is worth
 * pulling back. Both are per item, because "how big should this look" is a fact about the
 * picture and not about the page.
 */
function Media({ item, active }) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  const fit = item.fit === 'contain' ? 'contain' : 'cover';
  const style = {
    objectFit: fit,
    transform: item.scale && item.scale !== 1 ? `scale(${item.scale})` : undefined,
  };

  if (failed || !item.url) {
    // Named rather than blank. A panel that silently shows nothing looks like a broken
    // page; a panel that says the file did not load is a thing an admin can act on.
    return (
      <div className="absolute inset-0 grid place-items-center text-sm text-[var(--faint)] px-6 text-center">
        {t('showcase.failed', 'This media could not be loaded.')}
      </div>
    );
  }

  if (item.kind === 'video') {
    return (
      <video
        className="absolute inset-0 w-full h-full"
        style={style}
        src={item.url}
        poster={item.poster || undefined}
        // Muted and playsInline or no mobile browser will start it by itself, and a hero
        // that needs a click to move is a hero that never moves.
        autoPlay={active}
        muted
        loop
        playsInline
        preload={active ? 'auto' : 'none'}
        onError={() => setFailed(true)}
      />
    );
  }

  if (item.kind === 'replay') {
    // Only the visible one. A .bmmreplay is tens of megabytes and starts a Replayer that
    // paints continuously; mounting four of them to have them ready would make the landing
    // page the heaviest thing on the site.
    if (!active) return null;
    return (
      <div className="absolute inset-0 overflow-hidden">
        <Suspense fallback={null}><RrwebPreview url={item.url} onFail={() => setFailed(true)} /></Suspense>
      </div>
    );
  }

  return (
    <img
      className="absolute inset-0 w-full h-full"
      style={style}
      src={item.url}
      alt=""
      // The first one is what somebody sees; the rest can wait until they are needed.
      loading={active ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

export default function ProjectShowcase({ config }) {
  const { t, lang } = useI18n();
  const items = useMemo(() => (config?.items || []).filter((i) => i && i.url), [config]);
  const [at, setAt] = useState(0);
  const [held, setHeld] = useState(false);
  const [paused, setPaused] = useState(false);
  const box = useRef(null);

  // Somebody who has asked for less motion gets the list, not the slideshow: the panels
  // still change when they choose one, and nothing moves on its own.
  const still = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const every = Math.min(30000, Math.max(2000, config?.intervalMs || FALLBACK_MS));
  const n = items.length;

  useEffect(() => {
    if (n < 2 || held || paused || still) return undefined;
    const id = setInterval(() => setAt((x) => (x + 1) % n), every);
    return () => clearInterval(id);
  }, [n, held, paused, still, every]);

  // A tab in the background paints nothing and its timer still fires, so coming back to it
  // would land on whichever panel the clock reached rather than the one that was there.
  useEffect(() => {
    const onVis = () => setHeld(document.visibilityState !== 'visible');
    document.addEventListener('visibilitychange', onVis);
    onVis();
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  if (!n) return null;

  const say = (v, fb = '') => (v?.[lang] ?? v?.en ?? v?.fr ?? fb);
  const cur = items[at] || items[0];
  const title = say(cur.title);
  const blurb = say(cur.blurb);

  const go = (i) => setAt(((i % n) + n) % n);

  return (
    <div
      ref={box}
      className="relative mx-auto w-full max-w-5xl"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocusCapture={() => setHeld(true)}
      onBlurCapture={() => setHeld(false)}
    >
      <div className="flex gap-3 sm:gap-5">
        {/* The frame. Fixed aspect so the page does not jump as panels of different
            sizes take their turn — a landing page that reflows every six seconds is a
            landing page nobody can read. */}
        <div
          className="relative flex-1 min-w-0 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-2)]"
          style={{ aspectRatio: '16 / 10', boxShadow: '0 40px 90px -30px rgba(0,0,0,0.55)' }}
          // A slideshow is a list of announcements: a reader is told when it changes, and
          // is not interrupted mid-sentence to be told.
          aria-roledescription="carousel"
          aria-live="polite"
        >
          {items.map((it, i) => (
            <div
              key={it.id || i}
              className="absolute inset-0 transition-transform duration-700 ease-out motion-reduce:transition-none"
              // Vertical: the current panel sits at 0, the ones after it wait below, the
              // ones before have gone up. One rule, no wrap-around special case.
              style={{
                transform: `translateY(${(i - at) * 100}%)`,
                zIndex: i === at ? 2 : 1,
                visibility: Math.abs(i - at) <= 1 ? 'visible' : 'hidden',
              }}
              aria-hidden={i !== at}
            >
              <Media item={it} active={i === at} />
            </div>
          ))}

          {/* The caption sits ON the media, over a gradient, so the frame stays the
              picture rather than becoming a card with a picture in it. */}
          {(title || blurb) && (
            <div className="absolute inset-x-0 bottom-0 z-10 p-4 sm:p-6 pointer-events-none"
              style={{ background: 'linear-gradient(to top, rgba(0,0,0,.78), rgba(0,0,0,.35) 45%, transparent)' }}>
              {title && <div className="text-white text-lg sm:text-2xl font-bold leading-tight drop-shadow">{title}</div>}
              {blurb && <p className="text-white/80 text-xs sm:text-sm mt-1 max-w-xl leading-relaxed">{blurb}</p>}
              {cur.href && (
                <div className="mt-3 pointer-events-auto">
                  {cur.href.startsWith('/') ? (
                    <Link to={cur.href} className="inline-flex items-center gap-1.5 text-sm font-semibold text-white hover:gap-2.5 transition-all">
                      {t('showcase.open', 'Open')} <ArrowRight size={15} />
                    </Link>
                  ) : (
                    // External, so it says so to the browser as well as to the reader.
                    <a href={cur.href} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm font-semibold text-white hover:gap-2.5 transition-all">
                      {t('showcase.open', 'Open')} <ArrowRight size={15} />
                    </a>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* The rail. Titles on a wide screen, ticks on a narrow one — the point of it is
            "there are five of these and you are on the second", which a tick carries. */}
        {n > 1 && (
          <div className="flex flex-col gap-1.5 justify-center shrink-0 w-2.5 sm:w-44">
            {items.map((it, i) => (
              <button
                key={it.id || i}
                type="button"
                onClick={() => go(i)}
                aria-current={i === at ? 'true' : undefined}
                aria-label={say(it.title, `${i + 1}`)}
                className={`group text-start rounded-lg transition-colors w-full ${
                  i === at ? 'sm:bg-[var(--surface-2)]' : 'hover:sm:bg-[var(--surface)]'
                }`}
              >
                <span className="flex items-center gap-2 sm:px-2.5 sm:py-2">
                  <span
                    className={`block rounded-full shrink-0 transition-all ${
                      i === at ? 'w-2.5 h-7 sm:h-2.5 sm:w-2.5' : 'w-2.5 h-2.5 opacity-40 group-hover:opacity-70'
                    }`}
                    style={{ background: i === at ? 'var(--primary)' : 'var(--muted)' }}
                  />
                  <span className={`hidden sm:block text-xs truncate ${i === at ? 'text-[var(--text)] font-semibold' : 'text-[var(--muted)]'}`}>
                    {say(it.title, `${i + 1}`)}
                  </span>
                </span>
              </button>
            ))}
            {/* Stopping it is a control, not a trick of hovering. Somebody reading a
                caption should not have to keep the pointer still to finish it. */}
            {!still && (
              <button
                type="button"
                onClick={() => setPaused((p) => !p)}
                className="hidden sm:flex items-center gap-2 px-2.5 py-2 mt-1 rounded-lg text-xs text-[var(--muted)] hover:bg-[var(--surface)]"
                aria-pressed={paused}
              >
                {paused ? <Play size={13} /> : <Pause size={13} />}
                {paused ? t('showcase.play', 'Play') : t('showcase.pause', 'Pause')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
