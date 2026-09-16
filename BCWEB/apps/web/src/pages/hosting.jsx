import { useEffect, useState, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import {
  Rocket, Upload, CheckCircle2, XCircle, HardDrive, Gauge, Zap, Sliders, Receipt, Plus, Mail, RefreshCw, X, ChevronDown, AlertTriangle, Ticket, CreditCard, Gift, Layers, ShoppingCart, Save, MessageSquare, Server, Boxes, Check, Globe, Star, CalendarClock,
} from 'lucide-react';
import { Button, Card, Badge, Input, Select, PageHeader, Spinner, Modal, bestByteUnit, bytesInUnit, useDialog, useToast } from '../ui/ui.jsx';
import { api } from '../lib/api.js';
import { normaliseTerm, discountFor, snapTerm, termTotalCents, nextTier } from '../lib/hosting-term.js';
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
// min-h: see the shared Loading in pages.jsx. The plans grid arriving under a 40px spinner
// moved everything below it by ~500px, which is most of the page's CLS.
const Loading = () => <div className="flex items-center gap-2 text-[var(--muted)] py-10 min-h-[10rem]"><Spinner /> Loading…</div>;

/* ─────────────────────────  Hosting  ───────────────────────── */
/**
 * The billing term — any number of months the admin allows.
 *
 * It was five buttons (1 / 3 / 6 / 12 / 24). Five is what the discount table had rows for,
 * not what anyone asked for: somebody paying until the end of a school year wants 9, and the
 * server now prices 9 exactly (nine × monthly, at the 6-month rate). So the control is the
 * number itself — a slider for the sweep, a stepper for the exact figure — bounded by what
 * `GET /hosting/plans` says the site sells (`term.min/max/step`, set by the admin). The tier
 * chips under it are the old five, kept as shortcuts because they are where the price steps.
 *
 * The sentence beside the number is the point of the whole control: "12 months → $X (−20 %)",
 * priced against a real plan, live, so the discount is a number and not a promise.
 */
function TermControl({ months, setMonths, term, sample, t }) {
  const { min, max, step, presets, tiers } = term;
  const pick = (m) => setMonths(snapTerm(term, m));
  const disc = Math.round(discountFor(tiers, months) * 100);
  const next = nextTier(term, months);
  const total = sample ? termTotalCents(sample.priceMonthlyCents, months, tiers) : null;
  const label = (m) => `${m} ${m === 1 ? t('hosting.month1', 'month') : t('hosting.months', 'months')}`;
  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-3 text-sm mb-2">
            <span className="text-[var(--muted)] flex items-center gap-1.5"><CalendarClock size={14} /> {t('hosting.term', 'Billing term')}</span>
            <span className="font-semibold tabular-nums">{label(months)}{disc > 0 && <span className="ms-2 text-[10.5px] font-bold text-success bg-success-bg border border-success-border rounded-full px-1.5 py-0.5 leading-none align-middle">−{disc}%</span>}</span>
          </div>
          <input type="range" min={min} max={max} step={step} value={months} className="bcw-range"
            aria-label={t('hosting.term', 'Billing term')} aria-valuetext={label(months)}
            onChange={(e) => pick(e.target.value)} />
          <div className="flex justify-between text-[11px] text-[var(--faint)] mt-1 tabular-nums"><span>{label(min)}</span><span>{label(max)}</span></div>
        </div>
        {/* The exact figure. Typing 500 lands on the maximum, typing 5 on a step of 3 lands
            on the nearest term that exists — the server would refuse anything else anyway,
            and a control that lets you pick a number you cannot buy is a trap. */}
        <label className="text-xs text-[var(--muted)] flex flex-col gap-1 sm:w-40">
          {t('hosting.term.exact', 'Or type it')}
          <span className="flex items-center gap-1.5">
            <Input type="number" min={min} max={max} step={step} value={months} className="!w-28"
              aria-label={t('hosting.term.months', 'Months')}
              onChange={(e) => { const v = e.target.value; if (v !== '') pick(v); }}
              onBlur={(e) => pick(e.target.value)} />
            <span className="text-[var(--faint)] whitespace-nowrap">{t('hosting.mo', 'mo')}</span>
          </span>
        </label>
      </div>
      {presets.length > 1 && (
        <div className="flex flex-wrap gap-1.5 mt-3" role="group" aria-label={t('hosting.term.presets', 'Common terms')}>
          {presets.map((m) => {
            const d = Math.round(discountFor(tiers, m) * 100);
            const active = m === months;
            return (
              <button key={m} type="button" aria-pressed={active} onClick={() => pick(m)}
                className={`rounded-full border px-2.5 py-1 text-[12px] leading-none transition-colors tabular-nums ${active ? 'border-[var(--primary)] bg-[var(--primary)]/[0.08] text-[var(--primary-2)] font-semibold' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`}>
                {m} {t('hosting.mo', 'mo')}{d > 0 && <span className={`ms-1 ${active ? '' : 'text-success'}`}>−{d}%</span>}
              </button>
            );
          })}
        </div>
      )}
      {/* Live, against a real plan. `sample` is the recommended plan (or the cheapest paid
          one), so the sentence is the same one the card under it will show. */}
      <div className="mt-3 text-[13px] flex flex-wrap items-center gap-x-2 gap-y-1">
        {total != null && (
          <span>
            <span className="text-[var(--muted)]">{sample.name}:</span>{' '}
            <span className="font-semibold tabular-nums">{label(months)} → ${(total / 100).toFixed(2)}</span>
            {disc > 0 && <span className="text-success font-semibold"> (−{disc}%)</span>}
            {months > 1 && <span className="text-[var(--faint)]"> · ${(total / 100 / months).toFixed(2)} {t('hosting.permo', '/mo')}</span>}
          </span>
        )}
        {next && <span className="text-[var(--faint)]">{t('hosting.term.next', '{n} months would be −{pct}%.').replace('{n}', next.months).replace('{pct}', Math.round(next.off * 100))}</span>}
      </div>
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
        <Input className="!ps-8" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder={t('hosting.promo.ph', 'Promo code (optional)')} />
        {checking && <Spinner className="absolute right-3 top-1/2 -translate-y-1/2" />}
      </div>
      {state?.error && <div className="text-xs text-error mt-1 flex items-center gap-1"><XCircle size={12} /> {t('hosting.promo.invalid', 'Invalid or expired code.')}</div>}
      {state?.promo && state.promo.kind === 'discount' && !termTooShort && (
        <div className="text-xs text-success mt-1 flex items-center gap-1"><CheckCircle2 size={12} /> {state.promo.percentOff ? t('hosting.promo.pct', '{pct}% off applied').replace('{pct}', state.promo.percentOff) : state.promo.freeMonths ? t('hosting.promo.free', 'First {n} months free').replace('{n}', state.promo.freeMonths) : t('hosting.promo.ok', 'Code applied.')}</div>
      )}
      {/* Free-hosting / free-boost codes aren't checkout discounts — they redeem
          directly. Surface that with a one-click "Use this code" modal flow. */}
      {state?.promo && state.promo.kind !== 'discount' && (
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <span className="text-xs text-success flex items-center gap-1"><Gift size={12} />
            {state.promo.kind === 'free_hosting'
              ? t('hosting.promo.hostcode', 'Free hosting code: {gb} GB repo at no cost.').replace('{gb}', state.promo.storageGB)
              : t('hosting.promo.boostcode', 'Boost code: {d} days featured.').replace('{d}', state.promo.boostDays)}
          </span>
          <Button size="sm" variant="primary" onClick={() => setRedeemOpen(true)}>{t('hosting.promo.use', 'Use this code')}</Button>
        </div>
      )}
      {termTooShort && <div className="text-xs text-warning mt-1 flex items-center gap-1"><AlertTriangle size={12} /> {t('hosting.promo.minmonths', 'This code needs a {n}+ month term.').replace('{n}', state.promo.minMonths)}</div>}
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
        ? t('promo.gotHosting', 'Redeemed! A free hosted repo was created, see "My repos".')
        : t('promo.gotBoost', 'Redeemed! Your repo is now boosted.'));
      onClose(); nav('/dashboard');
    } catch (x) {
      const e = x.data?.error;
      toast.error(e === 'already_used' ? t('promo.used', 'You already used this code.')
        : e === 'depleted' ? t('promo.depleted', 'This code is fully used.')
        : e === 'expired' ? t('promo.expired', 'This code has expired.')
        : e === 'busy' ? t('promo.busy', 'Busy, try again in a second.')
        : t('repos.failed', 'Failed.'));
    } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={t('hosting.promo.modal', 'Redeem code')} icon={Gift} width="max-w-md"
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
        <Button variant="primary" disabled={busy || (isBoost && !repoId)} onClick={apply}>{busy ? <Spinner /> : t('hosting.promo.apply', 'Apply code')}</Button></>}>
      <div className="flex items-center gap-3 p-3 rounded-xl border border-success-border bg-success/[0.06] mb-4">
        <Gift size={20} className="text-success shrink-0" />
        <div className="text-sm">
          <div className="font-semibold">{code}</div>
          <div className="text-[var(--muted)]">
            {isBoost ? t('hosting.promo.boostdesc', 'Boosts one of your repos to the featured spots for {d} days.').replace('{d}', promo.boostDays)
              : t('hosting.promo.hostdesc', 'Creates a free hosted repo: {gb} GB storage{months}.').replace('{gb}', promo.storageGB).replace('{months}', promo.hostMonths ? ` for ${promo.hostMonths} months` : ', no expiry')}
          </div>
        </div>
      </div>
      {isBoost && (
        repos === null ? <div className="py-4 grid place-items-center"><Spinner /></div>
        : !repos.length ? <div className="text-sm text-[var(--muted)]">{t('hosting.promo.norepos', "You don't have any repos yet, host one first, then redeem the boost.")}</div>
        : <div className="space-y-1.5 max-h-56 overflow-auto">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1">{t('promo.pickrepo', 'Which repo should get the boost?')}</div>
            {repos.map((r) => (
              <button key={r.id} type="button" onClick={() => setRepoId(r.id)}
                className={`w-full text-start px-3 py-2 rounded-xl border text-sm flex items-center gap-2 transition ${repoId === r.id ? 'border-[var(--primary)] tint-primary' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`}>
                <HardDrive size={14} className={repoId === r.id ? 'text-[var(--primary)]' : 'text-[var(--faint)]'} />
                <span className="flex-1 truncate" title={r.name}>{r.name}</span>
                {repoId === r.id && <CheckCircle2 size={14} className="text-[var(--primary)]" />}
              </button>
            ))}
          </div>
      )}
    </Modal>
  );
}

