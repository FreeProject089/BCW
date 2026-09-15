// Logging: one routing table per guild, forum posts with tags, consistent embeds, batching,
// and a per-destination queue that respects Discord's rate limits.
//
// The DECISIONS (which destination a category goes to, which tags a post gets, what a post is
// called, how a burst is merged, when the queue may send) are pure and tested in
// test/logs.test.mjs. The Discord side at the bottom only carries them out.
//
// ── CONFIG SHAPE (per guild: `logs`, replaced wholesale by `guilds[guildId].logs`) ────────
//
//   logs: {
//     enabled: true,
//     forumId: '',                // a FORUM channel. When set, every category lands there by
//                                 // default — one post per category (or per day), tagged.
//     channelId: '',              // the legacy single TEXT channel. Fallback when no forum;
//                                 // the /config log channel (BotGuild.logChannelId) counts too.
//     forumMode: 'category',      // 'category' → one post per category · 'day' → one post per day
//     reaction: '',               // default reaction on every forum post: '' = the icon set's
//                                 // `history` glyph (admin-mappable), else a unicode or <:name:id>
//     pinSummary: true,           // the post's first message (what the post is for) is pinned
//     // Per-category overrides. A key may be a full category ('messages.delete') or a group
//     // ('messages') — the exact category wins over its group, both win over the defaults.
//     //   { kind: 'forum', id: '<forumId>', tags: ['Messages'] }   a forum, with these tag NAMES
//     //   { kind: 'channel', id: '<textChannelId>' }              a text channel
//     //   { kind: 'off' }  or the string 'off'                    nothing
//     //   '<channelId>'                                           shorthand for a text channel
//     routes: {},
//   }
//
//   alerts (global, not per guild): { enabled, channelId, generalChannelId, forumId: '' }
//     `forumId` set → every admin alert kind (perf, incident, kofi, contact, legal, moderation,
//     announcements) is a tagged post in that forum instead of a loose message.
//
// Categories (the routing keys, grouped — the dashboard renders one row per category):
export const CATEGORIES = {
  'messages.delete': { group: 'messages', label: 'Message deleted', color: 0xef4444 },
  'messages.edit': { group: 'messages', label: 'Message edited', color: 0xf59e0b },
  'messages.bulk': { group: 'messages', label: 'Messages bulk-deleted', color: 0xef4444 },
  'members.join': { group: 'members', label: 'Member joined', color: 0x16a34a },
  'members.leave': { group: 'members', label: 'Member left', color: 0x6b7280 },
  'members.kick': { group: 'members', label: 'Member kicked', color: 0xf97316 },
  'members.ban': { group: 'members', label: 'Member banned', color: 0xdc2626 },
  'members.unban': { group: 'members', label: 'Member unbanned', color: 0x16a34a },
  'members.timeout': { group: 'members', label: 'Member timed out', color: 0xf59e0b },
  'members.nick': { group: 'members', label: 'Nickname changed', color: 0x3b82f6 },
  'members.roles': { group: 'members', label: 'Roles changed', color: 0x3b82f6 },
  'voice': { group: 'voice', label: 'Voice activity', color: 0x8b5cf6 },
  'automod': { group: 'automod', label: 'Automod action', color: 0xdc2626 },
  'modcmd': { group: 'moderation', label: 'Moderation command', color: 0xf97316 },
  'server.channels': { group: 'server', label: 'Channel changed', color: 0x0ea5e9 },
  'server.roles': { group: 'server', label: 'Role changed', color: 0x0ea5e9 },
  'server.emoji': { group: 'server', label: 'Emoji / sticker changed', color: 0x0ea5e9 },
  'server.webhooks': { group: 'server', label: 'Webhooks changed', color: 0x0ea5e9 },
  'bot.errors': { group: 'bot', label: 'Bot error', color: 0xef4444 },
  'bot.config': { group: 'bot', label: 'Bot config changed', color: 0x64748b },
  'economy.casino': { group: 'economy', label: 'Casino', color: 0xf59e0b },
  'economy.shop': { group: 'economy', label: 'Shop', color: 0xf59e0b },
  'economy.season': { group: 'economy', label: 'Season', color: 0xf59e0b },
};
export const GROUPS = { messages: 'Messages', members: 'Members', voice: 'Voice', automod: 'Automod', moderation: 'Moderation', server: 'Server', bot: 'Bot', economy: 'Economy' };
export const CATEGORY_KEYS = Object.keys(CATEGORIES);
// Admin alert kinds (global forum) and the tag each one wears.
export const ALERT_KINDS = { perf: 'Perf', incident: 'Incident', kofi: 'Ko-fi', payments: 'Payments', contact: 'Contact', legal: 'Legal', moderation: 'Moderation', announce: 'Announcement' };

