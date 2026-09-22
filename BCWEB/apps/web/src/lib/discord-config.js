// The per-server bot config, as data: the rule names, the thresholds and their bounds, the
// 23 log categories in their 8 groups, and the pure functions that read whatever was saved.
//
// Out of discord-automod.jsx on purpose. `node --test` cannot import a .jsx, and these are
// exactly the parts that must be right: `resolveLogRoute()` is a second copy of
// `resolveRoute()` in apps/bot/src/features/logs.mjs, with the same order and the same
// fallbacks, because every row of the log screen states the destination it resolves to right
// now. test/discord-logs.test.mjs pins that order against the bot's.
//
// The editors in pages/discord-automod.jsx import all of this and re-export it, so every
// caller keeps one address for the whole vocabulary.

// ── The vocabulary (mirrors the bot) ──────────────────────────────────────────────────────
// addRole / removeRole: give the member a role the server set up (a muted or read-only one) for
// `roleMin` minutes, or take one away. Message rules only; the join rules keep their own lists.
export const AUTOMOD_ACTIONS = ['log', 'delete', 'warn', 'timeout', 'kick', 'ban', 'addRole', 'removeRole'];
/** The actions that need a `roleId` to mean anything. Without one the bot deletes instead. */
export const ROLE_ACTIONS = ['addRole', 'removeRole'];
export const JOIN_ACTIONS = ['log', 'kick', 'ban', 'quarantine', 'timeout'];
export const RAID_ACTIONS = ['log', 'timeout', 'kick', 'ban'];
export const AUTOMOD_RULES = ['spam', 'mentions', 'invites', 'links', 'words', 'caps', 'zalgo', 'attachments', 'accountAge', 'selfbot', 'raid'];
// The two join-time rules have no message to delete and no channel of their own to be exempt
// in, so `delete` / `warn` / per-rule exemptions do not apply to them.
export const JOIN_RULES = ['accountAge', 'raid'];
// LADDER_ACTIONS in the bot's automod.mjs / WARN_ACTIONS in the API's lib/warns.mjs.
export const LADDER_ACTIONS = ['log', 'delete', 'warn', 'timeout', 'kick', 'ban', 'quarantine'];
const LADDER_TIMED = ['timeout', 'quarantine'];

// DEFAULT_AUTOMOD in the bot, copied. If the bot's defaults move, move these.
// countsAsWarn / warnEvery / warnWindowMin: a hit also counts toward the shared warn ladder,
// from the Nth hit of this rule by this member within warnWindowMin minutes (the bot's
// warnPolicy). roleId / roleMin: the role the addRole / removeRole actions give or take.
const MSG_PARAMS = { deleteMessage: true, dm: false, logOnly: false, countsAsWarn: false, warnEvery: 1, warnWindowMin: 60, roleId: '', roleMin: 0 };
const JOIN_PARAMS = { dm: false, logOnly: false };
export const AUTOMOD_DEFAULTS = {
  enabled: true,
  exempt: { roles: [], channels: [], users: [], moderators: true },
  warnDecayHours: 168,
  rules: {
    spam: { enabled: true, action: 'timeout', timeoutMin: 10, maxMessages: 6, windowSec: 5, maxRepeats: 3, repeatWindowSec: 30, ...MSG_PARAMS },
    mentions: { enabled: true, action: 'timeout', timeoutMin: 60, maxUsers: 6, maxRoles: 3, everyone: false, ...MSG_PARAMS },
    invites: { enabled: true, action: 'delete', allowGuilds: [], allowCodes: [], ...MSG_PARAMS },
    links: { enabled: false, action: 'delete', allowDomains: [], ...MSG_PARAMS },
    words: { enabled: false, action: 'delete', patterns: [], ...MSG_PARAMS },
    caps: { enabled: false, action: 'delete', ratio: 0.7, minLetters: 12, ...MSG_PARAMS },
    zalgo: { enabled: true, action: 'delete', maxCombining: 6, maxRatio: 0.3, ...MSG_PARAMS },
    attachments: { enabled: true, action: 'delete', allowTypes: [], blockTypes: ['exe', 'bat', 'cmd', 'scr', 'msi', 'ps1', 'vbs', 'jar', 'com', 'dll', 'hta', 'lnk'], ...MSG_PARAMS },
    accountAge: { enabled: false, action: 'kick', minDays: 7, timeoutMin: 1440, ...JOIN_PARAMS },
    selfbot: { enabled: true, action: 'kick', channelsPerWindow: 3, windowSec: 5, identicalAcrossSec: 10, maxPerMinute: 40, ...MSG_PARAMS },
    raid: { enabled: true, action: 'timeout', timeoutMin: 60, joins: 10, windowSec: 30, lockdownMin: 15, raiseVerification: true, alert: true, ...JOIN_PARAMS },
  },
};
export const LADDER_DEFAULTS = [
  { count: 3, action: 'timeout', minutes: 60 },
  { count: 5, action: 'kick' },
  { count: 7, action: 'ban' },
];

