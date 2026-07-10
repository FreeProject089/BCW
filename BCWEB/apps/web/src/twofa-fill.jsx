// Inline helper shown next to any BetterCommunity 2FA code input (login, profile
// disable, server-control step-up). If the user saved their BCWEB account in the
// local /2fa authenticator, this offers a one-click fill of the current code — no
// trip to the /2fa page. Fully local: reads the vault + computes the code here.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { readAccounts, totp } from './twofa-lib.js';
import { useI18n } from './i18n.jsx';

export function TotpQuickFill({ onFill, match = 'bettercommunity', className = '' }) {
  const { t } = useI18n();
  const [status, setStatus] = useState('none'); // none | locked | ready
  const [acct, setAcct] = useState(null);
  const [code, setCode] = useState(null);
  useEffect(() => {
    const { locked, accounts } = readAccounts();
    if (locked) { setStatus('locked'); return; }
    const m = (match || '').toLowerCase();
    const found = accounts.find((a) => (a.issuer || '').toLowerCase().includes(m) || (a.label || '').toLowerCase().includes(m));
    if (!found) { setStatus('none'); return; }
    setAcct(found); setStatus('ready');
  }, [match]);
  useEffect(() => {
    if (status !== 'ready' || !acct) return;
    let alive = true;
    const tick = async () => { try { const c = await totp(acct.secret, acct); if (alive) setCode(c); } catch { /* bad secret */ } };
    tick();
    const id = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(id); };
  }, [status, acct]);

  if (status === 'none') return null;
  if (status === 'locked') return (
    <Link to="/2fa" className={`text-[11px] text-[var(--faint)] hover:text-[var(--primary-2)] inline-flex items-center gap-1 ${className}`}><KeyRound size={11} /> {t('tfa.fill.locked', 'Codes are in the Authenticator (locked)')}</Link>
  );
  return (
    <button type="button" onClick={() => code && onFill(code)}
      className={`text-xs inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/10 text-[var(--primary-2)] hover:bg-[var(--primary)]/15 transition font-mono ${className}`}
      title={t('tfa.fill.hint', 'Fill from your local BCWEB Authenticator')}>
      <ShieldCheck size={12} /> {code ? code.replace(/(\d{3})(\d+)/, '$1 $2') : '••••••'}
    </button>
  );
}
