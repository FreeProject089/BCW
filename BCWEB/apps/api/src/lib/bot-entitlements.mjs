// Discord bot plans (M21): what a server may use on the bot, and who decides.
//
// ── DESIGN DECISIONS ─────────────────────────────────────────────────────────────────────────
//
// 1. A bot plan IS a HostingPlan. `HostingPlan.kind` is 'hosting' (every row before this) or
//    'bot' (no storage, a recurring subscription), and ANY plan may carry `HostingPlan.bot`,
//    the entitlements it grants. A hosting plan with `bot` set is a BUNDLE ("hosting + bot").
//    Reusing the table reuses everything that already exists for plans: the admin editor,
//    the price-change notice machinery, Stripe checkout, the webhook, the Subscription row,
//    its renewal (invoice.paid) and its end (customer.subscription.deleted, the sweeper). A
//    second plan table would have been a second copy of all of that, and the copy is the one
//    that forgets the notice period.
//
// 2. A grant is a Subscription. Entitlements are never stored per guild: they are COMPUTED,
//    every time, from the active subscriptions whose plan has `bot` and whose `botGuildIds`
//    names the guild. So there is nothing to revoke: a subscription that is cancelled,
//    expired or past its period simply stops counting, and a webhook replayed twice changes
//    nothing because the row is keyed on the Stripe subscription id (unique). Idempotent by
//    construction rather than by a check someone has to remember.
//
// 3. The owner chooses the servers. A plan covers `bot.guilds` servers; its subscriber picks
//    them among the servers THEY manage (owner or Manage-Server, as the bot reports it), from
//    the dashboard. Checked server-side on every assignment; the id list is never taken from
//    the client unchecked.
//
// 4. The free tier is data, not code. What a server gets WITHOUT a plan is the admin setting
//    `bot.entitlements` ({ free: { features, limits }, unlimitedGuildIds }). Its default is
//    EVERYTHING at today's caps, so shipping this changes nothing for any server until the
//    owner decides which features become paid: a feature is "gated" exactly when the free
//    tier does not include it. `unlimitedGuildIds` are the platform's own servers (the ones
//    the top-level bot config is written for), which are never gated.
//
// 5. Enforced at BOTH ends, by the server. Where the config is written (the owner dashboard,
//    PUT /me/discord/guilds/:id, and Discord's /logs commands, PUT /bot/guilds/:id/features)
//    a patch that turns on a feature the guild is not entitled to, or goes past a limit, is
//    refused with 402 and the feature's name. Where the bot READS its config (GET /bot/config,
//    GET /bot/rolepanels) the served copy is filtered the same way, so a config written before
//    a plan lapsed, or by an admin, can never make the bot do more than the guild pays for.
//    The bot is not trusted with any of it: it receives the already-filtered config.
//
// 6. Turning something OFF is always allowed. A guild whose plan ended must be able to save
//    its settings with the paid feature disabled; refusing that would lock them out of their
//    own configuration for the crime of having stopped paying.
//
// Everything below is pure (no database) except loadEntitlementContext, so the rules are
// tested directly (test/bot-entitlements.test.mjs).

/** The features a plan can grant, in the order the admin editor and the public cards list
 *  them. Each maps onto one piece of the per-guild bot config (see gateGuildPatch). */
export const BOT_FEATURES = ['welcome', 'welcomeBanner', 'joinToCreate', 'gating', 'rolePanels', 'blog', 'automod', 'logRouting'];

/** The limits a plan can raise, with their HARD ceiling: the most the API schemas accept
 *  today (bot.mjs zod caps), so no plan can promise more than the config can hold. */
export const BOT_LIMITS = {
  joinToCreateLobbies: 20,
  gatingRules: 30,
  rolePanels: 20,
  blogRoutes: 20,
  automodWords: 500,
};

/** How many servers one plan can cover, at most. */
export const MAX_PLAN_GUILDS = 25;

/** The free tier when the admin has never set one: everything, at the hard caps (decision 4). */
export const DEFAULT_FREE = Object.freeze({ features: [...BOT_FEATURES], limits: { ...BOT_LIMITS } });

