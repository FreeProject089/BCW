// Two landing pages that are not the first one with different colours.
//
// The site has always opened with one page: a long scroll that tells a story — hero, why,
// how it works, the developer hub, commissions, reviews, news — with the orb spiralling down
// beside it. That page is right for somebody who has never heard of this and is deciding
// whether to care. It is the wrong page for the two other people who arrive here.
//
// So these are not restyles. Each one drops most of what v1 does, because what it drops is
// the point:
//
//   v2  Somebody who came to GET something. One screen, no story, no scroll before the
//       answer. The products are a list with actions on them, not cards with prose.
//
//   v3  Somebody who already uses this and came to see what changed. A feed: posts, the open
//       poll, what people said, what is on offer. No hero at all.
//
// Which sections each one has is declared once, on the API side (HOME_VARIANTS), so the
// admin's toggles follow the choice instead of offering switches for blocks the page does
// not draw.

import { Link } from 'react-router-dom';
import { ArrowRight, Boxes, Newspaper, Users, Server, LayoutDashboard, Download } from 'lucide-react';
import { Button } from '../ui/ui.jsx';
import { useI18n } from '../i18n.jsx';
// The sections themselves. They used to be inline here, which was fine until the page
// builder needed to draw the same news strip somewhere an admin chose — two copies of a
// section is one copy that goes stale.
import { ProductRows, ShowcasePanel, NewsGrid, NewsFeed, PollCard, ReviewsCard, OffersCard, Kicker, ClosingBand } from './home-sections.jsx';
// Drawn only during an incident, so it costs these two layouts nothing the rest of the time.
import StatusBanner from './status-banner.jsx';
// One rule for all three landing pages. Written three times it would be right once:
// v1 could learn about the signed-in visitor and these two not, and both would render.
import { heroCtas, heroNote, closingCta } from '../lib/home-ctas.js';
// The same marker stroke and handwritten aside v1 draws on its title (ui/marker.jsx), so the
// three landing pages share one hand.
import { Marker, HandNote } from '../ui/marker.jsx';

/** The posts a landing page shows, oldest concern first: is there anything at all. */
const postsOf = (ctx) => (ctx.data?.posts || []).slice(0, 6);

/* ────────────────────────────────────────────────────────────────────────────
   v2 — one screen, no story
   ──────────────────────────────────────────────────────────────────────────── */

