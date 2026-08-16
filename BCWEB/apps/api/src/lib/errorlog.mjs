// Record a server-side 5xx into ErrorEvent, so the admin Errors page reflects the API and
// not just the browser.
//
// Before this, ErrorEvent was written by exactly one caller: POST /analytics/error, i.e. an
// uncaught error in the VISITOR's browser — and consent-gated at that. A 500 out of the API
// only ever reached stdout, so the dashboard could sit empty while an endpoint returned
// nothing but internal_error.
//
// Three rules this must respect, because it runs inside the error handler itself:
//  1. Never throw. An error handler that fails turns one broken response into two.
//  2. Never block the reply — the insert is fire-and-forget.
//  3. Never assume the DB is alive. It is frequently the very thing that's broken, in which
//     case the insert fails and we fall back to the in-memory ring (below).
import { db } from './lib.mjs';
import { boundedSet } from './boundedmap.mjs';

const MSG_MAX = 400; // same bounds the client reporter enforces
const STACK_MAX = 6000;
const PATH_MAX = 300;

// Record the PATH ONLY — never the query string. URLs here carry real secrets: a private
// repo/catalog share link is `/r/<id>?k=<shareKey>`, and this table is readable by anyone
// holding `manage_analytics`, a capability that grants no access to those repos. Logging the
// raw URL would hand the key to them (CWE-532). stdout still has the full URL via
// req.log.error, for whoever already has server access.
const pathOnly = (url) => String(url || '').split('?')[0].slice(0, PATH_MAX);

// A broken endpoint fails on EVERY request. Without a throttle, one outage writes a row per
// hit: it buries the page under thousands of identical rows and grows a table the retention
// sweeper only recently learned to purge. Collapse identical (path, message) to one row per
// window — the dashboard groups by message anyway, and stdout keeps every occurrence.
const WINDOW_MS = 60_000;
const MAX_KEYS = 500; // bounded: `path` is attacker-influenceable, so this must not grow freely
const seen = new Map();

// DB-INDEPENDENT fallback ring. The blind spot this closes: recordServerError persists through
// Prisma, so when the 500's ROOT CAUSE is the data layer (a stale/broken client that makes an
// obviously-correct route throw an instant ~5ms 500), the persist below fails on that SAME
// broken client and gets swallowed. The one class of error the Errors page most needs to show
// — a dead database — was exactly the class it structurally could not record. So we also keep
// the last N server errors in memory and mark whether each reached the table; the recent-errors
// endpoint reads THIS ring, touching no DB, so a data-layer outage stays visible in admin.
const RING_MAX = 60;
const ring = []; // newest last
export function getRecentServerErrors() {
  return ring.slice().reverse(); // newest first
}

export function recordServerError(req, err) {
  try {
    const message = String(err?.message || 'internal_error').slice(0, MSG_MAX);
    const path = pathOnly(req?.url);
    const now = Date.now();

    // The ring records EVERY server error, unthrottled: it's the only trace when the DB is
    // down, and it's tiny and bounded. `persisted` is null while the insert is in flight,
    // then true/false once it settles.
    const entry = { at: now, path, message, persisted: null };
    ring.push(entry);
    if (ring.length > RING_MAX) ring.shift();

    const key = `${path} ${message}`;
    const prev = seen.get(key);
    const throttled = prev && now - prev.at < WINDOW_MS; // identical row persisted this minute
    if (!throttled) boundedSet(seen, key, { at: now }, MAX_KEYS, WINDOW_MS);

    const stack = err?.stack ? String(err.stack).slice(0, STACK_MAX) : null;
    const userId = req?.user?.uid || null; // set only if an auth preHandler already ran
    if (throttled) { entry.persisted = true; return; } // identical row already in the table
    Promise.resolve()
      .then(async () => {
        const p = await db();
        await p.errorEvent.create({ data: { source: 'server', message, stack, path, userId } });
        entry.persisted = true;
        await announceIfNew(p, key, path, message);
      })
      .catch(() => { entry.persisted = false; }); // the DB may be exactly what's broken — the ring keeps it
  } catch {
    // unreachable in practice; the point is that this function cannot be the thing that fails
  }
}

// ── Saying it out loud ───────────────────────────────────────────────────────────
//
// An error that only lands in a table is an error somebody finds on Tuesday. The bot already
// drains an announcement queue, so a NEW failure can reach the people who can act on it.
//
// "New" is doing the work here. The throttle above stops an identical row being written twice a
// minute; this is stricter, because a Discord message costs attention rather than a row:
//
//   · one announcement per distinct path+message per ANNOUNCE_QUIET, so a route failing on
//     every request produces one message, not thousands.
//   · a cap per process lifetime, so a storm of DIFFERENT errors — the shape a broken deploy
//     takes — cannot turn the channel into the log. After the cap it stays quiet, and the
//     Errors page is where the rest live.
const ANNOUNCE_QUIET_MS = 60 * 60 * 1000;
const ANNOUNCE_MAX = 8;
const announced = new Map();   // key -> at
let announcedCount = 0;

async function announceIfNew(p, key, path, message) {
    const now = Date.now();
    const prev = announced.get(key);
    if (prev && now - prev < ANNOUNCE_QUIET_MS) return;
    if (announcedCount >= ANNOUNCE_MAX) return;
    boundedSet(announced, key, now, MAX_KEYS, ANNOUNCE_QUIET_MS);
    announcedCount++;
    const site = (process.env.SITE_URL || '').replace(/\/+$/, '');
    // Never blocks, never throws: an announcement failing must not turn one error into two.
    await p.botAnnouncement.create({
        data: {
            kind: 'incident', urgent: false,
            title: `Server error on ${path || 'an unknown route'}`,
            body: String(message).slice(0, 500),
            url: site ? `${site}/admin?s=errors` : null,
        },
    }).catch(() => {});
}
