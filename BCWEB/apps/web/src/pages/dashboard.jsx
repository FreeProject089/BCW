import { useEffect, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import {
  Boxes, Server, Download, ArrowRight, Search, Upload, Bell, CheckCircle2, XCircle, Clock, Package, ShieldCheck, Inbox, TrendingUp, Lock, LayoutDashboard, Trash2, PenSquare, Star, Bell as BellIcon, CheckCheck, Receipt, Copy, Globe, BadgeCheck, Send, MessageSquare, Files, RefreshCw, X, ChevronDown, AlertTriangle, Ticket, Gift, Info, Save, Users, BarChart3, HardDriveDownload, FileJson, Sparkles, Mic, ShoppingBag, Backpack, Coins, HardDrive, Zap, Users as UsersIcon, BellRing, Bot, Cloud, LayoutGrid, UserCog } from 'lucide-react';
import { Button, Card, Badge, Input, Textarea, Select, Field, EmptyState, Explain, Spinner, Modal, useDialog, useToast, copyText, SkeletonCard } from '../ui/ui.jsx';
import { PointsHistoryTable } from '../ui/points-history.jsx';
import { api, uploadPayload } from '../lib/api.js';
import { onNotifsChanged, applyNotifChange, markNotifRead, markAllNotifsRead, deleteNotif, deleteAllNotifs } from '../lib/notifs.js';
import { useReportsUnseen } from '../lib/reports-unseen.js';
import { useAuth } from './auth.jsx';
import { useI18n } from '../i18n.jsx';
import { useIntro } from '../ui/IntroContext.jsx';
import { MyRepos, Billing } from './repos.jsx';
import { TransfersCard } from './profile.jsx';
import { MyDiscordServers } from './discord-servers.jsx';
import { OnboardingSlot } from './onboarding.jsx';

// These two tabs live in admin.jsx (an artefact of splitting the old pages monolith —
// nothing in admin.jsx renders them; this page is their only consumer). Referencing them
// without importing anything is what made both tabs throw `X is not defined` at render.
//
// They're imported LAZILY on purpose: a static import makes the dashboard chunk pull the
// whole admin chunk (~134 KB gzip, 13x this page's own size) onto every member's dashboard,
// admin or not. This way only someone who actually opens Catalogs/Reports fetches it. The
// route already sits inside a <Suspense> boundary in App.jsx.
// Proper fix, when someone has the appetite: move these sections out of admin.jsx — it needs
// `useAsync`/`Loading` relocated out of pages.jsx first, since pages.jsx already imports
// ui/report.jsx and moving them naively creates an import cycle.
// lazyNamed, not lazy: a redeploy renames admin.jsx's chunk, and a tab that has been open
// across it would fail the import and show a crash card. See lib/lazy-chunk.js.
const OwnerCatalogs = lazyNamed(() => import('./admin.jsx'), 'OwnerCatalogs');
const MyReports = lazyNamed(() => import('./admin.jsx'), 'MyReports');
const MyThreads = lazyNamed(() => import('./threads.jsx'), 'MyThreads');
const MyTeams = lazyNamed(() => import('./teams.jsx'), 'MyTeams');
import { KofiIcon } from '../ui/brand.jsx';
import { ItemTagPicker } from '../ui/catalog-pickers.jsx'; // G4 (agent-catalog-G): tags as a dropdown with icons
import { useAsync, Loading, statusTone, KIND_ICON, fmtRemaining, JsonEditor, SideDash, startOwnershipTransfer } from './pages.jsx';

/* ─────────────────────────  Dashboard  ───────────────────────── */
const SUBMIT_INIT = { projectKey: 'bmm', kind: 'PLUGIN', name: '', description: '', version: '1.0.0', meta: '{}' };

// The notification icon/label map lives in ../ui/notif.js so the nav bell can import it
// without dragging this whole page into the initial bundle. Re-exported for existing callers.
import { NOTIF, NOTIF_FALLBACK } from '../ui/notif.js';
import { lazyNamed } from '../lib/lazy-chunk.js';
import { MyReviewCard } from '../ui/review-form.jsx'; // M11: a member's own landing review
export { NOTIF, NOTIF_FALLBACK };

// The member's Discord level, XP progress and spendable points — from /me/economy. Renders
// nothing until the economy is enabled and they've earned some XP (so it never shows an empty
// "Level 0" to someone who has never used Discord).
//
// Two numbers a person came to read (the level, the balance), one bar saying where the XP came
// from, and the two doors that spend it. Everything that merely EXPLAINS the system — the per
// source rates, the arithmetic behind each share — is folded into the Explain at the foot, so
// the card is the same height whether or not you have read it before.
function EconomyWidget({ onOpenShop }) {
  const { t } = useI18n();
  const [d, setD] = useState(null);
  useEffect(() => { api.get('/me/economy').then(setD).catch(() => setD({ enabled: false })); }, []);
  if (!d || !d.enabled || (d.level === 0 && d.xp === 0)) return null;
  const cur = d.currency?.name || 'points';
  const pct = d.xpForNext > 0 ? Math.min(100, Math.round((d.xpThisLevel / d.xpForNext) * 100)) : 0;
  const stats = d.stats || {};
  const toggleStats = async () => {
    const next = !stats.public;
    setD((v) => ({ ...v, stats: { ...v.stats, public: next } }));
    try { await api.put('/me/economy/stats-public', { public: next }); } catch { setD((v) => ({ ...v, stats: { ...v.stats, public: !next } })); }
  };
  const r = d.rates || { message: 5, reaction: 1, voiceMinute: 3 };
  // The three sources, each with a colour that is its own — the bar and the legend share it.
  const src = [
    { key: 'msg', label: t('eco.w.src.msg', 'Messages'), xp: (stats.messages || 0) * r.message, Icon: MessageSquare, count: (stats.messages || 0).toLocaleString(), rate: t('eco.w.rate.msg', '{n} XP each').replace('{n}', r.message), color: 'var(--primary)' },
    { key: 'rea', label: t('eco.w.src.rea', 'Reactions'), xp: (stats.reactions || 0) * r.reaction, Icon: Sparkles, count: (stats.reactions || 0).toLocaleString(), rate: t('eco.w.rate.rea', '{n} XP each').replace('{n}', r.reaction), color: 'color-mix(in srgb, var(--primary) 45%, var(--text))' },
    { key: 'voi', label: t('eco.w.src.voi', 'Voice'), xp: Math.floor((stats.voiceSeconds || 0) / 60) * r.voiceMinute, Icon: Mic, count: `${Math.floor((stats.voiceSeconds || 0) / 3600)}h`, rate: t('eco.w.rate.voi', '{n} XP / min').replace('{n}', r.voiceMinute), color: 'var(--line-strong)' },
  ];
  const total = src.reduce((s, x) => s + x.xp, 0);
  const share = (x) => (total > 0 ? Math.round((x.xp / total) * 100) : 0);
  const ring = `conic-gradient(var(--primary) ${pct * 3.6}deg, var(--surface-2) 0)`;
  return (
    <Card className="p-4 sm:p-5">
      {/* The level and the balance share one row at EVERY width. They are the same shape — a
          number under a caption — and putting them on separate rows on a phone pushed the two
          buttons below the fold, which is the only reason anybody opens this card. */}
      <div className="grid gap-4 sm:gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:items-center">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="relative w-16 h-16 rounded-full grid place-items-center shrink-0" style={{ background: ring }} title={t('eco.w.ring', '{n}% of the way to the next level').replace('{n}', pct)}>
            <div className="w-[52px] h-[52px] rounded-full bg-[var(--bg-solid)] grid place-items-center">
              <span className="text-xl font-extrabold tabular-nums leading-none">{d.level}</span>
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-[var(--faint)]">{t('eco.w.level.k', 'Discord level')}</div>
            <div className="text-lg font-bold leading-tight">{t('eco.w.level', 'Level {n}').replace('{n}', d.level)}</div>
            <div className="text-[11px] text-[var(--faint)] tabular-nums mt-0.5">{(d.xpThisLevel || 0).toLocaleString()} / {(d.xpForNext || 0).toLocaleString()} XP · {pct}%</div>
          </div>
          <div className="ms-auto text-end shrink-0">
            <div className="text-[11px] uppercase tracking-wider text-[var(--faint)]">{t('eco.w.balance', 'Balance')}</div>
            <div className="text-xl font-extrabold tabular-nums leading-tight flex items-center gap-1.5 justify-end"><Coins size={16} className="text-[var(--accent-ink)]" /> {(d.points || 0).toLocaleString()}</div>
            <div className="text-[10px] text-[var(--faint)] truncate" title={cur}>{cur}</div>
          </div>
        </div>

        {/* One bar, three colours, and a legend that is one line per source. A row of three
            tiles was breaking its own labels in half at the widths this column really has. */}
        <div className="min-w-0 md:ps-5 md:border-s md:border-[var(--line)]">
          <div className="flex items-center justify-between gap-2 text-[11px] mb-1.5">
            <span className="uppercase tracking-wider text-[var(--faint)]">{t('eco.w.src.title', 'Where your XP comes from')}</span>
            <span className="tabular-nums text-[var(--muted)]">{total.toLocaleString()} XP</span>
          </div>
          <div className="flex h-2.5 rounded-full overflow-hidden bg-[var(--surface-2)]" role="img" aria-label={src.map((x) => `${x.label} ${share(x)}%`).join(', ')}>
            {src.map((x) => (share(x) > 0 ? <div key={x.key} style={{ width: `${share(x)}%`, background: x.color }} title={`${x.label} · ${share(x)}%`} /> : null))}
          </div>
          <div className="mt-2 space-y-1">
            {src.map((x) => (
              <div key={x.key} className="flex items-center gap-2 text-[11px] min-w-0">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: x.color }} />
                <x.Icon size={12} className="shrink-0 text-[var(--faint)]" />
                <span className="truncate text-[var(--muted)]" title={x.label}>{x.label}</span>
                <span className="ms-auto tabular-nums shrink-0" title={x.count}>{x.count}</span>
                <span className="tabular-nums text-[var(--faint)] w-9 text-end shrink-0">{share(x)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Two equal full-width buttons: 44px targets side by side beat two small ones squeezed
          next to a number, and they are the point of the card. */}
      <div className="grid grid-cols-2 gap-2 mt-4">
        <Button variant="primary" className="justify-center" onClick={() => onOpenShop?.('shop')}><ShoppingBag size={15} /> {t('eco.w.shop', 'Shop')}{d.shopItems ? <span className="text-[11px] opacity-80"> · {d.shopItems}</span> : null}</Button>
        <Button className="justify-center" onClick={() => onOpenShop?.('inventory')}><Backpack size={15} /> {t('eco.w.inv', 'Inventory')}{d.pendingDeliveries ? <Badge tone="amber" className="ms-1">{d.pendingDeliveries}</Badge> : null}</Button>
      </div>

      <div className="mt-4 pt-3 border-t border-[var(--line)] flex items-start justify-between gap-4 flex-wrap text-[11px]">
        <Explain className="text-[11px] min-w-0 flex-1" summary={t('eco.w.how.s', 'XP comes from being active on Discord.')}>
          <p>{t('eco.w.how', 'XP comes from being active on the Discord servers the bot is in. Every few levels grant {cur} to spend in the shop.').replace('{cur}', cur)}</p>
          <ul className="space-y-0.5">
            {src.map((x) => (
              <li key={x.key} className="tabular-nums">{x.label}: {x.count} · {x.rate} · {x.xp.toLocaleString()} XP</li>
            ))}
          </ul>
        </Explain>
        <label className="flex items-center gap-1.5 cursor-pointer select-none shrink-0 text-[var(--muted)]" title={t('eco.w.pub.h', 'Show these stats on your public profile (your level is always public).')}>
          <input type="checkbox" className="accent-[var(--primary)]" checked={stats.public !== false} onChange={toggleStats} /> {t('eco.w.pub', 'Stats public')}
        </label>
      </div>
    </Card>
  );
}

// The points shop and the inventory, on the site. The same items and the same purchase
// function the Discord /shop uses (lib/economy-shop.mjs on the API), so a badge bought here
// and one bought there are the same thing — and everything bought either way lands in the
// inventory below with its code.
const SHOP_KIND = {
  badge: { Icon: BadgeCheck, tone: 'text-amber-400' }, pool: { Icon: HardDrive, tone: 'text-[var(--accent-ink)]' }, boost: { Icon: Zap, tone: 'text-[var(--accent-ink)]' },
  hosting: { Icon: Server, tone: 'text-[var(--accent-ink)]' }, promo: { Icon: Ticket, tone: 'text-emerald-400' }, role: { Icon: Users, tone: 'text-[#5865F2]' }, custom: { Icon: Gift, tone: 'text-[var(--accent-ink)]' },
};
const HIST_PAGE = 25;   // one screenful of ledger rows; "Load more" fetches the next 25
function EconomyShop({ view = 'shop', onView }) {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const [d, setD] = useState(null);
  // The history is paged, not loaded whole: an account that has played the casino for a
  // month has thousands of ledger rows, and every one of them was being fetched and rendered
  // to fill a panel you read the top ten lines of. `histTotal` is what the SERVER counted, so
  // the number beside the heading stays the true size of the history and does not creep up
  // one page at a time as you press "Load more".
  const [hist, setHist] = useState(null);
  const [histTotal, setHistTotal] = useState(0);
  const [histMore, setHistMore] = useState(false);
  const [histBusy, setHistBusy] = useState(false);
  const [busy, setBusy] = useState('');
  const [giftTo, setGiftTo] = useState(''); const [giftPts, setGiftPts] = useState(''); const [giftNote, setGiftNote] = useState('');
  const load = () => api.get('/me/economy/shop').then(setD).catch(() => setD({ enabled: false, items: [], purchases: [] }));
  const loadHist = async (skip = 0) => {
    setHistBusy(true);
    try {
      const r = await api.get(`/me/economy/history?take=${HIST_PAGE}&skip=${skip}`);
      const rows = r.history || [];
      setHist((prev) => (skip > 0 ? [...(prev || []), ...rows] : rows));
      setHistTotal(Number(r.total) || (skip > 0 ? histTotal : rows.length));
      setHistMore(!!r.more);
    } catch { setHist((prev) => prev || []); setHistMore(false); }
    finally { setHistBusy(false); }
  };
  useEffect(() => { load(); }, []);
  // Depends on `hist` as well as `view`: sending points clears it back to null to mean "this
  // is stale", and with `view` alone that reset never triggered a refetch while the tab was
  // already open. The failure path sets [] rather than null, so a broken request cannot loop.
  useEffect(() => { if (view === 'history' && hist === null && !histBusy) loadHist(0); /* eslint-disable-next-line */ }, [view, hist]);
  if (!d) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}</div>;
  const cur = d.currency?.name || 'points';
  const kindLabel = (k) => ({ badge: t('eco.k.badge', 'Profile badge'), pool: t('eco.k.pool', 'Storage pool'), boost: t('eco.k.boost', 'Catalog boost'), hosting: t('eco.k.hosting', 'Free hosting'), promo: t('eco.k.promo', 'Promo code'), role: t('eco.k.role', 'Discord role'), custom: t('eco.k.custom', 'Reward') })[k] || k;
  const tagLabel = (it) => it.tag === 'exclusive' ? t('eco.tag.excl', 'Exclusive') : it.tag === 'limited' ? t('eco.tag.lim', '{n} left').replace('{n}', it.remaining ?? '?') : it.tag === 'timed' ? t('eco.tag.timed', 'Until {d}').replace('{d}', it.availableUntil ? new Date(it.availableUntil).toLocaleDateString() : '') : null;
  const errText = (e) => e === 'insufficient' ? t('eco.err.short', 'Not enough {cur}.').replace('{cur}', cur) : e === 'already_owned' ? t('eco.err.owned', 'You already own that one.') : e === 'sold_out' ? t('eco.err.soldout', 'Sold out.') : e === 'economy_off' ? t('eco.err.off', 'The shop is closed right now.')
    : e === 'no_such_user' ? t('eco.err.nouser', 'Nobody by that name, id or e-mail.') : e === 'self' ? t('eco.err.self', 'That is you.') : e === 'gifts_off' ? t('eco.err.giftsoff', 'Gifting is switched off.') : e === 'too_small' ? t('eco.err.toosmall', 'Below the minimum gift.') : e === 'daily_cap' ? t('eco.err.cap', 'Daily gift cap reached.') : e === 'not_giftable' ? t('eco.err.notgiftable', 'That item is bound to its buyer.') : e === 'pending' ? t('eco.err.pending', 'Wait until an admin has handed it out.') : t('common.failed', 'Failed.');
  const buy = async (it) => {
    const what = it.fulfil === 'site' ? (it.kind === 'badge' ? t('eco.buy.site', 'It is delivered immediately.') : t('eco.buy.sealed', 'It lands sealed in your inventory, reveal the code when you want it, or gift it unopened.')) : t('eco.buy.admin', 'An admin hands it out, it shows as pending until then.');
    if (!(await dialog.confirm({ title: t('eco.buy.t', 'Buy “{n}”?').replace('{n}', it.name), message: t('eco.buy.m', 'This spends {c} {cur} of your {b}. {what}').replace('{c}', it.cost.toLocaleString()).replace('{cur}', cur).replace('{b}', (d.points || 0).toLocaleString()).replace('{what}', what), okLabel: t('eco.buy.ok', 'Buy') }))) return;
    setBusy(it.id);
    try {
      const r = await api.post('/me/economy/buy', { itemId: it.id });
      const dl = r.delivery || {};
      toast.success(dl.badge ? t('eco.bought.badge', 'Bought, the “{b}” badge is on your profile.').replace('{b}', dl.badge) : dl.revealed === false ? t('eco.bought.sealed', 'Bought, sealed in your inventory.') : r.status === 'pending' ? t('eco.bought.pending', 'Bought, an admin will hand it out shortly.') : t('eco.bought', 'Bought.'));
      load(); onView?.('inventory');
    } catch (x) { toast.error(errText(x?.data?.error)); } finally { setBusy(''); }
  };
  const reveal = async (p) => {
    setBusy(p.id);
    try { const r = await api.post(`/me/economy/purchases/${p.id}/reveal`); const code = r.delivery?.code; const content = r.delivery?.content; if (code) { copyText(code); toast.success(t('eco.revealed', 'Your code: {c}, copied.').replace('{c}', code)); } else if (content) { copyText(content); toast.success(t('eco.revealed.content', 'Prize revealed, copied.')); } load(); }
    catch (x) { toast.error(errText(x?.data?.error)); } finally { setBusy(''); }
  };
  const giftItem = async (p) => {
    const to = await dialog.prompt({ title: t('eco.giftitem.t', 'Gift “{n}”').replace('{n}', p.name), message: t('eco.giftitem.m', 'Who gets it? A display name, e-mail, id or BC id. It lands sealed in their inventory.'), okLabel: t('eco.giftitem.ok', 'Gift') });
    if (!to || !String(to).trim()) return;
    setBusy(p.id);
    try { const r = await api.post(`/me/economy/purchases/${p.id}/gift`, { to: String(to).trim() }); toast.success(t('eco.gifted', 'Handed to {n}.').replace('{n}', r.to?.displayName || to)); load(); }
    catch (x) { toast.error(errText(x?.data?.error)); } finally { setBusy(''); }
  };
  const giftPoints = async () => {
    const pts = Math.round(Number(giftPts));
    if (!giftTo.trim() || !(pts > 0)) return;
    if (!(await dialog.confirm({ title: t('eco.gift.t', 'Send {n} {cur}?').replace('{n}', pts.toLocaleString()).replace('{cur}', cur), message: t('eco.gift.m', 'To “{to}”. Points cannot be taken back.').replace('{to}', giftTo.trim()), okLabel: t('eco.gift.ok', 'Send') }))) return;
    setBusy('gift');
    try { const r = await api.post('/me/economy/gift', { to: giftTo.trim(), points: pts, note: giftNote.trim() || undefined }); toast.success(t('eco.gift.sent', 'Sent to {n}. Balance: {b}.').replace('{n}', r.to?.displayName || giftTo).replace('{b}', (r.points || 0).toLocaleString())); setGiftTo(''); setGiftPts(''); setGiftNote(''); load(); setHist(null); }
    catch (x) { toast.error(errText(x?.data?.error)); } finally { setBusy(''); }
  };
  const purchases = d.purchases || [];
  const pending = purchases.filter((p) => p.status === 'pending').length;
  const LK = { levelup: t('eco.lk.levelup', 'Level-up'), grant: t('eco.lk.grant', 'Staff'), purchase: t('eco.lk.purchase', 'Purchase'), casino: t('eco.lk.casino', 'Casino'), gift_out: t('eco.lk.gift_out', 'Gift sent'), gift_in: t('eco.lk.gift_in', 'Gift received'), gift_item_out: t('eco.lk.gift_item_out', 'Item given'), gift_item_in: t('eco.lk.gift_item_in', 'Item received'), refund: t('eco.lk.refund', 'Refund'), season: t('eco.lk.season', 'New season'), giveaway: t('eco.lk.giveaway', 'Giveaway') };
  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="flex items-center gap-1 p-1 rounded-xl border border-[var(--line)] panel">
          {[['shop', t('eco.tab.shop', 'Shop'), ShoppingBag, d.items?.length || 0], ['inventory', t('eco.tab.inv', 'Inventory'), Backpack, purchases.length], ['history', t('eco.tab.hist', 'History'), Clock, hist ? histTotal : null]].map(([id, label, I, n]) => (
            <button key={id} type="button" onClick={() => onView?.(id)} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition ${view === id ? 'bg-[var(--bg-solid)] text-[var(--text)] font-medium shadow-sm border border-[var(--line)]' : 'text-[var(--muted)] hover:text-[var(--text)] border border-transparent'}`}>
              <I size={14} className={view === id ? 'text-[var(--accent-ink)]' : ''} /> {label} {n != null && <span className="text-[11px] text-[var(--faint)]">{n}</span>}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm"><Coins size={16} className="text-[var(--accent-ink)]" /> <b className="tabular-nums">{(d.points || 0).toLocaleString()}</b> <span className="text-[var(--muted)]">{cur}</span></div>
      </div>
      {!d.enabled ? <EmptyState icon={ShoppingBag} title={t('eco.off.t', 'The shop is closed')} sub={t('eco.off.s', 'The Discord economy is switched off right now.')} /> : view === 'shop' ? (
        d.items?.length ? (<>
          <p className="text-[12px] text-[var(--muted)] mb-3">{t('eco.shop.note', 'Everything here is tied to this BetterCommunity account — a badge goes on your profile, a code is redeemed here. Sealed items can be gifted unopened; a badge or a role is bound to its buyer.')}</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {d.items.map((it) => {
              const K = SHOP_KIND[it.kind] || SHOP_KIND.custom;
              const can = (d.points || 0) >= it.cost && !it.owned && !it.soldOut;
              const tag = tagLabel(it);
              return (
                <Card key={it.id} className={`p-4 flex flex-col gap-3 relative ${it.tag === 'exclusive' ? 'border-amber-400/40' : ''}`}>
                  {tag && <span className={`absolute -top-2 right-3 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${it.tag === 'exclusive' ? 'tint-warning b-warning text-[var(--warning)]' : it.tag === 'limited' ? 'tint-primary b-primary text-[var(--accent-ink)]' : 'bg-[var(--surface-2)] border-[var(--line)] text-[var(--muted)]'}`}>{tag}</span>}
                  <div className="flex items-start gap-3">
                    <span className="grid place-items-center w-10 h-10 rounded-xl bg-[var(--surface-2)] shrink-0"><K.Icon size={18} className={K.tone} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate" title={it.name}>{it.name}</div>
                      <div className="text-[11px] text-[var(--faint)]">{kindLabel(it.kind)}{it.gb ? ` · ${it.gb} GB` : ''}{it.days ? ` · ${it.days} d` : ''}{it.kind === 'hosting' && it.months ? ` · ${it.months} mo` : ''}{it.fulfil !== 'site' ? ` · ${t('eco.k.byadmin', 'handed out by an admin')}` : ''}</div>
                    </div>
                  </div>
                  {it.desc && <p className="text-xs text-[var(--muted)] flex-1">{it.desc}</p>}
                  <div className="flex items-center gap-2 flex-wrap text-[10px] text-[var(--faint)]">
                    <span>{it.giftable ? t('eco.giftable', 'giftable') : t('eco.bound', 'bound to you')}</span>
                    {it.codeDays ? <span>· {t('eco.codedays', 'code valid {n} d').replace('{n}', it.codeDays)}</span> : null}
                    {it.exclusive ? <span>· {t('eco.oneper', 'one per account')}</span> : null}
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-auto">
                    <span className="text-sm font-semibold tabular-nums flex items-center gap-1"><Coins size={13} className="text-[var(--accent-ink)]" /> {it.cost.toLocaleString()} <span className="text-[11px] text-[var(--faint)] font-normal">{cur}</span></span>
                    {it.owned ? <Badge tone="green"><CheckCircle2 size={11} /> {t('eco.owned', 'Owned')}</Badge>
                      : it.soldOut ? <Badge>{t('eco.soldout', 'Sold out')}</Badge>
                      : <Button size="sm" variant={can ? 'primary' : 'ghost'} disabled={!can || busy === it.id} onClick={() => buy(it)} title={can ? undefined : t('eco.err.short', 'Not enough {cur}.').replace('{cur}', cur)}>{busy === it.id ? <Spinner /> : <><ShoppingBag size={13} /> {t('eco.buy.ok', 'Buy')}</>}</Button>}
                  </div>
                </Card>
              );
            })}
          </div>
        </>) : <EmptyState icon={ShoppingBag} title={t('eco.empty.t', 'Nothing for sale yet')} sub={t('eco.empty.s', 'The admins have not put anything in the shop. Your points keep.')} />
      ) : view === 'inventory' ? (
        purchases.length ? (
          <div className="space-y-2">
            {pending > 0 && <div className="text-xs text-[var(--muted)] flex items-center gap-1.5"><Clock size={13} className="text-warning" /> {t('eco.inv.pending', '{n} still on the way, an admin hands those out.').replace('{n}', pending)}</div>}
            {purchases.map((p) => {
              const K = SHOP_KIND[p.kind] || SHOP_KIND.custom; const dl = p.delivery || {};
              return (
                <Card key={p.id} className="p-3 flex items-center gap-3 flex-wrap">
                  <span className="grid place-items-center w-9 h-9 rounded-lg bg-[var(--surface-2)] shrink-0"><K.Icon size={16} className={K.tone} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate flex items-center gap-2">{p.name} {p.status === 'pending' ? <Badge tone="amber"><Clock size={11} /> {t('eco.inv.st.pending', 'pending')}</Badge> : p.expired ? <Badge>{t('eco.inv.st.expired', 'expired')}</Badge> : dl.revealed || dl.badge ? <Badge tone="green"><CheckCircle2 size={11} /> {t('eco.inv.st.done', 'delivered')}</Badge> : <Badge tone="primary">{t('eco.inv.st.sealed', 'sealed')}</Badge>}{p.giftedFromId && <Badge><Gift size={11} /> {t('eco.inv.gifted', 'a gift')}</Badge>}</div>
                    <div className="text-[11px] text-[var(--faint)] flex items-center gap-2 flex-wrap">
                      <span>{kindLabel(p.kind)} · {p.cost.toLocaleString()} {cur} · {new Date(p.createdAt).toLocaleDateString()} · {p.via === 'discord' ? 'Discord' : t('eco.inv.site', 'site')}</span>
                      {dl.badge && <span>· {t('eco.inv.badge', 'badge “{b}”').replace('{b}', dl.badge)}</span>}
                      {p.expiresAt && <span>· {t('eco.inv.until', 'valid until {d}').replace('{d}', new Date(p.expiresAt).toLocaleString())}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {dl.code && <button type="button" onClick={() => { copyText(dl.code); toast.success(t('common.copied', 'Copied.')); }} className="inline-flex items-center gap-1.5 text-xs font-mono px-2 py-1 rounded-md bg-[var(--surface-2)] border border-[var(--line)] hover:b-primary" title={t('eco.inv.copy', 'Copy the code')}><Ticket size={12} className="text-emerald-400" /> {dl.code} <Copy size={11} className="opacity-60" /></button>}
                    {dl.content && <button type="button" onClick={() => { copyText(dl.content); toast.success(t('common.copied', 'Copied.')); }} className="inline-flex items-center gap-1.5 text-xs font-mono px-2 py-1 rounded-md bg-[var(--surface-2)] border border-[var(--line)] hover:b-primary max-w-[16rem]" title={t('eco.inv.copycontent', 'Copy the prize')}><Gift size={12} className="text-emerald-400 shrink-0" /> <span className="truncate" title={dl.content}>{dl.content}</span> <Copy size={11} className="opacity-60 shrink-0" /></button>}
                    {p.canReveal && <Button size="sm" variant="primary" disabled={busy === p.id} onClick={() => reveal(p)} title={t('eco.reveal.h', 'Mints the code now, for you. A revealed item that is not giftable stays yours.')}>{busy === p.id ? <Spinner /> : <><Ticket size={13} /> {t('eco.reveal', 'Reveal')}</>}</Button>}
                    {p.canGift && <Button size="sm" disabled={busy === p.id} onClick={() => giftItem(p)}><Gift size={13} /> {t('eco.giftitem.ok', 'Gift')}</Button>}
                  </div>
                </Card>
              );
            })}
          </div>
        ) : <EmptyState icon={Backpack} title={t('eco.inv.empty.t', 'Nothing here yet')} sub={t('eco.inv.empty.s', 'What you buy in the shop, here or with /shop on Discord, is listed here with its code.')} />
      ) : (
        <div className="space-y-4">
          {/* Sending points: to a name, an e-mail, an id or a BC id. */}
          {d.gifts?.enabled !== false && (
            <Card className="p-4">
              <div className="text-sm font-semibold flex items-center gap-2 mb-1"><Gift size={15} className="text-[var(--accent-ink)]" /> {t('eco.gift.title', 'Send points to a member')}</div>
              <p className="text-[11px] text-[var(--faint)] mb-3">{t('eco.gift.h', 'They must have a BetterCommunity account. Minimum {min}{cap}, also possible on Discord with /gift.').replace('{min}', d.gifts?.min || 1).replace('{cap}', d.gifts?.maxPerDay ? t('eco.gift.cap', ', at most {n} per day').replace('{n}', d.gifts.maxPerDay.toLocaleString()) : '')}</p>
              <div className="grid sm:grid-cols-[1.4fr_0.7fr_1.4fr_auto] gap-2 items-end">
                <Field label={t('eco.gift.to', 'To (name, e-mail, id or BC id)')} className="!mb-0"><Input value={giftTo} onChange={(e) => setGiftTo(e.target.value)} placeholder="BC-XXXX-XXXX" /></Field>
                <Field label={cur} className="!mb-0"><Input type="number" min={d.gifts?.min || 1} value={giftPts} onChange={(e) => setGiftPts(e.target.value)} /></Field>
                <Field label={t('eco.gift.note', 'A word (optional)')} className="!mb-0"><Input value={giftNote} maxLength={140} onChange={(e) => setGiftNote(e.target.value)} /></Field>
                <Button variant="primary" disabled={busy === 'gift' || !giftTo.trim() || !(Number(giftPts) > 0)} onClick={giftPoints}>{busy === 'gift' ? <Spinner /> : <><Send size={14} /> {t('eco.gift.ok', 'Send')}</>}</Button>
              </div>
            </Card>
          )}
          <Card className="p-4">
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <div className="text-sm font-semibold flex items-center gap-2">
                <Clock size={15} className="text-[var(--accent-ink)]" /> {t('eco.hist.title', 'Point history')}
                {/* The count is the server's total, not hist.length: the list below is one page. */}
                {hist?.length ? <Badge tone="">{histTotal.toLocaleString()}</Badge> : null}
              </div>
              <button type="button" onClick={() => loadHist(0)} className="text-xs text-[var(--muted)] hover:text-[var(--text)] inline-flex items-center gap-1"><RefreshCw size={12} /> {t('common.refresh', 'Refresh')}</button>
            </div>
            {hist === null ? <SkeletonCard /> : !hist.length ? <EmptyState icon={Clock} title={t('eco.hist.empty.t', 'Nothing yet')} sub={t('eco.hist.empty.s', 'Earn, buy, play or gift and it shows up here.')} /> : (<>
              <PointsHistoryTable rows={hist} kindLabel={(k) => LK[k] || k} currency={cur} />
              {/* An explicit button, not infinite scroll: this panel sits above the rest of the
                  tab, and a list that grows as you scroll past it never lets you reach what is
                  under it. */}
              <div className="flex items-center justify-center gap-3 mt-3 text-xs text-[var(--muted)]">
                <span className="tabular-nums">{t('eco.hist.count', '{n} of {total}').replace('{n}', hist.length.toLocaleString()).replace('{total}', histTotal.toLocaleString())}</span>
                {histMore && <Button size="sm" disabled={histBusy} onClick={() => loadHist(hist.length)}>{histBusy ? <Spinner /> : <ChevronDown size={14} />} {t('common.loadmore', 'Load more')}</Button>}
              </div>
            </>)}
          </Card>
        </div>
      )}
    </div>
  );
}

function NotificationsPanel() {
  // Wrapping two strings in t() last pass put a call into a scope that had never needed the
  // hook — the page crashed on render with "t is not defined", and the build said nothing:
  // an undefined identifier inside JSX is a runtime fact, not a compile one.
  const { t } = useI18n();
  const nav = useNavigate();
  const dialog = useDialog();
  const toast = useToast();
  const { data, loading, reload } = useAsync(() => api.get('/me/notifications'), []);
  // The list is held locally so an action shows IMMEDIATELY. It used to fire the request and
  // then refetch, which meant marking one read left it looking unread until the page was
  // reloaded by hand — a button that appears to do nothing.
  //
  // The bell in the topbar and the notification centre both already worked this way; this
  // panel was the third copy of the same behaviour and the only one that refetched. The
  // reload is now the FAILURE path: if the write did not land, the server's answer wins.
  const [items, setItems] = useState(null);
  useEffect(() => { if (data) setItems(data.notifications || []); }, [data]);
  // What the bell or the notification centre did, applied here without a request. Three
  // lists of the same notifications, and until now none of them could tell the others.
  useEffect(() => onNotifsChanged((d) => setItems((s) => applyNotifChange(s, d))), []);
  const list = items || [];
  const unread = list.filter((n) => !n.readAt).length;
  const stamp = () => new Date().toISOString();
  // Immediate, no undo toast: the same as the notification centre (pages/notifications.jsx).
  // Marking read is not destructive, and a toast after every "mark all read" was the kind of
  // noise the centre was simplified to remove (B8). The bell and centre hear the broadcast.
  const markAll = async () => {
    setItems((s) => (s || []).map((x) => ({ ...x, readAt: x.readAt || stamp() })));
    try { await markAllNotifsRead(); } catch { reload(); }
  };
  // Marking read AND going where it points. Read-only rows made every notification a dead end:
  // the one telling you an ownership transfer is waiting could not take you to it.
  const openNotif = (n) => {
    markOne(n);
    if (n.href) nav(n.href);
  };

  const markOne = async (n) => {
    if (n.readAt) return;
    setItems((s) => (s || []).map((x) => (x.id === n.id ? { ...x, readAt: stamp() } : x)));
    try { await markNotifRead(n.id); } catch { reload(); }
  };
  const del = async (n) => {
    setItems((s) => (s || []).filter((x) => x.id !== n.id));
    try { await deleteNotif(n.id); } catch { reload(); }
  };
  const clearAll = async () => {
    if (!(await dialog.confirm({ title: t('dash.notif.clear.t', 'Clear all notifications'), message: t('dash.notif.clear.m', 'This permanently deletes all of your notifications. Continue?'), okLabel: t('dsh.clearall', 'Clear all'), danger: true }))) return;
    setItems([]);
    try { await deleteAllNotifs(); } catch { reload(); }
  };
  const ago = (d) => { const s = (Date.now() - new Date(d)) / 1000; if (s < 60) return 'now'; if (s < 3600) return `${Math.floor(s / 60)}m`; if (s < 86400) return `${Math.floor(s / 3600)}h`; return `${Math.floor(s / 86400)}d`; };
  return (
    <div>
      {/* The three controls wrap onto their own line below the heading on a phone rather than
          squeezing a 3-word button into 60px. `gap-2` on both axes so a wrapped row does not
          sit flush against the one above it. */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <h2 className="font-semibold flex items-center gap-2"><Bell size={16} /> {t('dash.notif.title', 'Notifications')} {unread > 0 && <Badge tone="primary">{unread}</Badge>}</h2>
        <div className="flex items-center gap-2 flex-wrap ms-auto">
          {unread > 0 && <button className="text-xs flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[var(--line-strong)] text-[var(--accent-ink)] hover:border-[var(--primary)] transition shadow-sm" style={{ background: 'var(--bg-solid)' }} onClick={markAll}><CheckCheck size={13} /> {t('dash.notif.markAll', 'Mark all read')}</button>}
          {list.length > 0 && <button className="text-xs flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[var(--line-strong)] text-error hover:border-error transition shadow-sm" style={{ background: 'var(--bg-solid)' }} onClick={clearAll}><Trash2 size={13} /> {t('dsh.clearall', "Clear all")}</button>}
          {/* The way out to the centre, which is the only place the per-category switches
              live. This card can mark and delete; it cannot say "stop sending me this". */}
          <Link to="/notifications" className="text-xs flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[var(--primary)] text-[var(--on-primary)] hover:opacity-90 transition shadow-sm" style={{ background: 'var(--primary)' }}>
            <BellRing size={13} /> {t('dash.notif.centre', 'Notification centre')}
          </Link>
        </div>
      </div>
      {loading ? <Loading /> : (list.length ? <div className="space-y-2 max-h-[460px] overflow-auto pe-1">
        {list.map((n) => { const m = NOTIF[n.kind] || NOTIF_FALLBACK; return (
          <Card key={n.id} className={`p-3.5 flex gap-3 group ${!n.readAt ? 'border-[var(--ring)]' : ''}`}
            onClick={() => openNotif(n)}
            style={{ cursor: (n.href || !n.readAt) ? 'pointer' : 'default' }}>
            <span className={`grid place-items-center w-9 h-9 rounded-xl shrink-0 ${m.tint}`}><m.icon size={16} className={m.tone} /></span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${m.tone}`}>{m.label}</span>
                <span className="text-[11px] text-[var(--faint)]">· {ago(n.createdAt)} ago</span>
              </div>
              <div className={`text-sm break-words [overflow-wrap:anywhere] ${n.readAt ? 'text-[var(--muted)]' : 'text-[var(--text)]'}`}>{n.body}</div>
            </div>
            {!n.readAt && <span className="w-2 h-2 rounded-full bg-[var(--primary)] mt-1.5 shrink-0" />}
            <button className="text-[var(--faint)] hover:text-error opacity-0 group-hover:opacity-100" onClick={(e) => { e.stopPropagation(); del(n); }}><Trash2 size={13} /></button>
          </Card>); })}
      </div> : <EmptyState icon={Bell} title={t('dash.notif.caughtUp', 'All caught up')}
        sub={t('dash.notif.caughtUpSub2', 'Anything that needs you, a repo going online or a report answered, lands here first.')}
        action={{ label: t('dash.notif.centre', 'Notification centre'), to: '/notifications', icon: BellRing }} />)}
    </div>
  );
}