/**
 * "Tell me when there is room."
 *
 * The page's answer to a full disk was "try again later", which is the site asking a stranger
 * to remember to come back. This is what turns that into a promise it can keep.
 *
 * Asks for the SIZE as well as the address, because "there is space" is not an answer if the
 * space is 2 GB and they came for 50 — being told about room that is not room for you is
 * worse than not being told. A signed-in visitor is not asked for an address at all: the
 * account's own is the one we know is theirs, and it is what stops the form becoming a way to
 * sign somebody else up.
 *
 * `freeTier` matters because the two pools are metered separately: the free-plan ceiling can
 * be full while the disk has plenty, and somebody waiting for a free repo must not be called
 * back by paid space they were never going to buy.
 */
function WaitlistBox({ user, freeTier = false, defaultGB = 5 }) {
  const { t } = useI18n(); const toast = useToast();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [gb, setGb] = useState(defaultGB);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post('/hosting/waitlist', {
        wantedGB: Math.max(1, Math.min(10000, Math.round(Number(gb) || 0))),
        freeTier,
        ...(user ? {} : { email: email.trim() }),
      });
      setDone(r);
    } catch (e) {
      toast.error(e?.data?.error === 'email_required'
        ? t('hosting.wl.needmail', 'An e-mail address is needed, that is how you get told.')
        : t('common.failed', 'Failed.'));
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="mt-3 text-sm text-[var(--text)] flex items-start gap-2">
        <CheckCircle2 size={16} className="text-success shrink-0 mt-0.5" />
        <span>
          {t('hosting.wl.done', 'You are on the list, we will write to you when {n} GB is free.').replace('{n}', gb)}
          {done.ahead > 0 && ` ${t('hosting.wl.ahead', '{n} ahead of you.').replace('{n}', done.ahead)}`}
          {' '}<span className="text-[var(--faint)]">{t('hosting.wl.noreserve', 'Nothing is reserved, whoever checks out first gets it.')}</span>
        </span>
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="mt-2.5 text-sm font-medium text-[var(--primary-2)] hover:underline inline-flex items-center gap-1.5">
        <Mail size={14} /> {t('hosting.wl.open', 'Tell me when there is room')}
      </button>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <label className="text-xs text-[var(--muted)] flex flex-col gap-1">
        {t('hosting.wl.gb', 'How much do you need?')}
        <span className="flex items-center gap-1.5">
          <Input className="!w-24 !py-1.5" type="number" min="1" max="10000" value={gb} onChange={(e) => setGb(e.target.value)} />
          <span className="text-[var(--faint)]">GB</span>
        </span>
      </label>
      {!user && (
        <label className="text-xs text-[var(--muted)] flex flex-col gap-1 flex-1 min-w-[220px]">
          {t('hosting.wl.mail', 'Where do we write?')}
          <Input className="!py-1.5" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </label>
      )}
      <Button size="sm" variant="primary" disabled={busy || (!user && !email.trim())} onClick={submit}>
        {busy ? <Spinner /> : <Mail size={14} />} {t('hosting.wl.cta', 'Let me know')}
      </Button>
      {user && <span className="text-[11px] text-[var(--faint)] basis-full">{t('hosting.wl.acct', 'Sent to your account address, and to your notifications here.')}</span>}
    </div>
  );
}

