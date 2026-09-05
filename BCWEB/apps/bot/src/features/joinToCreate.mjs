// Join-to-create voice. Joining the configured lobby spins up a personal temp voice
// channel (in a dedicated category, auto-created when needed) and drops a control
// panel in its text chat. Empty temp channels are cleaned up; an auto-created temp
// category is removed once its last temp channel is gone.
//
// The bot's memory of its rooms is in-process (store.mjs). That used to mean a restart
// forgot every room: the panel answered "no longer active", and an emptied room was never
// deleted. Two things fix that without a database:
//   · the OWNER is recorded in the room itself — the member permission overwrite granting
//     ManageChannels — so a room can be re-adopted from what Discord already holds;
//   · a sweep (on ready + every two minutes) re-adopts rooms with people in them and deletes
//     the empty ones, including rooms created by a previous process.
import { ChannelType, PermissionFlagsBits, OverwriteType } from 'discord.js';
import { guildConfig } from '../config.mjs';
import { api } from '../api.mjs';
import { temp } from '../store.mjs';
import { sendPanelTo } from './panel.mjs';

// Find/create the temp category for a specific lobby config.
async function ensureCategory(guild, lobby) {
  if (lobby.categoryId && guild.channels.cache.get(lobby.categoryId)) return guild.channels.cache.get(lobby.categoryId);
  const name = lobby.tempCategoryName || 'Temp Voice';
  let cat = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === name);
  if (!cat) cat = await guild.channels.create({ name, type: ChannelType.GuildCategory });
  return cat;
}
// The configured lobbies (new `lobbies[]` array, or the legacy single fields).
function getLobbies(j) {
  if (j.lobbies?.length) return j.lobbies;
  return j.lobbyChannelId ? [{ lobbyChannelId: j.lobbyChannelId, categoryId: j.categoryId, tempCategoryName: j.tempCategoryName }] : [];
}

// Every category a guild's temp rooms may live in, with the lobby ids to never touch.
async function tempAreas(guild) {
  const cfg = await guildConfig(guild.id);
  const j = cfg.joinToCreate || {};
  const lobbies = getLobbies(j);
  const lobbyIds = new Set(lobbies.map((l) => l.lobbyChannelId));
  const areas = [];
  for (const l of lobbies) {
    const cat = l.categoryId
      ? guild.channels.cache.get(l.categoryId)
      : guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === (l.tempCategoryName || 'Temp Voice'));
    if (cat) areas.push({ cat, tempCatName: l.categoryId ? null : (l.tempCategoryName || 'Temp Voice') });
  }
  return { areas, lobbyIds, enabled: !!(cfg.enabled && j.enabled) };
}

// Who owns a room the bot did not create in this process: the member overwrite that grants
// ManageChannels (set at creation). Falls back to whoever is in it.
function ownerFromOverwrites(channel) {
  for (const ow of channel.permissionOverwrites.cache.values()) {
    if (ow.type === OverwriteType.Member && ow.allow.has(PermissionFlagsBits.ManageChannels)) return ow.id;
  }
  return channel.members.first()?.id || null;
}

/** Re-adopt one voice channel as a temp room (after a restart). Returns the state, or null
 *  when the channel is not in a temp area or is a lobby. */
export async function adoptRoom(channel) {
  if (!channel || channel.type !== ChannelType.GuildVoice || temp.has(channel.id)) return temp.get(channel?.id) || null;
  const { areas, lobbyIds } = await tempAreas(channel.guild);
  if (lobbyIds.has(channel.id)) return null;
  const area = areas.find((a) => a.cat.id === channel.parentId);
  if (!area) return null;
  const ownerId = ownerFromOverwrites(channel);
  if (!ownerId) return null;
  const everyone = channel.permissionOverwrites.cache.get(channel.guild.id);
  const state = {
    ownerId, guildId: channel.guild.id, bans: new Set(), kicks: new Set(),
    locked: !!everyone?.deny.has(PermissionFlagsBits.Connect), private: !!everyone?.deny.has(PermissionFlagsBits.ViewChannel),
    lastRename: 0, tempCatName: area.tempCatName, panelMessageId: null, adopted: true,
  };
  // The bans a previous process applied survive as Connect-denied member overwrites.
  for (const ow of channel.permissionOverwrites.cache.values()) {
    if (ow.type === OverwriteType.Member && ow.id !== ownerId && ow.deny.has(PermissionFlagsBits.Connect)) state.bans.add(ow.id);
  }
  temp.set(channel.id, state);
  return state;
}

