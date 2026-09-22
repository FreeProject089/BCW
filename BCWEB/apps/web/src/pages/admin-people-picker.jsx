// Pick an account by searching for it, instead of pasting its id.
//
// The site already HAS a member search: `GET /admin/users?q=` (routes/misc.mjs), the one the
// newsletter composer's recipient picker uses. It matches a display name, an e-mail, the
// account id itself, a creator id, a Discord id or username, and a pasted "BC-XXXX-XXXX".
// So this is that search with a house dropdown around it, not a second search: a screen that
// asked for an id was asking the admin to go and find it on another screen first, and the
// only way to get one was to open the accounts list, copy, come back and paste.
//
// Two shapes, one search:
//   <AccountPicker value onChange />      one account, cleared with the × on the chip
//   <AccountSearch onPick />              no selection of its own, hands each hit to onPick
//
// Debounced, and two characters minimum: a one-letter query matches most of the database and
// returns a list nobody can pick from. An id pasted in full still matches on the first pass,
// because the server tries `id` exactly before it tries a substring.
import { useEffect, useRef, useState } from 'react';
import { Search, X, Check } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Input, Spinner } from '../ui/ui.jsx';
import Avatar from '../ui/Avatar.jsx';

/** The raw search box + result list. `exclude` hides accounts already on the list. */
export function AccountSearch({ onPick, exclude = [], placeholder, autoFocus = false, className = '' }) {
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
      api.get(`/admin/users?q=${encodeURIComponent(term)}&take=8`)
        .then((r) => { if (alive) { setHits(r.users || r.accounts || []); setFailed(false); } })
        // A 403 here is the only failure worth a word: an account that can run this screen but
        // cannot read the member list would otherwise see an empty result list and conclude
        // the person does not exist.
        .catch(() => { if (alive) { setHits([]); setFailed(true); } })
        .finally(() => { if (alive) setBusy(false); });
    }, 300);
    return () => { alive = false; clearTimeout(id); };
  }, [q]);

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
        <p className="mt-1.5 text-[11px] text-[var(--faint)]">{t('pick.acct.none', 'No account matches that. A name, an e-mail, an account id or a BC id all work.')}</p>
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
                <span className="block text-sm truncate" title={u.displayName || u.email}>{u.displayName || u.email || u.id}</span>
                <span className="block text-[11px] text-[var(--faint)] truncate" title={u.email || u.id}>{u.email || u.id}</span>
              </span>
              <Check size={13} className="ms-auto shrink-0 text-[var(--faint)]" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One account, chosen. `value` is `{ id, displayName, email }` or null; `onChange` gets the
 * same shape. While something is chosen the search box is replaced by the chip, so the state
 * of the field is one thing on screen rather than a box and a list that disagree.
 */
export function AccountPicker({ value, onChange, placeholder, invalid = false, autoFocus = false }) {
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
  return <AccountSearch onPick={onChange} placeholder={placeholder} autoFocus={autoFocus} />;
}

export default AccountPicker;