import { ChannelType, PermissionFlagsBits, AuditLogEvent } from 'discord.js';
import { guildConfig, config } from '../config.mjs';
import { ic } from '../ui.mjs';

// ── Normalisation + routing (pure) ─────────────────────────────────────────────────────────
const str = (v) => (typeof v === 'string' ? v.trim() : '');
export function normalizeLogs(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const routes = {};
  for (const [k, v] of Object.entries(r.routes && typeof r.routes === 'object' ? r.routes : {})) {
    if (!CATEGORIES[k] && !GROUPS[k]) continue;
    if (v === 'off' || v?.kind === 'off') { routes[k] = { kind: 'off', id: '', tags: [] }; continue; }
    if (typeof v === 'string') { if (str(v)) routes[k] = { kind: 'channel', id: str(v), tags: [] }; continue; }
    if (v && typeof v === 'object') {
      const kind = v.kind === 'forum' ? 'forum' : v.kind === 'channel' ? 'channel' : '';
      const id = str(v.id);
      if (kind && id) routes[k] = { kind, id, tags: Array.isArray(v.tags) ? v.tags.map(str).filter(Boolean).slice(0, 5) : [] };
    }
  }
  return {
    enabled: r.enabled !== false,
    forumId: str(r.forumId), channelId: str(r.channelId),
    forumMode: r.forumMode === 'day' ? 'day' : 'category',
    reaction: str(r.reaction),
    pinSummary: r.pinSummary !== false,
    routes,
  };
}

/**
 * Where a category goes. `legacyChannelId` is the /config log channel (BotGuild.logChannelId).
 *   → { kind: 'forum'|'channel'|'off', id, tags: [names], from }
 * `from` names the rule that decided, for /logs test and for the dashboard.
 */
export function resolveRoute(cfg, category, { legacyChannelId = '' } = {}) {
  const L = normalizeLogs(cfg);
  const meta = CATEGORIES[category];
  if (!meta) return { kind: 'off', id: '', tags: [], from: 'unknown category' };
  const off = { kind: 'off', id: '', tags: [], from: 'off' };
  if (!L.enabled) return { ...off, from: 'logs disabled' };
  const groupTag = GROUPS[meta.group];
  const withTags = (r, from) => ({ kind: r.kind, id: r.id, tags: r.kind === 'forum' ? (r.tags.length ? r.tags : [groupTag]) : [], from });
  if (L.routes[category]) return L.routes[category].kind === 'off' ? { ...off, from: `${category} routed off` } : withTags(L.routes[category], `route for ${category}`);
  if (L.routes[meta.group]) return L.routes[meta.group].kind === 'off' ? { ...off, from: `${meta.group} routed off` } : withTags(L.routes[meta.group], `route for ${meta.group}`);
  if (L.forumId) return { kind: 'forum', id: L.forumId, tags: [groupTag], from: 'the log forum' };
  const ch = L.channelId || str(legacyChannelId);
  if (ch) return { kind: 'channel', id: ch, tags: [], from: L.channelId ? 'the log channel' : 'the /config log channel' };
  return { ...off, from: 'nothing configured' };
}

