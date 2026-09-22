// Read receipts: one tick sent, two ticks delivered, two coloured ticks read.
//
// The API attaches `receipt` only to the viewer's OWN messages (lib/receipts.mjs), so every
// conversation screen can render this beside any message that carries one and never has to
// work out whose message it is. The label is the words, for a screen reader and a hover:
// ticks alone are a code people have to have learnt elsewhere.
import { Check, CheckCheck } from 'lucide-react';
import { useI18n } from '../i18n.jsx';

// `onFill`: the ticks sit on a filled (primary) bubble, where a coloured tick would be a
// colour on a colour. Read is then told apart by weight alone: full opacity against 60%.
export function ReceiptTicks({ state, onFill = false, className = '' }) {
  const { t } = useI18n();
  if (!state) return null;
  const label = state === 'read' ? t('rcpt.read', 'Read')
    : state === 'delivered' ? t('rcpt.delivered', 'Delivered')
      : t('rcpt.sent', 'Sent');
  const Icon = state === 'sent' ? Check : CheckCheck;
  return (
    <span role="img" aria-label={label} title={label}
      className={`inline-flex align-middle ${state === 'read' ? (onFill ? 'opacity-100' : 'text-[var(--info)] opacity-100') : 'opacity-60'} ${className}`}>
      <Icon size={12} strokeWidth={2.5} aria-hidden />
    </span>
  );
}
