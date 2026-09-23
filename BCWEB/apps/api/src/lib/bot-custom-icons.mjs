// Icons an ADMIN adds to the bot's set, with no code change.
//
// The set used to be exactly `ICONS` in lib/bot-emoji.mjs: a frozen object in the source.
// Adding one meant editing that file, rebuilding the API image and redeploying — for a
// picture. Everything downstream was already generic (the bot asks GET /bot/emoji/keys for
// the list and GET /bot/emoji/<key>.png for the tile, then uploads each one as an application
// emoji), so the only thing in the way was where the list came from.
//
// It now comes from two places: the frozen registry, plus this — AdminSetting
// `bot.customIcons`, written by the dashboard. A key added here appears in /bot/emoji/keys,
// renders at /bot/emoji/<key>.png, and is uploaded to Discord by the bot's own icon sync or
// by the owner's script, exactly like a built-in. `{ic:<key>}` then resolves in bot texts.
//
// Its own setting row, not inside `bot.config`: the dashboard writes bot.config back WHOLE on
// every save, so anything riding inside it is clobbered by the next unrelated edit (the same
// reason `bot.appEmojis` lives apart).
//
// What is accepted is deliberately narrow, and checked HERE rather than by Discord after an
// upload has already been attempted:
//   * a key is `^[a-z0-9_]{2,32}$` and may not shadow a built-in one — the emoji Discord ends
//     up with is named `bc_<key>_<version>`, which must match Discord's own emoji name rule;
//   * an uploaded image is sniffed by its MAGIC BYTES, never by the content-type the client
//     claims, and must really be PNG / JPEG / GIF / WebP;
//   * it is then re-drawn into a 128x128 PNG — the size the bot uploads — and REFUSED if that
//     PNG is over Discord's own 256 KiB per-emoji ceiling, before anything is sent anywhere;
//   * the set is capped (count, per-icon bytes, and the whole row), because this is one
//     AdminSetting value that is read on every /bot/emoji/keys call.
import crypto from 'node:crypto';
import { z } from 'zod';
import { ICONS, renderGlyphTile, iconStyleFor } from './bot-emoji.mjs';

export const SETTING_KEY = 'bot.customIcons';
/** Discord allows 2000 application emojis; this is the ceiling on ADMIN-ADDED ones. */
export const MAX_CUSTOM_ICONS = 50;
/** The largest source image a POST may carry (before it is re-drawn). */
export const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
/** Discord's own per-emoji image ceiling. An upload above it is refused by Discord. */
export const DISCORD_MAX_EMOJI_BYTES = 256 * 1024;
/** The whole stored row: 50 icons at 256 KiB would be 12 MB, which this refuses first. */
export const MAX_STORE_BYTES = 6 * 1024 * 1024;
export const ICON_KEY_RE = /^[a-z0-9_]{2,32}$/;
export const EMOJI_SIZE = 128;

const HEX = /^#[0-9a-f]{6}$/i;
const SHAPES = ['rounded', 'circle', 'square', 'none'];

/**
 * The real type of a buffer, from its magic bytes — never from a declared content-type, which
 * is a claim the client makes and an .exe renamed .png makes just as convincingly.
 */
export function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  const head = buf.toString('latin1', 0, 6);
  if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** The largest source image, per side. A 2 MB cap bounds the BYTES and says nothing about the
 *  PIXELS: a PNG of one flat colour at 60000x60000 is a few kilobytes on the wire and 14 GB
 *  once a decoder has it. Read from the header, before anything decodes. */
export const MAX_SOURCE_PIXELS = 4096;

/**
 * `{ w, h }` from an image's own header, or null when this cannot tell.
 *
 * Deliberately a header read and not a decode: the whole point is to answer before the bytes
 * reach a decoder. `null` means "unknown", and the caller refuses on unknown rather than
 * hoping — the four formats accepted here all state their size in the first few bytes.
 */
export function imageSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  const type = sniffImage(buf);
  if (type === 'image/png') {
    // IHDR is the first chunk and its width/height are at 16..24, big-endian.
    if (buf.length < 24 || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (type === 'image/gif') return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  if (type === 'image/webp') {
    const fourcc = buf.toString('latin1', 12, 16);
    if (fourcc === 'VP8X' && buf.length >= 30) return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (fourcc === 'VP8 ' && buf.length >= 30) return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (fourcc === 'VP8L' && buf.length >= 25) {
      const bits = buf.readUInt32LE(21);
      return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
    }
    return null;
  }
  if (type === 'image/jpeg') {
    // Walk the markers to the first SOFn, which is where a JPEG states its size.
    for (let i = 2; i + 9 < buf.length;) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if (len < 2) return null;
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
    return null;
  }
  return null;
}

/** `data:image/png;base64,...` to a Buffer, or null. Capped before the base64 is decoded. */
export function decodeDataUrl(s, max = MAX_SOURCE_BYTES) {
  const m = /^data:([a-z0-9.+/-]+)?;base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(s || '').trim());
  if (!m) return null;
  const b64 = m[2].replace(/\s+/g, '');
  // 3 bytes per 4 base64 chars: refuse on the STRING length, so an oversize payload is never
  // materialised as a buffer.
  if ((b64.length / 4) * 3 > max + 1024) return null;
  let buf;
  try { buf = Buffer.from(b64, 'base64'); } catch { return null; }
  return buf.length && buf.length <= max ? buf : null;
}