const SETTING_KEY = 'bot.entitlements';
export { SETTING_KEY as BOT_ENTITLEMENTS_KEY };

const int = (v, lo, hi) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo;
};

/** A tier ({ features, limits }) cleaned: unknown features dropped, limits clamped to the
 *  hard caps, missing limits = 0 (a plan that does not mention a limit does not raise it). */
export function normalizeTier(raw, { fillMissing = 0 } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const features = [...new Set((Array.isArray(r.features) ? r.features : []).map(String))].filter((f) => BOT_FEATURES.includes(f));
  const limits = {};
  for (const [k, cap] of Object.entries(BOT_LIMITS)) {
    const v = r.limits && r.limits[k] != null ? r.limits[k] : fillMissing === 'cap' ? cap : fillMissing;
    limits[k] = int(v, 0, cap);
  }
  return { features, limits };
}

/** A plan's `bot` column cleaned, or null when it grants nothing. `guilds` is at least 1. */
export function normalizePlanBot(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const tier = normalizeTier(raw);
  const guilds = int(raw.guilds ?? 1, 1, MAX_PLAN_GUILDS);
  if (!tier.features.length && !Object.values(tier.limits).some((n) => n > 0)) return null;
  return { guilds, ...tier };
}

/** The admin setting cleaned. Absent → DEFAULT_FREE (everything), per decision 4. */
export function normalizeSetting(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const free = r.free ? normalizeTier(r.free) : { features: [...DEFAULT_FREE.features], limits: { ...DEFAULT_FREE.limits } };
  const unlimitedGuildIds = [...new Set((Array.isArray(r.unlimitedGuildIds) ? r.unlimitedGuildIds : []).map(String))].filter((id) => /^\d{1,32}$/.test(id)).slice(0, 50);
  return { free, unlimitedGuildIds };
}

/** Does this subscription count right now? Active, not past its period. */
export function subCounts(sub, now = new Date()) {
  if (!sub || sub.status !== 'active') return false;
  if (sub.currentPeriodEnd && new Date(sub.currentPeriodEnd).getTime() <= new Date(now).getTime()) return false;
  return true;
}

/**
 * What one guild may use.
 *
 * @param guildId
 * @param ctx { setting, subs: [{ status, currentPeriodEnd, botGuildIds, plan: { name, bot } }] }
 * @returns { features: string[], limits: {k:n}, planFeatures: string[], plans: string[], unlimited }
 *   `planFeatures` are the ones granted by a plan and NOT by the free tier: the welcome-banner
 *   gate needs to know whether a plan paid for it (a plan counts as the banner's unlock).
 */
export function entitlementsFor(guildId, ctx = {}, now = new Date()) {
  const setting = normalizeSetting(ctx.setting);
  const gid = String(guildId || '');
  if (setting.unlimitedGuildIds.includes(gid)) {
    return { features: [...BOT_FEATURES], limits: { ...BOT_LIMITS }, planFeatures: [...BOT_FEATURES], plans: [], unlimited: true };
  }
  const features = new Set(setting.free.features);
  const limits = { ...setting.free.limits };
  const planFeatures = new Set();
  const plans = [];
  for (const sub of ctx.subs || []) {
    if (!subCounts(sub, now)) continue;
    if (!(sub.botGuildIds || []).map(String).includes(gid)) continue;
    const pb = normalizePlanBot(sub.plan?.bot);
    if (!pb) continue;
    plans.push(sub.plan?.name || '');
    for (const f of pb.features) { features.add(f); planFeatures.add(f); }
    for (const [k, v] of Object.entries(pb.limits)) limits[k] = Math.max(limits[k] || 0, v);
  }
  return { features: BOT_FEATURES.filter((f) => features.has(f)), limits, planFeatures: BOT_FEATURES.filter((f) => planFeatures.has(f)), plans, unlimited: false };
}

const has = (ent, f) => !!ent && ent.features.includes(f);
const lim = (ent, k) => (ent && ent.limits && ent.limits[k] != null ? ent.limits[k] : 0);
const len = (a) => (Array.isArray(a) ? a.length : 0);
/** A log config routes anything anywhere beyond the one plain channel? (the logRouting feature) */
const routesLogs = (L) => !!L && (String(L.forumId || '').trim() !== ''
  || Object.values(L.routes && typeof L.routes === 'object' ? L.routes : {}).some((v) => v !== 'off' && v?.kind !== 'off'));