// Gentle, dismissible prompt shown to any signed-in account WITHOUT 2FA: a password signup,
// a GitHub/Discord OAuth signup, and a normal login of an account that never enrolled. One
// tap goes to the 2FA setup; dismissal is per-device so it's never naggy.
//
// It used to sit behind a "Getting started" checklist (account, 2FA, first item, first
// Server-Repo) that was dismissed per device and shown to every account missing any of them.
// That checklist is now the first-run flow (onboarding.jsx), shown once to new accounts and
// customisable from the admin; the nudge is what everybody else, and a new account that has
// finished or skipped the flow, still gets.
const TWOFA_NUDGE_KEY = 'bcw_2fa_nudge_dismissed';
function TwoFactorNudge() {
  const { user } = useAuth(); const { t } = useI18n();
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(TWOFA_NUDGE_KEY) === '1'; } catch { return false; } });
  if (!user || user.totpEnabled || dismissed) return null;
  const hide = () => { setDismissed(true); try { localStorage.setItem(TWOFA_NUDGE_KEY, '1'); } catch {} };
  return (
    // A gradient and a border, not a translucent alpha on a variable: `tint-warning` is the
    // real class and it keeps working under the Translucent-surfaces setting.
    <Card className="p-4 tint-warning b-warning">
      <div className="flex items-start gap-3">
        <span className="grid place-items-center w-10 h-10 rounded-xl panel border border-[var(--line)] shrink-0"><ShieldCheck size={18} className="text-[var(--accent-ink)]" /></span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">{t('twofa.nudge.title', 'Don’t risk losing access to your account')}</div>
          {/* The reason is one tap away, not three lines under every dashboard. */}
          <Explain className="text-xs mt-0.5" summary={t('twofa.nudge.s', 'A second factor takes about a minute.')}>
            {t('twofa.nudge.d', 'A single leaked password could cost you your repos, submissions and payment history. Add a second factor: about a minute, and you stay in control.')}
          </Explain>
        </div>
        <button onClick={hide} className="text-[var(--faint)] hover:text-[var(--text)] p-1 shrink-0" title={t('twofa.nudge.later', 'Maybe later')}><X size={16} /></button>
      </div>
      {/* Full width on a phone, where a button beside a two-line title had nowhere to go. */}
      <Link to="/profile?setup2fa=1" className="block mt-3 sm:inline-block sm:mt-2"><Button size="sm" variant="primary" className="w-full sm:w-auto justify-center"><ShieldCheck size={14} /> {t('twofa.nudge.setup', 'Set up')}</Button></Link>
    </Card>
  );
}

