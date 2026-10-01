// The temp-voice control panel (Discord Components V2 container) + its interactions.
//
// agent-bcw-bot: redesigned after the owner's OFD bot (packages/services jtc-panel.ts). The old
// panel was fourteen buttons in three rows; it is now one card with DROPDOWNS, one per question:
//
//   Privacy    Public / Locked / Private (one choice, the current one pre-selected)
//   Limit      no limit, 2 … 99 (the common sizes, one click)
//   Settings   Rename, Region, Bitrate (Pro), Export / Import a preset
//   Members    Allow, Remove, Block, Unblock, Clear a kick, Transfer ownership (Pro)
//   buttons    Lock / Hide toggles, Claim (only while the owner is away), Help
//
// Only the room owner may operate it; when the owner has left, anyone still in the room can
// claim it. `jtcPro` (Transfer, Bitrate) is a paid feature: without it the choice answers with
// the paywall card (paywall.mjs), linking to /bot/pricing for this server.
//
// Every old custom id (vp:rename, vp:lock, vps:kick …) still works: a panel posted before this
// change keeps answering, because rooms outlive deploys.
import {
  ActionRowBuilder, ButtonStyle, MessageFlags, StringSelectMenuBuilder, UserSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { temp } from '../store.mjs';
import { adoptRoom } from './joinToCreate.mjs';
import * as ui from '../ui.mjs';
import { makeT, tr } from '../i18n.mjs';
import { learnButton } from '../help.mjs';
import { allows, paywallCard } from '../paywall.mjs';

// This panel is drawn without an interaction (a room is created, the panel is posted), so
// there is no reader whose language to use — like every other label in this file, its button
// is English. The help CARD it opens is translated: that one is built from the click.
const T = makeT('en');

const RENAME_COOLDOWN_MS = 12 * 60 * 1000; // 12 minutes
export const REGIONS = [['auto', 'Automatic'], ['us-east', 'US East'], ['us-west', 'US West'], ['europe', 'Europe'], ['rotterdam', 'Rotterdam'], ['singapore', 'Singapore'], ['brazil', 'Brazil'], ['japan', 'Japan']];
export const QUICK_LIMITS = [0, 2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 50, 99];
/** Discord's bitrate ceiling per boost tier (bits per second). */
export const MAX_BITRATE = [96000, 128000, 256000, 384000];
export const bitrateChoices = (tier = 0) => [64000, 96000, 128000, 256000, 384000].filter((b) => b <= MAX_BITRATE[Math.max(0, Math.min(3, tier || 0))]);
/** The choices that need the paid `jtcPro` feature. */
export const PRO_ACTIONS = ['bitrate', 'transfer'];

const ownerPresent = (channel, state) => channel.members.has(state.ownerId);
const privacyOf = (state) => (state.private ? 'private' : state.locked ? 'locked' : 'public');

/** The panel card (options for ui.card). Exported for the tests: it must stay under Discord's
 *  40-component cap, and every select must pre-select the room's real state. */
export function panelCard(channel, state) {
  const present = ownerPresent(channel, state);
  const members = channel.members?.size ?? 0;
  const limit = channel.userLimit || 0;
  const owner = channel.guild?.members?.cache?.get?.(state.ownerId);
  const privacy = privacyOf(state);
  const lines = [
    `${ui.icx('voice')}Owner <@${state.ownerId}>${present ? '' : ' · away, anyone here can claim it'}`,
    [
      `${privacy === 'public' ? ui.icx('public') : ui.icx('lock')}${privacy === 'public' ? 'Public' : privacy === 'locked' ? 'Locked' : 'Private'}`,
      `${ui.icx('limit')}${members}/${limit || '∞'}`,
      `${ui.icx('region')}${(REGIONS.find(([v]) => v === (channel.rtcRegion || 'auto')) || [0, channel.rtcRegion])[1]}`,
      channel.bitrate ? `${Math.round(channel.bitrate / 1000)} kbps` : null,
    ].filter(Boolean).join('  ·  '),
    state.bans.size || state.kicks.size ? `-# ${state.bans.size} blocked · ${state.kicks.size} removed` : null,
  ];
  const privacySel = new StringSelectMenuBuilder().setCustomId('vp:privacy').setPlaceholder('Privacy').addOptions(
    ui.option('public', 'Public', { selected: privacy === 'public', description: 'Anyone can see and join', emoji: 'public' }),
    ui.option('locked', 'Locked', { selected: privacy === 'locked', description: 'Visible, nobody new can join', emoji: 'lock' }),
    ui.option('private', 'Private', { selected: privacy === 'private', description: 'Hidden from everyone not allowed', emoji: 'private' }),
  );
  const limitSel = new StringSelectMenuBuilder().setCustomId('vp:qlimit').setPlaceholder('Member limit').addOptions(
    [
      ...QUICK_LIMITS.map((n) => ui.option(String(n), n ? `${n} members` : 'No limit', { selected: n === limit })),
      // A limit set through the modal (7, 33…) is shown as its own selected entry.
      ...(QUICK_LIMITS.includes(limit) ? [] : [ui.option(String(limit), `${limit} members`, { selected: true })]),
    ],
  );
  const settingsSel = new StringSelectMenuBuilder().setCustomId('vp:settings').setPlaceholder('Room settings…').addOptions(
    ui.option('rename', 'Rename', { description: 'Two renames per ten minutes (Discord)', emoji: 'rename' }),
    ui.option('limit', 'Custom limit', { description: 'Any number from 0 to 99', emoji: 'limit' }),
    ui.option('region', 'Voice region', { description: 'Automatic, or pick one', emoji: 'region' }),
    ui.option('bitrate', 'Audio quality (Pro)', { description: 'Up to what this server’s boosts allow' }),
    ui.option('preset_export', 'Export a preset', { description: 'Save this setup as a file', emoji: 'export' }),
    ui.option('preset_import', 'Import a preset', { description: 'Paste a saved setup', emoji: 'import' }),
  );
  const membersSel = new StringSelectMenuBuilder().setCustomId('vp:members').setPlaceholder('Members…').addOptions(
    ui.option('whitelist', 'Allow a member', { description: 'Can join even when locked or private' }),
    ui.option('kick', 'Remove from the room', { description: 'Disconnects them' }),
    ui.option('ban', 'Block a member', { description: 'Removed, and cannot come back' }),
    ui.option('unban', 'Unblock a member', { description: 'Lets a blocked member back in' }),
    ui.option('unkick', 'Clear a removal', { description: 'Forget a past removal' }),
    ui.option('transfer', 'Transfer ownership (Pro)', { description: 'Give the room to someone here', emoji: 'claim' }),
  );
  return {
    title: channel.name || 'Voice room',
    thumb: owner?.displayAvatarURL?.({ size: 128 }) || null,
    body: lines,
    buttons: [
      privacySel, limitSel, settingsSel, membersSel,
      ui.btn('vp:lock', state.locked ? 'Unlock' : 'Lock', state.locked ? ButtonStyle.Success : ButtonStyle.Secondary, { emoji: state.locked ? 'unlock' : 'lock' }),
      ui.btn('vp:private', state.private ? 'Show' : 'Hide', state.private ? ButtonStyle.Success : ButtonStyle.Secondary, { emoji: state.private ? 'public' : 'private' }),
      !present && ui.btn('vp:claim', 'Claim', ButtonStyle.Primary, { emoji: 'claim' }),
      learnButton(T, 'voice'),
    ],
    footer: 'Only the owner can use these. Empty rooms are removed automatically.',
  };
}

const panel = (channel, state) => ui.card(panelCard(channel, state));

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

/** A pro choice without the plan: the paywall card, in the clicker's language. */
async function needsPro(i, action) {
  if (!PRO_ACTIONS.includes(action)) return false;
  if (await allows(i.guildId, 'jtcPro')) return false;
  const { t } = await tr(i);
  await ui.reply(i, paywallCard(t, { error: 'plan_required', feature: 'jtcPro' }, i.guildId));
  return true;
}

// One action, whichever control asked for it (an old button or a new dropdown entry).
async function runAction(i, channel, state, action) {
  if (await needsPro(i, action)) return undefined;
  if (action === 'rename') {
    if (Date.now() - state.lastRename < RENAME_COOLDOWN_MS) {
      const mins = Math.ceil((RENAME_COOLDOWN_MS - (Date.now() - state.lastRename)) / 60000);
      return ui.line(i, `Rename is on cooldown, try again in **${mins} min**. (Discord allows two renames per ten minutes.)`);
    }
    const modal = new ModalBuilder().setCustomId('vpm:rename').setTitle('Rename the room')
      .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('New name').setStyle(TextInputStyle.Short).setMaxLength(90).setRequired(true).setValue(String(channel.name || '').slice(0, 90))));
    return i.showModal(modal);
  }
  if (action === 'limit') {
    const modal = new ModalBuilder().setCustomId('vpm:limit').setTitle('Member limit')
      .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('limit').setLabel('Limit (0 = none, max 99)').setStyle(TextInputStyle.Short).setMaxLength(2).setRequired(true).setValue(String(channel.userLimit || 0))));
    return i.showModal(modal);
  }
  if (action === 'lock') {
    state.locked = !state.locked;
    await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { Connect: state.locked ? false : null }).catch(() => {});
    return refresh(i, channel, state, state.locked ? 'Room locked, nobody new can join.' : 'Room unlocked.');
  }
  if (action === 'private') {
    state.private = !state.private;
    await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { ViewChannel: state.private ? false : null }).catch(() => {});
    return refresh(i, channel, state, state.private ? 'Room hidden from everyone not allowed.' : 'Room visible again.');
  }
  if (action === 'region') {
    const select = new StringSelectMenuBuilder().setCustomId('vps:region').setPlaceholder('Voice region')
      .addOptions(REGIONS.map(([v, l]) => ui.option(v, l, { selected: (channel.rtcRegion || 'auto') === v })));
    return ui.reply(i, { body: 'Pick a voice region:', buttons: [select] });
  }
  if (action === 'bitrate') {
    const tier = channel.guild?.premiumTier || 0;
    const select = new StringSelectMenuBuilder().setCustomId('vps:bitrate').setPlaceholder('Audio quality')
      .addOptions(bitrateChoices(tier).map((b) => ui.option(String(b), `${b / 1000} kbps`, { selected: channel.bitrate === b })));
    return ui.reply(i, { body: `Audio quality, up to **${MAX_BITRATE[Math.min(3, tier)] / 1000} kbps** on this server (more with boosts):`, buttons: [select] });
  }
  if (action === 'whitelist' || action === 'kick' || action === 'ban' || action === 'transfer') {
    const verb = { whitelist: 'allow', kick: 'remove', ban: 'block', transfer: 'give the room to' }[action];
    const select = new UserSelectMenuBuilder().setCustomId(`vps:${action}`).setPlaceholder(`Who to ${verb}`).setMaxValues(1);
    return ui.reply(i, { body: action === 'transfer' ? 'Pick someone **in the room** to give it to:' : `Pick who to **${verb}**:`, buttons: [select] });
  }
  if (action === 'unban' || action === 'unkick') {
    const set = action === 'unban' ? state.bans : state.kicks;
    if (!set.size) return ui.line(i, action === 'unban' ? 'Nobody is blocked.' : 'Nobody was removed.');
    const select = new StringSelectMenuBuilder().setCustomId(`vps:${action}`).setPlaceholder('Pick a member')
      .addOptions([...set].slice(0, 25).map((uid) => ui.option(uid, channel.guild.members.cache.get(uid)?.user?.username || uid)));
    return ui.reply(i, { body: 'Pick a member:', buttons: [select] });
  }
  if (action === 'preset_export') {
    // Export the room's current setup as a portable .json — sent EPHEMERALLY, so
    // only the clicker sees it. They keep the file/text and paste it to import.
    const preset = { v: 1, name: channel.name, limit: channel.userLimit || 0, locked: !!state.locked, private: !!state.private, region: channel.rtcRegion || null };
    const json = JSON.stringify(preset, null, 2);
    const msg = ui.card({ title: `${ui.icx('export')}Room preset`, body: `Keep this and paste it into **Import a preset** anytime:\n\`\`\`json\n${json}\n\`\`\``, files: [ui.attach(Buffer.from(json, 'utf8'), 'voice-preset.json')] });
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
  return undefined;
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
  if (!state || !channel) return ui.line(i, 'This panel is no longer active: the room it controlled is gone.');

  // Claiming: allowed to anyone IN the room once the owner is not.
  if (i.isButton() && id === 'vp:claim') {
    if (ownerPresent(channel, state)) return ui.line(i, 'The owner is still here, nothing to claim.');
    if (!channel.members.has(i.user.id)) return ui.line(i, 'Join the room first, then claim it.');
    await giveRoom(channel, state, i.user.id);
    return refresh(i, channel, state, 'You now own this room.', ui.GOOD);
  }
  if (i.user.id !== state.ownerId) {
    return ui.reply(i, { body: `Only the room owner (<@${state.ownerId}>) can use these controls.${ownerPresent(channel, state) ? '' : ' They have left, you can claim the room.'}`, buttons: ownerPresent(channel, state) ? [] : [ui.btn('vp:claim', 'Claim this room', ButtonStyle.Success, { emoji: 'claim' })] });
  }

  // ── Buttons (the current ones and every one an older panel may still carry) ──
  if (i.isButton()) return runAction(i, channel, state, id.slice(3));

  // ── The panel's own dropdowns ──
  if (i.isStringSelectMenu() && id.startsWith('vp:')) {
    const value = i.values?.[0] || '';
    if (id === 'vp:privacy') {
      state.locked = value === 'locked';
      state.private = value === 'private';
      await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { Connect: state.locked ? false : null, ViewChannel: state.private ? false : null }).catch(() => {});
      return refresh(i, channel, state, value === 'public' ? 'Room is public.' : value === 'locked' ? 'Room locked, nobody new can join.' : 'Room is private.');
    }
    if (id === 'vp:qlimit') {
      const lim = Math.max(0, Math.min(99, parseInt(value, 10) || 0));
      await channel.setUserLimit(lim).catch(() => {});
      return refresh(i, channel, state, `Limit set to **${lim || 'none'}**.`);
    }
    if (id === 'vp:settings' || id === 'vp:members') {
      // The dropdown keeps showing the choice until the panel is redrawn: redraw it once the
      // follow-up (a modal, an ephemeral picker) is on screen, so it reads as a menu again.
      const r = await runAction(i, channel, state, value);
      setTimeout(() => { repaint(channel, state).catch(() => {}); }, 1500).unref?.();
      return r;
    }
    return undefined;
  }

  // ── Modals ──
  if (i.isModalSubmit()) {
    if (id === 'vpm:rename') {
      const name = i.fields.getTextInputValue('name').slice(0, 90).trim();
      if (!name) return ui.line(i, 'A name cannot be empty.', { color: ui.BAD });
      await channel.setName(name).catch(() => {});
      state.lastRename = Date.now();
      return refresh(i, channel, state, `Renamed to **${name.replace(/[*_`~|]/g, '')}**. Next rename in 12 min.`);
    }
    if (id === 'vpm:limit') {
      const lim = Math.max(0, Math.min(99, parseInt(i.fields.getTextInputValue('limit'), 10) || 0));
      await channel.setUserLimit(lim).catch(() => {});
      return refresh(i, channel, state, `Limit set to **${lim || 'none'}**.`);
    }
    if (id === 'vpm:preset') {
      // Parse + validate the pasted preset (strict field-by-field — never trust input).
      let p;
      try { p = JSON.parse(i.fields.getTextInputValue('json')); } catch { return ui.line(i, 'That is not valid JSON. Export a preset first and paste it exactly.', { color: ui.BAD }); }
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
      let note = `Preset applied: limit ${limit || 'none'}, ${locked ? 'locked' : 'unlocked'}, ${priv ? 'private' : 'public'}.`;
      if (name && name !== channel.name) {
        if (Date.now() - state.lastRename >= RENAME_COOLDOWN_MS) {
          await channel.setName(name).catch(() => {});
          state.lastRename = Date.now();
        } else note += ' (Name skipped, rename is on cooldown.)';
      }
      return refresh(i, channel, state, note);
    }
    return undefined;
  }

  // ── The ephemeral pickers (vps:*) ──
  if (i.isAnySelectMenu()) {
    const kind = id.slice(4);
    const value = i.values?.[0];
    if (kind === 'region') {
      if (!REGIONS.some(([v]) => v === value)) return undefined;
      await channel.setRTCRegion(value === 'auto' ? null : value).catch(() => {});
      await repaint(channel, state);
      return ui.update(i, { body: `Region set to **${(REGIONS.find(([v]) => v === value) || [0, value])[1]}**.`, color: ui.GOOD });
    }
    if (kind === 'bitrate') {
      if (await needsProUpdate(i)) return undefined;
      const b = parseInt(value, 10);
      if (!bitrateChoices(channel.guild?.premiumTier || 0).includes(b)) return ui.update(i, { body: 'That quality is not available on this server.', color: ui.BAD });
      await channel.setBitrate(b).catch(() => {});
      await repaint(channel, state);
      return ui.update(i, { body: `Audio quality set to **${b / 1000} kbps**.`, color: ui.GOOD });
    }
    const target = value; // a user id (from UserSelect or the block/removal list)
    // Never yourself, the bot, or the owner: none of those makes sense and the last two break the room.
    if (['whitelist', 'kick', 'ban', 'transfer'].includes(kind) && (target === i.user.id || target === i.client?.user?.id || target === state.ownerId)) {
      return ui.update(i, { body: 'Pick someone else.', color: ui.BAD });
    }
    if (kind === 'whitelist') { await channel.permissionOverwrites.edit(target, { Connect: true, ViewChannel: true, Speak: true }).catch(() => {}); return ui.update(i, { body: `<@${target}> can join now.`, color: ui.GOOD }); }
    if (kind === 'kick') { state.kicks.add(target); await disconnect(channel, target); await repaint(channel, state); return ui.update(i, { body: `Removed <@${target}>.` }); }
    if (kind === 'ban') { state.bans.add(target); await disconnect(channel, target); await channel.permissionOverwrites.edit(target, { Connect: false }).catch(() => {}); await repaint(channel, state); return ui.update(i, { body: `Blocked <@${target}> from this room.`, color: ui.BAD }); }
    if (kind === 'unban') { state.bans.delete(target); await channel.permissionOverwrites.delete(target).catch(() => {}); await repaint(channel, state); return ui.update(i, { body: `Unblocked <@${target}>.`, color: ui.GOOD }); }
    if (kind === 'unkick') { state.kicks.delete(target); await repaint(channel, state); return ui.update(i, { body: `Cleared the removal of <@${target}>.`, color: ui.GOOD }); }
    if (kind === 'transfer') {
      if (await needsProUpdate(i)) return undefined;
      if (!channel.members.has(target)) return ui.update(i, { body: 'They have to be in the room.', color: ui.BAD });
      await giveRoom(channel, state, target);
      await repaint(channel, state);
      return ui.update(i, { body: `<@${target}> owns the room now.`, color: ui.GOOD });
    }
  }
  return undefined;
}

/** The pro check on an ephemeral picker: it replaces the picker with the paywall card. */
async function needsProUpdate(i) {
  if (await allows(i.guildId, 'jtcPro')) return false;
  const { t } = await tr(i);
  await ui.update(i, paywallCard(t, { error: 'plan_required', feature: 'jtcPro' }, i.guildId));
  return true;
}

/** Hand the room to `userId`: their overwrite records the ownership (see joinToCreate.mjs). */
async function giveRoom(channel, state, userId) {
  await channel.permissionOverwrites.edit(userId, { ManageChannels: true, MoveMembers: true, MuteMembers: true }).catch(() => {});
  if (state.ownerId && state.ownerId !== userId) await channel.permissionOverwrites.delete(state.ownerId).catch(() => {});
  state.ownerId = userId;
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
  if (i.message && !(i.message.flags?.has?.(MessageFlags.Ephemeral))) { try { await i.message.edit(panel(channel, state)); state.panelMessageId = i.message.id; } catch { /* panel may be gone */ } }
  else await repaint(channel, state);
  return ui.line(i, note, { color });
}
