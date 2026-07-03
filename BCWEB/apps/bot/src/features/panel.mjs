// The temp-voice control panel (Discord Components V2 container) + its interactions.
// Only the room owner may operate the controls. Buttons open modals, toggle settings,
// or spawn ephemeral select menus (region / kick / ban / unban / unkick).
import {
  ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, UserSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  PermissionFlagsBits, MessageFlags, AttachmentBuilder, EmbedBuilder,
} from 'discord.js';
import { temp } from '../store.mjs';

// Every panel acknowledgement is an embed card, matching the rest of the bot's
// output (defined locally — commands.mjs imports this file, so importing its
// eReply back would be circular).
const mini = (text, color = 0xf59e0b) => new EmbedBuilder().setColor(color).setDescription(text);
const eReply = (i, text, color) => i.reply({ embeds: [mini(text, color)], ephemeral: true });
const eUpdate = (i, text, color) => i.update({ content: '', embeds: [mini(text, color)], components: [] });

const RENAME_COOLDOWN_MS = 12 * 60 * 1000; // 12 minutes
const REGIONS = [['auto', 'Automatic'], ['us-east', 'US East'], ['us-west', 'US West'], ['europe', 'Europe'], ['rotterdam', 'Rotterdam'], ['singapore', 'Singapore'], ['brazil', 'Brazil'], ['japan', 'Japan']];

function btn(id, label, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
}

// Build the Components-V2 panel for a room.
function panel(channel, state) {
  const status = `Owner: <@${state.ownerId}>  ·  ${state.locked ? 'Locked' : 'Unlocked'}  ·  ${state.private ? 'Private' : 'Public'}  ·  Limit: ${channel.userLimit || 'none'}`;
  const container = new ContainerBuilder()
    .setAccentColor(0xf59e0b)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## Voice controls\n${status}`))
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      btn('vp:rename', 'Rename'), btn('vp:limit', 'Limit'), btn('vp:region', 'Region'),
      btn('vp:lock', state.locked ? 'Unlock' : 'Lock', state.locked ? ButtonStyle.Success : ButtonStyle.Danger),
      btn('vp:private', state.private ? 'Make public' : 'Make private'),
    ))
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      btn('vp:whitelist', 'Whitelist'), btn('vp:kick', 'Kick'), btn('vp:ban', 'Ban'),
      btn('vp:unban', 'Unban'), btn('vp:unkick', 'Unkick'),
    ))
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      btn('vp:preset_export', 'Export preset', ButtonStyle.Primary), btn('vp:preset_import', 'Import preset', ButtonStyle.Primary),
    ));
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

export async function sendPanelTo(channel, member) {
  const state = temp.get(channel.id);
  if (!state) return;
  await channel.send(panel(channel, state));
}

// /voice — resend the panel for the room the caller is in.
export async function sendPanel(interaction) {
  const chId = interaction.member?.voice?.channelId;
  if (!chId || !temp.has(chId)) return eReply(interaction, 'Join your temp voice channel first.');
  const ch = interaction.guild.channels.cache.get(chId);
  return interaction.reply(panel(ch, temp.get(chId)));
}

