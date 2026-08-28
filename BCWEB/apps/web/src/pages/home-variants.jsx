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

import { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Download, Sparkles, MessageSquareQuote } from 'lucide-react';
import { Button, Card, Badge } from '../ui/ui.jsx';
import { thumb } from '../lib/img.js';
import { AppLogo } from '../ui/brand.jsx';
import { PollTeaser } from './polls.jsx';
import { useI18n } from '../i18n.jsx';
// One rule for all three landing pages. Written three times it would be right once:
// v1 could learn about the signed-in visitor and these two not, and both would render.
import { heroCtas, heroNote, closingCta } from '../lib/home-ctas.js';

// Same lazy boundary as v1's: a visitor to a site with no showcase configured must not pay
// for rrweb, whichever landing page they land on.
const ProjectShowcase = lazy(() => import('../hero/ProjectShowcase.jsx'));

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

          {show('products') && (
            <ul className="mt-8 space-y-2">
              {products.map((p) => (
                <li key={p.name}>
                  {/* A row, not a card. Four cards of prose is the v1 answer; somebody who
                      already knows which one they want should be one click from it. */}
                  <Link
                    to={p.to}
                    className="group flex items-center gap-3 rounded-xl border border-[var(--line)] px-4 py-3 hover:border-[var(--primary)] transition-colors"
                    style={{ background: 'var(--surface)' }}
                  >
                    {p.logo ? <AppLogo name={p.logo} size={22} /> : <p.icon size={20} className="text-[var(--primary-2)]" />}
                    <span className="min-w-0">
                      <span className="block font-semibold text-sm">{p.name}</span>
                      <span className="block text-[12px] text-[var(--muted)] truncate">{p.desc}</span>
                    </span>
                    <ArrowRight size={16} className="ml-auto shrink-0 text-[var(--faint)] group-hover:text-[var(--primary)] transition-colors" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* The media, big, beside the choice rather than under it. On one screen the
            showcase is the argument; in v1 it is an illustration you scroll to. */}
        <div className="min-w-0">
          {showcase?.enabled
            ? <Suspense fallback={null}><ProjectShowcase config={showcase} /></Suspense>
            : (
              <div className="rounded-2xl border border-[var(--line)] aspect-video grid place-items-center"
                style={{ background: 'var(--surface)' }}>
                <Sparkles size={28} className="text-[var(--faint)]" />
              </div>
            )}
        </div>
      </section>

      {show('news') && !!posts.length && (
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-semibold">{t('home.news', 'Latest news')}</h2>
            <Link to="/blog" className="text-xs text-[var(--muted)] hover:text-[var(--text)]">
              {t('common.seeAll', 'See all')}
            </Link>
          </div>
          {/* A strip, not a grid of hero images. This is the last thing on the page and it is
              there to say the project is alive, which a headline does. */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {posts.slice(0, 3).map((p) => (
              <Link key={p.id} to={`/blog/${p.slug || p.id}`}>
                <Card className="p-4 h-full hover:border-[var(--primary)] transition-colors">
                  <div className="text-sm font-semibold leading-snug">{p.title}</div>
                  {p.excerpt && <p className="mt-1 text-[12px] text-[var(--muted)] line-clamp-2">{p.excerpt}</p>}
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}
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
  const reviews = (reviewsData?.reviews || []).slice(0, 3);
  const offers = (myo?.products || []).slice(0, 3);

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
          {show('news') && posts.map((p) => (
            <Link key={p.id} to={`/blog/${p.slug || p.id}`} className="block">
              <Card className="p-4 flex gap-4 hover:border-[var(--primary)] transition-colors">
                {p.cover && (
                  <img src={thumb(p.cover, 160)} alt="" loading="lazy"
                    className="w-24 h-16 rounded-lg object-cover shrink-0 border border-[var(--line)]" />
                )}
                <div className="min-w-0">
                  <div className="text-sm font-semibold leading-snug">{p.title}</div>
                  {p.excerpt && <p className="mt-1 text-[12px] text-[var(--muted)] line-clamp-2">{p.excerpt}</p>}
                  {p.publishedAt && (
                    <div className="mt-1.5 text-[11px] text-[var(--faint)]">
                      {new Date(p.publishedAt).toLocaleDateString()}
                    </div>
                  )}
                </div>
              </Card>
            </Link>
          ))}
          {show('news') && !posts.length && (
            <Card className="p-6 text-sm text-[var(--muted)]">{t('home.v3.quiet', 'Nothing new yet.')}</Card>
          )}
        </div>

        <aside className="space-y-4">
          {/* The poll is IN the column rather than being its own full-width band. A decision
              being taken is a sidebar fact on a page about what is happening. */}
          {show('poll') && !!pollData?.polls?.length && (
            <Card className="p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-2">
                {t('home.v3.poll', 'Being decided')}
              </div>
              <PollTeaser poll={pollData.polls[0]} />
            </Card>
          )}

          {show('reviews') && !!reviews.length && (
            <Card className="p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-2 flex items-center gap-1.5">
                <MessageSquareQuote size={12} /> {t('home.v3.said', 'What people said')}
              </div>
              <div className="space-y-3">
                {reviews.map((r) => (
                  <blockquote key={r.id} className="text-[12px] leading-relaxed text-[var(--muted)]">
                    “{r.body}”
                    <span className="block mt-1 text-[11px] text-[var(--faint)]">— {r.authorName || t('common.anon', 'Anonymous')}</span>
                  </blockquote>
                ))}
              </div>
            </Card>
          )}

          {show('myo') && !!offers.length && (
            <Card className="p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-2">
                {t('home.v3.offers', 'On offer')}
              </div>
              <ul className="space-y-2">
                {offers.map((o) => (
                  <li key={o.id} className="flex items-center gap-2 text-[12px]">
                    <span className="min-w-0 truncate">{o.name}</span>
                    {o.priceCents != null && (
                      <Badge className="ml-auto shrink-0">{(o.priceCents / 100).toFixed(0)} €</Badge>
                    )}
                  </li>
                ))}
              </ul>
              <Button as={Link} to="/myo" size="sm" className="mt-3 w-full justify-center">
                <Download size={13} /> {t('home.v3.myoCta', 'Commission something')}
              </Button>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
