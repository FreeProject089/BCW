import { useEffect, useState, useRef, lazy, Suspense } from 'react';
// Lazily: the showcase pulls in rrweb the moment a `.bmmreplay` panel is shown, and a
// visitor to a site with no showcase configured must not pay for any of it.
const ProjectShowcase = lazy(() => import('../hero/ProjectShowcase.jsx'));
import { ErrorBoundary } from '../ui/ErrorBoundary.jsx';
import { Link } from 'react-router-dom';
import {
  Server, Rocket, ArrowRight, Upload, CheckCircle2, ShieldCheck, Inbox, Eye, Lock, Zap, Users, Newspaper, LayoutDashboard, Star, Link2, Code2, Wand2, AppWindow, Globe, Sparkles, Clock, ChevronLeft, ChevronRight, BadgeCheck, AlertTriangle, Ban, MessageSquare, Plus,
} from 'lucide-react';
import { Button, Card, Badge } from '../ui/ui.jsx';
import { api } from '../lib/api.js';
import { productCards } from '../lib/home-products.js';
import { CATALOG_SEEN } from '../lib/prefs.js';
import Markdown, { IconGlyph } from '../ui/md.jsx';
// Drawn only during an incident — see status-banner.jsx.
import StatusBanner from './status-banner.jsx';
import { thumb } from '../lib/img.js';
import { fmtNum, fmtInt } from '../lib/format.js';
import Avatar from '../ui/Avatar.jsx';
import { useAuth } from './auth.jsx';
import { useI18n } from '../i18n.jsx';
import { AuthorsRow } from './blog.jsx';
import { PollTeaser } from './polls.jsx';
import { AppLogo, KofiIcon, DiscordIcon } from '../ui/brand.jsx';
import { useAsync } from './pages.jsx';
import { CharityWidget } from './charity.jsx';
import { HomeV2, HomeV3 } from './home-variants.jsx';
// Resolved before React mounted, so asking here is a synchronous read and not a request the
// page renders around. That is what keeps a built page from arriving after the default one.
import { heroCtas, heroNote, closingCta } from '../lib/home-ctas.js';

/* ─────────────────────────  Home  ───────────────────────── */
function useScrollReveal() {
  const root = useRef(null);
  useEffect(() => {
    document.documentElement.classList.add('js-anim');
    if (!root.current) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const el = e.target;
        // If, by the time this fires, the element is already substantially inside (or
        // above) the viewport — i.e. the user fast-scrolled or jumped past the trigger —
        // snap it in with a short fade instead of playing the long rise+blur while it's
        // on screen (that's the glitchy "late spawn" seen on Latest news / reviews when
        // scrolling fast). Threshold raised to 0.85 so only elements JUST entering at the
        // very bottom edge get the full animation. Fresh-measured (not the stale rect).
        if (el.getBoundingClientRect().top < window.innerHeight * 0.85) el.classList.add('reveal-instant');
        el.classList.add('in');
        io.unobserve(el);
      });
      // A small rootMargin so a reveal fires slightly BEFORE its top edge reaches
      // the viewport bottom — enough to feel scroll-driven, but never so deep that
      // a short section (or the very last one) can't cross the threshold at all.
    }, { threshold: 0.05, rootMargin: '0px 0px -8% 0px' });
    // Observe an element (assigning stagger indexes to a grid's children first).
    const observe = (el) => {
      if (el.dataset.revealBound) return;
      el.dataset.revealBound = '1';
      if (el.classList.contains('reveal-stagger')) [...el.children].forEach((c, i) => c.style.setProperty('--i', i));
      // If the element is already at or ABOVE the fold when we start observing it —
      // e.g. async content (the reviews grid) that renders after a FAST scroll past
      // its position — reveal it now. The IntersectionObserver only fires for elements
      // crossing INTO view from below, so it would leave these stuck at opacity:0
      // ("reviews hidden / buggy when you scroll fast").
      if (el.getBoundingClientRect().top < window.innerHeight) { el.classList.add('reveal-instant', 'in'); return; }
      io.observe(el);
    };
    const scan = () => root.current?.querySelectorAll('.reveal-on-scroll, .reveal-stagger').forEach(observe);
    scan();
    // CRITICAL: async content (e.g. the Latest-news grid, which renders only after
    // its blog fetch resolves) is added to the DOM AFTER the initial scan — a
    // MutationObserver catches those late elements so they're revealed too. Before
    // this, the whole news section silently stayed at opacity:0 forever.
    const mo = new MutationObserver(scan);
    mo.observe(root.current, { childList: true, subtree: true });
    // Safety net: anything already in view on load (or that a browser restored
    // scroll position onto) is revealed on the next frame regardless.
    requestAnimationFrame(scan);
    return () => { io.disconnect(); mo.disconnect(); };
  }, []);
  return root;
}

// Editorial numbered section label with a fading rule — the small premium touch
// that gives the page rhythm (like high-end brand microsites).
function SectionKicker({ n, label }) {
  return (
    <div className="reveal-on-scroll flex items-center gap-3 mb-6">
      <span className="text-[11px] font-mono font-bold text-[var(--primary-2)] tracking-widest">{n}</span>
      <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--faint)]">{label}</span>
      <span className="flex-1 h-px bg-gradient-to-r from-[var(--line-strong)] to-transparent" />
    </div>
  );
}

