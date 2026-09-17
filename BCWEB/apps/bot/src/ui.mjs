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
  StringSelectMenuOptionBuilder,
} from 'discord.js';

export const BRAND = 0xf59e0b;
export const GOOD = 0x16a34a;
export const BAD = 0xef4444;
export const INFO = 0x3b82f6;

// Icons. The bot never draws a unicode emoji: every glyph is one of the site's icons
// (apps/api/src/lib/bot-emoji.mjs), uploaded as APPLICATION emojis at boot by
// features/icons.mjs (`setAutoIcons`), and overridable per key by the admin's own custom
// emoji from the dashboard (`setIcons`, economy.icons). A key nobody mapped draws NOTHING —
// the label stands alone — so a missing icon is a plain button, never a stray emoji.
const CUSTOM = /^<a?:\w{2,32}:\d{15,22}>$/;
let AUTO = {};
let ADMIN = {};
const pick = (map) => {
  const out = {};
  for (const [k, v] of Object.entries(map || {})) if (typeof v === 'string' && CUSTOM.test(v.trim())) out[k] = v.trim();
  return out;
};
/** The admin's per-key mapping (wins over the uploaded set). Set from the config on every interaction. */
export function setIcons(map) { ADMIN = pick(map); }
/** The application emojis features/icons.mjs uploaded (or found) — the whole icon set. */
export function setAutoIcons(map) { AUTO = { ...AUTO, ...pick(map) }; }
/** The emoji for a key, or '' when nothing is mapped. */
export const ic = (key) => ADMIN[key] || AUTO[key] || '';
/** The emoji plus a trailing space — for `${ui.icx('casino')}Casino` — or '' so the text does not start with a blank. */
export const icx = (key) => { const e = ic(key); return e ? `${e} ` : ''; };
/** Every mapped key (for tests and the /logs status card). */
export const icons = () => ({ ...AUTO, ...ADMIN });
/** True when `s` is a custom-emoji token the bot may put on a button. */
export const isCustomEmoji = (s) => CUSTOM.test(String(s || '').trim());

const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

const CUSTOM_ANY = /<a?:\w{2,32}:\d{15,22}>/g;
/**
 * A LABEL is PLAIN TEXT to Discord — a button's label, a select option's label or
 * description, a placeholder. Discord renders `<:name:id>` as a picture only inside MESSAGE
 * text (a text display, a section); inside a label it prints the token itself, which is how
 * `<:bc_rename_…:1546305741365710878> Montant libre…` ended up on a menu entry and
 * `Visibilité : <:bc_vis_server_…:1549…> Ce serveur` on a button.
 *
 * The tokens get there honestly: a dictionary string carries `{ic:key}` (i18n.mjs), which is
 * resolved to a real token long before the string reaches a builder — so the only place that
 * can tell a label from body text is here. Pull every token OUT of the label and hand the
 * first one back, to be set as the component's own emoji, where Discord does draw it.
 */
export function labelParts(label) {
  const s = String(label ?? '');
  const found = s.match(CUSTOM_ANY);
  const text = s.replace(CUSTOM_ANY, ' ').replace(/\s{2,}/g, ' ').trim();
  return { text, emoji: found ? found[0] : null };
}
/** An explicit emoji argument as a token: an icon key, a literal token, or '' for anything else. */
const emojiArg = (emoji) => (emoji ? ic(emoji) || (isCustomEmoji(emoji) ? String(emoji).trim() : '') : '');

