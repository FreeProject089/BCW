// B14 Phase 3 — the user-facing half of Community Charity.
//
//   • CharityWidget — a card near the Ko-fi support block on the home page: the month's pot,
//     the association / live vote, the projected percentage, and the two calls to action
//     ("Augmenter la cagnotte" → the contribute modal, "Voter" → the polls page).
//   • ContributeModal — presets + a custom amount, a confirmation, then Stripe's hosted page.
//   • CharityPage (/charity) — the "En savoir plus" explainer: how it works, the two-streams
//     rule, and the current pot.
//
// The pot is read from GET /charity/current, which returns { enabled:false } when charity is
// off — so every piece here renders nothing at all until an admin turns it on.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, Vote, Info, Check, CalendarDays, Coins, FileCheck, Receipt, ShieldCheck, HandCoins, Landmark, ExternalLink } from 'lucide-react';
import { Button, Card, Badge, Modal, Input, useToast } from '../ui/ui.jsx';
import { api } from '../lib/api.js';
// The SAME sanitiser the studio's page CSS goes through — one filter, tested in one place
// (apps/web/test/canvas-shapes.test.mjs), rather than a second copy that drifts from it.
import { scopeCss, safeClasses } from '../lib/css-scope.js';
import { useI18n } from '../i18n.jsx';
import { Marker } from '../ui/marker.jsx'; // M3 (agent-landing-M)
import { useAsync } from './pages.jsx';
// The same question list /hosting uses (ui/accordion.jsx).
import Accordion from '../ui/accordion.jsx';

// cents → "12.50 CHF". Currency codes are 3-letter ISO; upper-cased for display.
function money(cents, currency) {
  return `${((cents || 0) / 100).toFixed(2)} ${(currency || 'chf').toUpperCase()}`;
}

function ContributeModal({ pot, onClose }) {
  const { t } = useI18n();
  const toast = useToast();
  const presets = pot.presets || [500, 1000, 2500, 5000];
  const [amount, setAmount] = useState(presets[1] || 1000); // cents
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  // A typed custom amount (in whole currency units) wins over the selected preset.
  const customCents = custom.trim() ? Math.round(parseFloat(custom.replace(',', '.')) * 100) : null;
  const finalCents = Number.isFinite(customCents) && customCents > 0 ? customCents : amount;
  // What actually reaches the pot: the gift minus the card-processing fee. Estimated here with
  // Stripe's standard rate (the pot is credited with the EXACT fee from Stripe once paid), so a
  // giver sees why a little less than they give lands in the pot. Config can override the rate.
  const feePct = Number.isFinite(pot.feePercent) ? pot.feePercent : 2.9;
  const feeFixed = Number.isFinite(pot.feeFixedCents) ? pot.feeFixedCents : 30;
  const feeCents = finalCents > 0 ? Math.round(finalCents * feePct / 100) + feeFixed : 0;
  const netCents = Math.max(0, finalCents - feeCents);
  const go = async () => {
    if (!(finalCents >= 100)) { toast.error(t('ch.min', 'The minimum gift is 1.00.')); return; }
    setBusy(true);
    try {
      const r = await api.post('/charity/contribute', { amountCents: finalCents });
      if (r?.url) { window.location.href = r.url; return; } // hand off to Stripe's hosted page
      toast.error(t('common.failed', 'Failed.'));
    } catch (e) {
      toast.error(e?.data?.error === 'charity_disabled' ? t('ch.off', 'Charity is not open right now.')
        : e?.data?.error === 'stripe_not_configured' ? t('ch.nostripe', 'Payments are not available right now.')
          : t('common.failed', 'Failed.'));
    } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={t('ch.give.t', 'Increase the pot')} width="max-w-md">
      <div className="space-y-4">
        <p className="text-sm text-[var(--muted)]">{t('ch.give.s', 'Your gift is added to this month’s community pot, alongside BetterCommunity’s own contribution, and sent to the chosen association.')}</p>
        <div className="grid grid-cols-4 gap-2">
          {presets.map((c) => (
            <button key={c} type="button" onClick={() => { setAmount(c); setCustom(''); }}
              className={`rounded-lg border px-2 py-2 text-sm font-medium transition ${!custom && amount === c ? 'border-[var(--ring)] bg-[var(--surface-2)] text-[var(--text)]' : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'}`}>
              {money(c, pot.currency)}
            </button>
          ))}
        </div>
        <div>
          <label className="text-xs text-[var(--faint)]">{t('ch.custom', 'Or a custom amount')} ({(pot.currency || 'chf').toUpperCase()})</label>
          <Input inputMode="decimal" placeholder="—" value={custom} onChange={(e) => setCustom(e.target.value)} />
        </div>
        <div className="rounded-lg bg-[var(--surface-2)] px-3 py-2.5 text-sm space-y-1.5">
          <div className="flex items-center justify-between"><span className="text-[var(--muted)]">{t('ch.total', 'You give')}</span><span className="font-semibold tabular-nums">{money(finalCents, pot.currency)}</span></div>
          <div className="flex items-center justify-between text-[13px]"><span className="text-[var(--faint)]">{t('ch.fee', 'Estimated card fee')}</span><span className="tabular-nums text-[var(--faint)]">− {money(feeCents, pot.currency)}</span></div>
          <div className="flex items-center justify-between border-t border-[var(--line)] pt-1.5"><span className="text-[var(--muted)]">{t('ch.net', 'Reaches the pot')}</span><span className="font-semibold tabular-nums text-[var(--accent-ink)]">{money(netCents, pot.currency)}</span></div>
        </div>
        {/* Why a little less lands in the pot, and that a gift is final. Both are the questions a
            first-time giver actually has, answered before they pay rather than after. */}
        <p className="text-[11px] text-[var(--faint)] leading-snug">
          {t('ch.feewhy', 'Card processing (Stripe) keeps about {p}% + {f} of each gift, so slightly less than you give reaches the pot — the pot is credited with the exact fee once paid, which may differ by a cent or two from this estimate.').replace('{p}', String(feePct)).replace('{f}', money(feeFixed, pot.currency))}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="primary" loading={busy} onClick={go}><Heart size={15} /> {t('ch.confirm', 'Confirm & pay')}</Button>
        </div>
        <p className="text-[11px] text-[var(--faint)] text-center">{t('ch.securenote2', 'You’ll confirm on a secure payment page. Nothing is charged until you do, and gifts are final: donations are not refundable.')}</p>
      </div>
    </Modal>
  );
}

