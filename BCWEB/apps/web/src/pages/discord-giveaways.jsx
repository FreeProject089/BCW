// Admin: create and manage the staff giveaways the bot posts (Admin → Discord bot → Community).
//
// Out of admin.jsx on purpose: the same card, plus the prize kind the API gained in d0875b29,
// `economy` (points in the configured currency and/or XP, paid through the staff-grant ledger
// once per winner). The host passes the currency name, so the preview says "500 coins" and not
// "500 points" on an economy that calls them coins, and optionally its own winner-DM editor
// (`renderWinnerMessage`), which lives in admin.jsx with its variable palette.
//
// The rest of the card is the one it replaces: what is running first, then the presets, then
// the four fields a giveaway always needs, then one fold for everything optional.
import { useState } from 'react';
import { Gift, ChevronDown, Lock, Trash2, Plus, Coins } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { api } from '../lib/api.js';
import { Button, Card, Badge, Input, Textarea, Dropdown, Field, Spinner, useDialog, useToast } from '../ui/ui.jsx';
import { useAsync, Loading, useUndoableDelete } from './pages.jsx';
import { rewardText, normReward } from '../lib/giveaway-prize.js';

/** An optional block that collapses to a single hairline row, saying what it holds when shut. */
function Fold({ title, summary, children, defaultOpen = false }) {
  const [on, setOn] = useState(defaultOpen);
  return (
    <div className="border-t border-[var(--line)]">
      <button type="button" onClick={() => setOn((v) => !v)} className="w-full flex items-center gap-2 py-2.5 text-start group" aria-expanded={on}>
        <ChevronDown size={14} className={`shrink-0 text-[var(--faint)] transition-transform ${on ? 'rotate-180' : ''}`} />
        <span className="text-[12.5px] font-medium group-hover:text-[var(--text)] transition-colors shrink-0">{title}</span>
        {/* The summary wraps rather than ellipsising: it is the only thing saying what is inside. */}
        {!on && summary ? <span className="ms-auto text-[11px] text-[var(--faint)] text-end min-w-0 break-words">{summary}</span> : null}
      </button>
      {on && <div className="pb-3">{children}</div>}
    </div>
  );
}

/** A titled region inside a panel. A label and a rule, not another card. */
function PanelSection({ title, children }) {
  return (
    <div className="border-t border-[var(--line)] mt-3 pt-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-2">{title}</div>
      {children}
    </div>
  );
}

// The prizes a giveaway actually runs, as one click each. A preset fills the same state the
// fields do; the fields stay editable underneath.
const GW_PRIZES = [
  { id: 'discount20', label: '20% off', prize: '20% off hosting', prizeKind: 'promo', gift: { kind: 'discount', percentOff: 20, freeMonths: 0 } },
  { id: 'discount50', label: '50% off', prize: '50% off hosting', prizeKind: 'promo', gift: { kind: 'discount', percentOff: 50, freeMonths: 0 } },
  { id: 'month1', label: '1 month free', prize: '1 month of hosting', prizeKind: 'promo', gift: { kind: 'discount', percentOff: 0, freeMonths: 1 } },
  { id: 'month3', label: '3 months free', prize: '3 months of hosting', prizeKind: 'promo', gift: { kind: 'discount', percentOff: 0, freeMonths: 3 } },
  { id: 'hosting10', label: 'A free repo (10 GB)', prize: 'A hosted Server-Repo, 10 GB', prizeKind: 'promo', gift: { kind: 'free_hosting', storageGB: 10 } },
  { id: 'pool50', label: 'A 50 GB pool', prize: 'A 50 GB storage pool', prizeKind: 'promo', gift: { kind: 'free_pool', storageGB: 50 } },
  { id: 'boost7', label: 'A 7-day boost', prize: '7 days of boost', prizeKind: 'promo', gift: { kind: 'free_boost', boostDays: 7 } },
  { id: 'economy', label: 'Points / XP', prizeKind: 'economy' },
  { id: 'custom', label: 'Something I type in', prizeKind: 'custom' },
  { id: 'none', label: 'Bragging rights', prize: 'Bragging rights', prizeKind: 'none' },
];
const GW_DURATIONS = [
  [60, '1 hour'], [360, '6 hours'], [720, '12 hours'], [1440, '1 day'],
  [4320, '3 days'], [10080, '1 week'], [20160, '2 weeks'], [43200, '30 days'],
];
// What the bot DMs a winner. No unicode emoji: the bot draws none (house rule), so the default
// it ships must not carry one either.
const DEFAULT_WINNER_MSG = 'Congrats {user}, you won {prize}! Thanks for entering.';

