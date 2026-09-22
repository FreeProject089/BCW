import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { SW_UPDATE_EVENT, applyUpdate, updateWaiting } from '../lib/pwa.js';

/**
 * "A new version is ready" — the explicit prompt the service worker never takes without.
 *
 * Not a toast: a toast dismisses itself after four seconds, and this is the one message on
 * the site that has to still be there when somebody looks up. It sits bottom-LEFT because the
 * toast host is bottom-right and the two must not stack on a phone.
 *
 * Dismissing it does not decline the update, it only hides the card: the worker is still
 * waiting and the prompt comes back on the next page load. That is the difference between
 * "later" and "never", and only one of them is honest.
 */
export default function PwaUpdatePrompt() {
  const { t } = useI18n();
  const [show, setShow] = useState(() => updateWaiting());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const on = () => setShow(true);
    window.addEventListener(SW_UPDATE_EVENT, on);
    return () => window.removeEventListener(SW_UPDATE_EVENT, on);
  }, []);
  if (!show) return null;
  return (
    <div className="fixed bottom-5 left-5 z-[60] w-[19rem] max-w-[calc(100vw-2.5rem)] rounded-xl border border-[var(--line)] p-3.5 flex items-start gap-3"
      role="status"
      style={{ background: 'var(--bg-solid)', boxShadow: '0 14px 40px -14px rgba(0,0,0,0.62)' }}>
      <span className="grid place-items-center w-7 h-7 rounded-lg shrink-0 text-[var(--accent-ink)]"
        style={{ background: 'color-mix(in srgb, var(--primary) 16%, transparent)' }}>
        <RefreshCw size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{t('pwa.update.t', 'A new version is ready')}</div>
        <p className="text-[12px] text-[var(--muted)] mt-0.5 leading-snug">
          {t('pwa.update.s', 'Reload to get it. Anything you are in the middle of typing will be lost, so finish first if you are.')}
        </p>
        <button type="button" className="btn btn-sm btn-primary mt-2.5" disabled={busy}
          onClick={() => { setBusy(true); applyUpdate(); }}>
          <RefreshCw size={13} /> {t('pwa.update.go', 'Reload')}
        </button>
      </div>
      <button type="button" onClick={() => setShow(false)}
        aria-label={t('pwa.update.later', 'Later')} title={t('pwa.update.later', 'Later')}
        className="shrink-0 -me-0.5 p-1 rounded-lg text-[var(--faint)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition">
        <X size={14} />
      </button>
    </div>
  );
}
