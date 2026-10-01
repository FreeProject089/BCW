// The Discord bot dashboard for server owners (agent-bcw-bot), rebuilt.
//
// Layout borrowed from the owner's OFD bot (apps/web/src/dashboard/DashboardLayout.tsx and
// its PremiumLock): a server rail on the left, then ONE server at a time with five views:
//
//   Overview   three numbers (members, AI calls left, credits) and the modules at a glance
//   Modules    a grid of cards, each with its state and a plan badge; a card opens its page
//   Logs       the moderation log channel and the routing table
//   Members    the stored roster (only in pool mode)
//   Plan       the tier, the AI allowance and its source (the platform, or the server's own
//              key), the credit wallet and the packs
//
// The module pages are the editors that already existed (discord-servers.jsx GuildConfig,
// embedded one section at a time), so nothing an owner could configure before is lost. A paid
// feature is never hidden: its card carries a "Pro" badge, and a save the API refuses (402)
// opens the plans prompt with links to /bot/pricing and /bot/features for this server.
//
// The URL carries the state (?s=discord&guild=…&view=…), so the bot's paywall links and the
// Stripe return land on the right server and the right view.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Bot, Coins, Crown, KeyRound, LayoutGrid, Lock, MessageSquare, Mic, Newspaper, ScrollText, Server, Shield, ShieldAlert, Sparkles, Users, Wand2, Gauge,
} from 'lucide-react';
import { GuildConfig, DiscordLinkInline } from './discord-servers.jsx';
import { DiscordIcon } from '../ui/brand.jsx';
import { SP, Panel, Head, Eyebrow } from '../ui/discord-kit.jsx';
import { api } from '../lib/api.js';
import { safeHref } from '../lib/safe-href.js';
import { botFeatureLabel } from '../ui/bot-plan-labels.js';
import { useI18n } from '../i18n.jsx';
import { Button, Badge, Input, Field, Spinner, EmptyState, Modal, Explain, useToast, useDialog } from '../ui/ui.jsx';

// The Discord-blue tile behind a server icon (the same wash the old hero used).
const DISCORD_TILE = { background: 'color-mix(in srgb, var(--brand-discord) 15%, transparent)' };
const TIER_TONE = { free: 'blue', pro: 'primary', ultra: 'primary', unlimited: 'green' };
export const tierName = (t, k) => ({ free: t('bd.tier.free', 'Free'), pro: 'Pro', ultra: 'Ultra', unlimited: t('bd.tier.unlimited', 'Unlimited') }[k] || k);

/** The modules, in grid order. `feature` gates the whole module; `pro` names its paid extras. */
function useModules() {
  const { t } = useI18n();
  return useMemo(() => [
    { id: 'automod', icon: ShieldAlert, feature: 'automod', label: t('ds.sec.automod', 'Automod'), sub: t('bd.m.automod', 'Stops spam, raids and bad links.'),
      on: (d) => d.moderation?.enabled !== false && !!d.moderation?.automod?.enabled },
    { id: 'welcome', icon: Sparkles, feature: 'welcome', label: t('ds.sec.welcome', 'Welcome'), sub: t('bd.m.welcome', 'A card for every arrival.'),
      on: (d) => !!d.welcome?.enabled },
    { id: 'voice', icon: Mic, feature: 'joinToCreate', pro: 'jtcPro', label: t('ds.sec.voice', 'Voice'), sub: t('bd.m.voice', 'Personal voice rooms with a control panel.'),
      on: (d) => !!d.joinToCreate?.enabled },
    { id: 'roles', icon: Shield, feature: 'gating', label: t('ds.sec.roles', 'Roles'), sub: t('bd.m.roles', 'Roles given automatically or picked from a panel.'),
      on: (d) => !!d.gating?.enabled || (d.rolePanels || []).length > 0 },
    { id: 'blog', icon: Newspaper, feature: 'blog', label: t('ds.sec.blog', 'Announcements'), sub: t('bd.m.blog', 'Blog posts in your channels.'),
      on: (d) => (d.blog?.routes || []).length > 0 },
    { id: 'logs', icon: ScrollText, pro: 'logRouting', label: t('ds.sec.logs', 'Logs'), sub: t('bd.m.logs', 'Where each event is written down.'),
      on: (d) => !!(d.guild?.logChannelId || d.logRouting?.forumId) },
    { id: 'ai', icon: Wand2, feature: 'aiAsk', pro: 'aiAutomod', label: t('bd.m.ai.t', 'AI'), sub: t('bd.m.ai', 'The /ask helper, and AI moderation.'),
      on: () => true },
  ], [t]);
}

const has = (ent, f) => !f || !!ent?.unlimited || (ent?.features || []).includes(f);

