// The point ledger as a table people can read. One component for the two places it is shown:
// a member's own history (dashboard → Shop & inventory → History) and the whole ledger
// (admin → Discord bot → Members, balances & history).
//
// Both used to be a run of 12px lines in --faint, the dashboard one inside a bordered box with
// no background at all, so every row sat on the 3D backdrop. What changed:
//   · a surface of its own (`.ph-table`): the card colour, a header row on the inner-panel
//     colour, and alternate rows one step apart, so the eye can follow a row across;
//   · 13px, the date in --muted (4.5:1 and up) rather than --faint, the detail too;
//   · the KIND is a chip, coloured by what it means (earned, spent, gambled, given), because
//     "what happened" is the column people scan, and a word in grey does not scan;
//   · the change is signed and coloured, the balance after it is right-aligned beside it;
//   · on a phone each row folds to two lines (what + change, then when + balance) instead of
//     truncating five columns into 375px.
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';
import { Badge } from './ui.jsx';

const KIND_TONE = {
  levelup: 'primary', grant: 'blue', refund: 'blue', purchase: '', casino: 'amber',
  gift_out: 'green', gift_in: 'green', gift_item_out: 'green', gift_item_in: 'green', giveaway: 'green',
  season: 'red',
};

export function ledgerDetail(r) {
  const m = r.meta || {};
  const note = m.note ? ` “${m.note}”` : '';
  switch (r.kind) {
    case 'purchase': return m.name || '';
    case 'casino': return `${m.game || ''} ×${m.multiplier ?? ''}`;
    case 'gift_out': return `→ ${m.toName || ''}${note}`;
    case 'gift_in': return `← ${m.fromName || ''}${note}`;
    case 'levelup': return m.level != null ? `Lv ${m.level}` : '';
    case 'grant': return m.reason || '';
    default: return m.name || m.reason || '';
  }
}

/**
 * rows: ledger rows { id, createdAt, kind, delta, balance, meta, userId?, displayName? }.
 * kindLabel(kind) → the localized word for a kind (each caller already has its own table).
 * showMember: the admin ledger has a Member column; a member's own history does not.
 */
export function PointsHistoryTable({ rows, kindLabel, currency = '', showMember = false, className = '' }) {
  const { t } = useI18n();
  const cols = showMember
    ? 'sm:grid-cols-[8.5rem_minmax(0,9rem)_minmax(0,1fr)_5.5rem_8rem]'
    : 'sm:grid-cols-[8.5rem_minmax(0,1fr)_5.5rem_8rem]';
  const fmt = (d) => {
    const x = new Date(d);
    try { return x.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }); } catch { return x.toLocaleString(); }
  };
  return (
    <div className={`ph-table ${className}`} role="table" aria-label={t('eco.hist.title', 'Point history')}>
      <div role="row" className={`ph-head hidden sm:grid gap-x-3 px-3 py-2 ${cols}`}>
        <span role="columnheader">{t('db.eco.h.when', 'When')}</span>
        {showMember && <span role="columnheader">{t('db.eco.h.who', 'Member')}</span>}
        <span role="columnheader">{t('db.eco.h.what', 'What')}</span>
        <span role="columnheader" className="text-end">Δ</span>
        <span role="columnheader" className="text-end">{t('db.eco.h.bal', 'Balance')}</span>
      </div>
      {rows.map((r) => {
        const detail = ledgerDetail(r);
        const what = kindLabel(r.kind);
        return (
          <div key={r.id} role="row" className={`ph-row grid grid-cols-[minmax(0,1fr)_auto] ${cols} gap-x-3 gap-y-0.5 px-3 py-2.5 items-center text-[13px]`}>
            <time role="cell" dateTime={r.createdAt} title={new Date(r.createdAt).toLocaleString()} className="order-3 sm:order-none text-xs sm:text-[13px] text-[var(--muted)] tabular-nums whitespace-nowrap">{fmt(r.createdAt)}</time>
            {showMember && (
              <span role="cell" className="order-first col-span-2 sm:col-span-1 sm:order-none min-w-0 truncate font-medium" title={r.displayName || r.userId || undefined}>
                {r.userId ? <Link to={`/u/${r.userId}`} className="hover:text-[var(--accent-ink)] hover:underline">{r.displayName || r.userId}</Link> : (r.displayName || '—')}
              </span>
            )}
            <span role="cell" className="order-1 sm:order-none min-w-0 flex items-center gap-2" title={detail ? `${what} · ${detail}` : what}>
              <Badge tone={KIND_TONE[r.kind] ?? ''} className="shrink-0">{what}</Badge>
              {detail && <span className="min-w-0 truncate text-[var(--muted)]" title={detail}>{detail}</span>}
            </span>
            <span role="cell" className={`order-2 sm:order-none text-end tabular-nums font-semibold whitespace-nowrap ${r.delta > 0 ? 'text-success' : r.delta < 0 ? 'text-error' : 'text-[var(--muted)]'}`}>
              {r.delta > 0 ? '+' : r.delta < 0 ? '−' : ''}{Math.abs(r.delta).toLocaleString()}
            </span>
            <span role="cell" className="order-4 sm:order-none text-end tabular-nums text-xs sm:text-[13px] text-[var(--muted)] whitespace-nowrap">
              {r.balance.toLocaleString()}{currency ? ` ${currency}` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}
