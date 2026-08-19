import { useState, useMemo } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Bot, AppWindow, Globe, Wand2, ShieldCheck, Sparkles, Check, Clock, Package, Download,
  ExternalLink, Lock, ArrowLeft, ArrowRight, Plus, X, FileText, AlertTriangle, CreditCard, MessageSquare, Send,
} from 'lucide-react';
import { api, uploadMyoDeliverable } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from './auth.jsx';
import { Card, Button, Input, Textarea, Select, Badge, Modal, EmptyState, Spinner, Field, useToast, useDialog } from '../ui/ui.jsx';
import Avatar from '../ui/Avatar.jsx';
import { useAsync, useThreadStream } from './pages.jsx';
import { ReportComposer } from '../ui/report.jsx';

// ── shared helpers ──────────────────────────────────────────────────────────────
export const fmtMoney = (cents, cur = 'usd') => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: (cur || 'usd').toUpperCase() }).format((cents || 0) / 100); }
  catch { return `$${((cents || 0) / 100).toFixed(2)}`; }
};
const KIND_META = {
  discord_bot: { icon: Bot, en: 'Discord bot', fr: 'Bot Discord' },
  app: { icon: AppWindow, en: 'Application', fr: 'Application' },
  website: { icon: Globe, en: 'Website', fr: 'Site web' },
  audit: { icon: ShieldCheck, en: 'Security audit', fr: 'Audit de sécurité' },
  custom: { icon: Wand2, en: 'Custom project', fr: 'Projet sur mesure' },
};
const kindMeta = (k) => KIND_META[k] || KIND_META.custom;
// A signature accent per product kind — used only for gradient fills / glows (never text),
// so it stays readable in both themes. Discord blurple for the bot is a nice cue.
const KIND_ACCENT = { discord_bot: '#5865F2', app: '#3b82f6', website: '#14b8a6', audit: '#22c55e', custom: '#8b5cf6' };
const kindAccent = (k) => KIND_ACCENT[k] || KIND_ACCENT.custom;
const STATUS_TONE = { pending_payment: 'amber', open: 'primary', quoted: 'amber', in_production: 'blue', delivered: 'green', closed: '', cancelled: 'red' };
function statusLabel(s, t) {
  return t(`myo.status.${s}`, { pending_payment: 'Awaiting payment', open: 'Open', quoted: 'Quote sent', in_production: 'In production', delivered: 'Delivered', closed: 'Closed', cancelled: 'Cancelled' }[s] || s);
}