// Delete a room (and its auto-created category when that is now empty).
async function removeRoom(channel, state) {
  const parent = channel.parent;
  temp.delete(channel.id);
  await channel.delete('Temp voice room empty').catch(() => {});
  if (parent && state?.tempCatName && parent.name === state.tempCatName) {
    const left = parent.children.cache.filter((c) => c.id !== channel.id);
    if (left.size === 0) await parent.delete('Temp voice category empty').catch(() => {});
  }
}

/** On ready and every couple of minutes: forget rooms that are gone, delete rooms that are
 *  empty (ours or a previous process's), adopt rooms with people in them. */
export async function sweepTempRooms(client) {
  let adopted = 0, removed = 0;
  // 1. What we remember: still there? still occupied?
  for (const [id, st] of [...temp.entries()]) {
    const guild = client.guilds.cache.get(st.guildId);
    const ch = guild?.channels.cache.get(id);
    if (!ch) { temp.delete(id); continue; }
    if (ch.members.size === 0) { await removeRoom(ch, st); removed++; }
  }
  // 2. What Discord holds that we do not: every voice channel in a temp area.
  for (const guild of client.guilds.cache.values()) {
    let info;
    try { info = await tempAreas(guild); } catch { continue; }
    for (const { cat, tempCatName } of info.areas) {
      for (const ch of cat.children.cache.values()) {
        if (ch.type !== ChannelType.GuildVoice || info.lobbyIds.has(ch.id) || temp.has(ch.id)) continue;
        if (ch.members.size === 0) { await removeRoom(ch, { tempCatName }); removed++; continue; }
        if (await adoptRoom(ch)) adopted++;
      }
    }
  }
  if (adopted || removed) console.log(`[bot] temp voice sweep: adopted ${adopted}, removed ${removed}`);
  return { adopted, removed };
}

export async function onVoiceStateUpdate(client, oldS, newS) {
  const guild = newS.guild || oldS.guild;
  if (!guild) return;
  const cfg = await guildConfig(guild.id);
  const j = cfg.joinToCreate || {};
  const lobbies = getLobbies(j);
  const lobby = newS.channelId ? lobbies.find((l) => l.lobbyChannelId === newS.channelId) : null;

  // Joined a lobby → create + move into a fresh temp channel in that lobby's category.
  if (cfg.enabled && j.enabled && lobby) {
    const active = [...temp.values()].filter((t) => t.guildId === guild.id).length;
    if (active >= (cfg.limits?.maxTempChannels || 50)) return;
    const cat = await ensureCategory(guild, lobby);
    const ch = await guild.channels.create({
      name: `${newS.member.user.username}'s room`.slice(0, 90),
      type: ChannelType.GuildVoice,
      parent: cat.id,
      // The owner overwrite doubles as the record of who owns the room — see adoptRoom.
      permissionOverwrites: [{ id: newS.member.id, allow: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.MuteMembers] }],
    });
    temp.set(ch.id, { ownerId: newS.member.id, guildId: guild.id, bans: new Set(), kicks: new Set(), locked: false, private: false, lastRename: 0, tempCatName: lobby.categoryId ? null : (lobby.tempCategoryName || 'Temp Voice'), panelMessageId: null });
    await newS.member.voice.setChannel(ch).catch(() => {});
    await sendPanelTo(ch, newS.member).catch(() => {});
    api.activity(guild.id, newS.member.id, 'voiceCreate', newS.member.user); // created a room
  }

  // Report joining any voice channel (for telemetry) + enforce per-room bans.
  if (newS.channelId && !oldS.channelId) api.activity(guild.id, newS.member.id, 'voiceJoin', newS.member.user);
  if (newS.channelId && newS.channelId !== oldS.channelId) {
    const ch = guild.channels.cache.get(newS.channelId);
    // A room from before a restart: adopt it the moment somebody walks in.
    if (ch && !temp.has(ch.id)) await adoptRoom(ch).catch(() => null);
    const st = temp.get(newS.channelId);
    if (st?.bans.has(newS.member.id)) await newS.member.voice.disconnect('Banned from this room').catch(() => {});
  }

  // Left a temp channel that is now empty → delete it (+ its auto category if empty).
  if (oldS.channelId && oldS.channelId !== newS.channelId) {
    const ch = guild.channels.cache.get(oldS.channelId);
    if (ch && !temp.has(ch.id)) await adoptRoom(ch).catch(() => null);
    const st = temp.get(oldS.channelId);
    if (st && ch && ch.members.size === 0) await removeRoom(ch, st);
  }
}
