import { useEffect, useState, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import {
  Rocket, Upload, CheckCircle2, XCircle, ShieldCheck, HardDrive, Gauge, Zap, Sliders, Receipt, Plus, Mail, RefreshCw, X, ChevronDown, AlertTriangle, Ticket, CreditCard, Gift, Layers, Building2, ShoppingCart, Save,
} from 'lucide-react';
import { Button, Card, Badge, Input, Select, PageHeader, Spinner, Modal, useDialog, useToast } from '../ui/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from './auth.jsx';
import { useIntro } from '../ui/IntroContext.jsx';
import { useI18n } from '../i18n.jsx';

// Local helpers (small hooks duplicated across a few page modules).
function useAsync(fn, deps = []) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const reload = () => { setLoading(true); fn().then((d) => { setData(d); setErr(null); }).catch(setErr).finally(() => setLoading(false)); };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, deps);
  return { data, err, loading, reload };
}
const Loading = () => <div className="flex items-center gap-2 text-[var(--muted)] py-10"><Spinner /> Loading…</div>;

/* ─────────────────────────  Hosting  ───────────────────────── */
// Custom, themeable dropdown for the prepaid billing term (replaces the segmented
// cards). Shows the picked term + its discount, and flags the best-value option.
function TermSelect({ months, setMonths, termDisc, t }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc); return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const opts = [1, 3, 6, 12, 24];
  const disc = (m) => Math.round((termDisc[m] || 0) * 100);
  const label = (m) => `${m} ${t('hosting.mo', 'mo')}${m === 12 ? ` · ${t('hosting.1yr', '1 yr')}` : m === 24 ? ` · ${t('hosting.2yr', '2 yr')}` : ''}`;
  const BestTag = () => <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-500/15 text-[var(--primary-2)] border border-[var(--primary)]/40 whitespace-nowrap">{t('hosting.best2', 'Best value')}</span>;
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}
        className={`w-full flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition ${open ? 'border-[var(--primary)]' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`}
        style={open ? { boxShadow: '0 0 0 1px var(--primary)' } : undefined}>
        <span className="grid place-items-center w-9 h-9 rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 text-white shrink-0"><Receipt size={16} /></span>
        <span className="flex-1 min-w-0">
          <span className="font-semibold flex items-center gap-2">{label(months)}{months === 12 && <BestTag />}</span>
          <span className="block text-xs text-[var(--muted)] mt-0.5">{disc(months) > 0 ? t('hosting.savepct', 'Save {n}% vs monthly').replace('{n}', disc(months)) : t('hosting.term.note', '· prepaid, min 1 month')}</span>
        </span>
        <ChevronDown size={18} className={`text-[var(--muted)] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div role="listbox" className="absolute z-30 mt-2 w-full rounded-xl border border-[var(--line-strong)] overflow-hidden anim-fade" style={{ background: 'var(--bg-solid)', boxShadow: '0 20px 60px -12px rgba(0,0,0,0.55)' }}>
          {opts.map((m) => { const active = m === months; const d = disc(m); return (
            <button key={m} type="button" role="option" aria-selected={active} onClick={() => { setMonths(m); setOpen(false); }}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-left text-sm transition ${active ? 'bg-orange-500/10' : 'hover:bg-[var(--surface-2)]'}`}>
              <span className={`w-2 h-2 rounded-full shrink-0 ${active ? 'bg-[var(--primary)]' : 'bg-[var(--line-strong)]'}`} />
              <span className="flex-1 font-medium">{label(m)}</span>
              {m === 12 && <BestTag />}
              {d > 0 ? <span className="text-xs font-bold text-emerald-400">−{d}%</span> : <span className="text-[11px] text-[var(--faint)]">{t('hosting.standard', 'standard')}</span>}
              {active && <CheckCircle2 size={14} className="text-[var(--primary-2)] shrink-0" />}
            </button>
          ); })}
        </div>
      )}
    </div>
  );
}

// Self-contained promo-code field: debounced live validation against
// /me/promo/validate, shown inline (no separate "apply" round-trip to
// checkout needed just to find out a code is wrong). Reports the validated
// promo (or null) up via onChange so the checkout call can include the code.
function PromoCodeField({ months, onChange }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [code, setCode] = useState('');
  const [state, setState] = useState(null); // { promo } | { error } | null
  const [checking, setChecking] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);
  useEffect(() => {
    if (!code.trim() || !user) { setState(null); onChange(null); return; }
    setChecking(true);
    const id = setTimeout(() => {
      api.get(`/me/promo/validate?code=${encodeURIComponent(code.trim())}`)
        .then((r) => { setState({ promo: r.promo }); onChange(r.promo.minMonths && months < r.promo.minMonths ? null : r.promo); })
        .catch((x) => { setState({ error: x.data?.error || 'invalid' }); onChange(null); })
        .finally(() => setChecking(false));
    }, 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, user]);
  const termTooShort = state?.promo?.minMonths && months < state.promo.minMonths;
  return (
    <div>
      <div className="relative">
        <Ticket size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
        <Input className="!pl-8" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder={t('hosting.promo.ph', 'Promo code (optional)')} />
        {checking && <Spinner className="absolute right-3 top-1/2 -translate-y-1/2" />}
      </div>
      {state?.error && <div className="text-xs text-red-400 mt-1 flex items-center gap-1"><XCircle size={12} /> {t('hosting.promo.invalid', 'Invalid or expired code.')}</div>}
      {state?.promo && state.promo.kind === 'discount' && !termTooShort && (
        <div className="text-xs text-emerald-400 mt-1 flex items-center gap-1"><CheckCircle2 size={12} /> {state.promo.percentOff ? t('hosting.promo.pct', '{pct}% off applied').replace('{pct}', state.promo.percentOff) : state.promo.freeMonths ? t('hosting.promo.free', 'First {n} months free').replace('{n}', state.promo.freeMonths) : t('hosting.promo.ok', 'Code applied.')}</div>
      )}
      {/* Free-hosting / free-boost codes aren't checkout discounts — they redeem
          directly. Surface that with a one-click "Use this code" modal flow. */}
      {state?.promo && state.promo.kind !== 'discount' && (
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <span className="text-xs text-emerald-400 flex items-center gap-1"><Gift size={12} />
            {state.promo.kind === 'free_hosting'
              ? t('hosting.promo.hostcode', 'Free hosting code — {gb} GB repo at no cost.').replace('{gb}', state.promo.storageGB)
              : t('hosting.promo.boostcode', 'Boost code — {d} days featured.').replace('{d}', state.promo.boostDays)}
          </span>
          <Button size="sm" variant="primary" onClick={() => setRedeemOpen(true)}>{t('hosting.promo.use', 'Use this code')}</Button>
        </div>
      )}
      {termTooShort && <div className="text-xs text-amber-400 mt-1 flex items-center gap-1"><AlertTriangle size={12} /> {t('hosting.promo.minmonths', 'This code needs a {n}+ month term.').replace('{n}', state.promo.minMonths)}</div>}
      {redeemOpen && state?.promo && <RedeemPromoModal code={code.trim()} promo={state.promo} onClose={() => setRedeemOpen(false)} />}
    </div>
  );
}