/** The forum tag ids for a list of wanted NAMES (case-insensitive), at most five. */
export function pickTags(availableTags = [], wanted = []) {
  const out = [];
  for (const w of wanted) {
    const t = (availableTags || []).find((x) => String(x?.name || '').toLowerCase() === String(w).toLowerCase());
    if (t?.id && !out.includes(t.id)) out.push(t.id);
  }
  return out.slice(0, 5);
}
/** The tags a log forum should offer: one per group (+ whatever it already has). */
export function wantedForumTags(existing = []) {
  const have = new Set((existing || []).map((t) => String(t.name || '').toLowerCase()));
  return Object.values(GROUPS).filter((n) => !have.has(n.toLowerCase())).map((name) => ({ name }));
}

const dayOf = (ts) => new Date(ts).toISOString().slice(0, 10);
/** The post a category lands in: 'category' mode → one per category; 'day' → one per day. */
export function postNameFor(category, mode = 'category', now = Date.now()) {
  const meta = CATEGORIES[category];
  if (mode === 'day') return `Logs · ${dayOf(now)}`;
  return meta ? `${GROUPS[meta.group]} · ${meta.label}` : `Logs · ${category}`;
}
/** The first message of a post — pinned, so a reader landing mid-thread knows what it holds. */
export function postSummary(category, mode = 'category') {
  if (mode === 'day') return 'Every log category for this day, in order. Tags say which; the embeds say what.';
  const meta = CATEGORIES[category];
  return meta ? `**${meta.label}** — one entry per event. Group: ${GROUPS[meta.group]}. Change where this goes with \`/logs route\`.` : `Logs for ${category}.`;
}

// ── Embeds (pure) ─────────────────────────────────────────────────────────────────────────
const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const code = (s) => `\`${String(s).replace(/`/g, '')}\``;
const jump = (guildId, channelId, messageId) => (guildId && channelId && messageId ? `https://discord.com/channels/${guildId}/${channelId}/${messageId}` : null);
const userLine = (u) => (u ? `<@${u.id}> · ${u.tag || u.username || '?'} · ${code(u.id)}` : 'unknown');
const author = (u) => (u ? { name: `${u.tag || u.username || u.id}`, icon_url: u.avatar || undefined } : undefined);
const diffField = (name, before, after, n = 500) => ({ name, value: `**Before:** ${clip(before || '*(empty)*', n)}\n**After:** ${clip(after || '*(empty)*', n)}` });
const listField = (name, items, n = 20) => ({ name, value: clip((items || []).slice(0, n).join('\n') || '—', 1000) });

/**
 * Every log embed comes from here, so they all read the same: who (author), what (title +
 * description), the ids in the footer, before/after for edits, attachments listed, a jump
 * link where there is a message to jump to. `event` is a plain object — see index.mjs.
 */
