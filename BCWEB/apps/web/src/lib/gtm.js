// Google Tag Manager — optional, consent-gated, configured at RUNTIME.
//
// The container id used to be VITE_GTM_ID, baked in at BUILD time. Turning analytics on
// therefore meant editing an env file and rebuilding the site, which is not something anyone
// does to try a tag — so in practice it was never on. It comes from the admin's SEO settings
// now (AdminSetting['seo.config'], served at /api/seo).
//
// The consent gate does NOT move, and that is the point worth stating: the script is still
// injected only after the visitor accepts the Analytics cookie category, which is the promise
// /legal/cookies makes. Making the id editable must never quietly make it load earlier.
//
// The env var still wins when it is set, so an existing deployment keeps behaving exactly as
// it did until somebody chooses otherwise in the dashboard.
import { getConsent } from './consent.js';
import { getSeoConfig } from './seo.js';

const ENV_GTM_ID = import.meta.env.VITE_GTM_ID;
let loaded = false;

export async function loadGtmIfConsented() {
  if (loaded || getConsent() !== 'all') return;
  // Consent first, THEN the id. Asking the server for the config before checking consent
  // would be a request made on behalf of a visitor who has not agreed to analytics — harmless
  // in content, and exactly the kind of thing the promise is about.
  const id = ENV_GTM_ID || (await getSeoConfig())?.gtmId;
  if (!id) return;
  // Checked again: this is async now, so consent can have been withdrawn while the config
  // was in flight, and `loaded` can have been set by a second call.
  if (loaded || getConsent() !== 'all') return;
  loaded = true;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
  const s = document.createElement('script');
  s.async = true;
  // A GA4 measurement id (G-…) is not a GTM container and is loaded from a different script.
  // Feeding one to gtm.js fails silently — no tag, no error — which is the worst possible
  // outcome for something whose whole job is to report.
  s.src = /^G-/i.test(id)
    ? `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`
    : `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(s);
  if (/^G-/i.test(id)) {
    // gtag.js needs its own bootstrap; gtm.js does not.
    const g = document.createElement('script');
    g.textContent = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${id.replace(/'/g, '')}')`;
    document.head.appendChild(g);
  }
}
