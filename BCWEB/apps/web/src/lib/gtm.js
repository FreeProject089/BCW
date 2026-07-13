// Google Tag Manager — optional, consent-gated. The container id is baked in at
// BUILD time (VITE_GTM_ID, see .env.example) and even when set, the script is only
// injected client-side after the visitor accepts the "Analytics" cookie category
// (matches the promise made on /cookies: "loads ONLY after you opt in").
import { getConsent } from './analytics.js';

const GTM_ID = import.meta.env.VITE_GTM_ID;
let loaded = false;

export function loadGtmIfConsented() {
  if (loaded || !GTM_ID || getConsent() !== 'all') return;
  loaded = true;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(GTM_ID)}`;
  document.head.appendChild(s);
}
