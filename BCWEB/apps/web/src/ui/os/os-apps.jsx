// The OS mode's own apps (agent-bcw-os): windows that are not a dashboard tab. One so far, the
// BMM telemetry dashboard.
//
// WHO SEES IT
// Exactly who may open it from Admin > Analytics: an ADMIN with the "telemetry" grant, or a
// SUPERADMIN, with 2FA (GET /telemetry/access asks the very rule POST /admin/telemetry/token
// enforces). Anybody else never gets the icon; the probe failing hides it too.
//
// HOW IT LOADS
// The dashboard lives on its own origin behind Caddy's forward_auth gate (routes/telemetry.mjs).
// The window asks for the same short-lived SSO URL the Analytics button opens, and puts it in an
// iframe: the gate reads the `?bc=` token, sets its host cookie and redirects. The telemetry
// origin allows being framed by the site only (Caddyfile, frame-ancestors). Where the browser
// still refuses (third-party cookies blocked across two unrelated hosts, a local
// telemetry.localhost), "Open in a new tab" is always one click away in the window's bar.

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { ExternalLink, RefreshCw, CircleAlert } from 'lucide-react';
import { useI18n } from '../../i18n.jsx';
import { Spinner } from '../ui.jsx';
import { api } from '../../lib/api.js';

export const TELEMETRY_APP = 'app.telemetry';

// One probe per account and load, shared by every shell that asks.
let probe = { uid: null, p: null, ok: false };
const listeners = new Set();
function ask(uid) {
  if (probe.uid === uid && probe.p) return;
  probe = { uid, p: null, ok: false };
  probe.p = api.get('/telemetry/access')
    .then((d) => { if (probe.uid === uid) probe.ok = d?.access === true; })
    .catch(() => { if (probe.uid === uid) probe.ok = false; })
    .then(() => listeners.forEach((f) => f()));
}
/** Can this account open the telemetry dashboard? false until the server says yes. */
export function useTelemetryAccess(uid, enabled) {
  useEffect(() => { if (enabled && uid && uid !== 'anon') ask(uid); }, [uid, enabled]);
  const ok = useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f); }, () => probe.uid === uid && probe.ok, () => false);
  return !!enabled && ok;
}

async function mintUrl() {
  const { url } = await api.post('/admin/telemetry/token', {});
  return url;
}

export function TelemetryApp() {
  const { t } = useI18n();
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [n, setN] = useState(0);
  const load = useCallback(() => {
    setErr(null); setLoaded(false); setUrl(null);
    mintUrl().then(setUrl).catch((x) => setErr(x?.data?.error === 'no_telemetry_access'
      ? t('an.telemetry.noperm', 'You need the "telemetry" permission (Access & permissions) to open it.')
      : t('an.telemetry.err', 'Could not open telemetry, an admin account with 2FA is required.')));
  }, [t]);
  useEffect(() => { load(); }, [load, n]);
  // A new tab gets its own token: the one in the frame may be spent.
  const newTab = async () => {
    try { window.open(await mintUrl(), '_blank', 'noopener'); } catch { /* the error line above says why */ }
  };
  return (
    <div className="os-app">
      <div className="os-app-bar">
        <span className="os-app-t">{t('os.app.tele', 'BMM telemetry')}</span>
        <button type="button" className="os-app-btn" onClick={() => setN((x) => x + 1)} title={t('os.app.reload', 'Reload')} aria-label={t('os.app.reload', 'Reload')}><RefreshCw size={14} aria-hidden /></button>
        <button type="button" className="os-app-btn" onClick={newTab} title={t('os.app.newtab', 'Open in a new tab')}><ExternalLink size={14} aria-hidden /> <span>{t('os.app.newtab', 'Open in a new tab')}</span></button>
      </div>
      <div className="os-app-body">
        {err ? (
          <div className="os-win-crash m-4" role="alert"><CircleAlert size={18} aria-hidden className="text-[var(--error)] shrink-0" /><div className="text-sm">{err}</div></div>
        ) : url ? (
          <>
            {!loaded && <div className="os-app-wait"><Spinner /></div>}
            <iframe key={url} src={url} title={t('os.app.tele', 'BMM telemetry')} className="os-app-frame"
              referrerPolicy="no-referrer" allow="clipboard-write" onLoad={() => setLoaded(true)}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads" />
          </>
        ) : <div className="os-app-wait"><Spinner /></div>}
      </div>
    </div>
  );
}