/** "Unlock with Pro": what a paid feature does and where to get it. Never a dead end. */
export function PaywallModal({ open, onClose, feature, guildId, limit }) {
  const { t } = useI18n();
  const q = new URLSearchParams({ ...(feature ? { feature } : {}), ...(guildId ? { guild: guildId } : {}) }).toString();
  return (
    <Modal open={open} onClose={onClose} icon={Crown} title={t('bd.pw.t', 'Unlock with Pro')}
      footer={(
        <div className="flex gap-2 justify-end flex-wrap">
          {feature && <Link to={`/bot/features#${feature}`} onClick={onClose}><Button variant="ghost">{t('bd.pw.what', 'What it does')}</Button></Link>}
          <Link to={`/bot/pricing${q ? `?${q}` : ''}`} onClick={onClose}><Button variant="primary"><Crown size={14} /> {t('bd.pw.plans', 'See plans')}</Button></Link>
        </div>
      )}>
      <p className="text-sm">
        {limit
          ? t('bd.pw.limit', 'This server reached its plan limit ({n}).').replace('{n}', limit)
          : t('bd.pw.feature', '{f} is part of a paid plan.').replace('{f}', feature ? botFeatureLabel(t, feature) : t('bd.pw.this', 'This feature'))}
      </p>
      <p className="text-[12.5px] text-[var(--muted)] mt-1.5">{t('bd.pw.free', 'Everything else keeps working on the free plan.')}</p>
    </Modal>
  );
}

function ProBadge({ className = '' }) {
  const { t } = useI18n();
  return <span className={`inline-flex items-center gap-1 text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md tint-primary text-[var(--accent-ink)] ${className}`} title={t('bd.pro.t', 'Part of a paid plan')}><Crown size={10} /> Pro</span>;
}

