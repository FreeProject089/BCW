import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Download, X, Share, SquarePlus, CheckCircle2, MonitorSmartphone, Info } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { Button, Card } from './ui.jsx';
import { getConsent, CONSENT_EVENT } from '../lib/consent.js';
import { updateWaiting } from '../lib/pwa.js';
import { installState, onInstallChange, promptInstall, recordView, mayOffer, markOffered, isDismissed, dismissInstall, OFFER_DELAY_MS } from '../lib/pwa-install.js';
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
 * landing2 (agent-landing): offered on ARRIVAL (it used to wait for a second visit and four
 * page views, so almost nobody saw it). Shown only when ALL of these hold:
 *   · the browser can actually install (a kept beforeinstallprompt, or iOS where the steps are
 *     the answer; iOS gets it ONCE, see below);
 *   · the cookie question is answered (never two prompts stacked on a first visit; the card
 *     follows the answer at once, via the consent event);
 *   · no "new version" card is waiting (same corner, and that one matters more);
 *   · they have not said "Not now" before, and it has not already been offered on
 *     OFFER_MAX_VISITS visits (lib/pwa-install.js: once per visit, a few visits at most);
 *   · not inside the full-screen studio, where a floating card sits on the canvas.
 * It then waits a few seconds after the page settles instead of arriving with it.
 */
export default function PwaInstallPrompt() {
  const { t } = useI18n();
  const loc = useLocation();
  const st = useInstallState();
  const [ready, setReady] = useState(false);
  const [hidden, setHidden] = useState(isDismissed);
  const [visit, setVisit] = useState(0);
  const [consent, setConsentSeen] = useState(getConsent);

  // One page view per route; the visit number decides "once per visit".
  useEffect(() => { setVisit(recordView().visits); }, [loc.pathname]);
  useEffect(() => {
    const on = () => setConsentSeen(getConsent());
    window.addEventListener(CONSENT_EVENT, on);
    return () => window.removeEventListener(CONSENT_EVENT, on);
  }, []);
  useEffect(() => {
    if (ready || !visit || !mayOffer(visit)) return undefined;
    const id = setTimeout(() => setReady(true), OFFER_DELAY_MS);
    return () => clearTimeout(id);
  }, [visit, ready]);

  const can = st === 'prompt' || st === 'ios';
  const shown = ready && !hidden && can && !!consent && !updateWaiting() && !/^\/studio\//.test(loc.pathname);
  // Counted when it is actually on screen, not when it could have been. The iOS hint is
  // one-time: remembered as answered the moment it appears (it stays up for this visit).
  useEffect(() => {
    if (!shown) return;
    markOffered(visit);
    if (st === 'ios') dismissInstall();
  }, [shown, visit, st]);
  if (!shown) return null;

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
    <Card className="p-4 sm:p-5 scroll-mt-24" id="install-app">
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