/**
 * Check a config write against the guild's entitlements (decision 5, the write side).
 *
 * @param patch    the owner's parsed body: { welcome, joinToCreate, gating, moderation, logs,
 *                 rolePanels, blog }, any subset
 * @param current  the guild's CURRENT per-guild config (bot.config.guilds[id]), so a patch
 *                 that sends only part of a subtree is judged on the result, not the fragment
 * @param ent      entitlementsFor(...)
 * @param opts     { oldBgImage } the banner already saved (an unchanged one is not a new use)
 * @returns null when allowed, else { error: 'plan_required', feature } or
 *          { error: 'plan_limit', limit, max }
 */
export function gateGuildPatch(patch, current = {}, ent, { oldBgImage = '' } = {}) {
  const P = patch || {};
  const C = current || {};
  const next = (k) => ({ ...(C[k] || {}), ...(P[k] || {}) });
  const need = (feature) => ({ error: 'plan_required', feature });
  const over = (limit, n) => (n > lim(ent, limit) ? { error: 'plan_limit', limit, max: lim(ent, limit) } : null);

  if (P.welcome) {
    const w = next('welcome');
    if (w.enabled === true && !has(ent, 'welcome')) return need('welcome');
    if (P.welcome.bgImage && P.welcome.bgImage !== oldBgImage && !has(ent, 'welcomeBanner')) return need('welcomeBanner');
  }
  if (P.joinToCreate) {
    const j = next('joinToCreate');
    if (j.enabled === true && !has(ent, 'joinToCreate')) return need('joinToCreate');
    if (j.enabled !== false) { const e = over('joinToCreateLobbies', len(P.joinToCreate.lobbies)); if (e) return e; }
  }
  if (P.gating) {
    const g = next('gating');
    if (g.enabled === true && !has(ent, 'gating')) return need('gating');
    if (g.enabled !== false) { const e = over('gatingRules', len(P.gating.rules)); if (e) return e; }
  }
  if (P.moderation?.automod) {
    const a = { ...(C.moderation?.automod || {}), ...P.moderation.automod };
    if (a.enabled === true && !has(ent, 'automod')) return need('automod');
    if (a.enabled !== false) { const e = over('automodWords', len(P.moderation.automod.rules?.words?.patterns)); if (e) return e; }
  }
  if (P.logs && routesLogs(P.logs) && !has(ent, 'logRouting')) return need('logRouting');
  if (Array.isArray(P.rolePanels)) {
    const n = P.rolePanels.filter((x) => String(x?.channelId || '').trim()).length;
    if (n > 0 && !has(ent, 'rolePanels')) return need('rolePanels');
    const e = over('rolePanels', n); if (e) return e;
  }
  if (P.blog && Array.isArray(P.blog.routes)) {
    const n = P.blog.routes.filter((x) => String(x?.channelId || '').trim()).length;
    if (n > 0 && !has(ent, 'blog')) return need('blog');
    const e = over('blogRoutes', n); if (e) return e;
  }
  return null;
}

/**
 * One guild's EFFECTIVE feature config, cut down to what it may use (decision 5, the read
 * side). `eff` is what the bot would resolve for that guild (the guild's override, else the
 * top-level default, per feature). Returns only the features that had to change, so the
 * caller writes them into cfg.guilds[id] and leaves everything else untouched.
 */
