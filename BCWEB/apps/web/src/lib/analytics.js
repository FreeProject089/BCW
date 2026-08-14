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

// ── First-party in-page interaction tracking ─────────────────────────────────
// Captures the coarse SHAPE of a session — which button was clicked, which field
// was edited, which modal opened — so the admin Sessions feed can show a real
// activity timeline (like a session replay) WITHOUT any heavyweight recording or
// third-party script. Consent-gated (analytics = 'all'), no field VALUES are ever
// read, only short human labels (button text / field name / modal title). Events
// are batched and beaconed; a short debounce keeps each event's server timestamp
// close to when it actually happened so it interleaves correctly with pageviews.
const clip = (s, n = 60) => { const v = String(s || '').replace(/\s+/g, ' ').trim(); return v.length > n ? v.slice(0, n - 1) + '…' : v; };
// A readable label for an actionable element: explicit override → aria-label →
// visible text → title → name/placeholder → element role. Never its value.
function elLabel(el) {
  if (!el) return '';
  return clip(
    el.getAttribute?.('data-track')
    || el.getAttribute?.('aria-label')
    || el.textContent
    || el.getAttribute?.('title')
    || el.getAttribute?.('name')
    || el.getAttribute?.('placeholder')
    || el.getAttribute?.('type')
    || (el.tagName ? el.tagName.toLowerCase() : ''),
  );
}
// Nearest heading/label text inside a container (for modals & forms).
function titleOf(node) {
  if (!node) return '';
  const t = node.getAttribute?.('data-modal-title') || node.getAttribute?.('aria-label');
  if (t) return clip(t);
  const h = node.querySelector?.('h1,h2,h3,[data-title],legend,.modal-title');
  return clip(h?.textContent || '');
}

let _queue = [];
let _flushTimer = null;
function push(kind, label) {
  if (getConsent() !== 'all') return;
  _queue.push({ kind, label: clip(label) || null, path: location.pathname + location.search });
  if (_queue.length > 40) _queue = _queue.slice(-40); // bound memory if flushes fail
  // Debounced flush: keeps the server-side timestamp within ~1.2s of the real event
  // so interactions interleave with pageviews in the session timeline.
  if (!_flushTimer) _flushTimer = setTimeout(flushInteractions, 1200);
}
function flushInteractions() {
  _flushTimer = null;
  if (!_queue.length || getConsent() !== 'all') return;
  const items = _queue; _queue = [];
  beacon('/api/analytics/interactions', { items });
}

export function initInteractions() {
  if (getConsent() !== 'all') return;
  if (window.__bcwInteractions) return;
  window.__bcwInteractions = true;

  // Clicks on anything actionable. `copy`-style buttons get their own kind so the
  // timeline can show "Copied …" distinctly (matches our copy-to-clipboard buttons).
  document.addEventListener('click', (e) => {
    const el = e.target?.closest?.('button,a[href],[role="button"],[role="tab"],[data-track],summary,input[type="submit"],input[type="button"]');
    if (!el) return;
    const label = elLabel(el);
    const hay = (label + ' ' + (el.getAttribute('data-track') || '') + ' ' + (el.className || '')).toLowerCase();
    const kind = (el.hasAttribute('data-copy') || /\bcopy|copier\b/.test(hay)) ? 'copy' : 'click';
    push(kind, label);
  }, { capture: true, passive: true });

  // Field edits — the FACT that a field changed and its identity, never the value.
  // `change` fires on commit/blur (not per keystroke), so this stays low-volume.
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!el || !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
    if (/^(password|hidden)$/i.test(el.type || '')) return; // never touch secret fields
    let label = el.getAttribute('aria-label') || '';
    if (!label && el.id) label = clip(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent || '');
    if (!label) label = el.closest('label') ? clip(el.closest('label').textContent) : '';
    if (!label) label = el.getAttribute('name') || el.getAttribute('placeholder') || (el.tagName === 'SELECT' ? 'select' : 'field');
    push('input', label);
  }, { capture: true, passive: true });

  // Form submissions.
  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (!f || f.tagName !== 'FORM') return;
    const submitEl = f.querySelector('[type="submit"]');
    push('submit', titleOf(f) || elLabel(submitEl) || f.getAttribute('name') || 'form');
  }, { capture: true, passive: true });

  // Modal open/close. Our modals mount/unmount a `.modal`/[role=dialog] node, so a
  // childList observer catches both without touching component code.
  const openModals = new WeakSet();
  const isModal = (n) => n?.nodeType === 1 && (n.matches?.('.modal,[role="dialog"],[aria-modal="true"]') || n.querySelector?.('.modal,[role="dialog"],[aria-modal="true"]'));
  const modalNode = (n) => (n.matches?.('.modal,[role="dialog"],[aria-modal="true"]') ? n : n.querySelector?.('.modal,[role="dialog"],[aria-modal="true"]'));
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) { if (isModal(n)) { const md = modalNode(n); if (md && !openModals.has(md)) { openModals.add(md); push('modal_open', titleOf(md) || 'modal'); } } }
      for (const n of m.removedNodes) { if (isModal(n)) { const md = modalNode(n); if (md) { openModals.delete(md); push('modal_close', titleOf(md) || 'modal'); } } }
    }
  });
  try { mo.observe(document.body, { childList: true, subtree: true }); } catch {}

  // Never lose the tail of a session.
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushInteractions(); });
  addEventListener('pagehide', flushInteractions);
}

