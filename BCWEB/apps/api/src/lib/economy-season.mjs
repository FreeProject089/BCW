// Seasons and statistics for the point economy.
//
// Two things the admin dashboard could not do: say WHEN the points reset (the only reset was
// a button somebody had to remember to press) and see WHERE the points go — how many were
// generated, won, lost, given and spent today against yesterday, this week against last.
//
// The arithmetic is pure and tested (`nextSeasonReset`, `classify`, `windowsOf`); the two
// database functions are thin: one raw GROUP BY per day and kind for the series, one
// updateMany + a ledger row per member for the reset.

/**
 * How often the season ends.
 *
 * The fixed calendar schedules (daily … yearly) pin a boundary; the three `custom_*` ones are
 * the season LENGTH the admin types: `days` is the N, and the suffix is its unit. `custom` is
 * the original "every N days" and keeps its name so a schedule saved before the two others
 * existed still means what it meant.
 */
export const SEASON_EVERY = ['never', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom', 'custom_weeks', 'custom_months'];

/** The `custom_*` values, and how many days (or months) one unit of each is worth. */
export const SEASON_UNITS = { custom: { unit: 'days', days: 1 }, custom_weeks: { unit: 'weeks', days: 7 }, custom_months: { unit: 'months', months: 1 } };
/** A season length as { n, unit }, or null when the schedule is a fixed calendar one. */
export const seasonLength = (cfg) => { const c = normalizeSeason(cfg); const u = SEASON_UNITS[c.every]; return u ? { n: c.days, unit: u.unit } : null; };

export const SEASON_DEFAULTS = {
  every: 'never',
  days: 30,          // custom / custom_weeks / custom_months: the N of "every N days|weeks|months"
  weekday: 1,        // weekly: 0 = Sunday … 6 = Saturday (UTC)
  dayOfMonth: 1,     // monthly / quarterly / yearly: 1–28 so every month has the day
  hour: 4,           // UTC hour the reset runs at
  resetXp: false,    // also wipe XP + level (a full wipe) — points only otherwise
  announce: true,    // let the bot say a season ended (it reads the state row)
};

export function normalizeSeason(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const n = (v, d, lo, hi) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : d; };
  return {
    every: SEASON_EVERY.includes(r.every) ? r.every : 'never',
    days: n(r.days, 30, 1, 3650),
    weekday: n(r.weekday, 1, 0, 6),
    dayOfMonth: n(r.dayOfMonth, 1, 1, 28),
    hour: n(r.hour, 4, 0, 23),
    resetXp: r.resetXp === true,
    announce: r.announce !== false,
  };
}

const DAY = 864e5;
const atHour = (d, hour) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, 0, 0, 0));

/**
 * The next reset strictly after `from` (the last reset, or the moment the schedule was
 * saved). Null when the schedule is off. Everything is UTC: a season boundary is the same
 * instant for every server the bot is in, and the admin is told the hour is UTC.
 */
export function nextSeasonReset(cfg, from) {
  const c = normalizeSeason(cfg);
  const f = new Date(from);
  if (c.every === 'never' || Number.isNaN(f.getTime())) return null;
  if (c.every === 'custom' || c.every === 'custom_weeks') {
    // Anchored to the hour so a run that fires late does not drift the schedule.
    return atHour(new Date(f.getTime() + c.days * SEASON_UNITS[c.every].days * DAY), c.hour);
  }
  if (c.every === 'custom_months') {
    // Calendar months, not 30-day blocks: "every 3 months" from the 12th of January is the
    // 12th of April. The day is clamped to 28 like every other monthly schedule here, so a
    // season that starts on the 31st does not skip February.
    const day = Math.min(28, f.getUTCDate());
    return atHour(new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + c.days, day)), c.hour);
  }
  if (c.every === 'daily') {
    let d = atHour(f, c.hour);
    if (d <= f) d = new Date(d.getTime() + DAY);
    return d;
  }
  if (c.every === 'weekly') {
    let d = atHour(f, c.hour);
    while (d.getUTCDay() !== c.weekday || d <= f) d = new Date(d.getTime() + DAY);
    return d;
  }
  // monthly / quarterly / yearly: walk month by month to the next matching month, on the day.
  const monthOk = (m) => (c.every === 'monthly' ? true : c.every === 'quarterly' ? m % 3 === 0 : m === 0);
  let y = f.getUTCFullYear(), m = f.getUTCMonth();
  for (let i = 0; i < 24; i++) {
    if (monthOk(m)) {
      const d = new Date(Date.UTC(y, m, c.dayOfMonth, c.hour, 0, 0, 0));
      if (d > f) return d;
    }
    m += 1; if (m > 11) { m = 0; y += 1; }
  }
  return null;
}

