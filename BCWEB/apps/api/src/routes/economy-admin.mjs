// Admin: the economy's statistics and its seasons.
//
//   GET  /admin/economy/stats?days=30     totals + windows (today/yesterday/week/month) + a daily series
//   GET  /admin/economy/season            the schedule, the state row, when the next reset falls
//   PUT  /admin/economy/season            save the schedule (into bot.config.economy.season)
//   POST /admin/economy/season/end        end the season now (same reset the schedule runs)
//
// Guarded by manage_economy like the rest of the economy (grant, reset, deliveries): the
// bot dashboard's capability does not reach the ledger.
import { z } from 'zod';
import { db, requireCap, logAudit, botAuth } from '../lib/lib.mjs';
import { economyStats, normalizeSeason, nextSeasonReset, readSeasonState, writeSeasonState, runSeasonReset, SEASON_EVERY } from '../lib/economy-season.mjs';

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
}