// ── Real-user Web Vitals (native, no web-vitals dep, no CDN) ───────────────────
// Collects Core Web Vitals (LCP, CLS, INP) + FCP + TTFB with PerformanceObserver and
// flushes them once when the page is backgrounded/unloaded. web.dev "good/poor"
// thresholds decide the rating. Attributes every metric to the path at page load
// (these are page-load metrics by definition). Best-effort — silently no-ops on
// browsers without the relevant entry types (e.g. Safari lacks layout-shift/INP).
const THRESHOLDS = { LCP: [2500, 4000], CLS: [0.1, 0.25], INP: [200, 500], FCP: [1800, 3000], TTFB: [800, 1800] };
const rate = (m, v) => { const [g, p] = THRESHOLDS[m]; return v <= g ? 'good' : v <= p ? 'needs-improvement' : 'poor'; };

// Above these, the number is not a slow page — it is an outage, a suspended laptop, or a
// tab restored hours later, and the browser counts that wall-clock time inside the metric.
// Real examples from this site's own data: a 113s and a 1466s TTFB, both recorded while
// the API was restarting. Keeping them does not describe a user experience; it drags every
// percentile and fires "poor" alerts about something no optimisation can fix.
//
// Discarded, not clamped: a clamped value still counts as a sample and still says "poor".
// A sample that measures nothing should not exist.
const CEILING = { LCP: 60000, FCP: 60000, TTFB: 60000, INP: 60000, CLS: 10 };

/** A short, human name for the element an interaction landed on.
 *
 *  Identity only: an aria-label, a button's text, a tag and role. Never a field's VALUE —
 *  the whole point of this table is that it can be read by staff who have no business
 *  seeing what somebody typed.
 */
function labelOfNode(el) {
  try {
    if (!el || el.nodeType !== 1) return null;
    const t = el.tagName.toLowerCase();
    const name = el.getAttribute?.('aria-label')
      || (t === 'input' || t === 'textarea' || t === 'select' ? (el.getAttribute('name') || el.getAttribute('placeholder') || '') : (el.textContent || '').trim());
    return `${t}${name ? `: ${String(name).replace(/\s+/g, ' ').slice(0, 60)}` : ''}`;
  } catch { return null; }
}

