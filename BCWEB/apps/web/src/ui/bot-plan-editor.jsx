// Discord bot plans in the admin plan editor (Admin → Hosting plans).
//
// Two pieces, both small on purpose so admin.jsx only has to place them:
//
//   BotPlanFields   inside the plan editor: what KIND of plan this is (storage, or bot only)
//                   and the bot entitlements it grants. Ticking any on a storage plan makes it
//                   a bundle ("hosting + bot"). Nothing ticked = the plan grants nothing on
//                   the bot, which is every plan that existed before this.
//   BotFreeTier     under the plan list: what a server gets WITHOUT a plan, and the platform's
//                   own servers that are never limited. The free tier is what decides which
//                   features are paid at all: a feature is paid exactly when it is not ticked
//                   here. Its default is everything, so nothing changes until this is saved.
//
// The rules themselves are the API's (apps/api/src/lib/bot-entitlements.mjs); this only edits
// the data they read, and the API cleans every value again before storing it.
import { useEffect, useState } from 'react';
import { Bot, Check, Save } from 'lucide-react';
import { Button, Card, Input, Spinner, useToast } from './ui.jsx';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { BOT_FEATURE_KEYS, BOT_LIMIT_KEYS, botFeatureLabel, botLimitName } from './bot-plan-labels.js';

const LIMIT_CAPS = { joinToCreateLobbies: 20, gatingRules: 30, rolePanels: 20, blogRoutes: 20, automodWords: 500 };

/** A plan's `bot` as the editor holds it: always an object with all three parts. */
export function draftBot(bot) {
  const b = bot && typeof bot === 'object' ? bot : {};
  return { guilds: b.guilds || 1, features: Array.isArray(b.features) ? b.features : [], limits: { ...(b.limits || {}) } };
}
/** Does this plan grant anything on the bot? */
export const grantsBot = (bot) => !!bot && ((bot.features || []).length > 0 || Object.values(bot.limits || {}).some((n) => Number(n) > 0));

/** The body fields for POST/PATCH /admin/hosting/plans. */
export function botPlanBody(draft) {
  const b = draftBot(draft.bot);
  const limits = Object.fromEntries(BOT_LIMIT_KEYS.map((k) => [k, Math.max(0, Math.round(Number(b.limits[k]) || 0))]));
  return { kind: draft.kind === 'bot' ? 'bot' : 'hosting', bot: grantsBot({ ...b, limits }) ? { guilds: Math.max(1, Number(b.guilds) || 1), features: b.features, limits } : {} };
}

/** One line for the plan list: what the plan does on Discord, or null. */
export function botPlanSummary(pl, t) {
  if (!grantsBot(pl.bot)) return null;
  const n = (pl.bot.features || []).length;
  return t('adm.botplan.row', 'Discord bot: {f} feature(s), {g} server(s)').replace('{f}', n).replace('{g}', pl.bot.guilds || 1);
}

function Checkbox({ on, onChange, children }) {
  return (
    <label className="flex items-start gap-2 text-[13px] cursor-pointer min-w-0">
      <input type="checkbox" className="mt-0.5" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">{children}</span>
    </label>
  );
}

