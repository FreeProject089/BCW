// Inline helper shown next to any BetterCommunity 2FA code input (login, profile
// setup + disable, server-control step-up). If the user saved their BCWEB account(s)
// in the local /2fa authenticator, this lists them (title + live code) and fills the
// input in one click — no trip to the /2fa page. Collapsible so it never blows out
// the surrounding card. Fully local: reads the vault + computes the code here, and
// re-reads whenever the vault changes.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, ShieldCheck, ChevronDown } from 'lucide-react';
import { readAccounts, totp, onVaultChange } from './twofa-lib.js';
import { useI18n } from './i18n.jsx';

export function TotpQuickFill({ onFill, match = 'bettercommunity', className = '' }) {
  const { t } = useI18n();
  const [status, setStatus] = useState('none'); // none | locked | ready
  const [accts, setAccts] = useState([]);
  const [codes, setCodes] = useState({}); // id -> current code
  const [open, setOpen] = useState(false);

  // (Re)read the vault on mount + whenever it changes (e.g. Profile just added one).
  useEffect(() => {
    const read = () => {
      const { locked, accounts } = readAccounts();
      if (locked) { setStatus('locked'); setAccts([]); return; }
      const m = (match || '').toLowerCase();
      const found = accounts.filter((a) => (a.issuer || '').toLowerCase().includes(m) || (a.label || '').toLowerCase().includes(m));
      setAccts(found); setStatus(found.length ? 'ready' : 'none');
    };
    read();
    return onVaultChange(read);
  }, [match]);

  // Tick the live codes for the matched accounts every second (only while expanded).
  useEffect(() => {
    if (status !== 'ready' || !accts.length || !open) return;
    let alive = true;
    const tick = async () => { const out = {}; for (const a of accts) { try { out[a.id] = await totp(a.secret, a); } catch { /* bad secret */ } } if (alive) setCodes(out); };
    tick();
    const id = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(id); };
  }, [status, accts, open]);

  if (status === 'none') return null;
  if (status === 'locked') return (
    <Link to="/2fa" className={`text-[11px] text-[var(--faint)] hover:text-[var(--primary-2)] inline-flex items-center gap-1 ${className}`}><KeyRound size={11} /> {t('tfa.fill.locked', 'Codes are in the Authenticator (locked)')}</Link>
  );
  const title = (a) => a.issuer || a.label || 'Account';
  return (
    <div className={`min-w-0 ${className}`}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] hover:text-[var(--text)] transition">
        <ShieldCheck size={12} className="text-[var(--primary-2)]" /> {t('tfa.fill.from', 'From your Authenticator')} <span className="text-[var(--muted)]">({accts.length})</span>
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-1.5 flex flex-col gap-1">
          {accts.map((a) => {
            const code = codes[a.id];
            return (
              <button key={a.id} type="button" onClick={() => code && onFill(code)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/10 hover:bg-[var(--primary)]/15 transition text-left"
                title={t('tfa.fill.hint', 'Fill from your local BCWEB Authenticator')}>
                <ShieldCheck size={13} className="text-[var(--primary-2)] shrink-0" />
                <span className="flex-1 min-w-0 truncate text-xs text-[var(--muted)]">{title(a)}</span>
                <span className="font-mono tabular-nums text-sm text-[var(--primary-2)] shrink-0">{code ? code.replace(/(\d{3})(\d+)/, '$1 $2') : '••••••'}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