/* Redeem a free-hosting / free-boost code from the hosting page: shows what the
   code grants; boost codes ask which of your repos to boost. Mobile-friendly. */
function RedeemPromoModal({ code, promo, onClose }) {
  const { t } = useI18n(); const toast = useToast(); const nav = useNavigate();
  const isBoost = promo.kind === 'free_boost';
  const [repos, setRepos] = useState(null);
  const [repoId, setRepoId] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (isBoost) api.get('/me/repos').then((r) => setRepos(r.repos || [])).catch(() => setRepos([])); }, [isBoost]);
  const apply = async () => {
    setBusy(true);
    try {
      const r = await api.post('/me/promo/redeem', { code, ...(isBoost ? { repoId } : {}) });
      toast.success(r.kind === 'free_hosting'
        ? t('promo.gotHosting', 'Redeemed! A free hosted repo was created — see "My repos".')
        : t('promo.gotBoost', 'Redeemed! Your repo is now boosted.'));
      onClose(); nav('/dashboard');
    } catch (x) {
      const e = x.data?.error;
      toast.error(e === 'already_used' ? t('promo.used', 'You already used this code.')
        : e === 'depleted' ? t('promo.depleted', 'This code is fully used.')
        : e === 'expired' ? t('promo.expired', 'This code has expired.')
        : e === 'busy' ? t('promo.busy', 'Busy — try again in a second.')
        : t('repos.failed', 'Failed.'));
    } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={t('hosting.promo.modal', 'Redeem code')} icon={Gift} width="max-w-md"
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
        <Button variant="primary" disabled={busy || (isBoost && !repoId)} onClick={apply}>{busy ? <Spinner /> : t('hosting.promo.apply', 'Apply code')}</Button></>}>
      <div className="flex items-center gap-3 p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] mb-4">
        <Gift size={20} className="text-emerald-400 shrink-0" />
        <div className="text-sm">
          <div className="font-semibold">{code}</div>
          <div className="text-[var(--muted)]">
            {isBoost ? t('hosting.promo.boostdesc', 'Boosts one of your repos to the featured spots for {d} days.').replace('{d}', promo.boostDays)
              : t('hosting.promo.hostdesc', 'Creates a free hosted repo — {gb} GB storage{months}.').replace('{gb}', promo.storageGB).replace('{months}', promo.hostMonths ? ` for ${promo.hostMonths} months` : ', no expiry')}
          </div>
        </div>
      </div>
      {isBoost && (
        repos === null ? <div className="py-4 grid place-items-center"><Spinner /></div>
        : !repos.length ? <div className="text-sm text-[var(--muted)]">{t('hosting.promo.norepos', "You don't have any repos yet — host one first, then redeem the boost.")}</div>
        : <div className="space-y-1.5 max-h-56 overflow-auto">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1">{t('promo.pickrepo', 'Which repo should get the boost?')}</div>
            {repos.map((r) => (
              <button key={r.id} type="button" onClick={() => setRepoId(r.id)}
                className={`w-full text-left px-3 py-2 rounded-xl border text-sm flex items-center gap-2 transition ${repoId === r.id ? 'border-[var(--primary)] bg-[var(--primary)]/10' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`}>
                <HardDrive size={14} className={repoId === r.id ? 'text-[var(--primary)]' : 'text-[var(--faint)]'} />
                <span className="flex-1 truncate">{r.name}</span>
                {repoId === r.id && <CheckCircle2 size={14} className="text-[var(--primary)]" />}
              </button>
            ))}
          </div>
      )}
    </Modal>
  );
}