// ── The card's elements, one component each ───────────────────────────────────────────────
// Each piece is rendered by the default card, by the improved "custom artwork" card and by a
// `code`-mode block, so there is ONE place that decides what "the breakdown line" is. Each
// carries `data-el="<part>"` — the same word the admin ticks in the editor and the hook their
// own CSS targets.
const Amount = ({ pot }) => <div data-el="amount" className="chy-amount text-3xl font-extrabold tabular-nums">{money(pot.totalCents || 0, pot.currency)}</div>;
const Breakdown = ({ pot, t }) => (
  <div data-el="breakdown" className="chy-breakdown text-xs text-[var(--muted)] mt-1">
    {t('ch.breakdown', 'BetterCommunity {a} + community {b}')
      .replace('{a}', money(pot.orgContribCents, pot.currency))
      .replace('{b}', money(pot.communityCents, pot.currency))}
  </div>
);
function Bar({ pot, t }) {
  const total = pot.totalCents || 0;
  if (!(total > 0)) return null;
  const pct = Math.round((pot.communityCents / total) * 100);
  return (
    <div data-el="bar" className="chy-bar mt-3 h-2.5 rounded-full bg-[var(--surface-2)] overflow-hidden" title={`${pct}% ${t('ch.community', 'community')}`}>
      <div className="h-full rounded-full bg-gradient-to-r from-brand to-brand-2" style={{ width: `${pct}%` }} />
    </div>
  );
}
const Association = ({ pot, t }) => (
  <div data-el="association" className="chy-association mt-3 text-sm">
    {pot.association
      ? <span>{t('ch.for', 'This month’s association:')} <b>{pot.association}</b></span>
      : <span className="text-[var(--muted)]">{t('ch.voting', 'The association is being chosen by community vote.')}</span>}
  </div>
);
function PollLine({ pot, t }) {
  if (!pot.poll || pot.association) return null;
  return (
    <div data-el="poll" className="chy-poll mt-2 text-sm text-[var(--muted)] flex items-center justify-center gap-1.5">
      <Vote size={14} className="shrink-0" />
      <span>{pot.poll.question}{pot.poll.open ? '' : ` · ${t('ch.voteclosed', 'vote closed')}`}</span>
    </div>
  );
}
const Projected = ({ pot, t }) => (pot.percent > 0
  ? <div data-el="projected" className="chy-projected text-xs text-[var(--faint)] mt-1">{t('ch.projected', 'Up to {n}% of eligible monthly revenue is added by BetterCommunity.').replace('{n}', pot.percent)}</div>
  : null);
function PaidNotice({ pot, t }) {
  if (pot.status !== 'paid') return null;
  return (
    <div data-el="paid" className="chy-paid mt-3 rounded-lg bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] flex items-center justify-center gap-2 flex-wrap">
      <Check size={15} className="text-[var(--accent-ink)] shrink-0" />
      <span>{t('ch.sent', 'This month’s donation has been sent.')}</span>
      {pot.proofUrl && <a href={pot.proofUrl} target="_blank" rel="noreferrer" className="underline text-[var(--accent-ink)]">{t('ch.proof', 'View proof')}</a>}
    </div>
  );
}

// The shared card body (used both on the home page and the /charity page). `parts` is the
// per-element optionality; absent (the /charity page, the default card) everything shows.
function PotSummary({ pot, t, parts }) {
  const P = parts || ALL_PARTS;
  return (
    <>
      {P.amount && <Amount pot={pot} />}
      {P.breakdown && <Breakdown pot={pot} t={t} />}
      {P.bar && <Bar pot={pot} t={t} />}
      {P.association && <Association pot={pot} t={t} />}
      {P.poll && <PollLine pot={pot} t={t} />}
      {P.projected && <Projected pot={pot} t={t} />}
      {P.paid && <PaidNotice pot={pot} t={t} />}
    </>
  );
}