/**
 * `currencyName` is economy.currencyName from the bot config (what one point is called).
 * `renderWinnerMessage(props)` (optional) renders the winner-DM editor; props are
 * { label, hint, value, onChange, placeholder, giftCode }. Without it, a plain text box.
 */
export function BotGiveawaysCard({ currencyName = 'points', renderWinnerMessage }) {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const [open, setOpen] = useState(false);
  const { data, loading, reload } = useAsync(() => api.get('/admin/bot/giveaways'), []);
  const [f, setF] = useState({ prize: '', channelId: '', durationMinutes: 60, winnersCount: 1, reqLinked: false, reqCreator: false, audience: 'discord', prizeKind: 'promo', prizeContent: '', winnerMessage: DEFAULT_WINNER_MSG, gift: { kind: 'discount', percentOff: 20, freeMonths: 0, storageGB: 10, boostDays: 7 }, reward: { points: 500, xp: 0 } });
  const [busy, setBusy] = useState(false);
  const undo = useUndoableDelete(reload);
  const giveaways = (data?.giveaways || []).filter((g) => !undo.pending.has(g.id));
  const currency = String(currencyName || '').trim() || 'points';
  const reward = f.prizeKind === 'economy' ? normReward(f.reward) : null;
  const rewardLine = reward ? rewardText(reward, currency) : '';

  const prizeSummary = [
    f.prizeKind === 'promo' ? t('gw.pk.promo2', 'promo code') : f.prizeKind === 'custom' ? t('gw.pk.custom2', 'custom content') : f.prizeKind === 'economy' ? (rewardLine || t('gw.pk.economy2', 'points / XP')) : t('gw.pk.none2', 'no prize'),
    f.reqCreator ? t('gw.badge.creator', 'creator id') : f.reqLinked ? t('gw.badge.linked', 'linked') : null,
  ].filter(Boolean).join(' · ');
  const applyPrize = (p) => setF((cur) => ({
    ...cur,
    prizeKind: p.prizeKind,
    // A preset fills the name only when it is empty or still another preset's text. An economy
    // prize names itself ("500 coins") when the name is left empty, so it clears a preset's.
    prize: p.prize && (!cur.prize.trim() || GW_PRIZES.some((x) => x.prize === cur.prize)) ? p.prize
      : p.prizeKind === 'economy' && GW_PRIZES.some((x) => x.prize === cur.prize) ? '' : cur.prize,
    gift: p.gift ? { ...cur.gift, ...p.gift } : cur.gift,
  }));

  const winnerGets = (() => {
    if (f.prizeKind === 'none') return t('gw.gets.none', 'nothing to claim, the title only');
    if (f.prizeKind === 'economy') return rewardLine
      ? t('gw.gets.economy', '{x}, paid straight into their balance (an unlinked winner gets it when they link)').replace('{x}', rewardLine)
      : t('gw.gets.economy.empty', 'nothing yet: set some {c} or some XP below').replace('{c}', currency);
    if (f.prizeKind === 'custom') return f.prizeContent.trim()
      ? t('gw.gets.custom', 'the text you typed, sealed until they reveal it')
      : t('gw.gets.custom.empty', 'custom content, but you have not typed any yet');
    const g = f.gift;
    if (g.kind === 'discount') {
      const bits = [Number(g.percentOff) ? `${Number(g.percentOff)}%` : null, Number(g.freeMonths) ? t('gw.gets.months', '{n} month(s) free').replace('{n}', Number(g.freeMonths)) : null].filter(Boolean);
      return bits.length ? t('gw.gets.promo', 'a promo code: {x}').replace('{x}', bits.join(' + ')) : t('gw.gets.empty', 'a promo code worth nothing yet, set a discount below');
    }
    if (g.kind === 'free_hosting') return t('gw.gets.hosting', 'a free hosted repo, {n} GB').replace('{n}', Number(g.storageGB) || 0);
    if (g.kind === 'free_pool') return t('gw.gets.pool', 'a free storage pool, {n} GB').replace('{n}', Number(g.storageGB) || 0);
    if (g.kind === 'free_boost') return t('gw.gets.boost', '{n} day(s) of boost').replace('{n}', Number(g.boostDays) || 0);
    return t('gw.gets.promo.plain', 'a promo code');
  })();

  const ERR = {
    reward_required: t('gw.err.reward', 'Set some points or some XP: a Points / XP prize of nothing pays nobody.'),
    channel_required: t('gw.err.channel', 'A Discord giveaway needs the channel it is posted in.'),
    prize_content_required: t('gw.needcontent', 'Custom prizes need the content to reveal to the winner.'),
  };
  const create = async () => {
    const needChannel = f.audience !== 'site';
    if ((!f.prize.trim() && f.prizeKind !== 'economy') || (needChannel && !f.channelId.trim())) return toast.error(f.prizeKind === 'economy' ? ERR.channel_required : t('gw.needfields', 'Prize and channel id are required.'));
    if (f.prizeKind === 'custom' && !f.prizeContent.trim()) return toast.error(ERR.prize_content_required);
    if (f.prizeKind === 'economy' && !reward) return toast.error(ERR.reward_required);
    setBusy(true);
    try {
      const body = { durationMinutes: Number(f.durationMinutes) || 60, winnersCount: Number(f.winnersCount) || 1, audience: f.audience, prizeKind: f.prizeKind };
      if (f.prize.trim()) body.prize = f.prize.trim();
      if (needChannel) body.channelId = f.channelId.trim();
      if (f.prizeKind === 'custom') body.prizeContent = f.prizeContent.trim();
      if (f.prizeKind === 'economy') body.reward = reward;
      if (f.winnerMessage.trim()) body.winnerMessage = f.winnerMessage.trim();
      if (f.reqLinked || f.reqCreator) body.requirements = { linked: !!(f.reqLinked || f.reqCreator), creator: !!f.reqCreator };
      if (f.prizeKind === 'promo') {
        const g = { kind: f.gift.kind };
        if (f.gift.kind === 'discount') { if (Number(f.gift.percentOff)) g.percentOff = Number(f.gift.percentOff); if (Number(f.gift.freeMonths)) g.freeMonths = Number(f.gift.freeMonths); }
        if (f.gift.kind === 'free_hosting' || f.gift.kind === 'free_pool') g.storageGB = Number(f.gift.storageGB);
        if (f.gift.kind === 'free_boost') g.boostDays = Number(f.gift.boostDays);
        body.gift = g;
      }
      await api.post('/admin/bot/giveaways', body);
      toast.success(t('gw.created', 'Giveaway created, the bot posts it within ~30s.')); setF({ ...f, prize: '' }); reload();
    } catch (x) { toast.error(ERR[x?.data?.error] || t('common.failed', 'Failed.')); } finally { setBusy(false); }
  };
  const end = async (g) => { if (!(await dialog.confirm({ title: t('gw.end.t', 'Draw now?'), message: t('gw.end.m', 'End this giveaway now and draw the winners?'), okLabel: t('gw.end.ok', 'Draw now') }))) return; try { await api.post(`/admin/bot/giveaways/${g.id}/end`); toast.success(t('gw.ending', 'Drawing, winners announced within ~30s.')); reload(); } catch { toast.error(t('common.failed', 'Failed.')); } };
  const del = (g) => undo.del(g.id, () => api.del(`/admin/bot/giveaways/${g.id}`), t('common.deleted', 'Deleted.'));
  const setReward = (k, raw) => setF((cur) => ({ ...cur, reward: { ...cur.reward, [k]: raw === '' ? '' : Math.max(0, Math.floor(Number(raw)) || 0) } }));

  const winnerMsgProps = {
    label: t('gw.winnermsg', 'Winner DM message'), hint: t('gw.winnermsg.h', 'DMed to each winner when the giveaway ends.'),
    value: f.winnerMessage, onChange: (v) => setF({ ...f, winnerMessage: v }),
    placeholder: t('gw.winnermsg.ph2', 'Congrats {user}, you won {prize}!'), giftCode: f.prizeKind === 'promo' ? '' : undefined,
  };

  return (
    <Card className="p-4 mb-4">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between gap-2 text-start" aria-expanded={open}>
        <span className="font-medium text-sm flex items-center gap-2"><Gift size={14} className="text-[var(--accent-ink)]" /> {t('gw.title', 'Giveaways')}{giveaways.some((g) => g.status === 'active') && <Badge tone="green">{giveaways.filter((g) => g.status === 'active').length}</Badge>}</span>
        <ChevronDown size={16} className={`text-[var(--faint)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-3">
          <p className="text-[11px] text-[var(--faint)]">{t('gw.note2', 'Members can also start their own with /giveaway (Discord-only, max 5 per server). Staff giveaways here can run on Discord, on the site, and hand the winner a prize into their BCWEB inventory.')}</p>

          <PanelSection title={t('gw.sec.running', 'Running')}>
            {loading ? <Loading /> : giveaways.length ? <div className="space-y-2">
              {giveaways.map((g) => {
                const rl = g.reward ? (g.rewardLabel || rewardText(g.reward, currency)) : '';
                return (
                  <div key={g.id} className="flex items-center gap-3 text-sm rounded-lg bg-[var(--surface-2)] px-3 py-2.5">
                    <Gift size={14} className={g.status === 'active' ? 'text-success shrink-0' : 'text-[var(--faint)] shrink-0'} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium break-words">{g.prize} {g.hasGift && g.prizeKind !== 'economy' && <Badge tone="primary"><Gift size={9} /> {t('gw.gift', 'gift')}</Badge>} {g.requirements?.creator ? <Badge tone="amber"><Lock size={9} /> {t('gw.badge.creator', 'creator id')}</Badge> : g.requirements?.linked ? <Badge tone="amber"><Lock size={9} /> {t('gw.badge.linked', 'linked')}</Badge> : null}</div>
                      {rl && rl !== g.prize && <div className="text-[11px] text-[var(--muted)] inline-flex items-center gap-1"><Coins size={11} className="shrink-0" /> {t('gw.pays', 'pays {x} to each winner').replace('{x}', rl)}</div>}
                      <div className="text-[11px] text-[var(--faint)]">{g.status === 'active' ? t('gw.endsat', 'ends {d}').replace('{d}', new Date(g.endsAt).toLocaleString()) : t('gw.ended', 'ended · {n} winner(s)').replace('{n}', g.winnerIds?.length || 0)} · {t('gw.entries', '{n} entries').replace('{n}', g.entryCount)}</div>
                    </div>
                    {g.status === 'active' && <Button size="sm" variant="ghost" onClick={() => end(g)}>{t('gw.drawbtn', 'Draw now')}</Button>}
                    <Button size="sm" variant="ghost" className="!text-error" onClick={() => del(g)} title={t('common.delete', 'Delete')}><Trash2 size={13} /></Button>
                  </div>
                );
              })}
            </div> : <div className="text-xs text-[var(--faint)]">{t('gw.none', 'No giveaways yet.')}</div>}
          </PanelSection>

          <PanelSection title={t('gw.sec.new', 'New giveaway')}>
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] me-1">{t('gw.presets', 'Prize')}</span>
              {GW_PRIZES.map((p) => {
                const on = f.prizeKind === p.prizeKind
                  && (!p.gift || (f.gift.kind === p.gift.kind
                    && (p.gift.percentOff === undefined || Number(f.gift.percentOff) === p.gift.percentOff)
                    && (p.gift.freeMonths === undefined || Number(f.gift.freeMonths) === p.gift.freeMonths)
                    && (p.gift.storageGB === undefined || Number(f.gift.storageGB) === p.gift.storageGB)
                    && (p.gift.boostDays === undefined || Number(f.gift.boostDays) === p.gift.boostDays)));
                return (
                  <button key={p.id} type="button" onClick={() => applyPrize(p)} aria-pressed={on}
                    className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${on ? 'border-[var(--primary)] tint-primary text-[var(--text)]' : 'border-[var(--line)] text-[var(--muted)] hover:border-[var(--line-strong)]'}`}>
                    {t(`gw.p.${p.id}`, p.label)}
                  </button>
                );
              })}
            </div>

            {/* The amounts ARE the prize for this kind, so they sit here and not in the fold. */}
            {f.prizeKind === 'economy' && (
              <div className="grid sm:grid-cols-2 gap-3 mb-3">
                <Field label={t('gw.reward.points', 'Points ({c})').replace('{c}', currency)}>
                  <Input type="number" min="0" max="1000000" value={f.reward.points} onChange={(e) => setReward('points', e.target.value)} />
                </Field>
                <Field label={t('gw.reward.xp', 'XP')} hint={t('gw.reward.xp.h', 'XP can level a winner up; the level-up rewards follow as usual.')}>
                  <Input type="number" min="0" max="10000000" value={f.reward.xp} onChange={(e) => setReward('xp', e.target.value)} />
                </Field>
              </div>
            )}

            <div className="text-[11px] text-[var(--muted)] mb-3">
              <span className="text-[var(--faint)]">{t('gw.gets', 'The winner gets')}: </span>{winnerGets}
            </div>
            <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
              <Field label={f.prizeKind === 'economy' ? t('gw.prize.opt', 'Prize name (optional)') : t('gw.prize', 'Prize')}
                hint={f.prizeKind === 'economy' ? t('gw.prize.opt.h', 'Left empty, the post reads what it pays.') : t('gw.prize.h', 'What entrants read on the post. The preset fills it; change it to whatever reads best.')}>
                <Input value={f.prize} onChange={(e) => setF({ ...f, prize: e.target.value })} maxLength={200}
                  placeholder={f.prizeKind === 'economy' ? (rewardLine || t('gw.prize.ph.eco', 'e.g. 500 {c}').replace('{c}', currency)) : t('gw.prize.ph', 'e.g. 1 month of hosting')} />
              </Field>
              <Field label={t('gw.audience', 'Where to enter')}><Dropdown className="w-full" value={f.audience} onChange={(v) => setF({ ...f, audience: v })} options={[{ value: 'discord', label: t('gw.aud.discord', 'Discord') }, { value: 'site', label: t('gw.aud.site', 'The site (bettercommunity.ch/giveaways)') }, { value: 'both', label: t('gw.aud.both', 'Both') }]} /></Field>
              {f.audience !== 'site' && <Field label={t('gw.channel', 'Channel id')}><Input value={f.channelId} onChange={(e) => setF({ ...f, channelId: e.target.value })} placeholder="123456789012345678" /></Field>}
              <Field label={t('gw.duration2', 'Runs for')}>
                {GW_DURATIONS.some(([m]) => m === Number(f.durationMinutes))
                  ? <Dropdown className="w-full" value={String(f.durationMinutes)}
                    onChange={(v) => setF({ ...f, durationMinutes: v === 'custom' ? '' : Number(v) })}
                    options={[...GW_DURATIONS.map(([m, label]) => ({ value: String(m), label: t(`gw.d.${m}`, label) })), { value: 'custom', label: t('gw.d.custom', 'Custom…') }]} />
                  : <div className="flex items-center gap-2">
                    <Input type="number" value={f.durationMinutes} onChange={(e) => setF({ ...f, durationMinutes: e.target.value })} placeholder="90" />
                    <span className="text-xs text-[var(--faint)] shrink-0">{t('gw.d.min', 'min')}</span>
                    <Button size="sm" variant="ghost" onClick={() => setF({ ...f, durationMinutes: 1440 })}>{t('common.reset', 'Reset')}</Button>
                  </div>}
              </Field>
              <Field label={t('gw.winners', 'Winners')}><Input type="number" value={f.winnersCount} onChange={(e) => setF({ ...f, winnersCount: e.target.value })} /></Field>
            </div>
            <Fold title={t('gw.fold.prize', 'Prize & delivery')} summary={prizeSummary}>
              <div className="space-y-3">
                <Field label={t('gw.prizekind', 'Prize kind')} hint={t('gw.prizekind.h2', 'What the winner receives: an item to claim from their inventory, or points and XP paid directly.')}>
                  <Dropdown className="w-full" value={f.prizeKind} onChange={(v) => setF({ ...f, prizeKind: v })} options={[{ value: 'promo', label: t('gw.pk.promo', 'Promo code (generated on reveal)') }, { value: 'economy', label: t('gw.pk.economy', 'Points / XP (paid into their balance)') }, { value: 'custom', label: t('gw.pk.custom', 'Custom (you type the content)') }, { value: 'none', label: t('gw.pk.none', 'None (bragging rights)') }]} />
                </Field>
                {f.prizeKind === 'custom' && (
                  <Field label={t('gw.prizecontent', 'Prize content (revealed to the winner)')} hint={t('gw.prizecontent.h', 'A code, a link, instructions, kept sealed in the winner’s inventory until they reveal it.')}>
                    <Textarea rows={3} value={f.prizeContent} onChange={(e) => setF({ ...f, prizeContent: e.target.value })} placeholder={t('gw.prizecontent.ph', 'e.g. STEAM-KEY-XXXX-YYYY, or a private download link…')} />
                  </Field>
                )}
                <div className="border-t border-[var(--line)] pt-3 space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5"><Lock size={11} /> {t('gw.reqs', 'Entry requirements')}</div>
                  <label className="flex items-center gap-2 text-sm text-[var(--muted)] cursor-pointer w-fit"><input type="checkbox" checked={f.reqLinked || f.reqCreator} disabled={f.reqCreator} onChange={(e) => setF({ ...f, reqLinked: e.target.checked })} /> {t('gw.req.linked', 'Require a linked BetterCommunity account (Discord ⇄ BCWEB)')}</label>
                  <label className="flex items-center gap-2 text-sm text-[var(--muted)] cursor-pointer w-fit"><input type="checkbox" checked={f.reqCreator} onChange={(e) => setF({ ...f, reqCreator: e.target.checked, reqLinked: e.target.checked ? true : f.reqLinked })} /> {t('gw.req.creator', 'Require a linked BMM creator id')}</label>
                  <div className="text-[11px] text-[var(--faint)]">{t('gw.req.note', 'Entrants without the required link get a helpful DM/notice pointing them to link, they can enter once linked.')}</div>
                </div>
                {renderWinnerMessage ? renderWinnerMessage(winnerMsgProps) : (
                  <Field label={winnerMsgProps.label} hint={winnerMsgProps.hint}>
                    <Textarea rows={3} value={winnerMsgProps.value} onChange={(e) => winnerMsgProps.onChange(e.target.value)} placeholder={winnerMsgProps.placeholder} />
                  </Field>
                )}
                {f.prizeKind === 'promo' && (
                  <div className="border-t border-[var(--line)] pt-3 grid sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5"><Gift size={11} className="text-[var(--accent-ink)]" /> {t('gw.promoprize', 'Promo prize, the code is generated when the winner reveals it')}</div>
                    <Field label={t('pc.f.type', 'Type')}><Dropdown className="w-full" value={f.gift.kind} onChange={(v) => setF({ ...f, gift: { ...f.gift, kind: v } })} options={[{ value: 'discount', label: t('pc.t.discount', 'Discount (% off / months free)') }, { value: 'free_hosting', label: t('pc.t.hosting', 'Free hosting (one repo)') }, { value: 'free_pool', label: t('pc.t.pool', 'Free storage pool') }, { value: 'free_boost', label: t('pc.t.boost', 'Free boost') }]} /></Field>
                    {f.gift.kind === 'discount' && <><Field label={t('pc.f.pctoff', '% off')}><Input type="number" value={f.gift.percentOff} onChange={(e) => setF({ ...f, gift: { ...f.gift, percentOff: e.target.value } })} /></Field><Field label={t('pc.f.freemonths', 'First months free')}><Input type="number" value={f.gift.freeMonths} onChange={(e) => setF({ ...f, gift: { ...f.gift, freeMonths: e.target.value } })} /></Field></>}
                    {(f.gift.kind === 'free_hosting' || f.gift.kind === 'free_pool') && <Field label={t('pc.f.storage', 'Storage GB')}><Input type="number" value={f.gift.storageGB} onChange={(e) => setF({ ...f, gift: { ...f.gift, storageGB: e.target.value } })} /></Field>}
                    {f.gift.kind === 'free_boost' && <Field label={t('pc.f.boostdays', 'Boost days')}><Input type="number" value={f.gift.boostDays} onChange={(e) => setF({ ...f, gift: { ...f.gift, boostDays: e.target.value } })} /></Field>}
                  </div>
                )}
              </div>
            </Fold>
            <div className="flex justify-end pt-1"><Button variant="primary" disabled={busy} onClick={create}>{busy ? <Spinner /> : <><Plus size={14} /> {t('gw.create', 'Create giveaway')}</>}</Button></div>
          </PanelSection>
        </div>
      )}
    </Card>
  );
}

export default BotGiveawaysCard;