// Card-payment-terminal (TPE) illustration, tinted by outcome. `ok` → the terminal
// shows an approved slip + green check; else a declined slip + amber cross.
function PaymentTerminal({ ok }) {
  const a1 = ok ? '#34d399' : '#f87171';
  const a2 = ok ? '#059669' : '#dc2626';
  const g = ok ? 'ptok' : 'ptfail';
  return (
    <svg viewBox="0 0 240 210" width="150" height="132" className="mx-auto" role="img" aria-hidden="true">
      <defs>
        <linearGradient id={`${g}-body`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--surface-2)" /><stop offset="1" stopColor="var(--bg-solid)" /></linearGradient>
        <linearGradient id={`${g}-acc`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={a1} /><stop offset="1" stopColor={a2} /></linearGradient>
        {/* userSpaceOnUse + r=100 centred at (120,100) so the glow fades fully to 0
            BEFORE the svg edges — an objectBoundingBox radial was still non-zero at
            the rect boundary, which showed as a hard-cut rectangle around the icon. */}
        <radialGradient id={`${g}-glow`} gradientUnits="userSpaceOnUse" cx="120" cy="100" r="100"><stop offset="0" stopColor={a1} stopOpacity="0.28" /><stop offset="0.6" stopColor={a1} stopOpacity="0.1" /><stop offset="1" stopColor={a1} stopOpacity="0" /></radialGradient>
      </defs>
      <rect x="0" y="0" width="240" height="210" fill={`url(#${g}-glow)`} />
      {/* handheld terminal, slightly tilted for depth */}
      <g transform="rotate(-6 120 120)">
        <rect x="74" y="52" width="92" height="130" rx="17" fill={`url(#${g}-body)`} stroke="var(--line-strong)" strokeWidth="2" />
        {/* screen */}
        <rect x="86" y="64" width="68" height="40" rx="6" fill="#0b1220" />
        <g stroke={a1} strokeWidth="2.6" fill="none" strokeLinecap="round" opacity="0.95"><path d="M104 84 a10 10 0 0 1 0 12" /><path d="M110 80 a17 17 0 0 1 0 20" /></g>
        <rect x="122" y="81" width="24" height="4" rx="2" fill={a1} opacity="0.85" />
        <rect x="122" y="90" width="16" height="4" rx="2" fill="#475569" />
        {/* rounded keypad keys */}
        {[0, 1, 2].map((r) => [0, 1, 2].map((c) => (
          <rect key={`${r}-${c}`} x={90 + c * 24} y={116 + r * 18} width="17" height="12" rx="3.5" fill="var(--line-strong)" />
        )))}
      </g>
      {/* card tapped on top (contactless) */}
      <g transform="rotate(11 152 58)">
        <rect x="120" y="32" width="66" height="43" rx="8" fill={`url(#${g}-acc)`} />
        <rect x="120" y="45" width="66" height="9" fill="#0b1220" opacity="0.32" />
        <rect x="128" y="40" width="13" height="10" rx="2" fill="#fde68a" />
        <rect x="128" y="62" width="28" height="5" rx="2.5" fill="#fff" opacity="0.9" />
      </g>
      {/* outcome badge with a clean ring */}
      <g transform="translate(170 152)">
        <circle r="26" fill="var(--bg-solid)" />
        <circle r="21" fill={`url(#${g}-acc)`} />
        {ok
          ? <path d="M-9 1 l6 6 l12 -13" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          : <path d="M-7 -7 l14 14 M7 -7 l-14 14" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" />}
      </g>
    </svg>
  );
}

function PaymentResultModal({ result, onClose, onDelivered }) {
  const { t } = useI18n();
  const toast = useToast();
  const ok = result?.ok;
  const kind = result?.kind;
  const failed = result?.failed;             // true = payment failed (declined), vs plain cancel
  const [inv, setInv] = useState(null);       // most-recent Stripe invoice (for the real PDF)
  const [pay, setPay] = useState(null);       // fallback: local payment row (amount display)
  const [linking, setLinking] = useState(false);
  // Marketplace: the return URL proves nothing. `?market=ok` only means Stripe sent the buyer
  // back; the webhook is what delivers, and it can land a beat after the redirect — or, if the
  // API was down, minutes later via the reconciler. So this polls the read-only status route
  // until it reads `delivered`, and says "confirming" rather than "confirmed" until then.
  // 'confirming' → 'delivered' | 'failed' | 'timeout' (still pending after ~45 s: nothing is
  // lost, the purchase appears in "What you bought" once the webhook or reconciler finishes).
  const sessionId = kind === 'market' && result?.sessionId ? String(result.sessionId) : null;
  const [confirm, setConfirm] = useState(sessionId ? 'confirming' : null);
  const [purchase, setPurchase] = useState(null);
  const [reveal, setReveal] = useState(false);
  useEffect(() => {
    if (!sessionId) return undefined;
    let tries = 0, cancelled = false;
    const poll = async () => {
      try {
        const r = await api.get(`/marketplace/checkout/${encodeURIComponent(sessionId)}/status`);
        if (cancelled) return;
        if (r?.status === 'delivered') { setPurchase(r.purchase || null); setConfirm('delivered'); onDelivered?.(); return; }
        if (r?.status === 'failed') { setConfirm('failed'); return; }
      } catch { /* 404 = the ledger row can lag the redirect by a moment; keep polling */ }
      if (cancelled) return;
      if (tries++ < 30) setTimeout(poll, 1500); else setConfirm('timeout');
    };
    poll();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);
  const confirming = confirm === 'confirming';
  const settled = !confirm || confirm === 'delivered';   // the invoice block only makes sense once the sale exists
  // The webhook + Stripe invoice can land a beat after the redirect — poll briefly so
  // "Download invoice" lights up once the real invoice exists.
  useEffect(() => {
    if (!ok) return;
    let tries = 0, cancelled = false;
    const poll = async () => {
      try {
        const [iv, r] = await Promise.all([api.get('/me/invoices').catch(() => null), api.get('/me/payments').catch(() => null)]);
        const latestInv = iv?.invoices?.[0]; const latestPay = r?.payments?.[0];
        if (!cancelled && (latestInv || latestPay)) { setInv(latestInv || null); setPay(latestPay || null); if (latestInv) return; }
      } catch {}
      if (tries++ < 6 && !cancelled) setTimeout(poll, 1500);
    };
    poll();
    return () => { cancelled = true; };
  }, [ok]);
  const downloadInvoice = async () => {
    setLinking(true);
    try {
      if (inv?.hasPdf) {
        // Real download through the API (attachment, correct filename).
        const res = await fetch(`/api/me/invoices/${inv.id}/pdf`); const blob = await res.blob();
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `invoice-${inv.number}.pdf`;
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      } else if (pay) {
        const link = await api.get(`/me/payments/${pay.id}/stripe-link`).catch(() => null);
        const url = link?.pdf || link?.hosted || link?.receipt;
        if (url) window.open(url, '_blank', 'noopener');
      }
    } finally { setLinking(false); }
  };
  const src = inv || pay;
  const amount = src ? (() => { const c = inv ? inv.amountCents : pay.amountCents; const cur = (src.currency || 'usd').toUpperCase(); const sym = cur === 'USD' ? '$' : cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : ''; return sym ? `${sym}${(c / 100).toFixed(2)}` : `${(c / 100).toFixed(2)} ${cur}`; })() : null;
  const canDl = (inv?.hasPdf) || !!pay;
  return (
    <Modal open onClose={onClose} title="" width="max-w-sm"
      footer={<>
        {ok && settled && <Button variant="ghost" disabled={!canDl || linking} onClick={downloadInvoice}>{linking ? <Spinner /> : <><Download size={15} /> {t('dash.pay.dl', 'Download invoice')}</>}</Button>}
        <Button variant="primary" onClick={onClose}>{confirm === 'failed' ? t('dash.pay.retry', 'Try again') : confirming || confirm === 'timeout' ? t('common.close', 'Close') : ok ? t('dash.pay.done', 'Done') : t('dash.pay.retry', 'Try again')}</Button>
      </>}>
      <div className="text-center pt-2 pb-1">
        <PaymentTerminal ok={ok && confirm !== 'failed'} />
        <div className={`text-xl font-extrabold mt-3 ${failed || confirm === 'failed' ? 'text-error' : ''}`}>
          {confirming ? <span className="inline-flex items-center gap-2"><Spinner /> {t('dash.pay.confirm.t', 'Confirming your payment')}</span>
            : confirm === 'timeout' ? t('dash.pay.timeout.t', 'Still confirming')
            : confirm === 'failed' ? t('dash.pay.fail.t', 'Payment failed')
            : ok ? t('dash.pay.ok.t', 'Payment confirmed') : failed ? t('dash.pay.fail.t', 'Payment failed') : t('dash.pay.cancel.t', 'Checkout cancelled')}
        </div>
        <p className="text-sm text-[var(--muted)] mt-1.5 max-w-xs mx-auto" aria-live="polite">
          {confirming ? t('dash.pay.confirm.m', 'Stripe is telling us the payment went through. This usually takes a few seconds, please keep this page open.')
            : confirm === 'timeout' ? t('dash.pay.timeout.m', 'The confirmation is taking longer than usual. Nothing is lost: if the payment was taken, your purchase appears in “What you bought” within a few minutes, and you will get a notification. If it was not, no charge was made.')
            : confirm === 'failed' ? t('dash.pay.expired.m', 'The checkout expired before it was paid, no charge was made. You can try again anytime.')
            : confirm === 'delivered' ? t('dash.pay.delivered.m', 'Delivered. Here is what you bought, it also stays in “What you bought”, below.')
            : ok
            ? (kind === 'market' ? t('dash.pay.market.m', 'Your purchase is in “What you bought”, below, with the key or content it came with.') : kind === 'feature' ? t('dash.pay.feature.m', 'Your repo is now featured on the public listing.') : t('dash.pay.hosting.m', "Your repo is being provisioned, it'll be online shortly."))
            : failed ? t('dash.pay.fail.m', 'The payment could not be completed, no charge was made. Check your card details and try again.')
            : t('dash.pay.cancel.m', 'No charge was made. You can try again anytime.')}
        </p>
        {confirm === 'delivered' && purchase && (() => {
          const d = purchase.delivery && typeof purchase.delivery === 'object' ? purchase.delivery : {};
          const secret = d.key || d.content || '';
          return (
            <div className="mt-4 rounded-xl border border-[var(--line)] panel px-4 py-3 text-start text-sm max-w-xs mx-auto space-y-2">
              <div className="font-medium truncate">{purchase.name || t('dash.pay.marketitem', 'Marketplace purchase')}</div>
              {d.error
                ? <div className="text-xs text-error flex items-start gap-1.5"><AlertTriangle size={13} className="shrink-0 mt-px" /> {t('mkme.failed', 'Paid, but delivery did not complete. Contact the project, your payment is on record.')}</div>
                : secret ? (<>
                  {/* Covered until asked for, like "What you bought": the buyer may not be alone in front of the screen. */}
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => setReveal((v) => !v)}>{reveal ? t('mkme.hide', 'Hide') : t('mkme.reveal', 'Reveal')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => { copyText(secret); toast.success(t('common.copied', 'Copied.')); }}>{t('common.copy', 'Copy')}</Button>
                  </div>
                  {reveal && <pre className="text-xs font-mono whitespace-pre-wrap break-all rounded-md bg-[var(--bg-solid)] border border-[var(--line)] px-2.5 py-2">{secret}</pre>}
                </>)
                : d.role ? <div className="text-xs text-[var(--muted)]">{t('mkme.role', 'Delivered as a Discord role.')}</div>
                : d.url ? <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--accent-ink)] hover:underline">{t('dash.pay.openlink', 'Open the link you bought')}</a>
                : d.fileKey ? <div className="text-xs text-[var(--muted)]">{t('dash.pay.file', 'Your file is ready, download it from “What you bought”, below.')}</div>
                : <div className="text-xs text-[var(--faint)]">{t('mkme.nothing', 'Nothing to reveal for this one.')}</div>}
              {purchase.redeemUrl && <a href={purchase.redeemUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--accent-ink)] hover:underline block">{t('dash.pay.redeem', 'Where to use it')}</a>}
              {purchase.redeemNote && <div className="text-[11px] text-[var(--faint)]">{purchase.redeemNote}</div>}
            </div>
          );
        })()}
        {ok && settled && (() => {
          const lines = inv?.lines || [];
          const money2 = (c) => { const cur = (inv?.currency || pay?.currency || 'usd').toUpperCase(); const sym = cur === 'USD' ? '$' : cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : ''; return sym ? `${sym}${(c / 100).toFixed(2)}` : `${(c / 100).toFixed(2)} ${cur}`; };
          const single = pay?.description || (kind === 'market' ? t('dash.pay.marketitem', 'Marketplace purchase') : kind === 'feature' ? t('dash.pay.boost', 'Repo boost') : t('dash.pay.hostingitem', 'Repo hosting'));
          return (
          <div className="mt-4 rounded-xl border border-[var(--line)] panel px-4 py-3 text-start text-sm max-w-xs mx-auto">
            {inv?.number && (
              <div className="flex items-center justify-between gap-3 mb-1.5 pb-1.5 border-b border-[var(--line)]">
                <span className="text-[var(--faint)]">{t('dash.pay.invoice', 'Invoice №')}</span>
                <span className="font-mono text-xs">{inv.number}</span>
              </div>
            )}
            {lines.length > 1 ? (
              <details open className="group/items">
                <summary className="flex items-center justify-between gap-3 cursor-pointer select-none list-none">
                  <span className="text-[var(--faint)] flex items-center gap-1"><ChevronDown size={13} className="transition-transform group-open/items:rotate-180" /> {t('dash.pay.items', '{n} items').replace('{n}', lines.length)}</span>
                  <span className="font-semibold tabular-nums">{amount || money2(lines.reduce((s, l) => s + l.amountCents, 0))}</span>
                </summary>
                <div className="mt-2 space-y-1">
                  {lines.map((l, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 text-[13px]">
                      <span className="truncate text-[var(--muted)]" title={l.description}>{l.description}</span>
                      <span className="tabular-nums shrink-0 text-[var(--faint)]">{money2(l.amountCents)}</span>
                    </div>
                  ))}
                </div>
              </details>
            ) : (<>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[var(--faint)]">{t('dash.pay.item', 'Item')}</span>
                <span className="font-medium truncate">{lines[0]?.description || single}</span>
              </div>
              <div className="flex items-center justify-between gap-3 mt-1.5">
                <span className="text-[var(--faint)]">{t('dash.pay.amount', 'Amount')}</span>
                <span className="font-semibold tabular-nums">{amount || <span className="text-[var(--faint)]">{t('dash.pay.processing', 'processing…')}</span>}</span>
              </div>
            </>)}
            <div className="text-[11px] text-[var(--faint)] mt-2 flex items-center gap-1"><Info size={11} /> {t('dash.pay.receipt', 'A receipt is available in the Billing tab.')}</div>
          </div>
          );
        })()}
      </div>
    </Modal>
  );
}

