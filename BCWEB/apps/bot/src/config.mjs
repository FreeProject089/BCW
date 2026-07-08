// Bot config cache. Pulled from BCWEB (admin-editable) and refreshed every 30s so
// dashboard changes take effect without a restart.
import { api } from './api.mjs';

let cache = null;
let at = 0;

export async function config(force = false) {
  if (!force && cache && Date.now() - at < 30_000) return cache;
  try { cache = await api.getConfig(); at = Date.now(); }
  catch { if (!cache) cache = { enabled: false }; }
  return cache;
}

// Features that can be configured PER SERVER. Everything else (master enable,
// blog routes, alerts, kofi, limits) stays global/cross-server.
const PER_GUILD_FEATURES = ['moderation', 'welcome', 'joinToCreate', 'gating'];

// Resolve the effective config for one guild: a per-guild override in
// cfg.guilds[guildId] REPLACES the top-level feature (which acts as the default
// for guilds without an override — so a single-server setup keeps working, and a
// multi-server setup can tune each server independently).
export function resolveGuildConfig(cfg, guildId) {
  if (!cfg) return cfg;
  const over = (cfg.guilds && cfg.guilds[guildId]) || {};
  const out = { ...cfg };
  for (const f of PER_GUILD_FEATURES) if (over[f] !== undefined) out[f] = over[f];
  return out;
}

// Convenience: fetch + resolve the config for a specific guild in one call.
export async function guildConfig(guildId, force = false) {
  return resolveGuildConfig(await config(force), guildId);
}