/** A plain button. `id` becomes the custom id, or a URL when it starts with http(s). */
export function btn(id, label, style = ButtonStyle.Secondary, { emoji = null, disabled = false } = {}) {
  const { text, emoji: inLabel } = labelParts(label);
  const b = new ButtonBuilder().setDisabled(disabled);
  if (/^https?:\/\//.test(id)) b.setStyle(ButtonStyle.Link).setURL(id);
  else b.setCustomId(id).setStyle(style);
  // A key resolves through the icon set; a literal custom-emoji token passes as is. Anything
  // else (a unicode emoji, an unmapped key) is dropped: the label carries the button. A token
  // that travelled inside the label stands in when the caller named no icon.
  const e = emojiArg(emoji) || inLabel || '';
  if (e) { try { b.setEmoji(e); } catch { /* an unusable custom emoji leaves the label */ } }
  // A label made of nothing but an icon keeps the icon and no text, rather than a blank label.
  if (text || !e) b.setLabel(clip(text || String(label ?? ''), 80));
  return b;
}

/**
 * A select-menu option, with the same label rule as `btn`: no emoji token survives in the
 * label or the description, and an icon rides in the option's own `emoji` slot.
 */
export function option(value, label, { selected = false, description = null, emoji = null } = {}) {
  const { text, emoji: inLabel } = labelParts(label);
  const o = new StringSelectMenuOptionBuilder().setValue(String(value)).setLabel(clip(text || String(label ?? ''), 100)).setDefault(!!selected);
  if (description) { const d = labelParts(description).text; if (d) o.setDescription(clip(d, 100)); }
  const e = emojiArg(emoji) || inLabel || '';
  if (e) { try { o.setEmoji(e); } catch { /* label only */ } }
  return o;
}

/**
 * Buttons split into rows of at most `perRow` (Discord's row limit is 5). Accepts
 * ButtonBuilders or a select. `perRow` is how many COLUMNS the client draws: the casino's
 * game list asks for 2, so its six buttons read as two columns and not as one crowded line
 * the client re-wraps into three.
 */
export function rowsOf(perRow, ...items) {
  const cap = Math.max(1, Math.min(5, Math.floor(Number(perRow)) || 5));
  const out = [];
  let row = null;
  for (const it of items.flat().filter(Boolean)) {
    // A select menu owns its row.
    if (!(it instanceof ButtonBuilder)) { out.push(new ActionRowBuilder().addComponents(it)); row = null; continue; }
    if (!row || row.components.length >= cap) { row = new ActionRowBuilder(); out.push(row); }
    row.addComponents(it);
  }
  return out;
}
/** Buttons split into rows of ≤ 5 (Discord's row limit). Accepts ButtonBuilders or a select. */
export const rows = (...items) => rowsOf(5, ...items);

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
 *   buttonColumns — how many buttons per row (1–5, default 5)
 */
export const MAX_COMPONENTS = 40;
export function card({ title = null, body = '', color = BRAND, thumb = null, sections = [], image = null, files = [], footer = null, buttons = [], buttonColumns = 5 } = {}) {
  const c = new ContainerBuilder().setAccentColor(color);
  // Discord counts EVERY component in the message — the container, each text display, each
  // section AND its text AND its accessory, each separator, each row, each button — and
  // refuses the message past 40 (COMPONENT_MAX_TOTAL_COMPONENTS_EXCEEDED). The budget is
  // tracked here so a long list degrades (extra rows fold into text, extra button rows are
  // cut) instead of failing to send.
  let used = 1;
  const btnRows = rowsOf(buttonColumns, ...buttons).slice(0, 5);
  const btnCost = btnRows.length ? 1 + btnRows.reduce((a, r) => a + 1 + r.components.length, 0) : 0;
  const footerCost = footer ? 2 : 0;
  const reserve = () => btnCost + footerCost;
  const text = [title ? `## ${clip(title, 200)}` : null, Array.isArray(body) ? body.filter(Boolean).join('\n') : body].filter(Boolean).join('\n');
  if (thumb) {
    c.addSectionComponents(new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(clip(text || '\u200b', 3500)))
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumb)));
    used += 3;
  } else if (text) {
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(clip(text, 3500)));
    used += 1;
  }
  if (image) { c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(image))); used += 1; }
  if (sections.length) {
    c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    used += 1;
    // A Components-V2 SectionBuilder is only valid WITH an accessory (a button or a thumbnail).
    // A row that carries neither — a plain stats line, as `/level` and `/casino` pass — must be
    // a bare TextDisplay, or `SectionBuilder.toJSON()` throws "Received one or more errors" and
    // the whole reply fails. Accessory-less rows are coalesced into one text block (fewer
    // components, same look); rows with an accessory stay as their own section while the
    // budget allows, then fold into the text block too (their button is dropped, the text stays).
    let buf = [];
    const flush = () => { if (buf.length) { c.addTextDisplayComponents(new TextDisplayBuilder().setContent(clip(buf.join('\n'), 3500))); buf = []; used += 1; } };
    const room = () => used + (buf.length ? 1 : 0) + 3 + reserve() <= MAX_COMPONENTS;
    for (const s of sections.slice(0, 12)) {
      if (s.button && room()) { flush(); c.addSectionComponents(new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(clip(s.text, 900))).setButtonAccessory(s.button)); used += 3; }
      else if (s.thumb && room()) { flush(); c.addSectionComponents(new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(clip(s.text, 900))).setThumbnailAccessory(new ThumbnailBuilder().setURL(s.thumb))); used += 3; }
      else { buf.push(s.text); }
    }
    flush();
  }
  if (footer) {
    c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false));
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${clip(footer, 300)}`));
    used += 2;
  }
  if (btnRows.length) {
    c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false));
    used += 1;
    for (const r of btnRows) {
      if (used + 1 + r.components.length > MAX_COMPONENTS) break;
      c.addActionRowComponents(r);
      used += 1 + r.components.length;
    }
  }
  return { components: [c], files, flags: MessageFlags.IsComponentsV2 };
}

/** How many components a built card carries — the number Discord caps at 40. */
export function countComponents(msg) {
  const walk = (node) => {
    if (!node || typeof node !== 'object') return 0;
    let k = 1;
    for (const key of ['components', 'accessory']) {
      const v = node[key];
      if (Array.isArray(v)) for (const x of v) k += walk(x);
      else if (v && typeof v === 'object') k += walk(v);
    }
    return k;
  };
  return (msg.components || []).reduce((a, c) => a + walk(typeof c.toJSON === 'function' ? c.toJSON() : c), 0);
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
