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
//     ],
//     automod: {
//       enabled: true,
//       // Who and where the rules never apply. Moderators (Manage Messages / Manage Guild /
//       // Administrator) are exempt unless `moderators: false`.
//       exempt: { roles: [], channels: [], users: [], moderators: true },
//       // Local warn memory (used when the site cannot be reached and for the pure engine):
//       // a warning older than decayHours no longer counts toward the ladder. 0 = never decays.
//       warnDecayHours: 168,
//       // Every rule: { enabled, action, ...thresholds }. `action` is one of
//       //   'log'      record it, touch nothing
//       //   'delete'   delete the message (message rules only)
//       //   'warn'     delete + a recorded warning (the ladder may escalate it)
//       //   'timeout'  delete + timeout for `timeoutMin` minutes
//       //   'kick'     delete + kick
//       //   'ban'      delete + ban
//       // For a message rule every action except 'log' also deletes the message.
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
//     },
//   }
//
// Every threshold is a number the admin dashboard can render as a field; every action is a
// string from ACTIONS; every list is an array of ids or strings. `normalizeAutomod(raw)` turns
// whatever was saved into this shape with the defaults filled in — the engine only ever sees
// a normalised config.
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
// An action: { rule, action, reason, deleteMessage, timeoutMin, meta }.
// `strongest(actions)` picks the one to carry out when several rules fire at once — the
//   most severe wins, they are never stacked.

import { PermissionFlagsBits } from 'discord.js';
import { guildConfig } from '../config.mjs';
import { api } from '../api.mjs';
import { modStats } from '../store.mjs';

export const ACTIONS = ['log', 'delete', 'warn', 'timeout', 'kick', 'ban'];
const SEVERITY = { log: 0, delete: 1, warn: 2, timeout: 3, kick: 4, ban: 5, quarantine: 3, lockdown: 3 };
export const RULES = ['spam', 'mentions', 'invites', 'links', 'words', 'caps', 'zalgo', 'attachments', 'accountAge', 'selfbot', 'raid'];

export const DEFAULT_AUTOMOD = {
  enabled: true,
  exempt: { roles: [], channels: [], users: [], moderators: true },
  warnDecayHours: 168,
  rules: {
    spam: { enabled: true, action: 'timeout', timeoutMin: 10, maxMessages: 6, windowSec: 5, maxRepeats: 3, repeatWindowSec: 30 },
    mentions: { enabled: true, action: 'timeout', timeoutMin: 60, maxUsers: 6, maxRoles: 3, everyone: false },
    invites: { enabled: true, action: 'delete', allowGuilds: [], allowCodes: [] },
    links: { enabled: false, action: 'delete', allowDomains: [] },
    words: { enabled: false, action: 'delete', patterns: [] },
    caps: { enabled: false, action: 'delete', ratio: 0.7, minLetters: 12 },
    zalgo: { enabled: true, action: 'delete', maxCombining: 6, maxRatio: 0.3 },
    attachments: { enabled: true, action: 'delete', allowTypes: [], blockTypes: ['exe', 'bat', 'cmd', 'scr', 'msi', 'ps1', 'vbs', 'jar', 'com', 'dll', 'hta', 'lnk'] },
    accountAge: { enabled: false, action: 'kick', minDays: 7, timeoutMin: 1440 },
    selfbot: { enabled: true, action: 'kick', channelsPerWindow: 3, windowSec: 5, identicalAcrossSec: 10, maxPerMinute: 40 },
    raid: { enabled: true, action: 'timeout', timeoutMin: 60, joins: 10, windowSec: 30, lockdownMin: 15, raiseVerification: true, alert: true },
  },
};
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
      else if (k === 'action') {
        const a = String(s[k] || '').toLowerCase();
        const ok = name === 'accountAge' ? JOIN_ACTIONS : name === 'raid' ? ['log', 'timeout', 'kick', 'ban'] : ACTIONS;
        out[k] = ok.includes(a) ? a : dv;
      }
    }
    if (name === 'words') out.patterns = strList(s.patterns, 500); // case is the pattern's business
    rules[name] = out;
  }
  const ex = r.exempt && typeof r.exempt === 'object' ? r.exempt : {};
  return {
    enabled: bool(r.enabled, DEFAULT_AUTOMOD.enabled),
    exempt: { roles: strList(ex.roles), channels: strList(ex.channels), users: strList(ex.users), moderators: bool(ex.moderators, true) },
    warnDecayHours: num(r.warnDecayHours, DEFAULT_AUTOMOD.warnDecayHours, 0),
    rules,
  };
}