// The frame widths the design can pick — the same table as the API's CHARITY_WIDTHS, so the
// size the admin screen prints ("draw a 1152 × 720 image") is the size the page really uses.
export const CHARITY_WIDTHS = { xl: 576, '2xl': 672, '3xl': 768 };
// Mirrors apps/api/src/lib/charity.mjs — the API normalises what is stored, this is what the
// editor and the card fall back to for a design saved before a field existed.
export const CHARITY_PART_KEYS = ['icon', 'title', 'sub', 'month', 'amount', 'breakdown', 'bar', 'association', 'poll', 'projected', 'paid', 'give', 'vote', 'more'];
export const CHARITY_BLOCK_KINDS = [...CHARITY_PART_KEYS, 'buttons', 'text', 'spacer', 'image'];
export const CHARITY_LABEL_KEYS = ['title', 'sub', 'give', 'vote', 'more'];
export const CHARITY_CLASS_SLOTS = ['root', 'card', 'content'];
const ALL_PARTS = Object.fromEntries(CHARITY_PART_KEYS.map((k) => [k, true]));
export const CHARITY_DESIGN_DEFAULTS = {
  mode: 'default', width: 'xl', height: 360, frame: true, ink: 'auto', align: 'center',
  backdrop: '', backdropFit: 'cover', overflow: '', bleed: 64,
  sticker: '', stickerSize: 160, stickerCorner: 'tr', stickerOffset: 24, alt: '',
  parts: ALL_PARTS, labels: { title: '', sub: '', give: '', vote: '', more: '' },
  classes: { root: '', card: '', content: '' }, css: '', blocks: [],
};
/** The scope every admin-authored rule is confined to — the card, and nothing outside it. */
export const CHARITY_CSS_SCOPE = '[data-charity-scope]';

// The ink re-points the text TOKENS (not just `color`), so the muted/faint lines inside
// PotSummary follow too — they read var(--muted) / var(--faint), which the frame redefines.
// Exported so the code-mode card and the artwork card cannot drift apart on it.
export function charityInkStyle(ink) {
  return ink === 'light' ? { color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,.55), 0 0 18px rgba(0,0,0,.35)', '--text': '#fff', '--muted': 'rgba(255,255,255,.82)', '--faint': 'rgba(255,255,255,.66)', '--surface-2': 'rgba(255,255,255,.18)', '--accent-ink': '#fbbf24' }
    : ink === 'dark' ? { color: '#111', textShadow: '0 1px 0 rgba(255,255,255,.45)', '--text': '#111', '--muted': 'rgba(0,0,0,.7)', '--faint': 'rgba(0,0,0,.55)', '--surface-2': 'rgba(0,0,0,.12)', '--accent-ink': '#8a3f06' } : {};
}

/** The canvas sizes (in px, at 2× for crisp rendering) an admin should draw for a design. */
export function charityCanvasSizes(d) {
  const w = CHARITY_WIDTHS[d.width] || CHARITY_WIDTHS.xl, h = Number(d.height) || 360, b = Number(d.bleed) || 0, s = Number(d.stickerSize) || 160;
  return {
    frame: { w, h },
    backdrop: { w: w * 2, h: h * 2 },
    overflow: { w: (w + 2 * b) * 2, h: (h + 2 * b) * 2, bleed: b * 2 },
    sticker: { w: s * 2, h: s * 2 },
  };
}