export function embedFor(category, ev = {}) {
  const meta = CATEGORIES[category] || { label: category, color: 0x64748b, group: 'bot' };
  const e = { color: meta.color, title: meta.label, author: author(ev.user), fields: [], footer: { text: '' }, timestamp: new Date(ev.at || Date.now()).toISOString() };
  const lines = [];
  const ids = [];
  if (ev.user?.id) ids.push(`User ${ev.user.id}`);
  if (ev.channelId) ids.push(`Channel ${ev.channelId}`);
  if (ev.messageId) ids.push(`Message ${ev.messageId}`);
  if (ev.actor?.id) ids.push(`By ${ev.actor.id}`);
  switch (meta.group) {
    case 'messages': {
      if (ev.user) lines.push(userLine(ev.user));
      if (ev.channelId) lines.push(`In <#${ev.channelId}>`);
      if (category === 'messages.edit') {
        e.fields.push(diffField('Content', ev.before, ev.after));
        const j = jump(ev.guildId, ev.channelId, ev.messageId); if (j) lines.push(`[Jump to message](${j})`);
      } else if (category === 'messages.bulk') {
        e.title = `${ev.count ?? (ev.messages || []).length} messages bulk-deleted`;
        e.fields.push(listField('Messages', (ev.messages || []).map((m) => `${m.user?.tag || m.user?.id || '?'}: ${clip(m.content || '*(no text)*', 80)}`)));
      } else {
        if (ev.content) e.fields.push({ name: 'Content', value: clip(ev.content, 1000) });
      }
      if (ev.attachments?.length) e.fields.push(listField('Attachments', ev.attachments.map((a) => a.name || a.url || '?')));
      break;
    }
    case 'members': {
      lines.push(userLine(ev.user));
      if (ev.accountCreatedAt) lines.push(`Account created <t:${Math.floor(ev.accountCreatedAt / 1000)}:R>`);
      if (ev.joinedAt) lines.push(`Joined <t:${Math.floor(ev.joinedAt / 1000)}:R>`);
      if (category === 'members.nick') e.fields.push(diffField('Nickname', ev.before, ev.after, 100));
      if (category === 'members.roles') { if (ev.added?.length) e.fields.push({ name: 'Added', value: ev.added.map((r) => `<@&${r}>`).join(' ') }); if (ev.removed?.length) e.fields.push({ name: 'Removed', value: ev.removed.map((r) => `<@&${r}>`).join(' ') }); }
      if (category === 'members.timeout') e.fields.push({ name: 'Until', value: ev.until ? `<t:${Math.floor(ev.until / 1000)}:f>` : 'lifted' });
      if (ev.reason) e.fields.push({ name: 'Reason', value: clip(ev.reason, 500) });
      if (ev.actor) e.fields.push({ name: 'By', value: userLine(ev.actor) });
      if (ev.memberCount != null) e.footer.text = `${ev.memberCount} members`;
      break;
    }
    case 'voice': {
      lines.push(userLine(ev.user));
      e.title = ev.kind === 'join' ? 'Joined voice' : ev.kind === 'leave' ? 'Left voice' : ev.kind === 'move' ? 'Moved voice channel' : 'Voice state changed';
      if (ev.from) lines.push(`From <#${ev.from}>`);
      if (ev.to) lines.push(`To <#${ev.to}>`);
      if (ev.detail) lines.push(ev.detail);
      break;
    }
    case 'automod': {
      if (ev.raid) {
        e.title = ev.action === 'lockdown' ? [ic('lock'), 'Raid lockdown'].filter(Boolean).join(' ') : 'Raid lockdown ended';
        lines.push(ev.reason || '');
        if (ev.until) lines.push(`Until <t:${Math.floor(ev.until / 1000)}:f>`);
        break;
      }
      e.title = `Automod · ${ev.rule || '?'} → ${ev.action || 'log'}`;
      lines.push(userLine(ev.user));
      if (ev.channelId) lines.push(`In <#${ev.channelId}>`);
      if (ev.reason) e.fields.push({ name: 'Why', value: clip(ev.reason, 500) });
      if (ev.content) e.fields.push({ name: 'Message', value: clip(ev.content, 700) });
      if (ev.attachments?.length) e.fields.push(listField('Attachments', ev.attachments.map((a) => a.name)));
      const o = ev.outcome || {};
      const res = o.failed ? `Failed: ${o.failed}` : o.banned ? 'banned' : o.kicked ? 'kicked' : o.timeoutMin ? `timed out ${o.timeoutMin} min` : o.warned ? `warning #${o.warned}${o.triggered ? ` → ${o.triggered.kind}` : ''}${o.recorded === false ? ' (local — site unreachable)' : ''}` : ev.deleted ? 'message deleted' : 'logged';
      e.fields.push({ name: 'Result', value: res });
      break;
    }
    case 'moderation': {
      e.title = `/${ev.command || 'mod'}`;
      if (ev.actor) lines.push(`By ${userLine(ev.actor)}`);
      if (ev.user) lines.push(`On ${userLine(ev.user)}`);
      if (ev.channelId) lines.push(`In <#${ev.channelId}>`);
      if (ev.detail) e.fields.push({ name: 'Detail', value: clip(ev.detail, 800) });
      if (ev.reason) e.fields.push({ name: 'Reason', value: clip(ev.reason, 500) });
      break;
    }
    case 'server': {
      e.title = `${meta.label}${ev.kind ? ` · ${ev.kind}` : ''}`;
      if (ev.name) lines.push(`**${clip(ev.name, 100)}**${ev.targetId ? ` · ${code(ev.targetId)}` : ''}`);
      for (const c of ev.changes || []) e.fields.push(diffField(c.key, c.before, c.after, 200));
      if (ev.actor) e.fields.push({ name: 'By', value: userLine(ev.actor) });
      break;
    }
    case 'economy': {
      e.title = `${meta.label}${ev.kind ? ` · ${ev.kind}` : ''}`;
      lines.push(userLine(ev.user));
      if (ev.detail) lines.push(ev.detail);
      if (ev.delta != null) e.fields.push({ name: 'Points', value: `${ev.delta > 0 ? '+' : ''}${ev.delta}${ev.balance != null ? ` → ${ev.balance}` : ''}` });
      break;
    }
    default: {
      if (ev.title) e.title = clip(ev.title, 200);
      if (ev.message) lines.push(clip(ev.message, 1500));
      if (ev.context) e.fields.push({ name: 'Context', value: clip(JSON.stringify(ev.context), 500) });
    }
  }
  e.description = clip(lines.filter(Boolean).join('\n'), 3000) || undefined;
  e.footer.text = [e.footer.text, ids.join(' · ')].filter(Boolean).join(' · ') || undefined;
  if (!e.footer.text) delete e.footer;
  if (!e.author) delete e.author;
  if (!e.fields.length) delete e.fields;
  return e;
}

