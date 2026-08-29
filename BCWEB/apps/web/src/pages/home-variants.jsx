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
import { ArrowRight } from 'lucide-react';
import { Button } from '../ui/ui.jsx';
import { useI18n } from '../i18n.jsx';
// The sections themselves. They used to be inline here, which was fine until the page
// builder needed to draw the same news strip somewhere an admin chose — two copies of a
// section is one copy that goes stale.
import { ProductRows, ShowcasePanel, NewsGrid, NewsFeed, PollCard, ReviewsCard, OffersCard } from './home-sections.jsx';
// Drawn only during an incident, so it costs these two layouts nothing the rest of the time.
import StatusBanner from './status-banner.jsx';
// One rule for all three landing pages. Written three times it would be right once:
// v1 could learn about the signed-in visitor and these two not, and both would render.
import { heroCtas, heroNote, closingCta } from '../lib/home-ctas.js';

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
        <div>
          <h1 className="text-5xl md:text-6xl font-extrabold leading-[1.02] tracking-[-0.03em]">
            {t('home.hero1')} <span className="gradient-text">{t('home.brand')}</span> {t('home.hero2')}
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
          {heroNote(user, t) && <p className="mt-3 text-[12px] text-[var(--faint)]">{heroNote(user, t)}</p>}

          {show('status') && <StatusBanner />}
          {show('products') && (
            <div className="mt-8"><ProductRows products={products} /></div>
          )}
        </div>

        {/* The media, big, beside the choice rather than under it. On one screen the
            showcase is the argument; in v1 it is an illustration you scroll to. */}
        <div className="min-w-0">
          <ShowcasePanel showcase={showcase} />
        </div>
      </section>

      {show('news') && <NewsGrid posts={posts} limit={3} />}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   v3 — what is happening
   ──────────────────────────────────────────────────────────────────────────── */

export function HomeV3(ctx) {
  const { t } = useI18n();
  const { show, pollData, reviewsData, myo, user } = ctx;
  const posts = postsOf(ctx);

  return (
    <div className="space-y-10 pt-8">
      {/* One line where v1 has a hero. Somebody who is here for the third time does not need
          to be told what the site is; they need to see whether anything moved. */}
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl font-extrabold tracking-tight">{t('home.v3.title', 'What’s happening')}</h1>
        <span className="text-[13px] text-[var(--muted)]">
          {t('home.v3.sub', 'Releases, decisions being made, and what people are saying.')}
        </span>
        {/* Only for somebody who is not signed in. This page is written for the third visit
            and had no way in at all — a stranger who landed on it could read the feed and
            never be offered an account. A member needs nothing here, and gets nothing. */}
        {!user && (
          <Link to={closingCta(user, t).action.to} className="ml-auto">
            <Button variant="primary" className="!px-4 !py-2">
              {closingCta(user, t).action.label} <ArrowRight size={15} />
            </Button>
          </Link>
        )}
      </header>

      <div className="grid lg:grid-cols-3 gap-6 items-start">
        {/* The feed takes two thirds. Everything else on this page is context for it. */}
        <div className="lg:col-span-2 space-y-3">
          {show('status') && <StatusBanner />}
          {show('news') && <NewsFeed posts={posts} limit={6} />}
        </div>

        <aside className="space-y-4">
          {/* The poll is IN the column rather than being its own full-width band. A decision
              being taken is a sidebar fact on a page about what is happening. */}
          {show('poll') && <PollCard pollData={pollData} />}
          {show('reviews') && <ReviewsCard reviewsData={reviewsData} />}
          {show('myo') && <OffersCard myo={myo} />}
        </aside>
      </div>
    </div>
  );
}