// The card itself — the landing widget AND the admin's live preview draw this one component,
// so what the admin sees while uploading is what the home page shows.
//   design.mode === 'default' → the plain glowing card;
//   'custom' → the admin's artwork: a backdrop covering the frame, an overflow layer that
//   spills `bleed` px past the frame on every side (drawn ABOVE the frame so a mascot can lean
//   out of it, but under the text and buttons so nothing becomes unclickable), and a sticker
//   pinned to a corner half outside. The frame's own border/background can be dropped when
//   the artwork is the whole design.
//   'code' → nothing at all is drawn by the site: the card IS the admin's ordered block list,
//   inside a bare box, styled by the admin's own (scoped) stylesheet. Every block is optional,
//   including all of them, and no block carries markup — text is a text node.
export function CharityCard({ pot, design, t, onGive, preview = false }) {
  const d = { ...CHARITY_DESIGN_DEFAULTS, ...(design || {}) };
  // The two authored modes share the per-element switches, the re-worded labels, the extra
  // class tokens and the stylesheet. `default` ignores all of it — that is what keeps a card
  // saved before any of this existed rendering byte-for-byte as it did.
  const authored = d.mode === 'custom' || d.mode === 'code';
  const P = authored ? { ...ALL_PARTS, ...(d.parts || {}) } : ALL_PARTS;
  const L = { ...CHARITY_DESIGN_DEFAULTS.labels, ...(d.labels || {}) };
  const cls = (k) => (authored ? safeClasses(d.classes?.[k]) : '');
  // The one place admin-authored CSS is turned into a stylesheet. `scopeCss` prefixes every
  // selector with the card's own scope and refuses @import / expression() / behavior /
  // -moz-binding / javascript: / @namespace and any url() that is not same-origin, an anchor
  // or an inline data: image — the same filter the studio's page CSS goes through.
  const scoped = authored && d.css ? scopeCss(d.css, CHARITY_CSS_SCOPE).css : '';
  const custom = d.mode === 'custom' && (d.backdrop || d.overflow || d.sticker || d.css || cls('root') || cls('card') || cls('content')
    || CHARITY_PART_KEYS.some((k) => P[k] === false) || CHARITY_LABEL_KEYS.some((k) => L[k]));
  const inked = (d.mode === 'custom' || d.mode === 'code') && d.ink !== 'auto';
  const giveBtn = <Button variant="primary" onClick={onGive} data-el="give" className="chy-give"><Heart size={15} /> {L.give || t('ch.give.cta', 'Increase the pot')}</Button>;
  const voteBtn = <Link key="vote" to={pot.poll?.id ? `/polls/${pot.poll.id}` : '/polls'} tabIndex={preview ? -1 : undefined}><Button data-el="vote" className="chy-vote"><Vote size={15} /> {L.vote || t('ch.vote', 'Vote')}</Button></Link>;
  const moreBtn = <Link key="more" to="/charity" tabIndex={preview ? -1 : undefined}><Button variant="ghost" data-el="more" className="chy-more"><Info size={15} /> {L.more || t('ch.more', 'Learn more')}</Button></Link>;
  const buttonRow = (P.give || P.vote || P.more) ? (
    <div data-el="buttons" className={`chy-buttons flex flex-wrap gap-2 mt-5 ${d.align === 'left' ? 'justify-start' : d.align === 'right' ? 'justify-end' : 'justify-center'}`}>
      {P.give && giveBtn}{P.vote && voteBtn}{P.more && moreBtn}
    </div>
  ) : null;
  const buttons = buttonRow;
  const titleLine = P.title ? <div data-el="title" className="chy-title inline-flex items-center gap-2 text-base font-bold mb-1">{P.icon && <Heart size={18} className={inked ? '' : 'text-[var(--accent-ink)]'} />} {L.title || t('ch.title', 'Community Charity')}</div> : null;
  const heading = (
    <>
      {titleLine}
      {/* One line above the numbers, and ONE way to read more.
          A fold was added here and the card already had a "Learn more" button pointing at
          /charity, so the same card offered the same promise twice, three centimetres apart,
          leading to two different places. /charity is the long version and always was: it
          explains the two streams, the vote and the proof at length. A fold that paraphrases
          a whole page is a second copy that will drift from it. The button stays because it
          goes to the real thing; the fold goes. */}
      {P.sub && <p data-el="sub" className={`chy-sub text-xs mb-4 ${inked ? 'opacity-80' : 'text-[var(--muted)]'}`}>{L.sub || t('ch.sub', 'A charity the community chooses, every month.')}</p>}
    </>
  );
  if (d.mode === 'code') return <CharityCodeCard {...{ d, pot, t, L, scoped, cls, giveBtn, voteBtn, moreBtn, buttonRow }} />;
  if (!custom) {
    return (
      <Card className="grain-hero charity-card-glow p-6 md:p-8 max-w-xl mx-auto text-center relative overflow-hidden">
        <div className="absolute -bottom-16 left-1/2 -translate-x-1/2 w-96 h-96 rounded-full opacity-30 pointer-events-none" style={{ background: 'radial-gradient(circle, var(--primary-glow), transparent 62%)' }} />
        <div className="absolute top-3 right-3 text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full bg-[var(--surface-2)] text-[var(--muted)]">{new Date().toLocaleString(undefined, { month: "long" })}</div>
        <div className="relative">
          <div className="mx-auto mb-3 w-14 h-14 rounded-2xl grid place-items-center bg-gradient-to-br from-brand to-brand-2 text-[var(--on-primary)] shadow-lg shadow-orange-500/25"><Heart size={26} /></div>
          {heading}
          <PotSummary pot={pot} t={t} />
          {buttons}
        </div>
      </Card>
    );
  }
  const W = CHARITY_WIDTHS[d.width] || CHARITY_WIDTHS.xl;
  const bleed = d.overflow ? d.bleed : 0;
  const inkStyle = charityInkStyle(d.ink);
  const half = Math.round(d.stickerSize / 2);
  const corner = {
    tl: { top: -d.stickerOffset, left: -d.stickerOffset },
    tr: { top: -d.stickerOffset, right: -d.stickerOffset },
    bl: { bottom: -d.stickerOffset, left: -d.stickerOffset },
    br: { bottom: -d.stickerOffset, right: -d.stickerOffset },
  }[d.stickerCorner] || {};
  const align = d.align === 'left' ? 'text-left items-start' : d.align === 'right' ? 'text-right items-end' : 'text-center items-center';
  const pad = Math.max(bleed, d.sticker ? d.stickerOffset + half : 0);
  return (
    // The wrapper reserves the bleed + sticker overhang so a parent with overflow:hidden (or
    // the next section) never clips the artwork that is meant to stick out.
    <div className={`relative mx-auto ${cls('root')}`} style={{ maxWidth: W + 2 * pad, padding: pad }} data-charity-design="custom" data-charity-scope="">
      {scoped && <style>{scoped}</style>}
      <div className={`chy-card relative ${d.frame ? 'card' : ''} ${align} flex flex-col justify-center p-6 md:p-8 overflow-visible ${cls('card')}`} style={{ minHeight: d.height, ...inkStyle }}>
        {d.backdrop && (
          <div className={`absolute inset-0 pointer-events-none ${d.frame ? 'rounded-[inherit] overflow-hidden' : ''}`} aria-hidden="true">
            <img src={d.backdrop} alt="" className="w-full h-full block" style={{ objectFit: d.backdropFit }} draggable={false} />
          </div>
        )}
        {d.overflow && (
          <img src={d.overflow} alt={d.alt || ''} draggable={false} className="absolute pointer-events-none select-none z-[2]"
            style={{ top: -bleed, left: -bleed, width: `calc(100% + ${2 * bleed}px)`, height: `calc(100% + ${2 * bleed}px)`, maxWidth: 'none', objectFit: 'fill' }} />
        )}
        {d.sticker && (
          <img src={d.sticker} alt="" draggable={false} className="absolute pointer-events-none select-none z-[4] drop-shadow-lg" style={{ width: d.stickerSize, height: d.stickerSize, objectFit: 'contain', ...corner }} />
        )}
        <div className={`chy-content relative z-[3] flex flex-col ${align} w-full ${cls('content')}`}>
          {heading}
          <div className={d.align === 'center' ? 'w-full' : 'w-full max-w-md'}><PotSummary pot={pot} t={t} parts={P} /></div>
          {buttons}
        </div>
      </div>
    </div>
  );
}