export function BotPlanFields({ draft, setDraft }) {
  const { t } = useI18n();
  const b = draftBot(draft.bot);
  const setBot = (patch) => setDraft({ ...draft, bot: { ...b, ...patch } });
  const kind = draft.kind === 'bot' ? 'bot' : 'hosting';
  const setKind = (k) => setDraft({
    ...draft, kind: k,
    // A bot-only plan has no storage and no upload cap; a new one starts switched off so it
    // is never on sale before its price has been decided.
    ...(k === 'bot' ? { storageGB: 0, uploadLimitKbps: 0, ...(draft.id ? {} : { active: false }) } : {}),
  });
  return (
    <div className="rounded-xl border border-[var(--line)] panel p-3 space-y-3">
      <div className="text-sm font-medium flex items-center gap-2"><Bot size={14} className="text-[var(--accent-ink)]" /> {t('adm.botplan.t', 'Discord bot')}</div>
      <div className="grid sm:grid-cols-2 gap-2" role="group" aria-label={t('adm.botplan.kind', 'Kind of plan')}>
        {[['hosting', t('adm.botplan.kind.h', 'Storage plan'), t('adm.botplan.kind.h.s', 'A storage pool. Tick bot features below to make it a bundle (hosting and bot).')],
          ['bot', t('adm.botplan.kind.b', 'Bot only'), t('adm.botplan.kind.b.s', 'No storage: a monthly subscription that unlocks bot features on the servers the buyer picks.')]].map(([k, label, sub]) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}
            className={`text-start rounded-lg border p-2.5 transition ${kind === k ? 'border-[var(--primary)] tint-primary' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`}>
            <div className="text-xs font-semibold flex items-center gap-1.5">{kind === k ? <Check size={12} className="text-[var(--accent-ink)]" /> : <span className="w-3" />}{label}</div>
            <div className="text-[11px] text-[var(--muted)] mt-0.5">{sub}</div>
          </button>
        ))}
      </div>
      <div>
        <div className="text-xs font-semibold text-[var(--muted)] mb-1.5">{t('adm.botplan.features', 'Features it unlocks')}</div>
        <div className="grid sm:grid-cols-2 gap-1.5">
          {BOT_FEATURE_KEYS.map((f) => (
            <Checkbox key={f} on={b.features.includes(f)} onChange={(on) => setBot({ features: on ? [...b.features, f] : b.features.filter((x) => x !== f) })}>
              {botFeatureLabel(t, f)}
            </Checkbox>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <label className="text-[11px] text-[var(--muted)] flex flex-col gap-1 min-w-0">
          {t('adm.botplan.guilds', 'Servers covered')}
          <Input type="number" min="1" max="25" value={b.guilds} onChange={(e) => setBot({ guilds: e.target.value })} />
        </label>
        {BOT_LIMIT_KEYS.map((k) => (
          <label key={k} className="text-[11px] text-[var(--muted)] flex flex-col gap-1 min-w-0">
            <span className="truncate" title={botLimitName(t, k)}>{botLimitName(t, k)}</span>
            <Input type="number" min="0" max={LIMIT_CAPS[k]} value={b.limits[k] ?? ''} placeholder="0" onChange={(e) => setBot({ limits: { ...b.limits, [k]: e.target.value } })} />
          </label>
        ))}
      </div>
      <p className="text-[11px] text-[var(--muted)]">
        {t('adm.botplan.hint', 'A limit left at 0 does not raise the free tier. A server gets the larger of its free tier and every plan pointed at it. Prices for bot plans are never derived from the storage rates: set one.')}
      </p>
    </div>
  );
}

export function BotFreeTier() {
  const { t } = useI18n(); const toast = useToast();
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [ids, setIds] = useState('');
  useEffect(() => {
    api.get('/admin/hosting/bot-entitlements').then((r) => { setSt(r); setIds((r.unlimitedGuildIds || []).join('\n')); }).catch(() => setSt(false));
  }, []);
  if (st === null) return <Card className="p-4 grid place-items-center"><Spinner /></Card>;
  if (st === false) return null;
  const free = st.free;
  const set = (patch) => setSt({ ...st, free: { ...free, ...patch } });
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.put('/admin/hosting/bot-entitlements', {
        free: { features: free.features, limits: Object.fromEntries(BOT_LIMIT_KEYS.map((k) => [k, Math.max(0, Math.round(Number(free.limits[k]) || 0))])) },
        unlimitedGuildIds: ids.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean),
      });
      setSt({ ...st, ...r, saved: true }); setIds((r.unlimitedGuildIds || []).join('\n'));
      toast.success(t('adm.botfree.saved', 'Free tier saved. The bot picks it up on its next config poll.'));
    } catch { toast.error(t('common.failed', 'Failed.')); } finally { setBusy(false); }
  };
  return (
    <Card className="p-4 space-y-3">
      <div>
        <div className="font-semibold text-sm flex items-center gap-2"><Bot size={14} className="text-[var(--accent-ink)]" /> {t('adm.botfree.t', 'Discord bot: what every server gets without a plan')}</div>
        <p className="text-xs text-[var(--muted)] mt-1">
          {t('adm.botfree.s', 'A feature not ticked here is a paid one: only a server with a plan that includes it can turn it on, and the bot is served it switched off everywhere else. Until this is saved, every server gets everything, as before bot plans existed.')}
        </p>
        {!st.saved && <p className="text-xs text-warning mt-1">{t('adm.botfree.default', 'Not saved yet: every feature is free right now, so no bot plan sells anything.')}</p>}
      </div>
      <div className="grid sm:grid-cols-2 gap-1.5">
        {BOT_FEATURE_KEYS.map((f) => (
          <Checkbox key={f} on={free.features.includes(f)} onChange={(on) => set({ features: on ? [...free.features, f] : free.features.filter((x) => x !== f) })}>
            {botFeatureLabel(t, f)}
          </Checkbox>
        ))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {BOT_LIMIT_KEYS.map((k) => (
          <label key={k} className="text-[11px] text-[var(--muted)] flex flex-col gap-1 min-w-0">
            <span className="truncate" title={botLimitName(t, k)}>{botLimitName(t, k)}</span>
            <Input type="number" min="0" max={LIMIT_CAPS[k]} value={free.limits[k] ?? 0} onChange={(e) => set({ limits: { ...free.limits, [k]: e.target.value } })} />
          </label>
        ))}
      </div>
      <label className="text-[11px] text-[var(--muted)] flex flex-col gap-1">
        {t('adm.botfree.unlimited', 'Servers never limited (the platform\'s own), one id per line')}
        <textarea rows={3} value={ids} onChange={(e) => setIds(e.target.value)}
          className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-[13px] font-mono text-[var(--text)]" />
      </label>
      <Button size="sm" variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : <Save size={14} />} {t('common.save', 'Save')}</Button>
    </Card>
  );
}