// Dispatch every button / select / modal whose id starts with the panel prefixes.
export async function handlePanelInteraction(i) {
  const id = i.customId || '';
  if (!/^(vp:|vps:|vpm:)/.test(id)) return;

  // Resolve the room. Panel lives in the voice channel's chat, so channelId == room.
  const roomId = i.channelId;
  const state = temp.get(roomId);
  const channel = i.guild?.channels.cache.get(roomId);
  if (!state || !channel) return eReply(i, 'This panel is no longer active.');
  if (i.user.id !== state.ownerId) return eReply(i, 'Only the room owner can use these controls.');

  // ── Buttons ──
  if (i.isButton()) {
    const action = id.slice(3);
    if (action === 'rename') {
      if (Date.now() - state.lastRename < RENAME_COOLDOWN_MS) {
        const mins = Math.ceil((RENAME_COOLDOWN_MS - (Date.now() - state.lastRename)) / 60000);
        return eReply(i, `Rename is on cooldown — try again in **${mins} min**.`);
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
      return refresh(i, channel, state, `Room ${state.locked ? 'locked' : 'unlocked'}.`);
    }
    if (action === 'private') {
      state.private = !state.private;
      await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { ViewChannel: state.private ? false : null }).catch(() => {});
      return refresh(i, channel, state, `Room is now ${state.private ? 'private' : 'public'}.`);
    }
    if (action === 'region') {
      const select = new StringSelectMenuBuilder().setCustomId('vps:region').setPlaceholder('Choose a voice region')
        .addOptions(REGIONS.map(([v, l]) => ({ label: l, value: v })));
      return i.reply({ embeds: [mini('Pick a region:')], components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
    }
    if (action === 'whitelist' || action === 'kick' || action === 'ban') {
      const select = new UserSelectMenuBuilder().setCustomId(`vps:${action}`).setPlaceholder(`Select a user to ${action}`).setMaxValues(1);
      return i.reply({ embeds: [mini(`Select a user to **${action}**:`)], components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
    }
    if (action === 'unban' || action === 'unkick') {
      const set = action === 'unban' ? state.bans : state.kicks;
      if (!set.size) return eReply(i, `No ${action === 'unban' ? 'banned' : 'kicked'} users.`);
      const select = new StringSelectMenuBuilder().setCustomId(`vps:${action}`).setPlaceholder('Select a user')
        .addOptions([...set].slice(0, 25).map((uid) => ({ label: uid, value: uid })));
      return i.reply({ embeds: [mini('Select a user:')], components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
    }
    if (action === 'preset_export') {
      // Export the room's current setup as a portable .json — sent EPHEMERALLY, so
      // only the clicker sees it. They keep the file/text and paste it to import.
      const preset = { v: 1, name: channel.name, limit: channel.userLimit || 0, locked: !!state.locked, private: !!state.private, region: channel.rtcRegion || null };
      const json = JSON.stringify(preset, null, 2);
      const file = new AttachmentBuilder(Buffer.from(json, 'utf8'), { name: 'voice-preset.json' });
      return i.reply({
        embeds: [mini(`Here is your room preset — keep it and paste it into **Import preset** anytime:\n\`\`\`json\n${json}\n\`\`\``)],
        files: [file], ephemeral: true,
      });
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
      return eReply(i, `Renamed to **“${name}”**. _(Next rename in 12 min.)_`);
    }
    if (id === 'vpm:limit') {
      const n = Math.max(0, Math.min(99, parseInt(i.fields.getTextInputValue('limit'), 10) || 0));
      await channel.setUserLimit(n).catch(() => {});
      return eReply(i, `Limit set to **${n || 'unlimited'}**.`);
    }
    if (id === 'vpm:preset') {
      // Parse + validate the pasted preset (strict field-by-field — never trust input).
      let p;
      try { p = JSON.parse(i.fields.getTextInputValue('json')); } catch { return eReply(i, 'That is not valid JSON — export a preset first and paste it exactly.', 0xef4444); }
      if (!p || typeof p !== 'object' || Array.isArray(p)) return eReply(i, 'Invalid preset format.', 0xef4444);
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
    if (kind === 'region') { await channel.setRTCRegion(value === 'auto' ? null : value).catch(() => {}); return eUpdate(i, `Region set to **${value}**.`); }
    const target = value; // a user id (from UserSelect or the ban/kick list)
    if (kind === 'whitelist') { await channel.permissionOverwrites.edit(target, { Connect: true, ViewChannel: true }).catch(() => {}); return eUpdate(i, `Whitelisted <@${target}>.`); }
    if (kind === 'kick') { state.kicks.add(target); await disconnect(channel, target); return eUpdate(i, `Kicked <@${target}>.`); }
    if (kind === 'ban') { state.bans.add(target); await disconnect(channel, target); return eUpdate(i, `Banned <@${target}> from this room.`, 0xef4444); }
    if (kind === 'unban') { state.bans.delete(target); return eUpdate(i, `Unbanned <@${target}>.`, 0x16a34a); }
    if (kind === 'unkick') { state.kicks.delete(target); return eUpdate(i, `Cleared kick for <@${target}>.`, 0x16a34a); }
  }
}

async function disconnect(channel, userId) {
  const m = channel.members.get(userId);
  if (m) await m.voice.disconnect('Room owner action').catch(() => {});
}

// Update the panel message in place and ack the interaction.
async function refresh(i, channel, state, note) {
  try { await i.message.edit(panel(channel, state)); } catch { /* panel may be gone */ }
  return eReply(i, note);
}
