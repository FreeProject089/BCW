import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Download, X, Share, SquarePlus, CheckCircle2, MonitorSmartphone, Info } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { Button, Card } from './ui.jsx';
import { getConsent } from '../lib/consent.js';
import { updateWaiting } from '../lib/pwa.js';
import { installState, onInstallChange, promptInstall, recordView, engaged, isDismissed, dismissInstall } from '../lib/pwa-install.js';
import './pwa-install.css';

/** installState(), kept live. */
function useInstallState() {
  const [st, setSt] = useState(installState);
  useEffect(() => onInstallChange(() => setSt(installState())), []);
  return st;
}

// The iOS route, spelled out: there is no button a page can press for the reader.
function IosSteps() {
  const { t } = useI18n();
  return (
    <ol className="pwa-steps">
      <li><Share size={14} aria-hidden /> <span>{t('pwa.ios.s1', 'Tap Share in the browser toolbar.')}</span></li>
      <li><SquarePlus size={14} aria-hidden /> <span>{t('pwa.ios.s2', 'Choose Add to Home Screen, then Add.')}</span></li>
    </ol>
  );
}

/**
 * The corner invitation. Mounted once in App.
 *
 * Shown only when ALL of these hold, which is what "not pushy" means in code:
 *   · the browser can actually install (a kept prompt, or iOS where the steps are the answer);
 *   · the reader came back for a second visit and has looked at a few pages;
 *   · the cookie question is answered (never two prompts stacked on a first visit);
 *   · no "new version" card is waiting (same corner, and that one matters more);
 *   · they have not said "Not now" before, which is remembered for good;
 *   · not inside the full-screen studio, where a floating card sits on the canvas.
 * It then waits a few seconds after the page settles instead of arriving with it.
 */
export default function PwaInstallPrompt() {
  const { t } = useI18n();
  const loc = useLocation();
  const st = useInstallState();
  const [ready, setReady] = useState(false);
  const [hidden, setHidden] = useState(isDismissed);

  useEffect(() => {
    const e = recordView();
    if (!engaged(e)) return undefined;
    const id = setTimeout(() => setReady(true), 6000);
    return () => clearTimeout(id);
  }, [loc.pathname]);

  const can = st === 'prompt' || st === 'ios';
  if (!ready || hidden || !can) return null;
  if (!getConsent() || updateWaiting()) return null;
  if (/^\/studio\//.test(loc.pathname)) return null;

  const close = () => { dismissInstall(); setHidden(true); };
  const install = async () => {
    const r = await promptInstall();
    // Either way the question has been answered by the browser's own dialog; do not ask twice.
    if (r !== 'unavailable') close();
  };

  return (
    <div className="pwa-install" role="dialog" aria-labelledby="pwa-install-t">
      <span className="pwa-install-ico" aria-hidden><MonitorSmartphone size={16} /></span>
      <div className="min-w-0 flex-1">
        <div id="pwa-install-t" className="text-sm font-semibold">{t('pwa.inv.t', 'Install BetterCommunity')}</div>
        <p className="text-[12px] text-[var(--muted)] mt-0.5 leading-snug">
          {st === 'ios'
            ? t('pwa.inv.ios', 'Add it to your Home Screen to open it like an app, full screen.')
            : t('pwa.inv.s', 'Open it from your desktop or home screen, in its own window.')}
        </p>
        {st === 'ios' ? <IosSteps /> : (
          <div className="flex flex-wrap gap-2 mt-2.5">
            <Button size="sm" variant="primary" onClick={install}><Download size={13} /> {t('pwa.inv.go', 'Install')}</Button>
            <Button size="sm" variant="ghost" onClick={close}>{t('pwa.inv.later', 'Not now')}</Button>
          </div>
        )}
      </div>
      <button type="button" onClick={close} className="pwa-install-x"
        aria-label={t('pwa.inv.close', 'Close, do not ask again')} title={t('pwa.inv.close', 'Close, do not ask again')}>
        <X size={14} />
      </button>
    </div>
  );
}

/**
 * Settings → "Install the app": the permanent place to install later, whatever the corner
 * card did. It never nags; it says what this browser can do.
 */
export function InstallAppCard() {
  const { t } = useI18n();
  const st = useInstallState();
  const [busy, setBusy] = useState(false);
  const install = async () => { setBusy(true); try { await promptInstall(); } finally { setBusy(false); } };
  return (
    <Card className="p-4 sm:p-5" id="install-app">
      <div className="flex items-center gap-2.5 mb-2 pb-2.5 border-b border-[var(--line)]">
        <span className="grid place-items-center w-7 h-7 rounded-lg tint-primary border b-primary shrink-0"><MonitorSmartphone size={14} className="text-[var(--accent-ink)]" /></span>
        <span className="text-sm font-semibold">{t('pwa.set.t', 'Install the app')}</span>
      </div>
      <div className="py-2 text-sm">
        {st === 'installed' && (
          <p className="flex items-start gap-2"><CheckCircle2 size={16} className="text-[var(--success)] shrink-0 mt-0.5" /> <span>{t('pwa.set.done', 'You are using the installed app on this device.')}</span></p>
        )}
        {st === 'prompt' && (
          <>
            <p className="text-[var(--muted)] text-xs mb-3">{t('pwa.set.s', 'Opens in its own window, from your desktop, dock or home screen. Same account, same site, nothing extra to download.')}</p>
            <Button variant="primary" size="sm" loading={busy} onClick={install}><Download size={13} /> {t('pwa.inv.go', 'Install')}</Button>
          </>
        )}
        {st === 'ios' && (
          <>
            <p className="text-[var(--muted)] text-xs">{t('pwa.inv.ios', 'Add it to your Home Screen to open it like an app, full screen.')}</p>
            <IosSteps />
          </>
        )}
        {st === 'none' && (
          <p className="flex items-start gap-2 text-xs text-[var(--muted)]"><Info size={14} className="shrink-0 mt-0.5" /> <span>{t('pwa.set.none', 'This browser does not offer to install sites here. In Chrome or Edge, use the install icon at the end of the address bar; on an iPhone or iPad, use Safari.')}</span></p>
        )}
      </div>
    </Card>
  );
}
