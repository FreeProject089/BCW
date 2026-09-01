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
import { Heart, Vote, Info, ArrowRight } from 'lucide-react';
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
        <div className="flex items-center justify-between rounded-lg bg-[var(--surface-2)] px-3 py-2 text-sm">
          <span className="text-[var(--muted)]">{t('ch.total', 'You give')}</span>
          <span className="font-semibold tabular-nums">{money(finalCents, pot.currency)}</span>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="primary" loading={busy} onClick={go}><Heart size={15} /> {t('ch.confirm', 'Confirm & pay')}</Button>
        </div>
        <p className="text-[11px] text-[var(--faint)] text-center">{t('ch.securenote', 'You’ll confirm on a secure payment page. Nothing is charged until you do.')}</p>
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
      {pot.percent > 0 && <div className="text-xs text-[var(--faint)] mt-1">{t('ch.projected', 'Up to {n}% of eligible monthly revenue is added by BetterCommunity.').replace('{n}', pot.percent)}</div>}
    </>
  );
}

export function CharityWidget() {
  const { t } = useI18n();
  const { data } = useAsync(() => api.get('/charity/current').catch(() => null), []);
  const [giving, setGiving] = useState(false);
  if (!data || data.enabled === false) return null; // charity off → render nothing
  return (
    <section className="reveal-on-scroll">
      <Card className="p-6 md:p-8 max-w-xl mx-auto text-center relative overflow-hidden">
        <div className="absolute -bottom-16 left-1/2 -translate-x-1/2 w-96 h-96 rounded-full opacity-30 pointer-events-none" style={{ background: 'radial-gradient(circle, var(--primary-glow), transparent 62%)' }} />
        <div className="relative">
          <div className="inline-flex items-center gap-2 text-base font-bold mb-1"><Heart size={18} className="text-[var(--primary-2)]" /> {t('ch.title', 'Community Charity')}</div>
          <p className="text-xs text-[var(--muted)] mb-4">{t('ch.sub', 'Every month a share of our revenue — plus your gifts — goes to a charity the community chooses.')}</p>
          <PotSummary pot={data} t={t} />
          <div className="flex flex-wrap gap-2 justify-center mt-5">
            <Button variant="primary" onClick={() => setGiving(true)}><Heart size={15} /> {t('ch.give.cta', 'Increase the pot')}</Button>
            <Link to="/polls"><Button><Vote size={15} /> {t('ch.vote', 'Vote')}</Button></Link>
            <Link to="/charity"><Button variant="ghost"><Info size={15} /> {t('ch.more', 'Learn more')}</Button></Link>
          </div>
        </div>
      </Card>
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
            <Link to="/polls"><Button><Vote size={15} /> {t('ch.vote', 'Vote')}</Button></Link>
          </div>
        </Card>
      ) : (
        <Card className="p-6 text-center text-[var(--muted)]">{t('ch.page.off', 'The charity programme is not running at the moment. Check back soon.')}</Card>
      )}

      <Card className="p-6 space-y-4">
        <h2 className="font-semibold flex items-center gap-2"><Info size={16} /> {t('ch.how.t', 'How it works')}</h2>
        <ol className="space-y-3 text-sm text-[var(--muted)] list-decimal ml-4">
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
