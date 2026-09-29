// Automod: data-driven rules, deterministic decisions, Discord kept at arm's length.
//
// Everything that DECIDES lives in pure functions that take plain objects (a message shape,
// a state object, the normalised config) and return a list of actions. Nothing in that half
// touches discord.js, so every rule, the escalation ladder, the exemption list, the selfbot
// heuristic and raid detection are unit-tested in test/automod.test.mjs without a gateway.
// The bottom of the file is the thin Discord side: turn a Message / GuildMember into the
// plain shape, run the decision, carry the actions out, hand the outcome to logs.mjs.
//
// ── CONFIG SHAPE (per guild: `moderation.automod`, replaced wholesale by
//    `guilds[guildId].moderation` like the rest of `moderation`) ──────────────────────────
//
//   moderation: {
//     enabled: true,                       // the whole moderation feature (existing)
//     warnThresholds: [                    // the escalation ladder — SHARED with /warn and the
//       { count: 3, action: 'timeout', minutes: 60 },   //   admin screen (lib/warns.mjs reads
//       { count: 5, action: 'kick' },      //   this same key). Exact-count match: the warning
//       { count: 7, action: 'ban' },       //   that crosses a line fires, later ones do not.
//     ],                                   //   action ∈ LADDER_ACTIONS (see below)
//     automod: {
//       enabled: true,
//       // Who and where the rules never apply. Moderators (Manage Messages / Manage Guild /
//       // Administrator) are exempt unless `moderators: false`.
//       exempt: { roles: [], channels: [], users: [], moderators: true },
//       // Local warn memory (used when the site cannot be reached and for the pure engine):
//       // a warning older than decayHours no longer counts toward the ladder. 0 = never decays.
//       warnDecayHours: 168,
//       // Every rule: { enabled, action, ...thresholds, ...parameters }. `action` is one of
//       //   'log'      record it, touch nothing
//       //   'delete'   delete the message (message rules only)
//       //   'warn'     delete + a recorded warning (the ladder may escalate it)
//       //   'timeout'  delete + timeout for `timeoutMin` minutes
//       //   'kick'     delete + kick
//       //   'ban'      delete + ban
//       //   'addRole'  delete + give the member `roleId` (a muted / read-only role the server
//       //              set up) for `roleMin` minutes, 0 = until a moderator removes it
//       //   'removeRole' delete + take `roleId` away (e.g. the "verified" role)
//       //   (Read-only everywhere is what Discord's own timeout already is: the member reads
//       //   but cannot post, react, speak or join voice, and Discord lifts it itself.)
//       //
//       // PARAMETERS every rule also accepts, all optional and all defaulted so a rule saved
//       // as nothing but `{ enabled, action }` keeps behaving exactly as it did:
//       //   deleteMessage: true    message rules only — the action deletes the message. false
//       //                          punishes without removing the evidence. 'log' never deletes.
//       //   dm: false              the member is told by DM what fired and what it cost them.
//       //   logOnly: false         carry NOTHING out: the rule still fires and still lands in
//       //                          the log, but the action is downgraded to 'log'. A way to
//       //                          watch a rule for a week before letting it bite.
//       //   exempt: { roles: [], channels: [] }   message rules only — on TOP of the global
//       //                          exemption list above, never instead of it.
//       //   countsAsWarn: false    message rules only — a hit also counts toward the SHARED
//       //                          warn ladder (the same site record /warn writes). Always on
//       //                          for action 'warn'.
//       //   warnEvery: 1           …from which hit: every Nth hit of THIS rule by THIS member
//       //                          within warnWindowMin records one warning. 3 = the first two
//       //                          hits cost only the action, the third is a warning, the
//       //                          sixth another. 1 = every hit (the old behaviour).
//       //   warnWindowMin: 60      how long a hit is remembered for that count (0 = until the
//       //                          bot restarts). In memory: a restart forgets pending strikes,
//       //                          never recorded warnings.
//       rules: {
//         spam:        { enabled: true,  action: 'timeout', timeoutMin: 10, maxMessages: 6, windowSec: 5, maxRepeats: 3, repeatWindowSec: 30 },
//         mentions:    { enabled: true,  action: 'timeout', timeoutMin: 60, maxUsers: 6, maxRoles: 3, everyone: false },
//         invites:     { enabled: true,  action: 'delete', allowGuilds: [], allowCodes: [] },   // own server is always allowed
//         links:       { enabled: false, action: 'delete', allowDomains: [] },                  // empty allow-list = every link
//         words:       { enabled: false, action: 'delete', patterns: [] },  // 'word' whole word · 'pre*' · '*mid*' · '/regex/i'
//         caps:        { enabled: false, action: 'delete', ratio: 0.7, minLetters: 12 },
//         zalgo:       { enabled: true,  action: 'delete', maxCombining: 6, maxRatio: 0.3 },
//         attachments: { enabled: true,  action: 'delete', allowTypes: [], blockTypes: ['exe','bat','cmd','scr','msi','ps1','vbs','jar','com','dll','hta','lnk'] },
//         accountAge:  { enabled: false, action: 'kick', minDays: 7, timeoutMin: 1440 },         // on join; action ∈ log|kick|ban|quarantine(=timeout for timeoutMin)
//         selfbot:     { enabled: true,  action: 'kick', channelsPerWindow: 3, windowSec: 5, identicalAcrossSec: 10, maxPerMinute: 40 },
//         raid:        { enabled: true,  action: 'timeout', timeoutMin: 60, joins: 10, windowSec: 30, lockdownMin: 15, raiseVerification: true, alert: true },
//       },
//       // laya (agent-laya-bcweb): the AI-assisted check, a PAID feature (entitlement
//       // `aiAutomod`, enforced by the API both where the config is written and where the bot
//       // reads it). NOT one of `rules`: its actions are capped, and it is asked only when no
//       // rule above fired. Rules first: the deterministic phishing check (phishingSignals)
//       // runs inside evaluateMessage and may use any action (`rulesAction`); only the grey
//       // zone goes to the API (POST /bot/ai/automod), with a hard timeout, and an AI verdict
//       // costs at most `action` ∈ log | delete | warn — a signal is never a kick or a ban.
//       ai: { enabled: false, action: 'log', phishing: true, troll: false, phishingThreshold: 0.9,
//             trollThreshold: 0.92, minChars: 12, rulesAction: 'delete', timeoutMin: 10, ...message-rule params },
//     },
//   }
//
// Every threshold is a number the admin dashboard can render as a field; every action is a
// string from ACTIONS; every list is an array of ids or strings. `normalizeAutomod(raw)` turns
// whatever was saved into this shape with the defaults filled in — the engine only ever sees
// a normalised config. Nothing here is required: an older config that has only some of these
// keys (or a rule with no keys at all) normalises to the same defaults it always did.
//
// ── DECISIONS ──────────────────────────────────────────────────────────────────────────────
//
//   evaluateMessage(message, state, cfg) → actions[]
//   evaluateJoin(member, state, cfg)     → actions[]
//   escalationFor(count, ladder)         → { kind, minutes } | null
//
// `message` is a plain shape (see toPlainMessage): { id, guildId, channelId, authorId, bot,
//   content, createdAt, mentions: { users, roles, everyone }, attachments: [{ name, contentType }],
//   memberRoles: [], isModerator, inviteGuilds: { code: guildId } }.
// `state` is what createState() returns — per-guild memory of recent messages, joins,
//   warnings and the lockdown clock. The engine reads and updates it; nothing else does.
// An action: { rule, action, reason, deleteMessage, timeoutMin, dm, meta }.
// `strongest(actions)` picks the one to carry out when several rules fire at once — the
//   most severe wins, they are never stacked.

