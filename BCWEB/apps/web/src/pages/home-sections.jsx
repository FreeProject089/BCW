// The landing-page sections, as components, so three things can draw them.
//
// They were inline JSX inside HomeV2 and HomeV3. That was fine while two pages existed and
// stopped being fine the moment a THIRD thing needed to draw "the news strip" — the page
// builder, where an admin drops a `news` block wherever they like. Copying the markup into
// the renderer would have made two news strips, and the one that goes stale is whichever
// nobody happens to look at.
//
// So: lifted here, unchanged, and imported back. v2 and v3 render exactly what they rendered.
//
// Two bugs came out with them, both invisible because the fallback was plausible:
//
//   · the review author was read as `r.authorName`. The API sends `author`. Every quote on
//     v3 was signed "Anonymous", including the ones that were not.
//   · the review body was always `r.body` — the English — so a French reader got the English
//     testimonial next to French everything else. `bodyFr` was fetched and never used.
import { Suspense, lazy } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Download, Sparkles, MessageSquareQuote } from 'lucide-react';
import { Button, Card, Badge } from '../ui/ui.jsx';
import { thumb } from '../lib/img.js';
import { AppLogo } from '../ui/brand.jsx';
import { PollTeaser } from './polls.jsx';
import { useI18n } from '../i18n.jsx';
import { ErrorBoundary } from '../ui/ErrorBoundary.jsx';

const ProjectShowcase = lazy(() => import('../hero/ProjectShowcase.jsx'));

/**
 * The products.
 *
 * `rows` is the original: a line each, with the action on the right. `cards` is the same list
 * as a grid, for a page that opens with the products rather than ending on them — same data,
 * same link, different weight on the page.
 */
