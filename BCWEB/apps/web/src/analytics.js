// Consent-gated, first-party analytics. Nothing is sent unless the user accepted
// analytics cookies. No third-party scripts, no tracking cookies.
const KEY = 'bcw_consent'; // 'all' | 'essential' | null

export const getConsent = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const setConsent = (v) => { try { localStorage.setItem(KEY, v); } catch {} };

export function trackPageview(path) {
  if (getConsent() !== 'all') return;
  navigator.sendBeacon?.('/api/analytics/pageview', new Blob([JSON.stringify({ path, ref: document.referrer || undefined })], { type: 'application/json' }))
    || fetch('/api/analytics/pageview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) }).catch(() => {});
}