/** Is a reset due now, given the state row? */
export function seasonDue(cfg, state, now = new Date()) {
  const from = state?.lastResetAt || state?.since;
  if (!from) return false;
  const next = nextSeasonReset(cfg, from);
  return !!next && now >= next;
}

/**
 * What a ledger row means for the statistics. `delta` is signed; the kind says why.
 *
 *   generated  points that came into existence: level-ups, staff grants, refunds
 *   won        casino payouts above the stake
 *   lost       points that left existence: casino losses, negative grants, a season reset
 *   given      points moved between members (counted once, on the giver's side)
 *   used       points spent in the shop
 */
export function classify(kind, delta) {
  const d = Number(delta) || 0;
  switch (kind) {
    case 'levelup': case 'refund': return d >= 0 ? 'generated' : 'lost';
    case 'grant': return d >= 0 ? 'generated' : 'lost';
    case 'casino': return d >= 0 ? 'won' : 'lost';
    case 'gift_out': case 'gift_item_out': return 'given';
    case 'gift_in': case 'gift_item_in': return null;          // the other side of `given`
    case 'purchase': return d <= 0 ? 'used' : 'generated';
    case 'season': return 'lost';
    default: return d >= 0 ? 'generated' : 'lost';
  }
}

export const METRICS = ['generated', 'won', 'lost', 'given', 'used'];

/** The comparison windows, as [start, end) in UTC. */
export function windowsOf(now = new Date()) {
  const d0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = (d0.getUTCDay() + 6) % 7;                       // Monday = 0
  const w0 = new Date(d0.getTime() - dow * DAY);
  const m0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const mPrev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return {
    today: [d0, new Date(d0.getTime() + DAY)],
    yesterday: [new Date(d0.getTime() - DAY), d0],
    thisWeek: [w0, new Date(w0.getTime() + 7 * DAY)],
    lastWeek: [new Date(w0.getTime() - 7 * DAY), w0],
    thisMonth: [m0, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))],
    lastMonth: [mPrev, m0],
  };
}

const empty = () => Object.fromEntries(METRICS.map((m) => [m, 0]).concat([['rows', 0]]));

/**
 * Fold per-day-per-kind aggregates (from the GROUP BY below) into the windows and a daily
 * series. `rows` = [{ day: Date, kind, pos, neg, n }].
 */
export function foldStats(rows, now = new Date(), days = 30) {
  const win = windowsOf(now);
  const byWindow = Object.fromEntries(Object.keys(win).map((k) => [k, empty()]));
  const series = new Map();
  const d0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(d0.getTime() - i * DAY);
    series.set(d.toISOString().slice(0, 10), { day: d.toISOString().slice(0, 10), ...empty() });
  }
  for (const r of rows) {
    const day = new Date(r.day);
    const pos = Number(r.pos) || 0, neg = Number(r.neg) || 0, n = Number(r.n) || 0;
    const parts = [[classify(r.kind, 1), pos], [classify(r.kind, -1), neg]];
    const add = (bucket) => { bucket.rows += n; for (const [metric, amount] of parts) if (metric && amount) bucket[metric] += amount; };
    for (const [k, [a, b]] of Object.entries(win)) if (day >= a && day < b) add(byWindow[k]);
    const s = series.get(day.toISOString().slice(0, 10));
    if (s) add(s);
  }
  for (const b of Object.values(byWindow)) b.net = b.generated + b.won - b.lost - b.used;
  for (const s of series.values()) s.net = s.generated + s.won - s.lost - s.used;
  return { windows: byWindow, series: [...series.values()] };
}

// ── database ────────────────────────────────────────────────────────────────────────────