// Every threshold a rule has, with the bounds the API enforces (routes/bot.mjs). `int` fields
// are rounded; a value outside its bounds is clamped rather than refused, because the server
// would refuse the WHOLE save over one field and say only "invalid_input".
const N = (k, min, max, opt = {}) => ({ k, kind: 'num', min, max, int: opt.int !== false, step: opt.step });
const B = (k) => ({ k, kind: 'bool' });
const L = (k, max = 100) => ({ k, kind: 'list', max });
export const RULE_FIELDS = {
  spam: [N('timeoutMin', 1, 40320), N('maxMessages', 1, 100), N('windowSec', 1, 600), N('maxRepeats', 2, 50), N('repeatWindowSec', 1, 3600)],
  mentions: [N('timeoutMin', 1, 40320), N('maxUsers', 1, 100), N('maxRoles', 1, 100), B('everyone')],
  invites: [N('timeoutMin', 1, 40320), L('allowGuilds'), L('allowCodes')],
  links: [N('timeoutMin', 1, 40320), L('allowDomains', 200)],
  words: [N('timeoutMin', 1, 40320), L('patterns', 500)],
  caps: [N('timeoutMin', 1, 40320), N('ratio', 0, 1, { int: false, step: 0.05 }), N('minLetters', 1, 4000)],
  zalgo: [N('timeoutMin', 1, 40320), N('maxCombining', 1, 1000), N('maxRatio', 0, 1, { int: false, step: 0.05 })],
  attachments: [N('timeoutMin', 1, 40320), L('allowTypes'), L('blockTypes')],
  accountAge: [N('minDays', 0, 3650, { int: false, step: 0.5 }), N('timeoutMin', 1, 40320)],
  selfbot: [N('timeoutMin', 1, 40320), N('channelsPerWindow', 2, 50), N('windowSec', 1, 600), N('identicalAcrossSec', 1, 3600), N('maxPerMinute', 1, 1000)],
  raid: [N('timeoutMin', 1, 40320), N('joins', 2, 1000), N('windowSec', 1, 3600), N('lockdownMin', 1, 1440), B('raiseVerification'), B('alert')],
};
const FIELD = (rule, k) => RULE_FIELDS[rule].find((f) => f.k === k);
// The per-rule parameters every MESSAGE rule carries, with the bounds MSG_RULE_PARAMS in the
// API's routes/bot.mjs enforces. Not in RULE_FIELDS because they are not thresholds: they say
// what a hit costs, not what counts as one.
export const MSG_PARAM_FIELDS = {
  warnEvery: { k: 'warnEvery', kind: 'num', min: 1, max: 50, int: true },
  warnWindowMin: { k: 'warnWindowMin', kind: 'num', min: 0, max: 43200, int: true },
  roleMin: { k: 'roleMin', kind: 'num', min: 0, max: 40320, int: true },
};
/** A Discord snowflake, or '' — the bot drops anything else (automod.mjs normalizeAutomod). */
const snowflake = (v) => { const s = String(v ?? '').trim(); return /^\d{5,32}$/.test(s) ? s : ''; };
export const actionsFor = (rule) => (rule === 'accountAge' ? JOIN_ACTIONS : rule === 'raid' ? RAID_ACTIONS : AUTOMOD_ACTIONS);

