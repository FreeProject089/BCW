// The snake: numbered steps joined by one line that winds left and right down the page (N5:
// thin, routed round the cards, walked part solid and the rest dashed). Two users of it:
//
//   · `SnakeSteps`, the list itself: v1's "Get going in minutes" draws its three steps with
//     it, and the snake landing page below draws the whole journey with it;
//   · `HomeSnake`, the fourth landing page (v4, Admin → Home page): a short hero, then the
//     path from "look around" to "have it built", then the suite, the news and the ask.
//
// A step is done only when the page KNOWS it is: signed in, a catalogue opened in this browser,
// something published, a pool owned (the same facts v1's steps read). Nothing is ticked on a
// guess, and a signed-out reader sees every stop open, which is true.
//
// The line is ui/snake.jsx: computed from where the stops are, so it follows the layout in
// every language and at every width, straight down on a phone.
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Users, Search, Download, Upload, Cloud, Code2, Wand2 } from 'lucide-react';
import { Button } from '../ui/ui.jsx';
import { useI18n } from '../i18n.jsx';
import { SnakePath } from '../ui/snake.jsx';
import { Marker, HandNote } from '../ui/marker.jsx';
import { heroCtas, heroNote } from '../lib/home-ctas.js';
import { ProductRows, NewsGrid, Kicker, ClosingBand } from './home-sections.jsx';
import StatusBanner from './status-banner.jsx';

/**
 * @param steps  [{ key, icon, title, desc, to, cta, done }]
 * @param note   optional handwritten aside beside the first open stop
 */
