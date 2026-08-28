// What the visitor decided about cookies. Deliberately NOT in analytics.js.
//
// It used to live there, and that is a circular dependency of the worst kind: the state that
// GATES the tracker was inside the tracker. Six modules imported `getConsent` from
// `lib/analytics.js` — including the cookie banner and the error boundary — so when that one
// file failed to load, the app lost the banner, the boundary and its ability to boot.
//
// And it fails to load routinely. A content blocker matches on the URL, and `analytics.js`
// and `gtm.js` are on every filter list there is; Firefox's own tracking protection is
// enough. The report is a **white page** with two "Loading failed for the module" lines, no
// stack, and nothing wrong with the code: the modules serve 200 to anything that asks
// without a blocker in the way, which is why it does not reproduce for whoever is looking.
//
// So the preference about tracking must not live inside the thing being tracked with. This
// file reads one localStorage key and has no other reason to exist.

const KEY = 'bcw_consent'; // 'all' | 'essential' | null

export const getConsent = () => {
  try { return localStorage.getItem(KEY); } catch { return null; }
};

export const setConsent = (v) => {
  try { localStorage.setItem(KEY, v); } catch { /* private mode, or storage disabled */ }
};
