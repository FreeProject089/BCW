// Admin: the economy's statistics and its seasons.
//
//   GET  /admin/economy/stats?days=30     totals + windows (today/yesterday/week/month) + a daily series
//   GET  /admin/economy/season            the schedule, the state row, when the next reset falls
//   PUT  /admin/economy/season            save the schedule (into bot.config.economy.season)
//   POST /admin/economy/season/end        end the season now (same reset the schedule runs)
//   GET  /admin/economy/seasons?take&skip past seasons, newest first (paginated)
//   GET  /admin/economy/history/retention the point-ledger retention config + what it holds
//   PUT  /admin/economy/history/retention set the retention (age limit and/or row cap)
//   POST /admin/economy/history/sweep     apply that retention now (what the sweeper does nightly)
//   POST /admin/economy/history/clear     empty the ledger history now (audited, balances untouched)
//
// Guarded by manage_economy like the rest of the economy (grant, reset, deliveries): the
// bot dashboard's capability does not reach the ledger.
import { z } from 'zod';
import { db, requireCap, logAudit, botAuth } from '../lib/lib.mjs';
import { sweepEconomyHistory, clearEconomyHistory } from '../lib/economy-shop.mjs';
import { economyStats, normalizeSeason, nextSeasonReset, readSeasonState, writeSeasonState, runSeasonReset, seasonHistory, SEASON_EVERY, SEASON_HISTORY_MAX } from '../lib/economy-season.mjs';

const CONFIG_KEY = 'bot.config';

// The body PUT /admin/economy/season validates. Module-level and exported so the config import (lib/config-transfer.mjs) checks a seed with this schema rather than a copy of it.
export const SEASON_BODY = z.object({
  every: z.enum(SEASON_EVERY),
  days: z.number().int().min(1).max(3650).optional(),
  weekday: z.number().int().min(0).max(6).optional(),
  dayOfMonth: z.number().int().min(1).max(28).optional(),
  hour: z.number().int().min(0).max(23).optional(),
  resetXp: z.boolean().optional(),
  announce: z.boolean().optional(),
});