export function HomeV2(ctx) {
  // From the hook, not from ctx: a component that reads its own translations is
  // what every other page here does, and threading `t` through props makes the
  // binding invisible to the check that exists to catch a missing one.
  const { t } = useI18n();
  const { show, showcase, products, user } = ctx;
  const posts = postsOf(ctx);
  return (
    <div className="space-y-16">
      {/* No `pt-24` and no reveal-on-scroll: the whole premise is that the answer is above
          the fold. A staggered entrance would be the story this page exists to skip. */}
      <section className="grid lg:grid-cols-2 gap-10 items-center pt-10">
        <div className="min-w-0">
          {/* clamp(), not `text-5xl md:text-6xl`.
              v1 already learned this and v2 had not: "BetterCommunity" is ONE unbreakable
              word, and at 60px it asks for about 496px of line box. A 375px phone gives the
              column 343px, so the brand word was cut off on the page whose entire premise is
              that the answer is above the fold. The clamp keeps it on one line from 320px up
              and still reaches the same size on a desktop. `break-words` covers a site that
              renames the brand to something longer still. */}
          <h1 className="font-extrabold leading-[1.02] tracking-[-0.03em] break-words text-[clamp(1.9rem,7vw,3.75rem)]">
            {t('home.hero1')} <Marker delay={200}><span className="gradient-text">{t('home.brand')}</span></Marker> {t('home.hero2')}
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-[var(--muted)] max-w-prose">
            {t('home.v2.lede', 'Tools for managing, sharing and hosting mods. Pick the one you came for.')}
          </p>
          {/* This page had no button on it. "One screen, no story" was read as "no ask" — so
              the only way off the fold was one of four product rows, and a visitor who wanted
              the site rather than a product had nowhere to go. */}
          <div className="mt-6 flex flex-wrap gap-3">
            {heroCtas(user, t).map((c) => (
              <Link key={c.to} to={c.to}>
                <Button variant={c.primary ? 'primary' : undefined} className="!px-5 !py-2.5">
                  {c.label}{c.arrow && <ArrowRight size={15} />}
                </Button>
              </Link>
            ))}
          </div>
          {heroNote(user, t) && <p className="mt-3 plate w-fit max-w-full"><HandNote arrow="up">{heroNote(user, t)}</HandNote></p>}

          {show('status') && <StatusBanner />}
          {show('products') && (
            <div className="mt-8">
              {/* Named, like every band on v1. An unlabelled list of four links was the page
                  asking the reader to work out what they were looking at. */}
              <Kicker label={t('home.k.products', 'The suite')} />
              <ProductRows products={products} />
            </div>
          )}
        </div>

        {/* The media, big, beside the choice rather than under it. On one screen the
            showcase is the argument; in v1 it is an illustration you scroll to. */}
        <div className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <ShowcasePanel showcase={showcase} />
        </div>
      </section>

      {show('news') && (
        <section>
          {/* D3: the same way out v3 offers. Three headlines and no link to the rest was a
              dead end on the page built for people who came to get somewhere. */}
          <Kicker label={t('home.k.news', 'From the blog')}>
            <Link to="/blog" className="text-xs text-[var(--muted)] hover:text-[var(--text)]">{t('common.seeAll', 'See all')}</Link>
          </Kicker>
          <NewsGrid posts={posts} limit={3} heading={false} />
        </section>
      )}

      {/* The ask. v2 ended on three headlines: a page built for somebody who came to GET
          something has to say what to do once they have found it. */}
      <ClosingBand user={user} t={t} />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   v3 — what is happening
   ──────────────────────────────────────────────────────────────────────────── */

export function HomeV3(ctx) {
  const { t } = useI18n();
  const { show, pollData, reviewsData, myo, user, showcase, stats, products } = ctx;
  const posts = postsOf(ctx);
  // D3: the site's pulse, for somebody coming back. Real counts from /stats, each a way in;
  // a zero is left out rather than printed, because "0 posts" on a page about what moved
  // says the opposite of what it means.
  const pulse = [
    { n: stats?.posts, to: '/blog', icon: Newspaper, label: t('home.v3.p.posts', 'posts') },
    { n: stats?.items, to: '/catalog', icon: Boxes, label: t('home.v3.p.items', 'in the catalogue') },
    { n: stats?.downloads, to: '/catalog', icon: Download, label: t('home.v3.p.downloads', 'downloads') },
    { n: stats?.members, to: '/users', icon: Users, label: t('home.v3.p.members', 'members') },
    { n: stats?.repos, to: '/repos', icon: Server, label: t('home.v3.p.repos', 'hosted repos') },
  ].filter((x) => Number(x.n) > 0);
  // Where a returning visitor goes next. A member: their own space first. A stranger: the two
  // places a first look usually starts.
  const jump = user
    ? [
      { to: '/dashboard', icon: LayoutDashboard, label: t('home.v3.j.dash', 'Your dashboard') },
      { to: '/catalog', icon: Boxes, label: t('home.v3.j.catalog', 'The catalogue') },
      { to: '/repos', icon: Server, label: t('home.v3.j.repos', 'Your repos') },
    ]
    : [
      { to: '/catalog', icon: Boxes, label: t('home.v3.j.catalog', 'The catalogue') },
      { to: '/hosting', icon: Server, label: t('home.v3.j.hosting', 'Hosting') },
    ];

  return (
    <div className="space-y-10 pt-8">
      {/* One line where v1 has a hero. Somebody who is here for the third time does not need
          to be told what the site is; they need to see whether anything moved. */}
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl font-extrabold tracking-tight"><Marker delay={200}>{t('home.v3.title', 'What’s happening')}</Marker></h1>
        <span className="text-[13px] text-[var(--muted)]">
          {t('home.v3.sub', 'Releases, decisions being made, and what people are saying.')}
        </span>
        {/* Only for somebody who is not signed in. This page is written for the third visit
            and had no way in at all — a stranger who landed on it could read the feed and
            never be offered an account. A member needs nothing here, and gets nothing. */}
        {!user && (
          <Link to={closingCta(user, t).action.to} className="ms-auto">
            <Button variant="primary" className="!px-4 !py-2">
              {closingCta(user, t).action.label} <ArrowRight size={15} />
            </Button>
          </Link>
        )}
      </header>

      {/* D3: the numbers that moved, as one line of ways in. Wraps on a phone, never cut. */}
      {pulse.length > 0 && (
        <nav aria-label={t('home.v3.pulse', 'The site at a glance')} className="flex flex-wrap gap-2 -mt-4">
          {pulse.map((x) => (
            <Link key={x.label} to={x.to}
              className="panel inline-flex items-center gap-2 rounded-xl border border-[var(--line)] px-3 py-1.5 text-[13px] hover:border-[var(--primary)] transition-colors">
              <x.icon size={14} className="text-[var(--accent-ink)] shrink-0" />
              <span className="font-semibold tabular-nums">{Number(x.n).toLocaleString()}</span>
              <span className="text-[var(--muted)]">{x.label}</span>
            </Link>
          ))}
        </nav>
      )}

      <div className="grid lg:grid-cols-3 gap-6 items-start">
        {/* The feed takes two thirds. Everything else on this page is context for it. */}
        <div className="lg:col-span-2 space-y-3 min-w-0">
          {show('status') && <StatusBanner />}
          {show('news') && (<>
            <Kicker label={t('home.k.news', 'From the blog')}>
              <Link to="/blog" className="text-xs text-[var(--muted)] hover:text-[var(--text)]">{t('common.seeAll', 'See all')}</Link>
            </Kicker>
            <NewsFeed posts={posts} limit={6} />
          </>)}
        </div>

        <aside className="space-y-4 min-w-0">
          {/* D3: the way back in. v3 had nowhere to GO on it except the posts: somebody who
              came back to use the site had to find the topbar. */}
          <div className="panel rounded-2xl border border-[var(--line)] p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-2">
              {user ? t('home.v3.jump', 'Jump back in') : t('home.v3.start', 'Start here')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {jump.map((j) => (
                <Link key={j.to} to={j.to}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-[13px] hover:border-[var(--primary)] transition-colors">
                  <j.icon size={13} className="shrink-0" /> {j.label}
                </Link>
              ))}
            </div>
            {products?.length > 0 && (
              <div className="mt-3">
                <Kicker label={t('home.k.products', 'The suite')} />
                <ProductRows products={products.slice(0, 4)} />
              </div>
            )}
          </div>
          {/* Something to LOOK at. v1 opens on the showcase and v3 had no image on it at all
              beyond whatever cover a post happened to carry — a feed of text where the site's
              own work was the one thing never shown. It is the site's media, not a section, so
              it is drawn here on the same terms v1 draws it: whatever an admin configured, and
              the placeholder frame when they configured nothing. */}
          <ShowcasePanel showcase={showcase} />
          {/* The poll is IN the column rather than being its own full-width band. A decision
              being taken is a sidebar fact on a page about what is happening. */}
          {show('poll') && <PollCard pollData={pollData} />}
          {show('reviews') && <ReviewsCard reviewsData={reviewsData} />}
          {show('myo') && <OffersCard myo={myo} />}
        </aside>
      </div>

      {/* The same closing ask the other two pages end on, worded by `closingCta` for whoever
          is reading: "your turn / open your dashboard" for a member, the sign-up for a
          stranger. v3 only ever offered the stranger a small button in its header. */}
      <ClosingBand user={user} t={t} />
    </div>
  );
}