export const CUSTOM_ICON_BODY = z.object({
  key: z.string().regex(ICON_KEY_RE, 'key must be 2-32 characters of ^[a-z0-9_]+$'),
  label: z.string().trim().min(1).max(60),
  source: z.enum(['glyph', 'image']),
  // glyph: a lucide name, `ph:rocket`, or a site media path — the same vocabulary the
  // built-in icons' `icon` field already speaks (lib/avatar-image.mjs resolves all three).
  icon: z.string().trim().min(1).max(200).optional(),
  color: z.string().regex(HEX, 'color must be #rrggbb').optional(),
  fg: z.string().regex(HEX, 'fg must be #rrggbb').optional(),
  shape: z.enum(SHAPES).optional(),
  scale: z.number().min(0.3).max(0.9).optional(),
  // image: a data URL. Validated by magic bytes and re-drawn below, never trusted.
  image: z.string().max(Math.ceil(MAX_SOURCE_BYTES * 1.4) + 256).optional(),
  fallback: z.string().trim().max(16).optional(),
}).strip();

/** Fit a source image into a transparent 128x128 PNG — the size the bot uploads. */
async function toEmojiPng(buf) {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  const img = await loadImage(buf);
  if (!img?.width || !img?.height) return null;
  const c = createCanvas(EMOJI_SIZE, EMOJI_SIZE);
  const x = c.getContext('2d');
  const s = Math.min(EMOJI_SIZE / img.width, EMOJI_SIZE / img.height);
  const w = Math.max(1, Math.round(img.width * s)); const h = Math.max(1, Math.round(img.height * s));
  x.drawImage(img, Math.round((EMOJI_SIZE - w) / 2), Math.round((EMOJI_SIZE - h) / 2), w, h);
  return { png: await c.encode('png'), w: img.width, h: img.height };
}

/**
 * A request body to the row to store, or `{ ok: false, error, issues }` naming what was wrong.
 * `existing` is the current map, so the count cap and the "already there" check are one place.
 */
