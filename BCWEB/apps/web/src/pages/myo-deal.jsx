// When money moves, and how much — the one thing this whole page is about.
//
// It was said four times on the commission page and once more on the landing band: in the
// hero, across three numbered steps, in a folded disclaimer, and again on the custom card.
// Repeated that hard it reads as anxiety rather than as clarity, and a visitor still had to
// assemble the actual sequence themselves out of five paragraphs.
//
// So it is drawn once, as what it is: a short sequence with two points where money moves and
// two where it does not. The filled markers are the payments. Nothing here is a promise the
// page makes up — both amounts come from the same `/myo/products` config the intake form and
// the server read, so a change of price changes this rail and nothing has to remember to.
import { CreditCard, FileText, Check, Package } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { fmtMoney } from '../lib/money.js';

/**
 * @param {object}  props
 * @param {object}  props.cfg      the `/myo/products` config — consultationCents, currency…
 * @param {boolean} props.compact  the landing-page form: one row, no prose
 */
export default function DealRail({ cfg = {}, compact = false }) {
  const { t } = useI18n();
  const money = (cents) => fmtMoney(cents, cfg.currency);
  // `cfg` is `{}` until /myo/products answers — and fmtMoney turns a missing amount into a
  // perfectly formatted 0. So the one step that exists to say "this is paid" announced
  // "0,00 $US", in dollars, on a French page: a free consultation, at the wrong currency,
  // stated with total confidence. Say nothing rather than say zero.
  const priced = Number.isFinite(cfg.consultationCents) && cfg.consultationCents > 0;

  const steps = [
    {
      pays: true,
      icon: CreditCard,
      title: t('deal.1', 'You pay for advice'),
      // Not a number yet, so not a pill: the pill is the shape an AMOUNT wears here, and
      // dressing a sentence in it both lies about what it is and wraps to two lines, which
      // pushes this column's body out of line with the other three.
      unknown: !priced,
      amount: priced ? money(cfg.consultationCents) : t('deal.priceSoon', 'price shown before you pay'),
      // The urgent price is named rather than hidden behind "from": a reader who needs it
      // urgently is exactly the reader who should not find the real number at checkout.
      // On its OWN line, not inside the pill — measured against the real layout,
      // "45,00 CHF · 90,00 CHF urgent" is 171px in a 167px column, so the two prices wrapped
      // to two lines INSIDE a rounded border. They were hard to read even when they fit.
      note: priced && cfg.urgentConsultationCents && cfg.urgentConsultationCents !== cfg.consultationCents
        ? t('deal.urgentLine', '{p} if you need it urgently').replace('{p}', money(cfg.urgentConsultationCents))
        : '',
      body: t('deal.1.d', 'This opens a private conversation with a consultant. It buys advice and a quote, it is not the price of the thing.'),
    },
    {
      pays: false,
      icon: FileText,
      title: t('deal.2', 'You get an itemised quote'),
      amount: t('deal.nomoney', 'no charge'),
      body: t('deal.2.d', 'A line-by-line price with a date it is valid until, and whether source code is included.'),
    },
    {
      pays: true,
      icon: Check,
      title: t('deal.3', 'You decide'),
      amount: t('deal.quoted', 'the quoted price'),
      body: t('deal.3.d', 'Nothing is charged for the work until you approve that quote. Say no and it stops here, with the advice you already paid for.'),
    },
    {
      pays: false,
      icon: Package,
      title: t('deal.4', 'It gets built and delivered'),
      amount: t('deal.included', 'included'),
      body: t('deal.4.d', 'In the same conversation, so the quote, the work and the delivery are one thread you can read back.'),
    },
  ];

  return (
    <>
      <ol className={compact ? 'grid sm:grid-cols-2 gap-x-5 gap-y-3' : 'relative grid md:grid-cols-4 gap-5'}>
        {/* The rail, behind the markers. It stops at the first and last one rather than running
            the width of the row — a line continuing past the end promises a fifth step. */}
        {!compact && <div aria-hidden className="hidden md:block absolute top-[18px] left-[12.5%] right-[12.5%] h-px bg-[var(--line)]" />}
        {steps.map((s, i) => (
          <li key={s.title} className={compact ? 'flex items-start gap-2.5' : 'relative'}>
            <span aria-hidden className={`relative grid place-items-center rounded-full shrink-0 ${compact ? 'w-7 h-7' : 'w-9 h-9'} ${
              s.pays
                ? 'bg-[var(--primary)] text-white'
                : 'bg-[var(--bg-solid)] border-2 border-[var(--line-strong)] text-[var(--muted)]'
            }`}>
              <s.icon size={compact ? 14 : 17} />
              {/* The order was carried only by reading left to right, which stops being true
                  the moment the grid wraps to one column on a phone. */}
              {!compact && (
                <span className="absolute -top-1 -end-1 grid place-items-center w-[15px] h-[15px] rounded-full text-[9px] font-bold tabular-nums bg-[var(--bg-solid)] border border-[var(--line-strong)] text-[var(--muted)]">{i + 1}</span>
              )}
            </span>
            <div className={compact ? 'min-w-0' : 'mt-3'}>
              <div className="font-semibold text-[13px] leading-snug">{s.title}</div>
              {/* The amount IS the payment signal, so it wears it.
                  A filled marker was the only thing separating "you pay here" from "you do
                  not", which is colour doing the whole job — invisible to anyone who cannot
                  separate the two, and it fought its own icon on step 3, where a filled tick
                  reads as "done" rather than "this is where you are charged". As a pill on
                  the amount, the distinction sits on the words that carry it: a solid
                  "45,00 CHF" against an outlined "sans frais". */}
              <div className={s.unknown
                ? 'mt-1 text-[11.5px] text-[var(--faint)] italic leading-snug'
                : `inline-flex items-center rounded-full px-2 py-[3px] mt-1 text-[11.5px] font-semibold tabular-nums ${
                  s.pays
                    ? 'tint-primary text-[var(--accent-ink)] border b-primary'
                    : 'text-[var(--faint)] border border-[var(--line)]'
                }`}>{s.amount}</div>
              {s.note && <div className="text-[11px] text-[var(--faint)] tabular-nums mt-1">{s.note}</div>}
              {!compact && <p className="text-[12px] text-[var(--muted)] leading-relaxed mt-1.5">{s.body}</p>}
            </div>
          </li>
        ))}
      </ol>
      {/* Says out loud what the styling means. Without it the two solid markers are a pattern
          the reader is left to decode, on the one page where guessing wrong costs money. */}
      {!compact && (
        <p className="text-[11.5px] text-[var(--muted)] mt-4 flex items-center gap-2 justify-center text-center">
          <span aria-hidden className="w-2.5 h-2.5 rounded-full bg-[var(--primary)] shrink-0" />
          {t('deal.legend', 'The two filled steps are the only moments you are charged, and the second one only after you have said yes.')}
        </p>
      )}
    </>
  );
}
