// Starting the optional measurement modules — in ONE place, because there were two.
//
// The bug this exists to remove: App.jsx started five things on mount —
//
//     useEffect(() => {
//       loadGtmIfConsented();
//       telemetry().then((m) => { m?.initVitals(); m?.initInteractions(); m?.initErrors(); });
//       import('./lib/replay.js').then((m) => m.initReplay());
//     }, []);          // ← runs once, at mount
//
// and every one of them returns immediately unless consent is already 'all'. On a first
// visit it is not: the banner has not been answered yet. When the visitor then clicked
// "Accept all", the cookie banner called `loadGtmIfConsented()` and nothing else.
//
// So GTM started and the other four did not. For the whole of that visit — the visit in
// which the visitor actually said yes — there were no interaction events, no Web Vitals, no
// client error reports and no session replay. They began on the NEXT full page load, and an
// SPA does not do many of those. Returning visitors were fine, which is why the dashboard
// looked merely thin rather than broken, and why "Events don't work" was hard to pin down.
//
// The asymmetry was the tell: somebody wired GTM into the accept handler and did not wire
// the rest. One function called from both places is the only way that cannot drift again.
//
// Every init below is already idempotent (each guards on its own `window.__bcw*` flag or an
// internal `loaded` boolean), so calling this twice — at mount AND on accept — is safe and is
// exactly what happens for a returning visitor.
import { getConsent } from './consent.js';

/**
 * Start whatever the visitor has consented to. Safe to call repeatedly.
 *
 * Every import here is dynamic and every one is caught. These filenames are on every ad-block
 * filter list there is, so they routinely fail to load for reasons that have nothing to do
 * with the code — and losing measurement must cost measurement, never the page. That is also
 * why `getConsent` comes from consent.js, which is deliberately import-free and not blocked.
 */
export function startMeasurement() {
  if (getConsent() !== 'all') return;
  import('./gtm.js').then((m) => m.loadGtmIfConsented?.()).catch(() => {});
  import('./analytics.js').then((m) => { m?.initVitals?.(); m?.initInteractions?.(); m?.initErrors?.(); }).catch(() => {});
  // Replay is last and separate: it is the only one that can pull in rrweb, and a visitor who
  // declined must never download it. initReplay re-checks consent itself.
  import('./replay.js').then((m) => m.initReplay?.()).catch(() => {});
}
