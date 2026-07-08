// Consent-gated, first-party analytics. Nothing is sent unless the user accepted
// analytics cookies. No third-party scripts, no tracking cookies.
const KEY = 'bcw_consent'; // 'all' | 'essential' | null

export const getConsent = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const setConsent = (v) => { try { localStorage.setItem(KEY, v); } catch {} };

function beacon(url, payload) {
  const body = JSON.stringify(payload);
  navigator.sendBeacon?.(url, new Blob([body], { type: 'application/json' }))
    || fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
}

export function trackPageview(path) {
  if (getConsent() !== 'all') return;
  beacon('/api/analytics/pageview', { path, ref: document.referrer || undefined });
}

// ── Real-user Web Vitals (native, no web-vitals dep, no CDN) ───────────────────
// Collects Core Web Vitals (LCP, CLS, INP) + FCP + TTFB with PerformanceObserver and
// flushes them once when the page is backgrounded/unloaded. web.dev "good/poor"
// thresholds decide the rating. Attributes every metric to the path at page load
// (these are page-load metrics by definition). Best-effort — silently no-ops on
// browsers without the relevant entry types (e.g. Safari lacks layout-shift/INP).
const THRESHOLDS = { LCP: [2500, 4000], CLS: [0.1, 0.25], INP: [200, 500], FCP: [1800, 3000], TTFB: [800, 1800] };
const rate = (m, v) => { const [g, p] = THRESHOLDS[m]; return v <= g ? 'good' : v <= p ? 'needs-improvement' : 'poor'; };

export function initVitals() {
  if (getConsent() !== 'all') return;
  if (typeof PerformanceObserver === 'undefined' || window.__bcwVitals) return;
  window.__bcwVitals = true;
  const path = location.pathname + location.search;
  const vitals = {};        // metric → value (latest/aggregate)
  const set = (m, v) => { vitals[m] = v; };

  // TTFB from the navigation entry (responseStart relative to activation start).
  try {
    const nav = performance.getEntriesByType('navigation')[0];
    if (nav && nav.responseStart > 0) set('TTFB', Math.max(0, nav.responseStart));
  } catch {}

  // Skip entry types the browser doesn't support (e.g. Firefox has no layout-shift/INP)
  // so it doesn't log "entryTypes … ignored" warnings on every page load.
  const supported = (PerformanceObserver.supportedEntryTypes || []);
  const obs = (type, cb, opts) => { if (!supported.includes(type)) return null; try { const o = new PerformanceObserver(cb); o.observe({ type, buffered: true, ...opts }); return o; } catch { return null; } };

  // FCP: first-contentful-paint from the paint timeline.
  obs('paint', (l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') set('FCP', e.startTime); });
  // LCP: keep the largest reported candidate; finalized at flush.
  obs('largest-contentful-paint', (l) => { const es = l.getEntries(); const last = es[es.length - 1]; if (last) set('LCP', last.startTime); });
  // CLS: sum layout shifts (excluding those right after input), session-window-lite.
  let cls = 0;
  obs('layout-shift', (l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) cls += e.value; set('CLS', cls); });
  // INP-lite: worst interaction latency across event durations over threshold.
  let inp = 0;
  obs('event', (l) => { for (const e of l.getEntries()) if (e.duration > inp) inp = e.duration; if (inp) set('INP', inp); }, { durationThreshold: 40 });

  let flushed = false;
  const flush = () => {
    if (flushed || getConsent() !== 'all') return;
    flushed = true;
    for (const [metric, value] of Object.entries(vitals)) {
      if (value == null || !isFinite(value)) continue;
      const v = metric === 'CLS' ? Math.round(value * 1000) / 1000 : Math.round(value);
      beacon('/api/analytics/vital', { path, metric, value: v, rating: rate(metric, value) });
    }
  };
  // Flush once when the page is hidden or being unloaded (the reliable end-of-life signal).
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  addEventListener('pagehide', flush);
}

// ── Session replay (rrweb) ─────────────────────────────────────────────────────
// Records the visitor's session (client-side SPA, so ONE continuous recording across
// route changes) and flushes rrweb event batches to the API. Gated three ways: analytics
// consent, the admin master switch (/analytics/replay/config), and a sampling roll.
// Inputs are masked (maskAllInputs) so we never capture what people type. `.bcw-noreplay`
// blocks an element from the recording entirely. rrweb is lazy-loaded only when recording.
export async function initReplay() {
  if (getConsent() !== 'all') return;
  if (window.__bcwReplay) return; window.__bcwReplay = true;
  let cfg;
  try { cfg = await fetch('/api/analytics/replay/config').then((r) => r.json()); } catch { return; }
  if (!cfg?.enabled) return;

  // Sticky per-tab decision (survives a hard reload): the same session keeps recording.
  const KEY = 'bcw_replay';
  let sessionKey, sampledIn, seq = 0;
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (saved) { sessionKey = saved.k; sampledIn = saved.in; seq = saved.seq || 0; }
  } catch {}
  if (!sessionKey) {
    sampledIn = Math.random() < (typeof cfg.sampleRate === 'number' ? cfg.sampleRate : 0.25);
    sessionKey = ((crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}${Math.random()}`).replace(/[^a-z0-9]/gi, '').slice(0, 32);
  }
  const persist = () => { try { sessionStorage.setItem(KEY, JSON.stringify({ k: sessionKey, in: sampledIn, seq })); } catch {} };
  persist();
  if (!sampledIn) return;

  let record;
  try { ({ record } = await import('rrweb')); } catch { return; }
  let buf = [];
  record({
    emit: (e) => { buf.push(e); },
    sampling: { mousemove: 100, scroll: 150, input: 'last', media: 800 },
    maskAllInputs: true,
    blockClass: 'bcw-noreplay',
    recordCanvas: false,
    collectFonts: false,
  });
  const flush = () => {
    if (!buf.length || getConsent() !== 'all') return;
    const events = buf; buf = [];
    beacon('/api/analytics/replay', { sessionKey, seq: seq++, events, path: location.pathname + location.search });
    persist();
  };
  setInterval(flush, 5000);
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  addEventListener('pagehide', flush);
}