function Stat({ icon: Icon, label, value, sub, bar }) {
  return (
    <div className="rounded-xl border border-[var(--line)] p-3 min-w-0">
      <div className="flex items-center gap-1.5 text-[11px] text-[var(--faint)]"><Icon size={12} /> <span className="truncate" title={label}>{label}</span></div>
      <div className="text-lg font-bold tabular-nums leading-tight mt-1 truncate" title={String(value)}>{value}</div>
      {bar != null && (
        <div className="h-1.5 rounded-full bg-[var(--surface-2)] mt-2 overflow-hidden" role="progressbar" aria-valuenow={Math.round(bar * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className={`h-full rounded-full ${bar >= 1 ? 'bg-error' : bar >= 0.8 ? 'bg-warning' : 'bg-[var(--primary)]'}`} style={{ width: `${Math.min(100, Math.round(bar * 100))}%` }} />
        </div>
      )}
      {sub && <div className="text-[11px] text-[var(--muted)] mt-1 truncate" title={sub}>{sub}</div>}
    </div>
  );
}

/** One module card: state, plan badge, opens its page. */
function ModuleCard({ m, data, ent, onOpen }) {
  const { t } = useI18n();
  const locked = !has(ent, m.feature);
  const extrasLocked = m.pro && !has(ent, m.pro);
  const on = !locked && m.on(data);
  return (
    <button type="button" onClick={() => onOpen(m)}
      className="text-start rounded-xl border border-[var(--line)] p-3 hover:b-primary transition flex gap-3 min-w-0 group">
      <span className={`grid place-items-center w-9 h-9 rounded-lg shrink-0 ${on ? 'tint-primary text-[var(--accent-ink)]' : 'bg-[var(--surface-2)] text-[var(--muted)]'}`}><m.icon size={17} /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="font-medium text-sm truncate" title={m.label}>{m.label}</span>
          {locked ? <ProBadge /> : extrasLocked ? <span className="text-[10.5px] text-[var(--faint)] inline-flex items-center gap-0.5" title={botFeatureLabel(t, m.pro)}><Lock size={10} /> {t('bd.proextras', 'Pro options')}</span> : null}
        </span>
        <span className="block text-[11.5px] text-[var(--muted)] mt-0.5 line-clamp-2">{m.sub}</span>
      </span>
      <span className={`text-[10.5px] font-semibold shrink-0 self-start mt-0.5 ${on ? 'text-success' : 'text-[var(--faint)]'}`}>{locked ? '' : on ? t('bd.on', 'On') : t('bd.off', 'Off')}</span>
    </button>
  );
}

/** The AI module: /ask for members, AI moderation (Pro), and where the calls come from. */
function AiModule({ billing, ent, go, paywall }) {
  const { t } = useI18n();
  const ai = billing?.ai || {};
  const rows = [
    { f: 'aiAsk', title: t('bd.ai.ask', 'The /ask helper'), sub: t('bd.ai.ask.s', 'Members ask a short question, the bot answers.'),
      right: has(ent, 'aiAsk') ? <Badge tone="green">{t('bd.included', 'Included')}</Badge> : <Button size="sm" onClick={() => paywall({ feature: 'aiAsk' })}><Crown size={12} /> {t('bd.unlock', 'Unlock')}</Button> },
    { f: 'aiAutomod', title: t('bd.ai.mod', 'AI moderation'), sub: t('bd.ai.mod.s', 'A second look at links and toxic messages the rules let through.'),
      right: has(ent, 'aiAutomod') ? <Button size="sm" variant="ghost" onClick={() => go('module', 'automod')}>{t('bd.ai.mod.open', 'Set it up in Automod')}</Button> : <Button size="sm" onClick={() => paywall({ feature: 'aiAutomod' })}><Crown size={12} /> {t('bd.unlock', 'Unlock')}</Button> },
  ];
  return (
    <div className={SP.page}>
      <Head title={t('bd.m.ai.t', 'AI')} sub={t('bd.ai.sub', 'Every plan includes AI calls each month. Credits pay for more.')} />
      <div className="rounded-xl border border-[var(--line)] divide-y divide-[var(--line)]">
        {rows.map((r) => (
          <div key={r.f} className={`${SP.row} flex items-center gap-3 flex-wrap`}>
            <div className="min-w-0 flex-1"><div className="text-sm font-medium">{r.title}</div><div className="text-[11.5px] text-[var(--muted)]">{r.sub}</div></div>
            {r.right}
          </div>
        ))}
      </div>
      <div className={`grid grid-cols-1 sm:grid-cols-2 ${SP.grid}`}>
        <Stat icon={Gauge} label={t('bd.ai.left', 'AI calls left this month')} value={`${ai.left ?? 0} / ${ai.included ?? 0}`} bar={ai.included ? (ai.used?.platform || 0) / ai.included : null} />
        <Stat icon={Coins} label={t('bd.credits', 'Credits')} value={(billing?.credits?.balance ?? 0).toLocaleString()} sub={ai.creditCalls != null ? t('bd.ai.more', 'About {n} more calls').replace('{n}', ai.creditCalls) : null} />
      </div>
      <Button variant="ghost" className="w-fit" onClick={() => go('billing')}><KeyRound size={14} /> {t('bd.ai.source', 'AI source and credits')}</Button>
    </div>
  );
}

/** A role bought on the marketplace, when its subscription ends: take it back now, keep it, or
 *  after a grace period (the default). The bot carries it out (API lib/purchased-roles.mjs). */
function RoleEndPolicy({ guildId, value, onSaved }) {
  const { t } = useI18n(); const toast = useToast();
  const [v, setV] = useState(value || { onEnd: 'grace', graceDays: 7 });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (value) setV(value); }, [value]);
  const dirty = JSON.stringify(v) !== JSON.stringify(value);
  const save = async () => {
    setBusy(true);
    try { await api.put(`/me/discord/guilds/${guildId}/purchased-roles`, { onEnd: v.onEnd, graceDays: Math.max(1, Math.min(90, Math.round(Number(v.graceDays) || 7))) }); toast.success(t('ds.saved', 'Saved.')); onSaved?.(); }
    catch { toast.error(t('common.failed', 'Failed.')); } finally { setBusy(false); }
  };
  const opts = [['grace', t('bd.re.grace', 'After a grace period')], ['remove', t('bd.re.remove', 'Remove at once')], ['keep', t('bd.re.keep', 'Keep the role')]];
  return (
    <Panel className={SP.stack}>
      <Head title={t('bd.re.t', 'Roles bought on the marketplace')} sub={t('bd.re.s', 'When a subscription ends.')} />
      <div className="flex gap-1.5 flex-wrap" role="radiogroup" aria-label={t('bd.re.t', 'Roles bought on the marketplace')}>
        {opts.map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={v.onEnd === k} onClick={() => setV({ ...v, onEnd: k })}
            className={`px-3 py-1.5 rounded-lg border text-sm transition ${v.onEnd === k ? 'border-[var(--primary)] tint-primary font-medium' : 'border-[var(--line)] hover:border-[var(--line-strong)] text-[var(--muted)]'}`}>{label}</button>
        ))}
      </div>
      {v.onEnd === 'grace' && (
        <Field label={t('bd.re.days', 'Days of grace')}>
          <Input type="number" min="1" max="90" className="!w-28" value={v.graceDays} onChange={(e) => setV({ ...v, graceDays: e.target.value })} />
        </Field>
      )}
      <Button variant="primary" className="w-fit" disabled={busy || !dirty} onClick={save}>{busy ? <Spinner /> : t('common.save', 'Save')}</Button>
    </Panel>
  );
}