// CATEGORIES / GROUPS in the bot's logs.mjs, copied — the routing keys the dashboard renders.
export const LOG_GROUPS = ['messages', 'members', 'voice', 'automod', 'moderation', 'server', 'bot', 'economy'];
export const LOG_CATEGORIES = {
  'messages.delete': 'messages', 'messages.edit': 'messages', 'messages.bulk': 'messages',
  'members.join': 'members', 'members.leave': 'members', 'members.kick': 'members', 'members.ban': 'members',
  'members.unban': 'members', 'members.timeout': 'members', 'members.nick': 'members', 'members.roles': 'members',
  voice: 'voice',
  automod: 'automod',
  modcmd: 'moderation',
  'server.channels': 'server', 'server.roles': 'server', 'server.emoji': 'server', 'server.webhooks': 'server',
  'bot.errors': 'bot', 'bot.config': 'bot',
  'economy.casino': 'economy', 'economy.shop': 'economy', 'economy.season': 'economy',
};
export const LOG_CATEGORY_KEYS = Object.keys(LOG_CATEGORIES);
// The default forum tag a group's posts wear (GROUPS in the bot's logs.mjs — tag names, not
// ids, matched case-insensitively against the forum's own tags).
export const LOG_GROUP_TAG = { messages: 'Messages', members: 'Members', voice: 'Voice', automod: 'Automod', moderation: 'Moderation', server: 'Server', bot: 'Bot', economy: 'Economy' };
export const LOGS_DEFAULTS = { enabled: true, forumId: '', channelId: '', forumMode: 'category', reaction: '', pinSummary: true, routes: {} };

// ── Normalisation ─────────────────────────────────────────────────────────────────────────
export const clamp = (v, f, d) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return d;
  const c = Math.min(f.max, Math.max(f.min, n));
  return f.int ? Math.round(c) : Math.round(c * 1000) / 1000;
};
const strList = (v, max = 100) => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, max) : []);
const idList = (v) => strList(v).map((x) => x.replace(/[^0-9]/g, '')).filter(Boolean);

/** Whatever was stored under moderation.automod → the full shape, bounds applied. */
export function normAutomod(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const ex = r.exempt && typeof r.exempt === 'object' ? r.exempt : {};
  const rules = {};
  for (const name of AUTOMOD_RULES) {
    const d = AUTOMOD_DEFAULTS.rules[name];
    const s = r.rules && r.rules[name] && typeof r.rules[name] === 'object' ? r.rules[name] : {};
    const out = { enabled: typeof s.enabled === 'boolean' ? s.enabled : d.enabled };
    const acts = actionsFor(name);
    out.action = acts.includes(s.action) ? s.action : d.action;
    for (const f of RULE_FIELDS[name]) {
      const dv = d[f.k];
      if (f.kind === 'num') out[f.k] = clamp(s[f.k] ?? dv ?? f.min, f, dv ?? f.min);
      else if (f.kind === 'bool') out[f.k] = typeof s[f.k] === 'boolean' ? s[f.k] : dv;
      else out[f.k] = strList(s[f.k] ?? dv, f.max);
    }
    // The parameters every rule carries. Absent = the bot's default, which is what a rule
    // saved before these existed gets — it keeps behaving exactly as it did.
    out.dm = typeof s.dm === 'boolean' ? s.dm : d.dm;
    out.logOnly = typeof s.logOnly === 'boolean' ? s.logOnly : d.logOnly;
    if (!JOIN_RULES.includes(name)) {
      out.deleteMessage = typeof s.deleteMessage === 'boolean' ? s.deleteMessage : d.deleteMessage;
      const re = s.exempt && typeof s.exempt === 'object' ? s.exempt : {};
      out.exempt = { roles: idList(re.roles), channels: idList(re.channels) };
      // Progressive warnings and the role actions. These must survive the round trip: this
      // function is also what the dashboard SENDS, so a field it does not copy here is a field
      // every save silently deletes (test/discord-automod.test.mjs pins that).
      out.countsAsWarn = typeof s.countsAsWarn === 'boolean' ? s.countsAsWarn : d.countsAsWarn;
      for (const k of ['warnEvery', 'warnWindowMin', 'roleMin']) out[k] = clamp(s[k] ?? d[k], MSG_PARAM_FIELDS[k], d[k]);
      out.roleId = snowflake(s.roleId);
    }
    rules[name] = out;
  }
  return {
    enabled: r.enabled !== false,
    exempt: { roles: idList(ex.roles), channels: idList(ex.channels), users: idList(ex.users), moderators: ex.moderators !== false },
    warnDecayHours: clamp(r.warnDecayHours ?? AUTOMOD_DEFAULTS.warnDecayHours, { min: 0, max: 8760, int: true }, AUTOMOD_DEFAULTS.warnDecayHours),
    rules,
  };
}

/**
 * Whatever was stored under moderation.warnThresholds → a clean ladder, sorted by count, at
 * most one step per count. Nothing saved = the bot's own default, because that is what the
 * bot uses and the screen must show the truth rather than an empty list.
 */