// What you bought in a project's marketplace — the half of that feature that was missing.
//
// GET /marketplace/my-purchases has existed since the marketplace shipped and NOTHING ever
// called it. A buyer saw their key or content once, in the response to the purchase, and then
// had no way back to it: not on the project page, not here, nowhere. For a PAID product it was
// worse than that — delivery happens in the Stripe webhook, so the buyer never saw it at all.
//
// Renders nothing when there are no purchases, so it costs an ordinary dashboard nothing.
function MyPurchases({ refreshKey = 0 }) {
  const { t } = useI18n();
  const toast = useToast();
  const { data, loading } = useAsync(() => api.get('/marketplace/my-purchases').catch(() => null), [refreshKey]);
  const [shown, setShown] = useState({});   // purchase id -> revealed?
  const rows = data?.purchases || [];
  if (loading || !rows.length) return null;
  // A key is a secret in a screenshot. It stays covered until asked for, the way the
  // giveaway inventory covers a prize — the person already owns it, they just may not be
  // alone in front of the screen.
  const secretOf = (d) => (d && typeof d === 'object' ? (d.key || d.content || '') : '');
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <ShoppingBag size={15} className="text-[var(--accent-ink)]" />
        <span className="font-medium text-sm">{t('mkme.title', 'What you bought')}</span>
        <Badge tone="">{rows.length}</Badge>
      </div>
      <div className="space-y-2">
        {rows.map((r) => {
          const secret = secretOf(r.delivery);
          const role = r.delivery && typeof r.delivery === 'object' ? r.delivery.role : '';
          // The webhook stores `{ error: 'delivery_failed' }` when fulfilment threw AFTER the
          // money was taken — the pool ran out between checkout and the webhook, the external
          // key service was down. That is the one case a buyer must not be left to work out
          // from an empty row, so it says so and says what to do.
          const failed = r.delivery && typeof r.delivery === 'object' ? r.delivery.error : '';
          return (
            <div key={r.id} className="rounded-lg panel px-3 py-2.5">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{r.name || t('mkme.unnamed', 'Product')}</div>
                  <div className="text-[11px] text-[var(--faint)]">{new Date(r.createdAt).toLocaleString()}{r.status !== 'paid' ? ` · ${r.status}` : ''}</div>
                </div>
                {secret && (
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => setShown((v) => ({ ...v, [r.id]: !v[r.id] }))}>
                      {shown[r.id] ? t('mkme.hide', 'Hide') : t('mkme.reveal', 'Reveal')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { copyText(secret); toast.success(t('common.copied', 'Copied.')); }}>
                      {t('common.copy', 'Copy')}
                    </Button>
                  </div>
                )}
              </div>
              {secret && shown[r.id] && (
                <pre className="mt-2 text-xs font-mono whitespace-pre-wrap break-all rounded-md bg-[var(--bg-solid)] border border-[var(--line)] px-2.5 py-2">{secret}</pre>
              )}
              {/* A role has nothing to reveal — saying so beats a row that looks broken. */}
              {failed
                ? <div className="text-xs text-error mt-1.5 flex items-start gap-1.5"><AlertTriangle size={13} className="shrink-0 mt-px" /> {t('mkme.failed', 'Paid, but delivery did not complete. Contact the project, your payment is on record.')}</div>
                : !secret && role ? <div className="text-xs text-[var(--muted)] mt-1">{t('mkme.role', 'Delivered as a Discord role.')}</div>
                : !secret ? <div className="text-xs text-[var(--faint)] mt-1">{t('mkme.nothing', 'Nothing to reveal for this one.')}</div>
                : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// One heading per block, and the block does only what the heading says.
//
// The overview used to be a stack with nothing naming any of it: five stat cards (of which
// three were a breakdown of the other two), a shortcut row, an economy card and the
// notifications, in an order that answered no question. The headings are the fix — you
// cannot leave a block unnamed and still pretend it has one job.
// The section owns its heading and NOTHING else. It carries no margin of its own: the overview
// wraps every block in one `space-y-*`, because per-card margins are how a page ends up with
// 24px between two blocks and 32px between the next two for no reason anybody can name.
// `aside` is an optional control that belongs to the heading, on the same line, end-aligned.
function OverviewSection({ icon: Icon, title, aside, children }) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="font-semibold flex items-center gap-2 min-w-0">
          <Icon size={16} className="text-[var(--accent-ink)] shrink-0" /> <span className="truncate" title={title}>{title}</span>
        </h2>
        {aside ? <div className="ms-auto shrink-0">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

// Everything that is WAITING on this person, as one row of chips: an item still in review, an
// unanswered poll, a message with no reply, a purchase an admin has not handed out. Each chip
// is a link to the tab that clears it.
//
// It renders nothing at all when nothing is pending, which is most days — a heading over "you
// have nothing to do" is worse than no heading. The counts come from fetches the page already
// makes for the sidebar badges, so this costs no extra request.
function WaitingOnYou({ pending, pollsOpen, threadsUnread, deliveries }) {
  const { t } = useI18n();
  const chips = [
    pending > 0 && { key: 'items', to: '/dashboard?s=items', icon: Clock, label: t('dash.wait.review', '{n} waiting for review').replace('{n}', pending) },
    pollsOpen > 0 && { key: 'polls', to: '/dashboard?s=polls', icon: BarChart3, label: t('dash.wait.polls', '{n} poll(s) to answer').replace('{n}', pollsOpen) },
    threadsUnread > 0 && { key: 'threads', to: '/dashboard?s=reports', icon: MessageSquare, label: t('dash.wait.threads', '{n} unanswered message(s)').replace('{n}', threadsUnread) },
    deliveries > 0 && { key: 'eco', to: '/dashboard?s=economy', icon: Backpack, label: t('dash.wait.deliveries', '{n} purchase(s) to be handed out').replace('{n}', deliveries) },
  ].filter(Boolean);
  if (!chips.length) return null;
  return (
    <OverviewSection icon={Bell} title={t('dash.sec.wait', 'Waiting on you')}>
      <div className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <Link key={c.key} to={c.to} className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm tint-warning b-warning border press">
            <c.icon size={14} className="text-[var(--accent-ink)] shrink-0" />
            <span className="min-w-0 truncate" title={c.label}>{c.label}</span>
            <ArrowRight size={13} className="text-[var(--faint)] shrink-0" />
          </Link>
        ))}
      </div>
    </OverviewSection>
  );
}

export function Dashboard() {
  const { user } = useAuth(); const toast = useToast(); const nav = useNavigate(); const { t } = useI18n();
  const items = useAsync(() => api.get('/me/items'), []);
  const repos = useAsync(() => api.get('/me/repos'), []);
  const [editing, setEditing] = useState(null); // the item opened in the view/edit modal
  const cancelDelete = async (it) => { try { await api.post(`/catalog/${it.id}/delete/cancel`); toast.success(t('dash.delcancelled', 'Deletion cancelled.')); items.reload(); } catch { toast.error(t('dash.cancelfail', 'Failed to cancel.')); } };

  // Handle the return trip from a Stripe Checkout redirect (?hosting=ok/cancel, ?feature=ok/cancel).
  // Surfaces a prominent, dismissible confirmation/cancel banner (not just a toast).
  const [sp, setSp] = useSearchParams();
  const { active: introActive } = useIntro(); // hold the payment modal until the site intro finishes
  const [payReturn, setPayReturn] = useState(null); // { ok, kind, failed, sessionId } | null
  const [purchasesKey, setPurchasesKey] = useState(0); // bumped when the modal sees a delivery, so "What you bought" refetches
  useEffect(() => {
    const hosting = sp.get('hosting'); const feature = sp.get('feature'); const oauth = sp.get('oauth');
    // `market` was missing here, and the marketplace checkout sends the buyer back to
    // /dashboard?market=ok. So after paying for a product the buyer landed on an ordinary
    // dashboard: no confirmation, no key, nothing — for a PAID product, where delivery
    // happens in the webhook and the purchase screen is the only place the key is ever shown.
    const market = sp.get('market');
    if (!hosting && !feature && !oauth && !market) return;
    if (hosting === 'ok') { setPayReturn({ ok: true, kind: 'hosting' }); repos.reload(); items.reload(); try { localStorage.removeItem('bcw_cart'); } catch {} }
    else if (hosting === 'fail' || hosting === 'failed') { setPayReturn({ ok: false, failed: true, kind: 'hosting' }); }
    else if (hosting === 'cancel') { setPayReturn({ ok: false, kind: 'hosting' }); }
    if (feature === 'ok') { setPayReturn({ ok: true, kind: 'feature' }); repos.reload(); }
    else if (feature === 'fail' || feature === 'failed') { setPayReturn({ ok: false, failed: true, kind: 'feature' }); }
    else if (feature === 'cancel') { setPayReturn({ ok: false, kind: 'feature' }); }
    // The session id rides along so the modal can ask whether the webhook delivered — it is
    // never a grant (see GET /marketplace/checkout/:sessionId/status: read-only).
    if (market === 'ok') setPayReturn({ ok: true, kind: 'market', sessionId: sp.get('session_id') || null });
    else if (market === 'fail' || market === 'failed') setPayReturn({ ok: false, failed: true, kind: 'market' });
    else if (market === 'cancel') setPayReturn({ ok: false, kind: 'market' });
    if (oauth === 'success') toast.success(t('auth.welcome.toast', 'Welcome!'));
    setSp((p) => { const n = new URLSearchParams(p); n.delete('hosting'); n.delete('feature'); n.delete('oauth'); n.delete('market'); n.delete('session_id'); return n; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const list = items.data?.items || [];
  const rlist = repos.data?.repos || [];
  // My items — search + kind/status filters.
  const [itemQ, setItemQ] = useState('');
  const [itemKind, setItemKind] = useState('all');
  const [itemStatus, setItemStatus] = useState('all');
  const iq = itemQ.trim().toLowerCase();
  const filteredItems = list.filter((it) =>
    (!iq || it.name?.toLowerCase().includes(iq))
    && (itemKind === 'all' || it.kind === itemKind)
    && (itemStatus === 'all' || (itemStatus === 'deleting' ? !!it.deleteAt : it.status === itemStatus)));
  // Two things you own, not five numbers. "Published" and "Pending" were separate cards
  // sitting next to "Items", which is their sum — three cards for one fact. They are the
  // breakdown OF the items card, so they live inside it, in a line you read after the number
  // rather than beside it. Same for "Featured" and the repos. Each card is now also a link to
  // the tab that number belongs to: the old ones were a dead end.
  const published = list.filter((i) => i.status === 'PUBLISHED').length;
  const pending = list.filter((i) => i.status === 'PENDING').length;
  const featured = rlist.filter((r) => r.featuredUntil && new Date(r.featuredUntil) > new Date()).length;
  // A card with a zero on it is an empty state, and an empty state that does not say what the
  // thing is and where the button is is just a zero. So each card carries a second shape: at
  // zero it stops linking to a list of nothing and links to the page that FILLS it, with the
  // sentence that says what "items" or "repos" even are.
  const owned = [
    {
      icon: Package, label: t('dash.items', 'Items'), value: list.length,
      to: list.length ? '/dashboard?s=items' : '/submit',
      detail: list.length
        ? t('dash.own.items', '{p} published, {n} waiting for review').replace('{p}', published).replace('{n}', pending)
        : t('dash.own.items0', 'Apps, plugins, themes and presets you submit'),
      cta: t('sub.title', 'Submit content'),
      warn: pending > 0,
    },
    {
      icon: Server, label: t('dash.repos', 'Repos'), value: rlist.length,
      to: rlist.length ? '/dashboard?s=repos' : '/hosting#plans',
      detail: rlist.length
        ? (featured ? t('dash.own.repos', '{n} featured right now').replace('{n}', featured) : t('dash.own.repos0', 'None featured right now'))
        : t('dash.own.repos1', 'Where BMM users download your files from'),
      cta: t('dash.hostrepo', 'Host a repo'),
    },
  ];
  // How many polls are still waiting on this person, for the sidebar badge. `.catch` because
  // a badge is not worth taking the dashboard down for, and a missing number simply hides it.
  const { data: pollMe } = useAsync(() => api.get('/me/polls').catch(() => null), []);
  const pollsOpen = pollMe?.open?.length || 0;
  // Unanswered messages about my repos, catalogues, teams and profile — same rule as the polls.
  const { data: inbox } = useAsync(() => api.get('/me/threads').catch(() => null), []);
  // Plus report threads with a staff reply not yet seen: the same tab lists both, and a
  // badge that counted only one of them hid the other. Shared with the topbar's poll.
  const reportsUnseen = useReportsUnseen(true);
  const threadsUnread = (inbox?.unread || 0) + (reportsUnseen.mine || 0);

  // B10: the "My Discord servers" tab only appears for people who actually manage a server the
  // bot is in — resolved server-side from their linked Discord account(s). `.catch` so a badge
  // fetch never takes the dashboard down; no guilds → no tab, no clutter for everyone else.
  const { data: discordMe } = useAsync(() => api.get('/me/discord/guilds').catch(() => null), []);
  const discordGuilds = discordMe?.guilds?.length || 0;
  // The Discord economy: the shop tab exists only once the admins turned the system on.
  const { data: ecoMe } = useAsync(() => api.get('/me/economy').catch(() => null), []);
  const [ecoView, setEcoView] = useState('shop');

  // Quick actions — no "Write a post" here (that lives in the Blog for staff).
  const actions = [
    { icon: Upload, label: t('sub.title', 'Submit content'), to: '/submit' },
    { icon: Cloud, label: t('dash.hostrepo', 'Host a repo'), to: '/hosting#plans' },
    { icon: LayoutGrid, label: t('dash.browse', 'Browse catalog'), to: '/catalog?project=bmm' },
    { icon: UserCog, label: t('dash.editprofile', 'Edit profile'), to: '/profile' },
  ];
  const tabs = [
    { id: 'overview', label: t('dash.overview', 'Overview'), icon: LayoutDashboard },
    // A count of what you own is a quiet number with a title that says so; only the polls
    // (and a pending delivery) are something WAITING on you, and only those get the accent.
    { id: 'items', label: t('dash.myitems', 'My items'), icon: Package, badge: list.length || undefined, badgeKind: 'count', badgeTitle: t('dash.badge.items', '{n} item(s) you submitted').replace('{n}', list.length) },
    { id: 'catalogs', label: t('dash.mycatalogs', 'My catalogs'), icon: Boxes },
    { id: 'repos', label: t('dash.myrepos', 'My repos'), icon: Server, badge: rlist.length || undefined, badgeKind: 'count', badgeTitle: t('dash.badge.repos', '{n} repo(s) you own').replace('{n}', rlist.length) },
    // Always shown, not only when the user already has servers: the tab is also how someone
    // with zero servers reaches the "Invite the bot" screen in the first place. The badge is
    // the guild count when there is one.
    { id: 'discord', label: t('dash.discord', 'Discord servers'), icon: Bot, badge: discordGuilds || undefined, badgeKind: 'count', badgeTitle: t('dash.badge.discord', '{n} server(s) you manage').replace('{n}', discordGuilds) },
    ...(ecoMe?.enabled ? [{ id: 'economy', label: t('dash.economy', 'Shop & inventory'), icon: ShoppingBag, badge: ecoMe.pendingDeliveries || undefined, badgeTitle: t('dash.badge.eco', '{n} purchase(s) waiting to be handed out').replace('{n}', ecoMe.pendingDeliveries || 0) }] : []),
    { id: 'starred', label: t('dash.starred', 'Starred'), icon: Star },
    // The badge counts what is still WAITING, not what has been answered — a number that
    // goes down as you use it, rather than one that only ever grows and stops meaning anything.
    { id: 'polls', label: t('dash.polls', 'Polls'), icon: BarChart3, badge: pollsOpen || undefined, badgeTitle: t('dash.badge.polls', '{n} poll(s) waiting for your answer').replace('{n}', pollsOpen) },
    { id: 'billing', label: t('dash.billing', 'Billing'), icon: Receipt },
    { id: 'reports', label: t('dash.reports', 'Messages & reports'), icon: MessageSquare, badge: threadsUnread || undefined, badgeTitle: t('dash.badge.threads', '{n} unanswered message(s)').replace('{n}', threadsUnread) },
    { id: 'teams', label: t('dash.teams', 'Teams'), icon: UsersIcon },
    { id: 'data', label: t('dash.mydata', 'Your data'), icon: HardDriveDownload },
  ];
  return (
    <>
      {payReturn && !introActive && <PaymentResultModal result={payReturn} onClose={() => setPayReturn(null)} onDelivered={() => setPurchasesKey((k) => k + 1)} />}
      <SideDash icon={LayoutDashboard} title={t('dash.hi', 'Hi, {name}').replace('{name}', user?.displayName || 'there')} subtitle={t('dash.sub', 'Manage your content, repos and billing.')} tabs={tabs}
        headerActions={<Link to="/submit"><Button variant="primary"><Upload size={16} /> {t('sub.title', 'Submit content')}</Button></Link>}>
        {(s) => (<>
          {/* The overview, in the order somebody actually reads it:
              ① what is waiting on them, ② what just happened, ③ what they own, ④ what they can
              start, ⑤ the record (Discord level, purchases). Anything that is merely true comes
              after everything that needs a decision.

              The spacing is ONE rule for the whole tab — `space-y-6`, or `space-y-8` from sm up
              — instead of an mb-6 here and an mb-8 there. It also means a block that renders
              null (the transfers card on any ordinary day, the waiting rail when nothing is
              pending) leaves no gap behind it, which a wrapping <div className="mb-6"> would. */}
          {s === 'overview' && <div className="space-y-6 sm:space-y-8">
            {/* A pending ownership transfer is a DECISION with a deadline, and it lived only on
                the profile page: reachable from the e-mail's link and from nowhere anybody goes.
                Somebody who missed the mail had no way to discover it before it expired.

                The same component the profile renders, not a second copy: accepting moves real
                ownership, and two renderings of that would eventually disagree about what the
                button does. It hides itself when nothing is pending. */}
            <TransfersCard />

            <WaitingOnYou pending={pending} pollsOpen={pollsOpen} threadsUnread={threadsUnread} deliveries={ecoMe?.pendingDeliveries || 0} />

            {/* The first-run flow (onboarding.jsx), shown once to a new account; when there is
                none to show (older accounts, or finished), the standalone 2FA nudge. */}
            <OnboardingSlot fallback={<TwoFactorNudge />} />

            {/* Two columns from lg, and the reading order is unchanged at every width.
                Measured at 1280: the overview was six full-width bands in an 876px column,
                1205px of content stacked vertically with each band using a third of its own
                width — four chips across 876px, two tiles across 876px — so "What you own"
                began at y=826, below the fold of a 900px window, under onboarding and the
                notification list. The rail carries what is merely NEWS (the notifications)
                beside the two blocks you came for, instead of above them.

                `lg:col-start-*` / `lg:row-start-1` rather than DOM order: on a phone this is
                one column and the source order is the reading order (what just happened, then
                what you own), which is the order the previous pass settled on and which the
                two-column version must not quietly reverse. */}
            <div className="grid gap-6 sm:gap-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
              {/* NotificationsPanel writes its own heading (it needs the unread badge and the
                  mark-all / clear / centre controls beside it), so it is not wrapped. */}
              <aside className="min-w-0 lg:col-start-2 lg:row-start-1">
                <NotificationsPanel />
              </aside>

              <div className="min-w-0 space-y-6 sm:space-y-8 lg:col-start-1 lg:row-start-1">
            <OverviewSection icon={Boxes} title={t('dash.sec.own', 'What you own')}>
              {/* One column on a phone. Two 3xl numbers side by side at 360px left the caption
                  under each of them breaking every second word; the row shape (number, label,
                  then the detail sentence with the full width to itself) reads at any size and
                  still pairs up from sm. */}
              <div className="grid gap-3 sm:grid-cols-2">
                {owned.map((o) => (
                  <Link key={o.label} to={o.to} className="card card-hover p-4 flex items-center gap-4">
                    <span className="grid place-items-center w-11 h-11 rounded-xl panel shrink-0"><o.icon size={18} className="text-[var(--accent-ink)]" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-bold tabular-nums leading-none">{o.value}</span>
                        <span className="text-sm font-medium truncate" title={o.label}>{o.label}</span>
                      </div>
                      <div className={`text-[11px] mt-1 ${o.warn ? 'text-warning' : 'text-[var(--muted)]'}`}>{o.detail}</div>
                      {/* At zero the card IS the empty state, so it names its own button
                          rather than pointing at a list with nothing in it. */}
                      {!o.value && <div className="text-[11px] mt-1 text-[var(--accent-ink)] font-medium inline-flex items-center gap-1">{o.cta} <ArrowRight size={12} /></div>}
                    </div>
                    {!!o.value && <ArrowRight size={15} className="text-[var(--faint)] shrink-0" />}
                  </Link>
                ))}
              </div>
            </OverviewSection>

            <OverviewSection icon={Zap} title={t('dash.sec.do', 'Start something')}>
              {/* Two columns at every width, not four from lg: this block now lives in the
                  552px main column, where four tiles would be 126px each and "Submit content"
                  does not fit in 126px. Two of them pair with the two cards above, so the
                  column reads as one 2x2 board. */}
              <div className="grid grid-cols-2 gap-3">
                {actions.map((a) => (
                  <Link key={a.label} to={a.to} className="card card-hover p-4 flex items-center gap-2.5">
                    <span className="grid place-items-center w-9 h-9 rounded-lg bg-gradient-to-br from-brand to-brand-2 shrink-0"><a.icon size={16} className="text-white" /></span>
                    <span className="text-sm font-medium min-w-0">{a.label}</span>
                  </Link>
                ))}
              </div>
            </OverviewSection>
              </div>
            </div>

            {/* The record, not a task: what Discord has earned and what has been bought.
                The condition below is EconomyWidget's own, re-evaluated on the copy of
                /me/economy this page already holds. An OverviewSection renders its heading
                unconditionally, so wrapping a self-hiding child in one is exactly how you end
                up with a title over nothing. */}
            {!!ecoMe?.enabled && !(ecoMe.level === 0 && ecoMe.xp === 0) && (
              <OverviewSection icon={Coins} title={t('dash.sec.eco', 'Your Discord level')}
                aside={<Link to="/dashboard?s=economy" className="text-xs text-[var(--accent-ink)] inline-flex items-center gap-1">{t('dash.sec.eco.a', 'Shop')} <ArrowRight size={12} /></Link>}>
                <EconomyWidget onOpenShop={(v) => { setEcoView(v); nav('/dashboard?s=economy'); }} />
              </OverviewSection>
            )}

            {/* MyPurchases titles its own card and renders null when there is nothing bought,
                so it needs no heading from here. */}
            <MyPurchases refreshKey={purchasesKey} />

            {/* M11: titles its own card, and renders null when the landing shows no reviews
                and the member has none. */}
            <MyReviewCard />
          </div>}
          {s === 'items' && <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold flex items-center gap-2"><Package size={16} /> {t('dash.myitems', 'My items')}</h2>
              <Link to="/submit"><Button size="sm"><Upload size={14} /> {t('dash.new', 'New')}</Button></Link>
            </div>
            {list.length > 3 && (
              <div className="flex flex-wrap gap-2 mb-3">
                <div className="relative flex-1 min-w-[160px]"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)] pointer-events-none" />
                  <Input className="!ps-8 !py-1.5 !text-sm" placeholder={t('dash.search', 'Search my items…')} value={itemQ} onChange={(e) => setItemQ(e.target.value)} /></div>
                <Select className="!w-auto !py-1.5 !text-sm" value={itemKind} onChange={(e) => setItemKind(e.target.value)}>
                  <option value="all">{t('dash.allkinds', 'All kinds')}</option><option value="APP">APP</option><option value="PLUGIN">PLUGIN</option><option value="THEME">THEME</option><option value="PRESET">PRESET</option></Select>
                <Select className="!w-auto !py-1.5 !text-sm" value={itemStatus} onChange={(e) => setItemStatus(e.target.value)}>
                  <option value="all">{t('dash.allstatus', 'All statuses')}</option><option value="PUBLISHED">Published</option><option value="PENDING">Pending</option><option value="REJECTED">Rejected</option><option value="SUSPENDED">Suspended</option><option value="deleting">Deleting</option></Select>
              </div>
            )}
            {items.loading ? <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}</div> : (list.length ? (filteredItems.length ? <div className="space-y-2">
              {filteredItems.map((it) => { const I = KIND_ICON[it.kind] || Package; const v = it.kind === 'PLUGIN' ? it.meta?.validation : null; return (
                <Card key={it.id} className="p-4 flex items-center gap-3">
                  <I size={18} className="text-[var(--accent-ink)] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate" title={it.name}>{it.name}</div>
                    <div className="text-xs text-[var(--faint)] flex items-center gap-2 flex-wrap">
                      <span>{it.kind} · v{it.version}</span>
                      {it.payloadKey && !it.meta?.download_url && <span className="text-[var(--accent-ink)]">· {t('dash.hostedhere', 'hosted here')}</span>}
                      {v && (v.valid ? <span className="text-success flex items-center gap-1"><BadgeCheck size={12} /> {t('dash.verified', 'verified')}</span> : <span className="text-error flex items-center gap-1"><XCircle size={12} /> {t('dash.invalid', 'invalid')}</span>)}
                    </div>
                    {/* Public listing needs admin validation; until then the item is private
                        but the owner can always share its own direct link (like a repo). */}
                    {(() => {
                      const isPub = it.status === 'PUBLISHED';
                      const link = isPub ? `${location.origin}/item/${it.slug}` : (it.shareKey ? `${location.origin}/item/${it.slug}?k=${it.shareKey}` : null);
                      if (!link || it.deleteAt) return null;
                      return (
                        <button onClick={() => { copyText(link); toast.success(isPub ? t('dash.pubcopied', 'Public link copied.') : t('dash.privcopied', 'Private share link copied.')); }}
                          className="mt-1 inline-flex items-center gap-1 text-[11px] text-[var(--faint)] hover:text-[var(--accent-ink)] transition" title={link}>
                          {isPub ? <Globe size={11} /> : <Lock size={11} />} {isPub ? t('dash.copypublic', 'Copy public link') : t('dash.copyprivate', 'Copy private link')}
                        </button>
                      );
                    })()}
                    {it.status === 'SUSPENDED' && <div className="text-[11px] text-error mt-0.5">{t('dash.suspendednote', 'Suspended by an admin, you can’t edit or resubmit it. Contact support to appeal.')}</div>}
                  </div>
                  {it.deleteAt
                    ? <><Badge tone="red"><Trash2 size={11} /> {t('dash.deletingin', 'Deleting in')} {fmtRemaining(it.deleteAt)}</Badge>
                        <Button size="sm" variant="ghost" onClick={() => cancelDelete(it)}>{t('common.cancel', 'Cancel')}</Button></>
                    : <><Badge tone={statusTone(it.status)}>{it.status}</Badge>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(it)}><PenSquare size={14} /> <span className="hidden sm:inline">{t('dash.viewedit', 'View / edit')}</span></Button></>}
                </Card>); })}
            </div> : <div className="text-sm text-[var(--muted)] py-8 text-center">{t('dash.nomatch', 'No items match your filters.')}</div>)
              : <EmptyState icon={Inbox} title={t('dash.noitems', 'No items yet')} sub={t('dash.noitems.s', 'Submit your first app, plugin, theme or preset.')}>
              <Link to="/submit"><Button variant="primary"><Upload size={15} /> {t('sub.title', 'Submit content')}</Button></Link></EmptyState>)}
          </div>}

          {s === 'catalogs' && <OwnerCatalogs />}
          {s === 'repos' && <MyRepos />}
          {s === 'discord' && <MyDiscordServers />}
          {s === 'starred' && <Starred />}
          {s === 'economy' && <EconomyShop view={ecoView} onView={setEcoView} />}
          {s === 'polls' && <MyPolls />}
          {s === 'billing' && <Billing />}
          {/* Three blocks, one spacing rule (the overview's), one card shape.
              They used to sit in a bare fragment: "Messages & reports" touched the bottom edge
              of the Conversations card (0 px), and being the only block NOT on a card, its
              header and rows sat 17 px (phone) to 20 px (desktop) left of the Conversations
              title. MyReports is framed here, not in admin.jsx, because the admin page never
              renders it and its own layout is shared with nothing. */}
          {s === 'reports' && <div className="space-y-6 sm:space-y-8">
            <MyThreads />
            <Card className="p-4 sm:p-5"><MyReports /></Card>
            <MyRightsNotices />
          </div>}
          {s === 'teams' && <MyTeams />}
          {s === 'data' && <MyData />}
        </>)}
      </SideDash>

      <ItemEditModal open={!!editing} item={editing} onClose={() => setEditing(null)} onDone={() => items.reload()} />
    </>
  );
}

// Same shape as the copies in uploads.jsx and admin.jsx. Not shared, because none of the
// three is exported and hoisting one into a lib touches three files for one number.
const fmtBytes = (n) => {
  n = Number(n) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
};

// Take a copy of your own content — the account record, your repos' files, your catalog
// items and their uploads, in one archive.
//
// The size is shown BEFORE the button rather than after the click. A backup of everything
// somebody owns can be gigabytes, and a download that starts with no idea how long it will
// run is one people cancel halfway and assume is broken.
function MyData() {
  const { t } = useI18n(); const toast = useToast();
  const { data, loading } = useAsync(() => api.get('/me/backup/preview'), []);
  const [want, setWant] = useState({ account: true, repos: true, catalog: true });
  const [busy, setBusy] = useState('');
  const { lang } = useI18n();

  const picked = Object.entries(want).filter(([, v]) => v).map(([k]) => k);
  // Only the parts actually ticked, so the figure under the button matches what will be
  // downloaded rather than what exists.
  const bytes = (want.repos ? data?.repoBytes || 0 : 0) + (want.catalog ? data?.itemBytes || 0 : 0);

  // A plain <a href> would work, but it cannot tell a 429 or a 400 from a file — the browser
  // would save the JSON error under a .zip name. Fetching first means a failure is a toast.
  const download = async (url, filename, key) => {
    setBusy(key);
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        throw Object.assign(new Error('http'), { status: res.status, body: await res.json().catch(() => null) });
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      toast.success(t('data.done', 'Downloaded.'));
    } catch (x) {
      toast.error(x?.status === 429
        ? t('data.rate', 'A backup was taken recently, try again in a little while.')
        : t('common.failed', 'Failed.'));
    } finally { setBusy(''); }
  };

  // A tile, not a bare checkbox on a line. Three of these ARE the choice being made, and a
  // row of unadorned ticks reads as fine print rather than as the thing to answer. The whole
  // tile is the hit target, and the selected ones are visibly the selected ones.
  const Check = ({ k, label, hint, icon }) => (
    <label className={`flex items-start gap-2.5 cursor-pointer rounded-lg border p-3 transition-colors ${
      want[k]
        ? 'b-primary tint-primary-soft'
        : 'border-[var(--line)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)]'
    }`}>
      <input type="checkbox" className="mt-0.5 shrink-0" checked={want[k]}
        onChange={(e) => setWant((w) => ({ ...w, [k]: e.target.checked }))} />
      <span className="min-w-0">
        <span className="text-sm font-medium flex items-center gap-1.5">{icon}{label}</span>
        <span className="block text-[11px] text-[var(--muted)] mt-0.5 leading-snug">{hint}</span>
      </span>
    </label>
  );

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-1 font-semibold"><HardDriveDownload size={16} className="text-[var(--accent-ink)]" /> {t('data.title', 'Back up your content')}</div>
        <p className="text-sm text-[var(--muted)] mb-4">
          {t('data.sub', 'One archive with your account record, every file in the repos you own, and every catalog item you uploaded. Nothing is deleted here — this only makes you a copy.')}
        </p>

        {loading ? <Loading /> : (<>
          <div className="grid sm:grid-cols-3 gap-3 mb-4">
            <Check k="account" icon={<FileJson size={13} className="text-[var(--muted)]" />}
              label={t('data.account', 'Account record')}
              hint={t('data.account.h', 'What the site holds about you, as JSON. Passwords and tokens are left out.')} />
            <Check k="repos" icon={<HardDriveDownload size={13} className="text-[var(--muted)]" />}
              label={t('data.repos', 'Repo files')}
              hint={t('data.repos.h', '{n} repo(s), {b}').replace('{n}', String(data?.repos?.length || 0)).replace('{b}', fmtBytes(data?.repoBytes || 0))} />
            <Check k="catalog" icon={<Package size={13} className="text-[var(--muted)]" />}
              label={t('data.catalog', 'Catalog items')}
              hint={t('data.catalog.h', '{n} item(s), {b}').replace('{n}', String(data?.items?.length || 0)).replace('{b}', fmtBytes(data?.itemBytes || 0))} />
          </div>

          {/* One action, with its size beside it. The JSON download used to sit next to the
              archive as an equal-looking button, so the screen offered two downloads and no
              hint that one is a subset of the other — it is a shortcut for people who want
              the record without waiting for gigabytes of files, and it reads as one now. */}
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button variant="primary" disabled={!picked.length || !!busy}
              onClick={() => download(`/api/me/backup?what=${picked.join(',')}&lang=${lang}`, `bettercommunity-backup-${new Date().toISOString().slice(0, 10)}.zip`, 'zip')}>
              {busy === 'zip' ? <Spinner /> : <HardDriveDownload size={15} />} {t('data.take', 'Download the archive')}
            </Button>
            <div className="min-w-0">
              <div className="text-sm font-semibold tabular-nums">
                {picked.length ? fmtBytes(bytes) : t('data.nothing', 'Nothing selected')}
              </div>
              <div className="text-[11px] text-[var(--muted)]">
                {picked.length
                  ? t('data.size.h', '{n} of 3 parts selected').replace('{n}', String(picked.length))
                  : t('data.nothing.h', 'Tick at least one part above.')}
              </div>
            </div>
            <button type="button" disabled={!!busy}
              className="ms-auto text-xs underline decoration-dotted underline-offset-4 text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50 flex items-center gap-1.5"
              onClick={() => download('/api/me/export', 'bettercommunity-data.json', 'json')}>
              {busy === 'json' ? <Spinner /> : <FileJson size={13} />} {t('data.json', 'Account record only (JSON)')}
            </button>
          </div>

          {/* Said before the download, not discovered inside it: an item with no uploaded
              file has nothing to put in the archive, and an empty folder reads as a fault. */}
          {want.catalog && data?.items?.some((i) => !i.hasFile) && (
            <p className="text-[11px] text-[var(--faint)] mt-2">
              {t('data.linkonly', '{n} of your items link to a file hosted elsewhere, the archive carries their details, not the file.')
                .replace('{n}', String(data.items.filter((i) => !i.hasFile).length))}
            </p>
          )}
          <p className="text-[11px] text-[var(--faint)] mt-2">
            {t('data.manifest', 'The archive contains a manifest.json listing what went in — and anything that could not be read. Read it before assuming the copy is complete.')}
          </p>
        </>)}
      </Card>

      {/* Per item, because the common need is one file back — usually the one attached to a
          submission that is still pending or was suspended, which the public link refuses. */}
      {!loading && !!data?.items?.length && (
        <Card className="p-5">
          <div className="font-semibold mb-1">{t('data.one', 'Get one item back')}</div>
          <p className="text-sm text-[var(--muted)] mb-3">
            {t('data.one.s', 'The file you uploaded, whatever the item’s status, including while it waits for review, or after it was suspended.')}
          </p>
          <div className="rounded-lg border border-[var(--line)] divide-y divide-[var(--line)] max-h-80 overflow-y-auto">
            {data.items.map((it) => (
              <div key={it.id} className="px-3 py-2 flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm truncate" title={it.name}>{it.name}</div>
                  <div className="text-[11px] text-[var(--faint)]">
                    {it.status} · {it.hasFile ? fmtBytes(it.bytes) : t('data.nofile', 'no uploaded file')}
                  </div>
                </div>
                <Button size="sm" variant="ghost" disabled={!it.hasFile || !!busy}
                  title={it.hasFile ? t('common.download', 'Download') : t('data.nofile', 'no uploaded file')}
                  onClick={() => download(`/api/me/catalog/${it.id}/download`, it.slug || it.name, it.id)}>
                  {busy === it.id ? <Spinner /> : <Download size={14} />}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// View + edit one of your own items. Saving proposes an UPDATE (admin re-validation
// still required) — the item flips back to PENDING until a moderator re-approves it.
// For our-hosted plugins the .bmmplug can be replaced; the new package is re-verified
// (checksums recomputed) before the change can go live again.
function ItemEditModal({ open, item, onClose, onDone }) {
  const toast = useToast(); const { t } = useI18n(); const dialog = useDialog();
  const [form, setForm] = useState(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [confirmCancelHost, setConfirmCancelHost] = useState(false);
  const isPlugin = item?.kind === 'PLUGIN';
  // Any kind we host the payload for ourselves (not just PLUGIN) can be replaced —
  // app/theme/preset submissions are billed by size past the free tier exactly
  // like plugins, so they deserve the same self-service re-upload.
  const ourHosted = !!item?.payloadKey && !item?.meta?.download_url;
  const v = isPlugin ? item?.meta?.validation : null;
  const [quote, setQuote] = useState(null);
  const [cap, setCap] = useState(null); // hosting capacity — re-uploads also draw from the temp margin
  const noSubmitSpace = !!cap && (cap.tempMarginGB - cap.tempUsedGB) <= 0.01;
  useEffect(() => {
    if (file) {
      api.get(`/catalog/hosting-quote?bytes=${file.size}`).then(setQuote).catch(() => setQuote(null));
      api.get('/hosting/capacity').then((r) => setCap(r.capacity)).catch(() => setCap(null));
    } else setQuote(null);
  }, [file]);

  useEffect(() => {
    if (item) {
      const { validation, _prevStatus, ...cleanMeta } = item.meta || {}; // hide server-computed fields
      setForm({ description: item.description || '', version: item.version || '', tags: item.tags || [], meta: JSON.stringify(cleanMeta, null, 2) });
      setFile(null); setConfirmDel(false);
    }
  }, [item]);
  if (!item || !form) return null;
  const I = KIND_ICON[item.kind] || Package;

  const viewPayload = async () => {
    try { const { url } = await api.get(`/me/items/${item.id}/payload`); window.open(url, '_blank'); }
    catch { toast.error(t('ie.nopayload', 'No downloadable payload.')); }
  };
  const save = async () => {
    if (file && noSubmitSpace) return toast.error(t('sub.tempfull', 'Submission storage is full right now, try again once moderation clears space.'));
    let meta; try { meta = JSON.parse(form.meta || '{}'); } catch { return toast.error(t('ie.metajson', 'Metadata must be valid JSON.')); }
    setBusy(true);
    try {
      const patch = { description: form.description, version: form.version, tags: form.tags, meta };
      if (file) { patch.payloadKey = await uploadPayload(item.kind, file); patch.payloadSize = file.size; }
      const res = await api.post(`/catalog/${item.id}/update`, patch);
      // A re-upload past the free tier is billed by size → finish payment first;
      // the new file only takes effect once the webhook confirms it's paid.
      if (res?.checkoutUrl) { window.location.href = res.checkoutUrl; return; }
      if (res?.validation && res.validation.valid === false) toast.error(t('ie.savefail', 'Saved, but the new .bmmplug failed validation ({reason}). A moderator will review.').replace('{reason}', res.validation.reason));
      else if (res?.validation?.valid) toast.success(t('ie.saveverified', 'Saved, plugin re-verified. Pending admin re-approval.'));
      else toast.success(t('ie.savepending', 'Saved, changes are pending admin re-approval.'));
      onClose(); onDone();
    } catch (x) { toast.error(x.data?.error === 'item_suspended' ? t('ie.suspended', 'This item was suspended by an admin, you can’t edit or resubmit it. Contact support to appeal.') : (x.data?.error || x.message || t('ie.savefail2', 'Failed to save.'))); } finally { setBusy(false); }
  };
  const doDelete = async () => {
    setBusy(true);
    try { await api.post(`/catalog/${item.id}/delete`); toast.success(t('ie.scheduled', 'Scheduled for deletion in 72h. Files are kept until then, you can cancel any time.')); onClose(); onDone(); }
    catch (x) { toast.error(x.data?.error || t('ie.delfail', 'Failed to delete.')); } finally { setBusy(false); }
  };
  const cancelDeletion = async () => {
    setBusy(true);
    try { await api.post(`/catalog/${item.id}/delete/cancel`); toast.success(t('dash.delcancelled', 'Deletion cancelled.')); onClose(); onDone(); }
    catch (x) { toast.error(x.data?.error || t('dash.cancelfail', 'Failed to cancel.')); } finally { setBusy(false); }
  };
  const cancelHosting = async () => {
    setBusy(true);
    try { await api.post(`/catalog/${item.id}/hosting/cancel`); toast.success(t('ie.hostcancelled', 'Hosting subscription cancelled, the item is now hidden.')); onClose(); onDone(); }
    catch (x) { toast.error(x.data?.error || t('ie.hostcancelfail', 'Failed to cancel.')); } finally { setBusy(false); }
  };

  const footer = item.deleteAt
    ? <><Button variant="ghost" onClick={onClose}>{t('bill.close', 'Close')}</Button><Button variant="primary" disabled={busy} onClick={cancelDeletion}>{busy ? <Spinner /> : t('ie.canceldel', 'Cancel deletion')}</Button></>
    : <>
        {confirmDel
          ? <span className="flex items-center gap-2 me-auto text-sm text-[var(--muted)]">{t('ie.delthis', 'Delete this item?')}<Button size="sm" className="!bg-error-bg !text-error !border-error-border" disabled={busy} onClick={doDelete}>{busy ? <Spinner /> : t('ie.yesdelete', 'Yes, delete')}</Button><Button size="sm" variant="ghost" onClick={() => setConfirmDel(false)}>{t('ie.no', 'No')}</Button></span>
          : <>
              <button className="me-auto text-sm text-error hover:text-error flex items-center gap-1.5" onClick={() => setConfirmDel(true)}><Trash2 size={14} /> {t('repos.del.ok', 'Delete')}</button>
              {/* Beside Delete rather than beside Save: both are ways of ceasing to own
                  this, and neither belongs next to an edit you might still be making. */}
              <button className="text-sm text-[var(--muted)] hover:text-[var(--text)] flex items-center gap-1.5"
                onClick={async () => { if (await startOwnershipTransfer({ dialog, toast, t, api, kind: 'catalog', targetId: item.id, targetName: item.name })) { onClose(); onDone(); } }}>
                <ArrowRight size={14} /> {t('ie.transfer', 'Transfer…')}
              </button>
            </>}
        <Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
        <Button variant="primary" disabled={busy || (!!file && noSubmitSpace)} onClick={save}>{busy ? <Spinner /> : t('ie.savereview', 'Save (send for re-review)')}</Button>
      </>;

  return (
    <Modal open={open} onClose={onClose} title={t('ie.title', 'View / edit item')} icon={PenSquare} width="max-w-lg" footer={footer}>
      <div className="flex items-center gap-3 mb-4">
        <div className="grid place-items-center w-11 h-11 rounded-xl bg-[var(--surface-2)] border border-[var(--line)]"><I size={20} className="text-[var(--accent-ink)]" /></div>
        <div className="min-w-0"><div className="font-semibold truncate" title={item.name}>{item.name}</div>
          <div className="text-xs text-[var(--faint)] flex items-center gap-2"><Badge tone={statusTone(item.status)}>{item.status}</Badge>{item.kind}
            {(item.payloadKey || item.meta?.download_url) && <button onClick={viewPayload} className="text-[var(--accent-ink)] hover:underline flex items-center gap-1"><Download size={11} /> payload</button>}</div></div>
      </div>

      {item.deleteAt
        ? <div className="rounded-lg border border-error-border bg-error-bg p-2.5 text-xs text-error flex items-start gap-2 mb-4">
            <Trash2 size={13} className="shrink-0 mt-0.5" />
            <span>{t('ie.notice.del1', 'Scheduled for deletion in')} <b>{fmtRemaining(item.deleteAt)}</b>. {t('ie.notice.del2', 'The files are kept until then, cancel below to keep this item.')}</span>
          </div>
        : <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2.5 text-xs text-[var(--muted)] flex items-start gap-2 mb-4">
            <Lock size={13} className="text-[var(--accent-ink)] shrink-0 mt-0.5" />
            <span>{t('ie.notice.edit', 'Editing sends the item back for moderation. The live version stays unchanged until an admin re-approves your changes.')}</span>
          </div>}

      {isPlugin && v && (
        <div className={`rounded-lg p-2.5 text-xs mb-4 flex items-center gap-2 border ${v.valid ? 'bg-success-bg border-success-border text-success' : 'bg-error-bg border-error-border text-error'}`}>
          {v.valid ? <BadgeCheck size={14} /> : <XCircle size={14} />}
          <span className="flex-1">{v.valid ? t('ie.pkgok', 'Current package verified, checksums match.') : t('ie.pkgbad', 'Current package invalid: {reason}').replace('{reason}', v.reason)}</span>
          {v.sha256 && <code className="text-[10px] text-[var(--faint)]">{v.sha256.slice(0, 12)}…</code>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('sub.name', 'Name')} hint={t('ie.noedit', 'Not editable')}><Input value={item.name} disabled /></Field>
        <Field label={t('sub.version', 'Version')}><Input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} /></Field>
      </div>
      <div className="mt-3"><Field label={t('sub.desc', 'Description')}><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field></div>
      <div className="mt-3"><Field label={t('repos.f.tags', 'Tags')}><ItemTagPicker id="ie-tags" value={form.tags} onChange={(v) => setForm({ ...form, tags: v })} /></Field></div>

      {ourHosted && (
        <div className="mt-3">
          <Field label={t('ie.replace', 'Replace file')} hint={t('ie.replace.hint2', 'Optional, uploads a new file, re-verified before it can go live. Billed by size past the free tier.')}>
            <Input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </Field>
          {file && <div className="mt-1.5 text-xs text-[var(--accent-ink)] flex items-center gap-1.5"><Upload size={12} /> {file.name} {t('ie.replaces', '— replaces the current file and is re-validated on save.')}</div>}
          {file && noSubmitSpace && (
            <div className="mt-1.5 text-xs text-error flex items-center gap-1.5"><AlertTriangle size={12} /> {t('sub.nospace', 'Submission storage is full right now — every upload is held for moderation and there is no room left. Try again later, or self-host and paste a URL above instead.')}</div>
          )}
          {file && quote && !quote.free && quote.monthlyCents > 0 && (
            <div className="mt-1.5 text-xs text-warning flex items-center gap-1.5"><Receipt size={12} /> {t('ie.replacecost', 'This size is billed: {price}/mo, you\'ll be sent to checkout after saving.').replace('{price}', `$${(quote.monthlyCents / 100).toFixed(2)}`)}</div>
          )}
        </div>
      )}
      {ourHosted && item.meta?._hostingSubId && (
        <div className="mt-3 rounded-lg border border-error-border bg-error-bg p-2.5 text-xs text-[var(--muted)] flex items-center gap-2 flex-wrap">
          <Receipt size={13} className="text-error shrink-0" />
          <span className="flex-1">{t('ie.hostactive', 'This file is on a recurring monthly hosting subscription.')}</span>
          {confirmCancelHost
            ? <span className="flex items-center gap-2"><span className="text-error">{t('ie.hostcancelq', 'Cancel and hide this item?')}</span>
                <Button size="sm" className="!bg-error-bg !text-error !border-error-border" disabled={busy} onClick={cancelHosting}>{busy ? <Spinner /> : t('ie.yescancel', 'Yes, cancel')}</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmCancelHost(false)}>{t('ie.no', 'No')}</Button></span>
            : <Button size="sm" variant="ghost" className="!text-error" onClick={() => setConfirmCancelHost(true)}>{t('ie.cancelhosting', 'Cancel hosting')}</Button>}
        </div>
      )}
      {isPlugin && !ourHosted && item.meta?.download_url && (
        <div className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2.5 text-xs text-[var(--muted)]">{t('ie.selfhosted1', 'This plugin is self-hosted. Point')} <code>download_url</code> {t('ie.selfhosted2', '(below) at a new')} <code>.bmmplug</code>{t('ie.selfhosted3', '; it is re-validated on save.')}</div>
      )}

      <div className="mt-3"><div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('sub.metadata', 'Metadata (JSON)')}</div>
        <JsonEditor value={form.meta} onChange={(meta) => setForm({ ...form, meta })} /></div>
    </Modal>
  );
}

// Per-type copy + generator templates so the form adapts to what's being submitted.
const KIND_COPY = {
  APP: { name: 'My companion app', desc: 'A tool that works alongside BMM.', file: 'Payload file (zip / exe)', tmpl: { id: 'my-app', title: 'My App', category: 'utility', price: 'free', tags: [], download: { url: 'https://…/app.exe', file_type: 'exe', sha256: '' } } },
  PLUGIN: { name: 'Auto Backup', desc: 'What does this plugin do?', file: 'Plugin file (.bmmplug)', tmpl: { id: 'auto-backup', download_url: 'https://…/auto-backup.bmmplug', sha256: '', permissions: [] } },
  THEME: { name: 'Midnight Orange', desc: 'A dark, warm UI theme.', file: 'Theme file (.bmmtheme)', tmpl: { author: '', url: 'https://…' } },
  PRESET: { name: 'Afterburner Boom', desc: 'A punchy engine sound preset.', file: 'Preset .json file', tmpl: { name: '', version: '1.0.0', assetPaths: [] } },
};

// Everything this member starred, repos and catalogs in one place — the point of a star is
// finding the thing again later, which the star buttons on /r/:id and /c/:slug couldn't
// deliver on their own. The API returns the two lists already filtered to what's still
// reachable, so an unlisted repo or a suspended catalog doesn't resurface through an old star.
/**
 * Polls, from the answerer's side: what is still waiting, then what you already said.
 *
 * Waiting comes FIRST and answered is collapsed underneath, because a dashboard panel that
 * opens on a list of things you have already done prompts nobody to do anything. The server
 * decides what counts as waiting — it excludes unlisted and private polls, so this panel can
 * never advertise a poll that is deliberately hidden.
 */
function MyPolls() {
  const { t } = useI18n();
  const { data, loading } = useAsync(() => api.get('/me/polls'), []);
  if (loading) return <div className="py-8 text-center"><Spinner /></div>;
  const open = data?.open || [];
  const answered = data?.answered || [];
  const votes = data?.votes || [];

  if (!open.length && !answered.length && !votes.length) {
    return <EmptyState icon={BarChart3} title={t('dash.polls.none', 'No poll running')}
      sub={t('dash.polls.none.s', 'When there is a question about where this goes next, it shows up here.')}
      action={{ label: t('dash.polls.a', 'See the polls page'), to: '/polls', icon: BarChart3 }} />;
  }

  return (
    <div className="space-y-5">
      {open.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2">{t('dash.polls.open', 'Waiting for you')}</h3>
          <div className="space-y-2">
            {open.map((p) => (
              <Card key={p.id} className="p-4 flex items-start gap-3">
                <BarChart3 size={16} className="text-[var(--accent-ink)] shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <Link to={`/polls/${p.id}`} className="font-medium hover:underline">{p.question}</Link>
                  {p.description && <p className="text-xs text-[var(--muted)] mt-0.5 line-clamp-2">{p.description}</p>}
                  {p.closesAt && (
                    <p className="text-[11px] text-[var(--faint)] mt-1">
                      {t('dash.polls.closes', 'Closes {d}').replace('{d}', new Date(p.closesAt).toLocaleDateString())}
                    </p>
                  )}
                </div>
                <Link to={`/polls/${p.id}`}><Button size="sm" variant="primary">{t('dash.polls.answer', 'Answer')}</Button></Link>
              </Card>
            ))}
          </div>
        </div>
      )}

      {(answered.length > 0 || votes.length > 0) && (
        <div>
          <h3 className="text-sm font-semibold mb-2">{t('dash.polls.done', 'You have answered')}</h3>
          <Card className="divide-y divide-[var(--line)]">
            {answered.map((a) => (
              <div key={a.pollId} className="px-4 py-2.5 flex items-center gap-2">
                <CheckCircle2 size={14} className="text-success shrink-0" />
                <Link to={`/polls/${a.pollId}`} className="text-sm truncate hover:underline flex-1 min-w-0" title={a.poll.question}>{a.poll.question}</Link>
                <span className="text-[11px] text-[var(--faint)] shrink-0">{new Date(a.at).toLocaleDateString()}</span>
              </div>
            ))}
            {/* The single-question shape, which records one row per chosen option rather than
                one per poll — so the option you picked is worth showing, unlike above. */}
            {votes.slice(0, 20).map((v) => (
              <div key={v.id} className="px-4 py-2.5 flex items-center gap-2">
                <CheckCircle2 size={14} className="text-success shrink-0" />
                <Link to={`/polls/${v.poll?.id}`} className="text-sm truncate hover:underline flex-1 min-w-0" title={v.poll?.question}>{v.poll?.question}</Link>
                <span className="text-[11px] text-[var(--faint)] shrink-0 truncate max-w-[40%]" title={v.option?.label}>{v.option?.label}</span>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}

function Starred() {
  const { t } = useI18n();
  const { data, loading } = useAsync(() => api.get('/me/favorites'), []);
  const repos = data?.repos || [];
  const catalogs = data?.catalogs || [];

  if (loading) return <Loading />;
  if (!repos.length && !catalogs.length) return (
    <EmptyState icon={Star} title={t('star.none.t', 'Nothing starred yet')}
      sub={t('star.none.s', 'Star a repo or a catalog from its page and it shows up here.')}>
      <div className="flex gap-2">
        <Link to="/repos"><Button size="sm" variant="primary"><Server size={14} /> {t('star.browserepos', 'Browse repos')}</Button></Link>
        <Link to="/catalog"><Button size="sm"><Boxes size={14} /> {t('star.browsecats', 'Browse catalogs')}</Button></Link>
      </div>
    </EmptyState>
  );

  const Section = ({ icon: Icon, title, rows, kind }) => rows.length ? (
    <div className="mb-5 last:mb-0">
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-2 flex items-center gap-1.5">
        <Icon size={12} /> {title} <span className="text-[var(--faint)]">({rows.length})</span>
      </div>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <Card key={r.id} className="p-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
            <div className="flex-1 min-w-0">
              <Link to={r.url} className="font-medium hover:text-[var(--accent-ink)] truncate block" title={r.name}>{r.name}</Link>
              <div className="text-xs text-[var(--faint)] truncate flex items-center gap-2 flex-wrap mt-0.5">
                {r.author && <span className="inline-flex items-center gap-1"><Users size={11} /> {r.author}</span>}
                {kind === 'catalog' && <span>{r.itemCount} {t('cc.items', 'items')}</span>}
                {kind === 'repo' && r.hosted && <Badge tone="primary">{t('repos.hosted', 'Hosted')}</Badge>}
                {r.description && <span className="truncate">· {r.description}</span>}
              </div>
            </div>
            <Link to={r.url} className="shrink-0"><Button size="sm" variant="ghost"><ArrowRight size={14} /> {t('star.open', 'Open')}</Button></Link>
          </Card>
        ))}
      </div>
    </div>
  ) : null;

  return (
    <div>
      <h2 className="font-semibold mb-1 flex items-center gap-2"><Star size={16} className="text-[var(--accent-ink)]" /> {t('star.title', 'Starred')}</h2>
      <p className="text-xs text-[var(--muted)] mb-4">{t('star.sub2', 'Unstar from the item’s own page.')}</p>
      <Section icon={Server} title={t('star.repos', 'Server repos')} rows={repos} kind="repo" />
      <Section icon={Boxes} title={t('star.catalogs', 'Community catalogs')} rows={catalogs} kind="catalog" />
    </div>
  );
}

/** The rights notices this account filed — status and decision, with the reference. */
function MyRightsNotices() {
  const { t } = useI18n();
  const { data, loading } = useAsync(() => api.get('/me/rights').catch(() => ({ notices: [] })), []);
  const list = data?.notices || [];
  if (loading || !list.length) return null;
  return (
    <Card className="p-4 sm:p-5">
      <div className="font-semibold mb-2">{t('rn.my', 'Rights notices you filed')}</div>
      <div className="space-y-1.5">
        {list.map((n) => (
          <div key={n.id} className="flex items-center gap-2 text-sm flex-wrap">
            <span className="font-mono text-xs">{n.code}</span>
            <Badge>{t(`rn.k.${n.kind}`, n.kind)}</Badge>
            <Badge tone={n.status === 'actioned' ? 'success' : n.status === 'rejected' ? 'error' : undefined}>{t(`rn.s.${n.status}`, n.status)}</Badge>
            <span className="text-[var(--faint)] text-xs">{new Date(n.createdAt).toLocaleDateString()}</span>
            {n.decision && <span className="text-xs text-[var(--muted)] basis-full">{n.decision}</span>}
          </div>
        ))}
      </div>
      <Link to="/report" className="text-xs text-[var(--accent-ink)] hover:underline mt-2 inline-block">{t('rn.my.new', 'File another notice')}</Link>
    </Card>
  );
}