export function restrictGuildConfig(eff, ent) {
  const out = {};
  const E = eff || {};
  if (E.welcome) {
    let w = E.welcome;
    if (w.enabled && !has(ent, 'welcome')) w = { ...w, enabled: false };
    if (w.bgImage && !has(ent, 'welcomeBanner')) w = { ...w, bgImage: '' };
    if (w !== E.welcome) out.welcome = w;
  }
  if (E.joinToCreate) {
    let j = E.joinToCreate;
    if (j.enabled && !has(ent, 'joinToCreate')) j = { ...j, enabled: false };
    if (len(j.lobbies) > lim(ent, 'joinToCreateLobbies')) j = { ...j, lobbies: j.lobbies.slice(0, lim(ent, 'joinToCreateLobbies')) };
    if (j !== E.joinToCreate) out.joinToCreate = j;
  }
  if (E.gating) {
    let g = E.gating;
    if (g.enabled && !has(ent, 'gating')) g = { ...g, enabled: false };
    if (len(g.rules) > lim(ent, 'gatingRules')) g = { ...g, rules: g.rules.slice(0, lim(ent, 'gatingRules')) };
    if (g !== E.gating) out.gating = g;
  }
  if (E.moderation?.automod) {
    let a = E.moderation.automod;
    if (a.enabled && !has(ent, 'automod')) a = { ...a, enabled: false };
    const words = a.rules?.words?.patterns;
    if (len(words) > lim(ent, 'automodWords')) a = { ...a, rules: { ...a.rules, words: { ...a.rules.words, patterns: words.slice(0, lim(ent, 'automodWords')) } } };
    if (a !== E.moderation.automod) out.moderation = { ...E.moderation, automod: a };
  }
  if (E.logs && routesLogs(E.logs) && !has(ent, 'logRouting')) out.logs = { ...E.logs, forumId: '', routes: {} };
  return out;
}

/** The features the bot resolves per guild (the bot's own PER_GUILD_FEATURES, config.mjs). */
const PER_GUILD = ['moderation', 'welcome', 'joinToCreate', 'gating', 'logs'];

/**
 * The whole served config, filtered for every guild the bot is in. `guildIds` are the known
 * guilds (BotGuild rows). Role panels and blog routes carry a guildId each and are cut to the
 * guild's limit, in their saved order.
 */
export function applyEntitlementsToConfig(cfg, guildIds, entOf) {
  if (!cfg || typeof cfg !== 'object') return cfg;
  const guilds = { ...(cfg.guilds || {}) };
  for (const gid of guildIds) {
    const ent = entOf(gid);
    if (ent.unlimited) continue;
    const over = guilds[gid] || {};
    const eff = {};
    for (const f of PER_GUILD) eff[f] = over[f] !== undefined ? over[f] : cfg[f];
    const cut = restrictGuildConfig(eff, ent);
    if (Object.keys(cut).length) guilds[gid] = { ...over, ...cut };
  }
  const out = { ...cfg, guilds };
  if (Array.isArray(cfg.blog?.routes)) out.blog = { ...cfg.blog, routes: limitPerGuild(cfg.blog.routes, 'blog', 'blogRoutes', entOf) };
  return out;
}

/** Keep, per guild, only as many entries as it may have (entries without a guildId are the
 *  admin's own and pass untouched). Used for blog routes and role panels. */
export function limitPerGuild(list, feature, limit, entOf) {
  const seen = {};
  return (list || []).filter((x) => {
    if (!x || !x.guildId) return true;
    const ent = entOf(String(x.guildId));
    if (ent.unlimited) return true;
    if (!has(ent, feature)) return false;
    seen[x.guildId] = (seen[x.guildId] || 0) + 1;
    return seen[x.guildId] <= lim(ent, limit);
  });
}

/**
 * The database half: the admin setting and every subscription that can grant anything.
 * Returns a memoised entOf(guildId) as well, for the routes that filter many guilds at once.
 */
export async function loadEntitlementContext(p, now = new Date()) {
  const [row, subs] = await Promise.all([
    p.adminSetting.findUnique({ where: { key: SETTING_KEY } }).catch(() => null),
    p.subscription.findMany({
      where: { status: 'active', botGuildIds: { isEmpty: false } },
      select: { id: true, status: true, currentPeriodEnd: true, botGuildIds: true, plan: { select: { name: true, bot: true } } },
      take: 20000,
    }).catch(() => []),
  ]);
  const ctx = { setting: row?.value || null, subs };
  const memo = new Map();
  const entOf = (gid) => {
    const k = String(gid);
    if (!memo.has(k)) memo.set(k, entitlementsFor(k, ctx, now));
    return memo.get(k);
  };
  return { ctx, entOf };
}