import { PermissionFlagsBits } from 'discord.js';
import { domainToUnicode } from 'node:url';
import { guildConfig, config } from '../config.mjs';
import { makeT, localeOf } from '../i18n.mjs';
import { api } from '../api.mjs';
import { BRANDS } from './brands.generated.mjs';
import { modStats } from '../store.mjs';

export const ACTIONS = ['log', 'delete', 'warn', 'timeout', 'kick', 'ban', 'addRole', 'removeRole'];
// A role taken away sits between a warning and a timeout; a restrictive role given is a timeout
// the server shaped itself, so it ranks just under one (a timeout AND a mute role firing on the
// same message → the timeout).
const SEVERITY = { log: 0, delete: 1, warn: 2, removeRole: 2.5, addRole: 2.8, timeout: 3, kick: 4, ban: 5, quarantine: 3, lockdown: 3 };
export const RULES = ['spam', 'mentions', 'invites', 'links', 'words', 'caps', 'zalgo', 'attachments', 'accountAge', 'selfbot', 'raid'];
/** The rules that judge a MESSAGE. The other two judge a join, so they have nothing to delete
 *  and no channel/role of their own to be exempt in. */
export const MESSAGE_RULES = ['spam', 'mentions', 'invites', 'links', 'words', 'caps', 'zalgo', 'attachments', 'selfbot'];
/** What a step of the warn ladder may do. 'log', 'delete' and 'warn' are the written-down
 *  no-ops (a step that exists and bites nothing); 'quarantine' is a timeout under another name,
 *  kept because that is what the per-rule join action calls it. */
export const LADDER_ACTIONS = ['log', 'delete', 'warn', 'timeout', 'kick', 'ban', 'quarantine'];
const LADDER_NOOPS = ['log', 'delete', 'warn'];

// Parameters every rule accepts on top of its own thresholds. Merged into the defaults below
// so normalizeAutomod fills them in for a rule that was saved without them.
const COMMON_PARAMS = { dm: false, logOnly: false };
const MSG_PARAMS = { ...COMMON_PARAMS, deleteMessage: true, countsAsWarn: false, warnEvery: 1, warnWindowMin: 60, roleId: '', roleMin: 0 };

export const DEFAULT_AUTOMOD = {
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
    accountAge: { enabled: false, action: 'kick', minDays: 7, timeoutMin: 1440, ...COMMON_PARAMS },
    selfbot: { enabled: true, action: 'kick', channelsPerWindow: 3, windowSec: 5, identicalAcrossSec: 10, maxPerMinute: 40, ...MSG_PARAMS },
    raid: { enabled: true, action: 'timeout', timeoutMin: 60, joins: 10, windowSec: 30, lockdownMin: 15, raiseVerification: true, alert: true, ...COMMON_PARAMS },
  },
};
// laya (agent-laya-bcweb): the AI-assisted check. See the config shape at the top.
export const AI_ACTIONS = ['log', 'delete', 'warn'];
export const DEFAULT_AI = { enabled: false, action: 'log', phishing: true, troll: false, phishingThreshold: 0.9, trollThreshold: 0.92, minChars: 12, rulesAction: 'delete', timeoutMin: 10, ...MSG_PARAMS };
// fin laya (agent-laya-bcweb)
export const DEFAULT_LADDER = [
  { count: 3, action: 'timeout', minutes: 60 },
  { count: 5, action: 'kick' },
  { count: 7, action: 'ban' },
];

// ── Normalisation ─────────────────────────────────────────────────────────────────────────
const num = (v, d, min = 0) => { const n = Number(v); return Number.isFinite(n) && n >= min ? n : d; };
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const strList = (v, max = 200) => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, max) : []);
const JOIN_ACTIONS = ['log', 'kick', 'ban', 'quarantine', 'timeout'];

/** The saved `moderation.automod` (any shape, or nothing) → the full shape above. */
export function normalizeAutomod(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const rules = {};
  for (const name of RULES) {
    const d = DEFAULT_AUTOMOD.rules[name];
    const s = r.rules && typeof r.rules[name] === 'object' && r.rules[name] ? r.rules[name] : {};
    const out = { ...d };
    for (const [k, dv] of Object.entries(d)) {
      if (!(k in s)) continue;
      if (Array.isArray(dv)) out[k] = strList(s[k]).map((x) => x.toLowerCase());
      else if (typeof dv === 'boolean') out[k] = bool(s[k], dv);
      else if (typeof dv === 'number') out[k] = num(s[k], dv, 0);
      else if (k === 'roleId') out[k] = /^\d{5,32}$/.test(String(s[k] ?? '').trim()) ? String(s[k]).trim() : '';
      else if (k === 'action') {
        const a = String(s[k] || '').toLowerCase();
        const ok = name === 'accountAge' ? JOIN_ACTIONS : name === 'raid' ? ['log', 'timeout', 'kick', 'ban'] : ACTIONS;
        // Case-insensitive, returned in its canonical spelling: `addRole` is camelCase and a
        // lower-cased comparison would drop it back to the default.
        out[k] = ok.find((x) => x.toLowerCase() === a) || dv;
      }
    }
    if (name === 'words') out.patterns = strList(s.patterns, 500); // case is the pattern's business
    if (MESSAGE_RULES.includes(name)) {
      out.warnEvery = Math.max(1, Math.min(50, Math.floor(out.warnEvery) || 1));
      out.warnWindowMin = Math.floor(out.warnWindowMin);
      // A role action with no role cannot be carried out; it falls back to deleting, which is
      // what the rule would at least have done, rather than silently doing nothing.
      if ((out.action === 'addRole' || out.action === 'removeRole') && !out.roleId) out.action = 'delete';
    }
    // Per-rule exemptions: roles and channels this rule alone ignores, ON TOP of the global
    // list. Only message rules have them — a join has no channel and no roles yet.
    if (MESSAGE_RULES.includes(name)) {
      const re = s.exempt && typeof s.exempt === 'object' ? s.exempt : {};
      out.exempt = { roles: strList(re.roles), channels: strList(re.channels) };
    }
    rules[name] = out;
  }
  const ex = r.exempt && typeof r.exempt === 'object' ? r.exempt : {};
  return {
    enabled: bool(r.enabled, DEFAULT_AUTOMOD.enabled),
    exempt: { roles: strList(ex.roles), channels: strList(ex.channels), users: strList(ex.users), moderators: bool(ex.moderators, true) },
    warnDecayHours: num(r.warnDecayHours, DEFAULT_AUTOMOD.warnDecayHours, 0),
    rules,
    ai: normalizeAi(r.ai),
  };
}

/** laya (agent-laya-bcweb): the saved `automod.ai` → the full shape, every value bounded. */
export function normalizeAi(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_AI;
  const clamp01 = (v, dv) => { const n = Number(v); return Number.isFinite(n) ? Math.min(0.99, Math.max(0.5, n)) : dv; };
  const re = s.exempt && typeof s.exempt === 'object' ? s.exempt : {};
  const out = {
    enabled: bool(s.enabled, d.enabled),
    action: AI_ACTIONS.find((a) => a === String(s.action || '').toLowerCase()) || d.action,
    phishing: bool(s.phishing, d.phishing),
    troll: bool(s.troll, d.troll),
    phishingThreshold: clamp01(s.phishingThreshold, d.phishingThreshold),
    trollThreshold: clamp01(s.trollThreshold, d.trollThreshold),
    minChars: Math.max(1, Math.min(2000, Math.floor(num(s.minChars, d.minChars, 1)))),
    rulesAction: ACTIONS.find((a) => a.toLowerCase() === String(s.rulesAction || '').toLowerCase()) || d.rulesAction,
    timeoutMin: num(s.timeoutMin, d.timeoutMin, 1),
    dm: bool(s.dm, d.dm), logOnly: bool(s.logOnly, d.logOnly), deleteMessage: bool(s.deleteMessage, d.deleteMessage),
    countsAsWarn: bool(s.countsAsWarn, d.countsAsWarn),
    warnEvery: Math.max(1, Math.min(50, Math.floor(num(s.warnEvery, d.warnEvery, 1)) || 1)),
    warnWindowMin: Math.floor(num(s.warnWindowMin, d.warnWindowMin, 0)),
    roleId: /^\d{5,32}$/.test(String(s.roleId ?? '').trim()) ? String(s.roleId).trim() : '',
    roleMin: num(s.roleMin, d.roleMin, 0),
    exempt: { roles: strList(re.roles), channels: strList(re.channels) },
  };
  // A role action with no role falls back to deleting, like every message rule.
  if ((out.rulesAction === 'addRole' || out.rulesAction === 'removeRole') && !out.roleId) out.rulesAction = 'delete';
  return out;
}

