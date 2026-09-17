import { useState, useMemo } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AppWindow, Globe, Wand2, ShieldCheck, Check, Clock, Package, Download,
  ExternalLink, Lock, ArrowLeft, ArrowRight, Plus, X, FileText, AlertTriangle, CreditCard, MessageSquare, Send, Sparkles, ChevronDown,
} from 'lucide-react';
import { api, uploadMyoDeliverable } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from './auth.jsx';
import { Card, Button, Input, Textarea, Select, Badge, Modal, EmptyState, Spinner, Field, useToast, useDialog } from '../ui/ui.jsx';
import Avatar from '../ui/Avatar.jsx';
import { useAsync, useThreadStream } from './pages.jsx';
import { ReportComposer } from '../ui/report.jsx';
// The deal, drawn once and shared with the landing band — two copies of "when do I pay"
// is how the page and the front page end up quoting different prices.
import DealRail from './myo-deal.jsx';
// The intake is a guided questionnaire, not a seven-field form — its own file, because the
// question catalogue (scope per product kind, budgets, deadlines) is most of its length.
import MyoIntakeWizard from './myo-intake.jsx';
import { DiscordIcon } from '../ui/brand.jsx';

// ── shared helpers ──────────────────────────────────────────────────────────────
// Moved to lib/money.js and re-exported: the home page renders a component that needs it, and
// importing it from here would have dragged this whole page into the entry chunk. Re-exported
// rather than relocated at every call site — admin-myo.jsx imports it from here.
export { fmtMoney } from '../lib/money.js';
import { fmtMoney } from '../lib/money.js';
const KIND_META = {
  // The brand's own mark. The other three kinds stay on lucide, which is the point:
  // "App", "Website" and "Something else" are nobody's trademark.
  discord_bot: { icon: DiscordIcon, en: 'Discord bot', fr: 'Bot Discord' },
  app: { icon: AppWindow, en: 'Application', fr: 'Application' },
  website: { icon: Globe, en: 'Website', fr: 'Site web' },
  audit: { icon: ShieldCheck, en: 'Security audit', fr: 'Audit de sécurité' },
  custom: { icon: Wand2, en: 'Custom project', fr: 'Projet sur mesure' },
};
// A line per kind, for the case an admin has not written one.
//
// The built-in cards ship with `tagline: ''`, so before anybody curates the catalogue the
// page offers three cards saying "Discord bot — Custom quote" and nothing else, with a
// hundred pixels of blank above the footer. That is what a first-time visitor meets, and
// it tells them nothing about what they would be buying. An admin's own tagline still
// wins — this only fills a hole.
const KIND_BLURB = {
  discord_bot: 'A bot for your server, moderation, roles, tickets, giveaways, or something nobody has built yet.',
  app: 'A desktop or mobile application, built around what you actually do with it.',
  website: 'A site that fits: showcase, shop, dashboard, designed, built, and handed over.',
  audit: 'A read of your code for real vulnerabilities, reported with CVE / CWE references and a CVSS score.',
  custom: 'Anything else, a tool, a SaaS, an integration.',
};
const kindBlurb = (k, t) => t(`myo.blurb.${k}`, KIND_BLURB[k] || KIND_BLURB.custom);
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
  const cfg = cat.data || {};
  const products = cfg.products || [];
  // The three base options are always offered even before an admin curates the catalog.
  const baseCards = ['discord_bot', 'app', 'website'].map((k) => products.find((p) => p.kind === k) || { kind: k, name: kindMeta(k)[lang === 'fr' ? 'fr' : 'en'], tagline: '', basePriceCents: 0, options: [], includesSource: true });
  const customCard = products.find((p) => p.kind === 'custom') || { kind: 'custom', name: kindMeta('custom')[lang === 'fr' ? 'fr' : 'en'], tagline: t('myo.custom.tag', 'Anything else, a tool, a SaaS, a code audit with CVE/CWE + CVSS…'), basePriceCents: 0, options: [], includesSource: true };
  const extras = products.filter((p) => !['discord_bot', 'app', 'website', 'custom'].includes(p.kind));

  // The catalogue, as answers to the first question. Same source as the old card grid — an
  // admin-curated product still shows up, it is just a choice in a survey now instead of a tile.
  const wizardCards = [...baseCards, ...extras, customCard].map((c) => ({
    key: `${c.kind}:${c.id || ''}`,
    id: c.id || null,
    kind: c.kind,
    label: c.name || kindMeta(c.kind)[lang === 'fr' ? 'fr' : 'en'],
    blurb: c.tagline || kindBlurb(c.kind, t),
    icon: kindMeta(c.kind).icon,
  }));


  if (cfg.enabled === false) {
    return <div className="max-w-2xl mx-auto py-20 px-4"><EmptyState icon={Package} title={t('myo.off.t', 'Not accepting requests right now')} sub={t('myo.off.s', 'The Make Your Own service is temporarily closed. Check back soon.')} /></div>;
  }

  const Consult = ({ cents, urgent }) => <span className="font-semibold">{fmtMoney(cents, cfg.currency)}{urgent ? ` ${t('myo.urgentTag', '(urgent)')}` : ''}</span>;

  return (
    <div className="max-w-6xl mx-auto px-4 py-10 sm:py-14">
      {/* ── Hero ── */}
      <div className="relative text-center max-w-2xl mx-auto mb-8 sm:mb-10">
        <div aria-hidden className="absolute left-1/2 -translate-x-1/2 -top-24 w-[680px] max-w-[135%] h-80 rounded-full tint-primary blur-3xl -z-10" />
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wider text-[var(--accent-ink)] tint-primary-soft border b-primary mb-4">
          <Sparkles size={13} /> {t('myo.eyebrow', 'Made to order')}
        </span>
        <h1 className="text-3xl sm:text-[2.7rem] font-extrabold tracking-tight leading-[1.08]">{t('myo.title', 'We build it for you')}</h1>
        <p className="text-[var(--muted)] mt-3.5 text-[15px] leading-relaxed">{t('myo.sub', 'A Discord bot, an app, a website — or something else entirely. Start with a paid consultation: real advice and a fixed quote. Nothing is built until you approve it.')}</p>
      </div>

      {/* ── How it works + the clear "what you pay for" disclaimer ── */}
      <div className="mb-8 sm:mb-10 max-w-3xl mx-auto">
        {/* FOLDED now, and only folded.
            The sequence and the two points where money moves led the page: a visitor met the
            billing model before being asked a single question. The survey is what the page is
            for, so this sits one click away instead of in front — but it is NOT hidden, because
            a paid consultation has to say so before anyone starts, and the recap states the fee
            in full before the payment button. */}
        {/* The summary used to be a dotted-underlined sentence floating over a four-column
            grid: it did not read as the control that opens the grid, and once open there was
            nothing tying the two together. A bordered pill that visibly toggles, and a panel
            under it, so the sequence belongs to the thing you clicked. */}
        <details className="group myo-deal">
          <summary className="mx-auto w-fit cursor-pointer list-none select-none flex items-center gap-2 text-xs text-[var(--muted)] rounded-full border border-[var(--line)] px-3.5 py-1.5 hover:b-primary hover:text-[var(--text)] transition-colors">
            <Sparkles size={13} className="text-[var(--accent-ink)] shrink-0" />
            <span>{t('myo.deal.fold', 'How it works, and when you are charged')}</span>
            <ChevronDown size={13} className="shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5">
            <DealRail cfg={cfg} />
          </div>
        </details>
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
        <details className="mt-4 border-t border-[var(--line)] pt-3.5 max-w-3xl mx-auto">
          <summary className="text-xs text-[var(--muted)] cursor-pointer flex items-center gap-2.5 list-none">
            <AlertTriangle size={15} className="shrink-0 text-warning" />
            {t('myo.disclaimer.head', 'What the consultation fee covers, and what it does not')}
          </summary>
          <p className="text-xs text-[var(--muted)] mt-2.5 ps-[25px] leading-relaxed">
            {t('myo.disclaimer', 'The fee pays for advice and a quote — it is NOT the price of the product. Building starts only once you approve and pay that quote. Whether source code is included is always stated on it.')}
          </p>
        </details>
      </div>

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
                <MessageSquare size={18} className="text-[var(--accent-ink)]" /> {t('myo.mine', 'My requests')}
              </h2>
              {unread > 0 && (
                <span className="text-xs font-semibold text-[var(--accent-ink)]">
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
                    <span className="w-9 h-9 rounded-lg bg-[var(--surface-2)] grid place-items-center shrink-0 text-[var(--accent-ink)]"><K size={16} /></span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate" title={r.name}>{r.name}</div>
                      <div className="text-xs text-[var(--faint)]">{new Date(r.createdAt).toLocaleDateString()}</div>
                    </div>
                    {/* A word, not a dot. A coloured circle is only legible to somebody who
                        already knows what it means. */}
                    {r.userUnread && (
                      <span className="text-[11px] font-semibold text-[var(--accent-ink)] whitespace-nowrap">
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

      {/* The survey IS the page.
          It used to open on a catalogue of cards; picking one bounced a signed-out visitor to
          /auth and opened a modal. So the first thing asked for was a login, before a single
          question — nothing invested, nothing to come back to. "What do you want built?" is now
          question 1 of 8 on the page itself, the answers carry the visitor to a recap, and
          signing in happens at the moment of paying, which is the moment it is worth doing. */}
      <div className="flex items-baseline gap-3 mb-4 justify-center text-center flex-wrap">
        <h2 className="text-lg font-bold">{t('myo.pick.t2', 'Tell us what you need')}</h2>
        <span className="text-xs text-[var(--faint)]">{t('myo.pick.s2', 'A few questions, two minutes, no commitment.')}</span>
      </div>
      {cat.loading ? <div className="py-10 grid place-items-center"><Spinner /></div> : (
        <MyoIntakeWizard inline cards={wizardCards} cfg={cfg}
          onNeedAuth={() => { if (user) return false; nav(`/auth?next=${encodeURIComponent('/myo')}`); return true; }} />
      )}
    </div>
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
  if (!r) return <EmptyState icon={AlertTriangle} title={t('myo.notfound', 'Request not found')} sub={t('myo.notfound.s', "It may have been removed, or you don't have access.")}
    action={{ label: t('myo.notfound.a', 'Start a new request'), to: '/myo', icon: Sparkles }} />;
  const K = kindMeta(r.productKind).icon;
  const viewerIsStaff = data.viewerIsStaff;

  return (
    <div className="space-y-4">
      {/* header */}
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <span className="w-11 h-11 rounded-xl tint-primary grid place-items-center text-[var(--accent-ink)] shrink-0">{r.logo ? <img src={r.logo} alt="" className="w-8 h-8 rounded object-contain" /> : <K size={20} />}</span>
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
        {timeline.length === 0 && r.status !== 'pending_payment' && <div className="text-sm text-[var(--faint)] text-center py-6">{t('myo.emptythread', 'No messages yet, say hello!')}</div>}
      </div>

      {/* composer (once paid + not closed) */}
      {r.consultationPaid && r.status !== 'closed' && r.status !== 'cancelled' && (
        <Card className="p-3"><ReportComposer onSend={send} sending={sending} placeholder={t('myo.msgph', 'Write a message…')} /></Card>
      )}
      {(r.status === 'closed') && <div className="text-sm text-[var(--faint)] text-center py-2">{t('myo.closed', 'This request is closed. Send a message to reopen it.')}{r.consultationPaid && <div className="mt-2"><Card className="p-3 text-start"><ReportComposer onSend={send} sending={sending} placeholder={t('myo.reopen', 'Reopen with a message…')} /></Card></div>}</div>}

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
      <div className={`min-w-0 max-w-[80%] ${m.staff ? 'items-end text-end' : ''}`}>
        <div className={`inline-block rounded-2xl px-3.5 py-2 text-sm ${system ? 'bg-[var(--surface-2)] text-[var(--muted)] text-xs italic' : m.staff ? 'tint-primary border b-primary' : 'bg-[var(--surface-2)]'}`}>
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
    <Card className={`p-4 border-2 ${paid ? 'border-success-border' : withdrawn ? 'border-[var(--line)] opacity-60' : 'b-primary'}`}>
      <div className="flex items-center gap-2 mb-2"><FileText size={16} className="text-[var(--accent-ink)]" /><span className="font-semibold">{q.title || t('myo.quote', 'Quote')}</span>
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
      {d.expiry && (
        <p className="text-[11px] text-[var(--faint)] mb-2">
          {d.expiry.status === 'ok'
            ? t('myo.deliver.until', 'Download link valid until {d}, a month after delivery, or 7 days after your first download, whichever comes first.').replace('{d}', d.expiry.expiresAt ? new Date(d.expiry.expiresAt).toLocaleDateString() : '—')
            : t('myo.deliver.expired', 'The download link expired on {d}; the file has been removed.').replace('{d}', d.expiry.expiresAt ? new Date(d.expiry.expiresAt).toLocaleDateString() : '—')}
          {d.expiry.downloads ? ` · ${t('myo.deliver.dl', 'downloaded {n} time(s)').replace('{n}', d.expiry.downloads)}` : ''}
        </p>
      )}
      {d.removed && <p className="text-[11px] text-[var(--faint)] mb-2">{t('myo.deliver.removed', 'File removed when the request was archived: {f}').replace('{f}', d.fileName || '')}</p>}
      <div className="flex flex-wrap gap-2">
        {d.fileUrl && d.expiry?.status !== 'expired' && d.expiry?.status !== 'purged' && d.expiry?.status !== 'revoked' && <a href={d.fileUrl.startsWith('/f/') ? d.fileUrl : d.fileUrl} target={d.fileUrl.startsWith('/f/') ? undefined : '_blank'} rel="noreferrer" download={d.fileUrl.startsWith('/f/') ? undefined : (d.fileName || undefined)}><Button size="sm" variant="primary"><Download size={14} /> {t('myo.download', 'Download')}{d.fileName ? ` · ${d.fileName}` : ''}</Button></a>}
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
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] me-1">{t('myo.admin', 'Consultant')}</span>
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
          {file ? <div className="flex items-center gap-2 text-sm"><FileText size={14} /> <span className="truncate flex-1" title={file.name}>{file.name}</span><button onClick={() => setFile(null)} className="text-[var(--faint)] hover:text-error"><X size={14} /></button></div>
            : <label className="btn btn-sm cursor-pointer inline-flex"><input type="file" className="hidden" onChange={pick} />{uploading ? <Spinner /> : <><Download size={13} className="rotate-180" /> {t('myo.d.upload', 'Upload deliverable')}</>}</label>}
        </div>
        <Field label={t('myo.d.link', 'or external link')}><Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={includesSource} onChange={(e) => setIncludesSource(e.target.checked)} /> {t('myo.qb.source', 'Deliverable includes source code')}</label>
      <div className="flex justify-end"><Button size="sm" variant="primary" disabled={busy} onClick={submit}>{busy ? <Spinner /> : <><Package size={14} /> {t('myo.d.deliverbtn', 'Deliver to customer')}</>}</Button></div>
    </Card>
  );
}