export function Hosting() {
  const { user } = useAuth(); const nav = useNavigate(); const dialog = useDialog(); const toast = useToast(); const { t } = useI18n();
  const plans = useAsync(() => api.get('/hosting/plans'), []);
  const cap = useAsync(() => api.get('/hosting/capacity'), []);
  const [customOpen, setCustomOpen] = useState(false);
  // Every purchase is now a storage POOL you fill freely with repos and/or catalogs —
  // the single-repo layout toggle was removed. `mode` stays 'multi' throughout.
  const [mode] = useState('multi');
  const [months, setMonths] = useState(12); // prepaid term (1yr recommended)
  const [promo, setPromo] = useState(null); // validated promo code for the simple plan-card checkout
  const [autoRenew, setAutoRenew] = useState(true); // recurring subscription vs one-time prepaid
  const TERM_DISC = { 1: 0, 3: 0.05, 6: 0.10, 12: 0.20, 24: 0.35 };
  // ── Shopping cart: buy several repos + boosts in one prepaid checkout ──
  // Persisted in localStorage so it survives a refresh / navigating away and back.
  const [cart, setCart] = useState(() => { try { return JSON.parse(localStorage.getItem('bcw_cart') || '[]'); } catch { return []; } });
  const [cartOpen, setCartOpen] = useState(false);
  useEffect(() => { try { localStorage.setItem('bcw_cart', JSON.stringify(cart)); } catch {} }, [cart]);
  const myRepos = useAsync(() => (user ? api.get('/me/repos') : Promise.resolve({ repos: [] })), [!!user]);
  const addHosting = async ({ planId, custom, label }) => {
    if (!user) return nav('/auth');
    const repoName = await dialog.prompt({ title: mode === 'multi' ? t('hosting.pool.title', 'New storage pool') : t('hosting.repo.title', 'Host a repo'), label: mode === 'multi' ? t('hosting.pool.label', 'Pool name') : t('hosting.repo.label', 'Repository name'), placeholder: mode === 'multi' ? t('hosting.pool.ph', 'my-pool') : t('hosting.repo.ph', 'my-awesome-repo'), okLabel: t('cart.add', 'Add to cart') });
    if (!repoName || String(repoName).trim().length < 2) return;
    setCart((c) => [...c, { uid: Math.random().toString(36).slice(2), kind: 'hosting', mode, months, repoName: String(repoName).trim(), planId, custom, label, autoRenew: true }]);
    setCartOpen(true);
  };
  const addBoost = ({ repoId, repoName, days }) => {
    if (!user) return nav('/auth');
    setCart((c) => [...c, { uid: Math.random().toString(36).slice(2), kind: 'boost', repoId, repoName, days, autoRenew: true }]);
    setCartOpen(true);
  };
  const removeItem = (uid) => setCart((c) => c.filter((x) => x.uid !== uid));
  const setItemAutoRenew = (uid, on) => setCart((c) => c.map((x) => (x.uid === uid ? { ...x, autoRenew: on } : x)));
  const clearCart = () => setCart([]);
  const cartCount = cart.length;
  const termTotal = (monthlyCents) => {
    let total = Math.round(monthlyCents * months * (1 - (TERM_DISC[months] || 0)));
    if (promo?.percentOff) total = Math.round(total * (1 - promo.percentOff / 100));
    return total;
  };
  const checkout = async (body) => {
    if (!user) return nav('/auth');
    const repoName = await dialog.prompt({ title: mode === 'multi' ? t('hosting.pool.title', 'New storage pool') : t('hosting.repo.title', 'Host a repo'), label: mode === 'multi' ? t('hosting.pool.label', 'Pool name') : t('hosting.repo.label', 'Repository name'), placeholder: mode === 'multi' ? t('hosting.pool.ph', 'my-pool') : t('hosting.repo.ph', 'my-awesome-repo'), okLabel: t('hosting.continue', 'Continue to payment') });
    if (!repoName) return;
    try {
      const res = await api.post('/hosting/checkout', { promoCode: promo?.code, autoRenew, ...body, repoName, mode, months });
      // A $0 plan (the free tier, or a discount that zeroes it out) is provisioned
      // directly — there's no Stripe session/url to redirect to.
      if (res?.free) { toast.success(t('hosting.freeplan.pool2', 'Your storage pool "{name}" is ready — free tier. Add repos or catalogs to it.').replace('{name}', repoName)); return nav('/dashboard'); }
      window.location = res.url;
    } catch (x) {
      if (x.data?.error === 'creator_link_required') { toast.error(t('hosting.err.link', 'Link a BMM creator id first (Profile → Creator IDs) to host a repo.')); return nav('/profile'); }
      const e = x.data?.error;
      toast.error(e === 'capacity_full' ? t('hosting.err.capacity', 'No capacity available right now.')
        : e === 'over_limit' ? t('hosting.err.overlimit2', 'That exceeds the current per-repo upload limit (max {u} Mbps). Lower it and retry.').replace('{u}', x.data.maxUploadMbps)
        : e === 'free_tier_full' ? t('hosting.err.freetierfull', 'The free plan is sold out right now — every free slot is taken. Try a paid plan, or check back later.')
        : e === 'free_tier_already_used' ? t('hosting.err.freeused', "You've already used your one free repo (per account and per linked creator id) — pick a paid plan instead.")
        : e === 'stripe_not_configured' ? t('hosting.err.stripe', 'Payments not configured yet.') : t('hosting.err.checkout', 'Checkout failed.'));
    }
  };
  const c = cap.data?.capacity;
  // Fully sold out — the whole pool is spoken for (or hosting is disabled by an
  // admin). Nothing at all can be bought until an existing repo shrinks/expires.
  const soldOut = !!c && (c.enabled === false || c.freeGB <= 0.01);
  return (
    <div>
      <PageHeader icon={Rocket} title={t('hosting.title2', 'Hosting storage')} subtitle={t('hosting.sub2', 'Buy a pool of storage and fill it with repos and catalogs — we run it, you manage it.')} />

      {soldOut && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/8 p-4 mb-6 flex items-start gap-3">
          <AlertTriangle size={20} className="text-red-400 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-red-400">{t('hosting.soldout', 'No hosting space available right now')}</div>
            <div className="text-sm text-[var(--muted)] mt-0.5">{t('hosting.soldout.d', 'Every plan is sold out until an existing repo frees up space or an admin raises the total capacity. Try again later.')}</div>
          </div>
        </div>
      )}

      {/* One tidy "configure your order" card: repo layout + billing term +
          capacity in a single block, instead of three stacked config panels
          before the user has even seen a price. */}
      <Card className="p-4 sm:p-5 mb-6 relative z-30">
        <div className="flex flex-col sm:flex-row sm:items-start gap-5">
          <div className="sm:flex-1 min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-2 flex items-center gap-1.5"><Layers size={13} /> {t('hosting.storagespace', 'Storage space')}</div>
            <p className="text-sm text-[var(--muted)]">{t('hosting.storage.d', 'You buy a pool of storage. Once it\'s yours, fill it however you like — one repo, several repos, catalogs, or a mix — and resize the split anytime.')}</p>
          </div>
          <div className="sm:flex-1 min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-2">{t('hosting.term', 'Billing term')}</div>
            <TermSelect months={months} setMonths={setMonths} termDisc={TERM_DISC} t={t} />
          </div>
        </div>
        <p className="text-xs text-[var(--muted)] mt-4 flex items-center gap-1.5"><ShoppingCart size={13} className="text-[var(--primary-2)]" /> {t('hosting.cart.hint', 'Add repos and boosts to your cart, apply promo codes, then check out — all in one payment. Auto-renew is available per repo afterwards.')}</p>
        {c && (
          <div className="flex items-center gap-3 text-sm mt-4 pt-4 border-t border-[var(--line)]">
            <Gauge size={16} className="text-[var(--primary-2)] shrink-0" />
            <div className="flex-1"><div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full bg-gradient-to-r from-orange-500 to-amber-500" style={{ width: `${c.usableGB ? 100 - (c.freeGB / c.usableGB) * 100 : 0}%` }} /></div></div>
            <span className="text-xs text-[var(--muted)] whitespace-nowrap tabular-nums">{c.freeGB.toFixed(0)} / {c.usableGB.toFixed(0)} GB {t('hosting.free', 'free')}</span>
          </div>
        )}
      </Card>
      {/* Free tier — a real $0 plan, called out on its own instead of blending into
          the paid grid below (it isn't really "one of the four tiers", it's the
          answer to "can I try this for free?"). Paid plans never draw from this
          pool — it's tracked completely separately from Total capacity above —
          and a free repo can always be upgraded to a bigger paid size later (the
          free floor keeps applying, so you're only ever billed for the excess). */}
      {!plans.loading && (() => {
        const free = (plans.data?.plans || []).find((pl) => pl.priceMonthlyCents === 0);
        if (!free) return null;
        const freeTierSoldOut = !!c && c.freeTierCapEnabled && c.freeTierFreeGB <= 0.01;
        const freeDisabled = soldOut || freeTierSoldOut || (!!c && free.storageGB > c.freeGB);
        const freeTierPct = c?.freeTierCapEnabled && c.freeTierCapGB ? Math.min(100, (c.freeTierUsedGB / c.freeTierCapGB) * 100) : null;
        return (
          <Card className="p-5 mb-4 bg-emerald-500/[0.05] overflow-hidden relative">
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <span className="grid place-items-center w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white shrink-0 shadow-lg shadow-emerald-500/25"><Gift size={22} /></span>
              <div className="flex-1 text-center sm:text-left min-w-0">
                <div className="font-semibold text-lg">{t('hosting.freeplan.title', 'Just want to try it out?')}</div>
                <div className="text-sm text-[var(--muted)]">{t('hosting.freeplan.sub', 'Host a small repo at no cost — {gb} GB storage, {mbps} Mbps upload, forever free.').replace('{gb}', free.storageGB).replace('{mbps}', (free.uploadLimitKbps / 1024).toFixed(1))}</div>
                <div className="text-xs text-[var(--faint)] mt-1">{t('hosting.freeplan.note', 'One free repo per account. You can always upgrade the size later — the free floor still applies, so you only ever pay for what\'s above it.')}</div>
              </div>
              <Button variant="primary" className="!bg-emerald-600 hover:!bg-emerald-500 !border-transparent shrink-0" disabled={freeDisabled} onClick={() => checkout({ planId: free.id })}>
                <Gift size={16} /> {freeTierSoldOut ? t('hosting.freeplan.soldout', 'Free plan sold out') : freeDisabled ? t('hosting.nospace', 'Not enough space') : t('hosting.freeplan.cta', 'Get it free')}</Button>
            </div>
            {freeTierPct != null && (
              <div className="mt-4 pt-3 border-t border-emerald-500/15">
                <div className="flex items-center justify-between text-xs text-[var(--muted)] mb-1">
                  <span>{t('hosting.freeplan.pool', 'Free-tier pool remaining')}</span>
                  <span className="font-medium tabular-nums">{c.freeTierFreeGB.toFixed(1)} / {c.freeTierCapGB} GB</span>
                </div>
                <div className="h-1.5 rounded-full bg-emerald-500/15 overflow-hidden"><div className={`h-full ${freeTierPct > 90 ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${freeTierPct}%` }} /></div>
              </div>
            )}
          </Card>
        );
      })()}

      {plans.loading ? <Loading /> : <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-5 items-stretch pt-2">
        {(plans.data?.plans || []).filter((pl) => pl.priceMonthlyCents > 0).map((pl) => {
          // A plan can be individually unavailable (not enough free space for ITS
          // size) even while the pool isn't fully soldOut — disable just that card.
          const planDisabled = soldOut || (!!c && pl.storageGB > c.freeGB);
          const recommended = pl.storageGB === 25;
          return (
          <div key={pl.id} role="button" tabIndex={0} aria-disabled={planDisabled} onClick={() => !planDisabled && addHosting({ planId: pl.id })}
            onKeyDown={(e) => { if (e.key === 'Enter' && !planDisabled) addHosting({ planId: pl.id }); }}
            className={`group card overflow-hidden text-center relative flex flex-col transition-all duration-200 ${planDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:-translate-y-1.5'} ${recommended && !planDisabled ? 'md:scale-[1.04] md:z-10 !border-[var(--primary)] shadow-lg shadow-orange-500/15' : ''}`}>
            {/* Diagonal corner ribbon on the recommended tier (image-2 style). */}
            {recommended && !planDisabled && (
              <span className="absolute top-0 right-0 w-[104px] h-[104px] overflow-hidden pointer-events-none z-20">
                <span className="absolute rotate-45 text-white text-[9px] font-extrabold tracking-wider text-center py-1 shadow-md" style={{ width: 150, top: 22, right: -40, background: 'linear-gradient(90deg,#f97316,#f59e0b)' }}>{t('hosting.popular2', 'RECOMMENDED')}</span>
              </span>
            )}
            {/* Uniform tier header — every card looks the same. */}
            <div className="px-5 pt-6 pb-5 border-b border-[var(--line)]">
              <HardDrive size={20} className="mx-auto transition-transform group-hover:scale-110 text-[var(--primary-2)]" />
              <div className="text-4xl font-extrabold mt-2 leading-none">{pl.storageGB}<span className="text-lg font-semibold text-[var(--muted)]"> GB</span></div>
              <div className="text-[11px] font-semibold uppercase tracking-wider mt-1 text-[var(--faint)]">{t('hosting.storage', 'Storage')}</div>
            </div>
            {/* body — speed, price, CTA */}
            <div className="p-5 flex-1 flex flex-col">
              <div className="text-xs text-[var(--faint)] flex items-center justify-center gap-1"><Zap size={12} />{(pl.uploadLimitKbps / 1024).toFixed(0)} Mbps {t('hosting.uploadword', 'upload')}</div>
              {(() => {
                // Price anchoring: show the un-discounted monthly rate struck through next
                // to the (lower) prepaid-term rate, plus a "−N%" pill — the saving reads
                // instantly instead of being buried in a "billed for 12 mo" line.
                const eff = termTotal(pl.priceMonthlyCents) / 100 / months;
                const base = pl.priceMonthlyCents / 100;
                const save = months > 1 ? Math.round((1 - eff / base) * 100) : 0;
                return (<>
                  <div className="mt-3 flex items-end justify-center gap-1.5">
                    {save > 0 && <span className="text-sm text-[var(--faint)] line-through mb-1">${base.toFixed(2)}</span>}
                    <span className="text-3xl font-bold gradient-text leading-none">${eff.toFixed(2)}</span>
                    <span className="text-sm text-[var(--muted)] font-medium mb-0.5">{t('hosting.permo', '/mo')}</span>
                  </div>
                  <div className="text-[11px] text-[var(--muted)] mb-4 mt-1 flex items-center justify-center gap-1.5 flex-wrap">
                    {months > 1 ? <><span>${(termTotal(pl.priceMonthlyCents) / 100).toFixed(2)} {t('hosting.billedfor', 'billed for')} {months} {t('hosting.mo', 'mo')}</span>{save > 0 && <span className="text-[10px] font-bold text-[var(--success)] bg-[var(--success-bg)] border border-[var(--success-border)] rounded-full px-1.5 py-0.5">−{save}%</span>}</> : t('hosting.billedmonthly', 'billed monthly')}
                  </div>
                </>);
              })()}
              <Button variant={recommended && !planDisabled ? 'primary' : 'default'} disabled={planDisabled} className="w-full mt-auto" onClick={(e) => { e.stopPropagation(); addHosting({ planId: pl.id }); }}>
                {planDisabled ? t('hosting.nospace', 'Not enough space') : <><ShoppingCart size={15} /> {t('cart.add', 'Add to cart')}</>}</Button>
            </div>
          </div>
          ); })}
      </div>}

      {/* Custom plan */}
      <Card className="p-6 mt-4 flex flex-col sm:flex-row items-center gap-4 bg-gradient-to-r from-orange-500/10 to-transparent">
        <Sliders size={26} className="text-[var(--primary-2)]" />
        <div className="flex-1 text-center sm:text-left"><div className="font-semibold text-lg">{t('hosting.custom.title', 'Need a different size?')}</div>
          <div className="text-sm text-[var(--muted)]">{t('hosting.custom.sub2', 'Build a custom plan — pick your storage and upload speed. Price adapts instantly.')}</div></div>
        <Button variant="default" disabled={soldOut} onClick={() => setCustomOpen(true)}><Sliders size={16} /> {soldOut ? t('hosting.soldout.short', 'Sold out') : t('hosting.custom.cta', 'Build custom plan')}</Button>
      </Card>

      {/* Enterprise / bespoke — no fixed price, contact us for a tailored quote. */}
      <Card className="p-6 mt-4 flex flex-col sm:flex-row items-center gap-4 bg-gradient-to-r from-[var(--primary)]/10 to-transparent" style={{ borderColor: 'var(--ring)' }}>
        <Building2 size={26} className="text-[var(--primary-2)] shrink-0" />
        <div className="flex-1 text-center sm:text-left">
          <div className="font-semibold text-lg">{t('hosting.enterprise.title', 'Enterprise / bespoke')}</div>
          <div className="text-sm text-[var(--muted)]">{t('hosting.enterprise.sub', "Bigger needs — high storage/bandwidth, dedicated resources, an SLA, custom terms. No fixed price: tell us what you need and we'll tailor a plan.")}</div>
        </div>
        <Button variant="default" onClick={() => nav('/contact?topic=enterprise-hosting')}><Mail size={16} /> {t('hosting.enterprise.cta', 'Contact us')}</Button>
      </Card>

      {/* Boost an existing repo — added to the same cart (one-time, priced per day). */}
      {user && (myRepos.data?.repos || []).some((r) => r.hosted || r.listed) && (
        <BoostAddCard repos={(myRepos.data?.repos || []).filter((r) => r.hosted || r.listed)} onAdd={addBoost} />
      )}

      <p className="text-xs text-[var(--faint)] mt-5 flex items-center gap-1.5"><ShieldCheck size={13} /> {t('hosting.note', 'Updates only require a valid SHA. We set the upload limit per repo.')}</p>
      <CustomPlanModal open={customOpen} onClose={() => setCustomOpen(false)} months={months} setMonths={setMonths} termDisc={TERM_DISC} onCheckout={(custom) => { setCustomOpen(false); addHosting({ custom, label: t('cart.custom', 'Custom {gb} GB').replace('{gb}', custom.storageGB) }); }} />
      <CartPanel open={cartOpen} setOpen={setCartOpen} cart={cart} count={cartCount} removeItem={removeItem} setItemAutoRenew={setItemAutoRenew} clearCart={clearCart} />
    </div>
  );
}

