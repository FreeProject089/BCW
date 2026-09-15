// Gateway events → log events. Each handler turns a discord.js object into the plain event
// shape logs.mjs's embedFor() reads, asks the audit log who did it where that matters, and
// hands it to logEvent(). Registered from index.mjs, one line per event, so the list of what
// the bot listens to stays in one place.
import { AuditLogEvent } from 'discord.js';
import { logEvent, whoDid, actorOf } from './logs.mjs';

const userOf = (u) => (u ? { id: u.id, tag: u.tag || u.username, username: u.username, avatar: u.displayAvatarURL?.({ size: 64 }) } : null);
const attachmentsOf = (m) => (m?.attachments ? [...m.attachments.values()].map((a) => ({ name: a.name, url: a.url })) : []);
const guildIdOf = (x) => x?.guildId || x?.guild?.id || null;

// ── Messages ──────────────────────────────────────────────────────────────────────────────
export async function onMessageDelete(msg) {
  const guildId = guildIdOf(msg);
  if (!guildId || msg.author?.bot) return;
  // A partial (uncached) message has no author or content; log what there is.
  const entry = msg.author ? await whoDid(msg.guild, AuditLogEvent.MessageDelete, msg.author.id) : null;
  await logEvent(guildId, 'messages.delete', {
    user: userOf(msg.author), channelId: msg.channelId, messageId: msg.id, content: msg.partial ? '*(message was not cached — content unknown)*' : msg.content,
    attachments: attachmentsOf(msg), actor: actorOf(entry),
  });
}
export async function onMessageUpdate(oldMsg, newMsg) {
  const guildId = guildIdOf(newMsg);
  if (!guildId || newMsg.author?.bot) return;
  const before = oldMsg?.partial ? null : oldMsg?.content;
  const after = newMsg.content;
  if (before === after) return; // embeds resolving, pins — not an edit anybody typed
  await logEvent(guildId, 'messages.edit', { user: userOf(newMsg.author), channelId: newMsg.channelId, messageId: newMsg.id, before: before ?? '*(not cached)*', after, attachments: attachmentsOf(newMsg) });
}
export async function onMessageBulkDelete(messages, channel) {
  const guildId = guildIdOf(channel);
  if (!guildId) return;
  const list = [...messages.values()];
  const entry = await whoDid(channel.guild, AuditLogEvent.MessageBulkDelete, channel.id);
  await logEvent(guildId, 'messages.bulk', {
    channelId: channel.id, count: list.length, actor: actorOf(entry),
    messages: list.slice(0, 40).map((m) => ({ user: userOf(m.author), content: m.partial ? null : m.content })),
  });
}

