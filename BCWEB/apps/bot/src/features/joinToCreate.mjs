// Join-to-create voice. Joining the configured lobby spins up a personal temp voice
// channel (in a dedicated category, auto-created when needed) and drops a control
// panel in its text chat. Empty temp channels are cleaned up; an auto-created temp
// category is removed once its last temp channel is gone.
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { config } from '../config.mjs';
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

export async function onVoiceStateUpdate(client, oldS, newS) {
  const cfg = await config();
  const j = cfg.joinToCreate || {};
  const guild = newS.guild || oldS.guild;
  if (!guild) return;
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
      permissionOverwrites: [{ id: newS.member.id, allow: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.MuteMembers] }],
    });
    temp.set(ch.id, { ownerId: newS.member.id, guildId: guild.id, bans: new Set(), kicks: new Set(), locked: false, private: false, lastRename: 0, tempCatName: lobby.categoryId ? null : (lobby.tempCategoryName || 'Temp Voice') });
    await newS.member.voice.setChannel(ch).catch(() => {});
    await sendPanelTo(ch, newS.member).catch(() => {});
    api.activity(newS.member.id, 'voiceCreate', newS.member.user); // created a room
  }

  // Report joining any voice channel (for telemetry) + enforce per-room bans.
  if (newS.channelId && !oldS.channelId) api.activity(newS.member.id, 'voiceJoin', newS.member.user);
  if (newS.channelId && temp.has(newS.channelId)) {
    const st = temp.get(newS.channelId);
    if (st.bans.has(newS.member.id)) await newS.member.voice.disconnect('Banned from this room').catch(() => {});
  }

  // Left a temp channel that is now empty → delete it (+ its auto category if empty).
  if (oldS.channelId && temp.has(oldS.channelId)) {
    const st = temp.get(oldS.channelId);
    const ch = guild.channels.cache.get(oldS.channelId);
    if (ch && ch.members.size === 0) {
      const parent = ch.parent;
      temp.delete(ch.id);
      await ch.delete().catch(() => {});
      // Remove an auto-created temp category once empty (tempCatName set = not a fixed id).
      if (parent && st.tempCatName && parent.name === st.tempCatName && parent.children.cache.size === 0) {
        await parent.delete().catch(() => {});
      }
    }
  }
}