export function Hosting() {
  const { user } = useAuth(); const nav = useNavigate(); const dialog = useDialog(); const toast = useToast(); const { t } = useI18n();
  const location = useLocation();
  const plans = useAsync(() => api.get('/hosting/plans'), []);
  const cap = useAsync(() => api.get('/hosting/capacity'), []);
  // Every purchase is now a storage POOL you fill freely with repos and/or catalogs —
  // the single-repo layout toggle was removed. `mode` stays 'multi' throughout.
  const [mode] = useState('multi');
  // The term the site sells — bounds and discount tiers from the server, never a table here.
  // Read from the same request as the plans so the two cannot disagree.
  const term = useMemo(() => normaliseTerm(plans.data?.term), [plans.data]);
  const [months, setMonthsRaw] = useState(12); // prepaid term (1yr recommended)
  const setMonths = (m) => setMonthsRaw(snapTerm(term, m));
  // The admin's bounds arrive after the first render; a default of 12 on a site that sells
  // 3-to-6 would otherwise price a term the checkout is about to refuse.
  useEffect(() => { if (plans.data?.term) setMonthsRaw((m) => snapTerm(term, m)); }, [plans.data, term]);
  // `/hosting#plans` from anywhere — a CTA on another page, the hero button, a pasted link —
  // lands on the plans. The browser does this on its own only for a full page load with the
  // section already in the DOM; an in-app navigation renders the page first and the plans
  // grid only after the request answers, so the scroll waits for both. `location.key`
  // changes on every navigation, so clicking the same link twice scrolls twice.
  useEffect(() => {
    if (location.hash !== '#plans' || plans.loading) return;
    // setTimeout, not requestAnimationFrame: a background tab never gets a frame, and the
    // scroll would be lost the moment the tab came forward. Instant, not the page's smooth
    // default: a smooth scroll aims at where the heading was when it started, and the hero
    // above is still settling its height at that moment — measured landing 350px past it.
    const id = setTimeout(() => document.getElementById('plans')?.scrollIntoView({ block: 'start', behavior: 'instant' }), 0);
    return () => clearTimeout(id);
  }, [location.hash, location.key, plans.loading]);
  const [promo, setPromo] = useState(null); // validated promo code for the simple plan-card checkout
  const [autoRenew, setAutoRenew] = useState(true); // recurring subscription vs one-time prepaid
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
  // Turning a line into a gift also turns auto-renew OFF, and not as a nicety: auto-renew on a
  // gift charges the GIVER's card indefinitely for something somebody else is using. The server
  // refuses it too — this just stops the checkbox showing a promise the server will not keep.
  const setItemGift = (uid, giftTo) => setCart((c) => c.map((x) => (
    x.uid === uid ? { ...x, giftTo, ...(giftTo ? { autoRenew: false } : {}) } : x)));
  const clearCart = () => setCart([]);
  const cartCount = cart.length;
  const termTotal = (monthlyCents) => termTotalCents(monthlyCents, months, term.tiers, promo?.percentOff || 0);
  const checkout = async (body) => {
    if (!user) return nav('/auth');
    const repoName = await dialog.prompt({ title: mode === 'multi' ? t('hosting.pool.title', 'New storage pool') : t('hosting.repo.title', 'Host a repo'), label: mode === 'multi' ? t('hosting.pool.label', 'Pool name') : t('hosting.repo.label', 'Repository name'), placeholder: mode === 'multi' ? t('hosting.pool.ph', 'my-pool') : t('hosting.repo.ph', 'my-awesome-repo'), okLabel: t('hosting.continue', 'Continue to payment') });
    if (!repoName) return;
    try {
      const res = await api.post('/hosting/checkout', { promoCode: promo?.code, autoRenew, ...body, repoName, mode, months });
      // A $0 plan (the free tier, or a discount that zeroes it out) is provisioned
      // directly — there's no Stripe session/url to redirect to.
      if (res?.free) { toast.success(t('hosting.freeplan.pool2', 'Your storage pool "{name}" is ready, free tier. Add repos or catalogs to it.').replace('{name}', repoName)); return nav('/dashboard'); }
      window.location = res.url;
    } catch (x) {
      if (x.data?.error === 'creator_link_required') { toast.error(t('hosting.err.link', 'Link a BMM creator id first (Profile → Creator IDs) to host a repo.')); return nav('/profile'); }
      const e = x.data?.error;
      toast.error(e === 'capacity_full' ? t('hosting.err.capacity', 'No capacity available right now.')
        : e === 'over_limit' ? t('hosting.err.overlimit2', 'That exceeds the current per-repo upload limit (max {u} Mbps). Lower it and retry.').replace('{u}', x.data.maxUploadMbps)
        : e === 'free_tier_full' ? t('hosting.err.freetierfull', 'The free plan is sold out right now, every free slot is taken. Try a paid plan, or check back later.')
        : e === 'free_tier_already_used' ? t('hosting.err.freeused', "You've already used your one free repo (per account and per linked creator id), pick a paid plan instead.")
        : e === 'stripe_not_configured' ? t('hosting.err.stripe', 'Payments not configured yet.') : t('hosting.err.checkout', 'Checkout failed.'));
    }
  };
  // Read once and passed down: the hero, the comparison and the free card all quote the
  // same plan, and three separate `.find()` calls is three places to drift.
  const freePlan = (plans.data?.plans || []).find((pl) => pl.priceMonthlyCents === 0) || null;
  const paidPlans = (plans.data?.plans || []).filter((pl) => pl.priceMonthlyCents > 0);
  // The plan the page recommends, and the one the term control prices its example against:
  // the 25 GB one when there is one (the size most people end up with), else the middle of
  // the range. One decision, used by the pill on the card AND the sentence above it.
  const samplePlan = paidPlans.find((pl) => pl.storageGB === 25) || paidPlans[Math.floor((paidPlans.length - 1) / 2)] || null;
  const c = cap.data?.capacity;
  // Is the free plan actually TAKEABLE right now? Three separate ways it is not: no free
  // plan exists at all (an admin can delete it), the free ceiling is full, or the disk is.
  // Hoisted because the hero, the free card and the comparison must agree — a hero button
  // promising free storage that the card below reports as sold out is worse than no button.
  const freeTierSoldOut = !!c && c.freeTierCapEnabled && c.freeTierFreeGB <= 0.01;
  // Fully sold out — the whole pool is spoken for (or hosting is disabled by an
  // admin). Nothing at all can be bought until an existing repo shrinks/expires.
  const soldOut = !!c && (c.enabled === false || c.freeGB <= 0.01);
  const freeOffered = !!freePlan && !soldOut && !freeTierSoldOut
    && !(!!c && freePlan.storageGB > c.freeGB);
  return (
    <div>
      {/* The page used to open on the configurator — two sliders and a total, for somebody
          who had not yet been told what they would be buying. A price is an answer; this is
          the question it answers. The button goes to the plans, which is where the price
          lives now. */}
      <HostingHero freePlan={freePlan} freeOffered={freeOffered} />

      {soldOut && (
        <div className="rounded-xl border border-error-border bg-error-bg p-4 mb-6 flex items-start gap-3">
          <AlertTriangle size={20} className="text-error shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-error">{t('hosting.soldout', 'No hosting space available right now')}</div>
            <div className="text-sm text-[var(--muted)] mt-0.5">{t('hosting.soldout.d2', 'Every plan is sold out until an existing repo frees up space or an admin raises the total capacity.')}</div>
            {/* "Try again later" was the whole answer, which is the site asking a stranger to
                remember to come back for it. */}
            <WaitlistBox user={user} />
          </div>
        </div>
      )}

      {/* Everything you can actually buy, under one anchor. `scroll-mt` keeps the heading
          clear of the sticky topbar — without it the anchor lands with the title hidden
          under the bar, which reads as the button having done nothing. */}
      {/* min-h while the plans load: the grid is four cards tall and used to arrive under a
          one-line spinner, pushing the comparison and the FAQ down by its whole height. */}
      <section id="plans" className={`scroll-mt-24 ${plans.loading ? 'min-h-[28rem]' : ''}`}>
      <SectionLead
        title={t('hosting.plans.title', 'Pick a size, or set your own')}
        sub={t('hosting.plans.sub', 'The same space either way, the four below are just the sizes people ask for most.')} />

      {/* Free tier — a real $0 plan, called out on its own instead of blending into
          the paid grid below (it isn't really "one of the four tiers", it's the
          answer to "can I try this for free?"). Paid plans never draw from this
          pool — it's tracked completely separately from Total capacity above —
          and a free repo can always be upgraded to a bigger paid size later (the
          free floor keeps applying, so you're only ever billed for the excess). */}
      {!plans.loading && (() => {
        const free = freePlan;
        if (!free) return null;
        const freeDisabled = !freeOffered;
        const freeTierPct = c?.freeTierCapEnabled && c.freeTierCapGB ? Math.min(100, (c.freeTierUsedGB / c.freeTierCapGB) * 100) : null;
        return (
          <Card className="p-5 mb-2 bg-success/[0.04] overflow-hidden relative" style={{ borderColor: 'var(--success-border)' }}>
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <Gift size={20} className="text-success shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[15px]">{t('hosting.freeplan.title', 'Just want to try it out?')}</div>
                {/* "forever free" was not what the code does: the free pool is provisioned
                    for the term picked above, like a paid one, and has to be renewed — at no
                    cost — when it runs out (POST /me/hosting/groups/:id/renew prices it to
                    zero and applies it on the spot). Free, yes; without an end date, no. */}
                <div className="text-[13px] text-[var(--muted)] mt-0.5">{t('hosting.freeplan.sub2', 'Host a small repo at no cost: {gb} GB storage, {mbps} Mbps upload, no card.').replace('{gb}', free.storageGB).replace('{mbps}', (free.uploadLimitKbps / 1024).toFixed(1))}</div>
                <div className="text-[12px] text-[var(--faint)] mt-1">{freeTierSoldOut
                  ? t('hosting.freeplan.soldout.d', 'The free allowance is fully taken right now. It is metered on its own, so the paid sizes below are unaffected — leave your name and we will tell you the moment one frees up.')
                  : t('hosting.freeplan.note2', 'One free repo per account (and per linked creator id). It runs for the term chosen above and renewing it costs nothing. You can always upgrade the size later — the free floor still applies, so you only ever pay for what\'s above it.')}</div>
              </div>
              <Button variant="primary" className="!bg-success hover:!bg-success !border-transparent shrink-0" disabled={freeDisabled} onClick={() => checkout({ planId: free.id })}>
                <Gift size={16} /> {freeTierSoldOut ? t('hosting.freeplan.soldout', 'Free plan sold out') : freeDisabled ? t('hosting.nospace', 'Not enough space') : t('hosting.freeplan.cta', 'Get it free')}</Button>
            </div>
            {/* The free ceiling and the disk are metered separately, so this pool can be full
                while there is plenty of room next door. Somebody waiting for a free repo is
                waiting on THIS number — being called back by paid space they were never going
                to buy is not an answer. */}
            {freeTierSoldOut && <WaitlistBox user={user} freeTier defaultGB={free.storageGB} />}
            {freeTierPct != null && (
              <div className="mt-4 pt-3 border-t border-success-border">
                <div className="flex items-center justify-between text-xs text-[var(--muted)] mb-1">
                  <span>{t('hosting.freeplan.pool', 'Free-tier pool remaining')}</span>
                  <span className="font-medium tabular-nums">{c.freeTierFreeGB.toFixed(1)} / {c.freeTierCapGB} GB</span>
                </div>
                <div className="h-1.5 rounded-full bg-success-bg overflow-hidden"><div className={`h-full ${freeTierPct > 90 ? 'bg-error' : 'bg-success'}`} style={{ width: `${freeTierPct}%` }} /></div>
              </div>
            )}
          </Card>
        );
      })()}

      <SubLead icon={HardDrive}
        title={t('hosting.sizes.t', 'The ready-made sizes')}
        sub={t('hosting.sizes.s', 'Four of them, because these are the ones people ask for. Anything else is a slider away, just below.')} />

      {/* The term is chosen ONCE, here, for everything priced below it — the four cards and
          the custom build alike. It used to sit inside the configurator, which sat UNDER the
          cards: changing it repriced four cards nobody was looking at. A control belongs
          above the numbers it moves. */}
      <TermBar months={months} setMonths={setMonths} term={term} sample={samplePlan} />

      {/* One column on a phone, two from sm, three from lg, four from xl. It was a
          scroll-snap row at 78 % of the viewport below sm; a thumb found the next card, but
          the feature list each card now carries needs the full width to be read, and a card
          you have to swipe back to is a card you cannot compare. `min-w-0` on every cell:
          a long plan name is the one thing in here that can push a grid track wider than
          its column, and it is the one thing an admin types freely. */}
      {plans.loading ? <Loading /> : <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 lg:gap-5 items-stretch">
        {paidPlans.map((pl) => {
          // A plan can be individually unavailable (not enough free space for ITS
          // size) even while the pool isn't fully soldOut — disable just that card.
          const planDisabled = soldOut || (!!c && pl.storageGB > c.freeGB);
          const recommended = pl.id === samplePlan?.id;
          const bytes = (pl.storageGB || 0) * (1024 ** 3); const u = bestByteUnit(bytes);
          const storageLabel = `${Number(bytesInUnit(bytes, u).toFixed(2))} ${u}`;
          const mbps = (pl.uploadLimitKbps / 1024).toFixed(0);
          // Price anchoring: the un-discounted monthly rate struck through beside the
          // (lower) prepaid rate, and a "−N%" pill — the saving reads at a glance.
          const total = termTotal(pl.priceMonthlyCents);
          const eff = total / 100 / months;
          const base = pl.priceMonthlyCents / 100;
          const save = months > 1 ? Math.round((1 - eff / base) * 100) : 0;
          // What the plan includes, as a list a reader can tick through, in the order somebody
          // comparing four cards actually reads: the two numbers that differ (storage,
          // bandwidth), then the boosts — the one advantage that is not just a bigger number,
          // so it carries a second line saying what a boost DOES — then the custom domain, then
          // the free tier, because "is there a free one" is the question the grid was missing
          // an answer to. Each row is [icon, label, included, note].
          const boosts = pl.boostsPerPeriod > 0
            ? (pl.boostPeriodMonths > 1
              ? t('hosting.card.boosts', '{n} featured boosts ({d} days each) every {m} months').replace('{n}', pl.boostsPerPeriod).replace('{d}', pl.boostDays ?? 7).replace('{m}', pl.boostPeriodMonths)
              : t('hosting.card.boosts1', '{n} featured boosts ({d} days each) every month').replace('{n}', pl.boostsPerPeriod).replace('{d}', pl.boostDays ?? 7))
            : null;
          const freeLine = freePlan
            ? (freeOffered
              ? [t('hosting.card.free', 'Free {s} plan available, no card').replace('{s}', `${freePlan.storageGB} GB`), true]
              : [t('hosting.card.freeout', 'The free plan is sold out right now'), false])
            : [t('hosting.card.nofree', 'No free plan at the moment'), false];
          const features = [
            [HardDrive, t('hosting.card.storage', '{s} of storage, split how you like').replace('{s}', storageLabel), true],
            [Zap, t('hosting.card.upload', '{m} Mbps of download bandwidth').replace('{m}', mbps), true],
            [Star, boosts || t('hosting.card.noboosts', 'Boosts bought separately'), !!boosts, t('hosting.card.boostis', 'A boost puts you first')],
            [Globe, t('hosting.card.domain', 'Your own domain, per repo or catalogue'), true],
            [Gift, freeLine[0], freeLine[1]],
          ];
          return (
          // The recommended card stands FORWARD, not just differently coloured: a ring, a lift
          // and a shadow. Four cards where one is tinted is four cards; one that sits a few
          // pixels in front of the others is a choice the page has already made for you. The
          // scale only from lg, where the grid has room for it to grow without touching its
          // neighbours, and never on a card that cannot be bought.
          <div key={pl.id} className={`card relative flex flex-col p-5 min-w-0 transition-transform ${planDisabled ? 'opacity-60' : ''} ${recommended && !planDisabled ? 'z-10 !border-[var(--primary)] bg-[var(--primary)]/[0.06] ring-2 ring-[var(--primary)] shadow-[0_12px_32px_-14px_var(--primary)] lg:scale-[1.03]' : ''}`}>
            {/* A filled pill rather than a word floating in the padding — four cards with a
                gap at the top of three of them read as three cards missing something. The
                other three keep an invisible copy so the bodies stay on the same line. */}
            <div className="mb-3">
              <span className={`inline-block text-[10px] font-bold uppercase tracking-[0.1em] rounded-full px-2 py-1 leading-none ${recommended && !planDisabled ? 'bg-[var(--primary)] text-white' : 'invisible'}`} aria-hidden={!recommended || planDisabled}>
                {t('hosting.popular2', 'RECOMMENDED')}
              </span>
            </div>
            <div className="text-[15px] font-semibold truncate" title={pl.name}>{pl.name}</div>
            {/* The price, right under the name: it is what the card is for. Prepaid, so
                "$X /mo" is the effective rate and the line under it is what is actually
                charged, once, for the term chosen above. */}
            <div className="mt-2 flex items-end gap-1.5 flex-wrap">
              {save > 0 && <span className="text-[13px] text-[var(--faint)] line-through mb-0.5 tabular-nums">${base.toFixed(2)}</span>}
              <span className="text-[2rem] font-extrabold leading-none tabular-nums">${eff.toFixed(2)}</span>
              <span className="text-[13px] text-[var(--muted)] mb-0.5">{t('hosting.permo', '/mo')}</span>
              {save > 0 && <span className="text-[10px] font-bold text-success bg-success-bg border border-success-border rounded-full px-1.5 py-0.5 mb-0.5">−{save}%</span>}
            </div>
            <div className="text-[12px] text-[var(--muted)] mt-1.5 tabular-nums">
              {months > 1
                ? t('hosting.card.period', '{total} for {n} months, paid up front').replace('{total}', `$${(total / 100).toFixed(2)}`).replace('{n}', months)
                : t('hosting.card.period1', '{total} for one month, paid up front').replace('{total}', `$${(total / 100).toFixed(2)}`)}
            </div>
            <ul className="mt-4 pt-4 border-t border-[var(--line)] flex flex-col gap-2">
              {features.map(([Icon, label, yes, note]) => (
                <li key={label} className={`flex items-start gap-2 text-[13px] leading-snug min-w-0 ${yes ? '' : 'text-[var(--faint)]'}`}>
                  {yes ? <Check size={15} className="text-success shrink-0 mt-[1px]" aria-hidden /> : <Icon size={15} className="shrink-0 mt-[1px]" aria-hidden />}
                  <span className="min-w-0">
                    {label}
                    {/* Only under the line that needs it: "3 boosts" is a quantity of
                        something a first-time reader has never heard of. */}
                    {yes && note && <span className="block text-[11px] text-[var(--faint)]">{note}</span>}
                  </span>
                </li>
              ))}
            </ul>
            {/* Pinned to the bottom: feature lists differ in length (boosts or not), and
                without this the four buttons sat at four heights in a row whose job is
                comparing them. */}
            <div className="mt-auto pt-5">
              <Button variant={recommended && !planDisabled ? 'primary' : 'default'} disabled={planDisabled} className="w-full" onClick={() => addHosting({ planId: pl.id })}>
                {planDisabled ? t('hosting.nospace', 'Not enough space') : <><ShoppingCart size={15} /> {t('cart.add', 'Add to cart')}</>}</Button>
            </div>
          </div>
          ); })}
      </div>}

      {/* The other half of the offer: none of the four fits, so build one. Given its own
          heading instead of being a second card under the grid — it is an alternative to
          the sizes above, not an extra on top of them. */}
      <SubLead icon={Sliders}
        title={t('hosting.cfg.title', 'Pick your size, the price follows')}
        sub={t('hosting.cfg.sub', 'One pool, filled with whatever you like: one repo, several, catalogs, or a mix. Resize the split whenever you want.')} />
      <PoolConfigurator months={months} tiers={term.tiers} soldOut={soldOut} capacity={c}
        onAdd={(custom) => addHosting({ custom, label: t('cart.custom', 'Custom {gb} GB').replace('{gb}', custom.storageGB) })} />

      {/* Boost an existing repo — added to the same cart (one-time, priced per day). */}
      {user && (myRepos.data?.repos || []).some((r) => r.hosted || r.listed) && (<>
        <SubLead icon={Rocket}
          title={t('hosting.boost.t', 'Already hosting something?')}
          sub={t('hosting.boost.s2', 'Put one of them in front of more people for a few days. Priced per day, in the same cart — it re-bills only if you leave auto-renew ticked on that line.')} />
        <BoostAddCard repos={(myRepos.data?.repos || []).filter((r) => r.hosted || r.listed)} onAdd={addBoost} />
      </>)}
      </section>

      <HostingCompare freePlan={freePlan} />
      <HostingFaq />

      {/* Talk to us — THREE doors, not one.
          It used to be a single "Contact us" under one paragraph that tried to cover a
          bigger plan, hosting something that is not a repo, and everything else at once. A
          person who wanted their Discord bot hosted had to recognise themselves in a
          sentence about SLAs, and whatever they wrote arrived filed as "Something else".
          Each button carries its own ?topic=, which sets the form's kind AND its template —
          so the queue counts what people actually asked for. */}
      <SectionLead
        title={t('hosting.talk.h', 'Then tell us what you need')}
        sub={t('hosting.talk.h.sub', 'Three doors, so what you write arrives where somebody can answer it.')} />
      {/* The heading above already says what this is. It used to say it, and then the card
          said it again in a larger font beside a building icon. */}
      <Card className="p-6">
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {[
            ['hosting-plan', Server, t('hosting.talk.plan', 'A bigger hosting plan'),
              t('hosting.talk.plan.d', 'More storage or bandwidth than any plan listed, an SLA, dedicated resources, invoicing.')],
            // Worded as a question on purpose. Running somebody's site or bot is not
            // something the platform does yet, and a card that reads like an order form
            // would collect people expecting one.
            ['host-project', Rocket, t('hosting.talk.project', 'Host a project of mine'),
              t('hosting.talk.project.d', 'A site, a Discord bot, an app. Not something we sell yet, tell us what it is and we will say honestly where we are.')],
            ['', MessageSquare, t('hosting.talk.other', 'Something else'),
              t('hosting.talk.other.d', 'Anything that is neither of those.')],
          ].map(([topic, Icon, label, desc]) => {
            const to = topic ? `/contact?topic=${topic}` : '/contact';
            return (
              <button key={label} type="button" onClick={() => nav(to)}
                className="text-start rounded-xl border border-[var(--line)] p-4 hover:border-[var(--ring)] transition-colors">
                <div className="flex items-center gap-2 font-medium text-[14px]"><Icon size={15} className="text-[var(--primary-2)]" /> {label}</div>
                <div className="text-[12px] text-[var(--muted)] mt-1.5 leading-relaxed">{desc}</div>
              </button>
            );
          })}
        </div>

        <div className="text-xs text-[var(--faint)] mt-4 flex items-center gap-1.5">
          <Mail size={13} className="shrink-0" />
          {user
            ? t('hosting.enterprise.msg', "You're signed in, send it as a message and we'll reply in your dashboard → Reports, so the whole conversation stays in one place.")
            : t('hosting.enterprise.signin', 'You can email us right away, or sign in first to send it as a message and track the reply in your dashboard.')}
        </div>
      </Card>

      <CartPanel open={cartOpen} setOpen={setCartOpen} cart={cart} count={cartCount} removeItem={removeItem} setItemAutoRenew={setItemAutoRenew} setItemGift={setItemGift} clearCart={clearCart} />
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
    <Card className="p-6 mt-4 flex flex-col sm:flex-row items-center gap-4 bg-gradient-to-r from-[var(--primary-2)] to-transparent">
      <Rocket size={26} className="text-warning shrink-0" />
      <div className="flex-1 w-full">
        <div className="font-semibold text-lg">{t('cart.boost.title', 'Boost a repo to the top')}</div>
        <div className="text-sm text-[var(--muted)] mb-2">{t('cart.boost.sub', 'Feature one of your repos at the top of the public listing for a set number of days.')}</div>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 items-end [&>button]:w-full sm:[&>button]:w-auto">
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
function CartPanel({ open, setOpen, cart, count, removeItem, setItemAutoRenew, setItemGift }) {
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
    ? { kind: 'hosting', mode: it.mode, repoName: it.repoName, months: it.months, autoRenew: !!it.autoRenew,
      ...(it.giftTo ? { giftTo: it.giftTo } : {}),
      ...(it.custom ? { custom: it.custom } : { planId: it.planId }) }
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
      else if (e === 'cart_makes_free') toast.error(t('cart.err.free', 'The total is free, remove a promo or use a free-hosting grant code instead.'));
      else if (e === 'promo_not_stackable') toast.error(t('cart.err.stack', 'Those codes can’t be combined, only stackable codes stack.'));
      else if (e === 'capacity_full') toast.error(t('hosting.err.capacity', 'No capacity available right now.'));
      else if (e === 'stripe_not_configured') toast.error(t('hosting.err.stripe', 'Payments not configured yet.'));
      else if (e === 'terms_not_accepted') toast.error(t('cart.mustagree', 'Please accept the Terms and Payments policy first.'));
      else if (e?.startsWith('promo_')) toast.error(t('cart.err.promo', 'A code is invalid or not eligible.'));
      else toast.error(t('hosting.err.checkout', 'Checkout failed: {e}').replace('{e}', e || (x.status ? `HTTP ${x.status}` : 'unknown')));
    } finally { setBusy(false); }
  };
  if (!count || introActive) return null;
  // Rendered through a portal to <body> so no page-level ancestor (opacity/anim
  // wrappers, reveal transforms) can turn `fixed` into a clipped absolute — that
  // was making the cart + its button hide under the footer and go un-clickable.
  if (!open) return createPortal((
    <button onClick={() => setOpen(true)} className="fixed bottom-20 md:bottom-4 right-3 md:right-4 z-[90] flex items-center gap-2 ps-3.5 pe-4 py-3 rounded-2xl text-white font-semibold shadow-xl bg-gradient-to-r from-brand to-brand-2 hover:brightness-105 transition">
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
              {it.kind === 'boost' ? <Rocket size={14} className="text-warning shrink-0" /> : <HardDrive size={14} className="text-[var(--primary-2)] shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{it.kind === 'boost' ? t('cart.boostof', 'Boost "{n}"').replace('{n}', it.repoName || '') : (it.label || it.repoName)}</div>
                <div className="text-[11px] text-[var(--faint)]">{it.kind === 'boost' ? `${it.days} ${t('cart.days', 'days')} · ${it.autoRenew ? t('cart.recurring', 'recurring') : t('cart.onetime', 'one-time')}` : `${t('hosting.pool', 'Storage pool')} · ${it.months} ${t('hosting.mo', 'mo')}`}</div>
              </div>
              <button onClick={() => removeItem(it.uid)} className="text-[var(--faint)] hover:text-error shrink-0"><X size={14} /></button>
            </div>
            {/* Per-item auto-renew — hosting renews as a subscription after the prepaid
                term; a boost re-bills every N days. Both cancellable in Billing. */}
            <label className="flex items-center gap-1.5 mt-1.5 text-[11px] text-[var(--muted)] cursor-pointer" title={it.kind === 'boost' ? t('cart.autorenew.hb', 'Keep this repo featured automatically, re-bills every {n} days. Cancel anytime in Billing.').replace('{n}', it.days) : t('cart.autorenew.h', 'Keep this repo online automatically, after the prepaid term it renews as a subscription. Cancel anytime in Billing.')}>
              <input type="checkbox" checked={!!it.autoRenew} disabled={!!it.giftTo} onChange={(e) => setItemAutoRenew(it.uid, e.target.checked)} />
              <RefreshCw size={11} className={it.autoRenew ? 'text-success' : 'text-[var(--faint)]'} /> {it.kind === 'boost' ? t('cart.autorenew.boost', 'Auto-renew every {n} days').replace('{n}', it.days) : t('cart.autorenew', 'Auto-renew after the prepaid term')}
            </label>

            {/* Buying it for somebody else.
                Only on a hosting line: a boost applies to a repo you already own, so there is
                nobody else to give it to. */}
            {it.kind !== 'boost' && (
              <div className="mt-1.5">
                <label className="flex items-center gap-1.5 text-[11px] text-[var(--muted)] cursor-pointer">
                  <input type="checkbox" checked={it.giftTo !== undefined}
                    onChange={(e) => setItemGift(it.uid, e.target.checked ? '' : undefined)} />
                  <Gift size={11} className={it.giftTo !== undefined ? 'text-[var(--primary-2)]' : 'text-[var(--faint)]'} />
                  {t('cart.gift', 'This is a gift for somebody else')}
                </label>
                {it.giftTo !== undefined && (
                  <div className="mt-1.5">
                    <Input value={it.giftTo} onChange={(e) => setItemGift(it.uid, e.target.value)}
                      className="!py-1.5 !text-[12px]"
                      placeholder={t('cart.gift.ph', 'Their BC id (BC-XXXX-XXXX) or e-mail')} />
                    <p className="text-[11px] text-[var(--faint)] mt-1">
                      {t('cart.gift.h', 'They get a code by e-mail and redeem it themselves — no card needed. It works even if they do not have an account yet. Auto-renew is off on a gift: it would keep charging YOUR card.')}
                    </p>
                  </div>
                )}
              </div>
            )}
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
            <span key={c} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--surface-2)] border border-[var(--line)] text-xs font-mono">{c}<button onClick={() => setCodes((x) => x.filter((k) => k !== c))} className="text-[var(--faint)] hover:text-error"><X size={10} /></button></span>
          ))}</div>}
          {promoErr && <div className="text-[11px] text-error mt-1.5">{quoteErr === 'promo_not_stackable' ? t('cart.err.stack', 'Those codes can’t be combined, only stackable codes stack.') : quoteErr === 'promo_not_discount' ? t('cart.err.notdiscount', 'Only discount codes apply in the cart.') : t('cart.err.promo', 'A code is invalid or not eligible.')}</div>}
        </div>
      </div>
      <div className="border-t border-[var(--line)] p-3 space-y-1.5">
        {quote && (<>
          <div className="flex justify-between text-sm text-[var(--muted)]"><span>{t('cart.subtotal', 'Subtotal')}</span><span className="tabular-nums">{money(quote.subtotalCents)}</span></div>
          {quote.discountCents > 0 && <div className="flex justify-between text-sm text-success"><span>{t('cart.discount', 'Discount')}{quote.combinedPct ? ` (−${quote.combinedPct}%)` : ''}</span><span className="tabular-nums">−{money(quote.discountCents)}</span></div>}
          <div className="flex justify-between font-bold text-base pt-1 border-t border-[var(--line)]"><span>{t('cart.total', 'Total')}</span><span className="tabular-nums">{money(quote.totalCents)}</span></div>
        </>)}
        {quoteErr && !promoErr && <div className="text-[11px] text-warning">{quoteErr === 'capacity_full' ? t('hosting.err.capacity', 'No capacity available right now.') : quoteErr === 'over_limit' ? t('cart.err.overlimit', 'A custom plan exceeds the per-repo upload limit.') : t('cart.err.quote', 'Could not price the cart.')}</div>}
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