// ═══════════════ Public /myo page — catalog + intake + my requests ═══════════════
export function MyoPage() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const nav = useNavigate();
  const cat = useAsync(() => api.get('/myo/products'), []);
  const mine = useAsync(() => user ? api.get('/myo/requests') : Promise.resolve({ requests: [] }), [!!user]);
  const [intake, setIntake] = useState(null); // { kind, productId? } | null
  const cfg = cat.data || {};
  const products = cfg.products || [];
  // The three base options are always offered even before an admin curates the catalog.
  const baseCards = ['discord_bot', 'app', 'website'].map((k) => products.find((p) => p.kind === k) || { kind: k, name: kindMeta(k)[lang === 'fr' ? 'fr' : 'en'], tagline: '', basePriceCents: 0, options: [], includesSource: true });
  const customCard = products.find((p) => p.kind === 'custom') || { kind: 'custom', name: kindMeta('custom')[lang === 'fr' ? 'fr' : 'en'], tagline: t('myo.custom.tag', 'Anything else — a tool, a SaaS, a code audit with CVE/CWE + CVSS…'), basePriceCents: 0, options: [], includesSource: true };
  const extras = products.filter((p) => !['discord_bot', 'app', 'website', 'custom'].includes(p.kind));

  const start = (card) => {
    if (!user) { nav(`/auth?next=${encodeURIComponent('/myo')}`); return; }
    setIntake({ kind: card.kind, productId: card.id || null, product: card });
  };

  if (cfg.enabled === false) {
    return <div className="max-w-2xl mx-auto py-20 px-4"><EmptyState icon={Package} title={t('myo.off.t', 'Not accepting requests right now')} sub={t('myo.off.s', 'The Make Your Own service is temporarily closed. Check back soon.')} /></div>;
  }

  const Consult = ({ cents, urgent }) => <span className="font-semibold">{fmtMoney(cents, cfg.currency)}{urgent ? ` ${t('myo.urgentTag', '(urgent)')}` : ''}</span>;

  return (
    <div className="max-w-6xl mx-auto px-4 py-10 sm:py-14">
      {/* ── Hero ── */}
      <div className="relative text-center max-w-2xl mx-auto mb-12 sm:mb-14">
        <div aria-hidden className="absolute left-1/2 -translate-x-1/2 -top-20 w-[620px] max-w-[130%] h-72 rounded-full bg-[var(--primary)]/15 blur-3xl -z-10" />
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full bg-[var(--primary)]/10 text-[var(--primary-2)] mb-5 border border-[var(--primary)]/25"><Sparkles size={13} /> {t('myo.badge', 'Make Your Own')}</div>
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight leading-[1.05]">{t('myo.title', 'We build it for you')}</h1>
        <p className="text-[var(--muted)] mt-4 text-base sm:text-lg leading-relaxed">{t('myo.sub', 'Need a Discord bot, an app, a website — or something custom like a security audit of your code (CVE / CWE / CVSS)? Start a paid consultation: you get real advice and a fixed quote. We only start building once you approve the quote.')}</p>
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 mt-6 text-xs text-[var(--muted)]">
          {[[FileText, t('myo.trust1', 'Fixed, itemised quote')], [Check, t('myo.trust2', 'You approve before we build')], [Globe, t('myo.trust3', 'English or French')], [ShieldCheck, t('myo.trust4', 'Source on request')]].map(([Ic, tx], i) => (
            <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--surface-2)] border border-[var(--line)]"><Ic size={13} className="text-[var(--primary-2)] shrink-0" /> {tx}</span>
          ))}
        </div>
      </div>

      {/* ── How it works + the clear "what you pay for" disclaimer ── */}
      <Card className="p-5 sm:p-6 mb-10 sm:mb-12 max-w-3xl mx-auto">
        <div className="grid sm:grid-cols-3 gap-5 sm:gap-6">
          {[[MessageSquare, t('myo.hiw1.t', '1 · Pay for advice'), t('myo.hiw1.s', 'A {n} consultation ({u} if urgent) opens a private conversation with a consultant.').replace('{n}', fmtMoney(cfg.consultationCents, cfg.currency)).replace('{u}', fmtMoney(cfg.urgentConsultationCents, cfg.currency))],
            [FileText, t('myo.hiw2.t', '2 · Get a quote'), t('myo.hiw2.s', "We discuss what you need and send a clear, itemised price for the product.")],
            [Package, t('myo.hiw3.t', '3 · We build & deliver'), t('myo.hiw3.s', 'Once you approve and pay the quote, we build it and deliver it right in the conversation.')]].map(([Icon, tt, ss], i) => (
            <div key={i} className="flex sm:flex-col gap-3 sm:gap-2.5">
              <span className="w-10 h-10 rounded-xl bg-[var(--primary)]/10 border border-[var(--primary)]/20 grid place-items-center shrink-0 text-[var(--primary-2)]"><Icon size={18} /></span>
              <div><div className="font-semibold text-sm">{tt}</div><div className="text-xs text-[var(--muted)] leading-relaxed mt-1">{ss}</div></div>
            </div>
          ))}
        </div>
        {/* FOLDED, not deleted.
            "The fee is not the product price" was said four times on one screen: in the
            hero, across these three steps, in this paragraph, and again on the custom card.
            Repeated that hard it reads as anxiety rather than as clarity — and this copy of
            it pushed the catalogue, the thing people came for, past the fold on a 900px
            window (it began at 764px).

            It stays because the one line it adds is real — whether SOURCE CODE is included
            is not said anywhere else, and it is the question that turns into a dispute. It
            is a summary line that opens, so the page states it and the reader chooses when
            to read the detail. The intake modal repeats it in full at the moment money is
            about to move, which is the moment it must not be foldable. */}
        <details className="mt-4 border-t border-[var(--line)] pt-3.5">
          <summary className="text-xs text-[var(--muted)] cursor-pointer flex items-center gap-2.5 list-none">
            <AlertTriangle size={15} className="shrink-0 text-warning" />
            {t('myo.disclaimer.head', 'What the consultation fee covers, and what it does not')}
          </summary>
          <p className="text-xs text-[var(--muted)] mt-2.5 pl-[25px] leading-relaxed">
            {t('myo.disclaimer', 'The consultation fee pays for expert advice and a quote — it is NOT the price of the product. Building only begins after you approve and pay the separate quote. Some deliverables include source code, some do not — this is always stated on the quote.')}
          </p>
        </details>
      </Card>

      {/* Capacity, at the top, where somebody decides whether to start.
          Commissions are work done by people: a page that keeps taking requests after the
          team is full is selling a promise nobody can keep. This is the same flag the intake
          form and the server both read — one answer, three places, not three opinions. */}
      {cfg.queueFull && (
        <div className="rounded-xl border border-[var(--warning)] p-3.5 mb-6 flex items-start gap-2.5">
          <Clock size={15} className="shrink-0 mt-0.5 text-[var(--warning)]" />
          <div>
            <div className="text-sm font-semibold text-[var(--warning)]">{t('myo.queuefull.t', 'The queue is full right now')}</div>
            <p className="text-[13px] text-[var(--muted)] mt-0.5">
              {t('myo.queuefull.s', 'Every commission slot is taken, so new ones are paused until something finishes. Everything below is still worth reading — and existing requests carry on as normal.')}
            </p>
          </div>
        </div>
      )}

      {/* Your own requests come FIRST, above the catalogue.
          They used to sit at the very bottom — under the hero, the how-it-works card, the
          capacity banner, every product card and the custom feature. So somebody with a
          commission already open, waiting on a reply, had to scroll past the pitch for the
          thing they had already bought to find it. Somebody who has bought is not shopping.

          And the ones with an unread reply lead, because "there is an answer waiting" is the
          only thing on this page that is time-sensitive. It was a 2 px dot at the bottom of a
          long page; now it is a row that says so, at the top. */}
      {user && (mine.data?.requests?.length > 0) && (() => {
        const reqs = [...mine.data.requests].sort((a, b) =>
          (b.userUnread ? 1 : 0) - (a.userUnread ? 1 : 0)
          || new Date(b.createdAt) - new Date(a.createdAt));
        const unread = reqs.filter((r) => r.userUnread).length;
        return (
          <div className="mb-10 sm:mb-12">
            <div className="flex items-baseline gap-3 mb-3 flex-wrap">
              <h2 className="font-semibold text-lg flex items-center gap-2">
                <MessageSquare size={18} className="text-[var(--primary-2)]" /> {t('myo.mine', 'My requests')}
              </h2>
              {unread > 0 && (
                <span className="text-xs font-semibold text-[var(--primary-2)]">
                  {t('myo.mineUnread', '{n} waiting for you').replace('{n}', String(unread))}
                </span>
              )}
            </div>
            <div className="space-y-2">
              {reqs.map((r) => {
                const K = kindMeta(r.productKind).icon;
                return (
                  <Link key={r.id} to={`/myo/${r.id}`}
                    className={`card p-3 flex items-center gap-3 hover:border-[var(--primary)] ${r.userUnread ? 'border-[var(--primary)]' : ''}`}>
                    <span className="w-9 h-9 rounded-lg bg-[var(--surface-2)] grid place-items-center shrink-0 text-[var(--primary-2)]"><K size={16} /></span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{r.name}</div>
                      <div className="text-xs text-[var(--faint)]">{new Date(r.createdAt).toLocaleDateString()}</div>
                    </div>
                    {/* A word, not a dot. A coloured circle is only legible to somebody who
                        already knows what it means. */}
                    {r.userUnread && (
                      <span className="text-[11px] font-semibold text-[var(--primary-2)] whitespace-nowrap">
                        {t('myo.unread', 'New reply')}
                      </span>
                    )}
                    <Badge tone={STATUS_TONE[r.status]}>{statusLabel(r.status, t)}</Badge>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Catalog ── */}
      <div className="flex items-baseline gap-3 mb-4">
        <h2 className="text-lg font-bold">{t('myo.pick.t', 'Choose a starting point')}</h2>
        <span className="text-xs text-[var(--faint)]">{t('myo.pick.s', 'Pick the closest match — we tailor the details together.')}</span>
      </div>
      {cat.loading ? <div className="py-10 grid place-items-center"><Spinner /></div> : (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 items-stretch">
            {[...baseCards, ...extras].map((c) => <ProductCard key={c.kind + (c.id || '')} card={c} cfg={cfg} onStart={() => start(c)} />)}
          </div>
          {/* Custom = one strong full-width feature (replaces the lonely 4th card + old CTA band) */}
          <CustomFeatureCard card={customCard} cfg={cfg} onStart={() => start(customCard)} />
        </>
      )}

      {intake && <IntakeModal intake={intake} cfg={cfg} onClose={() => setIntake(null)} />}
    </div>
  );
}

function ProductCard({ card, cfg, onStart }) {
  const { t } = useI18n();
  const Icon = kindMeta(card.kind).icon;
  const accent = kindAccent(card.kind);
  const priced = card.basePriceCents > 0;
  return (
    <Card hover className="group relative p-5 flex flex-col overflow-hidden h-full transition-transform duration-200 hover:-translate-y-1">
      {/* The accent glow appears ON HOVER, and is absent otherwise.
          At rest, six cards each carrying a permanent coloured haze made the grid read as six
          different surfaces rather than six of the same thing — the glow was competing with
          the icon, which is the element actually carrying the card's identity. Reserved for
          hover it does what a highlight is for: marking the one you are pointing at.
          opacity-0 → 0.18 rather than mounting on hover, so the transition has something to
          animate from and nothing shifts in the layout. */}
      <div aria-hidden className="absolute -top-16 -right-16 w-40 h-40 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-[0.18] motion-reduce:transition-none" style={{ background: accent }} />
      <div className="relative flex items-start gap-3.5 mb-3.5">
        <span className="w-12 h-12 rounded-2xl grid place-items-center text-white shrink-0 shadow-sm" style={{ background: `linear-gradient(135deg, ${accent}, ${accent}bb)` }}><Icon size={22} /></span>
        <div className="min-w-0 pt-0.5">
          <div className="font-semibold leading-tight truncate">{card.name}</div>
          <div className="mt-1 flex items-baseline gap-1">
            {priced
              ? <><span className="text-[10px] uppercase tracking-wide text-[var(--faint)]">{t('myo.fromlabel', 'from')}</span><span className="text-lg font-bold tabular-nums leading-none">{fmtMoney(card.basePriceCents, cfg.currency)}</span></>
              : <span className="text-sm font-semibold text-[var(--primary-2)]">{t('myo.quoteonly', 'Custom quote')}</span>}
          </div>
        </div>
      </div>
      {card.tagline && <p className="relative text-sm text-[var(--muted)] leading-relaxed mb-3.5">{card.tagline}</p>}
      {card.options?.length > 0 && (
        <ul className="relative text-[13px] text-[var(--muted)] space-y-2 mb-4">
          {card.options.slice(0, 4).map((o, i) => (
            <li key={i} className="flex items-start gap-2">
              <Check size={14} className="shrink-0 mt-0.5" style={{ color: accent }} />
              <span className="flex-1 min-w-0">{o.label}{o.priceCents ? <span className="text-[var(--faint)]"> · +{fmtMoney(o.priceCents, cfg.currency)}</span> : ''}</span>
            </li>
          ))}
        </ul>
      )}
      {/* Footer stacks on phones: side-by-side, the CTA measured 76x28 — the primary
          conversion action of a paid-service page, well under a comfortable touch target.
          Full-width and 44px tall below sm, back to the compact inline row from sm up. */}
      <div className="relative mt-auto pt-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 border-t border-[var(--line)]">
        <span className="text-xs text-[var(--faint)] inline-flex items-center gap-1.5">{card.includesSource ? <><FileText size={12} /> {t('myo.src.with', 'source included')}</> : <><Lock size={12} /> {t('myo.src.without', 'no source')}</>}</span>
        <Button size="sm" variant="primary" onClick={onStart} className="w-full sm:w-auto !min-h-[44px] sm:!min-h-0 justify-center">{t('myo.start', 'Start')} <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" /></Button>
      </div>
    </Card>
  );
}

// The "anything else" option, as ONE full-width feature so the catalog row stays balanced (3
// base cards) instead of leaving a lonely 4th card. Base surface is a real <Card> so it honours
// the Translucent-surfaces setting; the accent gradient/glow are aria-hidden decorative layers.
function CustomFeatureCard({ card, cfg, onStart }) {
  const { t } = useI18n();
  const accent = kindAccent('custom');
  const highlights = (card.options || []).slice(0, 3).map((o) => o.label).filter(Boolean);
  return (
    <Card className="group relative overflow-hidden mt-5 sm:mt-6 p-6 sm:p-8 flex flex-col md:flex-row md:items-center gap-6">
      {/* This one keeps a glow at rest, deliberately: it is ONE card, not one of six, and the
          tint is what marks it as the odd offer out. Toned down and made to lift on hover like
          the others, so the two behave as one family. */}
      <div aria-hidden className="absolute inset-0" style={{ background: `radial-gradient(120% 150% at 100% 0%, ${accent}14, transparent 55%)` }} />
      <div aria-hidden className="absolute -bottom-24 -right-12 w-80 h-80 rounded-full opacity-[0.12] blur-3xl transition-opacity duration-300 group-hover:opacity-25 motion-reduce:transition-none" style={{ background: accent }} />
      <span className="relative w-14 h-14 rounded-2xl grid place-items-center text-white shrink-0 shadow-md" style={{ background: `linear-gradient(135deg, ${accent}, ${accent}bb)` }}><Wand2 size={26} /></span>
      <div className="relative flex-1 min-w-0">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full text-white shadow-sm mb-2" style={{ background: accent }}><Sparkles size={11} /> {t('myo.popular', 'Most flexible')}</span>
        <h3 className="text-xl sm:text-2xl font-bold leading-tight">{t('myo.cta.t', 'Have something else in mind?')}</h3>
        <p className="text-sm text-[var(--muted)] leading-relaxed mt-2 max-w-xl">{card.tagline || t('myo.cta.s', 'A tool, a SaaS, an integration, a security audit of your code… start a custom consultation and we’ll figure it out together.')}</p>
        {highlights.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
            {highlights.map((h, i) => <span key={i} className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)]"><Check size={13} className="shrink-0" style={{ color: accent }} /> {h}</span>)}
          </div>
        )}
        <div className="text-xs text-[var(--faint)] mt-3.5">{t('myo.cta.fee', 'Consultation from {p} — this pays for the advice, not the product.').replace('{p}', fmtMoney(cfg.consultationCents, cfg.currency))}</div>
      </div>
      <Button variant="primary" onClick={onStart} className="relative shrink-0 w-full self-stretch md:w-auto md:self-center !px-5 !py-2.5 !min-h-[44px] justify-center">{t('myo.cta.btn', 'Start a custom request')} <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" /></Button>
    </Card>
  );
}

const TARGETS = ['personal', 'friends', 'community', 'nonprofit', 'commercial', 'other'];
function IntakeModal({ intake, cfg, onClose }) {
  const { t, lang } = useI18n(); const toast = useToast();
  const [f, setF] = useState({ name: '', logo: '', objective: '', target: 'personal', description: '', lang: lang === 'fr' ? 'fr' : 'en', urgent: false });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const fee = f.urgent ? cfg.urgentConsultationCents : cfg.consultationCents;
  const submit = async () => {
    if (f.name.trim().length < 2) return toast.error(t('myo.e.name', 'Give your product a name.'));
    setBusy(true);
    try {
      const res = await api.post('/myo/requests', { productId: intake.productId, productKind: intake.kind, name: f.name.trim(), logo: f.logo.trim() || null, objective: f.objective.trim(), target: f.target, description: f.description.trim(), lang: f.lang, urgent: f.urgent });
      if (res?.checkoutUrl) { window.location.href = res.checkoutUrl; return; }
      toast.error(t('myo.e.pay', 'Could not start checkout.')); setBusy(false);
    } catch (x) {
      const e = x.data?.error;
      toast.error(
        e === 'myo_disabled' ? t('myo.off.t', 'Not accepting requests right now')
        : e === 'stripe_unconfigured' ? t('myo.e.stripe', 'Payments are not configured yet.')
        // Three different "full", three different next moves: drop the urgent flag, come
        // back later, or finish what you already have open. One generic message would
        // leave the customer guessing which.
        : e === 'urgent_full' ? t('myo.e.urgentfull', 'Every urgent slot is taken. Untick "urgent" to start now, or try again later.')
        : e === 'queue_full' ? t('myo.e.queuefull', 'The commission queue is full right now — please try again in a few days.')
        : e === 'too_many_own' ? t('myo.e.ownfull', 'You already have {n} request(s) open. Finish or close one first.').replace('{n}', x.data?.limit ?? '')
        : t('myo.e.pay', 'Could not start checkout.'));
      setBusy(false);
    }
  };
  const K = kindMeta(intake.kind).icon;
  return (
    <Modal open onClose={onClose} title={t('myo.intake.title', 'Start a request')} icon={K} width="max-w-lg"
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
        <Button variant="primary" disabled={busy || cfg.queueFull} onClick={submit}>{busy ? <Spinner /> : <><CreditCard size={15} /> {t('myo.intake.pay', 'Pay {p} & start').replace('{p}', fmtMoney(fee, cfg.currency))}</>}</Button></>}>
      <div className="space-y-3">
        {/* Said BEFORE the brief is written, not after it is submitted.
            The endpoint has always computed this and its own comment says why — "discovering
            the option is unavailable after writing a brief and reaching the payment step is
            the version of this that wastes the customer's time". The page fetched the field
            and used only the urgent half of it, so a full queue was still discovered at the
            payment button. */}
        {cfg.queueFull && (
          <div className="text-xs rounded-lg p-2.5 flex items-start gap-2 border border-[var(--warning)] text-[var(--warning)]">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            <span>{t('myo.queuefull.note', 'The queue is full right now, so new requests are not being taken. Nothing is lost if you write your brief — but the payment button stays off until a slot frees up.')}</span>
          </div>
        )}
        <div className="text-xs text-[var(--faint)] flex items-start gap-2 bg-[var(--surface-2)] rounded-lg p-2.5">
          <AlertTriangle size={13} className="shrink-0 mt-0.5 text-warning" />
          <span>{t('myo.intake.note', "You're paying {p} for a consultation (advice + a quote) about “{name}”. This is not the product price — building starts after you approve the quote.").replace('{p}', fmtMoney(fee, cfg.currency)).replace('{name}', kindMeta(intake.kind)[lang === 'fr' ? 'fr' : 'en'])}</span>
        </div>
        <div className="grid grid-cols-[1fr_130px] gap-3">
          <Field label={t('myo.f.name', 'Product name')}><Input value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={120} placeholder={t('myo.f.nameph', 'e.g. My Community Bot')} /></Field>
          <Field label={t('myo.f.lang', 'Reply language')}><Select value={f.lang} onChange={(e) => set('lang', e.target.value)}><option value="en">English</option><option value="fr">Français</option></Select></Field>
        </div>
        <Field label={t('myo.f.logo', 'Logo URL (optional)')}><Input value={f.logo} onChange={(e) => set('logo', e.target.value)} maxLength={500} placeholder="https://…/logo.png" /></Field>
        <Field label={t('myo.f.objective', 'Objective (one line)')}><Input value={f.objective} onChange={(e) => set('objective', e.target.value)} maxLength={200} placeholder={t('myo.f.objph', 'What should it accomplish?')} /></Field>
        <Field label={t('myo.f.target', 'Who is it for?')}>
          <Select value={f.target} onChange={(e) => set('target', e.target.value)}>
            {TARGETS.map((tg) => <option key={tg} value={tg}>{t(`myo.target.${tg}`, { personal: 'Just me / personal', friends: 'Between friends', community: 'For my community', nonprofit: 'Non-profit', commercial: 'Commercial (for-profit)', other: 'Other' }[tg])}</option>)}
          </Select>
        </Field>
        <Field label={t('myo.f.desc', 'Describe your product')} hint={`${f.description.length}/2000`}>
          <Textarea rows={5} value={f.description} onChange={(e) => set('description', e.target.value.slice(0, 2000))} placeholder={t('myo.f.descph', 'Features, style, references, deadline, anything useful…')} />
        </Field>
        {/* Disabled up front rather than refused at the end. The server says whether an
            urgent slot is free; finding out after writing a brief is the version of this
            that wastes the customer's evening. */}
        <label className={`flex items-center gap-2.5 text-sm rounded-lg border border-[var(--line)] p-3 ${cfg.urgentAvailable === false ? 'opacity-60' : 'cursor-pointer'}`}>
          <input type="checkbox" checked={f.urgent} disabled={cfg.urgentAvailable === false} onChange={(e) => set('urgent', e.target.checked)} />
          <span className="flex-1"><span className="font-medium flex items-center gap-1.5"><Clock size={13} className="text-warning" /> {t('myo.f.urgent', 'Urgent request')}</span>
            <span className="text-xs text-[var(--faint)]">{cfg.urgentAvailable === false
              ? t('myo.f.urgentfull', 'All urgent slots are taken right now — a normal request can still start today.')
              : t('myo.f.urgentnote', 'Prioritised — a higher consultation fee ({p}).').replace('{p}', fmtMoney(cfg.urgentConsultationCents, cfg.currency))}</span></span>
        </label>
        <div className="text-[11px] text-[var(--faint)] text-center pt-1">
          {t('myo.intake.legalpre', 'By paying you accept our')}{' '}
          <Link to="/legal/terms" className="underline hover:text-[var(--text)]">{t('foot.terms', 'Terms')}</Link>
          {' · '}
          <Link to="/legal/refunds" className="underline hover:text-[var(--text)]">{t('foot.refunds', 'Payments & Refunds')}</Link>
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════ /myo/:id — a request conversation (user side) ═══════════════════
export function MyoRequestPage() {
  const { id } = useParams();
  const { t } = useI18n();
  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <Link to="/myo" className="text-sm text-[var(--muted)] hover:text-[var(--text)] inline-flex items-center gap-1.5 mb-4"><ArrowLeft size={15} /> {t('myo.back', 'Make Your Own')}</Link>
      <MyoConversation id={id} />
    </div>
  );
}

// Shared conversation used by BOTH the user page and the admin panel (admin=true adds the
// quote builder, deliverable form and status controls). Self-contained.
export function MyoConversation({ id, admin = false }) {
  const { t, lang } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const { data, loading, reload } = useAsync(() => api.get(`/myo/requests/${id}`), [id]);
  // Live: a message from the other side lands without a refresh. Refetching the whole thread
  // rather than splicing the pushed message into local state — the timeline interleaves
  // messages, quotes and deliverables by date, and a hand-inserted message would have to
  // reproduce that ordering and the server's serialisation exactly to stay consistent.
  useThreadStream(id ? `/myo/requests/${id}/stream` : null, () => reload(true));
  const [sending, setSending] = useState(false);
  const [params] = useSearchParams();
  const r = data?.request;

  const timeline = useMemo(() => {
    if (!data) return [];
    const items = [
      ...(data.messages || []).map((m) => ({ t: 'msg', at: m.createdAt, m })),
      ...(data.quotes || []).map((q) => ({ t: 'quote', at: q.createdAt, q })),
      ...(data.deliverables || []).map((d) => ({ t: 'deliver', at: d.createdAt, d })),
    ];
    return items.sort((a, b) => new Date(a.at) - new Date(b.at));
  }, [data]);

  const send = async ({ body, images }) => {
    setSending(true);
    try { await api.post(`/myo/requests/${id}/messages`, { body, images }); await reload(); return true; }
    catch (x) { toast.error(x.data?.error === 'consultation_unpaid' ? t('myo.c.unpaid', 'Pay the consultation first.') : t('acc.failed', 'Failed.')); return false; }
    finally { setSending(false); }
  };
  const payQuote = async (q) => {
    try { const res = await api.post(`/myo/quotes/${q.id}/pay`, {}); if (res?.checkoutUrl) { window.location.href = res.checkoutUrl; } }
    catch { toast.error(t('myo.e.pay', 'Could not start checkout.')); }
  };

  if (loading) return <div className="py-16 grid place-items-center"><Spinner /></div>;
  if (!r) return <EmptyState icon={AlertTriangle} title={t('myo.notfound', 'Request not found')} sub={t('myo.notfound.s', "It may have been removed, or you don't have access.")} />;
  const K = kindMeta(r.productKind).icon;
  const viewerIsStaff = data.viewerIsStaff;

  return (
    <div className="space-y-4">
      {/* header */}
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <span className="w-11 h-11 rounded-xl bg-[var(--primary)]/10 grid place-items-center text-[var(--primary-2)] shrink-0">{r.logo ? <img src={r.logo} alt="" className="w-8 h-8 rounded object-contain" /> : <K size={20} />}</span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold flex items-center gap-2 flex-wrap">{r.name}
              <Badge tone={STATUS_TONE[r.status]}>{statusLabel(r.status, t)}</Badge>
              {r.urgent && <Badge tone="amber"><Clock size={10} /> {t('myo.urgent', 'urgent')}</Badge>}
            </div>
            <div className="text-xs text-[var(--faint)] mt-0.5">{kindMeta(r.productKind)[lang === 'fr' ? 'fr' : 'en']} · {t(`myo.target.${r.target}`, r.target)}{admin && r.user ? ` · ${r.user.displayName}` : ''}</div>
            {r.objective && <div className="text-sm mt-1.5">{r.objective}</div>}
          </div>
        </div>
        {r.description && <p className="text-sm text-[var(--muted)] mt-3 whitespace-pre-wrap border-t border-[var(--line)] pt-3">{r.description}</p>}
      </Card>

      {r.status === 'pending_payment' && !admin && (
        <Card className="p-4 flex items-center gap-3 border-warning-border bg-warning-bg">
          <CreditCard size={18} className="text-warning shrink-0" />
          <div className="flex-1 text-sm">{t('myo.pending', 'This request opens once the consultation fee is paid.')}</div>
          <Button size="sm" variant="primary" onClick={async () => { try { const res = await api.post(`/myo/requests/${id}/pay`, {}); if (res?.checkoutUrl) location.href = res.checkoutUrl; } catch { toast.error(t('myo.e.pay', 'Could not start checkout.')); } }}>{t('myo.payNow', 'Pay now')}</Button>
        </Card>
      )}

      {/* timeline */}
      <div className="space-y-3">
        {timeline.map((it, i) => {
          if (it.t === 'msg') return <MessageRow key={`m${it.m.id}`} m={it.m} lang={lang} />;
          if (it.t === 'quote') return <QuoteCard key={`q${it.q.id}`} q={it.q} admin={admin} viewerIsStaff={viewerIsStaff} onPay={() => payQuote(it.q)} onWithdraw={async () => { try { await api.post(`/admin/myo/quotes/${it.q.id}/withdraw`, {}); reload(); } catch { toast.error(t('acc.failed', 'Failed.')); } }} t={t} cur={it.q.currency} />;
          return <DeliverableCard key={`d${it.d.id}`} d={it.d} t={t} />;
        })}
        {timeline.length === 0 && r.status !== 'pending_payment' && <div className="text-sm text-[var(--faint)] text-center py-6">{t('myo.emptythread', 'No messages yet — say hello!')}</div>}
      </div>

      {/* composer (once paid + not closed) */}
      {r.consultationPaid && r.status !== 'closed' && r.status !== 'cancelled' && (
        <Card className="p-3"><ReportComposer onSend={send} sending={sending} placeholder={t('myo.msgph', 'Write a message…')} /></Card>
      )}
      {(r.status === 'closed') && <div className="text-sm text-[var(--faint)] text-center py-2">{t('myo.closed', 'This request is closed. Send a message to reopen it.')}{r.consultationPaid && <div className="mt-2"><Card className="p-3 text-left"><ReportComposer onSend={send} sending={sending} placeholder={t('myo.reopen', 'Reopen with a message…')} /></Card></div>}</div>}

      {/* actions */}
      {r.consultationPaid && (
        <div className="flex flex-wrap gap-2 justify-end">
          {!admin && r.status !== 'closed' && <Button size="sm" variant="ghost" onClick={async () => { if (!(await dialog.confirm({ title: t('myo.close.t', 'Close request'), message: t('myo.close.m', 'Close this request? You can reopen it any time by sending a message.'), okLabel: t('myo.close.ok', 'Close') }))) return; await api.post(`/myo/requests/${id}/close`, {}); reload(); }}>{t('myo.closebtn', 'Close request')}</Button>}
          {admin && <AdminPanel r={r} reload={reload} />}
        </div>
      )}
    </div>
  );
}

function MessageRow({ m, lang }) {
  const system = !m.authorId;
  return (
    <div className={`flex gap-2.5 ${m.staff ? 'flex-row-reverse' : ''}`}>
      {!system && <Avatar user={m.author} size={30} className="shrink-0" />}
      <div className={`min-w-0 max-w-[80%] ${m.staff ? 'items-end text-right' : ''}`}>
        <div className={`inline-block rounded-2xl px-3.5 py-2 text-sm ${system ? 'bg-[var(--surface-2)] text-[var(--muted)] text-xs italic' : m.staff ? 'bg-[var(--primary)]/12 border border-[var(--primary)]/25' : 'bg-[var(--surface-2)]'}`}>
          {!system && <div className="text-[11px] text-[var(--faint)] mb-0.5">{m.author?.displayName || ''}{m.staff ? ' · staff' : ''}</div>}
          {m.body && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
          {m.images?.length > 0 && <div className="flex flex-wrap gap-2 mt-2">{m.images.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" className="w-24 h-24 rounded-lg object-cover border border-[var(--line)]" /></a>)}</div>}
        </div>
        <div className="text-[10px] text-[var(--faint)] mt-0.5 px-1">{new Date(m.createdAt).toLocaleString()}</div>
      </div>
    </div>
  );
}

function QuoteCard({ q, admin, viewerIsStaff, onPay, onWithdraw, t, cur }) {
  const paid = q.status === 'paid';
  const withdrawn = q.status === 'withdrawn';
  return (
    <Card className={`p-4 border-2 ${paid ? 'border-success-border' : withdrawn ? 'border-[var(--line)] opacity-60' : 'border-[var(--primary)]/40'}`}>
      <div className="flex items-center gap-2 mb-2"><FileText size={16} className="text-[var(--primary-2)]" /><span className="font-semibold">{q.title || t('myo.quote', 'Quote')}</span>
        {paid && <Badge tone="green"><Check size={10} /> {t('myo.quote.paid', 'paid')}</Badge>}
        {withdrawn && <Badge>{t('myo.quote.withdrawn', 'withdrawn')}</Badge>}
        <Badge tone={q.includesSource ? 'green' : ''}>{q.includesSource ? t('myo.src.with', 'source included') : t('myo.src.without', 'no source')}</Badge>
      </div>
      {q.note && <p className="text-sm text-[var(--muted)] mb-2 whitespace-pre-wrap">{q.note}</p>}
      <div className="rounded-lg border border-[var(--line)] divide-y divide-[var(--line)] text-sm mb-3">
        {(q.lineItems || []).map((l, i) => <div key={i} className="flex justify-between px-3 py-1.5"><span>{l.label}</span><span className="tabular-nums">{fmtMoney(l.priceCents, cur)}</span></div>)}
        <div className="flex justify-between px-3 py-2 font-semibold bg-[var(--surface-2)]"><span>{t('myo.total', 'Total')}</span><span className="tabular-nums">{fmtMoney(q.totalCents, cur)}</span></div>
      </div>
      {q.validUntil && !paid && <div className="text-xs text-[var(--faint)] mb-2">{t('myo.quote.valid', 'Valid until {d}').replace('{d}', new Date(q.validUntil).toLocaleDateString())}</div>}
      {!admin && !viewerIsStaff && q.status === 'sent' && <Button size="sm" variant="primary" className="w-full" onClick={onPay}><CreditCard size={15} /> {t('myo.quote.pay', 'Approve & pay {p}').replace('{p}', fmtMoney(q.totalCents, cur))}</Button>}
      {admin && q.status === 'sent' && <Button size="sm" variant="ghost" className="!text-error" onClick={onWithdraw}><X size={14} /> {t('myo.quote.withdrawbtn', 'Withdraw quote')}</Button>}
    </Card>
  );
}

function DeliverableCard({ d, t }) {
  return (
    <Card className="p-4 border-2 border-success-border">
      <div className="flex items-center gap-2 mb-2"><Package size={16} className="text-success" /><span className="font-semibold">{d.title || t('myo.delivery', 'Delivery')}</span>
        <Badge tone={d.includesSource ? 'green' : ''}>{d.includesSource ? t('myo.src.with', 'source included') : t('myo.src.without', 'no source')}</Badge>
      </div>
      {d.note && <p className="text-sm text-[var(--muted)] mb-2 whitespace-pre-wrap">{d.note}</p>}
      <div className="flex flex-wrap gap-2">
        {d.fileUrl && <a href={d.fileUrl} download={d.fileName || undefined}><Button size="sm" variant="primary"><Download size={14} /> {t('myo.download', 'Download')}{d.fileName ? ` · ${d.fileName}` : ''}</Button></a>}
        {d.linkUrl && <a href={d.linkUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="default"><ExternalLink size={14} /> {t('myo.openlink', 'Open link')}</Button></a>}
      </div>
    </Card>
  );
}

// Admin-only panel inside the conversation: build a quote, deliver, set status.
function AdminPanel({ r, reload }) {
  const { t } = useI18n(); const toast = useToast();
  const [mode, setMode] = useState(null); // 'quote' | 'deliver' | null
  return (
    <div className="w-full mt-2 border-t border-[var(--line)] pt-3">
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mr-1">{t('myo.admin', 'Consultant')}</span>
        <Button size="sm" variant={mode === 'quote' ? 'primary' : 'default'} onClick={() => setMode(mode === 'quote' ? null : 'quote')}><FileText size={14} /> {t('myo.a.quote', 'Send quote')}</Button>
        <Button size="sm" variant={mode === 'deliver' ? 'primary' : 'default'} onClick={() => setMode(mode === 'deliver' ? null : 'deliver')}><Package size={14} /> {t('myo.a.deliver', 'Deliver')}</Button>
        <Select className="!w-auto !py-1.5" value={r.status} onChange={async (e) => { try { await api.put(`/admin/myo/requests/${r.id}/status`, { status: e.target.value }); reload(); } catch { toast.error(t('acc.failed', 'Failed.')); } }}>
          {['open', 'quoted', 'in_production', 'delivered', 'closed', 'cancelled'].map((s) => <option key={s} value={s}>{statusLabel(s, t)}</option>)}
        </Select>
      </div>
      {mode === 'quote' && <QuoteBuilder requestId={r.id} onDone={() => { setMode(null); reload(); }} />}
      {mode === 'deliver' && <DeliverForm requestId={r.id} onDone={() => { setMode(null); reload(); }} />}
    </div>
  );
}

function QuoteBuilder({ requestId, onDone }) {
  const { t } = useI18n(); const toast = useToast();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [items, setItems] = useState([{ label: '', price: '' }]);
  const [includesSource, setIncludesSource] = useState(false);
  const [validDays, setValidDays] = useState('14');
  const [busy, setBusy] = useState(false);
  const total = items.reduce((s, it) => s + Math.round((parseFloat(it.price) || 0) * 100), 0);
  const send = async () => {
    const lineItems = items.map((it) => ({ label: it.label.trim(), priceCents: Math.round((parseFloat(it.price) || 0) * 100) })).filter((l) => l.label);
    if (!lineItems.length) return toast.error(t('myo.qb.needitem', 'Add at least one line item.'));
    if (lineItems.reduce((s, l) => s + l.priceCents, 0) < 50) return toast.error(t('myo.qb.min', 'Total must be at least $0.50.'));
    setBusy(true);
    try { await api.post(`/admin/myo/requests/${requestId}/quotes`, { title: title.trim(), note: note.trim(), lineItems, includesSource, validDays: Math.max(1, parseInt(validDays) || 14) }); toast.success(t('myo.qb.sent', 'Quote sent.')); onDone(); }
    catch (x) { toast.error(x.data?.error === 'consultation_unpaid' ? t('myo.c.unpaid', 'Pay the consultation first.') : t('acc.failed', 'Failed.')); }
    finally { setBusy(false); }
  };
  return (
    <Card className="p-4 mt-3 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('myo.qb.title', 'Quote title')}><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('myo.qb.titleph', 'e.g. Community bot build')} /></Field>
        <Field label={t('myo.qb.valid', 'Valid for (days)')}><Input type="number" value={validDays} onChange={(e) => setValidDays(e.target.value)} /></Field>
      </div>
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('myo.qb.items', 'Line items')}</div>
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="flex gap-2">
              <Input className="flex-1" value={it.label} onChange={(e) => setItems((s) => s.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} placeholder={t('myo.qb.itemph', 'Description')} />
              <Input className="!w-28" type="number" step="0.01" value={it.price} onChange={(e) => setItems((s) => s.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} placeholder="0.00" />
              {items.length > 1 && <button onClick={() => setItems((s) => s.filter((_, j) => j !== i))} className="text-[var(--faint)] hover:text-error px-1"><X size={15} /></button>}
            </div>
          ))}
        </div>
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => setItems((s) => [...s, { label: '', price: '' }])}><Plus size={13} /> {t('myo.qb.additem', 'Add item')}</Button>
      </div>
      <Field label={t('myo.qb.note', 'Note (optional)')}><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={includesSource} onChange={(e) => setIncludesSource(e.target.checked)} /> {t('myo.qb.source', 'Deliverable includes source code')}</label>
      <div className="flex items-center justify-between border-t border-[var(--line)] pt-3">
        <span className="font-semibold">{t('myo.total', 'Total')}: {fmtMoney(total)}</span>
        <Button size="sm" variant="primary" disabled={busy} onClick={send}>{busy ? <Spinner /> : <><Send size={14} /> {t('myo.qb.sendbtn', 'Send quote')}</>}</Button>
      </div>
    </Card>
  );
}

function DeliverForm({ requestId, onDone }) {
  const { t } = useI18n(); const toast = useToast();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState(null); // { url, name }
  const [linkUrl, setLinkUrl] = useState('');
  const [includesSource, setIncludesSource] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const pick = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
    setUploading(true);
    try { setFile(await uploadMyoDeliverable(f)); }
    catch (x) { toast.error(x.status === 413 ? t('myo.d.big', 'File too large (max 500 MB).') : t('myo.d.fail', 'Upload failed.')); }
    finally { setUploading(false); }
  };
  const submit = async () => {
    if (!file && !linkUrl.trim()) return toast.error(t('myo.d.need', 'Attach a file or a link.'));
    setBusy(true);
    try { await api.post(`/admin/myo/requests/${requestId}/deliverables`, { title: title.trim(), note: note.trim(), fileUrl: file?.url || null, fileName: file?.name || null, linkUrl: linkUrl.trim() || null, includesSource }); toast.success(t('myo.d.sent', 'Delivered.')); onDone(); }
    catch { toast.error(t('acc.failed', 'Failed.')); }
    finally { setBusy(false); }
  };
  return (
    <Card className="p-4 mt-3 space-y-3">
      <Field label={t('myo.d.title', 'Delivery title')}><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('myo.d.titleph', 'e.g. Final build v1.0')} /></Field>
      <Field label={t('myo.d.note', 'Note (optional)')}><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('myo.d.noteph', 'How to run it, credentials, next steps…')} /></Field>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('myo.d.file', 'File')}</div>
          {file ? <div className="flex items-center gap-2 text-sm"><FileText size={14} /> <span className="truncate flex-1">{file.name}</span><button onClick={() => setFile(null)} className="text-[var(--faint)] hover:text-error"><X size={14} /></button></div>
            : <label className="btn btn-sm cursor-pointer inline-flex"><input type="file" className="hidden" onChange={pick} />{uploading ? <Spinner /> : <><Download size={13} className="rotate-180" /> {t('myo.d.upload', 'Upload deliverable')}</>}</label>}
        </div>
        <Field label={t('myo.d.link', 'or external link')}><Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={includesSource} onChange={(e) => setIncludesSource(e.target.checked)} /> {t('myo.qb.source', 'Deliverable includes source code')}</label>
      <div className="flex justify-end"><Button size="sm" variant="primary" disabled={busy} onClick={submit}>{busy ? <Spinner /> : <><Package size={14} /> {t('myo.d.deliverbtn', 'Deliver to customer')}</>}</Button></div>
    </Card>
  );
}