/** A burst of events of one category → the embeds for ONE message (≤ 10 embeds). */
export function mergeEvents(category, events = []) {
  if (events.length <= 10) return events.map((ev) => embedFor(category, ev));
  const meta = CATEGORIES[category] || { label: category, color: 0x64748b };
  const head = events.slice(0, 9).map((ev) => embedFor(category, ev));
  const rest = events.slice(9);
  head.push({ color: meta.color, title: `…and ${rest.length} more ${meta.label.toLowerCase()} events`, description: clip(rest.map((ev) => `${ev.user?.tag || ev.name || ev.rule || '·'} ${ev.reason || ev.content || ev.detail || ''}`.trim()).join('\n'), 3000), timestamp: new Date().toISOString() });
  return head;
}

// ── Queue (pure timing, injected sender) ──────────────────────────────────────────────────
/**
 * One queue per destination (a channel or a forum post). Sends at most one message per
 * second per destination; when more than five entries are waiting, they are merged into one
 * message (up to ten embeds). `send(destKey, payload)` is whatever the runtime gives —
 * the tests give a recorder and a fake clock.
 */
export class LogQueue {
  constructor({ send, now = () => Date.now(), schedule = (fn, ms) => setTimeout(fn, ms), minGapMs = 1000, mergeAbove = 5 } = {}) {
    this.send = send; this.now = now; this.schedule = schedule; this.minGapMs = minGapMs; this.mergeAbove = mergeAbove;
    this.queues = new Map(); // destKey → { items: [{category, ev, payload}], lastSentAt, timer }
    this.sent = 0; this.dropped = 0;
  }
  push(destKey, item) {
    let q = this.queues.get(destKey);
    if (!q) { q = { items: [], lastSentAt: 0, timer: null }; this.queues.set(destKey, q); }
    q.items.push(item);
    if (q.items.length > 200) { this.dropped += q.items.length - 200; q.items.splice(0, q.items.length - 200); }
    this._arm(destKey, q);
  }
  _arm(destKey, q) {
    if (q.timer) return;
    const wait = Math.max(0, q.lastSentAt + this.minGapMs - this.now());
    q.timer = this.schedule(() => { q.timer = null; this.flush(destKey); }, wait);
    q.timer?.unref?.();
  }
  /** Send what is due for one destination (or every destination). Returns the payloads sent. */
  flush(destKey = null) {
    if (destKey === null) { const out = []; for (const k of [...this.queues.keys()]) out.push(...this.flush(k)); return out; }
    const q = this.queues.get(destKey);
    if (!q || !q.items.length) return [];
    const now = this.now();
    if (now < q.lastSentAt + this.minGapMs) { this._arm(destKey, q); return []; }
    const payloads = this.build(q.items);
    q.items = [];
    q.lastSentAt = now;
    const out = [];
    for (const p of payloads) {
      out.push(p); this.sent++;
      try { Promise.resolve(this.send(destKey, p)).catch((e) => console.warn('[logs] send failed:', e?.message || e)); } catch (e) { console.warn('[logs] send failed:', e?.message || e); }
    }
    return out;
  }
  /** Items → payloads: raw payloads pass through; embeds are batched by category. */
  build(items) {
    const out = [];
    const embedItems = items.filter((it) => it.category);
    for (const it of items.filter((it) => !it.category)) out.push(it.payload);
    if (!embedItems.length) return out;
    if (embedItems.length <= this.mergeAbove) { for (const it of embedItems) out.push({ embeds: [embedFor(it.category, it.ev)] }); return out; }
    // Above the threshold: group by category, ten embeds a message.
    const byCat = new Map();
    for (const it of embedItems) { if (!byCat.has(it.category)) byCat.set(it.category, []); byCat.get(it.category).push(it.ev); }
    for (const [cat, evs] of byCat) out.push({ embeds: mergeEvents(cat, evs) });
    return out;
  }
  pending(destKey) { return this.queues.get(destKey)?.items.length || 0; }
}