// A small "add a boost to the cart" card: pick one of your repos + a duration.
function BoostAddCard({ repos, onAdd }) {
  const { t } = useI18n();
  const [repoId, setRepoId] = useState(repos[0]?.id || '');
  const [days, setDays] = useState(7);
  const { data: fp } = useAsync(() => api.get(`/hosting/feature-price?days=${days}`).catch(() => null), [days]);
  const repo = repos.find((r) => r.id === repoId);
  return (
    <Card className="p-6 mt-4 flex flex-col sm:flex-row items-center gap-4 bg-gradient-to-r from-amber-500/10 to-transparent">
      <Rocket size={26} className="text-amber-400 shrink-0" />
      <div className="flex-1 w-full">
        <div className="font-semibold text-lg">{t('cart.boost.title', 'Boost a repo to the top')}</div>
        <div className="text-sm text-[var(--muted)] mb-2">{t('cart.boost.sub', 'Feature one of your repos at the top of the public listing for a set number of days.')}</div>
        <div className="grid sm:grid-cols-[1fr_auto_auto] gap-2 items-end">
          <Select value={repoId} onChange={(e) => setRepoId(e.target.value)}>{repos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
          <Select className="!w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))}>{[3, 7, 14, 30, 90].map((d) => <option key={d} value={d}>{d} {t('cart.days', 'days')}</option>)}</Select>
          <Button variant="primary" disabled={!repoId} onClick={() => onAdd({ repoId, repoName: repo?.name, days })}><ShoppingCart size={15} /> {t('cart.add', 'Add to cart')}{fp?.priceCents != null ? ` · $${(fp.priceCents / 100).toFixed(2)}` : ''}</Button>
        </div>
      </div>
    </Card>
  );
}

// Floating shopping cart: line items + stacked promo codes + a live server quote,
// then one Stripe checkout for the whole bundle. Responsive (a bottom-right panel on
// desktop, near-fullscreen sheet on mobile) with a collapsed pill when closed.
function CartPanel({ open, setOpen, cart, count, removeItem, setItemAutoRenew }) {
  const { t } = useI18n(); const toast = useToast(); const { user } = useAuth(); const nav = useNavigate();
  // The cart is portaled to <body>, so it escapes AppReveal's intro fade — gate it
  // explicitly: NOTHING may show during the intro (only the intro's own controls).
  const { active: introActive } = useIntro();
  const [codes, setCodes] = useState([]);
  const [codeInput, setCodeInput] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoteErr, setQuoteErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false); // must accept Terms + Payments policy before paying
  const apiItems = useMemo(() => cart.map((it) => it.kind === 'hosting'
    ? { kind: 'hosting', mode: it.mode, repoName: it.repoName, months: it.months, autoRenew: !!it.autoRenew, ...(it.custom ? { custom: it.custom } : { planId: it.planId }) }
    : { kind: 'boost', repoId: it.repoId, days: it.days, autoRenew: !!it.autoRenew }), [cart]);
  // Live quote (debounced) whenever the cart or promo set changes.
  useEffect(() => {
    if (!cart.length) { setQuote(null); setQuoteErr(null); return; }
    const id = setTimeout(async () => {
      try { setQuote(await api.post('/hosting/cart/quote', { items: apiItems, promoCodes: codes })); setQuoteErr(null); }
      catch (x) { setQuote(null); setQuoteErr(x.data?.error || 'quote_failed'); }
    }, 350);
    return () => clearTimeout(id);
  }, [apiItems, codes, cart.length]);
  const money = (c) => `$${((c || 0) / 100).toFixed(2)}`;
  const addCode = () => { const v = codeInput.trim().toUpperCase(); if (v && !codes.includes(v)) setCodes((c) => [...c, v]); setCodeInput(''); };
  const promoErr = quoteErr && quoteErr.startsWith('promo_');
  const checkout = async () => {
    if (!user) return nav('/auth');
    if (!agreed) return toast.error(t('cart.mustagree', 'Please accept the Terms and Payments policy first.'));
    setBusy(true);
    try {
      const res = await api.post('/hosting/cart/checkout', { items: apiItems, promoCodes: codes, acceptedTerms: true });
      window.location = res.url;
    } catch (x) {
      const e = x.data?.error;
      if (e === 'creator_link_required') { toast.error(t('hosting.err.link', 'Link a BMM creator id first (Profile → Creator IDs) to host a repo.')); nav('/profile'); }
      else if (e === 'cart_makes_free') toast.error(t('cart.err.free', 'The total is free — remove a promo or use a free-hosting grant code instead.'));
      else if (e === 'promo_not_stackable') toast.error(t('cart.err.stack', 'Those codes can’t be combined — only stackable codes stack.'));
      else if (e === 'capacity_full') toast.error(t('hosting.err.capacity', 'No capacity available right now.'));
      else if (e === 'stripe_not_configured') toast.error(t('hosting.err.stripe', 'Payments not configured yet.'));
      else if (e === 'terms_not_accepted') toast.error(t('cart.mustagree', 'Please accept the Terms and Payments policy first.'));
      else if (e?.startsWith('promo_')) toast.error(t('cart.err.promo', 'A code is invalid or not eligible.'));
      else toast.error(t('hosting.err.checkout', 'Checkout failed — {e}').replace('{e}', e || (x.status ? `HTTP ${x.status}` : 'unknown')));
    } finally { setBusy(false); }
  };
  if (!count || introActive) return null;
  // Rendered through a portal to <body> so no page-level ancestor (opacity/anim
  // wrappers, reveal transforms) can turn `fixed` into a clipped absolute — that
  // was making the cart + its button hide under the footer and go un-clickable.
  if (!open) return createPortal((
    <button onClick={() => setOpen(true)} className="fixed bottom-20 md:bottom-4 right-3 md:right-4 z-[90] flex items-center gap-2 pl-3.5 pr-4 py-3 rounded-2xl text-white font-semibold shadow-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:brightness-105 transition">
      <span className="relative"><ShoppingCart size={18} /><span className="absolute -top-2 -right-2 grid place-items-center w-4 h-4 rounded-full bg-white text-orange-600 text-[10px] font-bold">{count}</span></span>
      {t('cart.title', 'Cart')}
    </button>
  ), document.body);
  return createPortal((
    <div className="fixed z-[90] inset-x-2 bottom-[4.75rem] md:inset-x-auto md:right-4 md:bottom-4 md:w-[24rem] max-h-[70vh] md:max-h-[calc(100vh-2rem)] flex flex-col rounded-2xl border border-[var(--line-strong)] overflow-hidden" style={{ background: 'var(--bg-solid)', boxShadow: '0 24px 70px -18px rgba(0,0,0,0.6)' }}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--line)]">
        <ShoppingCart size={16} className="text-[var(--primary-2)]" />
        <span className="font-semibold flex-1">{t('cart.your', 'Your cart')} <span className="text-[var(--faint)] font-normal">· {count}</span></span>
        <button onClick={() => setOpen(false)} className="text-[var(--faint)] hover:text-[var(--text)]"><ChevronDown size={18} /></button>
      </div>
      <div className="overflow-auto p-3 space-y-2 flex-1">
        {cart.map((it) => (
          <div key={it.uid} className="rounded-lg bg-[var(--surface-2)] px-3 py-2">
            <div className="flex items-center gap-2 text-sm">
              {it.kind === 'boost' ? <Rocket size={14} className="text-amber-400 shrink-0" /> : <HardDrive size={14} className="text-[var(--primary-2)] shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{it.kind === 'boost' ? t('cart.boostof', 'Boost "{n}"').replace('{n}', it.repoName || '') : (it.label || it.repoName)}</div>
                <div className="text-[11px] text-[var(--faint)]">{it.kind === 'boost' ? `${it.days} ${t('cart.days', 'days')} · ${it.autoRenew ? t('cart.recurring', 'recurring') : t('cart.onetime', 'one-time')}` : `${t('hosting.pool', 'Storage pool')} · ${it.months} ${t('hosting.mo', 'mo')}`}</div>
              </div>
              <button onClick={() => removeItem(it.uid)} className="text-[var(--faint)] hover:text-red-400 shrink-0"><X size={14} /></button>
            </div>
            {/* Per-item auto-renew — hosting renews as a subscription after the prepaid
                term; a boost re-bills every N days. Both cancellable in Billing. */}
            <label className="flex items-center gap-1.5 mt-1.5 text-[11px] text-[var(--muted)] cursor-pointer" title={it.kind === 'boost' ? t('cart.autorenew.hb', 'Keep this repo featured automatically — re-bills every {n} days. Cancel anytime in Billing.').replace('{n}', it.days) : t('cart.autorenew.h', 'Keep this repo online automatically — after the prepaid term it renews as a subscription. Cancel anytime in Billing.')}>
              <input type="checkbox" checked={!!it.autoRenew} onChange={(e) => setItemAutoRenew(it.uid, e.target.checked)} />
              <RefreshCw size={11} className={it.autoRenew ? 'text-emerald-400' : 'text-[var(--faint)]'} /> {it.kind === 'boost' ? t('cart.autorenew.boost', 'Auto-renew every {n} days').replace('{n}', it.days) : t('cart.autorenew', 'Auto-renew after the prepaid term')}
            </label>
          </div>
        ))}
        {/* Promo codes (stack the stackable ones) */}
        <div className="pt-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('cart.promos', 'Promo codes')}</div>
          <div className="flex gap-1.5">
            <Input className="!py-1.5 !text-sm" value={codeInput} onChange={(e) => setCodeInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCode()} placeholder={t('cart.promoph', 'Enter a code')} />
            <Button size="sm" onClick={addCode}><Plus size={13} /></Button>
          </div>
          {codes.length > 0 && <div className="flex flex-wrap gap-1.5 mt-2">{codes.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--surface-2)] border border-[var(--line)] text-xs font-mono">{c}<button onClick={() => setCodes((x) => x.filter((k) => k !== c))} className="text-[var(--faint)] hover:text-red-400"><X size={10} /></button></span>
          ))}</div>}
          {promoErr && <div className="text-[11px] text-red-400 mt-1.5">{quoteErr === 'promo_not_stackable' ? t('cart.err.stack', 'Those codes can’t be combined — only stackable codes stack.') : quoteErr === 'promo_not_discount' ? t('cart.err.notdiscount', 'Only discount codes apply in the cart.') : t('cart.err.promo', 'A code is invalid or not eligible.')}</div>}
        </div>
      </div>
      <div className="border-t border-[var(--line)] p-3 space-y-1.5">
        {quote && (<>
          <div className="flex justify-between text-sm text-[var(--muted)]"><span>{t('cart.subtotal', 'Subtotal')}</span><span className="tabular-nums">{money(quote.subtotalCents)}</span></div>
          {quote.discountCents > 0 && <div className="flex justify-between text-sm text-emerald-400"><span>{t('cart.discount', 'Discount')}{quote.combinedPct ? ` (−${quote.combinedPct}%)` : ''}</span><span className="tabular-nums">−{money(quote.discountCents)}</span></div>}
          <div className="flex justify-between font-bold text-base pt-1 border-t border-[var(--line)]"><span>{t('cart.total', 'Total')}</span><span className="tabular-nums">{money(quote.totalCents)}</span></div>
        </>)}
        {quoteErr && !promoErr && <div className="text-[11px] text-amber-400">{quoteErr === 'capacity_full' ? t('hosting.err.capacity', 'No capacity available right now.') : quoteErr === 'over_limit' ? t('cart.err.overlimit', 'A custom plan exceeds the per-repo upload limit.') : t('cart.err.quote', 'Could not price the cart.')}</div>}
        <label className="flex items-start gap-2 text-[11px] text-[var(--muted)] cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span dangerouslySetInnerHTML={{ __html: t('cart.agree', 'I accept the <a href="/legal/terms" target="_blank" class="text-[var(--primary-2)] underline">Terms</a> and the <a href="/legal/refunds" target="_blank" class="text-[var(--primary-2)] underline">Payments & Refunds</a> policy, and I understand that content I host is my responsibility.') }} />
        </label>
        <Button variant="primary" className="w-full mt-1" disabled={busy || !count || !agreed} onClick={checkout}>{busy ? <Spinner /> : <><CreditCard size={15} /> {t('cart.checkout', 'Checkout')}{quote ? ` · ${money(quote.totalCents)}` : ''}</>}</Button>
        <p className="text-[10px] text-[var(--faint)] text-center">{t('cart.note2', 'Prepaid now for the whole cart. Items marked auto-renew continue as a subscription after their term.')}</p>
      </div>
    </div>
  ), document.body);
}

