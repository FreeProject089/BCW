// Economy seasons: the API resets points on a schedule (GET /bot/economy/season). This polls
// it, remembers the last season number it saw, and when a new season has started (and the
// admin asked for it to be announced) posts ONE card per guild — through the log routing
// (category economy.season: the log forum / a routed channel), else the guild's general
// announcement channel (the blog route, the Ko-fi channel, the alerts general channel —
// whichever exists in that server).
//
// The number is kept in memory: on a restart the first poll seeds it and announces nothing,
// so a redeploy never re-announces a season that already went out.
import * as ui from '../ui.mjs';
import { api, SITE_URL } from '../api.mjs';
import { config } from '../config.mjs';
import { makeT, localeOf } from '../i18n.mjs';
import { routesOf } from './blog.mjs';
import { destinationFor, _queue } from './logs.mjs';

let lastSeasonNo = null;
let running = false;
export const _resetSeason = () => { lastSeasonNo = null; };

/** The general channel of a guild, for things that have no route of their own. */
export function generalChannelFor(cfg, guild) {
  const has = (id) => id && guild.channels.cache.has(String(id));
  for (const r of routesOf(cfg.blog || {})) if (has(r.channelId)) return String(r.channelId);
  if (has(cfg.kofi?.channelId)) return String(cfg.kofi.channelId);
  if (has(cfg.alerts?.generalChannelId)) return String(cfg.alerts.generalChannelId);
  if (has(cfg.alerts?.channelId)) return String(cfg.alerts.channelId);
  return null;
}

/** Card text, in the guild's language. `pure` for the tests: no Discord in here. */
export function seasonCard(t, { seasonNo, affected, points, next, cur }) {
  const ended = Math.max(0, (seasonNo || 1) - 1);
  return {
    title: t('season.title', { n: ended }), color: ui.BRAND,
    body: [
      t('season.body', { n: ended, m: Number(affected || 0).toLocaleString('en-US'), p: Number(points || 0).toLocaleString('en-US'), cur: cur || 'points' }),
      next ? t('season.next', { when: `<t:${Math.floor(new Date(next).getTime() / 1000)}:R>` }) : t('season.noNext'),
      '', t('season.foot', { n: seasonNo }),
    ],
  };
}

/**
 * The season SCHEDULE as words: "every 2 weeks", "every month", "no automatic reset".
 *
 * The three `custom_*` schedules are the season LENGTH the admin typed — `days` is the N and
 * the suffix is its unit (apps/api/src/lib/economy-season.mjs). Everything else is a fixed
 * calendar boundary and needs no number.
 */
const LENGTH_UNIT = { custom: 'days', custom_weeks: 'weeks', custom_months: 'months' };
export function seasonEveryLabel(t, season = {}) {
  const every = String(season.every || 'never');
  const unit = LENGTH_UNIT[every];
  if (unit) return t(`season.every.${unit}`, { n: Math.max(1, Number(season.days) || 1) });
  return t(`season.every.${['daily', 'weekly', 'monthly', 'quarterly', 'yearly'].includes(every) ? every : 'never'}`);
}

/**
 * `/season` — "how long until the points reset". Pure (no Discord): the whole card is the
 * reply from GET /bot/economy/season, and the countdown is a Discord timestamp, so every
 * reader sees it in their own locale and it keeps ticking without the bot redrawing anything.
 */
export function seasonStatusCard(t, { seasonNo = 1, next = null, since = null, lastResetAt = null, season = {} } = {}) {
  const at = next ? Math.floor(new Date(next).getTime() / 1000) : null;
  const startedAt = lastResetAt || since;
  const started = startedAt ? Math.floor(new Date(startedAt).getTime() / 1000) : null;
  return {
    title: t('season.now.title', { n: Number(seasonNo) || 1 }), color: ui.BRAND,
    body: [
      Number.isFinite(at) ? t('season.now.left', { r: `<t:${at}:R>`, d: `<t:${at}:F>` }) : t('season.now.none'),
      t('season.now.every', { v: seasonEveryLabel(t, season) }),
      Number.isFinite(started) ? t('season.now.started', { when: `<t:${started}:R>` }) : null,
      '', season.resetXp ? t('season.now.wipes') : t('season.now.keeps'),
    ].filter((l) => l !== null),
  };
}

export async function pollSeason(client) {
  if (running) return;
  running = true;
  try {
    const r = await api.economySeason();
    const no = Number(r?.state?.seasonNo);
    if (!Number.isFinite(no)) return;
    if (lastSeasonNo === null) { lastSeasonNo = no; return; } // seeded, nothing to say
    if (no <= lastSeasonNo) return;
    lastSeasonNo = no;
    if (!r.season?.announce) return;
    const cfg = await config();
    if (!cfg?.enabled) return;
    const last = (r.state.history || []).find((h) => Number(h.seasonNo) === no - 1) || (r.state.history || []).slice(-1)[0] || {};
    const cur = cfg.economy?.currencyEmoji || cfg.economy?.currencyName || 'points';
    for (const guild of client.guilds.cache.values()) {
      const t = makeT(localeOf({ guildId: guild.id }, cfg), cfg.i18n);
      const card = ui.card({ ...seasonCard(t, { seasonNo: no, affected: last.affected, points: last.points, next: r.next, cur }), buttons: [ui.btn(`${SITE_URL}/dashboard?s=economy`, t('btn.site'), undefined, { emoji: 'site' })] });
      try {
        const d = await destinationFor(guild.id, 'economy.season');
        if (d?.channel) { _queue.push(`${d.channel.isThread?.() ? 't' : 'c'}:${d.channel.id}`, { payload: card }); continue; }
        const chId = generalChannelFor(cfg, guild);
        const ch = chId ? guild.channels.cache.get(chId) : null;
        if (ch?.send) await ch.send(card);
      } catch (e) { console.warn(`[bot] season announce failed for ${guild.name}:`, e?.message || e); }
    }
    console.log(`[bot] season ${no} announced`);
  } finally { running = false; }
}