/** Plan, AI source, credits. */
function BillingView({ guildId, billing, reload }) {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const ai = billing.ai || {};
  const [src, setSrc] = useState(ai.source || 'platform');
  const [form, setForm] = useState({ baseUrl: '', key: '', model: ai.model || '', cap: String(ai.monthlyCap || 0) });
  const [busy, setBusy] = useState('');
  useEffect(() => { setSrc(ai.source || 'platform'); setForm((f) => ({ ...f, model: ai.model || '', cap: String(ai.monthlyCap || 0) })); }, [ai.source, ai.model, ai.monthlyCap]);
  const saveAi = async () => {
    setBusy('ai');
    try {
      const body = { source: src, monthlyCap: Math.max(0, Math.round(Number(form.cap) || 0)) };
      if (src === 'byok' && form.key.trim()) Object.assign(body, { key: form.key.trim(), baseUrl: form.baseUrl.trim(), model: form.model.trim() });
      await api.put(`/me/discord/guilds/${guildId}/ai`, body);
      setForm((f) => ({ ...f, key: '' }));
      toast.success(t('ds.saved', 'Saved.'));
      reload();
    } catch (x) {
      const e = x?.data?.error;
      toast.error(e === 'no_key' ? t('bd.byok.nokey', 'Add your key first.') : e === 'bad_key' ? t('bd.byok.badkey', 'That key does not look right.')
        : e && /url|private|https/i.test(e) ? t('bd.byok.badurl', 'The address must be a public https URL.') : t('common.failed', 'Failed.'));
    } finally { setBusy(''); }
  };
  const clearKey = async () => {
    const ok = await dialog.confirm({ title: t('bd.byok.clear.t', 'Remove your key?'), message: t('bd.byok.clear.m', 'The bot goes back to the platform’s AI.'), danger: true });
    if (!ok) return;
    setBusy('clear');
    try { await api.put(`/me/discord/guilds/${guildId}/ai`, { clearKey: true, source: 'platform' }); reload(); }
    catch { toast.error(t('common.failed', 'Failed.')); } finally { setBusy(''); }
  };
  const buy = async (pack) => {
    const ok = await dialog.confirm({
      title: t('bd.buy.t', 'Buy {n} credits?').replace('{n}', pack.credits.toLocaleString()),
      message: (pack.months ? t('bd.buy.m2', 'A one-time payment of {p}. The credits stay on this server for {m} months, spent oldest first. By continuing you accept the Terms and the Payments and Refunds policy.') : t('bd.buy.m3', 'A one-time payment of {p}. The credits stay on this server until used. By continuing you accept the Terms and the Payments and Refunds policy.')).replace('{p}', `$${(pack.priceCents / 100).toFixed(2)}`).replace('{m}', pack.months),
      okLabel: t('botplan.buy.ok', 'Continue to payment'),
    });
    if (!ok) return;
    setBusy(pack.id);
    try {
      const r = await api.post(`/me/discord/guilds/${guildId}/credits/checkout`, { packId: pack.id, acceptedTerms: true });
      // nosemgrep: js-open-redirect-from-function -- the URL is the Stripe Checkout URL our own API returned
      if (r?.url) window.location.href = r.url;
    } catch (x) {
      toast.error(x?.data?.error === 'stripe_not_configured' ? t('hosting.err.stripe', 'Payments not configured yet.') : t('hosting.err.checkout', 'Checkout failed.'));
    } finally { setBusy(''); }
  };
  const used = ai.used?.platform || 0;
  return (
    <div className={SP.page}>
      {/* The plan */}
      <Panel className="flex items-center gap-3 flex-wrap">
        <span className="grid place-items-center w-10 h-10 rounded-xl tint-primary text-[var(--accent-ink)] shrink-0"><Crown size={18} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-[var(--faint)]">{t('bd.plan', 'Plan')}</div>
          <div className="font-bold text-base">{tierName(t, billing.tier)}{billing.plans?.length ? <span className="text-[12px] font-normal text-[var(--muted)]"> · {billing.plans.filter(Boolean).join(', ')}</span> : null}</div>
        </div>
        <Link to={`/bot/pricing?guild=${guildId}`}><Button variant={billing.tier === 'free' ? 'primary' : 'ghost'}>{billing.tier === 'free' ? <><Crown size={14} /> {t('bd.upgrade', 'Upgrade')}</> : t('bd.compare', 'Compare plans')}</Button></Link>
      </Panel>

      {/* AI */}
      <div className={SP.stack}>
        <Head title={t('bd.ai.t', 'AI calls')} sub={t('bd.ai.t.s', 'Included each month, then paid with credits.')} />
        <div className={`grid grid-cols-1 sm:grid-cols-2 ${SP.grid}`}>
          <Stat icon={Gauge} label={t('bd.ai.month', 'This month')} value={`${used} / ${ai.included ?? 0}`} bar={ai.included ? used / ai.included : null} sub={ai.used?.byok ? t('bd.ai.byokused', '{n} with your own key').replace('{n}', ai.used.byok) : null} />
          <Stat icon={Coins} label={t('bd.credits', 'Credits')} value={(billing.credits?.balance ?? 0).toLocaleString()}
            sub={t('bd.ai.cost', '{p} credits per call past the allowance').replace('{p}', ai.cost?.platform ?? 10)} />
        </div>
        <Panel className={SP.stack}>
          <Eyebrow>{t('bd.ai.src', 'Where AI calls go')}</Eyebrow>
          <div className="grid sm:grid-cols-2 gap-2" role="radiogroup" aria-label={t('bd.ai.src', 'Where AI calls go')}>
            {[['platform', t('bd.src.platform', 'The platform’s AI'), t('bd.src.platform.s', 'Nothing to set up. Uses the monthly allowance.')],
              ['byok', t('bd.src.byok', 'Your own key'), ai.byokFree ? t('bd.src.byok.free', 'Your provider bills you. No fee on your plan.') : t('bd.src.byok.fee', 'Your provider bills you, plus {n} credits per call.').replace('{n}', ai.cost?.byokFee ?? 2)]].map(([k, label, sub]) => (
              <button key={k} type="button" role="radio" aria-checked={src === k} onClick={() => setSrc(k)}
                className={`text-start rounded-lg border p-2.5 transition ${src === k ? 'border-[var(--primary)] tint-primary' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`}>
                <div className="text-sm font-medium">{label}</div>
                <div className="text-[11.5px] text-[var(--muted)] mt-0.5">{sub}</div>
              </button>
            ))}
          </div>
          {src === 'byok' && (
            <div className={SP.tight}>
              {ai.hasKey && <div className="text-[12px] text-[var(--muted)] flex items-center gap-2 flex-wrap"><KeyRound size={12} /> {t('bd.byok.saved', 'Saved key ending {k}, sent to {h}').replace('{k}', ai.keyLast4 || '????').replace('{h}', ai.host || '?')}
                <button type="button" className="text-error hover:underline" disabled={!!busy} onClick={clearKey}>{t('bd.byok.clear', 'Remove')}</button></div>}
              <div className={`grid sm:grid-cols-3 ${SP.grid}`}>
                <Input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" aria-label={t('bd.byok.url', 'Provider address')} />
                <Input type="password" autoComplete="off" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder={ai.hasKey ? t('bd.byok.replace', 'New key (optional)') : t('bd.byok.key', 'API key')} aria-label={t('bd.byok.key', 'API key')} />
                <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder={t('bd.byok.model', 'Model (optional)')} aria-label={t('bd.byok.model', 'Model (optional)')} />
              </div>
              <Explain summary={t('bd.byok.sum', 'Any OpenAI-compatible provider. The key is sealed and never shown again.')}>
                <p>{t('bd.byok.more', 'The key is encrypted on the server, only its last four characters are shown, and it is used only for this server’s AI calls. Remove it any time.')}</p>
              </Explain>
            </div>
          )}
          <Field label={t('bd.cap', 'Monthly ceiling')} hint={t('bd.cap.h', '0 = no ceiling of your own.')}>
            <Input type="number" min="0" className="!w-32" value={form.cap} onChange={(e) => setForm({ ...form, cap: e.target.value })} />
          </Field>
          <Button variant="primary" className="w-fit" disabled={!!busy} onClick={saveAi}>{busy === 'ai' ? <Spinner /> : t('common.save', 'Save')}</Button>
        </Panel>
      </div>

      {/* Credits */}
      <div className={SP.stack}>
        <Head title={t('bd.credits.t', 'Add credits')} sub={t('bd.credits.s2', 'One-time packs, spent oldest first.')} />
        {billing.credits?.nextExpiry && (
          <p className="text-[12px] text-warning">{t('bd.credits.soon', '{n} credits expire on {d}.').replace('{n}', billing.credits.nextExpiry.credits.toLocaleString()).replace('{d}', new Date(billing.credits.nextExpiry.at).toLocaleDateString())}</p>
        )}
        <div className={`grid grid-cols-1 sm:grid-cols-3 ${SP.grid}`}>
          {(billing.packs || []).map((pk) => (
            <div key={pk.id} className="rounded-xl border border-[var(--line)] p-3 flex flex-col gap-2 min-w-0">
              <div className="text-lg font-bold tabular-nums">{pk.credits.toLocaleString()} <span className="text-[12px] font-normal text-[var(--muted)]">{t('bd.credits.u', 'credits')}</span></div>
              <div className="text-[11.5px] text-[var(--muted)]">{t('bd.credits.calls', 'About {n} AI calls').replace('{n}', Math.floor(pk.credits / (ai.cost?.platform || 10)).toLocaleString())}</div>
              <div className="text-[11.5px] text-[var(--muted)]">{pk.months ? t('bd.valid', 'Valid {n} months').replace('{n}', pk.months) : t('bd.valid.forever', 'No expiry')}</div>
              <Button variant="primary" className="mt-auto" disabled={!!busy} onClick={() => buy(pk)}>{busy === pk.id ? <Spinner /> : `$${(pk.priceCents / 100).toFixed(2)}`}</Button>
            </div>
          ))}
        </div>
        {billing.credits?.history?.length > 0 && (
          <Explain summary={t('bd.history', 'Credit history')}>
            <div className="rounded-xl border border-[var(--line)] divide-y divide-[var(--line)] mt-2">
              {billing.credits.history.map((h) => (
                <div key={h.id} className={`${SP.row} !py-1.5 flex items-center gap-2 text-xs`}>
                  <span className={`tabular-nums font-semibold w-16 ${h.delta > 0 ? 'text-success' : 'text-[var(--muted)]'}`}>{h.delta > 0 ? `+${h.delta}` : h.delta}</span>
                  <span className="flex-1 truncate text-[var(--muted)]">{({ purchase: t('bd.h.purchase', 'Purchase'), usage: t('bd.h.usage', 'AI call'), grant: t('bd.h.grant', 'Gift'), refund: t('bd.h.refund', 'Correction'), expire: t('bd.h.expire', 'Expired') })[h.reason] || h.reason}</span>
                  <span className="text-[10.5px] text-[var(--faint)]">{new Date(h.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </Explain>
        )}
      </div>
    </div>
  );
}

function GuildDashboard({ guildId, onSaved }) {
  const { t } = useI18n();
  const [sp, setSp] = useSearchParams();
  const view = sp.get('view') || 'overview';
  const mod = sp.get('module') || '';
  const [data, setData] = useState(null);
  const [billing, setBilling] = useState(null);
  const [pw, setPw] = useState(null); // { feature, limit }
  const MODULES = useModules();
  const load = useCallback(() => {
    api.get(`/me/discord/guilds/${guildId}`).then(setData).catch(() => setData({ error: true }));
    api.get(`/me/discord/guilds/${guildId}/billing`).then(setBilling).catch(() => setBilling(false));
  }, [guildId]);
  useEffect(() => { setData(null); setBilling(null); load(); }, [load]);
  const go = (v, m = '') => setSp((prev) => {
    const n = new URLSearchParams(prev);
    n.set('s', 'discord'); n.set('guild', guildId); n.set('view', v);
    if (m) n.set('module', m); else n.delete('module');
    return n;
  }, { replace: false });
  const paywall = (x) => setPw({ feature: x.feature || '', limit: x.error === 'plan_limit' ? `${x.limit}: ${x.max}` : '' });

  if (!data) return <div className="py-10 flex justify-center"><Spinner /></div>;
  if (data.error) return <EmptyState icon={MessageSquare} title={t('ds.gone', 'You can no longer manage this server')} sub={t('ds.gone.s', 'Your access may have changed on Discord.')} />;
  const g = data.guild;
  const ent = billing?.entitlements || data.entitlements;
  const ai = billing?.ai;
  const VIEWS = [
    ['overview', t('bd.v.overview', 'Overview'), Gauge],
    ['modules', t('bd.v.modules', 'Modules'), LayoutGrid],
    ['logs', t('ds.sec.logs', 'Logs'), ScrollText],
    ...(g.memberMode === 'pool' ? [['members', t('ds.sec.members', 'Members'), Users]] : []),
    ['billing', t('bd.v.plan', 'Plan'), Crown],
  ];
  const cur = view === 'module' ? 'modules' : view;
  const openModule = (m) => {
    if (m.feature && !has(ent, m.feature)) { setPw({ feature: m.feature }); return; }
    go('module', m.id);
  };
  const m = MODULES.find((x) => x.id === mod);

  return (
    <div className={SP.page}>
      {/* Header: who, what plan, one action. */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="grid place-items-center w-11 h-11 rounded-xl shrink-0 overflow-hidden border border-[var(--line)]" style={DISCORD_TILE}>
          {g.icon ? <img src={g.icon} alt="" className="w-full h-full object-cover" /> : <Server size={20} className="text-[var(--brand-discord)]" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-bold text-base leading-tight flex items-center gap-2 flex-wrap min-w-0">
            <span className="truncate" title={g.name || guildId}>{g.name || guildId}</span>
            {billing && <Badge tone={TIER_TONE[billing.tier] || 'blue'}>{tierName(t, billing.tier)}</Badge>}
            <Badge tone={g.role === 'owner' ? 'primary' : 'blue'}>{g.role === 'owner' ? t('ds.owner', 'Owner') : t('ds.manager', 'Manager')}</Badge>
          </div>
          <div className="text-xs text-[var(--muted)] mt-0.5">{(g.memberCount ?? 0).toLocaleString()} {t('ds.membersshort', 'members')}</div>
        </div>
        {billing?.tier === 'free' && <Link to={`/bot/pricing?guild=${guildId}`}><Button variant="primary" size="sm"><Crown size={13} /> {t('bd.upgrade', 'Upgrade')}</Button></Link>}
      </div>

      {/* Views */}
      <nav className="flex gap-1 overflow-x-auto no-scrollbar p-1 rounded-xl border border-[var(--line)] panel" aria-label={t('bd.views', 'Server sections')}>
        {VIEWS.map(([id, label, Icon]) => (
          <button key={id} type="button" onClick={() => go(id)} aria-current={cur === id ? 'page' : undefined}
            className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition ${cur === id ? 'bg-[var(--bg-solid)] text-[var(--text)] font-medium shadow-sm border border-[var(--line)]' : 'text-[var(--muted)] hover:text-[var(--text)] border border-transparent'}`}>
            <Icon size={14} className={cur === id ? 'text-[var(--accent-ink)]' : ''} /> {label}
          </button>
        ))}
      </nav>

      {view === 'overview' && (
        <div className={SP.page}>
          <div className={`grid grid-cols-1 sm:grid-cols-3 ${SP.grid}`}>
            <Stat icon={Users} label={t('ds.sec.members', 'Members')} value={(g.memberCount ?? 0).toLocaleString()} />
            <Stat icon={Wand2} label={t('bd.ai.left', 'AI calls left this month')} value={ai ? `${ai.left} / ${ai.included}` : '…'} bar={ai?.included ? (ai.used?.platform || 0) / ai.included : null} />
            <Stat icon={Coins} label={t('bd.credits', 'Credits')} value={billing ? (billing.credits?.balance ?? 0).toLocaleString() : '…'} />
          </div>
          <div className={SP.stack}>
            <Head title={t('bd.v.modules', 'Modules')} right={<Button size="sm" variant="ghost" onClick={() => go('modules')}>{t('bd.all', 'All modules')}</Button>} />
            <div className={`grid grid-cols-1 sm:grid-cols-2 ${SP.grid}`}>
              {MODULES.slice(0, 4).map((x) => <ModuleCard key={x.id} m={x} data={data} ent={ent} onOpen={openModule} />)}
            </div>
          </div>
        </div>
      )}

      {view === 'modules' && (
        <div className={`grid grid-cols-1 sm:grid-cols-2 ${SP.grid}`}>
          {MODULES.map((x) => <ModuleCard key={x.id} m={x} data={data} ent={ent} onOpen={openModule} />)}
        </div>
      )}

      {view === 'module' && m && (
        <div className={SP.page}>
          <Button variant="ghost" size="sm" className="w-fit" onClick={() => go('modules')}><ArrowLeft size={14} /> {t('bd.v.modules', 'Modules')}</Button>
          {m.pro && !has(ent, m.pro) && m.id !== 'ai' && (
            <div className="rounded-xl border border-[var(--line)] tint-primary p-3 flex items-center gap-3 flex-wrap">
              <Crown size={16} className="text-[var(--accent-ink)] shrink-0" />
              <div className="min-w-0 flex-1 text-[13px]"><span className="font-medium">{botFeatureLabel(t, m.pro)}</span> <span className="text-[var(--muted)]">{t('bd.pro.need', 'needs a paid plan.')}</span></div>
              <Button size="sm" onClick={() => setPw({ feature: m.pro })}>{t('bd.unlock', 'Unlock')}</Button>
            </div>
          )}
          {m.id === 'roles' && billing && <RoleEndPolicy guildId={guildId} value={billing.purchasedRoles} onSaved={load} />}
          {m.id === 'ai'
            ? <AiModule billing={billing} ent={ent} go={go} paywall={(x) => setPw(x)} />
            : <GuildConfig guildId={guildId} section={m.id} embedded onSaved={() => { load(); onSaved?.(); }} onPaywall={paywall} />}
        </div>
      )}
      {view === 'module' && !m && <EmptyState icon={LayoutGrid} title={t('bd.nomodule', 'Pick a module')} action={<Button onClick={() => go('modules')}>{t('bd.v.modules', 'Modules')}</Button>} />}

      {view === 'logs' && <GuildConfig guildId={guildId} section="logs" embedded onSaved={load} onPaywall={paywall} />}
      {view === 'members' && <GuildConfig guildId={guildId} section="members" embedded onSaved={load} onPaywall={paywall} />}
      {view === 'billing' && (billing ? <BillingView guildId={guildId} billing={billing} reload={load} />
        : billing === false ? <EmptyState icon={Crown} title={t('common.failed', 'Failed.')} /> : <div className="py-10 flex justify-center"><Spinner /></div>)}

      <PaywallModal open={!!pw} onClose={() => setPw(null)} feature={pw?.feature} limit={pw?.limit} guildId={guildId} />
    </div>
  );
}

export function MyDiscordServers() {
  const { t } = useI18n();
  const [sp, setSp] = useSearchParams();
  const [state, setState] = useState(null); // { linked, guilds, appId }
  const load = () => api.get('/me/discord/guilds').then(setState).catch(() => setState({ linked: false, guilds: [] }));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const wanted = sp.get('guild');
  if (!state) return <div className="py-10 flex justify-center"><Spinner /></div>;
  // The bot's OAuth2 invite URL: a curated permission set (manage roles/channels, kick/ban/
  // timeout, move members, send/embed/history/view), never Administrator.
  const inviteUrl = state.appId ? `https://discord.com/oauth2/authorize?client_id=${state.appId}&permissions=1099796925462&scope=bot%20applications.commands` : null;
  const Invite = ({ small }) => (inviteUrl ? (
    <a href={safeHref(inviteUrl)} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1.5 rounded-lg font-medium text-white bg-[var(--brand-discord)] hover:opacity-90 transition ${small ? 'px-3 py-1.5 text-sm' : 'px-3.5 py-2 text-sm'}`}>
      <DiscordIcon size={15} className="text-white" /> {t('ds.invite', 'Invite the bot')}
    </a>) : null);
  if (!state.linked) {
    return (
      <div className="max-w-md mx-auto text-center py-8">
        <span className="grid place-items-center w-14 h-14 rounded-2xl mx-auto mb-3" style={DISCORD_TILE}><DiscordIcon size={26} className="text-[var(--brand-discord)]" /></span>
        <h2 className="font-semibold text-lg">{t('ds.nolink', 'Link your Discord account')}</h2>
        <p className="text-sm text-[var(--muted)] mt-1 mb-4">{t('bd.nolink', 'Run /link in any server with the bot, then paste the code here.')}</p>
        <DiscordLinkInline onLinked={load} />
        <div className="mt-4 pt-4 border-t border-[var(--line)] flex items-center justify-center gap-2 flex-wrap">
          <Link to="/bot/features" className="text-sm text-[var(--accent-ink)] hover:underline">{t('bd.discover', 'What the bot does')}</Link>
          <Invite small />
        </div>
      </div>
    );
  }
  if (!state.guilds.length) {
    return (
      <EmptyState icon={Bot} title={t('ds.noguilds', 'No servers to manage yet')} sub={t('bd.noguilds', 'Add the bot to a server you own or manage.')}>
        <div className="flex items-center justify-center gap-3 flex-wrap"><Invite /><Link to="/bot/features" className="text-sm text-[var(--accent-ink)] hover:underline">{t('bd.discover', 'What the bot does')}</Link></div>
      </EmptyState>
    );
  }
  const sel = state.guilds.some((g) => g.guildId === wanted) ? wanted : state.guilds[0].guildId;
  const pick = (id) => setSp((prev) => { const n = new URLSearchParams(prev); n.set('s', 'discord'); n.set('guild', id); n.delete('view'); n.delete('module'); return n; });
  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Bot size={16} className="text-[var(--accent-ink)]" /><h2 className="font-semibold">{t('ds.title', 'My Discord servers')}</h2>
        <span className="ms-auto flex items-center gap-2 flex-wrap">
          <Link to="/bot/pricing" className="text-sm text-[var(--accent-ink)] hover:underline">{t('bd.pricing', 'Plans and pricing')}</Link>
          <Invite small />
        </span>
      </div>
      <div className="grid xl:grid-cols-[minmax(0,220px)_minmax(0,1fr)] gap-4">
        {/* The server rail: a column on a wide screen, a scrolling row below (the dashboard's own
            sidebar already takes a column there). */}
        <div className="flex xl:flex-col gap-1.5 overflow-x-auto xl:overflow-visible pb-1 xl:pb-0 no-scrollbar" role="tablist" aria-label={t('ds.title', 'My Discord servers')}>
          {state.guilds.map((g) => (
            <button key={g.guildId} type="button" role="tab" aria-selected={sel === g.guildId} onClick={() => pick(g.guildId)}
              className={`text-start rounded-xl border px-2.5 py-2 shrink-0 xl:shrink w-52 xl:w-auto transition flex items-center gap-2.5 min-w-0 ${sel === g.guildId ? 'border-[var(--primary)] tint-primary' : 'border-[var(--line)] hover:b-primary'}`}>
              {g.icon ? <img src={g.icon} alt="" className="w-8 h-8 rounded-lg shrink-0 object-cover" /> : <span className="grid place-items-center w-8 h-8 rounded-lg shrink-0" style={DISCORD_TILE}><Server size={14} className="text-[var(--brand-discord)]" /></span>}
              <span className="min-w-0">
                <span className="block text-sm font-medium truncate" title={g.name || g.guildId}>{g.name || g.guildId}</span>
                <span className="block text-[11px] text-[var(--faint)]">{(g.memberCount ?? 0).toLocaleString()} {t('ds.membersshort', 'members')}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="card p-4 min-w-0">
          <GuildDashboard key={sel} guildId={sel} onSaved={load} />
        </div>
      </div>
    </div>
  );
}
