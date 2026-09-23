// Pick an account by searching for it, instead of pasting its id.
//
// Two searches behind one set of controls:
//
//   source="accounts"  `GET /admin/users?q=` (routes/misc.mjs), the member search the
//                      newsletter composer uses. Matches a name, an e-mail, an id, a creator id,
//                      a Discord handle, a pasted BC id. Needs `manage_users`.
//   source="staff"     `GET /admin/tasks/people?q=` (routes/tasks.mjs), for the task board.
//                      A chief does not hold manage_users, and asking them to find an account
//                      id on a screen they cannot open was how "add a member" did nothing. It
//                      answers with names (e-mails only to somebody who may read accounts) and,
//                      unless you may bring outsiders onto the board, with staff only.
//
// Three shapes:
//   <AccountPicker value onChange />      one account, cleared with the × on the chip
//   <AccountSearch onPick />              no selection of its own, hands each hit to onPick
//   <PeoplePicker value onChange />       several accounts, as chips, for a team or a task
//
// Debounced, and two characters minimum: a one-letter query matches most of the database.
import { useEffect, useRef, useState } from 'react';
import { Search, X, Check, Crown } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Input, Spinner } from '../ui/ui.jsx';
import Avatar from '../ui/Avatar.jsx';

const SOURCES = {
  accounts: (term) => api.get(`/admin/users?q=${encodeURIComponent(term)}&take=8`).then((r) => r.users || r.accounts || []),
  staff: (term) => api.get(`/admin/tasks/people?q=${encodeURIComponent(term)}`).then((r) => r.people || []),
};

/** The raw search box + result list. `exclude` hides accounts already on the list. */
export function AccountSearch({ onPick, exclude = [], placeholder, autoFocus = false, className = '', source = 'accounts' }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); setFailed(false); return undefined; }
    let alive = true;
    setBusy(true);
    const id = setTimeout(() => {
      (SOURCES[source] || SOURCES.accounts)(term)
        .then((rows) => { if (alive) { setHits(rows); setFailed(false); } })
        // A 403 here is the only failure worth a word: an account that can run this screen but
        // cannot search would otherwise see an empty list and conclude the person does not exist.
        .catch(() => { if (alive) { setHits([]); setFailed(true); } })
        .finally(() => { if (alive) setBusy(false); });
    }, 300);
    return () => { alive = false; clearTimeout(id); };
  }, [q, source]);

  const take = (u) => { onPick(u); setQ(''); setHits([]); };
  const visible = hits.filter((u) => !exclude.includes(u.id));

  return (
    <div className={`min-w-0 ${className}`} ref={boxRef}>
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)] pointer-events-none" />
        <Input className="!ps-9" value={q} autoFocus={autoFocus} onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder || t('pick.acct.ph', 'Search a name, an e-mail or an id…')}
          aria-label={placeholder || t('pick.acct.ph', 'Search a name, an e-mail or an id…')} />
        {busy && <span className="absolute right-3 top-1/2 -translate-y-1/2"><Spinner /></span>}
      </div>
      {failed && <p className="mt-1.5 text-[11px] text-warning">{t('pick.acct.denied', 'The account list did not answer. You may not be allowed to search accounts.')}</p>}
      {q.trim().length >= 2 && !busy && !failed && !visible.length && (
        <p className="mt-1.5 text-[11px] text-[var(--faint)]">
          {source === 'staff'
            ? t('pick.staff.none', 'Nobody on the staff matches that. Search by name or paste an account id.')
            : t('pick.acct.none', 'No account matches that. A name, an e-mail, an account id or a BC id all work.')}
        </p>
      )}
      {visible.length > 0 && (
        // Opaque, not a surface: this list floats over the form under it, and the
        // translucent-surfaces setting would let that form read through the names.
        <div className="mt-1.5 rounded-lg border border-[var(--line)] divide-y divide-[var(--line)] max-h-56 overflow-y-auto" style={{ background: 'var(--bg-solid)' }}>
          {visible.map((u) => (
            <button key={u.id} type="button" onClick={() => take(u)}
              className="w-full text-start px-3 py-2 hover:bg-[var(--surface-2)] transition flex items-center gap-2">
              <Avatar user={u} size={22} />
              <span className="min-w-0">
                <span className="block text-sm truncate" title={u.displayName || u.email || u.id}>{u.displayName || u.email || u.id}</span>
                <span className="block text-[11px] text-[var(--faint)] truncate" title={u.email || u.id}>{u.email || u.id}</span>
              </span>
              {u.staff === false && <span className="ms-auto shrink-0 badge badge-amber">{t('pick.staff.outsider', 'Not staff yet')}</span>}
              <Check size={13} className={`${u.staff === false ? '' : 'ms-auto '}shrink-0 text-[var(--faint)]`} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One account, chosen. `value` is `{ id, displayName, email }` or null; `onChange` gets the
 * same shape. While something is chosen the search box is replaced by the chip.
 */
export function AccountPicker({ value, onChange, placeholder, invalid = false, autoFocus = false, source = 'accounts' }) {
  const { t } = useI18n();
  if (value) {
    return (
      <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${invalid ? 'b-error' : 'border-[var(--line)]'}`} style={{ background: 'var(--surface)' }}>
        <Avatar user={value} size={24} />
        <span className="min-w-0">
          <span className="block text-sm truncate" title={value.displayName || value.id}>{value.displayName || value.id}</span>
          <span className="block text-[11px] text-[var(--faint)] truncate font-mono" title={value.id}>{value.id}</span>
        </span>
        <button type="button" onClick={() => onChange(null)} className="ms-auto shrink-0 p-1 -me-1 text-[var(--faint)] hover:text-error"
          title={t('pick.acct.clear', 'Choose somebody else')} aria-label={t('pick.acct.clear', 'Choose somebody else')}>
          <X size={14} />
        </button>
      </div>
    );
  }
  return <AccountSearch onPick={onChange} placeholder={placeholder} autoFocus={autoFocus} source={source} />;
}

/**
 * Several accounts, as chips, with a search under them. `value` is `[{ id, displayName }]`.
 * `fixed` ids are shown with a crown and cannot be removed here (the chief of a team being
 * built is chosen in its own field and is always a member).
 */
export function PeoplePicker({ value = [], onChange, fixed = [], placeholder, source = 'staff', max = 50 }) {
  const { t } = useI18n();
  const ids = value.map((u) => u.id);
  const full = value.length >= max;
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('pick.people.list', 'Chosen people')}>
          {value.map((u) => (
            <li key={u.id} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] ps-1 pe-1.5 py-0.5 text-xs" style={{ background: 'var(--surface)' }}>
              <Avatar user={u} size={18} />
              {fixed.includes(u.id) && <Crown size={11} className="text-warning" aria-hidden="true" />}
              <span className="max-w-[10rem] truncate" title={u.displayName || u.id}>{u.displayName || u.id}</span>
              {!fixed.includes(u.id) && (
                <button type="button" onClick={() => onChange(value.filter((x) => x.id !== u.id))}
                  className="p-0.5 text-[var(--faint)] hover:text-error"
                  title={t('pick.people.rm', 'Take off the list')} aria-label={t('pick.people.rm', 'Take off the list')}>
                  <X size={11} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {full
        ? <p className="text-[11px] text-[var(--faint)]">{t('pick.people.full', 'That is the most this list can hold.')}</p>
        : <AccountSearch source={source} exclude={ids} placeholder={placeholder} onPick={(u) => onChange([...value, u])} />}
    </div>
  );
}

export default AccountPicker;