// ── Members ───────────────────────────────────────────────────────────────────────────────
export async function onMemberJoinLog(member) {
  if (!member.guild) return;
  await logEvent(member.guild.id, 'members.join', { user: userOf(member.user), accountCreatedAt: member.user?.createdTimestamp, memberCount: member.guild.memberCount });
}
export async function onMemberLeaveLog(member) {
  if (!member.guild) return;
  // Was it a kick? The audit log says, within a few seconds. A ban fires guildBanAdd itself.
  const kick = await whoDid(member.guild, AuditLogEvent.MemberKick, member.id);
  const base = { user: userOf(member.user), joinedAt: member.joinedTimestamp || null, memberCount: member.guild.memberCount };
  if (kick) await logEvent(member.guild.id, 'members.kick', { ...base, actor: actorOf(kick), reason: kick.reason || '' });
  else await logEvent(member.guild.id, 'members.leave', base);
}
export async function onMemberUpdateLog(oldM, newM) {
  const guild = newM.guild;
  if (!guild) return;
  const user = userOf(newM.user);
  if (oldM.nickname !== newM.nickname) {
    const entry = await whoDid(guild, AuditLogEvent.MemberUpdate, newM.id);
    await logEvent(guild.id, 'members.nick', { user, before: oldM.nickname, after: newM.nickname, actor: actorOf(entry) });
  }
  const oldRoles = new Set(oldM.roles?.cache?.keys() || []), newRoles = new Set(newM.roles?.cache?.keys() || []);
  const added = [...newRoles].filter((r) => !oldRoles.has(r)), removed = [...oldRoles].filter((r) => !newRoles.has(r));
  if (added.length || removed.length) {
    const entry = await whoDid(guild, AuditLogEvent.MemberRoleUpdate, newM.id);
    await logEvent(guild.id, 'members.roles', { user, added, removed, actor: actorOf(entry) });
  }
  const oldT = oldM.communicationDisabledUntilTimestamp || 0, newT = newM.communicationDisabledUntilTimestamp || 0;
  if (oldT !== newT && (newT > Date.now() || (oldT > Date.now() && !newT))) {
    const entry = await whoDid(guild, AuditLogEvent.MemberUpdate, newM.id);
    await logEvent(guild.id, 'members.timeout', { user, until: newT > Date.now() ? newT : null, actor: actorOf(entry), reason: entry?.reason || '' });
  }
}
export async function onBanAdd(ban) {
  const entry = await whoDid(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
  await logEvent(ban.guild.id, 'members.ban', { user: userOf(ban.user), reason: ban.reason || entry?.reason || '', actor: actorOf(entry) });
}
export async function onBanRemove(ban) {
  const entry = await whoDid(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);
  await logEvent(ban.guild.id, 'members.unban', { user: userOf(ban.user), reason: entry?.reason || '', actor: actorOf(entry) });
}

// ── Voice ─────────────────────────────────────────────────────────────────────────────────
export async function onVoiceLog(oldS, newS) {
  const guild = newS?.guild || oldS?.guild;
  const member = newS?.member || oldS?.member;
  if (!guild || !member || member.user?.bot) return;
  const from = oldS?.channelId || null, to = newS?.channelId || null;
  if (from === to) {
    // Mute / deafen / stream changes: one line, only when something flipped.
    const flips = [];
    if (!!oldS?.serverMute !== !!newS?.serverMute) flips.push(newS.serverMute ? 'server-muted' : 'server-unmuted');
    if (!!oldS?.serverDeaf !== !!newS?.serverDeaf) flips.push(newS.serverDeaf ? 'server-deafened' : 'server-undeafened');
    if (!!oldS?.streaming !== !!newS?.streaming) flips.push(newS.streaming ? 'started streaming' : 'stopped streaming');
    if (!flips.length) return;
    return logEvent(guild.id, 'voice', { user: userOf(member.user), kind: 'state', to, detail: flips.join(', ') });
  }
  const kind = !from ? 'join' : !to ? 'leave' : 'move';
  await logEvent(guild.id, 'voice', { user: userOf(member.user), kind, from, to });
}

// ── Server changes ────────────────────────────────────────────────────────────────────────
const CH_TYPE = { 0: 'text', 2: 'voice', 4: 'category', 5: 'announcement', 13: 'stage', 15: 'forum', 16: 'media' };
const diffProps = (a, b, keys) => keys.filter((k) => String(a?.[k] ?? '') !== String(b?.[k] ?? '')).map((k) => ({ key: k, before: String(a?.[k] ?? ''), after: String(b?.[k] ?? '') }));

export async function onChannelCreate(ch) { if (!ch.guild) return; const e = await whoDid(ch.guild, AuditLogEvent.ChannelCreate, ch.id); await logEvent(ch.guild.id, 'server.channels', { kind: `created (${CH_TYPE[ch.type] || ch.type})`, name: ch.name, targetId: ch.id, actor: actorOf(e) }); }
export async function onChannelDelete(ch) { if (!ch.guild) return; const e = await whoDid(ch.guild, AuditLogEvent.ChannelDelete, ch.id); await logEvent(ch.guild.id, 'server.channels', { kind: `deleted (${CH_TYPE[ch.type] || ch.type})`, name: ch.name, targetId: ch.id, actor: actorOf(e) }); }
export async function onChannelUpdate(o, n) {
  if (!n.guild) return;
  const changes = diffProps(o, n, ['name', 'topic', 'nsfw', 'rateLimitPerUser', 'parentId', 'bitrate', 'userLimit', 'position']);
  if (!changes.length) return;
  const e = await whoDid(n.guild, AuditLogEvent.ChannelUpdate, n.id);
  await logEvent(n.guild.id, 'server.channels', { kind: 'updated', name: n.name, targetId: n.id, changes, actor: actorOf(e) });
}
export async function onRoleCreate(r) { const e = await whoDid(r.guild, AuditLogEvent.RoleCreate, r.id); await logEvent(r.guild.id, 'server.roles', { kind: 'created', name: r.name, targetId: r.id, actor: actorOf(e) }); }
export async function onRoleDelete(r) { const e = await whoDid(r.guild, AuditLogEvent.RoleDelete, r.id); await logEvent(r.guild.id, 'server.roles', { kind: 'deleted', name: r.name, targetId: r.id, actor: actorOf(e) }); }
export async function onRoleUpdate(o, n) {
  const changes = diffProps(o, n, ['name', 'hexColor', 'hoist', 'mentionable', 'position']);
  if (String(o.permissions?.bitfield) !== String(n.permissions?.bitfield)) {
    const before = new Set(o.permissions?.toArray?.() || []), after = new Set(n.permissions?.toArray?.() || []);
    const granted = [...after].filter((p) => !before.has(p)), revoked = [...before].filter((p) => !after.has(p));
    changes.push({ key: 'permissions', before: revoked.length ? `−${revoked.join(', ')}` : '', after: granted.length ? `+${granted.join(', ')}` : '' });
  }
  if (!changes.length) return;
  const e = await whoDid(n.guild, AuditLogEvent.RoleUpdate, n.id);
  await logEvent(n.guild.id, 'server.roles', { kind: 'updated', name: n.name, targetId: n.id, changes, actor: actorOf(e) });
}
export async function onEmojiCreate(em) { const e = await whoDid(em.guild, AuditLogEvent.EmojiCreate, em.id); await logEvent(em.guild.id, 'server.emoji', { kind: 'emoji created', name: em.name, targetId: em.id, actor: actorOf(e) }); }
export async function onEmojiDelete(em) { const e = await whoDid(em.guild, AuditLogEvent.EmojiDelete, em.id); await logEvent(em.guild.id, 'server.emoji', { kind: 'emoji deleted', name: em.name, targetId: em.id, actor: actorOf(e) }); }
export async function onEmojiUpdate(o, n) { if (o.name === n.name) return; const e = await whoDid(n.guild, AuditLogEvent.EmojiUpdate, n.id); await logEvent(n.guild.id, 'server.emoji', { kind: 'emoji renamed', name: n.name, targetId: n.id, changes: [{ key: 'name', before: o.name, after: n.name }], actor: actorOf(e) }); }
export async function onStickerCreate(s) { if (!s.guild) return; await logEvent(s.guild.id, 'server.emoji', { kind: 'sticker created', name: s.name, targetId: s.id }); }
export async function onStickerDelete(s) { if (!s.guild) return; await logEvent(s.guild.id, 'server.emoji', { kind: 'sticker deleted', name: s.name, targetId: s.id }); }
export async function onWebhooksUpdate(ch) {
  if (!ch.guild) return;
  // The event says only "something changed in this channel"; the audit log says what.
  const e = (await whoDid(ch.guild, AuditLogEvent.WebhookCreate, null, { withinMs: 10_000 })) || (await whoDid(ch.guild, AuditLogEvent.WebhookDelete, null, { withinMs: 10_000 })) || (await whoDid(ch.guild, AuditLogEvent.WebhookUpdate, null, { withinMs: 10_000 }));
  const kind = e?.action === AuditLogEvent.WebhookCreate ? 'created' : e?.action === AuditLogEvent.WebhookDelete ? 'deleted' : e?.action === AuditLogEvent.WebhookUpdate ? 'updated' : 'changed';
  await logEvent(ch.guild.id, 'server.webhooks', { kind, name: e?.target?.name || ch.name, targetId: e?.targetId || ch.id, changes: [{ key: 'channel', before: '', after: `<#${ch.id}>` }], actor: actorOf(e) });
}

// ── Bot ───────────────────────────────────────────────────────────────────────────────────
/** A handler error, in the guild it happened in (when it happened in one). */
export async function onHandlerErrorLog(guildId, message, context) {
  if (!guildId) return;
  await logEvent(guildId, 'bot.errors', { title: 'Handler error', message, context });
}
