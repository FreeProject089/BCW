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

  const steps = [
    {
      pays: true,
      icon: CreditCard,
      title: t('deal.1', 'You pay for advice'),
      // The urgent price is named rather than hidden behind "from": a reader who needs it
      // urgently is exactly the reader who should not find the real number at checkout.
      amount: cfg.urgentConsultationCents && cfg.urgentConsultationCents !== cfg.consultationCents
        ? `${money(cfg.consultationCents)} · ${money(cfg.urgentConsultationCents)} ${t('deal.urgent', 'urgent')}`
        : money(cfg.consultationCents),
      body: t('deal.1.d', 'This opens a private conversation with a consultant. It buys advice and a quote — it is not the price of the thing.'),
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
    <ol className={compact ? 'grid sm:grid-cols-2 gap-x-5 gap-y-3' : 'relative grid md:grid-cols-4 gap-5'}>
      {/* The rail, behind the markers. It stops at the first and last one rather than running
          the width of the row — a line continuing past the end promises a fifth step. */}
      {!compact && <div aria-hidden className="hidden md:block absolute top-[18px] left-[12.5%] right-[12.5%] h-px bg-[var(--line)]" />}
      {steps.map((s) => (
        <li key={s.title} className={compact ? 'flex items-start gap-2.5' : 'relative'}>
          <span aria-hidden className={`grid place-items-center rounded-full shrink-0 ${compact ? 'w-7 h-7' : 'w-9 h-9'} ${
            s.pays
              ? 'bg-[var(--primary)] text-white'
              : 'bg-[var(--bg-solid)] border-2 border-[var(--line-strong)] text-[var(--muted)]'
          }`}>
            <s.icon size={compact ? 14 : 17} />
          </span>
          <div className={compact ? 'min-w-0' : 'mt-3'}>
            <div className="font-semibold text-[13px] leading-snug">{s.title}</div>
            {/* The amount is the point of the row, so it is not buried in the sentence. A
                step that costs nothing says so rather than staying silent, because silence
                is where people assume a charge. */}
            <div className={`text-[12px] font-semibold tabular-nums ${s.pays ? 'text-[var(--primary-2)]' : 'text-[var(--faint)]'}`}>{s.amount}</div>
            {!compact && <p className="text-[12px] text-[var(--muted)] leading-relaxed mt-1">{s.body}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
