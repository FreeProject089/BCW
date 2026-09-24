// "Why BetterCommunity", the second section of the v1 landing page. N7 (agent-landing-N):
// redone from scratch.
//
// It was a big "what is checked, and by whom" panel (two flow cards of badges) over six equal
// tiles, each with a link: a lot of boxes at one weight, so nothing said which promise mattered.
// Now: one honest heading and a one-line promise, then FOUR pillars with a hierarchy. Trust and
// moderation is the featured one (the question a stranger asks first, and the one with two true
// answers); install, hosting and privacy/openness sit beside it, smaller. Every pillar carries a
// concrete proof and a link to the page that shows it.
//
// Only statements the platform already makes and keeps, worded plainly:
//   · the official catalogue is reviewed by the team before it is published;
//   · community catalogues and repositories are published by their author, show the account
//     behind them, can be reported by anyone (/report works signed out) and are suspended when
//     they break the rules;
//   · a catalogue link installs through BetterModsManager;
//   · a storage pool with a stable address, your own domain on a paid pool;
//   · no third-party trackers, no ads, first-party anonymous analytics off until opted in;
//   · a public status page; a documented API.
// No numbers: a count would be a claim about this month, and nothing here has to be.
import { Link } from 'react-router-dom';
import { ArrowRight, ShieldCheck, BadgeCheck, Users, Download, Cloud, Lock } from 'lucide-react';
import { Card } from '../ui/ui.jsx';
import { Marker } from '../ui/marker.jsx';
import { useI18n } from '../i18n.jsx';

function Go({ to, children, quiet = false }) {
  return (
    <Link to={to}
      className={`group inline-flex items-center gap-1.5 text-[13px] font-semibold min-h-[44px] sm:min-h-0 ${quiet ? 'text-[var(--muted)] hover:text-[var(--text)]' : 'text-[var(--accent-ink)]'}`}>
      <span className="group-hover:underline underline-offset-4">{children}</span>
      <ArrowRight size={13} className="rtl-mirror shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </Link>
  );
}

export default function WhySection() {
  const { t } = useI18n();

  const tracks = [
    { I: BadgeCheck, tone: 'text-success', label: t('home.why2.official', 'The official catalogue'),
      tag: t('home.why2.official.tag', 'Reviewed before publishing'), tagCls: 'badge badge-green',
      d: t('home.why2.official.d', 'A submission stays out of sight until someone on the team has opened and approved it, and a refusal comes with its reason.') },
    { I: Users, tone: 'text-[var(--accent-ink)]', label: t('home.why2.community', 'Community catalogues and repositories'),
      tag: t('home.why2.community.tag', 'Reportable by anyone'), tagCls: 'badge',
      d: t('home.why2.community.d', 'Published by their author straight away, with the account behind them shown. Anyone can report a problem, and we suspend what breaks the rules.') },
  ];

  const pillars = [
    { key: 'install', I: Download, title: t('home.why2.install', 'One-click install'),
      d: t('home.why2.install.d', 'A catalogue link opens BetterModsManager, which fetches the entry and puts it where the app expects it. No manual download, no hunting for files.'),
      links: [['/catalog', t('home.why2.install.go', 'Open the catalogue')]] },
    { key: 'host', I: Cloud, title: t('home.why2.host', 'Hosting you control'),
      d: t('home.why2.host.d', 'Your repos and catalogues share one storage pool with a stable address, and a paid pool can serve them on your own domain.'),
      links: [['/hosting', t('home.why2.host.go', 'See the hosting plans')]] },
    { key: 'open', I: Lock, title: t('home.why2.open', 'Private by default, open by design'),
      d: t('home.why2.open.d', 'No third-party trackers and no ads. Analytics are first-party, anonymous and off until you opt in. Uptime and incidents are on a public status page, and the API is documented for anyone.'),
      links: [['/legal/privacy', t('home.why2.open.go', 'Read the privacy policy')], ['/status', t('home.why2.open.go2', 'Status page')], ['/docs/bcweb-api', t('home.why2.open.go3', 'API reference')]] },
  ];

  return (
    <>
      <div className="reveal-on-scroll plate w-fit max-w-full mx-auto text-center mb-10">
        <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight">
          {t('home.why2.h.a', 'Four promises you can')} <Marker variant="circle">{t('home.why2.h.b', 'check')}</Marker>
        </h2>
        <p className="text-[var(--muted)] mt-2.5 max-w-xl mx-auto">{t('home.why2.sub', 'No fine print: each one links to the page that shows it is true.')}</p>
      </div>

      {/* One featured pillar, three beside it. Phone: a single column. md: the featured one full
          width over the three. lg: the featured one on the left for the whole height, the three
          stacked on the right. `min-w-0` everywhere: a long French word must wrap, not widen. */}
      <div className="reveal-stagger grid gap-4 md:grid-cols-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card className="relative overflow-hidden p-6 sm:p-8 md:col-span-3 lg:col-span-1 lg:row-span-3 min-w-0 flex flex-col">
          {/* A faint wash of the accent in one corner: decoration, under everything, no text on it
              that is not also on the card's own surface. */}
          <div aria-hidden="true" className="absolute inset-0 pointer-events-none opacity-[0.08]"
            style={{ background: 'radial-gradient(90% 70% at 0% 0%, var(--primary) 0%, transparent 70%)' }} />
          <div className="relative flex flex-col flex-1 min-w-0">
            <span className="grid place-items-center w-12 h-12 rounded-2xl bg-gradient-to-br from-brand to-brand-2 shrink-0" aria-hidden="true">
              <ShieldCheck size={22} className="text-[var(--on-primary)]" />
            </span>
            <h3 className="mt-5 text-xl sm:text-2xl font-extrabold tracking-tight leading-snug">{t('home.why2.trust', 'You know how everything was checked')}</h3>
            <p className="mt-2 text-[var(--muted)] leading-relaxed max-w-prose">
              {t('home.why2.trust.d', 'There are two ways onto the site, and what you are looking at says which one it took.')}
            </p>
            <ul className="mt-6 grid gap-3">
              {tracks.map(({ I, tone, label, tag, tagCls, d }) => (
                <li key={label} className="rounded-xl border border-[var(--line)] panel p-4 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                    <I size={16} className={`${tone} shrink-0`} aria-hidden="true" />
                    <span className="font-semibold text-[15px] min-w-0">{label}</span>
                    <span className={`${tagCls} ms-auto`}>{tag}</span>
                  </div>
                  <p className="mt-2 text-sm text-[var(--muted)] leading-relaxed">{d}</p>
                </li>
              ))}
            </ul>
            <div className="mt-auto pt-6 flex flex-wrap items-center gap-x-6 gap-y-1">
              <Go to="/submit">{t('home.why2.trust.go', 'Submit to the official catalogue')}</Go>
              <Go to="/report" quiet>{t('home.why2.trust.go2', 'Report a problem')}</Go>
            </div>
          </div>
        </Card>

        {pillars.map(({ key, I, title, d, links }) => (
          <Card key={key} className="p-5 sm:p-6 min-w-0 flex flex-col">
            <div className="flex items-center gap-3">
              <span className="grid place-items-center w-10 h-10 rounded-xl tint-primary shrink-0" aria-hidden="true">
                <I size={18} className="text-[var(--accent-ink)]" />
              </span>
              <h3 className="font-bold text-[17px] leading-snug min-w-0">{title}</h3>
            </div>
            <p className="mt-3 text-sm text-[var(--muted)] leading-relaxed flex-1">{d}</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-0">
              {links.map(([to, label], i) => <Go key={to} to={to} quiet={i > 0}>{label}</Go>)}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