/** The ladder, highest count first, dropping what cannot be honoured (same rule as lib/warns.mjs). */
export function normalizeLadder(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((t) => ({ count: Math.floor(Number(t?.count)), action: String(t?.action || '').toLowerCase(), minutes: t?.minutes == null ? null : Math.max(1, Math.floor(Number(t.minutes))) }))
    .filter((t) => Number.isFinite(t.count) && t.count >= 1 && ['warn', 'timeout', 'kick', 'ban'].includes(t.action))
    .sort((a, b) => b.count - a.count);
}

/** What the warning that brought the total to `count` triggers — exact match, never stacked. */
export function escalationFor(count, ladder = DEFAULT_LADDER) {
  const n = Math.floor(Number(count));
  if (!Number.isFinite(n) || n < 1) return null;
  const L = normalizeLadder(ladder && ladder.length ? ladder : DEFAULT_LADDER);
  const hit = L.find((t) => t.count === n);
  if (!hit || hit.action === 'warn') return null;
  return { kind: hit.action, minutes: hit.action === 'timeout' ? (hit.minutes || 60) : null, at: n };
}

// ── State ─────────────────────────────────────────────────────────────────────────────────
/** Per-guild memory. Bounded: a user keeps their last 60 messages / 2 min, joins keep 5 min. */
export function createState() {
  return { users: new Map(), joins: [], warns: new Map(), lockdownUntil: 0, lockdownSince: 0, previousVerification: null };
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

// ── The engine ────────────────────────────────────────────────────────────────────────────
const act = (rule, r, reason, meta = {}, { deleteMessage = true } = {}) => ({
  rule, action: r.action, reason, deleteMessage: r.action !== 'log' && deleteMessage,
  timeoutMin: r.action === 'timeout' || r.action === 'quarantine' ? (r.timeoutMin || 10) : null, meta,
});

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

  // spam: rate + repeats
  if (R.spam.enabled) {
    const inWindow = u.msgs.filter((m) => now - m.t <= R.spam.windowSec * 1000).length;
    if (inWindow > R.spam.maxMessages) out.push(act('spam', R.spam, `${inWindow} messages in ${R.spam.windowSec}s`, { count: inWindow, kind: 'rate' }));
    else if (text.length) {
      const repeats = u.msgs.filter((m) => m.h === h && now - m.t <= R.spam.repeatWindowSec * 1000).length;
      if (repeats >= R.spam.maxRepeats) out.push(act('spam', R.spam, `same message ${repeats}× in ${R.spam.repeatWindowSec}s`, { count: repeats, kind: 'repeat' }));
    }
  }
  // mentions
  if (R.mentions.enabled) {
    const m = message.mentions || {};
    const users = Number(m.users || 0), roles = Number(m.roles || 0);
    if (users > R.mentions.maxUsers) out.push(act('mentions', R.mentions, `${users} user mentions`, { users, roles }));
    else if (roles > R.mentions.maxRoles) out.push(act('mentions', R.mentions, `${roles} role mentions`, { users, roles }));
    else if (m.everyone && !R.mentions.everyone) out.push(act('mentions', R.mentions, '@everyone / @here', { everyone: true }));
  }
  // invites
  if (R.invites.enabled) {
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
  if (R.links.enabled) {
    const links = extractLinks(text).filter((l) => !domainAllowed(l.host, R.links.allowDomains));
    if (links.length) out.push(act('links', R.links, `link to ${[...new Set(links.map((l) => l.host))].join(', ')}`, { hosts: links.map((l) => l.host) }));
  }
  // words
  if (R.words.enabled && R.words.patterns.length) {
    const hits = matchWords(text, R.words.patterns);
    if (hits.length) out.push(act('words', R.words, `banned word (${hits.length} pattern${hits.length > 1 ? 's' : ''})`, { patterns: hits }));
  }
  // caps
  if (R.caps.enabled) {
    const { ratio, letters } = capsRatio(text);
    if (letters >= R.caps.minLetters && ratio >= R.caps.ratio) out.push(act('caps', R.caps, `${Math.round(ratio * 100)}% capitals`, { ratio, letters }));
  }
  // zalgo / excessive unicode
  if (R.zalgo.enabled) {
    const z = zalgoScore(text);
    if (z.combining >= R.zalgo.maxCombining || (z.combining > 0 && z.ratio >= R.zalgo.maxRatio)) out.push(act('zalgo', R.zalgo, `${z.combining} combining marks`, z));
  }
  // attachments
  if (R.attachments.enabled && Array.isArray(message.attachments) && message.attachments.length) {
    const allow = R.attachments.allowTypes, block = R.attachments.blockTypes;
    const bad = message.attachments.map((a) => extOf(a.name)).filter((e) => (allow.length ? !allow.includes(e) : block.includes(e)));
    if (bad.length) out.push(act('attachments', R.attachments, `attachment type ${bad.map((e) => `.${e || '?'}`).join(', ')}`, { types: bad }));
  }
  // anti-selfbot
  if (R.selfbot.enabled) {
    const win = u.msgs.filter((m) => now - m.t <= R.selfbot.windowSec * 1000);
    const channels = new Set(win.map((m) => m.ch));
    const perMinute = u.msgs.filter((m) => now - m.t <= 60_000).length;
    const identical = text.length >= 4 && new Set(u.msgs.filter((m) => m.h === h && now - m.t <= R.selfbot.identicalAcrossSec * 1000).map((m) => m.ch)).size;
    if (channels.size >= R.selfbot.channelsPerWindow) out.push(act('selfbot', R.selfbot, `${channels.size} channels in ${R.selfbot.windowSec}s`, { kind: 'multichannel', channels: channels.size }));
    else if (identical >= 2) out.push(act('selfbot', R.selfbot, `identical message in ${identical} channels within ${R.selfbot.identicalAcrossSec}s`, { kind: 'crosspost', channels: identical }));
    else if (perMinute > R.selfbot.maxPerMinute) out.push(act('selfbot', R.selfbot, `${perMinute} messages in a minute`, { kind: 'rate', perMinute }));
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
      const a = R.accountAge.action === 'quarantine' ? 'timeout' : R.accountAge.action;
      out.push({ rule: 'accountAge', action: a, reason: `account is ${ageDays < 1 ? 'under a day' : `${Math.floor(ageDays)} day(s)`} old (minimum ${R.accountAge.minDays})`, deleteMessage: false, timeoutMin: a === 'timeout' ? R.accountAge.timeoutMin : null, meta: { ageDays } });
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
    if (lockdownActive(state, now) && R.raid.action !== 'log') {
      out.push({ rule: 'raid', action: R.raid.action, reason: 'joined during raid lockdown', deleteMessage: false, timeoutMin: R.raid.action === 'timeout' ? R.raid.timeoutMin : null, meta: { lockdown: true } });
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

/** Carry out the actions on a message's author. */
async function applyToMember(member, guild, best, reason, targetUser) {
  if (!best || best.action === 'log' || best.action === 'delete') return null;
  const why = `Automod: ${reason}`.slice(0, 500);
  try {
    if (best.action === 'warn') {
      const r = await api.warn(targetUser.id, why, guild.id, 'automod');
      if (r) return { warned: r.count, triggered: r.triggered || null, recorded: true };
      // The site could not be reached: the local ladder stands in so a repeat offender is not
      // waved through just because the API blinked.
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
    if (!member) return { failed: 'member not in server' };
    if (best.action === 'timeout') { await member.timeout(Math.min(best.timeoutMin || 10, 28 * 24 * 60) * 60_000, why); modStats.timeouts++; return { timeoutMin: best.timeoutMin }; }
    if (best.action === 'kick') { await member.kick(why); modStats.kicks++; return { kicked: true }; }
    if (best.action === 'ban') { await guild.members.ban(targetUser.id, { reason: why }); return { banned: true }; }
  } catch (e) { return { failed: String(e?.message || e).slice(0, 200) }; }
  return null;
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
  const actions = evaluateMessage(plain, stateFor(msg.guild.id), c.automod);
  if (!actions.length) return;
  const best = strongest(actions);
  const reason = actions.map((a) => `${a.rule}: ${a.reason}`).join('; ');
  let deleted = false;
  if (actions.some((a) => a.deleteMessage)) { deleted = await msg.delete().then(() => true).catch(() => false); if (deleted) modStats.purged++; }
  const outcome = await applyToMember(msg.member, msg.guild, best, reason, msg.author);
  console.log(`[automod] ${msg.guild.name}: ${msg.author.tag} — ${reason} → ${best.action}${outcome?.failed ? ` (failed: ${outcome.failed})` : ''}`);
  await log(msg.guild.id, 'automod', {
    kind: 'automod', rule: actions.map((a) => a.rule).join('+'), action: best.action, reason, deleted, outcome,
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
    const outcome = await applyToMember(member, member.guild, best, best.reason, member.user);
    await log(member.guild.id, 'automod', {
      kind: 'automod', rule: best.rule, action: best.action, reason: best.reason, outcome,
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
