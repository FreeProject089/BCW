import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Boxes, Music2, Server, Rocket, Download, ArrowRight, Upload, CheckCircle2, Package, ShieldCheck, Inbox, Eye, Lock, Zap, Users, Newspaper, LayoutDashboard, Star, Link2, Code2, KeyRound, Shield, Webhook, FlaskConical, Wand2, Bot, AppWindow, Globe, Sparkles, Clock,
} from 'lucide-react';
import { Button, Card, Badge } from '../ui/ui.jsx';
import { api } from '../lib/api.js';
import { thumb } from '../lib/img.js';
import { fmtNum, fmtInt } from '../lib/format.js';
import Avatar from '../ui/Avatar.jsx';
import { useAuth } from './auth.jsx';
import { useI18n } from '../i18n.jsx';
import { AuthorsRow } from './blog.jsx';
import { AppLogo, KofiIcon, DiscordIcon } from '../ui/brand.jsx';
import { useAsync } from './pages.jsx';

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

export function Home() {
  const { data } = useAsync(() => api.get('/blog?home=1'), []);
  const { data: stats } = useAsync(() => api.get('/stats').catch(() => null), []);
  // The same public endpoint /myo reads. `null` on failure so a landing page never fails to
  // render because a commission service did not answer.
  const { data: myo } = useAsync(() => api.get('/myo/products').catch(() => null), []);
  const { data: reviewsData } = useAsync(() => api.get('/reviews').catch(() => null), []);
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const root = useScrollReveal();
  const products = [
    { icon: Boxes, logo: 'bmm', name: 'BMM', desc: t('prod.bmm.d'), to: '/p/bmm' },
    { icon: Music2, logo: 'bsm', name: 'BSM', desc: t('prod.bsm.d'), to: '/p/bsm' },
    { icon: Download, logo: 'installer', name: 'BetterInstaller', desc: t('prod.installer.d'), to: '/p/installer' },
    { icon: Rocket, name: 'Hosting', desc: t('prod.hosting.d'), to: '/hosting' },
  ];
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
            <Link to="/repos"><Button variant="primary" className="!px-6 !py-3">{t('home.cta.repos', 'Browse Server Repos')} <ArrowRight size={16} /></Button></Link>
            <Link to="/hosting"><Button className="!px-6 !py-3">{t('home.cta.host')}</Button></Link>
          </div>
          {(() => {
            const s = stats || {};
            // Only counts that stay meaningful at any point in the site's life —
            // "members"/"hosted repos" read as hollow vanity numbers early on, so
            // they were dropped; items & downloads are the ones worth bragging about.
            const rows = [
              [Package, s.items, t('home.stat.items', 'Mods & presets')],
              [Download, s.downloads, t('home.stat.downloads', 'Downloads')],
            ].filter(([, v]) => v > 0); // real counts only — zeros are hidden, never faked
            if (rows.length < 2) return null; // a lone stat looks odd — wait until the site has some life
            return (
              <div className="anim-slide mt-12 flex flex-wrap justify-center gap-x-12 gap-y-4" style={{ animationDelay: '320ms' }}>
                {rows.map(([I, v, label]) => (
                  <div key={label} className="flex items-center gap-3">
                    <span className="grid place-items-center w-9 h-9 rounded-xl bg-[var(--surface-2)] border border-[var(--line)]"><I size={16} className="text-[var(--primary-2)]" /></span>
                    <div className="text-left">
                      <div className="text-xl font-extrabold leading-none tabular-nums"><CountUp value={v} /></div>
                      <div className="text-[10px] text-[var(--faint)] mt-1 font-semibold uppercase tracking-wider">{label}</div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </section>

      {/* products */}
      <section>
        <SectionKicker n="01" label={t('home.k.products', 'The suite')} />
        <div className="reveal-stagger grid md:grid-cols-4 gap-4">
          {products.map((p) => (
            <Link key={p.name} to={p.to} className="group"><Card hover className="relative overflow-hidden p-5 h-full transition-transform duration-300 group-hover:-translate-y-1">
              <div className="absolute -top-12 -right-12 w-36 h-36 rounded-full pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ background: 'radial-gradient(circle, var(--primary-glow), transparent 65%)' }} />
              <div className="relative">
                <span className="inline-block transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-3">
                  {p.logo ? <AppLogo pkey={p.logo} size={30} fallback={p.icon} /> : <p.icon size={22} className="text-[var(--primary-2)]" />}
                </span>
                <div className="font-semibold mt-3">{p.name}</div>
                <div className="text-sm text-[var(--muted)] mt-1">{p.desc}</div>
                <div className="text-xs text-[var(--primary-2)] mt-3 flex items-center gap-1">{t('prod.open')} <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" /></div>
              </div>
            </Card></Link>
          ))}
        </div>
      </section>

      {/* features */}
      <section>
        <SectionKicker n="02" label={t('home.k.why', 'Why BetterCommunity')} />
        <div className="reveal-stagger grid md:grid-cols-3 gap-4">
          {/* featured tile: the moderation promise, illustrated by the real review pipeline */}
          <Card hover className="p-6 md:col-span-2 group relative overflow-hidden">
            <div className="absolute -bottom-16 -right-16 w-48 h-48 rounded-full pointer-events-none opacity-40 group-hover:opacity-70 transition-opacity duration-500" style={{ background: 'radial-gradient(circle, var(--primary-glow), transparent 65%)' }} />
            <div className="relative flex items-start justify-between gap-6 flex-wrap">
              <div className="max-w-sm">
                <span className="grid place-items-center w-11 h-11 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] transition-colors group-hover:border-[var(--primary)]/40"><ShieldCheck size={20} className="text-[var(--primary-2)]" /></span>
                <div className="font-semibold mt-4">{t('home.feat.moderated')}</div>
                <div className="text-sm text-[var(--muted)] mt-1.5 leading-relaxed">{t('home.feat.moderated.d')}</div>
              </div>
              <div className="flex items-center gap-2 mt-2 md:mt-9 flex-wrap">
                <span className="badge !gap-1.5 text-[var(--muted)]"><Inbox size={12} /> {t('home.pipe.sub', 'Submitted')}</span>
                <ArrowRight size={12} className="text-[var(--faint)] shrink-0" />
                <span className="badge badge-amber !gap-1.5"><Eye size={12} /> {t('home.pipe.review', 'In review')}</span>
                <ArrowRight size={12} className="text-[var(--faint)] shrink-0" />
                <span className="badge badge-green !gap-1.5"><CheckCircle2 size={12} /> {t('home.pipe.live', 'Published')}</span>
              </div>
            </div>
          </Card>
          {[[LayoutDashboard, t('home.feat.accounts'), t('home.feat.accounts.d')],
            [Zap, t('home.feat.hosting'), t('home.feat.hosting.d')],
            [Link2, t('home.feat.install', 'One-click install'), t('home.feat.install.d', 'Catalog entries install straight into BMM through bmm:// deeplinks — no manual downloads.')],
            [Lock, t('home.feat.privacy', 'Privacy-first'), t('home.feat.privacy.d', 'No third-party trackers — anonymous first-party analytics, and only with your consent.')]].map(([I, title, d]) => (
            <Card key={title} hover className="p-6 group"><span className="grid place-items-center w-11 h-11 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] transition-colors group-hover:border-[var(--primary)]/40"><I size={20} className="text-[var(--primary-2)]" /></span><div className="font-semibold mt-4">{title}</div><div className="text-sm text-[var(--muted)] mt-1.5 leading-relaxed">{d}</div></Card>
          ))}
        </div>
      </section>

      {/* how it works */}
      <section>
        <SectionKicker n="03" label={t('home.k.start', 'Get started')} />
        <div className="reveal-on-scroll text-center mb-9"><h2 className="text-3xl md:text-4xl font-extrabold tracking-tight">{t('home.steps.title')}</h2><p className="text-[var(--muted)] mt-2.5">{t('home.steps.sub')}</p></div>
        {/* Clean self-contained step cards — no roadmap rail, no "Step N" label. The icon
            chip and a big ghost number share the top row (balanced, fully inside the
            padding), then title · description · CTA. */}
        <div className="reveal-stagger grid md:grid-cols-3 gap-5">
          {[[Users, t('home.step1'), t('home.step1.d'), user ? '/profile' : '/auth', user ? t('home.step1.done', "You're set — view profile") : t('home.step1.cta', 'Sign up free')],
            [Upload, t('home.step2'), t('home.step2.d'), '/catalog', t('home.step2.cta', 'Browse the catalog')],
            [Rocket, t('home.step3'), t('home.step3.d'), '/hosting', t('home.step3.cta', 'See hosting plans')]].map(([I, title, d, to, cta], i) => (
            <Link key={title} to={to} className="group">
              <Card hover className="p-7 h-full flex flex-col group-hover:border-[color-mix(in_srgb,var(--primary)_45%,var(--line))] transition-colors">
                <div className="flex items-center justify-between mb-6">
                  <span className="grid place-items-center w-12 h-12 rounded-xl bg-gradient-to-br from-brand to-brand-2 shadow-lg shadow-orange-500/25 transition-transform duration-300 group-hover:scale-105">
                    <I size={22} className="text-white" />
                  </span>
                  <span aria-hidden className="text-[52px] leading-none font-black text-[var(--line-strong)] select-none pointer-events-none transition-colors group-hover:text-[color-mix(in_srgb,var(--primary)_32%,var(--line-strong))]">{i + 1}</span>
                </div>
                <div className="font-bold text-lg leading-snug">{title}</div>
                <div className="text-sm text-[var(--muted)] mt-2 leading-relaxed flex-1">{d}</div>
                <div className="text-sm text-[var(--primary-2)] mt-6 flex items-center gap-1.5 font-semibold">{cta} <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" /></div>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* Developers.
          A band, not a fifth product card: building on the platform is not another thing to
          download, and putting it in that row would say it is. It sits here because the
          person who has read this far is the one who might. */}
      <section>
        <div className="reveal-on-scroll">
          <Card className="p-8 sm:p-10 relative overflow-hidden">
            <div className="absolute inset-0 pointer-events-none opacity-[0.07]"
              style={{ background: 'radial-gradient(60% 120% at 85% 0%, var(--primary) 0%, transparent 70%)' }} />
            <div className="relative grid lg:grid-cols-[1.3fr_1fr] gap-8 items-center">
              <div>
                <div className="inline-flex items-center gap-2 badge badge-primary mb-4"><Code2 size={13} /> {t('home.dev.k', 'For developers')}</div>
                <h3 className="text-2xl sm:text-3xl font-extrabold leading-tight">{t('home.dev.t', 'Build on BetterCommunity')}</h3>
                <p className="text-[var(--muted)] mt-3 leading-relaxed">
                  {t('home.dev.d', 'Sign people in with their BetterCommunity account, read their content with their permission, and get told when it changes. A REST API, OpenID Connect and webhooks — no SDK to install, and a key takes about a minute.')}
                </p>
                <div className="flex flex-wrap gap-2 mt-6">
                  <Link to="/dev"><Button variant="primary" className="!px-5 !py-2.5"><Code2 size={15} /> {t('home.dev.cta', 'Open the developer area')}</Button></Link>
                  <Link to="/docs/bcweb-api"><Button className="!px-5 !py-2.5">{t('home.dev.cta2', 'API reference')}</Button></Link>
                </div>
              </div>
              {/* The four things you get, named — and each one goes where it is. They looked
                  like buttons and did nothing: the reader scanning for the single word that
                  matches what they came to do would click it and stay exactly where they were. */}
              <div className="grid grid-cols-2 gap-3">
                {[[KeyRound, t('home.dev.f1', 'API keys'), '/dev/config'],
                  [Shield, t('home.dev.f2', 'Sign-in (OIDC)'), '/docs/sso'],
                  [Webhook, t('home.dev.f3', 'Webhooks'), '/dev/tools#signature'],
                  [FlaskConical, t('home.dev.f4', 'Sandbox'), '/dev/tools#try']].map(([I, label, to]) => (
                  <Link key={label} to={to}
                    className="flex items-center gap-2.5 rounded-xl border border-[var(--line)] bg-[var(--surface-2)]/50 px-3.5 py-3 transition hover:border-[var(--primary)] hover:bg-[var(--surface-2)]">
                    <I size={16} className="text-[var(--primary-2)] shrink-0" />
                    <span className="text-[13px] font-medium min-w-0 truncate">{label}</span>
                  </Link>
                ))}
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
      {myo?.enabled !== false && (
        <section>
          <div className="reveal-on-scroll">
            <Card className="p-8 sm:p-10 relative overflow-hidden">
              <div className="absolute inset-0 pointer-events-none opacity-[0.07]"
                style={{ background: 'radial-gradient(60% 120% at 15% 0%, var(--primary) 0%, transparent 70%)' }} />
              {/* One column, not two.
                  The four kinds used to sit in a right-hand grid as bordered, padded,
                  card-backed boxes — which is what a button looks like on this site, so the
                  section offered five things to click and only one of them did anything.
                  They are a LIST of what can be commissioned, so they are written as a list:
                  no border, no surface, no padding, nothing that invites a click. The only
                  control in the section is the one that works. */}
              <div className="relative max-w-2xl">
                <div className="inline-flex items-center gap-2 badge badge-primary mb-4"><Wand2 size={13} /> {t('home.myo.k', 'Make Your Own')}</div>
                <h3 className="text-2xl sm:text-3xl font-extrabold leading-tight">{t('home.myo.t', 'Have it built for you')}</h3>
                <p className="text-[var(--muted)] mt-3 leading-relaxed">
                  {t('home.myo.d', 'A Discord bot, an app, a website, or something nobody has made yet. It starts with a paid consultation — advice and a quote — and building begins only once you have approved that quote. Nothing is charged for the work before you agree to it.')}
                </p>
                <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-5 text-[13px] text-[var(--muted)]">
                  {[[Bot, t('home.myo.f1', 'Discord bots')],
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
      {reviewsData?.enabled && reviewsData.reviews?.length > 0 && (
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
                  <Card key={idx} className="w-[340px] max-w-[80vw] shrink-0 mr-5 p-6 flex flex-col" style={{ background: 'var(--bg-solid)' }} aria-hidden={idx >= reviewsData.reviews.length}>
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

      {/* latest posts */}
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

      {/* CTA / support */}
      <section className="reveal-on-scroll pb-4">
        <Card className="p-10 md:p-14 text-center relative overflow-hidden">
          {/* Plain surface, like every other section. It was a solid orange slab, which
              made this one block shout over a page that is otherwise white cards on a
              neutral ground — and forced its own button palette, since an orange
              primary vanishes on orange. Taking the slab away lets the buttons be the
              buttons this site uses everywhere else. */}
          <div className="relative reveal-stagger">
            <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight">{t('home.cta2.title')}</h2>
            <p className="text-[var(--muted)] mt-3 max-w-lg mx-auto leading-relaxed">{t('home.cta2.sub')}</p>
            <div className="flex flex-wrap gap-3 justify-center mt-7">
              <Link to="/auth"><Button variant="primary" className="!px-6 !py-3">{t('home.cta2.start')} <ArrowRight size={16} /></Button></Link>
              <a href="https://discord.com/invite/CTaaEF9R75" target="_blank" rel="noreferrer"><Button className="!px-6 !py-3"><DiscordIcon size={16} className="text-[#5865F2]" /> {t('home.cta2.discord', 'Join the Discord')}</Button></a>
              <a href="https://ko-fi.com/bettercommunity" target="_blank" rel="noreferrer"><Button className="!px-6 !py-3"><KofiIcon size={16} className="text-orange-400" /> {t('home.cta2.kofi')}</Button></a>
            </div>
          </div>
        </Card>
      </section>

      {/* Ko-fi funding goal — its own section, pinned at the very bottom of the
          page (only renders when an admin has set a goal). */}
      <KofiGoalWidget />
    </div>
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