// ── Discord side ──────────────────────────────────────────────────────────────────────────
let client = null;
const posts = new Map(); // `${forumId}:${name}` → threadId
const queue = new LogQueue({
  send: async (destKey, payload) => {
    const ch = await resolveDestination(destKey);
    if (!ch?.send) return;
    await ch.send(payload);
  },
});
export const _queue = queue;
export function initLogs(c) { client = c; posts.clear(); }

/** destKey = 'c:<channelId>' or 't:<threadId>' → a sendable channel (or null). */
async function resolveDestination(destKey) {
  if (!client) return null;
  const id = destKey.slice(2);
  return client.channels.cache.get(id) || await client.channels.fetch(id).catch(() => null);
}

const isForum = (ch) => ch && (ch.type === ChannelType.GuildForum || ch.type === ChannelType.GuildMedia);
const canSendTo = (ch) => { const me = ch?.guild?.members?.me; if (!me) return true; const p = ch.permissionsFor?.(me); return !p || (p.has(PermissionFlagsBits.ViewChannel) && p.has(PermissionFlagsBits.SendMessages)); };

/**
 * The thread for (forum, name): found in the cache / active threads, else created with the
 * summary as its first message (pinned), the tags applied, the default reaction added.
 */
export async function ensureForumPost(forum, name, { tags = [], summary = '', reaction = '', pin = true } = {}) {
  const key = `${forum.id}:${name}`;
  const known = posts.get(key);
  if (known) {
    const t = forum.threads.cache.get(known) || await forum.threads.fetch(known).catch(() => null);
    if (t && !t.archived && !t.locked) return t;
    if (t?.archived && !t.locked) { await t.setArchived(false).catch(() => {}); return t; }
    posts.delete(key);
  }
  const active = await forum.threads.fetchActive().catch(() => null);
  let thread = active ? [...active.threads.values()].find((t) => t.name === name) : null;
  if (!thread) {
    const archived = await forum.threads.fetchArchived({ limit: 50 }).catch(() => null);
    thread = archived ? [...archived.threads.values()].find((t) => t.name === name) : null;
    if (thread) await thread.setArchived(false).catch(() => {});
  }
  if (!thread) {
    const appliedTags = pickTags(forum.availableTags, tags);
    thread = await forum.threads.create({ name: name.slice(0, 100), appliedTags, message: { content: summary || name }, reason: 'Bot logs' });
    try {
      const starter = await thread.fetchStarterMessage().catch(() => null);
      if (starter) {
        if (pin) await starter.pin().catch(() => {});
        if (reaction) await starter.react(reaction).catch(() => {});
      }
    } catch { /* cosmetic */ }
  } else {
    // Tags may have been added to the forum after the post: apply what is missing.
    const want = pickTags(forum.availableTags, tags).filter((id) => !thread.appliedTags?.includes(id));
    if (want.length) await thread.setAppliedTags([...(thread.appliedTags || []), ...want].slice(0, 5)).catch(() => {});
  }
  posts.set(key, thread.id);
  return thread;
}