export default async function economyAdminRoutes(app) {
  app.get('/admin/economy/stats', { preHandler: requireCap('manage_economy') }, async (req) => {
    const days = Math.min(90, Math.max(7, parseInt(req.query?.days, 10) || 30));
    return economyStats(await db(), { days });
  });

  const seasonView = async (p) => {
    const cfgRow = await p.adminSetting.findUnique({ where: { key: CONFIG_KEY } }).catch(() => null);
    const cfg = normalizeSeason(cfgRow?.value?.economy?.season);
    const state = await readSeasonState(p);
    const from = state.lastResetAt || state.since;
    const next = from ? nextSeasonReset(cfg, from) : null;
    return { season: cfg, state, next: next ? next.toISOString() : null };
  };

  app.get('/admin/economy/season', { preHandler: requireCap('manage_economy') }, async () => seasonView(await db()));

  // The bot's read: which season it is, when the last reset was, when the next falls — so it
  // can announce a season's end and show "season N" on its cards. Bot secret, no session.
  app.get('/bot/economy/season', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    return seasonView(await db());
  });

  // Past seasons — what the dashboard shows as "saisons précédentes". One page of the state
  // row's history, newest first, with the names behind the user ids.
  //
  // `total` is the number of seasons STILL KEPT, not the number that ever ran: the history is
  // an array inside one AdminSetting value and is capped at SEASON_HISTORY_MAX (24), so older
  // seasons are gone for good. `cap` is reported so the UI can say so rather than imply the
  // list is complete. The live season is not in here — it has not ended; it is in
  // GET /admin/economy/season.
  app.get('/admin/economy/seasons', { preHandler: requireCap('manage_economy') }, async (req) => {
    const p = await db();
    const take = Math.min(SEASON_HISTORY_MAX, Math.max(1, parseInt(req.query?.take, 10) || 12));
    const skip = Math.max(0, parseInt(req.query?.skip, 10) || 0);
    const state = await readSeasonState(p);
    const all = seasonHistory(state);
    const page = all.slice(skip, skip + take);
    // 'schedule' is not a user id; only real ids are looked up, in one query.
    const ids = [...new Set(page.map((s) => s.endedBy).filter((x) => x && x !== 'schedule'))];
    const names = Object.fromEntries((ids.length
      ? await p.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } })
      : []).map((u) => [u.id, u.displayName]));
    return {
      seasons: page.map((s) => ({
        ...s,
        // A deleted admin's id resolves to nothing: say the id, never an empty name.
        endedByName: s.endedBy === 'schedule' ? null : (names[s.endedBy] || s.endedBy || null),
        scheduled: s.endedBy === 'schedule',
      })),
      total: all.length, take, skip, cap: SEASON_HISTORY_MAX,
      currentSeasonNo: state.seasonNo,
    };
  });

  app.put('/admin/economy/season', { preHandler: requireCap('manage_economy') }, async (req, reply) => {
    const b = SEASON_BODY.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const row = await p.adminSetting.findUnique({ where: { key: CONFIG_KEY } }).catch(() => null);
    const value = row?.value && typeof row.value === 'object' ? row.value : {};
    const economy = value.economy && typeof value.economy === 'object' ? value.economy : {};
    const season = normalizeSeason({ ...normalizeSeason(economy.season), ...b.data });
    // The schedule lives with the rest of the economy config, where the dashboard's save
    // round-trips it; the clock (since / last reset) lives in its own row so that save can
    // never rewind it.
    await p.adminSetting.upsert({ where: { key: CONFIG_KEY }, create: { key: CONFIG_KEY, value: { ...value, economy: { ...economy, season } } }, update: { value: { ...value, economy: { ...economy, season } } } });
    const state = await readSeasonState(p);
    // Turning a schedule on starts the clock now: the first reset is the next boundary
    // after this moment, never one computed from a reset that happened months ago.
    if (season.every !== 'never' && (!state.since || normalizeSeason(economy.season).every === 'never')) {
      await writeSeasonState(p, { ...state, since: new Date().toISOString() });
    }
    await logAudit(p, req.user.uid, 'economy.season', `every=${season.every} hour=${season.hour}${season.resetXp ? ' +xp' : ''}`);
    return seasonView(p);
  });

  app.post('/admin/economy/season/end', { preHandler: requireCap('manage_economy') }, async (req) => {
    const p = await db();
    const cfgRow = await p.adminSetting.findUnique({ where: { key: CONFIG_KEY } }).catch(() => null);
    const cfg = normalizeSeason({ ...normalizeSeason(cfgRow?.value?.economy?.season), ...(req.body?.resetXp != null ? { resetXp: !!req.body.resetXp } : {}) });
    const entry = await runSeasonReset(p, cfg, { by: req.user.uid, log: app.log });
    await logAudit(p, req.user.uid, 'economy.season.end', `season=${entry.seasonNo} affected=${entry.affected} points=${entry.points}${cfg.resetXp ? ' +xp' : ''}`);
    return { ok: true, entry, ...(await seasonView(p)) };
  });
  // ── The point ledger's history: how much of it is kept, and emptying it ──────────────
  //
  // The ledger is HISTORY, not state: a member's points live in UserEconomy.points, and every
  // read of a balance in this codebase reads that column. Nothing sums the ledger to find out
  // what somebody has. That is why clearing it is allowed at all, and it is the one property
  // the tests pin — delete every row and every balance is exactly what it was.
  //
  // The retention pair lives in bot.config.economy (historyDays, historyMax) with the rest of
  // the economy configuration, so the dashboard's export/import carries it like everything
  // else; this endpoint exists so the UI can change those two numbers without round-tripping
  // the whole bot config. The sweeper applies them once a day.
  //
  // The path is `/history/retention`, not `/history`: GET /admin/economy/history is already the
  // ledger itself (routes/bot.mjs), and fastify refuses a second declaration of a route rather
  // than letting one silently shadow the other.
  const economyCfg = async (p) => {
    const row = await p.adminSetting.findUnique({ where: { key: CONFIG_KEY } }).catch(() => null);
    const value = row?.value && typeof row.value === 'object' ? row.value : {};
    const economy = value.economy && typeof value.economy === 'object' ? value.economy : {};
    return { value, economy };
  };
  const historyView = async (p) => {
    const { economy } = await economyCfg(p);
    const [rows, oldest] = await Promise.all([
      p.economyLedger.count(),
      p.economyLedger.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    ]);
    return {
      historyDays: Number.isFinite(Number(economy.historyDays)) ? Number(economy.historyDays) : 180,
      historyMax: Math.max(0, Math.round(Number(economy.historyMax) || 0)),
      rows, oldestAt: oldest?.createdAt || null,
    };
  };

  app.get('/admin/economy/history/retention', { preHandler: requireCap('manage_economy') }, async () => historyView(await db()));

  // 0 means "no limit of that kind" here, exactly as it does everywhere else in this config
  // (maxBet, gifts.maxPerDay) — not "keep nothing".
  const HISTORY_BODY = z.object({
    historyDays: z.number().int().min(0).max(3650).optional(),
    historyMax: z.number().int().min(0).max(5_000_000).optional(),
  }).refine((b) => b.historyDays != null || b.historyMax != null, 'nothing to set');

  app.put('/admin/economy/history/retention', { preHandler: requireCap('manage_economy') }, async (req, reply) => {
    const b = HISTORY_BODY.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const { value, economy } = await economyCfg(p);
    const next = { ...economy, ...(b.data.historyDays != null ? { historyDays: b.data.historyDays } : {}), ...(b.data.historyMax != null ? { historyMax: b.data.historyMax } : {}) };
    await p.adminSetting.upsert({ where: { key: CONFIG_KEY }, create: { key: CONFIG_KEY, value: { ...value, economy: next } }, update: { value: { ...value, economy: next } } });
    await logAudit(p, req.user.uid, 'economy.history.config', `days=${next.historyDays ?? 180} max=${next.historyMax ?? 0}`);
    return historyView(p);
  });

  // Empty the history NOW. Optional `olderThanDays` (keep the recent tail) and `userId` (one
  // member). Audited before the delete runs, so a clear that dies half-way still left a record
  // that somebody asked for it — the rows themselves are gone either way and an audit written
  // afterwards is an audit that can be missing.
  app.post('/admin/economy/history/clear', { preHandler: requireCap('manage_economy') }, async (req, reply) => {
    const b = z.object({
      olderThanDays: z.number().int().min(0).max(3650).optional(),
      userId: z.string().min(1).max(64).optional(),
    }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const scope = `${b.data.userId ? `user=${b.data.userId}` : 'all members'}${b.data.olderThanDays ? ` olderThan=${b.data.olderThanDays}d` : ' (everything)'}`;
    await logAudit(p, req.user.uid, 'economy.history.clear', scope);
    const removed = await clearEconomyHistory(p, b.data);
    return { ok: true, removed, ...(await historyView(p)) };
  });

  // Run the configured clean-up now, without waiting for the daily sweep — the same function
  // the sweeper calls, so what an admin sees here is what will happen on its own tonight.
  app.post('/admin/economy/history/sweep', { preHandler: requireCap('manage_economy') }, async (req) => {
    const p = await db();
    const { economy } = await economyCfg(p);
    const r = await sweepEconomyHistory(p, economy);
    await logAudit(p, req.user.uid, 'economy.history.sweep', `aged=${r.aged} capped=${r.capped}`);
    return { ok: true, ...r, ...(await historyView(p)) };
  });
}
