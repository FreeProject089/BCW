// One place that turns "this user's avatar" into pixels the server can draw — so the /profile
// card the bot posts, the leaderboard picture and the /avatar/:id/png endpoint all show
// EXACTLY the picture the site shows (apps/web/src/ui/Avatar.jsx), in this order:
//   1. an uploaded photo (a.image) — a site media key read straight from the store, or an
//      absolute URL (an OAuth avatar) fetched;
//   2. an uncustomised account (no photo, no chosen variant) → the BetterCommunity logo, the
//      same default the site uses;
//   3. otherwise the Boring Avatar with the user's variant / seed / palette.
// Before this, the profile card tested a JSON object against a URL regex, always failed, and
// drew its own hand-made smiley — which looked like "a boring avatar" but never the user's.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import BoringAvatarImport from 'boring-avatars';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { BRAND_LOGO_DATA_URI } from './brand-logo-data.mjs';
import { getObject } from './storage.mjs';

const require = createRequire(import.meta.url);
// CJS/ESM interop: the component is nested under a second `.default`.
const BoringAvatar = (BoringAvatarImport && BoringAvatarImport.default) || BoringAvatarImport;

export const AVATAR_PALETTES = {
  orange: ['#f97316', '#f59e0b', '#fb923c', '#fbbf24', '#9a3412'],
  ocean: ['#0ea5e9', '#22d3ee', '#3b82f6', '#6366f1', '#0c4a6e'],
  forest: ['#22c55e', '#16a34a', '#84cc16', '#14b8a6', '#064e3b'],
  candy: ['#ec4899', '#f43f5e', '#a855f7', '#f59e0b', '#831843'],
  mono: ['#e2e8f0', '#94a3b8', '#64748b', '#334155', '#0f172a'],
};

async function streamToBuffer(s) {
  if (!s) return null;
  if (Buffer.isBuffer(s)) return s;
  if (typeof s.transformToByteArray === 'function') return Buffer.from(await s.transformToByteArray());
  const chunks = [];
  for await (const ch of s) chunks.push(Buffer.isBuffer(ch) ? ch : Buffer.from(ch));
  return Buffer.concat(chunks);
}

/** The Boring Avatar SVG for a user row ({ id, displayName, avatar }), as the site draws it. */
export function boringAvatarSvg(u, size = 80) {
  const a = (u && typeof u.avatar === 'object' && u.avatar) || {};
  const variant = a.variant || 'beam';
  const name = String(a.seed || u?.id || u?.displayName || 'bcw');
  const colors = Array.isArray(a.colors) && a.colors.length ? a.colors : AVATAR_PALETTES.orange;
  return renderToStaticMarkup(createElement(BoringAvatar, { size, square: false, variant, name, colors }));
}

/** Bytes of a site image path (`/api/media/<key>` or `/media/<key>`), or null. */
export async function siteMediaBuffer(path) {
  const m = /^\/(?:api\/)?media\/(.+)$/.exec(String(path || '').split('?')[0]);
  if (!m || m[1].includes('..')) return null;
  try { const { body } = await getObject(m[1]); return await streamToBuffer(body); } catch { return null; }
}

/** A @napi-rs/canvas Image of the user's avatar, or null if nothing could be decoded. */
export async function loadAvatarImage(u, size = 256) {
  const { loadImage } = await import('@napi-rs/canvas');
  const a = (u && typeof u.avatar === 'object' && u.avatar) || {};
  if (a.image) {
    try {
      if (/^https?:\/\//i.test(a.image)) return await loadImage(a.image);
      if (/^data:/i.test(a.image)) return await loadImage(a.image);
      const buf = await siteMediaBuffer(a.image);
      if (buf) return await loadImage(buf);
    } catch { /* fall through to the geometric one — better a wrong-but-plausible picture than none */ }
  }
  try {
    if (!a.image && !a.variant) return await loadImage(BRAND_LOGO_DATA_URI);
    return await loadImage(Buffer.from(boringAvatarSvg(u, size)));
  } catch { return null; }
}

/** The avatar as a round PNG (transparent corners) — what Discord embeds and thumbnails want. */
export async function renderAvatarPng(u, size = 256) {
  const { createCanvas } = await import('@napi-rs/canvas');
  const img = await loadAvatarImage(u, size);
  const c = createCanvas(size, size); const x = c.getContext('2d');
  x.beginPath(); x.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); x.clip();
  if (img) {
    // Cover-fit so a non-square photo is cropped, not squashed.
    const s = Math.max(size / img.width, size / img.height); const w = img.width * s, h = img.height * s;
    x.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  } else { x.fillStyle = '#f59e0b'; x.fillRect(0, 0, size, size); }
  return c.encode('png');
}

// ── Badge icons ──────────────────────────────────────────────────────────────
const kebab = (name) => String(name || '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([a-zA-Z])([0-9])/g, '$1-$2').toLowerCase();
const lucideCache = new Map();

/** A lucide icon (by its React name or kebab file name) recoloured, as a canvas Image, or null. */
export async function loadLucideIcon(name, color = '#ffffff', size = 48) {
  const file = kebab(name);
  if (!/^[a-z0-9-]+$/.test(file)) return null;
  const key = `${file}|${color}|${size}`;
  if (lucideCache.has(key)) return lucideCache.get(key);
  let img = null;
  try {
    const svgPath = require.resolve(`lucide-static/icons/${file}.svg`);
    let svg = await readFile(svgPath, 'utf8');
    svg = svg.replace(/currentColor/g, color).replace(/<svg\b([^>]*?)\swidth="[^"]*"/, '<svg$1').replace(/<svg\b([^>]*?)\sheight="[^"]*"/, '<svg$1')
      .replace('<svg', `<svg width="${size}" height="${size}"`);
    const { loadImage } = await import('@napi-rs/canvas');
    img = await loadImage(Buffer.from(svg));
  } catch { img = null; }
  lucideCache.set(key, img);
  return img;
}

/** A badge's visual: a lucide glyph, an uploaded image, or a data URI — as a canvas Image or null. */
export async function loadBadgeIcon(badge, color = '#ffffff', size = 48) {
  if (!badge) return null;
  const icon = String(badge.icon || '');
  const type = badge.iconType || (/^(data:|https?:|\/)/i.test(icon) ? 'image' : 'lucide');
  try {
    if (type === 'image' || /^(data:|https?:|\/)/i.test(icon)) {
      const { loadImage } = await import('@napi-rs/canvas');
      if (/^(data:|https?:)/i.test(icon)) return await loadImage(icon);
      const buf = await siteMediaBuffer(icon);
      return buf ? await loadImage(buf) : null;
    }
    if (type === 'lucide') return await loadLucideIcon(icon, color, size);
    // A simple-icons brand slug: the API has no brand set — the badge keeps its colour dot.
    return null;
  } catch { return null; }
}
