// /hosting#bot: the Discord bot plans (M21).
//
// The bot itself is free on every server; a plan unlocks more on the servers its buyer picks
// (apps/api/src/lib/bot-entitlements.mjs has the rules). This section lists the bot-only
// plans with the same card as the storage plans (ui/plan-card.jsx), in the Discord colour, and
// names the storage plans that include a bot plan (the bundles, which are bought in the grid
// above like any storage plan).
//
// Rendered only when something is on sale: the plans are created switched off, and a heading
// over an empty row would be a promise the page cannot keep.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, CreditCard, Server, Save } from 'lucide-react';
import { Button, Card, Spinner, useDialog, useToast } from '../ui/ui.jsx';
import PlanCard from '../ui/plan-card.jsx';
import { api } from '../lib/api.js';
import { useAuth } from './auth.jsx';
import { useI18n } from '../i18n.jsx';
import { BOT_LIMIT_KEYS, botFeatureLabel, botLimitLabel } from '../ui/bot-plan-labels.js';

/** The public list, fetched once. `null` while loading, `false` when the API did not answer. */
export function useBotPlans() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get('/hosting/bot-plans').then(setD).catch(() => setD(false)); }, []);
  return d;
}

export default function HostingBotPlans({ data }) {
  const { t } = useI18n(); const { user } = useAuth(); const nav = useNavigate();
  const dialog = useDialog(); const toast = useToast();
  const [busy, setBusy] = useState('');
  const [mine, setMine] = useState(null);
  useEffect(() => { if (user) api.get('/me/bot-plans').then(setMine).catch(() => setMine(null)); }, [user]);
  const hasOffer = !!data && !!(data.plans?.length || data.bundles?.length);
  // A subscriber still sees their own plans when nothing is on sale any more: that is where
  // they point it at a server.
  if (!hasOffer && !mine?.subs?.length) return null;
  const free = (data && data.free) || { features: [], limits: {} };

  const subscribe = async (pl) => {
    if (!user) return nav('/auth');
    // The same promise the cart asks for, asked here because this checkout has no cart.
    const ok = await dialog.confirm({
      title: t('botplan.buy.t', 'Subscribe to {n}?').replace('{n}', pl.name),
      message: t('botplan.buy.m', 'A monthly subscription, billed until you cancel it from Billing. By continuing you accept the Terms and the Payments and Refunds policy. You choose the server it applies to from your dashboard.'),
      okLabel: t('botplan.buy.ok', 'Continue to payment'),
    });
    if (!ok) return;
    setBusy(pl.id);
    try {
      const r = await api.post('/hosting/bot-plans/checkout', { planId: pl.id, acceptedTerms: true });
      window.location = r.url;
    } catch (x) {
      const e = x?.data?.error;
      toast.error(e === 'stripe_not_configured' ? t('hosting.err.stripe', 'Payments not configured yet.')
        : e === 'unknown_plan' ? t('botplan.err.gone', 'This plan is no longer on sale.')
        : t('hosting.err.checkout', 'Checkout failed.'));
    } finally { setBusy(''); }
  };

  return (
    <section id="bot" className="scroll-mt-24">
      <div className="plate w-fit max-w-full mt-14 sm:mt-20 mb-6 sm:mb-7">
        <h2 className="text-2xl sm:text-[1.75rem] font-extrabold tracking-tight text-balance flex items-center gap-2.5">
          <Bot size={24} className="shrink-0" style={{ color: 'var(--brand-discord)' }} aria-hidden />
          {t('botplan.title', 'The Discord bot, with more room')}
        </h2>
        <p className="text-[var(--muted)] mt-2 text-[15px] leading-relaxed max-w-2xl">
          {t('botplan.sub', 'The bot is free on every server. A plan unlocks more on the servers you choose. When a plan ends, your settings are kept and what it added switches off.')}
        </p>
      </div>

      {mine?.subs?.length > 0 && <MyBotPlans mine={mine} reload={() => api.get('/me/bot-plans').then(setMine).catch(() => {})} />}

      {data?.plans?.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 lg:gap-6 items-stretch">
          {data.plans.map((pl) => {
            const b = pl.bot;
            // What the plan ADDS: its features that the free tier does not already give, then
            // every limit it raises above the free tier. A line repeating what everyone gets
            // for free would be selling the free tier back to people.
            const adds = b.features.filter((f) => !free.features.includes(f));
            const raises = BOT_LIMIT_KEYS.filter((k) => (b.limits[k] || 0) > (free.limits?.[k] || 0));
            const features = [
              { icon: Server, label: b.guilds > 1 ? t('botplan.card.guilds', 'On {n} of your servers').replace('{n}', b.guilds) : t('botplan.card.guild1', 'On one of your servers'), yes: true },
              ...adds.map((f) => ({ label: botFeatureLabel(t, f), yes: true })),
              ...raises.map((k) => ({ label: botLimitLabel(t, k, b.limits[k]), yes: true })),
            ];
            if (!adds.length && !raises.length) features.push({ label: t('botplan.card.same', 'Everything is free on the bot right now, this plan adds nothing yet'), yes: false });
            const cents = pl.priceMonthlyCents;
            return (
              <PlanCard key={pl.id} name={pl.name} accent="var(--brand-discord)"
                tagline={t('botplan.card.tag', 'Bot only, no storage')}
                price={{ now: `$${(cents / 100).toFixed(2)}`, per: t('hosting.permo', '/mo') }}
                priceNote={t('botplan.card.note', 'Billed monthly. Cancel any time from Billing.')}
                features={features}
                action={(
                  <Button variant="primary" className="w-full !whitespace-normal" disabled={busy === pl.id} onClick={() => subscribe(pl)}>
                    {busy === pl.id ? <Spinner /> : <><CreditCard size={15} className="shrink-0" /> {t('botplan.card.cta', 'Subscribe')}</>}
                  </Button>
                )}
                secondary={<a href="/dashboard?s=discord" className="text-[var(--accent-ink)] font-medium hover:underline">{t('botplan.card.dash', 'See my servers')}</a>} />
            );
          })}
        </div>
      )}

      {data?.bundles?.length > 0 && (
        <p className="plate w-fit max-w-full mt-5 text-[13.5px] text-[var(--muted)] leading-relaxed">
          {t('botplan.bundles', 'Also included with these storage plans: {list}. Buy them above like any storage plan; the bot part is set up from your dashboard.')
            .replace('{list}', data.bundles.map((x) => x.name).join(', '))}
        </p>
      )}
    </section>
  );
}