export async function prepareCustomIcon(body, { existing = {}, replacing = null } = {}) {
  const r = CUSTOM_ICON_BODY.safeParse(body);
  if (!r.success) return { ok: false, error: 'invalid_icon', issues: r.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`) };
  const b = r.data;
  if (ICONS[b.key]) return { ok: false, error: 'invalid_icon', issues: [`${b.key} is a built-in icon key, change that one under Button icons instead`] };
  const isNew = b.key !== replacing && !existing[b.key];
  if (isNew && Object.keys(existing).length >= MAX_CUSTOM_ICONS) return { ok: false, error: 'too_many', issues: [`${MAX_CUSTOM_ICONS} custom icons is the limit`] };

  const base = { key: b.key, label: b.label, source: b.source, fallback: b.fallback || '', addedAt: existing[b.key]?.addedAt || new Date().toISOString() };
  if (b.source === 'glyph') {
    if (!b.icon) return { ok: false, error: 'invalid_icon', issues: ['icon is required for a glyph icon'] };
    return { ok: true, icon: { ...base, icon: b.icon, color: b.color || '#5865f2', fg: b.fg || undefined, shape: b.shape || undefined, scale: b.scale || undefined } };
  }
  // An image. Keep the stored PNG when the edit does not carry a new one.
  if (!b.image) {
    const prev = existing[b.key];
    if (prev?.source === 'image' && prev.png) return { ok: true, icon: { ...base, png: prev.png, bytes: prev.bytes, hash: prev.hash } };
    return { ok: false, error: 'invalid_icon', issues: ['image is required for an image icon'] };
  }
  const raw = decodeDataUrl(b.image);
  if (!raw) return { ok: false, error: 'invalid_icon', issues: [`image must be a base64 data URL of at most ${Math.round(MAX_SOURCE_BYTES / 1024)} KiB`] };
  const type = sniffImage(raw);
  if (!type) return { ok: false, error: 'invalid_icon', issues: ['image must really be a PNG, JPEG, GIF or WebP (checked by its bytes, not by its name)'] };
  // The pixel count, from the header, BEFORE a decoder sees the bytes. A size this cannot
  // read is refused rather than decoded: the cap exists precisely for the image that is not
  // what it looks like.
  const size = imageSize(raw);
  if (!size || !(size.w > 0) || !(size.h > 0) || size.w > MAX_SOURCE_PIXELS || size.h > MAX_SOURCE_PIXELS) {
    return { ok: false, error: 'invalid_icon', issues: [`the image must state a size of at most ${MAX_SOURCE_PIXELS}x${MAX_SOURCE_PIXELS} pixels in its header`] };
  }
  let out = null;
  try { out = await toEmojiPng(raw); } catch { out = null; }
  if (!out) return { ok: false, error: 'invalid_icon', issues: ['that image could not be decoded'] };
  if (out.png.length > DISCORD_MAX_EMOJI_BYTES) {
    return { ok: false, error: 'invalid_icon', issues: [`the ${EMOJI_SIZE}x${EMOJI_SIZE} PNG is ${Math.round(out.png.length / 1024)} KiB, over the ${Math.round(DISCORD_MAX_EMOJI_BYTES / 1024)} KiB Discord allows for one emoji`] };
  }
  const png = out.png.toString('base64');
  return { ok: true, icon: { ...base, png, bytes: out.png.length, hash: crypto.createHash('sha1').update(out.png).digest('hex').slice(0, 12), srcType: type } };
}

/** The stored row, always the same shape. */
export function readStore(value) {
  const icons = value && typeof value === 'object' && value.icons && typeof value.icons === 'object' ? value.icons : {};
  const out = {};
  for (const [k, v] of Object.entries(icons)) if (ICON_KEY_RE.test(k) && v && typeof v === 'object' && !ICONS[k]) out[k] = v;
  return out;
}

/** Refuse a write that would make the row too big to read on every keys call. */
export function storeFits(icons) {
  const bytes = Buffer.byteLength(JSON.stringify({ icons }), 'utf8');
  return { ok: bytes <= MAX_STORE_BYTES, bytes };
}

/** `{ key, label, version }` for each custom icon, in the same shape as a built-in's. */
export function customKeys(icons, iconStyle = {}) {
  return Object.entries(icons).map(([key, def]) => ({ key, label: def.label || key, version: customIconVersion({ ...def, key }, iconStyle), custom: true }));
}

/**
 * A fingerprint of how a custom key draws right now, in the same 8 hex digits a built-in
 * uses — so a re-uploaded image or a recoloured glyph gets a NEW emoji name and the bot
 * replaces the old one instead of serving a stale drawing forever.
 */
export function customIconVersion(def, iconStyle = {}) {
  const set = iconStyle && typeof iconStyle === 'object' ? iconStyle : {};
  const mine = set[def.key] && typeof set[def.key] === 'object' ? set[def.key] : {};
  const parts = def.source === 'image'
    ? ['image', def.hash || String(def.png || '').slice(0, 32)]
    : ['glyph', mine.icon || def.icon, mine.color || def.color, mine.fg || def.fg || set.fg, mine.shape || def.shape || set.shape, mine.scale || def.scale || set.scale];
  return crypto.createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 8);
}

/** One custom icon as a 128x128 PNG buffer: the stored image, or its glyph tile. */
export async function renderCustomIcon(def, iconStyle = {}) {
  if (!def) return null;
  if (def.source === 'image') { try { return Buffer.from(String(def.png || ''), 'base64'); } catch { return null; } }
  // A glyph custom icon draws exactly like a built-in: same tile, same set-wide style, same
  // per-key overrides. `iconStyleFor` only knows built-in keys, so the defaults come from the
  // definition and the set-wide style is applied here.
  const set = iconStyle && typeof iconStyle === 'object' ? iconStyle : {};
  const mine = set[def.key] && typeof set[def.key] === 'object' ? set[def.key] : {};
  const st = {
    key: def.key,
    icon: (typeof mine.icon === 'string' && mine.icon.trim()) || def.icon || 'circle',
    color: HEX.test(mine.color || '') ? mine.color : HEX.test(def.color || '') ? def.color : '#5865f2',
    fg: HEX.test(mine.fg || '') ? mine.fg : HEX.test(def.fg || '') ? def.fg : HEX.test(set.fg || '') ? set.fg : '#ffffff',
    shape: SHAPES.includes(mine.shape) ? mine.shape : SHAPES.includes(def.shape) ? def.shape : SHAPES.includes(set.shape) ? set.shape : 'rounded',
    scale: Math.min(0.9, Math.max(0.3, Number(mine.scale) || Number(def.scale) || Number(set.scale) || 0.58)),
  };
  return renderGlyphTile(st);
}

/** A built-in key's style, when a caller needs both kinds through one call. */
export const builtinStyle = iconStyleFor;