export function normLadder(raw) {
  const list = Array.isArray(raw) && raw.length ? raw : LADDER_DEFAULTS;
  const seen = new Set();
  return list
    .map((t) => ({
      count: clamp(t?.count, { min: 1, max: 1000, int: true }, 0),
      action: LADDER_ACTIONS.includes(String(t?.action || '').toLowerCase()) ? String(t.action).toLowerCase() : 'timeout',
      minutes: clamp(t?.minutes ?? 60, { min: 1, max: 40320, int: true }, 60),
    }))
    .filter((t) => { if (t.count < 1 || seen.has(t.count)) return false; seen.add(t.count); return true; })
    .sort((a, b) => a.count - b.count);
}
/** What is sent: `minutes` only where the action actually takes one. */
export const ladderForSave = (v) => normLadder(v).map((t) => (LADDER_TIMED.includes(t.action) ? { count: t.count, action: t.action, minutes: t.minutes } : { count: t.count, action: t.action }));

/** Whatever was stored under `logs` → the full shape. Routes keep only known keys. */
export function normLogs(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const routes = {};
  for (const [k, v] of Object.entries(r.routes && typeof r.routes === 'object' ? r.routes : {})) {
    if (!LOG_CATEGORIES[k] && !LOG_GROUPS.includes(k)) continue;
    if (v === 'off' || v?.kind === 'off') { routes[k] = { kind: 'off', id: '', tags: [] }; continue; }
    if (typeof v === 'string') { if (v.trim()) routes[k] = { kind: 'channel', id: v.trim(), tags: [] }; continue; }
    if (v && typeof v === 'object' && (v.kind === 'forum' || v.kind === 'channel')) {
      routes[k] = { kind: v.kind, id: String(v.id || '').trim(), tags: strList(v.tags, 5) };
    }
  }
  return {
    enabled: r.enabled !== false,
    forumId: String(r.forumId || '').trim(), channelId: String(r.channelId || '').trim(),
    forumMode: r.forumMode === 'day' ? 'day' : 'category',
    reaction: String(r.reaction || '').trim().slice(0, 64),
    pinSummary: r.pinSummary !== false,
    routes,
  };
}

/** What is sent: the normalised shape, minus routes that name no channel (they route nowhere). */
export function logsForSave(v) {
  const n = normLogs(v);
  const routes = {};
  for (const [k, r] of Object.entries(n.routes)) {
    if (r.kind === 'off') routes[k] = 'off';
    else if (r.id) routes[k] = r.kind === 'forum' ? { kind: 'forum', id: r.id, tags: r.tags } : { kind: 'channel', id: r.id };
  }
  return { ...n, routes };
}

/**
 * WHERE A CATEGORY ACTUALLY LANDS. resolveRoute() in the bot's features/logs.mjs, written
 * once more here — the same order, the same fallbacks, the same `from`. This is the whole
 * point of the log screen: a row that says "Default" says nothing, and the only way to say
 * something is to run the rule.
 *
 * `legacyChannelId` is the moderation log channel set elsewhere on the dashboard
 * (BotGuild.logChannelId), which the bot treats as the last fallback.
 */
export function resolveLogRoute(logs, key, { legacyChannelId = '' } = {}) {
  const v = normLogs(logs);
  const group = LOG_CATEGORIES[key] || (LOG_GROUPS.includes(key) ? key : null);
  const off = (from) => ({ kind: 'off', id: '', tags: [], from });
  if (!group) return off('unknown');
  if (!v.enabled) return off('disabled');
  const tag = LOG_GROUP_TAG[group];
  const take = (r, from) => (r.kind === 'off' ? off(from) : { kind: r.kind, id: r.id, tags: r.kind === 'forum' ? (r.tags.length ? r.tags : [tag]) : [], from });
  // Its own route wins over its group's, both win over the screen's defaults. A group row
  // asks about the group, so it skips the first step.
  const chain = LOG_CATEGORIES[key] ? [[key, 'own'], [group, 'group']] : [[group, 'own']];
  for (const [k, from] of chain) {
    const r = v.routes[k];
    if (r && (r.kind === 'off' || r.id)) return take(r, from);
  }
  if (v.forumId) return { kind: 'forum', id: v.forumId, tags: [tag], from: 'forum' };
  if (v.channelId) return { kind: 'channel', id: v.channelId, tags: [], from: 'channel' };
  if (legacyChannelId) return { kind: 'channel', id: legacyChannelId, tags: [], from: 'modlog' };
  return off('nothing');
}