// The month pill and the big heart tile, as pieces a `code` design can place (or leave out).
const MonthBadge = () => <div data-el="month" className="chy-month text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full bg-[var(--surface-2)] text-[var(--muted)]">{new Date().toLocaleString(undefined, { month: 'long' })}</div>;
const IconTile = () => <div data-el="icon" className="chy-icon w-14 h-14 rounded-2xl grid place-items-center bg-gradient-to-br from-brand to-brand-2 text-[var(--on-primary)] shadow-lg"><Heart size={26} /></div>;

// ── Mode 3: the card the admin writes themselves ──────────────────────────────────────────
// The site draws NO chrome here beyond an optional frame: the card is the admin's ordered
// block list, and their own stylesheet (scoped to this card) does the design. An empty list is
// a legitimate design — an empty card — which is what "every element is optional" has to mean.
//
// What an admin CANNOT do, by construction: ship markup (a `text` block is a text node, so a
// `<script>` or an `onerror=` is characters on screen, not a node), reach outside this card
// with a selector (`scopeCss` prefixes every one), or make the page fetch from a third party
// (`url()` is restricted to same-origin paths, anchors and inline data: images — the CSS
// exfiltration channel a previous pass closed for the studio).
function CharityCodeCard({ d, pot, t, L, scoped, cls, giveBtn, voteBtn, moreBtn, buttonRow }) {
  const W = CHARITY_WIDTHS[d.width] || CHARITY_WIDTHS.xl;
  const align = d.align === 'left' ? 'text-left items-start' : d.align === 'right' ? 'text-right items-end' : 'text-center items-center';
  const blocks = Array.isArray(d.blocks) ? d.blocks : [];
  const piece = (b) => {
    switch (b.kind) {
      case 'icon': return <IconTile />;
      case 'title': return <div data-el="title" className="chy-title text-base font-bold">{L.title || t('ch.title', 'Community Charity')}</div>;
      case 'sub': return <p data-el="sub" className="chy-sub text-xs">{L.sub || t('ch.sub', 'A charity the community chooses, every month.')}</p>;
      case 'month': return <MonthBadge />;
      case 'amount': return <Amount pot={pot} />;
      case 'breakdown': return <Breakdown pot={pot} t={t} />;
      case 'bar': return <Bar pot={pot} t={t} />;
      case 'association': return <Association pot={pot} t={t} />;
      case 'poll': return <PollLine pot={pot} t={t} />;
      case 'projected': return <Projected pot={pot} t={t} />;
      case 'paid': return <PaidNotice pot={pot} t={t} />;
      case 'give': return giveBtn;
      case 'vote': return voteBtn;
      case 'more': return moreBtn;
      case 'buttons': return buttonRow;
      // Author text: a text node, never markup. `{b.text}` is escaped by React — that is the
      // whole reason this mode has no HTML field.
      case 'text': return <div data-el="text" className="chy-text text-sm">{b.text}</div>;
      case 'spacer': return <div data-el="spacer" className="chy-spacer" style={{ height: b.size || 16 }} />;
      // The URL shape is the API's `imgUrl` allowlist (same-origin media or http(s)); the alt
      // text is the admin's own words, so a decorative image can still say what it is.
      case 'image': return b.src ? <img data-el="image" className="chy-image max-w-full" src={b.src} alt={b.text || ''} draggable={false} style={{ width: b.size || undefined }} /> : null;
      default: return null;
    }
  };
  return (
    <div className={`relative mx-auto ${cls('root')}`} style={{ maxWidth: W }} data-charity-design="code" data-charity-scope="">
      {scoped && <style>{scoped}</style>}
      <div className={`chy-card relative ${d.frame ? 'card p-6 md:p-8' : ''} ${align} flex flex-col justify-center overflow-visible ${cls('card')}`}
        style={{ minHeight: d.height, ...charityInkStyle(d.ink) }}>
        <div className={`chy-content flex flex-col w-full ${align} ${cls('content')}`}>
          {blocks.map((b) => <div key={b.id} data-b={b.id} className={`chy-block ${safeClasses(b.cls)}`}>{piece(b)}</div>)}
        </div>
      </div>
    </div>
  );
}