export async function economyStats(p, { days = 30 } = {}) {
  const now = new Date();
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const back = new Date(now.getTime() - Math.max(days, 35) * DAY);
  const from = since < back ? since : back;
  // One GROUP BY per day and kind: the ledger can hold a year of rows, and folding those in
  // JavaScript would read them all for six numbers.
  const rows = await p.$queryRaw`
    SELECT date_trunc('day', "createdAt") AS day, kind,
           COALESCE(SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END), 0)::bigint AS pos,
           COALESCE(SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END), 0)::bigint AS neg,
           COUNT(*)::bigint AS n
    FROM "EconomyLedger"
    WHERE "createdAt" >= ${from}
    GROUP BY 1, 2`;
  const folded = foldStats(rows.map((r) => ({ ...r, pos: Number(r.pos), neg: Number(r.neg), n: Number(r.n) })), now, days);
  const [agg, levels, active] = await Promise.all([
    p.userEconomy.aggregate({ _sum: { xp: true, points: true, messages: true, reactions: true, voiceSeconds: true }, _count: true, _max: { level: true }, _avg: { level: true } }),
    p.userEconomy.groupBy({ by: ['level'], _count: true, orderBy: { level: 'asc' } }).catch(() => []),
    p.userEconomy.count({ where: { updatedAt: { gte: new Date(now.getTime() - 7 * DAY) } } }),
  ]);
  return {
    now: now.toISOString(),
    totals: {
      members: agg._count, active7d: active,
      xp: agg._sum.xp || 0, points: agg._sum.points || 0,
      messages: agg._sum.messages || 0, reactions: agg._sum.reactions || 0, voiceHours: Math.round((agg._sum.voiceSeconds || 0) / 360) / 10,
      maxLevel: agg._max.level || 0, avgLevel: Math.round((agg._avg.level || 0) * 10) / 10,
    },
    levels: levels.map((l) => ({ level: l.level, members: l._count })),
    ...folded,
  };
}

export const SEASON_STATE_KEY = 'economy.seasonState';

export async function readSeasonState(p) {
  const row = await p.adminSetting.findUnique({ where: { key: SEASON_STATE_KEY } }).catch(() => null);
  const v = row?.value && typeof row.value === 'object' ? row.value : {};
  return { since: v.since || null, lastResetAt: v.lastResetAt || null, seasonNo: Number(v.seasonNo) || 1, history: Array.isArray(v.history) ? v.history : [] };
}

export async function writeSeasonState(p, state) {
  await p.adminSetting.upsert({ where: { key: SEASON_STATE_KEY }, create: { key: SEASON_STATE_KEY, value: state }, update: { value: state } });
  return state;
}

/**
 * End the season: every member's points to zero (XP and level too when the schedule says
 * so), one `season` ledger row per member who had points, and the state row advanced. The
 * ledger rows are what make the reset show in a member's history and in the statistics as
 * "lost" rather than as points that silently vanished.
 */
export async function runSeasonReset(p, cfg, { by = 'schedule', log = null } = {}) {
  const c = normalizeSeason(cfg);
  const holders = await p.userEconomy.findMany({ where: { points: { gt: 0 } }, select: { userId: true, points: true } });
  const at = new Date();
  const data = c.resetXp ? { points: 0, xp: 0, level: 0 } : { points: 0 };
  const r = await p.userEconomy.updateMany({ data });
  if (holders.length) {
    await p.economyLedger.createMany({ data: holders.map((h) => ({ userId: h.userId, kind: 'season', delta: -h.points, balance: 0, ref: 'season', meta: { by, resetXp: c.resetXp } })) }).catch(() => null);
  }
  const state = await readSeasonState(p);
  const entry = { at: at.toISOString(), by, affected: r.count, holders: holders.length, points: holders.reduce((a, h) => a + h.points, 0), resetXp: c.resetXp, seasonNo: state.seasonNo };
  const next = { ...state, lastResetAt: at.toISOString(), seasonNo: state.seasonNo + 1, history: [entry, ...state.history].slice(0, 24) };
  await writeSeasonState(p, next);
  log?.info?.(`[economy] season ${entry.seasonNo} ended by ${by}: ${entry.affected} member(s), ${entry.points} point(s) retired${c.resetXp ? ', XP wiped' : ''}`);
  return entry;
}

/** The sweeper's hook: run the reset when the schedule says it is time. */
export async function runSeasonIfDue(p, log) {
  const eco = (await p.adminSetting.findUnique({ where: { key: 'bot.config' } }).catch(() => null))?.value?.economy || {};
  const cfg = normalizeSeason(eco.season);
  if (cfg.every === 'never') return null;
  const state = await readSeasonState(p);
  if (!seasonDue(cfg, state)) return null;
  return runSeasonReset(p, cfg, { by: 'schedule', log });
}
