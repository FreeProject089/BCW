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
import { Heart, Vote, Info, ArrowRight, Check } from 'lucide-react';
import { Button, Card, Badge, Modal, Input, useToast } from '../ui/ui.jsx';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAsync } from './pages.jsx';

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
          <div className="flex items-center justify-between border-t border-[var(--line)] pt-1.5"><span className="text-[var(--muted)]">{t('ch.net', 'Reaches the pot')}</span><span className="font-semibold tabular-nums text-[var(--primary-2)]">{money(netCents, pot.currency)}</span></div>
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
        <p className="text-[11px] text-[var(--faint)] text-center">{t('ch.securenote2', 'You’ll confirm on a secure payment page. Nothing is charged until you do — and gifts are final: donations are not refundable.')}</p>
      </div>
    </Modal>
  );
}

// The shared card body (used both on the home page and the /charity page).
function PotSummary({ pot, t }) {
  const total = pot.totalCents || 0;
  const pct = total > 0 ? Math.round((pot.communityCents / total) * 100) : 0;
  return (
    <>
      <div className="text-3xl font-extrabold tabular-nums">{money(total, pot.currency)}</div>
      <div className="text-xs text-[var(--muted)] mt-1">
        {t('ch.breakdown', 'BetterCommunity {a} + community {b}')
          .replace('{a}', money(pot.orgContribCents, pot.currency))
          .replace('{b}', money(pot.communityCents, pot.currency))}
      </div>
      {total > 0 && (
        <div className="mt-3 h-2.5 rounded-full bg-[var(--surface-2)] overflow-hidden" title={`${pct}% ${t('ch.community', 'community')}`}>
          <div className="h-full rounded-full bg-gradient-to-r from-brand to-brand-2" style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="mt-3 text-sm">
        {pot.association
          ? <span>{t('ch.for', 'This month’s association:')} <b>{pot.association}</b></span>
          : <span className="text-[var(--muted)]">{t('ch.voting', 'The association is being chosen by community vote.')}</span>}
      </div>
      {pot.poll && !pot.association && (
        <div className="mt-2 text-sm text-[var(--muted)] flex items-center justify-center gap-1.5">
          <Vote size={14} className="shrink-0" />
          <span>{pot.poll.question}{pot.poll.open ? '' : ` · ${t('ch.voteclosed', 'vote closed')}`}</span>
        </div>
      )}
      {pot.percent > 0 && <div className="text-xs text-[var(--faint)] mt-1">{t('ch.projected', 'Up to {n}% of eligible monthly revenue is added by BetterCommunity.').replace('{n}', pot.percent)}</div>}
      {pot.status === 'paid' && (
        <div className="mt-3 rounded-lg bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] flex items-center justify-center gap-2 flex-wrap">
          <Check size={15} className="text-[var(--primary-2)] shrink-0" />
          <span>{t('ch.sent', 'This month’s donation has been sent.')}</span>
          {pot.proofUrl && <a href={pot.proofUrl} target="_blank" rel="noreferrer" className="underline text-[var(--primary-2)]">{t('ch.proof', 'View proof')}</a>}
        </div>
      )}
    </>
  );
}

// The frame widths the design can pick — the same table as the API's CHARITY_WIDTHS, so the
// size the admin screen prints ("draw a 1152 × 720 image") is the size the page really uses.
export const CHARITY_WIDTHS = { xl: 576, '2xl': 672, '3xl': 768 };
export const CHARITY_DESIGN_DEFAULTS = { mode: 'default', width: 'xl', height: 360, frame: true, ink: 'auto', align: 'center', backdrop: '', backdropFit: 'cover', overflow: '', bleed: 64, sticker: '', stickerSize: 160, stickerCorner: 'tr', stickerOffset: 24, alt: '' };

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
export function CharityCard({ pot, design, t, onGive, preview = false }) {
  const d = { ...CHARITY_DESIGN_DEFAULTS, ...(design || {}) };
  const custom = d.mode === 'custom' && (d.backdrop || d.overflow || d.sticker);
  const buttons = (
    <div className={`flex flex-wrap gap-2 mt-5 ${d.align === 'left' ? 'justify-start' : d.align === 'right' ? 'justify-end' : 'justify-center'}`}>
      <Button variant="primary" onClick={onGive}><Heart size={15} /> {t('ch.give.cta', 'Increase the pot')}</Button>
      <Link to={pot.poll?.id ? `/polls/${pot.poll.id}` : '/polls'} tabIndex={preview ? -1 : undefined}><Button><Vote size={15} /> {t('ch.vote', 'Vote')}</Button></Link>
      <Link to="/charity" tabIndex={preview ? -1 : undefined}><Button variant="ghost"><Info size={15} /> {t('ch.more', 'Learn more')}</Button></Link>
    </div>
  );
  const heading = (
    <>
      <div className="inline-flex items-center gap-2 text-base font-bold mb-1"><Heart size={18} className={custom && d.ink !== 'auto' ? '' : 'text-[var(--primary-2)]'} /> {t('ch.title', 'Community Charity')}</div>
      <p className={`text-xs mb-4 ${custom && d.ink !== 'auto' ? 'opacity-80' : 'text-[var(--muted)]'}`}>{t('ch.sub', 'Every month a share of our revenue — plus your gifts — goes to a charity the community chooses.')}</p>
    </>
  );
  if (!custom) {
    return (
      <Card className="charity-card-glow p-6 md:p-8 max-w-xl mx-auto text-center relative overflow-hidden">
        <div className="absolute -bottom-16 left-1/2 -translate-x-1/2 w-96 h-96 rounded-full opacity-30 pointer-events-none" style={{ background: 'radial-gradient(circle, var(--primary-glow), transparent 62%)' }} />
        <div className="absolute top-3 right-3 text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full bg-[var(--surface-2)] text-[var(--muted)]">{new Date().toLocaleString(undefined, { month: "long" })}</div>
        <div className="relative">
          <div className="mx-auto mb-3 w-14 h-14 rounded-2xl grid place-items-center bg-gradient-to-br from-brand to-brand-2 text-white shadow-lg shadow-orange-500/25"><Heart size={26} /></div>
          {heading}
          <PotSummary pot={pot} t={t} />
          {buttons}
        </div>
      </Card>
    );
  }
  const W = CHARITY_WIDTHS[d.width] || CHARITY_WIDTHS.xl;
  const bleed = d.overflow ? d.bleed : 0;
  // The ink re-points the text TOKENS (not just `color`), so the muted/faint lines inside
  // PotSummary follow too — they read var(--muted) / var(--faint), which the frame redefines.
  const inkStyle = d.ink === 'light' ? { color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,.55), 0 0 18px rgba(0,0,0,.35)', '--text': '#fff', '--muted': 'rgba(255,255,255,.82)', '--faint': 'rgba(255,255,255,.66)', '--surface-2': 'rgba(255,255,255,.18)' }
    : d.ink === 'dark' ? { color: '#111', textShadow: '0 1px 0 rgba(255,255,255,.45)', '--text': '#111', '--muted': 'rgba(0,0,0,.7)', '--faint': 'rgba(0,0,0,.55)', '--surface-2': 'rgba(0,0,0,.12)' } : {};
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
    <div className="relative mx-auto" style={{ maxWidth: W + 2 * pad, padding: pad }} data-charity-design="custom">
      <div className={`relative ${d.frame ? 'card' : ''} ${align} flex flex-col justify-center p-6 md:p-8 overflow-visible`} style={{ minHeight: d.height, ...inkStyle }}>
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
        <div className={`relative z-[3] flex flex-col ${align} w-full`}>
          {heading}
          <div className={d.align === 'center' ? 'w-full' : 'w-full max-w-md'}><PotSummary pot={pot} t={t} /></div>
          {buttons}
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

export default function CharityPage() {
  const { t } = useI18n();
  const { data, loading } = useAsync(() => api.get('/charity/current').catch(() => null), []);
  const [giving, setGiving] = useState(false);
  const enabled = data && data.enabled !== false;
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-2"><Heart className="text-[var(--primary-2)]" /> {t('ch.title', 'Community Charity')}</h1>
        <p className="text-[var(--muted)] mt-2">{t('ch.page.intro', 'Each month, a share of BetterCommunity’s eligible revenue — plus voluntary gifts from the community — is pooled and donated to an association the Discord community votes for.')}</p>
      </div>

      {loading ? null : enabled ? (
        <Card className="p-6 text-center">
          <PotSummary pot={data} t={t} />
          <div className="flex flex-wrap gap-2 justify-center mt-5">
            <Button variant="primary" onClick={() => setGiving(true)}><Heart size={15} /> {t('ch.give.cta', 'Increase the pot')}</Button>
            <Link to={data.poll?.id ? `/polls/${data.poll.id}` : '/polls'}><Button><Vote size={15} /> {t('ch.vote', 'Vote')}</Button></Link>
          </div>
        </Card>
      ) : (
        <Card className="p-6 text-center text-[var(--muted)]">{t('ch.page.off', 'The charity programme is not running at the moment. Check back soon.')}</Card>
      )}

      <Card className="p-6 space-y-4">
        <h2 className="font-semibold flex items-center gap-2"><Info size={16} /> {t('ch.how.t', 'How it works')}</h2>
        <ol className="space-y-3 text-sm text-[var(--muted)] list-decimal ms-4">
          <li>{t('ch.how.1', 'Each month BetterCommunity sets aside a percentage (up to 50%) of its eligible recurring revenue — what remains after recurring costs.')}</li>
          <li>{t('ch.how.2', 'You can add to the pot at any time. Your gifts and BetterCommunity’s share are tracked as two separate amounts and shown together in one pot.')}</li>
          <li>{t('ch.how.3', 'The community votes on which association receives the month’s pot.')}</li>
          <li>{t('ch.how.4', 'At the end of the month an admin sends the donation manually and posts the proof.')}</li>
        </ol>
        <div className="rounded-lg bg-[var(--surface-2)] p-3 text-xs text-[var(--faint)] flex items-start gap-2">
          <ArrowRight size={14} className="mt-0.5 shrink-0" />
          {t('ch.how.note', 'BetterCommunity’s contribution and the community’s voluntary gifts are two distinct things, brought together in one pot for the final donation.')}
        </div>
      </Card>

      {giving && enabled && <ContributeModal pot={data} onClose={() => setGiving(false)} />}
    </div>
  );
}