export function CharityWidget() {
  const { t } = useI18n();
  const { data } = useAsync(() => api.get('/charity/current').catch(() => null), []);
  const [giving, setGiving] = useState(false);
  if (!data || data.enabled === false) return null; // charity off → render nothing
  return (
    <section className="reveal-on-scroll">
      <CharityCard pot={data} design={data.design} t={t} onGive={() => setGiving(true)} />
      {giving && <ContributeModal pot={data} onClose={() => setGiving(false)} />}
    </section>
  );
}

// ── /charity ───────────────────────────────────────────────────────────────────────────────
// The long version of the card: this month's pot, where the money goes, and what every past
// month did. Rebuilt for trust rather than for decoration: every number on it comes from the
// API (/charity/current, /charity/history), nothing is a target the site invented, and the
// page says plainly what it does NOT publish (who gave). The payment path is the same modal
// the landing card opens (ContributeModal above), untouched.

/** "2026-09" → "September 2026", in the reader's language. UTC, so the 1st never slips back. */
function monthLabel(month, lang) {
  const d = new Date(`${month}-01T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return month;
  return d.toLocaleDateString(lang || undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Days left in the current calendar month, and how far through it we are (0-1). */
function monthClock(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const left = Math.max(0, Math.ceil((end - now) / 86400000));
  return { left, done: Math.min(1, Math.max(0, (now - start) / (end - start))) };
}

/** A month's state, as a badge: sent (with proof), being sent, or still collecting. */
function StatusBadge({ status, t }) {
  if (status === 'paid') return <Badge tone="success"><Check size={11} /> {t('ch.st.paid', 'Sent')}</Badge>;
  if (status === 'closing') return <Badge tone="warning"><CalendarDays size={11} /> {t('ch.st.closing', 'Being sent')}</Badge>;
  return <Badge><Coins size={11} /> {t('ch.st.open', 'Collecting')}</Badge>;
}

/** The two streams as one stacked bar, with a legend that carries the amounts. */
function Streams({ pot, t }) {
  const total = pot.totalCents || 0;
  const orgPct = total > 0 ? Math.round((pot.orgContribCents / total) * 100) : 0;
  const rows = [
    [t('ch.stream.org', 'From BetterCommunity'), pot.orgContribCents, 'var(--primary)'],
    [t('ch.stream.com', 'From the community'), pot.communityCents, 'color-mix(in srgb, var(--primary-2) 55%, var(--surface-2))'],
  ];
  return (
    <div className="mt-5">
      <div className="h-3 rounded-full bg-[var(--surface-2)] overflow-hidden flex" role="img"
        aria-label={t('ch.stream.aria', '{a}% from BetterCommunity, {b}% from the community').replace('{a}', String(orgPct)).replace('{b}', String(total > 0 ? 100 - orgPct : 0))}>
        {total > 0 && rows.map(([label, cents, bg]) => (
          cents > 0 ? <i key={label} className="block h-full" style={{ width: `${(cents / total) * 100}%`, background: bg }} /> : null
        ))}
      </div>
      <dl className="mt-3 grid gap-2 text-[13px]">
        {rows.map(([label, cents, bg]) => (
          <div key={label} className="flex items-center gap-2.5 min-w-0">
            <i aria-hidden className="block w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: bg }} />
            <dt className="flex-1 min-w-0 text-[var(--muted)]">{label}</dt>
            <dd className="font-semibold tabular-nums">{money(cents, pot.currency)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function CharityPage() {
  const { t, lang } = useI18n();
  const { data, loading } = useAsync(() => api.get('/charity/current').catch(() => null), []);
  const { data: hist } = useAsync(() => api.get('/charity/history').catch(() => null), []);
  const [giving, setGiving] = useState(false);
  const enabled = data && data.enabled !== false;
  const clock = monthClock();
  const past = hist?.months || [];

  // What the page promises, each one something the code actually does.
  const trust = [
    [Vote, t('ch.trust.vote', 'The association is chosen by a community vote')],
    [FileCheck, t('ch.trust.proof', 'Proof of every donation is published')],
    [Receipt, t('ch.trust.fees', 'Card fees are shown before you pay')],
    [ShieldCheck, t('ch.trust.names2', 'Who gave is never published')],
  ];
  // The four steps, in the words the page has always used for them.
  const flow = [
    [Coins, t('ch.flow.1', 'Two sources'), t('ch.how.1', 'Each month BetterCommunity sets aside a percentage (up to 50%) of its eligible recurring revenue, what remains after recurring costs.')],
    [HandCoins, t('ch.flow.2', 'One pot'), t('ch.how.2', 'You can add to the pot at any time. Your gifts and BetterCommunity’s share are tracked as two separate amounts and shown together in one pot.')],
    [Vote, t('ch.flow.3', 'A vote'), t('ch.how.3', 'The community votes on which association receives the month’s pot.')],
    [Landmark, t('ch.flow.4', 'The donation, and its proof'), t('ch.how.4', 'At the end of the month an admin sends the donation manually and posts the proof.')],
  ];
  const faq = [
    { id: 'fee', q: t('ch.faq.fee.q', 'Why does a little less than I give reach the pot?'),
      a: t('ch.faq.fee.a', 'The card processor keeps a fee on every payment. The gift form shows the estimate before you pay, and the pot is credited with the exact fee once the payment goes through.') },
    { id: 'refund', q: t('ch.faq.refund.q', 'Can a gift be refunded?'),
      a: t('ch.faq.refund.a', 'No. Gifts are final: once it is in the pot, it goes to the month’s association. Nothing is charged until you confirm on the secure payment page.') },
    { id: 'share', q: t('ch.faq.share.q', 'How is BetterCommunity’s share worked out?'),
      a: data?.percent > 0
        ? t('ch.faq.share.a2', 'It is {n}% of the month’s eligible recurring revenue, meaning what remains after recurring costs. It is frozen when the month closes, so it cannot change afterwards.').replace('{n}', String(data.percent))
        : t('ch.faq.share.a', 'It is a percentage (at most 50%) of the month’s eligible recurring revenue, meaning what remains after recurring costs. It is frozen when the month closes, so it cannot change afterwards.') },
    { id: 'names', q: t('ch.faq.names.q', 'Is my name shown anywhere?'),
      a: t('ch.faq.names.a', 'No. The page shows the totals and how many gifts made them up, never who gave or how much any one person gave.') },
  ];

  return (
    <div className="max-w-5xl mx-auto">
      <header className="plate max-w-3xl">
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight flex items-center gap-2.5">
          <Heart className="text-[var(--accent-ink)] shrink-0" /> <Marker delay={200}>{t('ch.title', 'Community Charity')}</Marker>
        </h1>
        <p className="text-[var(--muted)] mt-3 text-[15.5px] leading-relaxed">{t('ch.page.intro', 'Each month, a share of BetterCommunity’s eligible revenue — plus voluntary gifts from the community — is pooled and donated to an association the Discord community votes for.')}</p>
      </header>
      <ul className="mt-6 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {trust.map(([Icon, label]) => (
          <li key={label} className="card flex items-start gap-2.5 px-3.5 py-3 text-[13px] leading-snug min-w-0">
            <Icon size={16} className="text-[var(--accent-ink)] shrink-0 mt-px" aria-hidden /> <span className="min-w-0">{label}</span>
          </li>
        ))}
      </ul>

      {/* This month. */}
      <section className="mt-8" aria-labelledby="ch-now">
        {loading ? <Card className="p-6 min-h-[16rem]" aria-busy="true" /> : enabled ? (
          <Card className="overflow-hidden">
            <div className="grid md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
              <div className="p-6 sm:p-8 min-w-0">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <h2 id="ch-now" className="text-[13px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                    {t('ch.now', 'The pot for {m}').replace('{m}', monthLabel(data.month, lang))}
                  </h2>
                  <StatusBadge status={data.status} t={t} />
                </div>
                <div className="mt-3 text-4xl sm:text-5xl font-extrabold tabular-nums tracking-tight">{money(data.totalCents, data.currency)}</div>
                <Streams pot={data} t={t} />
                <div className="mt-5 pt-5 border-t border-[var(--line)] text-[13.5px] flex items-start gap-2.5">
                  <Landmark size={16} className="shrink-0 mt-px text-[var(--accent-ink)]" aria-hidden />
                  <div className="min-w-0">
                    {data.association
                      ? <span>{t('ch.for', 'This month’s association:')} <b>{data.association}</b></span>
                      : <span className="text-[var(--muted)]">{t('ch.voting', 'The association is being chosen by community vote.')}</span>}
                    {data.poll && !data.association && (
                      <div className="text-[12.5px] text-[var(--muted)] mt-1">{data.poll.question}{data.poll.open ? '' : ` · ${t('ch.voteclosed', 'vote closed')}`}</div>
                    )}
                  </div>
                </div>
                {data.percent > 0 && <p className="text-[12px] text-[var(--muted)] mt-3">{t('ch.projected', 'Up to {n}% of eligible monthly revenue is added by BetterCommunity.').replace('{n}', data.percent)}</p>}
                {data.status === 'paid' && (
                  <div className="mt-4 rounded-lg bg-[var(--surface-2)] px-3 py-2.5 text-sm flex items-center gap-2 flex-wrap">
                    <Check size={15} className="text-success shrink-0" />
                    <span>{t('ch.sent', 'This month’s donation has been sent.')}</span>
                    {data.proofUrl && <a href={data.proofUrl} target="_blank" rel="noreferrer" className="underline text-[var(--accent-ink)] inline-flex items-center gap-1">{t('ch.proof', 'View proof')} <ExternalLink size={12} /></a>}
                  </div>
                )}
              </div>

              <div className="panel p-6 sm:p-8 border-t md:border-t-0 md:border-s border-[var(--line)] flex flex-col gap-4 min-w-0">
                {data.status === 'open' && (
                  <div>
                    <div className="flex items-baseline justify-between gap-2 text-[12.5px] text-[var(--muted)]">
                      <span>{t('ch.clock', '{n} days left to add to it').replace('{n}', String(clock.left))}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden" aria-hidden>
                      <div className="h-full rounded-full bg-[var(--line-strong)]" style={{ width: `${Math.round(clock.done * 100)}%` }} />
                    </div>
                  </div>
                )}
                <Button variant="primary" className="w-full !whitespace-normal" onClick={() => setGiving(true)}><Heart size={15} className="shrink-0" /> {t('ch.give.cta', 'Increase the pot')}</Button>
                <Link to={data.poll?.id ? `/polls/${data.poll.id}` : '/polls'} className="block"><Button className="w-full !whitespace-normal"><Vote size={15} className="shrink-0" /> {t('ch.vote', 'Vote')}</Button></Link>
                <p className="text-[12px] text-[var(--muted)] leading-relaxed">{t('ch.securenote2', 'You’ll confirm on a secure payment page. Nothing is charged until you do, and gifts are final: donations are not refundable.')}</p>
              </div>
            </div>
          </Card>
        ) : (
          <Card className="p-6 text-center text-[var(--muted)]">{t('ch.page.off', 'The charity programme is not running at the moment. Check back soon.')}</Card>
        )}
      </section>

      {/* Where the money goes: the four steps, as a path. */}
      <section className="mt-14" aria-labelledby="ch-how">
        <div className="plate w-fit max-w-full">
          <h2 id="ch-how" className="text-2xl font-extrabold tracking-tight">{t('ch.how.t2', 'Where the money goes')}</h2>
        </div>
        <ol className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {flow.map(([Icon, title, desc], i) => (
            <li key={title} className="card p-5 min-w-0 flex flex-col">
              <div className="flex items-center gap-2.5">
                <span aria-hidden className="grid place-items-center w-9 h-9 rounded-xl shrink-0 border border-[var(--line)]"
                  style={{ background: 'color-mix(in srgb, var(--primary) 12%, var(--surface-2))' }}>
                  <Icon size={17} className="text-[var(--accent-ink)]" />
                </span>
                <span className="text-[11px] font-bold text-[var(--muted)] tabular-nums">{String(i + 1).padStart(2, '0')}</span>
              </div>
              <div className="font-semibold mt-3 leading-snug">{title}</div>
              <p className="text-[13px] text-[var(--muted)] mt-1.5 leading-relaxed">{desc}</p>
            </li>
          ))}
        </ol>
        <p className="card mt-3 px-4 py-3 text-[12.5px] text-[var(--muted)] flex items-start gap-2 leading-relaxed">
          <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
          {t('ch.how.note', 'BetterCommunity’s contribution and the community’s voluntary gifts are two distinct things, brought together in one pot for the final donation.')}
        </p>
      </section>

      {/* The record. Every closed month, with its proof when there is one. */}
      {enabled && (
        <section className="mt-14" aria-labelledby="ch-past">
          <div className="plate w-fit max-w-full">
            <h2 id="ch-past" className="text-2xl font-extrabold tracking-tight">{t('ch.past.t', 'Past months')}</h2>
            <p className="text-[var(--muted)] mt-1.5 text-[14px]">{t('ch.past.s', 'Totals and the number of gifts. Who gave is never shown.')}</p>
          </div>
          {!past.length ? (
            <Card className="mt-5 p-6 text-sm text-[var(--muted)]">{t('ch.past.none', 'No month has closed yet. Each one appears here when it does, with its proof once the donation is sent.')}</Card>
          ) : (
            <ul className="mt-5 card divide-y divide-[var(--line)] overflow-hidden">
              {past.map((m) => (
                <li key={m.month} className="px-4 sm:px-6 py-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1 basis-56">
                    <div className="font-semibold capitalize">{monthLabel(m.month, lang)}</div>
                    <div className="text-[12.5px] text-[var(--muted)] mt-0.5">{m.association || t('ch.past.noassoc', 'No association recorded')}</div>
                  </div>
                  <div className="text-end">
                    <div className="font-bold tabular-nums">{money(m.totalCents, m.currency)}</div>
                    <div className="text-[11.5px] text-[var(--faint)] tabular-nums">
                      {/* The language's own plural rule: French says "0 don", English "0 gifts". */}
                      {(new Intl.PluralRules(lang || undefined).select(m.gifts) === 'one'
                        ? t('ch.past.gift1n', '{n} gift') : t('ch.past.gifts', '{n} gifts')).replace('{n}', String(m.gifts))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <StatusBadge status={m.status} t={t} />
                    {m.proofUrl && <a href={m.proofUrl} target="_blank" rel="noreferrer" className="text-[12.5px] underline text-[var(--accent-ink)] inline-flex items-center gap-1 min-h-[24px] max-lg:min-h-[44px]">{t('ch.proof', 'View proof')} <ExternalLink size={12} /></a>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="mt-14 mb-4" aria-labelledby="ch-faq">
        <div className="plate w-fit max-w-full">
          <h2 id="ch-faq" className="text-2xl font-extrabold tracking-tight">{t('ch.faq.t', 'Questions')}</h2>
        </div>
        <Accordion className="mt-5" items={faq} />
      </section>

      {giving && enabled && <ContributeModal pot={data} onClose={() => setGiving(false)} />}
    </div>
  );
}