// The /config legacy channel per guild rides beside the config (guildLogChannels).
async function legacyChannelFor(guildId) { const cfg = await config().catch(() => null); return cfg?.guildLogChannels?.[guildId] || ''; }

/** The destination for a guild + category, resolved to a channel/thread, or null when off. */
export async function destinationFor(guildId, category) {
  if (!client) return null;
  const cfg = await guildConfig(guildId);
  if (!cfg?.enabled) return null;
  const route = resolveRoute(cfg.logs, category, { legacyChannelId: await legacyChannelFor(guildId) });
  if (route.kind === 'off') return { route, channel: null };
  const ch = client.channels.cache.get(route.id) || await client.channels.fetch(route.id).catch(() => null);
  if (!ch) return { route, channel: null, error: 'channel not found' };
  if (route.kind === 'forum' || isForum(ch)) {
    if (!isForum(ch)) return { route, channel: null, error: 'not a forum channel' };
    const L = normalizeLogs(cfg.logs);
    const name = postNameFor(category, L.forumMode);
    const thread = await ensureForumPost(ch, name, { tags: route.tags, summary: postSummary(category, L.forumMode), reaction: L.reaction || ic('history') || '', pin: L.pinSummary }).catch((e) => { console.warn('[logs] forum post failed:', e?.message || e); return null; });
    return { route, channel: thread, error: thread ? null : 'could not create the forum post' };
  }
  if (!canSendTo(ch)) return { route, channel: null, error: 'no permission to send there' };
  return { route, channel: ch };
}

/** THE entry point: queue one event for a guild's category. Never throws, never awaits Discord. */
export async function logEvent(guildId, category, ev = {}) {
  try {
    if (!guildId || !CATEGORIES[category]) return false;
    const d = await destinationFor(guildId, category);
    if (!d?.channel) return false;
    const key = `${d.channel.isThread?.() ? 't' : 'c'}:${d.channel.id}`;
    queue.push(key, { category, ev: { at: Date.now(), guildId, ...ev } });
    return true;
  } catch (e) { console.warn('[logs] logEvent failed:', e?.message || e); return false; }
}

// ── Admin alerts as forum posts (global) ──────────────────────────────────────────────────
/**
 * Post an admin alert into the alerts forum, one post per kind, tagged. Returns false when no
 * forum is configured (or it cannot be used) so the caller keeps its channel behaviour.
 * `payload` is whatever the caller would have sent to a channel — a V2 card or an embed.
 */
export async function adminAlert(kind, payload, { title = null } = {}) {
  try {
    if (!client) return false;
    const cfg = await config();
    const forumId = cfg?.alerts?.forumId;
    if (!cfg?.enabled || !forumId) return false;
    const forum = client.channels.cache.get(forumId) || await client.channels.fetch(forumId).catch(() => null);
    if (!isForum(forum)) return false;
    const tag = ALERT_KINDS[kind] || 'Announcement';
    const name = title || `${tag} alerts`;
    const thread = await ensureForumPost(forum, name, { tags: [tag], summary: `**${tag}** — every ${tag.toLowerCase()} alert the bot raises, newest last.`, reaction: ic('staff') || '', pin: true });
    queue.push(`t:${thread.id}`, { payload });
    return true;
  } catch (e) { console.warn('[logs] adminAlert failed:', e?.message || e); return false; }
}

