// Inline helper shown next to any BetterCommunity 2FA code input (login, profile
// setup + disable, server-control step-up). If the user saved their BCWEB account(s)
// in the local /2fa authenticator, this lists them with their live code and fills the
// input in one click — no trip to the /2fa page. Fully local: reads the vault +
// computes the code here, and re-reads whenever the vault changes.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { readAccounts, totp, onVaultChange } from './twofa-lib.js';
import { useI18n } from './i18n.jsx';

export function TotpQuickFill({ onFill, match = 'bettercommunity', className = '' }) {
  const { t } = useI18n();
  const [status, setStatus] = useState('none'); // none | locked | ready
  const [accts, setAccts] = useState([]);
  const [codes, setCodes] = useState({}); // id -> current code

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

  // Tick the live codes for the matched accounts every second.
  useEffect(() => {
    if (status !== 'ready' || !accts.length) return;
    let alive = true;
    const tick = async () => { const out = {}; for (const a of accts) { try { out[a.id] = await totp(a.secret, a); } catch { /* bad secret */ } } if (alive) setCodes(out); };
    tick();
    const id = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(id); };
  }, [status, accts]);

  if (status === 'none') return null;
  if (status === 'locked') return (
    <Link to="/2fa" className={`text-[11px] text-[var(--faint)] hover:text-[var(--primary-2)] inline-flex items-center gap-1 ${className}`}><KeyRound size={11} /> {t('tfa.fill.locked', 'Codes are in the Authenticator (locked)')}</Link>
  );
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <span className="text-[10px] uppercase tracking-wider text-[var(--faint)] font-semibold">{t('tfa.fill.from', 'From your Authenticator')}</span>
      <div className="flex flex-wrap gap-1.5">
        {accts.map((a) => {
          const code = codes[a.id];
          return (
            <button key={a.id} type="button" onClick={() => code && onFill(code)}
              className="text-xs inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/10 text-[var(--primary-2)] hover:bg-[var(--primary)]/15 transition"
              title={t('tfa.fill.hint', 'Fill from your local BCWEB Authenticator')}>
              <ShieldCheck size={12} className="shrink-0" />
              {accts.length > 1 && <span className="text-[var(--muted)] max-w-[8rem] truncate">{a.label || a.issuer}</span>}
              <span className="font-mono tabular-nums">{code ? code.replace(/(\d{3})(\d+)/, '$1 $2') : '••••••'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