export function SnakeSteps({ steps, note = null, className = '' }) {
  const doneCount = (() => { let n = 0; for (const s of steps) { if (!s.done) break; n += 1; } return n; })();
  const firstOpen = steps.findIndex((s) => !s.done);
  return (
    <ol className={`snake-list reveal-stagger ${className}`}>
      <SnakePath done={doneCount} />
      {steps.map((s, i) => {
        const I = s.icon;
        return (
          <li key={s.key} data-snake-row="" className={`snake-row ${i % 2 ? 'is-flip' : ''}`}>
            <span aria-hidden="true" data-snake-dot="" className={`snake-dot ${s.done ? 'is-done' : i === firstOpen ? 'is-current' : ''}`}>
              {s.done ? <CheckCircle2 size={18} /> : i + 1}
            </span>
            <div className="snake-card">
            <Link to={s.to} className="group block">
              <div className={`rounded-2xl border p-5 sm:p-6 transition-colors ${s.done
                ? 'border-[var(--line)] panel-quiet'
                : 'border-[var(--line)] bg-[var(--surface)] group-hover:border-[color-mix(in_srgb,var(--primary)_45%,var(--line))]'}`}>
                <div className="flex items-start gap-4">
                  <span className={`grid place-items-center w-10 h-10 rounded-xl shrink-0 ${s.done
                    ? 'bg-[var(--surface-2)] border border-[var(--line)]'
                    : 'bg-gradient-to-br from-brand to-brand-2'}`}>
                    <I size={19} className={s.done ? 'text-[var(--muted)]' : 'text-white'} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-[17px] leading-snug">
                      <span className="sr-only">{`${i + 1}. `}</span>{s.title}
                      {s.done && <span className="sr-only">{` (${s.doneLabel})`}</span>}
                    </div>
                    <div className="text-sm text-[var(--muted)] mt-1.5 leading-relaxed">{s.desc}</div>
                    <div className={`text-sm mt-4 inline-flex items-center gap-1.5 font-semibold ${s.done ? 'text-[var(--muted)]' : 'text-[var(--accent-ink)]'}`}>
                      {s.cta} <ArrowRight size={14} className="rtl-mirror transition-transform group-hover:translate-x-1" aria-hidden="true" />
                    </div>
                  </div>
                </div>
              </div>
            </Link>
            {note && i === firstOpen && (
              <div className="mt-2 ps-2"><HandNote arrow="up">{note}</HandNote></div>
            )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** The journey the snake landing page walks, from the facts the page already has. */
function journey({ t, user, progress, browsed, myoOn }) {
  const done = t('home.snake.doneSr', 'done');
  return [
    { key: 'account', icon: Users, title: t('home.snake.s1', 'Make yourself at home'),
      desc: t('home.snake.s1.d', 'A free account lets you publish, host and manage what you share. Browsing never needs one.'),
      to: user ? '/profile' : '/auth', cta: user ? t('home.step1.done', "You're set, view profile") : t('home.step1.cta', 'Sign up free'), done: !!user },
    { key: 'find', icon: Search, title: t('home.snake.s2', 'Find what you came for'),
      desc: t('home.snake.s2.d', 'Apps, plugins, themes and presets, in the official catalogue and in the ones the community runs.'),
      to: '/catalog', cta: t('home.step2.cta', 'Browse the catalog'), done: !!browsed || !!progress?.published },
    { key: 'install', icon: Download, title: t('home.snake.s3', 'Install it in one click'),
      desc: t('home.snake.s3.d', 'A catalogue link opens BetterModsManager, which fetches the entry and puts it where the app expects it.'),
      to: '/p/bmm', cta: t('home.snake.s3.cta', 'Meet BetterModsManager') },
    { key: 'share', icon: Upload, title: t('home.snake.s4', 'Share your own'),
      desc: t('home.snake.s4.d', 'Submit to the official catalogue, which the team reads first, or publish a Server-Repo of your own.'),
      to: '/submit', cta: t('home.snake.s4.cta', 'Open the submit page'), done: !!progress?.published },
    { key: 'host', icon: Cloud, title: t('home.snake.s5', 'Host it here'),
      desc: t('home.snake.s5.d', 'A storage pool for your repos and catalogues, a stable address, and your own domain on a paid pool.'),
      to: progress?.hosting ? '/dashboard' : '/hosting#plans',
      cta: progress?.hosting ? t('home.step3.done', 'Hosting is live, open your dashboard') : t('home.step3.cta', 'See hosting plans'), done: !!progress?.hosting },
    myoOn
      ? { key: 'build', icon: Wand2, title: t('home.snake.s6b', 'Or have it built'),
        desc: t('home.snake.s6b.d', 'A bot, an app or a website made to order: a paid consultation and a quote first, the work only once you approve it.'),
        to: '/myo', cta: t('home.snake.s6b.cta', 'See how a commission works') }
      : { key: 'build', icon: Code2, title: t('home.snake.s6', 'Build on it'),
        desc: t('home.snake.s6.d', 'A REST API, sign-in with OpenID Connect and webhooks, for tools that work with BetterCommunity accounts.'),
        to: '/dev', cta: t('home.dev.cta', 'Open the developer area') },
  ].map((s) => ({ ...s, doneLabel: done }));
}

/* ────────────────────────────────────────────────────────────────────────────
   v4 — the path
   ──────────────────────────────────────────────────────────────────────────── */

export function HomeSnake(ctx) {
  const { t } = useI18n();
  const { show, user, products, progress, browsed, myo } = ctx;
  const posts = (ctx.data?.posts || []).slice(0, 3);
  const steps = journey({ t, user, progress, browsed, myoOn: show('myo') && myo?.enabled !== false });
  const firstOpen = steps.find((s) => !s.done);
  return (
    <div className="space-y-24 md:space-y-32">
      <section className="text-center pt-16 md:pt-24">
        <h1 className="anim-slide font-extrabold leading-[1.02] tracking-[-0.03em] break-words text-[clamp(2rem,7.5vw,4.5rem)]" style={{ animationDelay: '60ms' }}>
          {t('home.snake.h1', 'From a first look to')} <Marker delay={420}><span className="gradient-text">{t('home.snake.h1b', 'your own corner')}</span></Marker>
        </h1>
        <p className="anim-slide plate text-[var(--muted)] text-lg max-w-xl mx-auto mt-6 leading-relaxed" style={{ animationDelay: '140ms' }}>
          {t('home.snake.sub', 'Follow the path: every stop is a page you can open now, and the ones you have already done are ticked.')}
        </p>
        <div className="anim-slide flex flex-wrap gap-3 justify-center mt-8" style={{ animationDelay: '220ms' }}>
          {heroCtas(user, t).map((c) => (
            <Link key={c.to} to={c.to}>
              <Button variant={c.primary ? 'primary' : undefined} className="!px-6 !py-3">
                {c.label}{c.arrow && <ArrowRight size={16} />}
              </Button>
            </Link>
          ))}
        </div>
        {heroNote(user, t) && (
          <p className="anim-slide plate w-fit max-w-full mx-auto px-2 mt-3" style={{ animationDelay: '280ms' }}><HandNote arrow="up">{heroNote(user, t)}</HandNote></p>
        )}
      </section>

      {show('status') && <StatusBanner />}

      {show('steps') && (
        <section aria-labelledby="snake-path-h" className="reveal-on-scroll">
          <h2 id="snake-path-h" className="sr-only">{t('home.snake.pathH', 'The path, step by step')}</h2>
          <SnakeSteps steps={steps} className="max-w-5xl mx-auto"
            note={firstOpen ? (user ? t('home.snake.noteIn', 'You are here') : t('home.snake.noteOut', 'Start here, it is free')) : null} />
        </section>
      )}

      {show('products') && products?.length > 0 && (
        <section>
          <Kicker label={t('home.k.products', 'The suite')} />
          <ProductRows products={products} style="cards" />
        </section>
      )}

      {show('news') && posts.length > 0 && (
        <section>
          <Kicker label={t('home.k.news', 'From the blog')}>
            <Link to="/blog" className="text-xs text-[var(--muted)] hover:text-[var(--text)]">{t('common.seeAll', 'See all')}</Link>
          </Kicker>
          <NewsGrid posts={posts} limit={3} heading={false} />
        </section>
      )}

      <ClosingBand user={user} t={t} />
    </div>
  );
}
