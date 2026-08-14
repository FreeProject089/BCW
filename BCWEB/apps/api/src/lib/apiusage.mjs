// What the public API is being used for — recorded without making every API call pay for
// the privilege.
//
// Counts accumulate in memory and are flushed on a timer, so a burst of calls costs one
// UPDATE per key per flush instead of one per request. The trade is explicit: a hard crash
// loses at most FLUSH_MS of counts. That is the right way round — a usage counter is not
// worth slowing down the thing it counts, and it is certainly not worth failing a customer's
// request because a statistics row would not write.
import { db } from './lib.mjs';

const FLUSH_MS = 15_000;
// The sample buffer is capped so a flood cannot turn this into an unbounded queue. Past the
// cap the excess is dropped and counted, because a silently truncated sample would make the
// request log look calm during exactly the incident it exists to explain.
const MAX_BUFFER = 2000;

const counts = new Map(); // `${keyId}|${userId}|${yyyy-mm-dd}` -> { keyId, userId, day, count, errors }
let samples = [];
let dropped = 0;
let timer = null;

// Cached so the hot path never queries settings. Refreshed on each flush, which is soon
// enough for a knob that changes a few times a year.
let cfg = { sampleRate: 1, retentionDays: 7 };
export const apiUsageConfig = () => ({ ...cfg });

const dayKey = (d) => d.toISOString().slice(0, 10);

/** Record one authenticated API call. Never throws, never awaits anything. */
export function recordApiCall({ keyId, userId, method, path, status, ms, ip, sandbox }) {
  try {
    const day = dayKey(new Date());
    const k = `${keyId || ''}|${userId || ''}|${day}`;
    const row = counts.get(k) || { keyId: keyId || null, userId: userId || '', day, count: 0, errors: 0, sandbox: 0 };
    // Sandbox calls are NOT counted in the per-day usage: that number answers "how much is
    // this key really being used", and a demo click is not use. They get their own tally so
    // the chart can still show that somebody is learning the API rather than showing zero.
    if (sandbox) row.sandbox += 1;
    else { row.count += 1; if (status >= 400) row.errors += 1; }
    counts.set(k, row);

    // Errors are always sampled, whatever the rate. The rate exists to keep the volume of
    // boring successes down; a 500 that got dropped by a dice roll is the one line somebody
    // will go looking for.
    const keep = status >= 400 || cfg.sampleRate >= 1 || Math.random() < cfg.sampleRate;
    if (keep) {
      if (samples.length >= MAX_BUFFER) dropped += 1;
      else {
        samples.push({
          keyId: keyId || null, userId: userId || null,
          method: String(method || '').slice(0, 10),
          // Query string deliberately removed, not truncated: private share links carry
          // their secret there (?k=…), and this table is readable by an admin who has no
          // access to those repos.
          path: String(path || '').split('?')[0].slice(0, 300),
          status: Number(status) || 0,
          ms: Math.round(Number(ms) || 0),
          ip: ip || null,
          // Kept apart from real traffic: somebody exploring the console should not show up
          // in the usage figures as a customer hammering the API.
          sandbox: !!sandbox,
        });
      }
    }
    schedule();
  } catch { /* statistics must never break a request */ }
}

function schedule() {
  if (timer) return;
  timer = setTimeout(() => { timer = null; flushApiUsage().catch(() => {}); }, FLUSH_MS);
  // Unref'd so a quiet server can still exit: a pending statistics flush is not a reason to
  // keep a process alive.
  timer.unref?.();
}

/** Write everything buffered. Called on the timer and once more on shutdown. */
export async function flushApiUsage() {
  if (!counts.size && !samples.length) return { counts: 0, samples: 0 };
  const pendingCounts = [...counts.values()];
  const pendingSamples = samples;
  const lost = dropped;
  counts.clear(); samples = []; dropped = 0;

  const p = await db();
  try {
    const row = await p.adminSetting.findUnique({ where: { key: 'api.usage' } });
    if (row?.value) {
      cfg = {
        sampleRate: Number(row.value.sampleRate ?? 1),
        retentionDays: Number(row.value.retentionDays ?? 7),
      };
    }
  } catch { /* keep the cached config */ }

  for (const c of pendingCounts) {
    // Upsert per key/day. The unique index is what makes two API instances safe to run at
    // once: whoever loses the race increments instead of overwriting.
    await p.apiUsageDay.upsert({
      where: { keyId_day: { keyId: c.keyId, day: new Date(`${c.day}T00:00:00.000Z`) } },
      create: { keyId: c.keyId, userId: c.userId, day: new Date(`${c.day}T00:00:00.000Z`), count: c.count, errors: c.errors, sandbox: c.sandbox },
      update: { count: { increment: c.count }, errors: { increment: c.errors }, sandbox: { increment: c.sandbox } },
    }).catch(() => {});
  }
  if (pendingSamples.length) await p.apiRequest.createMany({ data: pendingSamples }).catch(() => {});
  if (lost) {
    await p.apiRequest.create({
      // A visible marker rather than a log line nobody reads: the gap belongs in the same
      // table as the requests it is a gap in.
      data: { method: 'NOTE', path: `sample buffer full — ${lost} call(s) not recorded`, status: 0, ms: 0 },
    }).catch(() => {});
  }
  return { counts: pendingCounts.length, samples: pendingSamples.length };
}

/** Drop sampled requests past their retention. Counts are never pruned — they are small. */
export async function pruneApiRequests(p, log) {
  const row = await p.adminSetting.findUnique({ where: { key: 'api.usage' } }).catch(() => null);
  const days = Math.max(1, Number(row?.value?.retentionDays ?? cfg.retentionDays ?? 7));
  const cutoff = new Date(Date.now() - days * 86400_000);
  const r = await p.apiRequest.deleteMany({ where: { at: { lt: cutoff } } }).catch(() => ({ count: 0 }));
  if (r.count) log?.info?.({ removed: r.count, days }, 'sweeper: pruned sampled API requests');
  return r.count;
}