// ── Setup (used by /logs setup) ───────────────────────────────────────────────────────────
/** Create (or complete) a log forum: the group tags, the default reaction. Returns the forum. */
export async function setupLogForum(guild, { parentId = null, name = 'bot-logs', existing = null, reaction = '' } = {}) {
  reaction = reaction || ic('history') || '';
  let forum = existing;
  if (!forum) {
    forum = await guild.channels.create({
      name, type: ChannelType.GuildForum, parent: parentId || undefined, reason: 'Bot logs (/logs setup)',
      topic: 'Bot logs — one post per category, tagged. /logs route to change destinations.',
      permissionOverwrites: [{ id: guild.id, deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.SendMessagesInThreads] }],
    });
  }
  const missing = wantedForumTags(forum.availableTags);
  if (missing.length) await forum.setAvailableTags([...(forum.availableTags || []).map((t) => ({ id: t.id, name: t.name, moderated: t.moderated, emoji: t.emoji })), ...missing].slice(0, 20), 'Bot log tags').catch((e) => console.warn('[logs] tags:', e.message));
  if (reaction && !forum.defaultReactionEmoji) await forum.setDefaultReactionEmoji(/^<a?:\w+:(\d+)>$/.test(reaction) ? { id: reaction.match(/(\d+)>$/)[1] } : { name: reaction }).catch(() => {});
  return forum;
}
/** Same for the global admin-alerts forum: one tag per alert kind. */
export async function setupAlertForum(guild, { parentId = null, name = 'admin-alerts', existing = null } = {}) {
  let forum = existing || await guild.channels.create({ name, type: ChannelType.GuildForum, parent: parentId || undefined, reason: 'Admin alerts (/logs setup)', permissionOverwrites: [{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }] });
  const have = new Set((forum.availableTags || []).map((t) => t.name.toLowerCase()));
  const missing = Object.values(ALERT_KINDS).filter((n) => !have.has(n.toLowerCase())).map((name) => ({ name }));
  if (missing.length) await forum.setAvailableTags([...(forum.availableTags || []).map((t) => ({ id: t.id, name: t.name, moderated: t.moderated, emoji: t.emoji })), ...missing].slice(0, 20), 'Alert tags').catch(() => {});
  return forum;
}

// ── Audit-log lookup ("who did it"), with a small cache ───────────────────────────────────
const auditCache = new Map(); // `${guildId}:${type}:${targetId}` → { at, entry }
export const AUDIT = AuditLogEvent;
/**
 * The audit entry for `type` on `targetId` within the last `withinMs`, or null. One fetch per
 * (guild, type, target) per 15 s — a burst of role changes does not become a burst of fetches.
 */
export async function whoDid(guild, type, targetId, { withinMs = 15_000 } = {}) {
  const key = `${guild.id}:${type}:${targetId || ''}`;
  const now = Date.now();
  const hit = auditCache.get(key);
  if (hit && now - hit.at < 15_000) return hit.entry;
  if (auditCache.size > 500) auditCache.clear();
  let entry = null;
  try {
    const me = guild.members.me;
    if (me && !me.permissions.has(PermissionFlagsBits.ViewAuditLog)) { auditCache.set(key, { at: now, entry: null }); return null; }
    const logs = await guild.fetchAuditLogs({ type, limit: 6 });
    entry = [...logs.entries.values()].find((e) => (!targetId || e.targetId === targetId || e.target?.id === targetId) && now - e.createdTimestamp <= withinMs) || null;
  } catch { entry = null; }
  auditCache.set(key, { at: now, entry });
  return entry;
}
export const actorOf = (entry) => (entry?.executor ? { id: entry.executor.id, tag: entry.executor.tag, avatar: entry.executor.displayAvatarURL?.({ size: 64 }) } : null);
export const _resetLogs = () => { posts.clear(); auditCache.clear(); queue.queues.clear(); };