/**
 * The pool configurator, inline.
 *
 * This used to be a modal behind a "Need a different size?" card two thirds down the page, so
 * the one interactive thing on a pricing page — drag a slider, watch the price move — was the
 * thing you had to go looking for. Everything above it was static text and a term dropdown,
 * which is what made the page read as a stack of cards rather than something you buy from.
 *
 * It also answers "what does 20 GB actually hold", because gigabytes are not a unit anybody
 * shops in. The estimate is deliberately coarse and labelled as an estimate — it is a sense
 * of scale, not a promise.
 */
function PoolConfigurator({ months, tiers, soldOut, capacity, onAdd }) {
  const { t } = useI18n();
  const [spec, setSpec] = useState({ storageGB: 20, uploadMbps: 8 });
  const [price, setPrice] = useState(null);
  const [factors, setFactors] = useState(null);
  const [promo, setPromo] = useState(null);
  const disc = discountFor(tiers, months);
  const termTotal = price == null ? null : termTotalCents(price, months, tiers, promo?.percentOff || 0);
  useEffect(() => {
    const id = setTimeout(() => {
      api.get(`/hosting/price?${new URLSearchParams({ storageGB: spec.storageGB, uploadMbps: spec.uploadMbps })}`)
        .then((r) => { setPrice(r.priceMonthlyCents); setFactors(r.factors || null); })
        .catch(() => setPrice(null));
    }, 200);
    return () => clearTimeout(id);
  }, [spec]);
  const upMax = Math.min(200, factors?.maxUploadMbps ?? 200);
  useEffect(() => { setSpec((sp) => (sp.uploadMbps > upMax ? { ...sp, uploadMbps: upMax } : sp)); }, [upMax]);
  // No capacity for this size — say so on the button rather than at checkout.
  const tooBig = !!capacity && spec.storageGB > capacity.freeGB;
  const sliders = [
    { key: 'storageGB', label: t('hosting.s.storage', 'Storage'), min: 1, max: 200, step: 1, fmt: (v) => `${v} GB`, icon: HardDrive },
    { key: 'uploadMbps', label: t('hosting.s.upload', 'Upload speed'), min: 1, max: upMax, step: 1, fmt: (v) => `${v} Mbps`, icon: Zap },
  ];

  return (
    <Card className="p-0 overflow-hidden">
      <div className="grid md:grid-cols-[1fr_300px]">
        {/* left: the controls */}
        <div className="p-5 sm:p-7 space-y-6">
          {sliders.map((s) => (
            <div key={s.key}>
              <div className="flex items-center justify-between mb-1.5 text-sm">
                <span className="flex items-center gap-1.5 text-[var(--muted)]"><s.icon size={14} /> {s.label}</span>
                <span className="font-semibold tabular-nums">{s.fmt(spec[s.key])}</span>
              </div>
              <input type="range" min={s.min} max={s.max} step={s.step} value={spec[s.key]} className="bcw-range"
                aria-label={s.label} onChange={(e) => setSpec({ ...spec, [s.key]: Number(e.target.value) })} />
            </div>
          ))}
          <div>
            <div className="text-sm text-[var(--muted)] mb-1.5 flex items-center gap-1.5"><Ticket size={14} /> {t('hosting.promo.label', 'Promo code')}</div>
            <PromoCodeField months={months} onChange={setPromo} />
          </div>
        </div>
        {/* right: the price, always in view while dragging */}
        <div className="p-5 sm:p-7 border-t md:border-t-0 md:border-s border-[var(--line)] panel flex flex-col">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)]">{t('hosting.estprice', 'Estimated price')}</div>
          <div className="mt-2 flex items-end gap-1.5">
            <span className="text-4xl font-extrabold gradient-text leading-none">{termTotal == null ? '—' : `$${(termTotal / 100 / months).toFixed(2)}`}</span>
            <span className="text-sm text-[var(--muted)] font-medium mb-0.5">{t('hosting.permo', '/mo')}</span>
          </div>
          {termTotal != null && months > 1 && (
            <div className="text-xs text-[var(--faint)] mt-1">${(termTotal / 100).toFixed(2)} {t('hosting.billedfor', 'billed for')} {months} {t('hosting.mo', 'mo')}</div>
          )}
          <div className="mt-3 space-y-1">
            {disc > 0 && <div className="flex items-center justify-between text-xs text-success"><span>{t('hosting.termdiscount', 'Term discount')}</span><span>−{Math.round(disc * 100)}%</span></div>}
            {promo?.percentOff ? <div className="flex items-center justify-between text-xs text-success"><span>{promo.code}</span><span>−{promo.percentOff}%</span></div> : null}
          </div>
          <Button variant="primary" className="w-full mt-4" disabled={soldOut || tooBig || price == null}
            onClick={() => onAdd(spec)}>
            {soldOut ? t('hosting.soldout.short', 'Sold out')
              : tooBig ? t('hosting.nospace', 'Not enough space')
              : <><ShoppingCart size={15} /> {t('cart.add', 'Add to cart')}</>}
          </Button>
          {capacity && (
            <div className="mt-4 pt-3 border-t border-[var(--line)]">
              <div className="flex items-center justify-between text-[11px] text-[var(--muted)] mb-1">
                <span className="flex items-center gap-1.5"><Gauge size={12} /> {t('hosting.free', 'free')}</span>
                <span className="tabular-nums">{capacity.freeGB.toFixed(0)} / {capacity.usableGB.toFixed(0)} GB</span>
              </div>
              <div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden">
                <div className="h-full bg-gradient-to-r from-brand to-brand-2" style={{ width: `${capacity.usableGB ? 100 - (capacity.freeGB / capacity.usableGB) * 100 : 0}%` }} />
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   The page around the prices.

   It used to be a pricing table with a title on top. A pricing table answers
   "how much"; nothing answered "what is it", "do I need it", or "what happens
   when I stop paying" — so the four cards were doing work they are bad at.
   ───────────────────────────────────────────────────────────────────────── */

/** One heading for a section: a title and one line under it.
 *
 *  There used to be a coloured eyebrow above each one — THE PLANS over "Pick a size",
 *  WITH AND WITHOUT over "What changes". A label naming the thing directly beneath it adds
 *  a line of shouting and no information, and five of them down one page turn a document
 *  into a brochure. The heading is the label. */
function SectionLead({ title, sub }) {
  return (
    <div className="mt-14 sm:mt-20 mb-6 sm:mb-7">
      <h2 className="text-2xl sm:text-[1.75rem] font-extrabold tracking-tight text-balance">{title}</h2>
      {sub && <p className="text-[var(--muted)] mt-2 text-[15px] leading-relaxed max-w-2xl">{sub}</p>}
    </div>
  );
}

/** A heading inside a section — smaller than SectionLead, and indented behind an icon so
 *  the two levels are told apart at a glance rather than by font size alone. */
function SubLead({ icon: Icon, title, sub }) {
  return (
    <div className="mt-9 sm:mt-12 mb-4 flex items-start gap-2.5">
      {Icon && <Icon size={17} className="text-[var(--primary-2)] shrink-0 mt-[3px]" />}
      <div className="min-w-0">
        <h3 className="font-bold text-[17px] leading-tight">{title}</h3>
        {sub && <p className="text-[13.5px] text-[var(--muted)] leading-relaxed mt-1 max-w-2xl">{sub}</p>}
      </div>
    </div>
  );
}

/**
 * The billing term, chosen once for the whole section.
 *
 * A full-width row rather than a field tucked in a corner: it is the one control on the page
 * that changes every price at once, and it now sits above all of them.
 */
function TermBar({ months, setMonths, term, sample }) {
  const { t } = useI18n();
  return (
    <Card className="p-4 sm:p-5 mb-7">
      <div className="mb-4">
        <div className="font-semibold text-[14.5px]">{t('hosting.termbar.t4', 'How long you pay for, up front')}</div>
        {/* True to the code, in three sentences: what the term is, what auto-renew does
            (it is ON by default in the cart, so "nothing renews on its own" was false), and
            what happens when it runs out (suspended at once, deleted after the grace). */}
        <p className="text-[12.5px] text-[var(--muted)] mt-1 leading-relaxed max-w-3xl">
          {t('hosting.termbar.s4', 'Every price below is for this many months, paid once at checkout — the longer the term, the less each month costs. In the cart you choose whether it auto-renews: on, and the same term is billed again when it ends (cancel any time from Billing; terms over 12 months never auto-renew); off, and nothing is charged again — the pool is suspended the day the term ends and deleted after a grace period (72 hours by default, a week after a failed payment) unless you renew it.')}
        </p>
      </div>
      <TermControl months={months} setMonths={setMonths} term={term} sample={sample} t={t} />
    </Card>
  );
}

/**
 * The opener: what this is, what you get, and the thing itself.
 *
 * The visual is the PRODUCT, not decoration. A pool is one space you divide between repos
 * and catalogues however you like, and a bar split into named segments with room left over
 * says that in one glance — which is more than the paragraph it replaces managed in three
 * lines. Drawn from the same tokens as everything else, so it holds in both themes.
 */
function HostingHero({ freePlan, freeOffered }) {
  const { t } = useI18n();
  const gb = freePlan?.storageGB;
  // Three, and each says the whole thing on its own line. It was four title-and-paragraph
  // pairs, which is a features section wearing a hero's clothes: eight lines of type to get
  // past before reaching the button they exist to justify.
  const facts = [
    [Layers, t('hosting.hero.p1', 'One space, split how you like')],
    [Zap, t('hosting.hero.p2', 'An address that stops moving')],
    [Receipt, t('hosting.hero.p4', 'Prepaid, or renewing, your call')],
  ];
  return (
    // The first SCREEN, whatever its height: the topbar is 3.5rem + its 0.75rem inset and
    // <main> adds 2.5rem above, so `100svh − 7rem` is exactly the viewport below the chrome.
    // svh, not vh — on a phone the URL bar is part of 100vh and the buttons would sit under
    // it. The plans start where a scroll starts, which is the whole request.
    <div className="relative min-h-[calc(100svh-7rem)] flex flex-col justify-center pb-10">
      <div aria-hidden className="absolute left-1/2 -translate-x-1/2 top-4 w-[720px] max-w-[140%] h-72 rounded-full tint-primary blur-3xl -z-10" />
      <div className="grid lg:grid-cols-[1.05fr_.95fr] gap-7 sm:gap-10 lg:gap-12 items-center">
        <div>
          {/* No badge over the title. It said HOSTING, on the hosting page, above a heading
              about hosting — a third naming of the same thing before a word of substance. */}
          <h1 className="text-3xl sm:text-[2.75rem] font-extrabold tracking-tight leading-[1.06] text-balance">
            {t('hosting.hero.h', 'Somewhere to put your repos and catalogues')}
          </h1>
          <p className="text-[var(--muted)] mt-4 text-[15.5px] leading-relaxed max-w-xl">
            {t('hosting.hero.sub', 'You buy a space. You fill it with whatever you like, we keep it up, you decide what goes in it.')}
          </p>

          <ul className="mt-7 flex flex-col gap-2.5">
            {facts.map(([Icon, label]) => (
              <li key={label} className="flex items-center gap-2.5 text-[14.5px]">
                <Icon size={15} className="text-[var(--primary-2)] shrink-0" />
                <span>{label}</span>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap gap-3 mt-9">
            {/* A real anchor, not a scroll handler: it works with the middle button, it can be
                copied, and `html { scroll-behavior: smooth }` in index.css already animates it. */}
            <a href="#plans"><Button variant="primary" className="!px-6 !py-3">{t('hosting.hero.cta', 'See the plans')} <ChevronDown size={16} /></Button></a>
            {/* Only when the free plan exists AND can actually be taken. A button promising
                free storage that the card below reports as sold out is worse than no button:
                it spends somebody's click to tell them no. */}
            {gb != null && freeOffered && (
              <a href="#plans"><Button className="!px-6 !py-3"><Gift size={16} /> {t('hosting.hero.cta2', 'Start free: {gb} GB').replace('{gb}', gb)}</Button></a>
            )}
          </div>
        </div>

        <PoolDiagram />
      </div>
      {/* A cue, at the bottom of the screen rather than under the buttons: the buttons say
          where the plans are, this says there IS a below. Decorative, so hidden from readers. */}
      <a href="#plans" aria-hidden tabIndex={-1} className="absolute left-1/2 -translate-x-1/2 bottom-2 hidden sm:flex flex-col items-center gap-1 text-[var(--faint)] hover:text-[var(--muted)] transition text-[11px]">
        <ChevronDown size={16} className="animate-bounce" />
      </a>
    </div>
  );
}

/**
 * The pool, drawn.
 *
 * Deliberately NOT a live capacity read: this says what a pool IS, and wiring it to the real
 * disk would make the shape of an explanation depend on how full the servers happen to be —
 * the day it is nearly full, the picture explaining the model would show almost no free room.
 * The real numbers are in the configurator, thirty lines below, where they mean something.
 */
function PoolDiagram() {
  const { t } = useI18n();
  // Inline backgrounds, and NOT Tailwind's `/70` opacity modifier on a var().
  //
  // `bg-[var(--primary)]` compiles to nothing usable: the modifier needs raw channels to
  // build an rgba, and a var() holding a full colour cannot give it those. Two of the three
  // segments rendered with no background at all — one solid block where the whole point was
  // three shares — and the legend beside it showed two blank swatches. It looked deliberate.
  //
  // color-mix toward the surface rather than toward transparent, so each stays opaque and
  // keeps its contrast on either theme's ground.
  // Generic parts with sizes that add up. They were briefly named after two real games,
  // which turned a picture of a pool into an advert for those games — and made it read as a
  // preset rather than as "whatever you put in it". What has to differ between the parts is
  // their SIZE, because that is the thing being explained: you decide the split.
  const TOTAL = 25;
  const seg = [
    { gb: 8, label: t('hosting.diag.s1', 'A repo'), bg: 'var(--primary)' },
    { gb: 5, label: t('hosting.diag.s2', 'Another repo'), bg: 'color-mix(in srgb, var(--primary) 60%, var(--surface-2))' },
    { gb: 4, label: t('hosting.diag.s3', 'A catalogue'), bg: 'color-mix(in srgb, var(--primary-2) 45%, var(--surface-2))' },
  ].map((x) => ({ ...x, w: `${(x.gb / TOTAL) * 100}%` }));
  const freeGB = TOTAL - seg.reduce((a, x) => a + x.gb, 0);
  return (
    <div className="relative">
      <Card className="p-5 sm:p-7">
        <div className="text-[12.5px] text-[var(--muted)] mb-2.5">{t('hosting.diag.ex', 'For example, a {n} GB pool').replace('{n}', TOTAL)}</div>
        <div className="h-12 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] overflow-hidden flex">
          {seg.map((sg) => (
            /* A 2px gap between fills, not a border: a border would eat into the width and
               make the segments lie about their share. */
            <div key={sg.label} className="h-full" style={{ width: sg.w, background: sg.bg, marginInlineEnd: '2px' }} />
          ))}
        </div>
        {/* A breakdown, not a wrapped legend. Four rows with the sizes right-aligned and
            tabular reads as the thing itself — what is in the pool and how much is left —
            where a comma-separated legend read as a key to a chart. */}
        <div className="mt-4 flex flex-col gap-2">
          {seg.map((sg) => (
            <div key={sg.label} className="flex items-center gap-2.5 text-[13px]">
              <i className="inline-block w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: sg.bg }} aria-hidden />
              <span className="flex-1 min-w-0 truncate text-[var(--muted)]" title={sg.label}>{sg.label}</span>
              <span className="tabular-nums font-medium">{sg.gb} {t('hosting.gbshort', 'GB')}</span>
            </div>
          ))}
          <div className="flex items-center gap-2.5 text-[13px] pt-2 mt-0.5 border-t border-[var(--line)]">
            <i className="inline-block w-2.5 h-2.5 rounded-[3px] border border-[var(--line-strong)] shrink-0" aria-hidden />
            <span className="flex-1 min-w-0 truncate text-[var(--muted)]">{t('hosting.diag.spare', 'unused')}</span>
            <span className="tabular-nums font-medium">{freeGB} {t('hosting.gbshort', 'GB')}</span>
          </div>
        </div>
        <p className="text-[12.5px] text-[var(--muted)] leading-relaxed mt-4">
          {t('hosting.diag.note3', 'One space. What goes in it, and how it is split, is yours to change at any time.')}
        </p>
      </Card>
    </div>
  );
}

/**
 * With and without.
 *
 * Three columns, because there are three real situations and the middle one is free — a
 * two-column "you vs us" would be selling against a strawman while a $0 plan sits on the
 * same page.
 */
function HostingCompare({ freePlan }) {
  const { t } = useI18n();
  const gb = freePlan?.storageGB;
  // No free plan on the site — an admin can delete it — means no column about one. A
  // comparison that praises an offer the page does not make is the page lying to itself.
  const cols = [
    {
      k: 'none', tone: 'border-[var(--line)]',
      title: t('hosting.cmp.none', 'Hosting it yourself'),
      sub: t('hosting.cmp.none.s', 'A file host, a drive, your own box.'),
      rows: [
        // Opening on a tick, because it is true. A column of four crosses over "hosting it
        // yourself" is not a comparison, it is a strawman — and the reader most likely to
        // be looking at it is the one who already does it and knows better.
        [true, t('hosting.cmp.none.0b', 'It is your machine: your rules, your uptime, no bill from us')],
        [true, t('hosting.cmp.none.6', 'No size limit other than your own disk')],
        [false, t('hosting.cmp.none.7', 'You are on your own for the address, the certificate, the backups and the abuse')],
        [false, t('hosting.cmp.none.5', 'And nobody finds you here: no page, no search, no catalogue picks you up')],
      ],
    },
    {
      k: 'free', tone: 'border-success-border bg-success/[0.04]',
      title: t('hosting.cmp.free', 'The free plan'),
      sub: gb != null ? t('hosting.cmp.free.s', '{gb} GB, one per account, no card.').replace('{gb}', gb)
        : t('hosting.cmp.free.s2', 'One per account, no card.'),
      rows: [
        [true, t('hosting.cmp.free.1', 'A stable address anything can sync from')],
        [true, t('hosting.cmp.free.5', 'A public page, search, favourites, people can find it')],
        [true, t('hosting.cmp.free.2', 'Downloads counted, for real')],
        // The row the section promised: one place where free is the wrong answer.
        [false, t('hosting.cmp.free.4b', 'One space, and it is a small one')],
      ],
    },
    {
      k: 'paid', tone: 'border-[var(--ring)] bg-[var(--primary)]/[0.05]',
      title: t('hosting.cmp.paid', 'A paid pool'),
      sub: t('hosting.cmp.paid.s', 'The size you pick, split how you like.'),
      rows: [
        [true, t('hosting.cmp.paid.2', 'Several repos AND catalogues in one space')],
        [true, t('hosting.cmp.paid.5', 'Your own domain on a repo or a catalogue')],
        [true, t('hosting.cmp.paid.3', 'A faster upload cap')],
        [true, t('hosting.cmp.paid.6', 'Any size you like, changed whenever you like')],
      ],
    },
  ];
  const shown = cols.filter((col) => col.k !== 'free' || !!freePlan);
  return (
    <>
      <SectionLead title={t('hosting.cmp.title', 'What changes, honestly')} />
      <div className={`grid gap-5 items-stretch ${shown.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
        {shown.map((col) => (
          <div key={col.k} className={`rounded-xl border p-6 flex flex-col ${col.tone}`}>
            <div className="font-bold text-[15.5px]">{col.title}</div>
            <div className="text-[12.5px] text-[var(--muted)] mt-0.5">{col.sub}</div>
            <ul className="mt-5 flex flex-col gap-3">
              {col.rows.map(([yes, text]) => (
                <li key={text} className="flex gap-2 text-[13px] leading-relaxed">
                  {yes
                    ? <CheckCircle2 size={15} className="text-success shrink-0 mt-[2px]" />
                    : <XCircle size={15} className="text-[var(--faint)] shrink-0 mt-[2px]" />}
                  <span className={yes ? '' : 'text-[var(--muted)]'}>{text}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}

/** The questions people ask, including the one nobody puts on a pricing page. */
function HostingFaq() {
  const { t } = useI18n();
  const [open, setOpen] = useState(null);
  const qs = [
    // Checked against the code, not the previous answer. The sweeper (lib/sweeper.mjs)
    // suspends AND schedules deletion in the same pass — one window, not two — and a
    // SUSPENDED repo answers 404 to everyone, its owner included (hosting-content.mjs), so
    // "stays online and downloadable" and "hand it to another account" (no such route)
    // were both wrong.
    [t('hosting.faq.q1', 'What happens if I stop paying?'),
     t('hosting.faq.a1c', 'When a term ends without auto-renew — or a renewal payment fails — the pool is suspended straight away: its repos stop being served and its catalogues stop being listed, for everyone, you included. Nothing is deleted yet. Deletion is scheduled after a grace period (72 hours by default; a week when it was a failed card rather than a decision), and renewing at any point before then puts everything back exactly as it was. You are warned before the term runs out, so download a copy while it is still up — nothing is served while it is suspended.')],
    // There is no pool-resize route: bigger is "buy more and merge" (POST /me/hosting/groups/
    // merge) or a solo repo's in-place upgrade (a new prepaid term); smaller does not exist
    // and nothing is credited. "Pro rata" and "credits the difference" were invented.
    [t('hosting.faq.q2b', 'Can I take a bigger one later? A smaller one?'),
     t('hosting.faq.a2c', 'Bigger, yes: buy another pool and merge the two into one — the space adds up, and the bigger plan\'s rate applies from the next renewal — or upgrade a single repo in place with a new prepaid term for its new size. Smaller, no: a paid pool is never shrunk or refunded mid-term. Let a subscription run out instead, or simply re-split the space between the repos and catalogues inside the pool, which is free and immediate. Nothing changes address either way, so no link you have shared stops working.')],
    [t('hosting.faq.q3b', 'What is the difference between a repo and a catalogue?'),
     t('hosting.faq.a3', 'A repo is the FILES themselves, at a fixed address something can sync from. A catalogue is a LIST people browse and install from. Publishing your own work usually wants a repo; gathering other people’s usually wants a catalogue. A pool holds both, so you do not have to decide now.')],
    [t('hosting.faq.q4b', 'Can I put several repos in one pool?'),
     t('hosting.faq.a4b', 'Yes, and catalogues alongside them — they all draw from the same gigabytes, and there is no per-item limit. Each one gets its own size within the pool, which you move around whenever you like without re-buying anything. The only ceiling is the pool total.')],
    [t('hosting.faq.q5b', 'Can you host my site, or my Discord bot?'),
     t('hosting.faq.a5b', 'No. What is sold here is storage and delivery: we serve files over HTTPS and we do not run your code — no process, no container, no database. Ask anyway with the last card on this page, because that is how we will find out whether enough people want it to be worth building.')],
    // The question this page gets most often after the price one, now that it has an answer.
    [t('hosting.faq.q7', 'Can I use my own domain?'),
     t('hosting.faq.a7b', 'Yes, with a paid pool, one hostname per repo or catalogue. You point a subdomain at us with a CNAME and add one TXT record so we can check the name is yours; from then on it is served over HTTPS on your name, with the certificate obtained on the first visit. The free plan keeps its bettercommunity address.')],
  ];
  return (
    <>
      <SectionLead
        title={t('hosting.faq.title', 'The questions we actually get')}
        sub={t('hosting.faq.sub', 'Starting with the one a pricing page usually leaves out.')} />
      <div className="flex flex-col gap-3">
        {qs.map(([q, a], i) => {
          const isOpen = open === i;
          return (
            <div key={q} className="rounded-xl border border-[var(--line)] bg-[var(--surface)] overflow-hidden">
              {/* A real button with aria-expanded, not a clickable div: this is the one control
                  on the page a keyboard user has to be able to reach. */}
              <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : i)}
                className="w-full text-start px-5 py-4 flex items-center gap-3 hover:bg-[var(--surface-2)] transition-colors">
                <span className="font-semibold text-[14.5px] flex-1">{q}</span>
                <ChevronDown size={16} className={`shrink-0 text-[var(--muted)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </button>
              {isOpen && <p className="px-5 pb-5 -mt-0.5 text-[13.5px] text-[var(--muted)] leading-relaxed max-w-3xl">{a}</p>}
            </div>
          );
        })}
      </div>
    </>
  );
}