/**
 * The buyer's own plans, and which of their servers each one applies to.
 *
 * The checkboxes are the servers the API says they manage (owner or Manage-Server, as the bot
 * reports it); the API checks that again on save, and refuses more servers than the plan
 * covers. A plan pointed at no server grants nothing, which is said on the card.
 */
function MyBotPlans({ mine, reload }) {
  const { t } = useI18n(); const toast = useToast();
  const [sel, setSel] = useState(() => Object.fromEntries(mine.subs.map((s) => [s.id, s.botGuildIds || []])));
  const [busy, setBusy] = useState('');
  const save = async (s) => {
    setBusy(s.id);
    try {
      await api.put(`/me/bot-plans/${s.id}/guilds`, { guildIds: sel[s.id] || [] });
      toast.success(t('botplan.mine.saved', 'Saved. The bot applies it within a minute.'));
      reload();
    } catch (x) {
      const e = x?.data?.error;
      toast.error(e === 'too_many_servers' ? t('botplan.mine.toomany', 'This plan covers {n} server(s).').replace('{n}', x.data.max)
        : e === 'not_your_server' ? t('botplan.mine.notyours', 'You no longer manage one of those servers.')
        : t('common.failed', 'Failed.'));
    } finally { setBusy(''); }
  };
  return (
    <Card className="p-5 sm:p-6 mb-6">
      <div className="font-semibold text-[15px]">{t('botplan.mine.t', 'Your bot plans')}</div>
      <p className="text-[13px] text-[var(--muted)] mt-1">{t('botplan.mine.s', 'Pick the servers each plan applies to. You can move it to another server at any time.')}</p>
      <div className="mt-4 flex flex-col gap-4">
        {mine.subs.map((s) => {
          const picked = sel[s.id] || [];
          const max = s.bot?.guilds || 1;
          return (
            <div key={s.id} className="rounded-xl border border-[var(--line)] p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="font-medium text-[14px] min-w-0 truncate" title={s.planName}>{s.planName}</div>
                <div className="text-[12px] text-[var(--muted)] tabular-nums">{t('botplan.mine.count', '{a} of {b} server(s)').replace('{a}', picked.length).replace('{b}', max)}</div>
              </div>
              {!picked.length && <p className="text-[12px] text-warning mt-1">{t('botplan.mine.none', 'Not on any server yet, so it unlocks nothing.')}</p>}
              {!mine.guilds.length
                ? <p className="text-[12.5px] text-[var(--muted)] mt-2">{t('botplan.mine.noguild', 'No server of yours has the bot yet. Link your Discord account in your profile and invite the bot, then come back here.')}</p>
                : (
                  <div className="mt-3 grid sm:grid-cols-2 gap-1.5">
                    {mine.guilds.map((g) => {
                      const on = picked.includes(g.guildId);
                      const full = !on && picked.length >= max;
                      return (
                        <label key={g.guildId} className={`flex items-center gap-2 text-[13px] min-w-0 ${full ? 'opacity-50' : 'cursor-pointer'}`}>
                          <input type="checkbox" checked={on} disabled={full}
                            onChange={(e) => setSel((m) => ({ ...m, [s.id]: e.target.checked ? [...picked, g.guildId] : picked.filter((x) => x !== g.guildId) }))} />
                          <span className="truncate min-w-0" title={g.name || g.guildId}>{g.name || g.guildId}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              <Button size="sm" variant="primary" className="mt-3" disabled={busy === s.id || !mine.guilds.length} onClick={() => save(s)}>
                {busy === s.id ? <Spinner /> : <Save size={14} />} {t('common.save', 'Save')}
              </Button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