export function initVitals() {
  if (getConsent() !== 'all') return;
  if (typeof PerformanceObserver === 'undefined' || window.__bcwVitals) return;
  window.__bcwVitals = true;
  const path = location.pathname + location.search;
  // A tab that was hidden at any point before the flush had its timers throttled and its
  // rendering deferred, so LCP and FCP describe when the user came BACK, not how fast the
  // page was. web.dev's own guidance is to drop those loads rather than report them.
  // Starting hidden (a background tab opened from a link) counts too.
  let everHidden = document.visibilityState === 'hidden';
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') everHidden = true; }, { capture: true });
  const vitals = {};        // metric → value (latest/aggregate)
  let inpTarget = null;     // what the worst interaction landed on
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
  // INP, grouped by INTERACTION rather than by event.
  //
  // The old version took the longest single `event` entry, which is not what INP measures
  // and reliably overstates it. One tap emits pointerdown, pointerup and click as separate
  // entries covering overlapping time, so the same interaction was counted three times and
  // the worst slice won. Worse, entries with `interactionId === 0` are not interactions at
  // all — they are events the browser did not attribute to a user gesture — and web.dev
  // excludes them for exactly that reason.
  //
  // So: group by interactionId, take the longest duration WITHIN each interaction (that is
  // the interaction's latency), then report the worst interaction on the page.
  const interactions = new Map(); // interactionId → { dur, target }
  let inp = 0;
  obs('event', (l) => {
    for (const e of l.getEntries()) {
      if (!e.interactionId) continue;
      const cur = interactions.get(e.interactionId);
      if (!cur || e.duration > cur.dur) {
        interactions.set(e.interactionId, { dur: e.duration, target: cur?.target || labelOfNode(e.target) });
      }
    }
    let worst = null;
    for (const v of interactions.values()) if (!worst || v.dur > worst.dur) worst = v;
    if (worst) { inp = worst.dur; set('INP', inp); inpTarget = worst.target; }
  }, { durationThreshold: 40 });

  let flushed = false;
  const flush = () => {
    if (flushed || getConsent() !== 'all') return;
    flushed = true;
    for (const [metric, value] of Object.entries(vitals)) {
      if (value == null || !isFinite(value)) continue;
      // INP is an INTERACTION metric — it stays meaningful on a tab that was backgrounded
      // between interactions, so only the load-time metrics are dropped for that reason.
      if (everHidden && metric !== 'INP' && metric !== 'CLS') continue;
      if (value > (CEILING[metric] ?? Infinity)) continue;
      const v = metric === 'CLS' ? Math.round(value * 1000) / 1000 : Math.round(value);
      // The label rides along only for INP, because it is the only metric where "which
      // element" is the actionable half. An INP figure with nothing to point at is a number
      // you can watch and cannot fix.
      beacon('/api/analytics/vital', { path, metric, value: v, rating: rate(metric, value), ...(metric === 'INP' && inpTarget ? { label: inpTarget } : {}) });
    }
  };
  // Flush once when the page is hidden or being unloaded (the reliable end-of-life signal).
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  addEventListener('pagehide', flush);
}

// ── Client error capture (consent-gated) ──────────────────────────────────────
// Reports uncaught errors + unhandled promise rejections so the admin can see what's
// breaking in the wild (à la Rybbit). Consent-gated; message/stack are bounded and
// lightly de-duped (same message within a short window is dropped) to avoid floods.
export function initErrors() {
  if (getConsent() !== 'all') return;
  const seen = new Map(); // message → last-sent ts (drop repeats within 30s)
  const report = (message, stack) => {
    const msg = clip(message, 300); if (!msg) return;
    const now = Date.now(); const last = seen.get(msg) || 0;
    if (now - last < 30000) return; seen.set(msg, now);
    beacon('/api/analytics/error', { path: location.pathname, message: msg, stack: String(stack || '').slice(0, 4000) || undefined });
  };
  addEventListener('error', (e) => {
    if (e?.error) report(e.error.message || e.message, e.error.stack);
    else if (e?.message) report(e.message, `${e.filename || ''}:${e.lineno || ''}:${e.colno || ''}`);
  });
  addEventListener('unhandledrejection', (e) => {
    const r = e?.reason; report(r?.message || String(r), r?.stack);
  });
}