/**
 * The ladder, highest count first, dropping what cannot be honoured (same rule as
 * lib/warns.mjs). Two steps on the same count would both be "the" step for it, so the first
 * one written wins and the rest are dropped — otherwise which one fires depends on sort order.
 */
export function normalizeLadder(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  return list
    .map((t) => ({ count: Math.floor(Number(t?.count)), action: String(t?.action || '').toLowerCase(), minutes: t?.minutes == null ? null : Math.max(1, Math.floor(Number(t.minutes))) }))
    .filter((t) => Number.isFinite(t.count) && t.count >= 1 && LADDER_ACTIONS.includes(t.action))
    .filter((t) => { if (seen.has(t.count)) return false; seen.add(t.count); return true; })
    .sort((a, b) => b.count - a.count);
}

/**
 * What the warning that brought the total to `count` triggers — exact match, never stacked.
 * A no-op step ('log', 'delete', 'warn') is a line written down that costs the member nothing,
 * and returns null exactly like a count with no step at all. 'quarantine' is a timeout; it
 * says so in `kind` so every caller (which queues a BotAction by that name) stays honest, and
 * carries a `quarantine` flag for the screens that want to call it by its own name.
 */
export function escalationFor(count, ladder = DEFAULT_LADDER) {
  const n = Math.floor(Number(count));
  if (!Number.isFinite(n) || n < 1) return null;
  const L = normalizeLadder(ladder && ladder.length ? ladder : DEFAULT_LADDER);
  const hit = L.find((t) => t.count === n);
  if (!hit || LADDER_NOOPS.includes(hit.action)) return null;
  if (hit.action === 'quarantine') return { kind: 'timeout', minutes: hit.minutes || 60, at: n, quarantine: true };
  return { kind: hit.action, minutes: hit.action === 'timeout' ? (hit.minutes || 60) : null, at: n };
}

// ── State ─────────────────────────────────────────────────────────────────────────────────
/** Per-guild memory. Bounded: a user keeps their last 60 messages / 2 min, joins keep 5 min. */
export function createState() {
  return { users: new Map(), joins: [], warns: new Map(), strikes: new Map(), lockdownUntil: 0, lockdownSince: 0, previousVerification: null };
}
const USER_KEEP_MS = 120_000, USER_KEEP_N = 60, JOIN_KEEP_MS = 300_000;

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
/** A cheap, stable content hash — repeats are detected on the normalised text. */
export function contentHash(s) {
  const t = norm(s);
  let h = 0;
  for (let i = 0; i < t.length; i++) h = ((h << 5) - h + t.charCodeAt(i)) | 0;
  return `${t.length}:${(h >>> 0).toString(36)}`;
}

function userTrack(state, userId, now) {
  let u = state.users.get(userId);
  if (!u) { u = { msgs: [] }; state.users.set(userId, u); }
  u.msgs = u.msgs.filter((m) => now - m.t <= USER_KEEP_MS).slice(-USER_KEEP_N);
  return u;
}

/** Record a warning locally and return the standing count (after decay). */
export function recordWarn(state, userId, cfg, now = Date.now()) {
  const decay = (cfg?.warnDecayHours || 0) * 3_600_000;
  const list = (state.warns.get(userId) || []).filter((t) => !decay || now - t <= decay);
  list.push(now);
  state.warns.set(userId, list);
  return list.length;
}
export function warnCount(state, userId, cfg, now = Date.now()) {
  const decay = (cfg?.warnDecayHours || 0) * 3_600_000;
  return (state.warns.get(userId) || []).filter((t) => !decay || now - t <= decay).length;
}

// ── Exemptions ────────────────────────────────────────────────────────────────────────────
/**
 * A rule's OWN exemption list — roles and channels it alone ignores. Deliberately not
 * isExempt(): there is no moderator clause and no user list here, so a rule cannot quietly
 * widen what the global list decided.
 */
export function ruleExempt(rule, { channelId, memberRoles = [] } = {}) {
  const e = rule?.exempt;
  if (!e) return false;
  if (channelId && (e.channels || []).includes(String(channelId))) return true;
  const roles = (memberRoles || []).map(String);
  return !!(roles.length && (e.roles || []).some((r) => roles.includes(String(r))));
}

export function isExempt(exempt, { authorId, channelId, memberRoles = [], isModerator = false } = {}) {
  const e = exempt || {};
  if (e.moderators !== false && isModerator) return true;
  if (authorId && (e.users || []).includes(String(authorId))) return true;
  if (channelId && (e.channels || []).includes(String(channelId))) return true;
  const roles = (memberRoles || []).map(String);
  if (roles.length && (e.roles || []).some((r) => roles.includes(String(r)))) return true;
  return false;
}