// Animated integer counter that plays once when scrolled into view — used by the
// hero stats. Values are real DB counts (zero stats are hidden by the caller).
function CountUp({ value }) {
  const ref = useRef(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    let raf;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return; io.disconnect();
      const t0 = performance.now(), dur = 1300;
      const step = (t) => {
        const p = Math.min(1, (t - t0) / dur);
        setN(Math.round(value * (1 - Math.pow(1 - p, 3)))); // ease-out cubic
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [value]);
  return <span ref={ref}>{n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : n}</span>;
}

/**
 * The polls on the landing page: two across on a wide screen, one on a phone, sliding either way.
 *
 * Built on scroll-snap, not on a transform and a page index. The number visible changes with the
 * viewport, so a transform version has to know the breakpoint in JavaScript, recompute the page
 * count when it changes, and clamp the current page so a resize does not land you past the end.
 * That is three states to keep in step for something the browser already does — and it is the
 * version that breaks first, on the resize nobody tested.
 *
 * What this buys, free: real touch inertia, trackpad swipe, keyboard scrolling, and correct
 * behaviour in RTL.
 *
 * It renders the SAME PollCard the polls page renders, in `compact` mode. A second, smaller poll
 * card would be a second place where voting is implemented.
 */
/**
 * How wide one slide is, by how many slides there are.
 *
 * Written out rather than computed, because Tailwind scans the source for class names: a
 * template-built `w-[calc(${100 / n}%...)]` produces no CSS at all and every card collapses.
 * The same reason the rest of this file spells its breakpoints out.
 *
 * Four is the cap. Past that the rail scrolls, which is what a rail is for.
 */
const SLIDE_W = {
  1: 'sm:w-full',
  2: 'sm:w-[calc(50%-0.5rem)]',
  3: 'sm:w-[calc(50%-0.5rem)] lg:w-[calc(33.333%-0.667rem)]',
  4: 'sm:w-[calc(50%-0.5rem)] lg:w-[calc(33.333%-0.667rem)] xl:w-[calc(25%-0.75rem)]',
};

function PollSlider({ polls }) {
  const { t } = useI18n();
  const railRef = useRef(null);
  const [pos, setPos] = useState({ page: 0, pages: 1 });

  // Derived from the DOM rather than from state, because the DOM is what decides how many fit:
  // one card on a phone, two past the md breakpoint, and the CSS owns that rule.
  //
  // GUARDED, because an unmeasurable rail used to remove the controls entirely and say nothing.
  // At mount the section may not be laid out — `clientWidth` is 0, `0 / 0` is NaN, and NaN
  // survived every Math.max and Math.ceil below it until `pages > 1` came out false and the
  // arrows were simply never rendered. Nothing threw; the feature was just gone.
  //
  // When it cannot be measured the honest assumption is ONE per view, which is the narrow case:
  // the controls appear, they work, and the first real measurement corrects the count. Guessing
  // "everything fits" would be the one guess that hides them.
  const measure = () => {
    const el = railRef.current;
    if (!el) return;
    const railW = el.clientWidth;
    const cardW = el.firstElementChild?.clientWidth;
    const perView = (railW > 0 && cardW > 0) ? Math.max(1, Math.round(railW / cardW)) : 1;
    const pages = Math.max(1, Math.ceil(polls.length / perView));
    // `scrollWidth - clientWidth` is the whole travel; dividing by it puts the last page at
    // exactly 1 even when the final page is short, which a naive page*width does not.
    const travel = el.scrollWidth - el.clientWidth;
    const raw = travel > 0 ? Math.round((el.scrollLeft / travel) * (pages - 1)) : 0;
    const page = Number.isFinite(raw) ? Math.max(0, Math.min(pages - 1, raw)) : 0;
    setPos({ page, pages });
  };

  useEffect(() => {
    const el = railRef.current;
    if (!el) return undefined;
    measure();
    // Two more passes after layout. ResizeObserver is the right tool and is also the one that
    // does not fire on a tab the browser is not painting — so it stays, and these back it up
    // rather than replacing it.
    const raf = requestAnimationFrame(measure);
    const settle = setTimeout(measure, 250);
    el.addEventListener('scroll', measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf); clearTimeout(settle);
      el.removeEventListener('scroll', measure); ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polls.length]);

  const goto = (page) => {
    const el = railRef.current;
    if (!el) return;
    const travel = el.scrollWidth - el.clientWidth;
    const p = Math.max(0, Math.min(pos.pages - 1, page));
    // The page is set HERE, not left to the scroll listener to discover.
    //
    // A click already knows where it is going, and making the dots wait for a scroll event
    // means the control lags behind the thing it controls — visibly during a smooth scroll,
    // and indefinitely anywhere scroll events are throttled or coalesced. The listener still
    // runs and still wins: it is what keeps this honest when somebody swipes or drags the rail
    // by hand, which is the case a click cannot predict.
    setPos((s) => ({ ...s, page: p }));
    el.scrollTo({ left: pos.pages > 1 ? (travel * p) / (pos.pages - 1) : 0, behavior: 'smooth' });
  };
  const prev = () => goto(pos.page - 1);
  const next = () => goto(pos.page + 1);

  if (!polls.length) return null;

  return (
    <div className="reveal-on-scroll">
      <div
        ref={railRef}
        className="flex items-stretch gap-4 overflow-x-auto no-scrollbar snap-x snap-mandatory pb-1"
        tabIndex={polls.length > 1 ? 0 : -1}
        role={polls.length > 1 ? 'group' : undefined}
        aria-roledescription={polls.length > 1 ? 'carousel' : undefined}
        aria-label={polls.length > 1 ? t('home.poll.slider', 'Polls') : undefined}
      >
        {polls.map((poll) => (
          // One across on a phone, and from `sm` up as many across as there ARE — capped at
          // four, past which the rail scrolls.
          //
          // The widths used to be fixed at 1/2/3/4 regardless of the count, and the case that
          // broke is the common one: a single open poll rendered a quarter-width card on a
          // wide screen with three quarters of empty row beside it. Two polls got two
          // quarters and half a row of nothing. The number of cards is known here, so the
          // layout should follow it rather than assume the rail is always full.
          //
          // `items-stretch` on the rail plus `h-full` on the teaser keeps every card in a page
          // the same height, so the rail never takes the height of its tallest slide.
          <div key={poll.id} className={`snap-start shrink-0 w-full ${SLIDE_W[Math.min(polls.length, 4)]}`}>
            <PollTeaser poll={poll} />
          </div>
        ))}
      </div>

      {pos.pages > 1 && (
        <div className="flex items-center justify-between gap-3 mt-3">
          <div className="flex items-center gap-1.5">
            {Array.from({ length: pos.pages }, (_, k) => (
              <button
                key={k}
                type="button"
                onClick={() => goto(k)}
                aria-label={t('home.poll.goto', 'Poll {n}').replace('{n}', String(k + 1))}
                aria-current={k === pos.page ? 'true' : undefined}
                // The visible dot stays small; the HIT AREA is 24px tall via padding. A 6px
                // target is a target people miss, and missing it scrolls the page instead.
                className="py-2.5 px-1 -my-2.5 group/dot"
              >
                <span className={`block h-1.5 rounded-full transition-all ${k === pos.page ? 'w-6 bg-[var(--primary-2)]' : 'w-1.5 bg-[var(--line-strong)] group-hover/dot:bg-[var(--muted)]'}`} />
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-[var(--faint)] tabular-nums me-1">{pos.page + 1}/{pos.pages}</span>
            {/* Disabled at the ends rather than wrapping. A rail you can scroll by hand has a
                visible beginning and end, so an arrow that jumps back to the start from the last
                card contradicts what the scrollbar just showed you. */}
            <button type="button" onClick={prev} disabled={pos.page === 0} aria-label={t('home.poll.prev', 'Previous poll')}
              className="w-9 h-9 grid place-items-center rounded-full border border-[var(--line)] text-[var(--muted)] enabled:hover:text-[var(--text)] enabled:hover:border-[var(--line-strong)] disabled:opacity-40 transition">
              <ChevronLeft size={16} />
            </button>
            <button type="button" onClick={next} disabled={pos.page >= pos.pages - 1} aria-label={t('home.poll.next', 'Next poll')}
              className="w-9 h-9 grid place-items-center rounded-full border border-[var(--line)] text-[var(--muted)] enabled:hover:text-[var(--text)] enabled:hover:border-[var(--line-strong)] disabled:opacity-40 transition">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * `draft` is the admin preview, and nothing else passes it.
 *
 * It replaces the sections/variant this page would fetch — the copy comes from the i18n
 * provider above it, because that is where copy comes from on the real page too. Everything
 * else (posts, stats, reviews, the showcase) is live: a preview of unsaved WORDING should
 * not also invent the content around it.
 */
export function Home({ draft = null }) {
  const { data } = useAsync(() => api.get('/blog?home=1'), []);
  const { data: stats } = useAsync(() => api.get('/stats').catch(() => null), []);
  // The same public endpoint /myo reads. `null` on failure so a landing page never fails to
  // render because a commission service did not answer.
  const { data: myo } = useAsync(() => api.get('/myo/products').catch(() => null), []);
  const { data: reviewsData } = useAsync(() => api.get('/reviews').catch(() => null), []);
  // Pinned, open, public polls only — the endpoint decides all three, so the home page
  // cannot accidentally surface one that is unlisted or private. `.catch` because a poll
  // failing to load must never take the front page down with it.
  const { data: pollData } = useAsync(() => api.get('/polls?home=1').catch(() => null), []);
  // Which blocks an admin has switched off, and the copy overrides (those are applied by
  // t() itself — see I18nProvider). Anything missing counts as ON, so a section added after
  // a site saved its config is never silently hidden.
  const { data: savedCfg } = useAsync(() => api.get('/site/home').catch(() => null), []);
  const homeCfg = draft || savedCfg;
  // The projects, as media. Absent or switched off leaves the hero exactly as it was — a
  // site that has never configured this must not gain an empty black rectangle the day it
  // ships.
  const { data: showcase } = useAsync(() => api.get('/site/showcase').catch(() => null), []);
  // The official projects, which the suite row is built from. Same failure rule as the
  // others: a request that fails leaves the row on its written-in fallback rather than
  // emptying the section this page exists for.
  const { data: projData } = useAsync(() => api.get('/projects').catch(() => null), []);
  const show = (k) => homeCfg?.sections?.[k] !== false;
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const root = useScrollReveal();
  // Unconditionally, with the other hooks: it is only READ by the custom-page branch, but a
  // hook called inside a branch is a hook whose order changes the day an admin switches the
  // page on, which React reports as a wrong-hook error on an unrelated line.
  // The suite, from the projects an admin actually manages — built by the shared helper,
  // because the page builder's preview draws this same row and drew it from somewhere else.
  // The suite: the projects an admin manages, plus whatever they added by hand, drawn the way
  // they chose. `homeCfg` is read below the fetch, so the first paint uses the default and the
  // row does not flash a different shape once the config lands.
  const suite = homeCfg?.suite || {};
  const products = productCards(projData, t, suite.extra || []);
  // Which landing page this site opens with.
  //
  // Every hook above runs first and unconditionally, so the branch below cannot break the
  // rules of hooks — and the three variants share one set of requests rather than each
  // fetching its own, which is what keeps "try v2 for a week" from costing a round of
  // performance work.
  //
  // v1 is the fallthrough and its markup is untouched: a variant mechanism whose first act
  // is to rewrite the page that already works has a much worse failure mode than one that
  // only adds.
  // Where the reader has got to, for the three steps below.
  //
  // Two facts, read in two places on purpose. Opening the catalogue is a BROWSER fact — no
  // server observes it, and making one observe it would mean following people around to tick
  // a box. Owning a hosting pool is an ACCOUNT fact: it follows the person from one machine
  // to the next, which is what "when you buy your first pool" means.
  //
  // A signed-out reader gets neither request and neither tick, which is correct: the first
  // step is the one that is not done.
  const [browsed, setBrowsed] = useState(false);
  useEffect(() => {
    try { setBrowsed(localStorage.getItem(CATALOG_SEEN) === '1'); } catch { /* private window */ }
  }, []);
  const progressReq = useAsync(() => (user ? api.get('/me/progress') : Promise.resolve(null)), [user?.id]);
  const progress = progressReq.data;
  // Either reading of "share or browse" counts. Somebody who has published is not waiting to
  // be told to go and look.
  const step2done = browsed || !!progress?.published;

  const ctx = { data, stats, myo, reviewsData, pollData, homeCfg, showcase, show, user, t, lang, products, posts: data?.posts || [] };
  // Custom sections wrap the alternate variants from OUT here (rather than inside each), so
  // one placement covers v2 and v3 without a home ⇄ home-variants import cycle.
  if (homeCfg?.variant === 'v2' || homeCfg?.variant === 'v3') {
    const Variant = homeCfg.variant === 'v2' ? HomeV2 : HomeV3;
    return (
      <div ref={root} className="space-y-16">
        <HomeCustomSections cfg={homeCfg} position="top" />
        <Variant {...ctx} />
        <HomeCustomSections cfg={homeCfg} position="bottom" />
      </div>
    );
  }

  return (
    // Generous vertical rhythm on purpose: the scroll is long, so sections (and
    // their staggered children) surface one at a time while the orb spirals
    // down alongside — the page IS the choreography, not a wall of content.
    <div ref={root} className="space-y-44 md:space-y-64">
      {/* hero */}
      <section className="relative text-center pt-24 md:pt-32 pb-24 md:pb-32">
        <div className="relative z-10">
          {/* The "BetterCommunity" pill that used to sit here is gone. It named the site to
              somebody already on the site, directly above a headline that names it again —
              a label with nothing left to say, taking the eye first. */}
          <h1 className="anim-slide text-6xl md:text-8xl font-extrabold leading-[0.98] tracking-[-0.035em]" style={{ animationDelay: '80ms' }}>
            {t('home.hero1')}<br /><span className="gradient-text">{t('home.brand')}</span> {t('home.hero2')}
          </h1>
          <p className="anim-slide text-[var(--muted)] text-lg md:text-xl max-w-xl mx-auto mt-7 leading-relaxed" style={{ animationDelay: '160ms' }}>{t('home.sub')}</p>
          <div className="anim-slide flex flex-wrap gap-3 justify-center mt-10" style={{ animationDelay: '240ms' }}>
            {heroCtas(user, t).map((c) => (
              <Link key={c.to} to={c.to}>
                <Button variant={c.primary ? 'primary' : undefined} className="!px-6 !py-3">
                  {c.label}{c.arrow && <ArrowRight size={16} />}
                </Button>
              </Link>
            ))}
          </div>
          {/* Answers the question that stops a stranger before any of the copy does. Absent
              for a member, who settled it when they signed up. */}
          {heroNote(user, t) && (
            <p className="anim-slide text-[13px] text-[var(--faint)] mt-3.5" style={{ animationDelay: '280ms' }}>{heroNote(user, t)}</p>
          )}
          {/* A Discord community runs alongside the site; the bot is how a server owner plugs
              their own server into it. Only rendered once the bot is live (has an appId). */}
          <div className="anim-slide mt-5" style={{ animationDelay: '300ms' }}><BotInviteButton /></div>
          {/* The projects, moving, under the one line that names the site. This is what the
              page opens with now: a paragraph is what a site says about itself, and what a
              visitor is deciding is whether the thing looks like something they want. */}
          {showcase?.enabled && (
            <div className="anim-slide mt-14" style={{ animationDelay: '320ms' }}>
              <ErrorBoundary fallback={null}>
                <Suspense fallback={null}><ProjectShowcase config={showcase} /></Suspense>
              </ErrorBoundary>
            </div>
          )}
          {/* The headline counts are gone. They were the two numbers a visitor cannot
              act on — a total of mods and a total of downloads say nothing about whether
              THIS site has what they came for, and a growing number is only impressive to
              the person who runs the site. The section toggle for them went with them:
              a switch for something that no longer exists is worse than no switch. */}
        </div>
      </section>

      {/* Only when something is actually wrong. A permanent "all systems operational"
          strip is the fastest way to teach a reader to stop reading a strip: it is green
          every day they visit, so on the one day it is not, it is furniture. */}
      <HomeCustomSections cfg={homeCfg} position="top" />

      {show('status') && <section className="-mt-32 md:-mt-48"><StatusBanner /></section>}

      {/* products */}
      {show('products') && (
      <section>
        <SectionKicker n="01" label={t('home.k.products', 'The suite')} />
        {/* Three presentations, and the choice is the admin's rather than a count.
            It used to switch to a scroller at five products — a reasonable default and a bad
            rule, because whether a row scrolls is a decision about the page, not about how
            many projects happen to exist this month.

            `marquee` is offered and is not the default. Every card here is a link somebody is
            aiming at, and a target that moves under the cursor is the one pattern guaranteed
            to be missed — which is exactly why it is right for the reviews strip, where
            nobody aims at anything. A site that wants the motion can have it. */}
        {(() => {
          const card = (p, extraClass = '') => (
            <Link key={p.name} to={p.to} className={`group ${extraClass}`}>
              {/* No hover glow. A blurred coloured disc bloomed out of one corner on hover —
                  it read as a smudge behind the card rather than as feedback, and it was the
                  "moche hover" flagged on these product cards. The clean lift + the Card's own
                  border-brighten already say "this is a target"; that is the whole signal. */}
              <Card hover className="relative overflow-hidden p-5 h-full transition-transform duration-200 group-hover:-translate-y-1">
                <div className="relative">
                  <span className="inline-block transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-3">
                    {/* A managed project draws its own logo; a hand-added row draws whatever
                        it was given — an uploaded image first, then any icon name this site
                        can resolve, then the generic box. */}
                    {p.logo ? <AppLogo pkey={p.logo} size={30} fallback={p.icon} />
                      : p.img ? <img src={p.img} alt="" width={30} height={30} loading="lazy" className="rounded-[6px] object-contain" />
                      : p.glyph ? <IconGlyph name={p.glyph} size={26} className="text-[var(--primary-2)]" />
                      : <p.icon size={22} className="text-[var(--primary-2)]" />}
                  </span>
                  <div className="font-semibold mt-3">{p.name}</div>
                  <div className="text-sm text-[var(--muted)] mt-1">{p.desc}</div>
                  <div className="text-xs text-[var(--primary-2)] mt-3 flex items-center gap-1">{t('prod.open')} <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" /></div>
                </div>
              </Card>
            </Link>
          );
          if (suite.style === 'marquee') {
            return (
              // The same two-copies trick the reviews strip uses: each card carries its own
              // right margin rather than a flex `gap`, so the duplicated list is exactly two
              // equal halves and translateX(-50%) lands on a seamless seam.
              <div className="reveal-on-scroll reviews-marquee relative overflow-hidden"
                role="region" aria-label={t('home.k.products', 'The suite')}>
                <div className="reviews-track flex py-1" style={{ animationDuration: `${Math.max(24, products.length * 9)}s` }}>
                  {[...products, ...products].map((p, i) => (
                    <div key={`${p.name}-${i}`} className="w-[260px] shrink-0 me-5" aria-hidden={i >= products.length}>
                      {card(p)}
                    </div>
                  ))}
                </div>
              </div>
            );
          }
          if (suite.style === 'scroll') {
            return (
              <div className="reveal-stagger flex gap-4 overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1 [scrollbar-width:thin]"
                role="region" aria-label={t('home.k.products', 'The suite')}>
                {products.map((p) => card(p, 'snap-start shrink-0 w-[240px]'))}
              </div>
            );
          }
          // grid. `auto-fit` rather than a fixed four columns: a fifth hand-added row used to
          // sit alone on a second line of four.
          return (
            <div className="reveal-stagger grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
              {products.map((p) => card(p))}
            </div>
          );
        })()}
      </section>
      )}

      {/* features */}
      {show('why') && (
      <section>
        <SectionKicker n="02" label={t('home.k.why', 'Why BetterCommunity')} />
        {/* The featured tile spans the full width and the four promises sit UNDER it as a
            list, not beside it as four more cards. The pipeline is the argument this section
            exists to make; giving it the same chrome as a one-line blurb made it read as a
            fifth blurb that happened to be wider. */}
        <div className="reveal-stagger grid gap-4">
          {/* The moderation promise, split the way the platform actually works.
              It used to read "every submission is reviewed before it goes live" over a single
              three-step pipeline. That is true of the official catalog and false of everything
              somebody hosts themselves: a community catalog is created ACTIVE and listed by its
              owner, and a hosted Server Repo is published by its owner's own button. Nothing was
              stopping a reader concluding that a stranger's repo had been read by staff.

              Two tracks, then, and the second one is not weaker for being honest — "anyone can
              publish, everyone can report, we suspend" is a real answer, and it is the one the
              code implements. */}
          {/* No glow disc. The blurred coloured bloom that used to sit in this card's corner was
              the "sort d'hover vrm moche" flagged again — the same complaint that killed the
              product-card glow. The Card's own hover lift is the only affordance now. */}
          <Card hover className="p-6 group relative overflow-hidden">
            <div className="relative">
              <div className="flex items-start gap-4 flex-wrap">
                <span className="grid place-items-center w-11 h-11 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] transition-colors group-hover:border-[var(--primary)]/40 shrink-0"><ShieldCheck size={20} className="text-[var(--primary-2)]" /></span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{t('home.feat.moderated', 'Every listing says how it was checked')}</div>
                  <div className="text-sm text-[var(--muted)] mt-1.5 leading-relaxed max-w-2xl">{t('home.feat.moderated.d', 'Two ways in: reviewed by us first, or posted straight by its maker. Every page tells you which — no guessing.')}</div>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4 mt-5">
                {/* Reviewed BEFORE. The badges are the real statuses a submission passes
                    through, not an illustration of a process. */}
                <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)]/40 p-4">
                  <div className="flex items-center gap-2 text-[13px] font-semibold">
                    <BadgeCheck size={15} className="text-success shrink-0" />
                    {t('home.mod.official', 'The official catalogue')}
                  </div>
                  <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                    <span className="badge !gap-1.5 text-[var(--muted)]"><Inbox size={12} /> {t('home.pipe.sub', 'Submitted')}</span>
                    <ArrowRight size={12} className="text-[var(--faint)] shrink-0" />
                    <span className="badge badge-amber !gap-1.5"><Eye size={12} /> {t('home.pipe.review', 'In review')}</span>
                    <ArrowRight size={12} className="text-[var(--faint)] shrink-0" />
                    <span className="badge badge-green !gap-1.5"><CheckCircle2 size={12} /> {t('home.pipe.live', 'Published')}</span>
                  </div>
                  <p className="text-[12px] text-[var(--muted)] mt-3 leading-relaxed">
                    {t('home.mod.official.d', 'Checked before it appears. A submission stays out of sight until someone on the team has opened it and approved it, and a refusal comes with the reason.')}
                  </p>
                </div>

                {/* Published FIRST. The same three badges would be a lie here, so this track
                    draws its own — and names the thing that actually holds it: reports. */}
                <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)]/40 p-4">
                  <div className="flex items-center gap-2 text-[13px] font-semibold">
                    <Users size={15} className="text-[var(--primary-2)] shrink-0" />
                    {t('home.mod.community', 'Community catalogues and repositories')}
                  </div>
                  <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                    <span className="badge badge-green !gap-1.5"><CheckCircle2 size={12} /> {t('home.mod.self', 'Published by its owner')}</span>
                    <ArrowRight size={12} className="text-[var(--faint)] shrink-0" />
                    <span className="badge !gap-1.5 text-[var(--muted)]"><AlertTriangle size={12} /> {t('home.mod.reported', 'Reportable')}</span>
                    <ArrowRight size={12} className="text-[var(--faint)] shrink-0" />
                    <span className="badge badge-amber !gap-1.5"><Ban size={12} /> {t('home.mod.suspended', 'Suspended')}</span>
                  </div>
                  <p className="text-[12px] text-[var(--muted)] mt-3 leading-relaxed">
                    {t('home.mod.community.d', 'Published by its author, immediately. Every one shows the account behind it, anyone can report a problem, and we suspend what breaks the rules. Checked after publication — and labelled that way wherever it appears.')}
                  </p>
                </div>
              </div>
            </div>
          </Card>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-5">
            {[[LayoutDashboard, t('home.feat.accounts'), t('home.feat.accounts.d')],
              [Zap, t('home.feat.hosting'), t('home.feat.hosting.d')],
              [Link2, t('home.feat.install', 'One-click install'), t('home.feat.install.d', 'Catalog entries install straight into the app in one click through deeplinks — no manual downloads, no hunting for files.')],
              [Lock, t('home.feat.privacy', 'Privacy-first'), t('home.feat.privacy.d', 'No third-party trackers and no ads. Analytics are first-party and anonymous, off until you opt in, and you can turn them back off anytime.')]].map(([I, title, d]) => (
              // A rule instead of a border. Four bordered boxes under a bordered card is five
              // rectangles competing for the same attention; a 2px accent reads as "four of
              // these" without asking for any.
              <div key={title} className="group ps-4 border-s-2 border-[var(--line)] hover:border-[var(--primary)] transition-colors">
                <I size={18} className="text-[var(--primary-2)]" />
                <div className="font-semibold mt-2.5 text-[15px]">{title}</div>
                <div className="text-sm text-[var(--muted)] mt-1 leading-relaxed">{d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
      )}

      {/* how it works */}
      {show('steps') && (
      <section>
        <SectionKicker n="03" label={t('home.k.start', 'Get started')} />
        <div className="reveal-on-scroll text-center mb-9"><h2 className="text-3xl md:text-4xl font-extrabold tracking-tight">{t('home.steps.title')}</h2><p className="text-[var(--muted)] mt-2.5">{t('home.steps.sub')}</p></div>
        {/* A path, and one that knows where the reader already is.

            It was three cards side by side, numbered 1-2-3 with a hairline behind them. Three
            equal cards in a row read as three offers to choose between, which is the opposite
            of a sequence — and every visitor saw the same "1. Create an account" whether or not
            they were signed in, which is the one fact this page actually knows about them.

            So: a rail with a real state on the first stop. Signed in, it is ticked and the row
            goes quiet; signed out, it is the only lit one. The other two are not claimed to be
            done, because nothing on this page can tell. */}
        <ol className="reveal-stagger relative max-w-3xl mx-auto ps-11 sm:ps-14">
          {/* The spine. It starts and ends at the centre of the first and last marker rather
              than running the height of the list — a line continuing past the last stop
              promises a fourth one. */}
          <div aria-hidden className="absolute left-[15px] sm:left-[19px] top-6 bottom-6 w-px bg-[var(--line)]" />
          {[[Users, t('home.step1'), t('home.step1.d'), user ? '/profile' : '/auth',
             user ? t('home.step1.done', "You're set — view profile") : t('home.step1.cta', 'Sign up free'), !!user],
            [Upload, t('home.step2'), t('home.step2.d'), '/catalog',
             step2done ? t('home.step2.done', 'Seen — go back to the catalogue') : t('home.step2.cta', 'Browse the catalog'), step2done],
            [Rocket, t('home.step3'), t('home.step3.d'), progress?.hosting ? '/dashboard' : '/hosting',
             progress?.hosting ? t('home.step3.done', 'Hosting is live — open your dashboard') : t('home.step3.cta', 'See hosting plans'), !!progress?.hosting],
          ].map(([I, title, d, to, cta, done], i) => (
            <li key={title} className="relative pb-9 last:pb-0">
              {/* The marker sits ON the spine. A done step is filled and shows a tick; the rest
                  keep their number, because a number is what makes it a step. */}
              <span aria-hidden
                className={`absolute -left-11 sm:-left-14 top-0 grid place-items-center w-8 h-8 sm:w-10 sm:h-10 rounded-full border-2 text-[13px] sm:text-sm font-bold transition-colors ${
                  done
                    ? 'bg-success border-success text-white'
                    : 'bg-[var(--bg-solid)] border-[var(--line-strong)] text-[var(--muted)]'
                }`}>
                {done ? <CheckCircle2 size={17} /> : i + 1}
              </span>
              <Link to={to} className="group block">
                <div className={`rounded-2xl border p-5 sm:p-6 transition-colors ${
                  done
                    ? 'border-[var(--line)] bg-transparent'
                    : 'border-[var(--line)] bg-[var(--surface)] group-hover:border-[color-mix(in_srgb,var(--primary)_45%,var(--line))]'
                }`}>
                  <div className="flex items-start gap-4">
                    <span className={`grid place-items-center w-10 h-10 rounded-xl shrink-0 transition-transform duration-300 ${
                      done
                        ? 'bg-[var(--surface-2)] border border-[var(--line)]'
                        : 'bg-gradient-to-br from-brand to-brand-2 shadow-lg shadow-orange-500/25 group-hover:scale-105'
                    }`}>
                      <I size={19} className={done ? 'text-[var(--muted)]' : 'text-white'} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-[17px] leading-snug">{title}</div>
                      <div className="text-sm text-[var(--muted)] mt-1.5 leading-relaxed">{d}</div>
                      <div className={`text-sm mt-4 inline-flex items-center gap-1.5 font-semibold ${done ? 'text-[var(--muted)]' : 'text-[var(--primary-2)]'}`}>
                        {cta} <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" />
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      </section>
      )}

      {/* Developers.
          A band, not a fifth product card: building on the platform is not another thing to
          download, and putting it in that row would say it is. It sits here because the
          person who has read this far is the one who might. */}
      <section>
        <div className="reveal-on-scroll">
          <Card className="p-8 sm:p-10 relative overflow-hidden">
            <div className="absolute inset-0 pointer-events-none opacity-[0.07]"
              style={{ background: 'radial-gradient(60% 120% at 85% 0%, var(--primary) 0%, transparent 70%)' }} />
            {/* One column and one message. The live API call that sat on the right belongs
                on /dev, where it still is: a developer weighing the platform will click
                through, and one that will not is not going to be won by a JSON body on a
                landing page. Here it made the band twice as tall as its sentence and put a
                second network request on a page that already makes eight. */}
            <div className="relative max-w-3xl">
              <h3 className="text-2xl sm:text-3xl font-extrabold leading-tight">{t('home.dev.t', 'Build on BetterCommunity')}</h3>
              <p className="text-[var(--muted)] mt-3 leading-relaxed">
                {t('home.dev.d', 'Sign people in with their BetterCommunity account, read their content with their permission, and get told when it changes. A REST API, OpenID Connect and webhooks — no SDK to install, and a key takes about a minute.')}
              </p>
              <div className="flex flex-wrap gap-2 mt-6">
                <Link to="/dev"><Button variant="primary" className="!px-5 !py-2.5"><Code2 size={15} /> {t('home.dev.cta', 'Open the developer area')}</Button></Link>
                <Link to="/docs/bcweb-api"><Button className="!px-5 !py-2.5">{t('home.dev.cta2', 'API reference')}</Button></Link>
              </div>
            </div>
          </Card>
        </div>
      </section>

      {/* Make Your Own.
          Beside the developer band and not inside it: those are the two halves of the same
          answer to "what if the thing I want does not exist" — build it yourself with the
          API, or have it built. Somebody who has read this far has already decided the
          catalogue does not have their thing.

          HIDDEN when the service is off, and it says so when the queue is full: a landing
          page that keeps advertising commissions after the team is full sells a promise
          nobody can keep, and the flag that decides it is the same one /myo and the intake
          form read. */}
      {show('myo') && myo?.enabled !== false && (
        <section>
          <div className="reveal-on-scroll">
            <Card className="p-8 sm:p-10 relative overflow-hidden">
              <div className="absolute inset-0 pointer-events-none opacity-[0.07]"
                style={{ background: 'radial-gradient(60% 120% at 15% 0%, var(--primary) 0%, transparent 70%)' }} />
              {/* One column, like its neighbour, and for the same reason. What can be
                  commissioned is a LIST, so it is written as one — no border, no surface, no
                  padding, nothing that invites a click. The only control in the section is
                  the one that works. The payment rail that used to sit on the right is on
                  /myo, next to the form it describes, which is where somebody reads it. */}
              <div className="relative max-w-3xl">
                <h3 className="text-2xl sm:text-3xl font-extrabold leading-tight">{t('home.myo.t', 'Have it built for you')}</h3>
                <p className="text-[var(--muted)] mt-3 leading-relaxed">
                  {t('home.myo.d', 'A Discord bot, an app, a website, or something nobody has made yet. It starts with a paid consultation — advice and a quote — and building begins only once you have approved that quote. Nothing is charged for the work before you agree to it.')}
                </p>
                <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-5 text-[13px] text-[var(--muted)]">
                  {/* The Discord mark, not lucide's generic robot: it is the only one of the
                      four that IS a brand, and the logo is already inline in this bundle. */}
                  {[[DiscordIcon, t('home.myo.f1', 'Discord bots')],
                    [AppWindow, t('home.myo.f2', 'Apps')],
                    [Globe, t('home.myo.f3', 'Websites')],
                    [Sparkles, t('home.myo.f4', 'Something else')]].map(([I, label]) => (
                    <li key={label} className="inline-flex items-center gap-2">
                      <I size={15} className="text-[var(--primary-2)] shrink-0" aria-hidden="true" />
                      <span>{label}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2 mt-6">
                  <Link to="/myo"><Button variant="primary" className="!px-5 !py-2.5"><Wand2 size={15} /> {t('home.myo.cta', 'Start a commission')}</Button></Link>
                </div>
                {/* A real state, and the one thing here that can change between two visits.
                    It stays: a page still inviting commissions while the team is full sells a
                    promise nobody can keep. */}
                {myo?.queueFull && (
                  <p className="text-[12px] text-[var(--warning)] mt-3 inline-flex items-center gap-1.5">
                    <Clock size={12} /> {t('home.myo.full', 'The queue is full right now — new commissions are paused.')}
                  </p>
                )}
              </div>
            </Card>
          </div>
        </section>
      )}

      {/* community reviews / testimonials — admin-curated, hidden when off or empty */}
      {show('reviews') && reviewsData?.enabled && reviewsData.reviews?.length > 0 && (
        <section>
          <SectionKicker n="04" label={t('home.k.reviews', 'Reviews')} />
          <div className="reveal-on-scroll text-center mb-9">
            <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight">{t('home.reviews.title', 'What the community says')}</h2>
            <p className="text-[var(--muted)] mt-2.5">{t('home.reviews.sub', 'Real words from people building with Better* tools.')}</p>
          </div>
          {/* Auto-scrolling marquee (pauses on hover). The list is duplicated so it
              loops seamlessly; speed scales with how many reviews there are. */}
          <div className="reveal-on-scroll reviews-marquee relative overflow-hidden">
            {/* Each card carries its OWN right margin (not a flex `gap`) so the duplicated
                list is exactly two equal-width copies — translateX(-50%) then lands on a
                perfect seam and the loop is continuous with no pause/jump. */}
            <div className="reviews-track flex py-1" style={{ animationDuration: `${Math.max(24, reviewsData.reviews.length * 10)}s` }}>
              {[...reviewsData.reviews, ...reviewsData.reviews].map((rv, idx) => {
                const text = (lang === 'fr' && rv.bodyFr) ? rv.bodyFr : rv.body;
                const av = rv.avatar || {};
                return (
                  <Card key={idx} className="w-[340px] max-w-[80vw] shrink-0 me-5 p-6 flex flex-col" style={{ background: 'var(--bg-solid)' }} aria-hidden={idx >= reviewsData.reviews.length}>
                    {rv.rating > 0 && (
                      <div className="flex items-center gap-0.5 mb-3">
                        {[1, 2, 3, 4, 5].map((n) => <Star key={n} size={15} className={n <= rv.rating ? 'text-warning' : 'text-[var(--line-strong)]'} fill={n <= rv.rating ? 'currentColor' : 'none'} />)}
                      </div>
                    )}
                    <p className="text-sm text-[var(--muted)] leading-relaxed flex-1">“{text}”</p>
                    <div className="flex items-center gap-3 mt-4 pt-4 border-t border-[var(--line)]">
                      <Avatar image={av.image} variant={av.variant || 'beam'} seed={av.seed || rv.author} colors={av.colors} size={38} />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{rv.author}</div>
                        {rv.role && <div className="text-xs text-[var(--faint)] truncate">{rv.role}</div>}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* A pinned poll, when there is one.
          The schema has said "optionally pinned to the home page" since polls shipped, and
          nothing ever rendered it — `pinned` only ever affected the sort order on /polls. So
          the field was half a feature: an admin could pin a poll and watch nothing happen. */}
      {show('poll') && !!pollData?.polls?.length && (
        <section>
          <SectionKicker n="05" label={t('home.k.poll', 'Your say')} />
          <div className="reveal-on-scroll flex items-center justify-between mb-5">
            <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">
              {pollData.polls.length > 1 ? t('home.poll.many', 'A few questions') : t('home.poll', 'One question')}
            </h2>
            <Link to="/polls" className="text-sm text-[var(--primary-2)] flex items-center gap-1 hover:gap-2 transition-all">
              {t('home.poll.all', 'All polls')} <ArrowRight size={13} />
            </Link>
          </div>
          <PollSlider polls={pollData.polls} />
        </section>
      )}

      {/* The record, as opposed to the alarm. The banner above appears only during an
          incident, which means the site can only ever say "something is wrong" and never
          "this stays up" — and the second is what somebody deciding where to host a repo is
          asking. One switch drives both: they are two halves of "service status". */}

      {/* latest posts */}
      {show('news') && (
      <section>
        <SectionKicker n={reviewsData?.enabled && reviewsData.reviews?.length ? '05' : '04'} label={t('home.k.news', 'From the blog')} />
        <div className="reveal-on-scroll flex items-center justify-between mb-5"><h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">{t('home.news')}</h2><Link to="/blog" className="text-sm text-[var(--primary-2)] flex items-center gap-1 hover:gap-2 transition-all">{t('home.news.all')} <ArrowRight size={13} /></Link></div>
        {!data?.posts?.length ? <Card className="p-6 text-[var(--muted)] text-sm">{t('home.news.none')}</Card> : (() => {
          const posts = data.posts; const featured = posts[0]; const rest = posts.slice(1, 4);
          const fdate = (d) => d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
          return (
            <div className="reveal-stagger grid lg:grid-cols-2 gap-5">
              {/* large featured latest post */}
              <Link to={`/blog/${featured.slug}`} className="group">
                <Card hover className="overflow-hidden h-full flex flex-col" style={{ background: 'var(--bg-solid)' }}>
                  <div className="relative overflow-hidden">
                    {featured.cover ? <img src={thumb(featured.cover, 768)} alt="" className="w-full h-56 object-cover transition-transform duration-300 group-hover:scale-105" />
                      : <div className="w-full h-56 blog-nocover grid place-items-center"><Newspaper size={34} className="text-[var(--primary-2)]" /></div>}
                    <span className="absolute top-3 left-3 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-[var(--bg-solid)]/85 backdrop-blur text-[var(--primary-2)] border border-[var(--line)]">Latest</span>
                  </div>
                  <div className="p-6 flex flex-col flex-1">
                    <Badge tone="primary" className="self-start">{featured.project?.name}</Badge>
                    <div className="font-bold text-xl mt-2 leading-snug group-hover:text-[var(--primary-2)] transition-colors">{featured.title}</div>
                    <div className="text-sm text-[var(--muted)] mt-2 line-clamp-3 flex-1">{featured.excerpt}</div>
                    <div className="flex items-center justify-between mt-4">
                      <span className="flex items-center gap-2 min-w-0 text-xs text-[var(--faint)]"><AuthorsRow authors={featured.authors} size={20} /> · {fdate(featured.publishedAt)}</span>
                      <span className="text-xs text-[var(--primary-2)] flex items-center gap-1 font-medium shrink-0">Read <ArrowRight size={12} /></span>
                    </div>
                  </div>
                </Card>
              </Link>
              {/* smaller recent posts — nested stagger so the featured (latest)
                  surfaces first, then these cascade in one after another */}
              <div className="flex flex-col gap-4 reveal-stagger">
                {rest.map((p) => (
                  <Link key={p.id} to={`/blog/${p.slug}`} className="group">
                    <Card hover className="p-4 flex gap-4 h-full" style={{ background: 'var(--bg-solid)' }}>
                      {p.cover ? <img src={thumb(p.cover, 256)} alt="" className="w-24 h-24 rounded-lg object-cover shrink-0" />
                        : <div className="w-24 h-24 rounded-lg blog-nocover grid place-items-center shrink-0"><Newspaper size={20} className="text-[var(--primary-2)]" /></div>}
                      <div className="min-w-0 flex flex-col flex-1">
                        <Badge tone="primary" className="self-start">{p.project?.name}</Badge>
                        <div className="font-semibold mt-1 leading-snug line-clamp-2 group-hover:text-[var(--primary-2)] transition-colors">{p.title}</div>
                        <div className="text-xs text-[var(--muted)] mt-1 line-clamp-2">{p.excerpt}</div>
                        <div className="flex items-center gap-2 mt-auto pt-1"><AuthorsRow authors={p.authors} size={18} /><span className="text-[11px] text-[var(--faint)]">{fdate(p.publishedAt)}</span></div>
                      </div>
                    </Card>
                  </Link>
                ))}
                {rest.length === 0 && <Card className="p-6 text-sm text-[var(--muted)] grid place-items-center h-full">{t('home.morePosts', 'More posts coming soon.')}</Card>}
              </div>
            </div>
          );
        })()}
      </section>
      )}

      {/* CTA / support */}
      <section className="reveal-on-scroll pb-4">
        <Card className="p-10 md:p-14 text-center relative overflow-hidden">
          {/* Plain surface, like every other section. It was a solid orange slab, which
              made this one block shout over a page that is otherwise white cards on a
              neutral ground — and forced its own button palette, since an orange
              primary vanishes on orange. Taking the slab away lets the buttons be the
              buttons this site uses everywhere else. */}
          <div className="relative reveal-stagger">
            <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight">{closingCta(user, t).title}</h2>
            <p className="text-[var(--muted)] mt-3 max-w-lg mx-auto leading-relaxed">{closingCta(user, t).sub}</p>
            <div className="flex flex-wrap gap-3 justify-center mt-7">
              {/* Was an unconditional "Get started" pointing at /auth — offered to somebody
                  already signed in, which is an invitation to create the account they are
                  using to read it. */}
              <Link to={closingCta(user, t).action.to}><Button variant="primary" className="!px-6 !py-3">{closingCta(user, t).action.label} <ArrowRight size={16} /></Button></Link>
              <a href="https://discord.com/invite/CTaaEF9R75" target="_blank" rel="noreferrer"><Button className="!px-6 !py-3"><DiscordIcon size={16} className="text-[#5865F2]" /> {t('home.cta2.discord', 'Join the Discord')}</Button></a>
              <a href="https://ko-fi.com/bettercommunity" target="_blank" rel="noreferrer"><Button className="!px-6 !py-3"><KofiIcon size={16} className="text-orange-400" /> {t('home.cta2.kofi')}</Button></a>
            </div>
          </div>
        </Card>
      </section>

      <HomeCustomSections cfg={homeCfg} position="bottom" />

      {/* Community Charity — a card beside the support block. Renders only when an admin has
          turned the programme on (GET /charity/current → { enabled:false } otherwise). */}
      <CharityWidget />

      {/* Ko-fi funding goal — its own section, pinned at the very bottom of the
          page (only renders when an admin has set a goal). */}
      <KofiGoalWidget />
    </div>
  );
}

// Admin-authored Markdown blocks, drawn in addition to the built-in sections. Shared by all
// three home variants (each calls it with the same config), so a custom section an admin
// writes appears wherever they've placed it regardless of which landing page is live.
// `position` picks top (under the hero) or bottom (above the support block); disabled ones and
// empties are skipped, so a drafted section never shows until it is turned on.
export function HomeCustomSections({ cfg, position }) {
  const { lang } = useI18n();
  const L = (o) => (lang === 'fr' ? (o?.fr || o?.en) : (o?.en || o?.fr)) || '';
  const list = (cfg?.customSections || [])
    .filter((c) => c.enabled !== false && (c.position || 'top') === position)
    .filter((c) => (L(c.title) || L(c.body)).trim());
  if (!list.length) return null;
  return (
    <>
      {list.map((c) => (
        <section key={c.id} className="reveal-on-scroll">
          <Card className="p-6 md:p-8 max-w-4xl mx-auto reveal-stagger">
            {L(c.title) && <h2 className="text-2xl md:text-3xl font-bold mb-3 gradient-text inline-block">{L(c.title)}</h2>}
            <div className="prose-sm max-w-none text-[var(--muted)] leading-relaxed break-words"><Markdown>{L(c.body)}</Markdown></div>
          </Card>
        </section>
      ))}
    </>
  );
}

// "Add our Discord bot" — a Discord-blurple button that deep-links to the bot's invite. The
// URL comes from the public GET /bot/invite (built from the bot's own non-secret client_id);
// it renders nothing until the bot is live, so a site whose bot has never come online does not
// show a dead button.
export function BotInviteButton({ className = '' }) {
  const { t } = useI18n();
  const { data } = useAsync(() => api.get('/bot/invite').catch(() => null), []);
  const url = data?.url;
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer"
      className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#5865F2] hover:opacity-90 transition ${className}`}>
      <DiscordIcon size={17} className="text-white" /> {t('home.botinvite', 'Add our Discord bot to your server')} <Plus size={14} className="opacity-80" />
    </a>
  );
}

// Public funding-goal progress bar — only renders once an admin has set a
// target via the admin dashboard (see AdminKofiGoal); shows the running total
// + tip count sourced from logged Ko-fi webhook events.
function KofiGoalWidget() {
  const { t, lang } = useI18n();
  const { data } = useAsync(() => api.get('/kofi/stats').catch(() => null), []);
  // Always render a support section at the bottom of the page — the progress bar
  // appears only once an admin has set a goal (data.goal); otherwise it's a
  // simple "support us on Ko-fi" card so the section is never empty.
  const goal = data?.goal;
  const pct = goal ? Math.min(100, Math.round((data.totalAmount / goal.targetAmount) * 100)) : 0;
  return (
    <section className="reveal-on-scroll">
      <Card className="p-6 md:p-8 max-w-xl mx-auto text-center relative overflow-hidden">
        <div className="absolute -bottom-16 left-1/2 -translate-x-1/2 w-96 h-96 rounded-full opacity-30 pointer-events-none" style={{ background: 'radial-gradient(circle, var(--primary-glow), transparent 62%)' }} />
        <div className="relative reveal-stagger">
          <div className="inline-flex items-center gap-2 text-base font-bold mb-1"><KofiIcon size={18} className="text-orange-400" /> {goal?.title || t('home.kofi.goal.title', 'Support BetterCommunity')}</div>
          <p className="text-xs text-[var(--muted)] mb-4">{t('home.kofi.goal.help', 'Help keep the servers running — every tip counts.')}</p>
          {goal && (<>
            <div className="h-3 rounded-full bg-[var(--surface-2)] overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-brand to-brand-2 transition-all duration-700" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex items-center justify-between mt-2.5 mb-4 text-sm">
              <span className="font-semibold tabular-nums">{fmtInt(data.totalAmount, lang)} / {fmtInt(goal.targetAmount, lang)} {goal.currency}</span>
              <span className="text-[var(--muted)]">{pct}% · {t('home.kofi.goal.tips', '{n} tips').replace('{n}', fmtNum(data.tipCount, lang))}</span>
            </div>
          </>)}
          <a href="https://ko-fi.com/bettercommunity" target="_blank" rel="noreferrer">
            <Button variant="primary" className="!px-6"><KofiIcon size={16} className="text-white" /> {t('home.cta2.kofi', 'Support on Ko-fi')}</Button>
          </a>
        </div>
      </Card>
    </section>
  );
}