export function ProductRows({ products = [], style = 'rows' }) {
  if (style === 'cards') {
    return (
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {products.map((p) => (
          <Link key={p.name} to={p.to}>
            <Card className="p-4 h-full hover:border-[var(--primary)] transition-colors">
              {p.logo ? <AppLogo name={p.logo} size={26} /> : <p.icon size={22} className="text-[var(--primary-2)]" />}
              <div className="mt-2 font-semibold text-sm">{p.name}</div>
              <p className="mt-1 text-[12px] text-[var(--muted)] leading-snug">{p.desc}</p>
            </Card>
          </Link>
        ))}
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {products.map((p) => (
        <li key={p.name}>
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
            <ArrowRight size={16} className="ms-auto shrink-0 text-[var(--faint)] group-hover:text-[var(--primary)] transition-colors" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The media panel, or a placeholder that keeps the layout when nothing is configured. */
export function ShowcasePanel({ showcase }) {
  if (showcase?.enabled) {
    // Wrapped: a bad showcase item (or a stale lazy chunk after a deploy — the classic
    // "Element type is invalid" #306) must degrade to the placeholder, never take down the
    // whole landing page. The panel is decorative; the page must survive it.
    return (
      <ErrorBoundary fallback={<ShowcaseFallback />}>
        <Suspense fallback={null}><ProjectShowcase config={showcase} /></Suspense>
      </ErrorBoundary>
    );
  }
  return <ShowcaseFallback />;
}

function ShowcaseFallback() {
  return (
    <div className="rounded-2xl border border-[var(--line)] aspect-video grid place-items-center" style={{ background: 'var(--surface)' }}>
      <Sparkles size={28} className="text-[var(--faint)]" />
    </div>
  );
}

/** A strip of headlines. The last thing on a page, saying the project is alive. */
export function NewsGrid({ posts = [], limit = 3, heading = true, compact = false }) {
  const { t } = useI18n();
  if (!posts.length) return null;
  if (compact) {
    // A list, not a grid: titles and dates, for a sidebar or the foot of a long page.
    return (
      <section>
        {heading && <h2 className="text-lg font-semibold mb-2">{t('home.news', 'Latest news')}</h2>}
        <ul className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
          {posts.slice(0, limit).map((p) => (
            <li key={p.id}>
              <Link to={`/blog/${p.slug || p.id}`} className="flex items-baseline gap-3 py-2.5 hover:text-[var(--primary-2)] transition-colors">
                <span className="text-sm font-medium min-w-0 truncate">{p.title}</span>
                {p.publishedAt && (
                  <span className="ms-auto shrink-0 text-[11px] text-[var(--faint)] tabular-nums">
                    {new Date(p.publishedAt).toLocaleDateString()}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    );
  }
  return (
    <section>
      {heading && (
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-semibold">{t('home.news', 'Latest news')}</h2>
          <Link to="/blog" className="text-xs text-[var(--muted)] hover:text-[var(--text)]">
            {t('common.seeAll', 'See all')}
          </Link>
        </div>
      )}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {posts.slice(0, limit).map((p) => (
          <Link key={p.id} to={`/blog/${p.slug || p.id}`}>
            <Card className="p-4 h-full hover:border-[var(--primary)] transition-colors">
              <div className="text-sm font-semibold leading-snug">{p.title}</div>
              {p.excerpt && <p className="mt-1 text-[12px] text-[var(--muted)] line-clamp-2">{p.excerpt}</p>}
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** The same posts, as a reading feed with covers and dates. */
export function NewsFeed({ posts = [], limit = 6 }) {
  const { t } = useI18n();
  const rows = posts.slice(0, limit);
  if (!rows.length) return <Card className="p-6 text-sm text-[var(--muted)]">{t('home.v3.quiet', 'Nothing new yet.')}</Card>;
  return (
    <div className="space-y-3">
      {rows.map((p) => (
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
    </div>
  );
}

/** The open poll, in a card. */
export function PollCard({ pollData }) {
  const { t } = useI18n();
  const poll = pollData?.polls?.[0];
  if (!poll) return null;
  return (
    <Card className="p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-2">
        {t('home.v3.poll', 'Being decided')}
      </div>
      <PollTeaser poll={poll} />
    </Card>
  );
}

/** Testimonials. */
export function ReviewsCard({ reviewsData, limit = 3, style = 'cards' }) {
  const { t, lang } = useI18n();
  const reviews = (reviewsData?.reviews || []).slice(0, limit);
  if (!reviews.length) return null;
  const body = (r) => (lang === 'fr' && r.bodyFr) || r.body;
  if (style === 'quotes') {
    // Big and unboxed. A testimonial on a landing page is the page talking about itself; in a
    // sidebar it is a footnote, and the same card cannot be both.
    return (
      <div className="grid md:grid-cols-3 gap-6">
        {reviews.map((r) => (
          <blockquote key={r.id} className="text-[15px] leading-relaxed">
            <span className="text-3xl leading-none text-[var(--faint)] block mb-1" aria-hidden>“</span>
            {body(r)}
            <footer className="mt-2 text-[12px] text-[var(--faint)]">— {r.author || t('common.anon', 'Anonymous')}</footer>
          </blockquote>
        ))}
      </div>
    );
  }
  return (
    <Card className="p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-2 flex items-center gap-1.5">
        <MessageSquareQuote size={12} /> {t('home.v3.said', 'What people said')}
      </div>
      <div className="space-y-3">
        {reviews.map((r) => (
          <blockquote key={r.id} className="text-[12px] leading-relaxed text-[var(--muted)]">
            {/* `bodyFr` was fetched on every load and never read: a French reader got the
                English quote beside French everything else. */}
            “{body(r)}”
            {/* `author`, not `authorName` — the field the API actually sends. The old name
                was always undefined, so every quote was signed "Anonymous". */}
            <span className="block mt-1 text-[11px] text-[var(--faint)]">— {r.author || t('common.anon', 'Anonymous')}</span>
          </blockquote>
        ))}
      </div>
    </Card>
  );
}

/** What can be commissioned. */
export function OffersCard({ myo, limit = 3 }) {
  const { t } = useI18n();
  const offers = (myo?.products || []).slice(0, limit);
  if (!offers.length) return null;
  return (
    <Card className="p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-2">
        {t('home.v3.offers', 'On offer')}
      </div>
      <ul className="space-y-2">
        {offers.map((o) => (
          <li key={o.id} className="flex items-center gap-2 text-[12px]">
            <span className="min-w-0 truncate">{o.name}</span>
            {o.priceCents != null && <Badge className="ms-auto shrink-0">{(o.priceCents / 100).toFixed(0)} €</Badge>}
          </li>
        ))}
      </ul>
      <Button as={Link} to="/myo" size="sm" className="mt-3 w-full justify-center">
        <Download size={13} /> {t('home.v3.myoCta', 'Commission something')}
      </Button>
    </Card>
  );
}