function CustomPlanModal({ open, onClose, onCheckout, months = 12, setMonths, termDisc = { 1: 0, 3: 0.05, 6: 0.10, 12: 0.20, 24: 0.35 } }) {
  const { t } = useI18n();
  const [spec, setSpec] = useState({ storageGB: 20, uploadMbps: 8 });
  const [price, setPrice] = useState(null);
  const [factors, setFactors] = useState(null); // { maxUploadMbps } — admin/scarcity caps
  const [promo, setPromo] = useState(null);
  const disc = termDisc[months] || 0;
  const afterTerm = price == null ? null : Math.round(price * months * (1 - disc));
  const termTotal = afterTerm == null ? null : promo?.percentOff ? Math.round(afterTerm * (1 - promo.percentOff / 100)) : afterTerm;
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => {
      api.get(`/hosting/price?${new URLSearchParams({ storageGB: spec.storageGB, uploadMbps: spec.uploadMbps })}`)
        .then((r) => { setPrice(r.priceMonthlyCents); setFactors(r.factors || null); }).catch(() => setPrice(null));
    }, 200);
    return () => clearTimeout(id);
  }, [open, spec]);
  // Clamp the upload slider to the current per-repo ceiling (admin + scarcity).
  const upMax = Math.min(200, factors?.maxUploadMbps ?? 200);
  useEffect(() => {
    setSpec((sp) => (sp.uploadMbps > upMax) ? { ...sp, uploadMbps: Math.min(sp.uploadMbps, upMax) } : sp);
  }, [upMax]);
  const sliders = [
    { key: 'storageGB', label: t('hosting.s.storage', 'Storage'), min: 1, max: 200, step: 1, fmt: (v) => `${v} GB`, icon: HardDrive },
    { key: 'uploadMbps', label: t('hosting.s.upload', 'Upload speed'), min: 1, max: upMax, step: 1, fmt: (v) => `${v} Mbps`, icon: Zap },
  ];
  return (
    <Modal open={open} onClose={onClose} title={t('hosting.custom.modaltitle', 'Build a custom plan')} icon={Sliders} width="max-w-lg"
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button><Button variant="primary" onClick={() => onCheckout(spec, promo?.code)}><ShoppingCart size={15} /> {t('cart.add', 'Add to cart')}</Button></>}>
      <div className="space-y-5">
        {/* Live spec summary chips — see the whole plan at a glance while dragging */}
        <div className="flex flex-wrap gap-2">
          {sliders.map((s) => <Badge key={s.key} tone="primary"><s.icon size={11} /> {s.fmt(spec[s.key])}</Badge>)}
        </div>
        {sliders.map((s) => (
          <div key={s.key}>
            <div className="flex items-center justify-between mb-1.5 text-sm"><span className="flex items-center gap-1.5 text-[var(--muted)]"><s.icon size={14} /> {s.label}</span><span className="font-semibold">{s.fmt(spec[s.key])}</span></div>
            <input type="range" min={s.min} max={s.max} step={s.step} value={spec[s.key]} className="bcw-range"
              onChange={(e) => setSpec({ ...spec, [s.key]: Number(e.target.value) })} />
          </div>
        ))}

        {/* prepaid term — same discounts, as a dropdown */}
        <div>
          <div className="text-sm text-[var(--muted)] mb-1.5 flex items-center gap-1.5"><Receipt size={14} /> {t('hosting.term', 'Billing term')}</div>
          <TermSelect months={months} setMonths={setMonths} termDisc={termDisc} t={t} />
        </div>

        <div>
          <div className="text-sm text-[var(--muted)] mb-1.5 flex items-center gap-1.5"><Ticket size={14} /> {t('hosting.promo.label', 'Promo code')}</div>
          <PromoCodeField months={months} onChange={setPromo} />
        </div>

        <div className="pt-3 border-t border-[var(--line)] space-y-1.5">
          {price != null && (
            <div className="flex items-center justify-between text-xs text-[var(--faint)]">
              <span>{t('hosting.baseprice', 'Base price')}</span>
              <span className={disc > 0 || promo?.percentOff ? 'line-through' : ''}>${(price * months / 100).toFixed(2)}</span>
            </div>
          )}
          {disc > 0 && <div className="flex items-center justify-between text-xs text-emerald-400"><span>{t('hosting.termdiscount', 'Term discount')}</span><span>−{Math.round(disc * 100)}%</span></div>}
          {promo?.percentOff && <div className="flex items-center justify-between text-xs text-emerald-400"><span>{t('hosting.promo.label', 'Promo code')} ({promo.code})</span><span>−{promo.percentOff}%</span></div>}
          <div className="flex items-end justify-between pt-1.5">
            <div>
              <span className="text-sm text-[var(--muted)]">{t('hosting.estprice', 'Estimated price')}</span>
              {termTotal != null && months > 1 && <div className="text-xs text-[var(--faint)] mt-0.5">${(termTotal / 100).toFixed(2)} {t('hosting.billedfor', 'billed for')} {months} {t('hosting.mo', 'mo')}</div>}
            </div>
            <span className="text-3xl font-bold gradient-text">{termTotal == null ? '—' : `$${(termTotal / 100 / months).toFixed(2)}`}<span className="text-sm text-[var(--muted)] font-medium">{t('hosting.permo', '/mo')}</span></span>
          </div>
        </div>
      </div>
    </Modal>
  );
}

