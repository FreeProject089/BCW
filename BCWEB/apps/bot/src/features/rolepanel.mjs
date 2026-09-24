// Self-serve role panels: a rules post, or a "pick your pings" post, with the roles it
// offers attached as buttons or as a dropdown.
//
// Two jobs, and they are deliberately independent:
//
//  1. `pollRolePanels` publishes. A panel is due when the fingerprint of what it should
//     look like differs from what was last posted, so editing it in the dashboard IS
//     publishing it — there is no Publish button to remember and no way to leave a panel
//     saved-but-not-live. An edit that changes nothing visible re-posts nothing.
//
//  2. `handleRolePanelInteraction` answers clicks. It reads the panel definition fresh on
//     every press rather than trusting the message, because the message may be months old
//     and the roles on it may since have been renamed, removed, or repointed. What the
//     admin configured NOW is the authority; the message is just a picture of it.
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder, MessageFlags,
} from 'discord.js';
import * as ui from '../ui.mjs';
import { config } from '../config.mjs';
import { api } from '../api.mjs';

const STYLES = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

async function resolveChannel(client, id) {
  return client.channels.cache.get(id) || await client.channels.fetch(id).catch(() => null);
}

/**
 * Does this panel belong where it is being used? (pentest round 2, Sept 24 2026)
 *
 * A server owner's panels are stamped with their `guildId` by the API, but the channel id is
 * whatever they typed, and `client.channels.fetch` finds a channel in ANY server the bot is
 * in. So a panel is posted only into a channel of its own server, and only answers clicks
 * from its own server. Panels with no guildId are the platform admin's own and keep working
 * wherever the admin put them.
 */
export function panelBelongs(panel, guildId) {
  if (!panel?.guildId) return true;
  return !!guildId && String(guildId) === String(panel.guildId);
}

/** Discord's own limits, applied here so a too-long panel degrades instead of throwing. */
const MAX_BUTTONS = 25;   // 5 rows of 5
const MAX_OPTIONS = 25;   // one select menu

/**
 * The message body for one panel: content/embed plus the components.
 *
 * Returned as the object `send` and `edit` both take, so publishing an update is the same
 * shape as the first post — a panel that is edited must not slowly diverge from a panel
 * that is new.
 */
export function renderRolePanel(panel) {
  const roles = (panel.roles || []).filter((r) => r && r.roleId && r.label);
  const components = [];

  if (panel.mode === 'dropdown') {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`rp:sel:${panel.id}`)
      .setPlaceholder(panel.placeholder || 'Choose your roles…')
      // A single-choice dropdown still has to be able to say "none of them", or a member
      // who picks a role can never put it down again.
      .setMinValues(0)
      .setMaxValues(panel.multi ? Math.max(1, Math.min(roles.length, MAX_OPTIONS)) : 1)
      .addOptions(roles.slice(0, MAX_OPTIONS).map((r) => {
        const o = new StringSelectMenuOptionBuilder().setLabel(r.label.slice(0, 100)).setValue(r.roleId);
        if (r.description) o.setDescription(r.description.slice(0, 100));
        // An emoji Discord will not accept rejects the whole message, so a bad one is
        // dropped rather than allowed to take the panel down with it.
        if (r.emoji) { try { o.setEmoji(r.emoji); } catch { /* not a usable emoji */ } }
        return o;
      }));
    components.push(new ActionRowBuilder().addComponents(menu));
  } else {
    for (let i = 0; i < Math.min(roles.length, MAX_BUTTONS); i += 5) {
      const row = new ActionRowBuilder().addComponents(roles.slice(i, i + 5).map((r) => {
        const b = new ButtonBuilder()
          .setCustomId(`rp:${panel.id}:${r.roleId}`)
          .setLabel(r.label.slice(0, 80))
          .setStyle(STYLES[r.style] || ButtonStyle.Secondary);
        if (r.emoji) { try { b.setEmoji(r.emoji); } catch { /* not a usable emoji */ } }
        return b;
      }));
      components.push(row);
    }
  }

  if (panel.asEmbed) {
    // A Components V2 card: accent bar in the panel's colour, the title as a heading, the
    // body under it, the role buttons / dropdown inside the same block.
    let color = 0xf59e0b;
    if (typeof panel.color === 'string' && /^#?[0-9a-f]{6}$/i.test(panel.color)) color = parseInt(panel.color.replace('#', ''), 16);
    const msg = ui.card({ title: panel.title ? panel.title.slice(0, 200) : null, body: panel.body || '​', color });
    for (const row of components.slice(0, 5)) msg.components[0].addActionRowComponents(row);
    return msg;
  }
  // Plain message. The title is not lost when the embed is off — it becomes a heading,
  // which is what somebody who turned the embed off was asking for.
  const head = panel.title ? `## ${panel.title}\n` : '';
  return { content: `${head}${panel.body || ''}`.slice(0, 2000) || '​', embeds: [], components };
}

