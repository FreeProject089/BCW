// /bot/features and /bot/pricing (agent-bcw-bot): the two pages the bot and the dashboard send a
// server owner to when they reach for something their plan does not include.
//
// Both read GET /hosting/bot-plans (the admin's free tier, the tiers on sale, the credit packs
// and the per-call costs), so a feature is "Free" or "Pro" here exactly when the API gates it,
// and a price is the one the checkout will charge. `?feature=` (and the `#feature` anchor)
// opens on that feature; `?guild=` is carried into the checkout so the plan lands on the
// server the owner came from. Adapted from the OFD bot's pricing and Premium pages.
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Bot, Coins, Crown, KeyRound, Mic, Newspaper, ScrollText, Server, Shield, ShieldAlert, Sparkles, Wand2, Image as ImageIcon, Users, Check, CreditCard, HardDrive, Gauge,
} from 'lucide-react';
import PlanCard from '../ui/plan-card.jsx';
import { Button, Badge, Spinner, Explain, useDialog, useToast } from '../ui/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from './auth.jsx';
import { useI18n } from '../i18n.jsx';
import { botFeatureLabel } from '../ui/bot-plan-labels.js';

const ICONS = {
  automod: ShieldAlert, aiAutomod: Wand2, logRouting: ScrollText, welcome: Sparkles, welcomeBanner: ImageIcon, gating: Shield,
  rolePanels: Users, blog: Newspaper, joinToCreate: Mic, jtcPro: Mic, aiAsk: Wand2, aiByok: KeyRound,
};

function useGroups() {
  const { t } = useI18n();
  return useMemo(() => [
    { id: 'mod', title: t('bf.g.mod', 'Moderation'), keys: ['automod', 'logRouting'] },
    { id: 'community', title: t('bf.g.community', 'Community'), keys: ['welcome', 'welcomeBanner', 'gating', 'rolePanels', 'blog'] },
    { id: 'voice', title: t('bf.g.voice', 'Voice'), keys: ['joinToCreate', 'jtcPro'] },
    { id: 'ai', title: t('bf.g.ai', 'AI'), keys: ['aiAsk', 'aiAutomod', 'aiByok'] },
  ], [t]);
}

export function featureDesc(t, key) {
  switch (key) {
    case 'automod': return t('bf.d.automod', 'Spam, raids, mass mentions, bad links and words, stopped before they spread.');
    case 'logRouting': return t('bf.d.logRouting', 'Every event in its own channel or forum post, sorted by category.');
    case 'welcome': return t('bf.d.welcome', 'A welcome and goodbye card with the member’s avatar.');
    case 'welcomeBanner': return t('bf.d.welcomeBanner', 'Your own image behind the welcome card.');
    case 'gating': return t('bf.d.gating', 'Roles for members who linked their account.');
    case 'rolePanels': return t('bf.d.rolePanels', 'Buttons or a menu to pick roles, rules included.');
    case 'blog': return t('bf.d.blog', 'New blog posts announced in the channels you choose.');
    case 'joinToCreate': return t('bf.d.joinToCreate', 'Join a lobby, get your own voice room with a control panel.');
    case 'jtcPro': return t('bf.d.jtcPro', 'Transfer the room, pick the audio quality, block members from the panel.');
    case 'aiAsk': return t('bf.d.aiAsk', 'Members ask a short question with /ask. Included calls every month.');
    case 'aiAutomod': return t('bf.d.aiAutomod', 'A second look at phishing and toxic messages the rules let through.');
    case 'aiByok': return t('bf.d.aiByok', 'Use your own AI provider key, with no fee per call.');
    default: return '';
  }
}

/** Free when the admin's free tier includes it, else the first tier that does. */
function badgeFor(key, data) {
  if ((data?.free?.features || []).includes(key)) return 'free';
  const tier = (data?.tiers || []).find((x) => x.key !== 'free' && (x.features || []).includes(key));
  return tier?.key || 'pro';
}

function TierBadge({ k }) {
  const { t } = useI18n();
  if (k === 'free') return <Badge tone="green">{t('bd.tier.free', 'Free')}</Badge>;
  return <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md tint-primary text-[var(--accent-ink)]"><Crown size={10} /> {k === 'ultra' ? 'Ultra' : 'Pro'}</span>;
}

function usePlans() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get('/hosting/bot-plans').then(setD).catch(() => setD(false)); }, []);
  return d;
}

