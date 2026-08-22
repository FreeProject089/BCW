// Site-wide feature switches, readable from a hot path.
//
// These gate things that run on ordinary requests - sign-in, checkout, webhooks - so they
// cannot each open a database connection. The values are refreshed on a timer and read
// synchronously from memory; a flag that is up to 15 seconds stale is harmless, and a
// database hiccup turning every sign-in into a 500 is not.
//
// UNSET MEANS ENABLED. A deployment that upgrades into this file has no rows for any of
// these keys, and the site must behave exactly as it did before. Only an explicit `false`
// turns something off.
//
// What these deliberately do NOT gate:
//
//  · Password sign-in. Every switch here must leave a way back in - an admin who turns off
//    OAuth and finds the site has no login left has locked themselves out of the panel
//    that would undo it.
//  · The Stripe WEBHOOK. Turning payments off stops new checkouts; it must not stop us
//    processing events for subscriptions that already exist, or renewals and cancellations
//    stop being recorded and the database silently drifts away from Stripe.
import { db } from './lib.mjs';

export const FLAG_KEYS = [
    'features.hostingEnabled',
    'features.paymentsEnabled',
    'features.oauthLoginEnabled',
    'features.ssoEnabled',
    'features.webhooksEnabled',
    'features.publicApiEnabled',
];

let cache = {};
let loadedAt = 0;
const TTL_MS = 15_000;

/** Refresh the cache from the database. Failures leave the previous values in place. */
export async function refreshFlags() {
    try {
        const p = await db();
        const rows = await p.adminSetting.findMany({ where: { key: { in: FLAG_KEYS } } });
        cache = Object.fromEntries(rows.map((r) => [r.key, r.value]));
        loadedAt = Date.now();
    } catch { /* keep what we have: a DB blip must not flip a feature off */ }
}

/** Is this feature on? Synchronous by design - see the note at the top.
 *
 *  Only an explicit `false` (or the string "false", which is what a checkbox round-tripped
 *  through some clients gives) counts as off. Anything else, including a missing row, is on.
 */
export function flagEnabled(key) {
    const v = cache[key];
    return !(v === false || v === 'false');
}

/** Start the refresh loop. Called once at boot, after the first synchronous load. */
export async function startFlagRefresh() {
    await refreshFlags();
    const t = setInterval(refreshFlags, TTL_MS);
    t.unref?.();   // never hold the process open on this
    return t;
}

/** Age of the cached values, for a health/debug view. */
export function flagsAgeMs() { return loadedAt ? Date.now() - loadedAt : null; }

/** The shape a route sends back when it refuses because a switch is off.
 *  A distinct code, not a bare 403: "this is turned off site-wide" and "you are not
 *  allowed" are different answers and the client should be able to say which it got. */
export function disabledReply(reply, feature) {
    return reply.code(503).send({ error: 'feature_disabled', feature });
}