// ── Text detectors (each one pure, each one exported for its own tests) ───────────────────
const INVITE_RE = /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite|dsc\.gg)\/([\w-]{2,64})/gi;
export function extractInvites(text) {
  const out = [];
  for (const m of String(text || '').matchAll(INVITE_RE)) out.push(m[1]);
  return [...new Set(out)];
}
const URL_RE = /https?:\/\/([^\s<>()\[\]"']+)/gi;
export function extractLinks(text) {
  const out = [];
  for (const m of String(text || '').matchAll(URL_RE)) {
    const host = m[1].split(/[/?#:]/)[0].toLowerCase().replace(/^www\./, '').replace(/\.+$/, '');
    if (!host) continue;
    if (/^(discord\.gg|discord(?:app)?\.com|dsc\.gg)$/.test(host) && /invite|discord\.gg|dsc\.gg/.test(m[0].toLowerCase())) continue; // invites are their own rule
    out.push({ url: m[0], host });
  }
  return out;
}
/** `example.com` allows example.com and every sub.example.com; nothing else. */
export function domainAllowed(host, allow = []) {
  const h = String(host || '').toLowerCase();
  return (allow || []).some((d) => { const a = String(d).toLowerCase().replace(/^\*\./, ''); return h === a || h.endsWith(`.${a}`); });
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * A word pattern → RegExp. Plain word = whole word, case-insensitive. `*` = any run of word
 * characters. `/…/flags` = the regex as written (a broken one matches nothing rather than
 * throwing inside a message handler). Bounded so a config cannot smuggle in a 10 KB pattern.
 */
export function compilePattern(p) {
  const s = String(p || '').trim().slice(0, 200);
  if (!s) return null;
  const m = s.match(/^\/(.+)\/([a-z]*)$/);
  try {
    if (m) return new RegExp(m[1], m[2].includes('i') ? m[2] : `${m[2]}i`);
    const body = s.split('*').map(escapeRe).join('[\\p{L}\\p{N}_]*');
    const lead = s.startsWith('*') ? '' : '(?<![\\p{L}\\p{N}_])';
    const tail = s.endsWith('*') ? '' : '(?![\\p{L}\\p{N}_])';
    return new RegExp(`${lead}${body}${tail}`, 'iu');
  } catch { return null; }
}
const patternCache = new Map();
export function matchWords(text, patterns = []) {
  const hits = [];
  const t = String(text || '');
  for (const p of patterns) {
    let re = patternCache.get(p);
    if (re === undefined) { re = compilePattern(p); patternCache.set(p, re); if (patternCache.size > 2000) patternCache.clear(); }
    if (re && re.test(t)) hits.push(p);
  }
  return hits;
}

export function capsRatio(text) {
  const letters = [...String(text || '')].filter((c) => /\p{L}/u.test(c));
  if (!letters.length) return { ratio: 0, letters: 0 };
  const upper = letters.filter((c) => c !== c.toLowerCase() && c === c.toUpperCase()).length;
  return { ratio: upper / letters.length, letters: letters.length };
}

const COMBINING_RE = /[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]/gu;
/** Combining marks (the machinery of zalgo) — count, and the share of the text they are. */
export function zalgoScore(text) {
  const s = String(text || '');
  const combining = (s.match(COMBINING_RE) || []).length;
  const total = [...s].length || 1;
  return { combining, ratio: combining / total };
}

export const extOf = (name) => { const m = String(name || '').toLowerCase().match(/\.([a-z0-9]{1,8})$/); return m ? m[1] : ''; };

// ── laya (agent-laya-bcweb): phishing, rules first ────────────────────────────────────────
// The deterministic half of the AI-assisted check. Cheap, local, no network: it decides alone
// whenever the evidence is plain (a look-alike of a brand people log in to, a punycode host, a
// raw IP, credentials smuggled into the URL, a "free nitro" lure on a shortener) and it is the
// part of the feature that may use the full action list. Only when it is unsure does the bot
// spend a call on the model.
// The brand list is the API's (lib/moderation/links.mjs DEFAULT_BRANDS), copied into the bot by
// scripts/sync-brands.mjs because this image cannot import apps/api. One list, not two.
const SHORTENERS = ['bit.ly', 'tinyurl.com', 'cutt.ly', 'is.gd', 'rb.gy', 'goo.gl', 'shorturl.at', 'v.gd', 't.ly', 'rebrand.ly', 'ow.ly', 'bl.ink', 'tiny.cc'];
const LURE_RE = /\b(free\s*nitro|nitro\s*(gift|free|for\s*free)|steam\s*(gift|free|wallet)|free\s*(skins?|robux|gift|giveaway|vbucks|v-bucks)|claim\s*(your|now|here)|airdrop|verify\s*(your\s*)?account|account\s*(will\s*be\s*)?(suspended|banned|disabled)|gift\s*for\s*you|3\s*months?\s*(of\s*)?nitro|nitro\s*giveaway|login\s*to\s*claim)\b/i;
/** A host reduced to what it spells: digits and look-alike letters folded onto the letter they imitate. */
const skeleton = (s) => String(s || '').toLowerCase()
  .replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/[0]/g, 'o').replace(/[1!|]/g, 'l').replace(/3/g, 'e')
  .replace(/[4@]/g, 'a').replace(/5/g, 's').replace(/7/g, 't').replace(/[^a-z]/g, '');
function editDistance(a, b, cap = 3) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}
const officialOf = (host) => Object.entries(BRANDS).find(([, list]) => list.some((d) => host === d || host.endsWith(`.${d}`)))?.[0] || null;
// The official names long enough to be typo-squatted on their own (steamcommunlty, dlscordapp).
const OFFICIAL_NAMES = [...new Set(Object.values(BRANDS).flat().map((d) => d.split('.')[0].replace(/[^a-z]/g, '')).filter((n) => n.length >= 7))];
/** A punycode label shown as what it spells, accents dropped: xn--dscord-9ra → discord. */
const unaccent = (host) => { let u = host; try { u = domainToUnicode(host) || host; } catch { /* keep it */ } return u.normalize('NFKD').replace(/\p{M}/gu, ''); };
const HOST_LURE = /(nitro|gift|free|claim|airdrop|login|verify|giveaway|promo|reward|bonus|wallet)/;
/**
 * Which brand this host is pretending to be: { brand, strong } or null. The brand's own domains
 * are never a look-alike. `strong` = a spelling trick (d1scord, st3am, dlscord, disocrd) or the
 * brand's exact name on someone else's domain; a name that merely CONTAINS the brand is weak
 * (steamdb, discordbotlist are real fan sites) unless the name also carries a lure word
 * (discord-nitro, steamgift). Short brands (steam, paypal) never get the edit-distance test:
 * "stream" is one letter away from "steam" and is everywhere.
 */
export function lookalikeBrand(host) {
  const h = String(host || '').toLowerCase().replace(/\.+$/, '');
  if (!h || officialOf(h)) return null;
  const labels = unaccent(h).split('.');
  const names = labels.length > 1 ? labels.slice(0, -1) : labels;
  const whole = names.join('');
  let weak = null;
  for (const brand of Object.keys(BRANDS)) {
    for (const raw of [...names, whole]) {
      const p = skeleton(raw);
      if (p.length < 4) continue;
      if (p === brand) return { brand, strong: true };
      if (brand.length >= 7) {
        if (editDistance(p, brand, 2) <= 2) return { brand, strong: true };
        if (p.length > brand.length && editDistance(p.slice(0, brand.length), brand, 1) === 1) return { brand, strong: true };
      }
      for (const o of OFFICIAL_NAMES) if (p !== o && editDistance(p, o, 2) <= 2) return { brand, strong: true };
      if (p.includes(brand)) {
        if (HOST_LURE.test(p.replace(brand, ''))) return { brand, strong: true };
        weak = weak || { brand, strong: false };
      }
    }
  }
  return weak;
}
/**
 * The deterministic phishing verdict for one message: { score (0..1), reasons[], hosts[] }.
 * `score` ≥ 0.7 is decided here without the model.
 */
export function phishingSignals(text) {
  const t = String(text || '').slice(0, 4000);
  const reasons = [];
  let score = 0;
  const add = (n, why) => { score += n; reasons.push(why); };
  const raw = [...t.matchAll(/https?:\/\/[^\s<>()"']+/gi)].map((m) => m[0]).slice(0, 20);
  const hosts = extractLinks(t).map((l) => l.host).slice(0, 20);
  const lure = LURE_RE.test(t);
  if (raw.some((u) => /^https?:\/\/[^/?#]*@/i.test(u))) add(0.6, 'credentials in the link');
  for (const h of new Set(hosts)) {
    if (/(^|\.)xn--/.test(h)) add(0.5, `punycode host ${h}`);
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.startsWith('[')) add(0.4, `raw IP ${h}`);
    const look = lookalikeBrand(h);
    if (look) add(look.strong ? 0.75 : 0.3, `${h} ${look.strong ? 'imitates' : 'mentions'} ${look.brand}`);
    if (SHORTENERS.includes(h) && lure) add(0.35, `shortened link ${h}`);
  }
  if (lure && hosts.length) add(0.35, 'gift / nitro / account lure with a link');
  return { score: Math.min(1, Math.round(score * 100) / 100), reasons, hosts: [...new Set(hosts)] };
}

/** Which AI checks this message is worth (none when the cheap prefilter says no). Pure. */
export function aiChecksFor(message, ai) {
  if (!ai?.enabled) return [];
  const text = String(message?.content || '');
  const checks = [];
  if (ai.phishing && /https?:\/\/|discord\.gg\/|www\./i.test(text)) checks.push('phishing');
  if (ai.troll && text.replace(/\s+/g, ' ').trim().length >= (ai.minChars || 12)) checks.push('troll');
  return checks;
}

/** The API's labels → the actions the AI verdict costs (capped at ai.action). Pure. */
export function aiVerdict(labels, ai, checks = ['phishing', 'troll']) {
  const out = [];
  if (!labels || !ai) return out;
  const pct = (p) => `${Math.round(p * 100)}%`;
  const r = { ...ai, action: AI_ACTIONS.includes(ai.action) ? ai.action : 'log' };
  if (checks.includes('phishing')) {
    const p = Math.max(Number(labels.phishing) || 0, 0);
    if (p >= ai.phishingThreshold) out.push(act('ai', r, `AI: likely phishing (${pct(p)})`, { kind: 'ai', label: 'phishing', p }));
  }
  if (checks.includes('troll') && !out.length) {
    const p = Math.max(Number(labels.troll) || 0, Number(labels.toxic) || 0);
    const toxic = (Number(labels.toxic) || 0) > (Number(labels.troll) || 0);
    if (p >= ai.trollThreshold) out.push(act('ai', r, `AI: likely ${toxic ? 'toxic' : 'trolling'} (${pct(p)})`, { kind: 'ai', label: toxic ? 'toxic' : 'troll', p }));
  }
  return out;
}

// What the API said "no" to, remembered per guild so a server without the plan (402) or a
// site with AI switched off does not cost a request per message.
const aiBackoff = new Map(); // guildId → until (ms)
export const _resetAiBackoff = () => aiBackoff.clear();
/**
 * The grey zone: ask the API, never wait longer than `timeoutMs`, and on ANY failure return
 * nothing — the rules already ran, and their answer (nothing fired) stands. `callApi` is
 * injected for the tests; the bot passes api.aiAutomod.
 */
export async function aiFollowUp(message, cfg, callApi, { timeoutMs = 2500, now = Date.now() } = {}) {
  try {
    const ai = cfg?.ai;
    if (!ai?.enabled || !message || message.bot) return [];
    if (isExempt(cfg.exempt, message) || ruleExempt(ai, message)) return [];
    const checks = aiChecksFor(message, ai);
    if (!checks.length) return [];
    if ((aiBackoff.get(message.guildId) || 0) > now) return [];
    const r = await callApi({ guildId: message.guildId, userId: message.authorId, text: String(message.content || '').slice(0, 4000), checks }, timeoutMs);
    if (!r || r.ok !== true) {
      // 402 (no plan) → ten minutes; AI off / killed → one minute; busy / timeout → nothing.
      const wait = r?.error === 'plan_required' ? 600_000 : r?.reason === 'disabled' ? 60_000 : 0;
      if (wait) { aiBackoff.set(message.guildId, now + wait); if (aiBackoff.size > 5000) aiBackoff.clear(); }
      return [];
    }
    return aiVerdict(r.labels, ai, checks);
  } catch { return []; }
}
// fin laya (agent-laya-bcweb)

// ── The site's second opinion on a link ──────────────────────────────────────────────────
// The rules above know the shipped brand list; the SITE also knows what its admins added (the
// blocked domains, their own protected brands, a campaign seen on other servers). So a message
// with a link that no rule caught, on a server that turned the phishing check on, is shown to
// POST /bot/moderation/check. Fail-open by construction: a hard deadline, any failure is
// "nothing", and a site that keeps failing is left alone for a minute. Only a BLOCK acts, and
// it acts like the deterministic phishing check does (`rulesAction`): the site's rules are
// rules, not a model. Anything milder is the site's to queue, not the bot's to punish.
const siteBackoff = new Map(); // guildId → until (ms)
export const _resetSiteBackoff = () => siteBackoff.clear();
export async function siteCheckFollowUp(message, cfg, callApi, { timeoutMs = 1500, now = Date.now() } = {}) {
  try {
    const ai = cfg?.ai;
    if (!ai?.enabled || !ai.phishing || !message || message.bot || typeof callApi !== 'function') return [];
    if (isExempt(cfg.exempt, message) || ruleExempt(ai, message)) return [];
    const links = extractLinks(message.content).map((l) => l.url).slice(0, 30);
    if (!links.length) return [];
    if ((siteBackoff.get(message.guildId) || 0) > now) return [];
    const id = (v) => (/^\d{5,25}$/.test(String(v || '')) ? String(v) : undefined);
    if (!id(message.authorId)) return [];
    const r = await callApi({
      text: String(message.content || '').slice(0, 4000), links,
      discordId: id(message.authorId), guildId: id(message.guildId), channelId: id(message.channelId), messageId: id(message.id),
    }, timeoutMs);
    if (!r || r.ok !== true) {
      siteBackoff.set(message.guildId, now + 60_000);
      if (siteBackoff.size > 5000) siteBackoff.clear();
      return [];
    }
    if (r.decision !== 'BLOCK') return [];
    const why = (Array.isArray(r.reasons) ? r.reasons : []).slice(0, 3).map((x) => String(x?.detail || x?.rule || '').slice(0, 80)).filter(Boolean).join(', ');
    return [act('ai', { ...ai, action: ai.logOnly ? 'log' : ai.rulesAction }, `site: ${why || 'blocked link'}`, { kind: 'site', score: Number(r.score) || 0, caseId: r.caseId || null })];
  } catch { return []; }
}

// ── The engine ────────────────────────────────────────────────────────────────────────────
// One rule firing → one action. `logOnly` downgrades the whole thing to 'log' here, at the
// single place that builds an action, so every caller downstream (strongest, the delete, the
// DM, applyToMember) sees a rule that decided to do nothing rather than each having to
// remember the flag.
const act = (rule, r, reason, meta = {}, { deleteMessage = true } = {}) => {
  const action = r.logOnly ? 'log' : r.action;
  return {
    rule, action, reason,
    deleteMessage: action !== 'log' && r.deleteMessage !== false && deleteMessage,
    timeoutMin: action === 'timeout' || action === 'quarantine' ? (r.timeoutMin || 10) : null,
    roleId: action === 'addRole' || action === 'removeRole' ? (r.roleId || null) : null,
    roleMin: action === 'addRole' ? (r.roleMin || 0) : null,
    // Does this hit feed the warn ladder, and from which hit (warnPolicy below). Watch-only
    // never counts: a rule being observed must not be quietly building a ban case.
    warn: action === 'log' ? null : (action === 'warn' || r.countsAsWarn) ? { every: r.warnEvery || 1, windowMin: r.warnWindowMin ?? 60 } : null,
    dm: !!r.dm, meta,
  };
};

/**
 * Progressive warnings: which of these hits records a warning on the shared ladder.
 *
 * Per rule, per member, within the rule's window. A rule with `warn.every = 3` lets the first
 * two hits cost only the rule's own action; the third records ONE warning and the count starts
 * again. Several rules firing on one message count each their own hit, and still record at
 * most one warning — one message is one offence. The warning itself goes to the site
 * (api.warn → lib/warns.mjs), so it lands on the SAME count /warn and the admin screen use:
 * there is no second counter to disagree with the ladder.
 *
 * Mutates `state.strikes`; returns { warn: { rule, hit, every } | null, strikes: [{ rule, hit, every }] }.
 */
export function warnPolicy(actions, state, userId, now = Date.now()) {
  const strikes = [];
  let warn = null;
  if (!state.strikes) state.strikes = new Map();
  for (const a of actions || []) {
    if (!a?.warn) continue;
    const key = `${a.rule}:${userId}`;
    const win = (a.warn.windowMin || 0) * 60_000;
    const list = (state.strikes.get(key) || []).filter((t) => !win || now - t <= win);
    list.push(now);
    const every = Math.max(1, a.warn.every || 1);
    const hit = list.length;
    if (hit >= every) {
      state.strikes.delete(key);
      if (!warn) warn = { rule: a.rule, hit, every };
    } else state.strikes.set(key, list);
    strikes.push({ rule: a.rule, hit, every });
  }
  // Bounded like the rest of the state: a long-running bot in a busy server must not grow this
  // forever. The oldest keys go first; losing one only forgets a strike, never a warning.
  if (state.strikes.size > 5000) for (const k of [...state.strikes.keys()].slice(0, 1000)) state.strikes.delete(k);
  return { warn, strikes };
}

/**
 * One message in. Updates the state (recent messages per user), returns every rule that
 * fired — an empty array is the normal case. Nothing here is async and nothing here is
 * random: the same message against the same state and config yields the same list.
 */
export function evaluateMessage(message, state, cfg) {
  const out = [];
  if (!cfg?.enabled || !message || message.bot) return out;
  const now = Number(message.createdAt) || Date.now();
  const R = cfg.rules;
  const exempt = isExempt(cfg.exempt, message);
  // Tracking happens for everyone (a moderator's message rate is not interesting, but the
  // decision to exempt comes after the bookkeeping so a toggle mid-stream has history).
  const u = userTrack(state, message.authorId, now);
  const h = contentHash(message.content);
  u.msgs.push({ t: now, ch: message.channelId, h, id: message.id });
  if (exempt) return out;
  const text = String(message.content || '');
  // A rule runs when it is on AND this channel / these roles are not on its own exemption
  // list. The global list has already had its say above.
  const on = (r) => r.enabled && !ruleExempt(r, message);

  // spam: rate + repeats
  if (on(R.spam)) {
    const inWindow = u.msgs.filter((m) => now - m.t <= R.spam.windowSec * 1000).length;
    if (inWindow > R.spam.maxMessages) out.push(act('spam', R.spam, `${inWindow} messages in ${R.spam.windowSec}s`, { count: inWindow, kind: 'rate' }));
    else if (text.length) {
      const repeats = u.msgs.filter((m) => m.h === h && now - m.t <= R.spam.repeatWindowSec * 1000).length;
      if (repeats >= R.spam.maxRepeats) out.push(act('spam', R.spam, `same message ${repeats}× in ${R.spam.repeatWindowSec}s`, { count: repeats, kind: 'repeat' }));
    }
  }
  // mentions
  if (on(R.mentions)) {
    const m = message.mentions || {};
    const users = Number(m.users || 0), roles = Number(m.roles || 0);
    if (users > R.mentions.maxUsers) out.push(act('mentions', R.mentions, `${users} user mentions`, { users, roles }));
    else if (roles > R.mentions.maxRoles) out.push(act('mentions', R.mentions, `${roles} role mentions`, { users, roles }));
    else if (m.everyone && !R.mentions.everyone) out.push(act('mentions', R.mentions, '@everyone / @here', { everyone: true }));
  }
  // invites
  if (on(R.invites)) {
    const codes = extractInvites(text);
    if (codes.length) {
      const resolved = message.inviteGuilds || {};
      const bad = codes.filter((c) => {
        if (R.invites.allowCodes.includes(c.toLowerCase())) return false;
        const g = resolved[c];
        if (g && (g === message.guildId || R.invites.allowGuilds.includes(String(g)))) return false;
        return true;
      });
      if (bad.length) out.push(act('invites', R.invites, `invite link${bad.length > 1 ? 's' : ''}: ${bad.join(', ')}`, { codes: bad }));
    }
  }
  // links
  if (on(R.links)) {
    const links = extractLinks(text).filter((l) => !domainAllowed(l.host, R.links.allowDomains));
    if (links.length) out.push(act('links', R.links, `link to ${[...new Set(links.map((l) => l.host))].join(', ')}`, { hosts: links.map((l) => l.host) }));
  }
  // words
  if (on(R.words) && R.words.patterns.length) {
    const hits = matchWords(text, R.words.patterns);
    if (hits.length) out.push(act('words', R.words, `banned word (${hits.length} pattern${hits.length > 1 ? 's' : ''})`, { patterns: hits }));
  }
  // caps
  if (on(R.caps)) {
    const { ratio, letters } = capsRatio(text);
    if (letters >= R.caps.minLetters && ratio >= R.caps.ratio) out.push(act('caps', R.caps, `${Math.round(ratio * 100)}% capitals`, { ratio, letters }));
  }
  // zalgo / excessive unicode
  if (on(R.zalgo)) {
    const z = zalgoScore(text);
    if (z.combining >= R.zalgo.maxCombining || (z.combining > 0 && z.ratio >= R.zalgo.maxRatio)) out.push(act('zalgo', R.zalgo, `${z.combining} combining marks`, z));
  }
  // attachments
  if (on(R.attachments) && Array.isArray(message.attachments) && message.attachments.length) {
    const allow = R.attachments.allowTypes, block = R.attachments.blockTypes;
    const bad = message.attachments.map((a) => extOf(a.name)).filter((e) => (allow.length ? !allow.includes(e) : block.includes(e)));
    if (bad.length) out.push(act('attachments', R.attachments, `attachment type ${bad.map((e) => `.${e || '?'}`).join(', ')}`, { types: bad }));
  }
  // anti-selfbot
  if (on(R.selfbot)) {
    const win = u.msgs.filter((m) => now - m.t <= R.selfbot.windowSec * 1000);
    const channels = new Set(win.map((m) => m.ch));
    const perMinute = u.msgs.filter((m) => now - m.t <= 60_000).length;
    const identical = text.length >= 4 && new Set(u.msgs.filter((m) => m.h === h && now - m.t <= R.selfbot.identicalAcrossSec * 1000).map((m) => m.ch)).size;
    if (channels.size >= R.selfbot.channelsPerWindow) out.push(act('selfbot', R.selfbot, `${channels.size} channels in ${R.selfbot.windowSec}s`, { kind: 'multichannel', channels: channels.size }));
    else if (identical >= 2) out.push(act('selfbot', R.selfbot, `identical message in ${identical} channels within ${R.selfbot.identicalAcrossSec}s`, { kind: 'crosspost', channels: identical }));
    else if (perMinute > R.selfbot.maxPerMinute) out.push(act('selfbot', R.selfbot, `${perMinute} messages in a minute`, { kind: 'rate', perMinute }));
  }
  // laya (agent-laya-bcweb): the AI check's deterministic half — rules first. Plain evidence
  // decides here, with the rule's own full action (`rulesAction`); the rest is the grey zone
  // that aiFollowUp may send to the model once nothing else fired.
  const AI = cfg.ai;
  if (AI?.enabled && AI.phishing && !ruleExempt(AI, message)) {
    const ph = phishingSignals(text);
    if (ph.score >= 0.7) out.push(act('ai', { ...AI, action: AI.logOnly ? 'log' : AI.rulesAction }, `phishing: ${ph.reasons.slice(0, 3).join(', ')}`, { kind: 'rules', score: ph.score, hosts: ph.hosts }));
  }
  return out;
}

/** Is the guild in raid lockdown at `now`? Clears the clock when it has run out. */
export function lockdownActive(state, now = Date.now()) {
  if (state.lockdownUntil && now >= state.lockdownUntil) { state.lockdownUntil = 0; return false; }
  return !!state.lockdownUntil;
}

/**
 * One member in. `member` = { id, guildId, accountCreatedAt, joinedAt, bot }. Records the
 * join, returns the account-age verdict and, when the join rate crosses the line, the
 * 'lockdown' action (once — the moment it starts) followed by the per-joiner action while
 * the lockdown lasts.
 */
export function evaluateJoin(member, state, cfg) {
  const out = [];
  if (!cfg?.enabled || !member || member.bot) return out;
  const now = Number(member.joinedAt) || Date.now();
  const R = cfg.rules;
  if (isExempt(cfg.exempt, { authorId: member.id })) return out;

  if (R.accountAge.enabled && member.accountCreatedAt) {
    const ageDays = (now - Number(member.accountCreatedAt)) / 86_400_000;
    if (ageDays < R.accountAge.minDays) {
      const a = R.accountAge.logOnly ? 'log' : R.accountAge.action === 'quarantine' ? 'timeout' : R.accountAge.action;
      out.push({ rule: 'accountAge', action: a, reason: `account is ${ageDays < 1 ? 'under a day' : `${Math.floor(ageDays)} day(s)`} old (minimum ${R.accountAge.minDays})`, deleteMessage: false, timeoutMin: a === 'timeout' ? R.accountAge.timeoutMin : null, dm: !!R.accountAge.dm, meta: { ageDays } });
    }
  }
  if (R.raid.enabled) {
    state.joins = state.joins.filter((t) => now - t <= JOIN_KEEP_MS);
    state.joins.push(now);
    const recent = state.joins.filter((t) => now - t <= R.raid.windowSec * 1000).length;
    const active = lockdownActive(state, now);
    if (!active && recent >= R.raid.joins) {
      state.lockdownUntil = now + R.raid.lockdownMin * 60_000;
      state.lockdownSince = now;
      out.push({ rule: 'raid', action: 'lockdown', reason: `${recent} joins in ${R.raid.windowSec}s`, deleteMessage: false, timeoutMin: R.raid.lockdownMin, meta: { joins: recent, until: state.lockdownUntil, raiseVerification: R.raid.raiseVerification, alert: R.raid.alert } });
    }
    if (lockdownActive(state, now) && R.raid.action !== 'log' && !R.raid.logOnly) {
      out.push({ rule: 'raid', action: R.raid.action, reason: 'joined during raid lockdown', deleteMessage: false, timeoutMin: R.raid.action === 'timeout' ? R.raid.timeoutMin : null, dm: !!R.raid.dm, meta: { lockdown: true } });
    }
  }
  return out;
}

/** The single action to carry out for a list of hits (most severe), or null. */
export function strongest(actions) {
  let best = null;
  for (const a of actions || []) {
    if (!a || a.action === 'lockdown') continue;
    if (!best || (SEVERITY[a.action] ?? 0) > (SEVERITY[best.action] ?? 0)) best = a;
  }
  return best;
}

// ── Discord side ──────────────────────────────────────────────────────────────────────────
const states = new Map(); // guildId → state
export const stateFor = (guildId) => { let s = states.get(guildId); if (!s) { s = createState(); states.set(guildId, s); } return s; };
export const _resetStates = () => states.clear();

const MOD_PERMS = [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageGuild, PermissionFlagsBits.Administrator, PermissionFlagsBits.ModerateMembers];
/** A discord.js Message → the plain shape the engine reads. */
export function toPlainMessage(msg, inviteGuilds = {}) {
  return {
    id: msg.id, guildId: msg.guildId || msg.guild?.id, channelId: msg.channelId, authorId: msg.author?.id, bot: !!msg.author?.bot,
    content: msg.content || '', createdAt: msg.createdTimestamp || Date.now(),
    mentions: { users: msg.mentions?.users?.size || 0, roles: msg.mentions?.roles?.size || 0, everyone: !!msg.mentions?.everyone },
    attachments: msg.attachments ? [...msg.attachments.values()].map((a) => ({ name: a.name, contentType: a.contentType })) : [],
    memberRoles: msg.member?.roles?.cache ? [...msg.member.roles.cache.keys()] : [],
    isModerator: !!(msg.member?.permissions && MOD_PERMS.some((p) => msg.member.permissions.has(p))),
    inviteGuilds,
  };
}

/** The effective automod config + ladder for a guild (null when off). */
export async function automodConfig(guildId) {
  const cfg = await guildConfig(guildId);
  const mod = cfg?.moderation || {};
  if (!cfg?.enabled || !mod.enabled) return null;
  const am = normalizeAutomod(mod.automod);
  if (!am.enabled) return null;
  return { automod: am, ladder: normalizeLadder(mod.warnThresholds).length ? mod.warnThresholds : DEFAULT_LADDER };
}

// The log sink is injected so this module does not import logs.mjs (which imports nothing
// from here either); index.mjs wires the two.
let logSink = null;
export function setAutomodLogger(fn) { logSink = fn; }
const log = (guildId, category, event) => { try { return Promise.resolve(logSink?.(guildId, category, event)).catch(() => {}); } catch { return null; } };

/**
 * Tell the member what fired and what it cost them — only when the rule asked for it (`dm`).
 * A closed DM is the normal case, not a failure, so this never throws and never blocks the
 * action it describes.
 */
/**
 * The DM, in the server's language (the one its admin picked in /setup, else the bot's
 * default). Pure, so the four languages are tested without a gateway.
 * `policy` is warnPolicy()'s answer: a recorded warning, or how far along the strikes are.
 */
export function automodDmText(t, { server, reason, best, policy }) {
  const act = best.action === 'warn' ? 'delete' : best.action;
  const what = act === 'timeout' ? t('am.dm.timeout', { min: best.timeoutMin || 10 })
    : act === 'addRole' ? (best.roleMin ? t('am.dm.addRoleFor', { min: best.roleMin }) : t('am.dm.addRole'))
      : t(`am.dm.${act}`);
  const strike = (policy?.strikes || []).find((x) => x.rule === best.rule) || (policy?.strikes || [])[0];
  const warnLine = policy?.warn ? t('am.dm.warned')
    : strike && strike.every > 1 ? t('am.dm.strike', { n: strike.hit, of: strike.every }) : null;
  return [t('am.dm.head', { server: server || t('am.dm.thisServer'), reason }), what, warnLine].filter(Boolean).join('\n');
}

async function dmMember(user, guild, best, reason, policy = null) {
  if (!best?.dm || typeof user?.send !== 'function') return false;
  const cfg = await config().catch(() => null);
  const t = makeT(localeOf({ guildId: guild?.id }, cfg), cfg?.i18n);
  const body = automodDmText(t, { server: guild?.name, reason, best, policy });
  return user.send(body.slice(0, 1900)).then(() => true).catch(() => false);
}

/**
 * Record one warning on the site's ladder — the count /warn and the admin screen use. The site
 * queues whatever the count buys (a timeout at 3, a kick at 5…) as an ordinary BotAction. When
 * the site cannot be reached, the local ladder stands in so a repeat offender is not waved
 * through because the API blinked.
 */
async function recordAutomodWarn(member, guild, targetUser, why) {
  const r = await api.warn(targetUser.id, why, guild.id, 'automod');
  if (r) return { warned: r.count, triggered: r.triggered || null, recorded: true };
  const cfg = await automodConfig(guild.id);
  const count = recordWarn(stateFor(guild.id), targetUser.id, cfg?.automod);
  const esc = escalationFor(count, cfg?.ladder);
  if (esc && member) {
    if (esc.kind === 'timeout') { await member.timeout(esc.minutes * 60_000, why); modStats.timeouts++; }
    else if (esc.kind === 'kick') { await member.kick(why); modStats.kicks++; }
    else if (esc.kind === 'ban') await guild.members.ban(targetUser.id, { reason: why });
  }
  return { warned: count, triggered: esc, recorded: false };
}

/**
 * Carry out the action on a message's author, then — separately — the warning, when the
 * progressive policy says this hit is the one that counts. `warnDecision` is warnPolicy()'s
 * `warn` for a message; for a join (no strikes) it is the old rule: action 'warn' warns.
 */
async function applyToMember(member, guild, best, reason, targetUser, warnDecision = undefined) {
  if (!best) return null;
  const why = `Automod: ${reason}`.slice(0, 500);
  const shouldWarn = warnDecision === undefined ? best.action === 'warn' : !!warnDecision;
  let out = null;
  try {
    const needsMember = ['timeout', 'kick', 'addRole', 'removeRole'].includes(best.action);
    if (needsMember && !member) out = { failed: 'member not in server' };
    else if (best.action === 'timeout') { await member.timeout(Math.min(best.timeoutMin || 10, 28 * 24 * 60) * 60_000, why); modStats.timeouts++; out = { timeoutMin: best.timeoutMin }; }
    else if (best.action === 'kick') { await member.kick(why); modStats.kicks++; out = { kicked: true }; }
    else if (best.action === 'ban') { await guild.members.ban(targetUser.id, { reason: why }); out = { banned: true }; }
    else if (best.action === 'addRole') {
      // Discord refuses a role above the bot's own, or without Manage Roles — reported, never
      // thrown. The timed removal lives in this process: a restart before it fires leaves the
      // role on, which is why "0 = until removed" is the honest default.
      await member.roles.add(best.roleId, why);
      out = { roleAdded: best.roleId, roleMin: best.roleMin || 0 };
      if (best.roleMin > 0) setTimeout(() => { member.roles.remove(best.roleId, 'Automod: role time elapsed').catch(() => {}); }, Math.min(best.roleMin, 28 * 24 * 60) * 60_000).unref?.();
    } else if (best.action === 'removeRole') { await member.roles.remove(best.roleId, why); out = { roleRemoved: best.roleId }; }
  } catch (e) { out = { failed: String(e?.message || e).slice(0, 200) }; }
  if (shouldWarn && !(out?.kicked || out?.banned)) {
    // A kicked or banned member's warning would buy nothing they can still receive; the
    // action already says more than the warning would.
    try { out = { ...(out || {}), ...(await recordAutomodWarn(member, guild, targetUser, why)) }; }
    catch (e) { out = { ...(out || {}), failed: String(e?.message || e).slice(0, 200) }; }
  }
  return out;
}

/** messageCreate → automod. Runs after the legacy moderation handler; never throws. */
export async function onAutomodMessage(msg) {
  if (!msg?.guild || msg.author?.bot || msg.system) return;
  const c = await automodConfig(msg.guild.id);
  if (!c) return;
  // Invite codes are resolved BEFORE the decision, so the engine stays pure: a code that
  // points at this server (or an allowed one) is not an offence.
  let inviteGuilds = {};
  if (c.automod.rules.invites.enabled) {
    const codes = extractInvites(msg.content);
    for (const code of codes.slice(0, 5)) {
      const inv = await msg.client.fetchInvite(code).catch(() => null);
      if (inv?.guild?.id) inviteGuilds[code] = inv.guild.id;
    }
  }
  const plain = toPlainMessage(msg, inviteGuilds);
  const state = stateFor(msg.guild.id);
  let actions = evaluateMessage(plain, state, c.automod);
  // laya (agent-laya-bcweb): nothing fired — the grey zone, on a server that pays for the AI
  // check. Bounded by a timeout; on any failure the rules' answer (nothing) stands.
  // The site's rules (admin lists, other servers' campaigns) on a link nothing here caught;
  // fail-open, a deadline of 1.5 s.
  if (!actions.length) actions = await siteCheckFollowUp(plain, c.automod, api.moderationCheck);
  if (!actions.length) actions = await aiFollowUp(plain, c.automod, api.aiAutomod);
  if (!actions.length) return;
  const best = strongest(actions);
  const reason = actions.map((a) => `${a.rule}: ${a.reason}`).join('; ');
  const policy = warnPolicy(actions, state, msg.author.id, plain.createdAt);
  let deleted = false;
  if (actions.some((a) => a.deleteMessage)) { deleted = await msg.delete().then(() => true).catch(() => false); if (deleted) modStats.purged++; }
  // Before the action, not after: once somebody is kicked or banned there is no mutual server
  // left and Discord refuses the DM, so a message sent afterwards would never arrive.
  const dmSent = await dmMember(msg.author, msg.guild, best, reason, policy);
  const outcome = await applyToMember(msg.member, msg.guild, best, reason, msg.author, policy.warn);
  const strike = policy.strikes.find((x) => x.rule === best.rule) || policy.strikes[0];
  const logged = strike && !policy.warn && strike.every > 1 ? { ...(outcome || {}), strike } : outcome;
  console.log(`[automod] ${msg.guild.name}: ${msg.author.tag} — ${reason} → ${best.action}${policy.warn ? ' + warning' : ''}${outcome?.failed ? ` (failed: ${outcome.failed})` : ''}`);
  await log(msg.guild.id, 'automod', {
    kind: 'automod', rule: actions.map((a) => a.rule).join('+'), action: best.action, reason, deleted, outcome: logged, dm: dmSent,
    user: { id: msg.author.id, tag: msg.author.tag, avatar: msg.author.displayAvatarURL?.({ size: 64 }) },
    channelId: msg.channelId, messageId: msg.id, content: msg.content, attachments: plain.attachments,
  });
}

/** guildMemberAdd → account-age gate + raid detection. */
export async function onAutomodJoin(member) {
  if (!member?.guild || member.user?.bot) return;
  const c = await automodConfig(member.guild.id);
  if (!c) return;
  const state = stateFor(member.guild.id);
  const actions = evaluateJoin({ id: member.id, guildId: member.guild.id, bot: false, accountCreatedAt: member.user?.createdTimestamp, joinedAt: member.joinedTimestamp || Date.now() }, state, c.automod);
  if (!actions.length) return;
  const lockdown = actions.find((a) => a.action === 'lockdown');
  if (lockdown) await startLockdown(member.guild, state, lockdown, c.automod);
  const best = strongest(actions);
  if (best) {
    const dmSent = await dmMember(member.user, member.guild, best, best.reason);
    const outcome = await applyToMember(member, member.guild, best, best.reason, member.user);
    await log(member.guild.id, 'automod', {
      kind: 'automod', rule: best.rule, action: best.action, reason: best.reason, outcome, dm: dmSent,
      user: { id: member.id, tag: member.user?.tag, avatar: member.user?.displayAvatarURL?.({ size: 64 }) }, accountCreatedAt: member.user?.createdTimestamp,
    });
  }
}

async function startLockdown(guild, state, action, am) {
  console.warn(`[automod] RAID lockdown on ${guild.name}: ${action.reason}`);
  if (action.meta.raiseVerification) {
    try {
      state.previousVerification = guild.verificationLevel;
      if ((guild.verificationLevel ?? 0) < 3) await guild.setVerificationLevel(3, 'Automod: raid lockdown'); // High = 10 min member + verified phone not required
    } catch (e) { console.warn('[automod] could not raise verification:', e.message); }
  }
  const ms = Math.max(60_000, state.lockdownUntil - Date.now());
  setTimeout(() => endLockdown(guild, state).catch(() => {}), ms).unref?.();
  await log(guild.id, 'automod', { kind: 'raid', action: 'lockdown', reason: action.reason, until: state.lockdownUntil, alert: !!action.meta.alert, raid: true });
}
export async function endLockdown(guild, state = stateFor(guild.id)) {
  if (!state.lockdownUntil && state.previousVerification == null) return false;
  state.lockdownUntil = 0;
  if (state.previousVerification != null) {
    const prev = state.previousVerification; state.previousVerification = null;
    await guild.setVerificationLevel(prev, 'Automod: raid lockdown ended').catch(() => {});
  }
  await log(guild.id, 'automod', { kind: 'raid', action: 'lockdown-end', reason: 'lockdown ended', raid: true });
  return true;
}
/** `/lockdown on|off` — a moderator's manual switch on the same mechanism. */
export async function manualLockdown(guild, on, minutes = 15) {
  const state = stateFor(guild.id);
  if (!on) return endLockdown(guild, state);
  const c = await automodConfig(guild.id);
  state.lockdownUntil = Date.now() + minutes * 60_000; state.lockdownSince = Date.now();
  await startLockdown(guild, state, { reason: `manual, ${minutes} min`, meta: { raiseVerification: c?.automod.rules.raid.raiseVerification ?? true, alert: false } }, c?.automod);
  return true;
}