function Hero({ title, sub, children }) {
  return (
    <div className="plate w-fit max-w-full mb-6 sm:mb-8">
      <h1 className="text-2xl sm:text-[2rem] font-extrabold tracking-tight text-balance flex items-center gap-2.5">
        <Bot size={26} className="shrink-0" style={{ color: 'var(--brand-discord)' }} aria-hidden /> {title}
      </h1>
      <p className="text-[var(--muted)] mt-2 text-[15px] leading-relaxed max-w-2xl">{sub}</p>
      {children && <div className="flex items-center gap-2 flex-wrap mt-4">{children}</div>}
    </div>
  );
}

export function BotFeaturesPage() {
  const { t } = useI18n();
  const data = usePlans();
  const groups = useGroups();
  const { hash } = useLocation();
  const focus = decodeURIComponent((hash || '').slice(1));
  useEffect(() => {
    if (!focus || !data) return;
    document.getElementById(focus)?.scrollIntoView({ block: 'center' });
  }, [focus, data]);
  return (
    <div className="max-w-5xl mx-auto px-4 py-8 sm:py-12">
      <Hero title={t('bf.title', 'The BetterCommunity bot')} sub={t('bf.sub', 'Moderation, welcome cards, voice rooms, roles and AI for your Discord server. Free to start.')}>
        <Link to="/dashboard?s=discord"><Button variant="primary"><Server size={15} /> {t('bf.cta.start', 'Set up my server')}</Button></Link>
        <Link to="/bot/pricing"><Button variant="ghost"><Crown size={15} /> {t('bd.pricing', 'Plans and pricing')}</Button></Link>
      </Hero>
      {data === null && <div className="py-10 flex justify-center"><Spinner /></div>}
      <div className="space-y-8">
        {groups.map((g) => (
          <section key={g.id} aria-labelledby={`bf-${g.id}`}>
            <h2 id={`bf-${g.id}`} className="text-lg font-bold mb-3">{g.title}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {g.keys.map((k) => {
                const Icon = ICONS[k] || Bot;
                return (
                  <div key={k} id={k} className={`card p-4 scroll-mt-24 min-w-0 ${focus === k ? 'ring-2 ring-[var(--primary)]' : ''}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="grid place-items-center w-8 h-8 rounded-lg tint-primary text-[var(--accent-ink)] shrink-0"><Icon size={16} /></span>
                      <span className="font-semibold text-sm min-w-0 flex-1">{botFeatureLabel(t, k)}</span>
                      {data && <TierBadge k={badgeFor(k, data)} />}
                    </div>
                    <p className="text-[13px] text-[var(--muted)] mt-2">{featureDesc(t, k)}</p>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        <p className="text-[13px] text-[var(--muted)]">{t('bf.more', 'Also on every server: levels and points, a shop, giveaways, casino games, and a searchable log of moderation.')}</p>
      </div>
    </div>
  );
}

const money = (cents) => `$${(cents / 100).toFixed(2)}`;

export function BotPricingPage() {
  const { t } = useI18n(); const { user } = useAuth(); const nav = useNavigate();
  const dialog = useDialog(); const toast = useToast();
  const [sp] = useSearchParams();
  const feature = sp.get('feature') || '';
  const guildId = /^\d{5,32}$/.test(sp.get('guild') || '') ? sp.get('guild') : '';
  const data = usePlans();
  const [busy, setBusy] = useState('');
  const tiers = data?.tiers || [];
  // The card to stand forward: the first tier that includes the feature asked about, else Pro.
  const want = feature ? (tiers.find((x) => (x.features || []).includes(feature))?.key || 'pro') : 'pro';

  const subscribe = async (tier) => {
    if (!user) { nav(`/auth?next=${encodeURIComponent(`/bot/pricing${sp.toString() ? `?${sp}` : ''}`)}`); return; }
    const ok = await dialog.confirm({
      title: t('botplan.buy.t', 'Subscribe to {n}?').replace('{n}', tier.name),
      message: t('botplan.buy.m', 'A monthly subscription, billed until you cancel it from Billing. By continuing you accept the Terms and the Payments and Refunds policy. You choose the server it applies to from your dashboard.'),
      okLabel: t('botplan.buy.ok', 'Continue to payment'),
    });
    if (!ok) return;
    setBusy(tier.key);
    try {
      const r = await api.post('/hosting/bot-plans/checkout', { planId: tier.planId, acceptedTerms: true, ...(guildId ? { guildId } : {}) });
      // nosemgrep: js-open-redirect-from-function -- the URL is the Stripe Checkout URL our own API returned
      window.location = r.url;
    } catch (x) {
      const e = x?.data?.error;
      toast.error(e === 'stripe_not_configured' ? t('hosting.err.stripe', 'Payments not configured yet.')
        : e === 'not_your_server' ? t('botplan.mine.notyours', 'You no longer manage one of those servers.')
        : e === 'unknown_plan' ? t('botplan.err.gone', 'This plan is no longer on sale.')
        : t('hosting.err.checkout', 'Checkout failed.'));
    } finally { setBusy(''); }
  };

  const freeFeatures = data?.free?.features || [];
  const cardFeatures = (tier) => {
    const L = tier.limits || {};
    const rows = [
      { icon: Gauge, label: t('bp.ai', '{n} AI calls a month').replace('{n}', (L.aiMonthly ?? 0).toLocaleString()), yes: true },
      { icon: HardDrive, label: t('bp.storage', '{n} MB of member storage').replace('{n}', (L.storageMB ?? 0).toLocaleString()), yes: true },
    ];
    if (tier.key === 'free') rows.unshift({ icon: Check, label: t('bp.core', 'Every core module'), yes: true });
    else {
      rows.unshift({ icon: Server, label: tier.guilds > 1 ? t('botplan.card.guilds', 'On {n} of your servers').replace('{n}', tier.guilds) : t('botplan.card.guild1', 'On one of your servers'), yes: true });
      for (const f of (tier.features || []).filter((x) => !freeFeatures.includes(x))) rows.push({ label: botFeatureLabel(t, f), yes: true });
    }
    return rows;
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 sm:py-12">
      <Hero title={t('bp.title', 'Bot plans')} sub={t('bp.sub', 'Free covers most servers, AI included. A plan adds pro controls and more AI.')} />
      {feature && (
        <div className="rounded-xl border border-[var(--line)] tint-primary p-3 mb-6 flex items-center gap-3 flex-wrap">
          <Crown size={16} className="text-[var(--accent-ink)] shrink-0" />
          <span className="text-sm min-w-0 flex-1"><b>{botFeatureLabel(t, feature)}</b> {t('bp.incl', 'is included from {tier}.').replace('{tier}', want === 'ultra' ? 'Ultra' : want === 'free' ? t('bd.tier.free', 'Free') : 'Pro')}</span>
          <Link to={`/bot/features#${feature}`} className="text-sm text-[var(--accent-ink)] hover:underline">{t('bd.pw.what', 'What it does')}</Link>
        </div>
      )}
      {data === null && <div className="py-10 flex justify-center"><Spinner /></div>}
      {data === false && <p className="text-sm text-[var(--muted)]">{t('bp.down', 'The plans could not be loaded. Try again in a moment.')}</p>}
      {tiers.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 lg:gap-6 items-stretch">
          {tiers.map((tier) => {
            const isFree = tier.key === 'free';
            return (
              <PlanCard key={tier.key} name={isFree ? t('bd.tier.free', 'Free') : tier.name}
                tagline={isFree ? t('bp.tag.free', 'For every server') : tier.key === 'pro' ? t('bp.tag.pro', 'For an active server') : t('bp.tag.ultra', 'For large communities')}
                pill={t('bp.reco', 'Recommended')} featured={tier.key === want} disabled={!isFree && !tier.available}
                accent={isFree ? 'var(--line-strong)' : 'var(--brand-discord)'}
                price={{ now: isFree ? money(0) : money(tier.priceMonthlyCents), per: t('hosting.permo', '/mo') }}
                priceNote={isFree ? t('bp.note.free', 'No card needed.') : tier.available ? t('botplan.card.note', 'Billed monthly. Cancel any time from Billing.') : t('bp.soon', 'Coming soon.')}
                features={cardFeatures(tier)}
                action={isFree
                  ? <Link to={guildId ? `/dashboard?s=discord&guild=${guildId}` : '/dashboard?s=discord'} className="w-full"><Button className="w-full">{t('bp.cta.free', 'Start free')}</Button></Link>
                  : <Button variant="primary" className="w-full !whitespace-normal" disabled={!tier.available || busy === tier.key} onClick={() => subscribe(tier)}>
                      {busy === tier.key ? <Spinner /> : <><CreditCard size={15} className="shrink-0" /> {tier.available ? t('botplan.card.cta', 'Subscribe') : t('bp.soon.b', 'Soon')}</>}
                    </Button>}
                secondary={<Link to="/bot/features" className="text-[var(--accent-ink)] font-medium hover:underline">{t('bf.all', 'All features')}</Link>} />
            );
          })}
        </div>
      )}

      {data && (
        <section className="mt-12 grid lg:grid-cols-2 gap-6">
          <div className="card p-5 min-w-0">
            <h2 className="font-bold text-lg flex items-center gap-2"><Coins size={18} className="text-[var(--accent-ink)]" /> {t('bp.credits.t', 'Need more AI? Credits')}</h2>
            <p className="text-[13px] text-[var(--muted)] mt-1">{data.expiryMonths ? t('bp.credits.s2', 'One-time packs for one server, valid {n} months, spent oldest first.').replace('{n}', data.expiryMonths) : t('bp.credits.s3', 'One-time packs for one server, spent oldest first.')}</p>
            <div className="mt-3 rounded-xl border border-[var(--line)] divide-y divide-[var(--line)]">
              {(data.packs || []).map((pk) => (
                <div key={pk.id} className="px-3 py-2 flex items-center gap-3 text-sm">
                  <span className="font-semibold tabular-nums">{pk.credits.toLocaleString()}</span>
                  <span className="text-[var(--muted)] flex-1">{t('bd.credits.calls', 'About {n} AI calls').replace('{n}', Math.floor(pk.credits / (data.cost?.platform || 10)).toLocaleString())}</span>
                  <span className="text-[11.5px] text-[var(--faint)] hidden sm:inline">{pk.months ? t('bd.valid', 'Valid {n} months').replace('{n}', pk.months) : t('bd.valid.forever', 'No expiry')}</span>
                  <span className="font-semibold tabular-nums">{money(pk.priceCents)}</span>
                </div>
              ))}
            </div>
            <p className="text-[12px] text-[var(--muted)] mt-2">{t('bp.credits.buy', 'Buy them from your server’s Plan tab.')}</p>
          </div>
          <div className="card p-5 min-w-0">
            <h2 className="font-bold text-lg flex items-center gap-2"><KeyRound size={18} className="text-[var(--accent-ink)]" /> {t('bp.byok.t', 'Or bring your own key')}</h2>
            <p className="text-[13px] text-[var(--muted)] mt-1">{t('bp.byok.s', 'Use your own OpenAI-compatible provider. Your provider bills you.')}</p>
            <ul className="mt-3 space-y-1.5 text-sm">
              <li className="flex gap-2"><Check size={15} className="text-success shrink-0 mt-0.5" /> {t('bp.byok.free', 'Free plan: {n} credits per call.').replace('{n}', data.cost?.byokFee ?? 2)}</li>
              <li className="flex gap-2"><Check size={15} className="text-success shrink-0 mt-0.5" /> {t('bp.byok.pro', 'Pro and Ultra: no fee.')}</li>
              <li className="flex gap-2"><Check size={15} className="text-success shrink-0 mt-0.5" /> {t('bp.byok.safe', 'The key is sealed and never shown again.')}</li>
            </ul>
          </div>
        </section>
      )}

      <section className="mt-12 max-w-3xl space-y-2">
        <h2 className="font-bold text-lg mb-2">{t('hosting.nav.faq', 'Questions')}</h2>
        <Explain summary={t('bp.q1', 'What happens when my plan ends?')}><p>{t('bp.a1', 'Your settings are kept. What the plan added switches off; everything else keeps running.')}</p></Explain>
        <Explain summary={t('bp.q2', 'What counts as an AI call?')}><p>{t('bp.a2', 'One answer to /ask, or one AI moderation check. A failed call is not counted.')}</p></Explain>
        <Explain summary={t('bp.q3', 'Can one plan cover several servers?')}><p>{t('bp.a3', 'Ultra covers three. You pick them from your dashboard, among the servers you manage.')}</p></Explain>
        <Explain summary={t('bp.q4', 'What happens to a role bought on the marketplace?')}><p>{t('bp.a4', 'When its subscription ends, each server decides: the bot removes it at once, keeps it, or removes it after a grace period (7 days unless the server says otherwise).')}</p></Explain>
      </section>
    </div>
  );
}
