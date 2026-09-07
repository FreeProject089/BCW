// The temp-voice control panel (Discord Components V2 container) + its interactions.
// Only the room owner may operate the controls; when the owner has left, anyone still in
// the room can claim it. Buttons open modals, toggle settings, or spawn ephemeral select
// menus (region / kick / ban / unban / unkick).
import {
  ActionRowBuilder, ButtonStyle, MessageFlags, StringSelectMenuBuilder, UserSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { temp } from '../store.mjs';
import { adoptRoom } from './joinToCreate.mjs';
import * as ui from '../ui.mjs';

const RENAME_COOLDOWN_MS = 12 * 60 * 1000; // 12 minutes
const REGIONS = [['auto', 'Automatic'], ['us-east', 'US East'], ['us-west', 'US West'], ['europe', 'Europe'], ['rotterdam', 'Rotterdam'], ['singapore', 'Singapore'], ['brazil', 'Brazil'], ['japan', 'Japan']];

const ownerPresent = (channel, state) => channel.members.has(state.ownerId);

// Build the Components-V2 panel for a room.
function panel(channel, state) {
  const present = ownerPresent(channel, state);
  const lines = [
    `Owner: <@${state.ownerId}>${present ? '' : ' *(not in the room — anyone here can claim it)*'}`,
    `${state.locked ? ui.ic('lock') : ui.ic('unlock')} ${state.locked ? 'Locked' : 'Unlocked'} · ${state.private ? ui.ic('private') : ui.ic('public')} ${state.private ? 'Private' : 'Public'} · ${ui.ic('limit')} Limit: ${channel.userLimit || 'none'} · ${ui.ic('region')} ${channel.rtcRegion || 'auto'}`,
    state.bans.size || state.kicks.size ? `-# ${state.bans.size} banned · ${state.kicks.size} kicked` : null,
  ];
  return ui.card({
    title: `${ui.ic('voice')} Voice controls`,
    body: lines,
    buttons: [
      ui.btn('vp:rename', 'Rename', ButtonStyle.Secondary, { emoji: 'rename' }), ui.btn('vp:limit', 'Limit', ButtonStyle.Secondary, { emoji: 'limit' }), ui.btn('vp:region', 'Region', ButtonStyle.Secondary, { emoji: 'region' }),
      ui.btn('vp:lock', state.locked ? 'Unlock' : 'Lock', state.locked ? ButtonStyle.Success : ButtonStyle.Danger, { emoji: state.locked ? 'unlock' : 'lock' }),
      ui.btn('vp:private', state.private ? 'Make public' : 'Make private', ButtonStyle.Secondary, { emoji: state.private ? 'public' : 'private' }),
      ui.btn('vp:whitelist', 'Whitelist'), ui.btn('vp:kick', 'Kick'), ui.btn('vp:ban', 'Ban'), ui.btn('vp:unban', 'Unban'), ui.btn('vp:unkick', 'Unkick'),
      ui.btn('vp:preset_export', 'Export preset', ButtonStyle.Primary, { emoji: 'export' }), ui.btn('vp:preset_import', 'Import preset', ButtonStyle.Primary, { emoji: 'import' }),
      !present && ui.btn('vp:claim', 'Claim this room', ButtonStyle.Success, { emoji: 'claim' }),
    ],
    footer: 'Only the owner can use these. Empty rooms are removed automatically.',
  });
}

export async function sendPanelTo(channel, member) {
  const state = temp.get(channel.id);
  if (!state) return;
  const msg = await channel.send(panel(channel, state));
  state.panelMessageId = msg.id;
}

// /voice — resend the panel for the room the caller is in.
export async function sendPanel(interaction) {
  const chId = interaction.member?.voice?.channelId;
  const ch = chId ? interaction.guild.channels.cache.get(chId) : null;
  // A room the bot lost track of (a restart) is adopted on the spot rather than refused.
  if (ch && !temp.has(chId)) await adoptRoom(ch).catch(() => null);
  if (!chId || !temp.has(chId)) return ui.line(interaction, 'Join your temp voice channel first.');
  return interaction.reply(panel(ch, temp.get(chId)));
}

// Dispatch every button / select / modal whose id starts with the panel prefixes.
export async function handlePanelInteraction(i) {
  const id = i.customId || '';
  if (!/^(vp:|vps:|vpm:)/.test(id)) return;

  // Resolve the room. Panel lives in the voice channel's chat, so channelId == room.
  const roomId = i.channelId;
  const channel = i.guild?.channels.cache.get(roomId);
  // After a restart the bot's memory of the room is gone but the room is still there, with
  // its owner recorded in the permission overwrites — re-adopt it instead of saying "no".
  if (channel && !temp.has(roomId)) await adoptRoom(channel).catch(() => null);
  const state = temp.get(roomId);
  if (!state || !channel) return ui.line(i, 'This panel is no longer active — the room it controlled is gone.');

  // Claiming: allowed to anyone IN the room once the owner is not.
  if (i.isButton() && id === 'vp:claim') {
    if (ownerPresent(channel, state)) return ui.line(i, 'The owner is still here — nothing to claim.');
    if (!channel.members.has(i.user.id)) return ui.line(i, 'Join the room first, then claim it.');
    await channel.permissionOverwrites.edit(i.user.id, { ManageChannels: true, MoveMembers: true, MuteMembers: true }).catch(() => {});
    await channel.permissionOverwrites.delete(state.ownerId).catch(() => {});
    state.ownerId = i.user.id;
    return refresh(i, channel, state, `You now own this room.`, ui.GOOD);
  }
  if (i.user.id !== state.ownerId) {
    return ui.reply(i, { body: `Only the room owner (<@${state.ownerId}>) can use these controls.${ownerPresent(channel, state) ? '' : ' They have left — you can claim the room.'}`, buttons: ownerPresent(channel, state) ? [] : [ui.btn('vp:claim', 'Claim this room', ButtonStyle.Success, { emoji: 'claim' })] });
  }

  // ── Buttons ──
  if (i.isButton()) {
    const action = id.slice(3);
    if (action === 'rename') {
      if (Date.now() - state.lastRename < RENAME_COOLDOWN_MS) {
        const mins = Math.ceil((RENAME_COOLDOWN_MS - (Date.now() - state.lastRename)) / 60000);
        return ui.line(i, `Rename is on cooldown — try again in **${mins} min**. (Discord limits channel renames to two per ten minutes.)`);
      }
      const modal = new ModalBuilder().setCustomId('vpm:rename').setTitle('Rename channel')
        .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('New name').setStyle(TextInputStyle.Short).setMaxLength(90).setRequired(true)));
      return i.showModal(modal);
    }
    if (action === 'limit') {
      const modal = new ModalBuilder().setCustomId('vpm:limit').setTitle('User limit')
        .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('limit').setLabel('Limit (0 = unlimited, max 99)').setStyle(TextInputStyle.Short).setMaxLength(2).setRequired(true)));
      return i.showModal(modal);
    }
    if (action === 'lock') {
      state.locked = !state.locked;
      await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { Connect: state.locked ? false : null }).catch(() => {});
      return refresh(i, channel, state, `Room ${state.locked ? 'locked — nobody new can join' : 'unlocked'}.`);
    }
    if (action === 'private') {
      state.private = !state.private;
      await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { ViewChannel: state.private ? false : null }).catch(() => {});
      return refresh(i, channel, state, `Room is now ${state.private ? 'private — hidden from everyone not whitelisted' : 'public'}.`);
    }
    if (action === 'region') {
      const select = new StringSelectMenuBuilder().setCustomId('vps:region').setPlaceholder('Choose a voice region')
        .addOptions(REGIONS.map(([v, l]) => ({ label: l, value: v, default: (channel.rtcRegion || 'auto') === v })));
      return ui.reply(i, { body: 'Pick a voice region:', buttons: [select] });
    }
    if (action === 'whitelist' || action === 'kick' || action === 'ban') {
      const select = new UserSelectMenuBuilder().setCustomId(`vps:${action}`).setPlaceholder(`Select a user to ${action}`).setMaxValues(1);
      return ui.reply(i, { body: `Select a user to **${action}**:`, buttons: [select] });
    }
    if (action === 'unban' || action === 'unkick') {
      const set = action === 'unban' ? state.bans : state.kicks;
      if (!set.size) return ui.line(i, `No ${action === 'unban' ? 'banned' : 'kicked'} users.`);
      const select = new StringSelectMenuBuilder().setCustomId(`vps:${action}`).setPlaceholder('Select a user')
        .addOptions([...set].slice(0, 25).map((uid) => ({ label: channel.guild.members.cache.get(uid)?.user?.username || uid, value: uid })));
      return ui.reply(i, { body: 'Select a user:', buttons: [select] });
    }
    if (action === 'preset_export') {
      // Export the room's current setup as a portable .json — sent EPHEMERALLY, so
      // only the clicker sees it. They keep the file/text and paste it to import.
      const preset = { v: 1, name: channel.name, limit: channel.userLimit || 0, locked: !!state.locked, private: !!state.private, region: channel.rtcRegion || null };
      const json = JSON.stringify(preset, null, 2);
      const msg = ui.card({ title: '📤 Room preset', body: `Keep this and paste it into **Import preset** anytime:\n\`\`\`json\n${json}\n\`\`\``, files: [ui.attach(Buffer.from(json, 'utf8'), 'voice-preset.json')] });
      return i.reply({ ...msg, flags: msg.flags | MessageFlags.Ephemeral });
    }
    if (action === 'preset_import') {
      const modal = new ModalBuilder().setCustomId('vpm:preset').setTitle('Import a voice preset')
        .addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('json').setLabel('Paste your preset .json here')
            .setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(true)
            .setPlaceholder('{ "v": 1, "name": "…", "limit": 0, "locked": false, "private": false }'),
        ));
      return i.showModal(modal);
    }
    return;
  }

  // ── Modals ──
  if (i.isModalSubmit()) {
    if (id === 'vpm:rename') {
      const name = i.fields.getTextInputValue('name').slice(0, 90);
      await channel.setName(name).catch(() => {});
      state.lastRename = Date.now();
      return refresh(i, channel, state, `Renamed to **“${name}”**. _(Next rename in 12 min.)_`);
    }
    if (id === 'vpm:limit') {
      const lim = Math.max(0, Math.min(99, parseInt(i.fields.getTextInputValue('limit'), 10) || 0));
      await channel.setUserLimit(lim).catch(() => {});
      return refresh(i, channel, state, `Limit set to **${lim || 'unlimited'}**.`);
    }
    if (id === 'vpm:preset') {
      // Parse + validate the pasted preset (strict field-by-field — never trust input).
      let p;
      try { p = JSON.parse(i.fields.getTextInputValue('json')); } catch { return ui.line(i, 'That is not valid JSON — export a preset first and paste it exactly.', { color: ui.BAD }); }
      if (!p || typeof p !== 'object' || Array.isArray(p)) return ui.line(i, 'Invalid preset format.', { color: ui.BAD });
      const limit = Math.max(0, Math.min(99, parseInt(p.limit, 10) || 0));
      const locked = !!p.locked, priv = !!p.private;
      const name = typeof p.name === 'string' ? p.name.slice(0, 90).trim() : '';
      const region = typeof p.region === 'string' && REGIONS.some(([v]) => v === p.region) ? p.region : null;
      await channel.setUserLimit(limit).catch(() => {});
      state.locked = locked; state.private = priv;
      await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { Connect: locked ? false : null, ViewChannel: priv ? false : null }).catch(() => {});
      if (region) await channel.setRTCRegion(region === 'auto' ? null : region).catch(() => {});
      // Apply the name only if the rename cooldown allows it (same rule as Rename).
      let note = `Preset applied — limit ${limit || 'unlimited'}, ${locked ? 'locked' : 'unlocked'}, ${priv ? 'private' : 'public'}.`;
      if (name && name !== channel.name) {
        if (Date.now() - state.lastRename >= RENAME_COOLDOWN_MS) {
          await channel.setName(name).catch(() => {});
          state.lastRename = Date.now();
        } else note += ' (Name skipped — rename is on cooldown.)';
      }
      return refresh(i, channel, state, note);
    }
    return;
  }

  // ── Selects ──
  if (i.isAnySelectMenu()) {
    const kind = id.slice(4);
    const value = i.values?.[0];
    if (kind === 'region') { await channel.setRTCRegion(value === 'auto' ? null : value).catch(() => {}); await repaint(channel, state); return ui.update(i, { body: `Region set to **${value}**.`, color: ui.GOOD }); }
    const target = value; // a user id (from UserSelect or the ban/kick list)
    if (kind === 'whitelist') { await channel.permissionOverwrites.edit(target, { Connect: true, ViewChannel: true }).catch(() => {}); return ui.update(i, { body: `Whitelisted <@${target}>.`, color: ui.GOOD }); }
    if (kind === 'kick') { state.kicks.add(target); await disconnect(channel, target); await repaint(channel, state); return ui.update(i, { body: `Kicked <@${target}>.` }); }
    if (kind === 'ban') { state.bans.add(target); await disconnect(channel, target); await channel.permissionOverwrites.edit(target, { Connect: false }).catch(() => {}); await repaint(channel, state); return ui.update(i, { body: `Banned <@${target}> from this room.`, color: ui.BAD }); }
    if (kind === 'unban') { state.bans.delete(target); await channel.permissionOverwrites.delete(target).catch(() => {}); await repaint(channel, state); return ui.update(i, { body: `Unbanned <@${target}>.`, color: ui.GOOD }); }
    if (kind === 'unkick') { state.kicks.delete(target); await repaint(channel, state); return ui.update(i, { body: `Cleared kick for <@${target}>.`, color: ui.GOOD }); }
  }
}

async function disconnect(channel, userId) {
  const m = channel.members.get(userId);
  if (m) await m.voice.disconnect('Room owner action').catch(() => {});
}

// Redraw the panel message in place (the one the room was created with, or the latest /voice).
async function repaint(channel, state) {
  if (!state.panelMessageId) return;
  try { const msg = await channel.messages.fetch(state.panelMessageId); await msg.edit(panel(channel, state)); } catch { state.panelMessageId = null; }
}

// Update the panel message in place and ack the interaction.
async function refresh(i, channel, state, note, color = ui.BRAND) {
  if (i.message) { try { await i.message.edit(panel(channel, state)); state.panelMessageId = i.message.id; } catch { /* panel may be gone */ } }
  else await repaint(channel, state);
  return ui.line(i, note, { color });
}