let _running = false;
export async function pollRolePanels(client) {
  if (_running) return;
  _running = true;
  try {
    const cfg = await config();
    if (!cfg.enabled) return;
    const { panels, due } = await api.rolePanels();
    if (!due?.length) return;
    for (const panel of panels.filter((x) => due.includes(x.id))) {
      const ch = await resolveChannel(client, panel.channelId);
      if (!ch?.send) { console.warn('[bot] role panel channel not found/inaccessible:', panel.channelId); continue; }
      if (!panelBelongs(panel, ch.guildId)) { console.warn('[bot] role panel channel is not in the panel\'s server, skipped:', panel.id); continue; }
      const payload = renderRolePanel(panel);
      let messageId = null;

      // Edit in place when we have posted this panel to THIS channel before. Editing keeps
      // the message where members already have it pinned or linked; posting a second copy
      // for a wording fix is how a rules channel ends up with four rules posts.
      const st = panel.state;
      if (st?.messageId && st.channelId === panel.channelId) {
        const msg = await ch.messages.fetch(st.messageId).catch(() => null);
        // An edit that fails (a panel posted as an embed before the V2 cards, say) falls
        // through to a fresh post — and the old one is removed so the channel does not
        // carry two copies of the same rules.
        if (msg) {
          const ok = await msg.edit(payload).then(() => true).catch(() => false);
          if (ok) messageId = msg.id; else await msg.delete().catch(() => {});
        }
      }
      if (!messageId) {
        const sent = await ch.send(payload).catch((e) => { console.warn('[bot] role panel send failed:', e?.message); return null; });
        if (!sent) continue;
        messageId = sent.id;
      }
      await api.rolePanelPosted(panel.id, { messageId, channelId: panel.channelId, hash: panel.hash });
    }
  } catch (e) {
    console.warn('[bot] role panel poll failed:', e?.message);
  } finally {
    _running = false;
  }
}

/** Ephemeral one-liner, so a role pick never leaves a trail in the channel. */
const say = (i, text, color = 0x22c55e) => ui.line(i, text, { color });

/**
 * Toggle the roles a member picked.
 *
 * Every role is checked against the panel definition before it is touched. The custom id
 * carries a role id, and a custom id is client-supplied text — without this check, anyone
 * able to send a component interaction could name ANY role in the server, including the
 * administrator one, and the bot would hand it over.
 */
export async function handleRolePanelInteraction(i) {
  const isButton = i.isButton() && i.customId.startsWith('rp:') && !i.customId.startsWith('rp:sel:');
  const isSelect = i.isStringSelectMenu() && i.customId.startsWith('rp:sel:');
  if (!isButton && !isSelect) return false;

  const panelId = isSelect ? i.customId.slice('rp:sel:'.length) : i.customId.split(':')[1];
  const { panels } = await api.rolePanels();
  const panel = panels.find((x) => x.id === panelId);
  if (!panel) { await say(i, 'That panel no longer exists.', 0xef4444); return true; }
  if (!panelBelongs(panel, i.guildId)) { await say(i, 'That panel belongs to another server.', 0xef4444); return true; }

  const offered = new Set((panel.roles || []).map((r) => r.roleId));
  const nameOf = (id) => (panel.roles.find((r) => r.roleId === id)?.label) || id;

  const member = i.member;
  if (!member?.roles) { await say(i, 'Could not read your roles — try again.', 0xef4444); return true; }

  // `refused` and `stale` are separate lists because they have different causes and
  // different fixes. Folded together, the bot blamed role hierarchy for a role that was
  // simply not on the panel — which sends an admin into Server Settings to fix something
  // that is not broken.
  const added = [], removed = [], refused = [], stale = [];
  const grant = async (id) => {
    // Not offered here. Usually an old message still showing a button for a role the admin
    // has since removed; it is also what an injected custom id looks like, and a custom id
    // is client-supplied text. Either way the role is never touched.
    if (!offered.has(id)) { stale.push(id); return; }
    try {
      if (member.roles.cache.has(id)) { await member.roles.remove(id); removed.push(nameOf(id)); }
      else { await member.roles.add(id); added.push(nameOf(id)); }
    } catch {
      // Almost always the role sitting above the bot's own in the hierarchy. Named, because
      // "something went wrong" sends an admin looking in the wrong place.
      refused.push(nameOf(id));
    }
  };

  if (isButton) {
    await grant(i.customId.split(':')[2]);
  } else {
    const picked = new Set(i.values || []);
    // A dropdown reports a STATE, not a click: everything the member selected they want,
    // and everything they deselected they no longer want. Toggling only what was picked
    // would make a role impossible to remove.
    for (const id of offered) {
      const has = member.roles.cache.has(id);
      if (picked.has(id) && !has) { try { await member.roles.add(id); added.push(nameOf(id)); } catch { refused.push(nameOf(id)); } }
      else if (!picked.has(id) && has) { try { await member.roles.remove(id); removed.push(nameOf(id)); } catch { refused.push(nameOf(id)); } }
    }
  }

  const parts = [];
  if (added.length) parts.push(`Added **${added.join('**, **')}**`);
  if (removed.length) parts.push(`Removed **${removed.join('**, **')}**`);
  if (refused.length) parts.push(`Could not change **${refused.join('**, **')}** — the bot's own role must sit above it in Server Settings → Roles.`);
  if (stale.length) parts.push('That role is no longer offered on this panel — it may have been removed since this message was posted.');
  await say(i, parts.join('\n') || 'Nothing changed.', (refused.length || stale.length) ? 0xf59e0b : 0x22c55e);
  return true;
}
