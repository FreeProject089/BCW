// Stripe's REAL status, as Stripe publishes it.
//
// The monitor used to answer "is Stripe up?" by calling `GET /v1/balance` with OUR secret key.
// That answers a different question — "does our key work?" — and answers it wrong in the cases
// people noticed: a restricted key without the balance permission, a rotated key, a test key on
// a live install all came back 401/403 and painted Stripe red on the status page while Stripe
// itself was fine. Stripe publishes its own state; this reads it.
//
// The endpoint: https://www.stripestatus.com/api/v2/status.json — a standard Statuspage
// document, `{ page, status: { indicator, description } }`, indicator ∈ none | minor | major |
// critical | maintenance. Measured 2026-09-22. NOT https://status.stripe.com/current: that one
// still answers 200 with JSON, but its `time` field says February 2024 — it is frozen, and a
// frozen "all services are online" is the most convincing wrong answer there is.
//
// Polite by construction: one request per TTL (5 min, the same max-age Stripe's own CDN sends)
// shared by every caller, a 5 s timeout, never more than one request in flight, and a failure
// keeps the last good answer (marked stale) and backs off instead of retrying on every tick.
// Nothing here throws: a status page that crashes because a THIRD party's status page is down
// would be a joke at our own expense.

export const STRIPE_STATUS_URL = 'https://www.stripestatus.com/api/v2/status.json';
export const STRIPE_STATUS_PAGE = 'https://status.stripe.com';
const TTL_MS = 5 * 60_000;
const FAIL_BACKOFF_MS = 10 * 60_000;
const TIMEOUT_MS = 5000;

// Statuspage's indicator → our vocabulary. `maintenance` is a planned state, not an outage.
const STATE_OF = { none: 'operational', minor: 'degraded', major: 'major', critical: 'critical', maintenance: 'maintenance' };

/**
 * One Statuspage document → `{ state, indicator, description, updatedAt }`, or null when the
 * shape is not the one we know. Pure; exported for the tests. An unknown indicator is
 * `unknown`, never `operational`: guessing green is the failure this module exists to fix.
 */
export function parseStripeStatus(doc) {
    const s = doc && typeof doc === 'object' ? doc.status : null;
    if (!s || typeof s !== 'object' || typeof s.indicator !== 'string') return null;
    const indicator = s.indicator.toLowerCase();
    return {
        state: STATE_OF[indicator] || 'unknown',
        indicator,
        description: String(s.description || '').slice(0, 200),
        updatedAt: doc.page?.updated_at || null,
    };
}

/**
 * The boolean the dependency checks speak. Only a major or critical incident is "down":
 * a minor one is a degradation Stripe is working on and payments mostly go through, and
 * painting it as an outage would record downtime we did not have. `unknown` → null
 * ("cannot tell"), which the status page shows as not-configured rather than as broken.
 */
export function stripeUp(status) {
    if (!status || status.state === 'unknown') return null;
    return !(status.state === 'major' || status.state === 'critical');
}

/** A fresh cache — exported so a test (or a second consumer) can have its own. */
export function createStripeStatusCache({ fetchImpl = globalThis.fetch, now = () => Date.now(), ttlMs = TTL_MS, backoffMs = FAIL_BACKOFF_MS } = {}) {
    let last = null;        // last GOOD parse, with `at`
    let nextTryAt = 0;      // no network before this
    let inflight = null;

    async function refresh() {
        try {
            const r = await fetchImpl(STRIPE_STATUS_URL, {
                headers: { accept: 'application/json', 'user-agent': 'BetterCommunity status (+https://bettercommunity.ch/status)' },
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            if (!r.ok) throw new Error(`status ${r.status}`);
            const parsed = parseStripeStatus(await r.json());
            if (!parsed) throw new Error('unexpected shape');
            last = { ...parsed, at: now(), stale: false, error: null };
            nextTryAt = now() + ttlMs;
        } catch (e) {
            // Keep what we knew, say it is old, and do not ask again for a while.
            nextTryAt = now() + backoffMs;
            last = last ? { ...last, stale: true, error: String(e?.message || e).slice(0, 120) } : null;
        } finally { inflight = null; }
        return last;
    }

    return {
        /** The current answer, fetching at most once per TTL. Never throws. `null` = never known. */
        async get() {
            if (now() < nextTryAt) return last;
            if (!inflight) inflight = refresh();
            return inflight;
        },
        /** What is cached, without touching the network. */
        peek: () => last,
    };
}

// The process-wide instance every caller shares — the whole point of the TTL.
const shared = createStripeStatusCache();
export const stripeStatus = () => shared.get().catch(() => null);
export const stripeStatusPeek = () => shared.peek();
