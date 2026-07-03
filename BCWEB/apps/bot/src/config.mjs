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
