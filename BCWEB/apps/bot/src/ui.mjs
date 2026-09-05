// Every message the bot sends is a Discord Components V2 container: an accent bar, a title,
// body text, optional media / thumbnail / sections, and buttons — instead of the older embed.
// One builder here so /level, /shop, /leaderboard, the casino, the voice panel and every
// one-line acknowledgement look like the same bot.
//
// V2 rules worth knowing (they are the reason the helpers exist):
//   · a V2 message has NO `content` and NO `embeds`: everything is a component;
//   · the flag is per message and cannot be changed by an edit — a message sent as V2 is
//     edited as V2 (so `update`/`editReply` here always carry the flag);
//   · ≤ 40 components per message, ≤ 4000 characters of text across them.
import {
  ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize,
  MediaGalleryBuilder, MediaGalleryItemBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, AttachmentBuilder,
} from 'discord.js';

export const BRAND = 0xf59e0b;
export const GOOD = 0x16a34a;
export const BAD = 0xef4444;
export const INFO = 0x3b82f6;

const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

/** A plain button. `id` becomes the custom id, or a URL when it starts with http(s). */
export function btn(id, label, style = ButtonStyle.Secondary, { emoji = null, disabled = false } = {}) {
  const b = new ButtonBuilder().setLabel(clip(label, 80)).setDisabled(disabled);
  if (/^https?:\/\//.test(id)) b.setStyle(ButtonStyle.Link).setURL(id);
  else b.setCustomId(id).setStyle(style);
  if (emoji) b.setEmoji(emoji);
  return b;
}

/** Buttons split into rows of ≤ 5 (Discord's row limit). Accepts ButtonBuilders or a select. */
export function rows(...items) {
  const out = [];
  let row = null;
  for (const it of items.flat().filter(Boolean)) {
    // A select menu owns its row.
    if (!(it instanceof ButtonBuilder)) { out.push(new ActionRowBuilder().addComponents(it)); row = null; continue; }
    if (!row || row.components.length >= 5) { row = new ActionRowBuilder(); out.push(row); }
    row.addComponents(it);
  }
  return out;
}

/**
 * Build one card.
 *   title      — the heading (rendered as `## title`)
 *   body       — markdown text under it (string, or array of lines)
 *   color      — accent bar
 *   thumb      — a URL shown beside the title (Discord CDN avatars are safe; site images are
 *                attached instead, see `attach`)
 *   sections   — [{ text, button }] rows with a button accessory (a shop, a list of actions)
 *   image      — 'attachment://name' (with `files`) or a public URL, shown full-width
 *   files      — AttachmentBuilders that `image` refers to
 *   footer     — small trailing text (rendered as -# small)
 *   buttons    — ButtonBuilders / selects, laid out in rows
 */
export function card({ title = null, body = '', color = BRAND, thumb = null, sections = [], image = null, files = [], footer = null, buttons = [] } = {}) {
  const c = new ContainerBuilder().setAccentColor(color);
  const text = [title ? `## ${clip(title, 200)}` : null, Array.isArray(body) ? body.filter(Boolean).join('\n') : body].filter(Boolean).join('\n');
  if (thumb) {
    c.addSectionComponents(new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(clip(text || '​', 3500)))
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumb)));
  } else if (text) {
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(clip(text, 3500)));
  }
  if (image) c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(image)));
  if (sections.length) {
    c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    for (const s of sections.slice(0, 12)) {
      const sec = new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(clip(s.text, 900)));
      if (s.button) sec.setButtonAccessory(s.button);
      else if (s.thumb) sec.setThumbnailAccessory(new ThumbnailBuilder().setURL(s.thumb));
      c.addSectionComponents(sec);
    }
  }
  if (footer) {
    c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false));
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${clip(footer, 300)}`));
  }
  const btnRows = rows(...buttons);
  if (btnRows.length) {
    c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false));
    for (const r of btnRows.slice(0, 5)) c.addActionRowComponents(r);
  }
  return { components: [c], files, flags: MessageFlags.IsComponentsV2 };
}

/** Reply with a card (ephemeral by default — most acknowledgements are for one person). */
export function reply(i, opts, { ephemeral = true } = {}) {
  const msg = card(opts);
  if (ephemeral) msg.flags |= MessageFlags.Ephemeral;
  return i.reply(msg);
}
/** Edit a deferred reply into a card. */
export function editReply(i, opts) { return i.editReply(card(opts)); }
/** Replace the message a component lives on (select menus, refresh buttons). */
export function update(i, opts) { return i.update(card(opts)); }
/** Send a card to a channel. */
export function send(channel, opts) { return channel.send(card(opts)); }

/** A one-line card — the bot's "OK" / "no" — same shape as `eReply` always had. */
export function line(i, text, { color = BRAND, title = null, ephemeral = true } = {}) {
  return reply(i, { title, body: text, color }, { ephemeral });
}

/** Turn site-served bytes into an attachment the card can show as `attachment://name`. */
export function attach(buffer, name) { return new AttachmentBuilder(buffer, { name }); }

/** `[▰▰▰▱▱▱▱▱▱▱] 32%` — a progress bar that renders in any Discord client. */
export function bar(value, max, width = 12) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const on = Math.round(pct * width);
  return `${'▰'.repeat(on)}${'▱'.repeat(width - on)} ${Math.round(pct * 100)}%`;
}
