// Renders a user's avatar as an SVG — the SAME on-brand Boring Avatar the web app
// shows (apps/web/src/Avatar.jsx), so external clients (e.g. the BMM desktop app,
// which has no boring-avatars renderer) can display the exact same picture via a
// plain <img src="/api/avatar/:id">. Uploaded photos 302-redirect to the image.
import { createElement } from 'react';
import { safeAvatarImage } from '../lib/avatar-url.mjs';
import { renderToStaticMarkup } from 'react-dom/server';
import BoringAvatarImport from 'boring-avatars';
import { db } from '../lib/lib.mjs';
import { renderAvatarPng } from '../lib/avatar-image.mjs';

// CJS/ESM interop: the component is nested under a second `.default`.
const BoringAvatar = (BoringAvatarImport && BoringAvatarImport.default) || BoringAvatarImport;

const PALETTES = {
  orange: ['#f97316', '#f59e0b', '#fb923c', '#fbbf24', '#9a3412'],
  ocean: ['#0ea5e9', '#22d3ee', '#3b82f6', '#6366f1', '#0c4a6e'],
  forest: ['#22c55e', '#16a34a', '#84cc16', '#14b8a6', '#064e3b'],
  candy: ['#ec4899', '#f43f5e', '#a855f7', '#f59e0b', '#831843'],
  mono: ['#e2e8f0', '#94a3b8', '#64748b', '#334155', '#0f172a'],
};

export default async function avatarRoutes(app) {
  // The SAME picture as pixels: an uploaded photo, the logo default, or the Boring Avatar —
  // drawn round, transparent corners. Discord thumbnails and the canvas-rendered cards need
  // a raster (an SVG attached as .png simply does not show), which is why this exists next
  // to the SVG route rather than instead of it.
  app.get('/avatar/:id/png', async (req, reply) => {
    const size = Math.max(32, Math.min(512, parseInt(req.query?.size, 10) || 256));
    const p = await db();
    const u = await p.user.findUnique({ where: { id: req.params.id }, select: { id: true, displayName: true, avatar: true } });
    if (!u) return reply.code(404).send({ error: 'not_found' });
    try {
      const png = await renderAvatarPng(u, size);
      return reply.header('Content-Type', 'image/png').header('Cache-Control', 'public, max-age=600').send(png);
    } catch { return reply.redirect(`/avatar/${encodeURIComponent(u.id)}?size=${size}`, 302); }
  });
  app.get('/avatar/:id', async (req, reply) => {
    const size = Math.max(16, Math.min(256, parseInt(req.query?.size, 10) || 80));
    const p = await db();
    const u = await p.user.findUnique({ where: { id: req.params.id }, select: { id: true, displayName: true, avatar: true } });
    const a = (u && u.avatar) || {};
    // Fastify 5: redirect(url, code). The old (code, url) form answers 500 with
    // Location: 302 — an uploaded avatar image never resolved.
    // Only to an image the site itself produced (lib/avatar-url.mjs): a stored value that is
    // anything else would make this an open redirect; the generated avatar is served instead.
    const img = typeof a === 'object' ? safeAvatarImage(a.image) : null;
    if (img) return reply.redirect(img, 302);
    // Same fallbacks as Avatar.jsx's avatarOf().
    const variant = a.variant || 'beam';
    const name = String(a.seed || u?.id || u?.displayName || 'bcw');
    const colors = Array.isArray(a.colors) && a.colors.length ? a.colors : PALETTES.orange;
    const svg = renderToStaticMarkup(createElement(BoringAvatar, { size, square: false, variant, name, colors }));
    reply.header('Content-Type', 'image/svg+xml; charset=utf-8').header('Cache-Control', 'public, max-age=86400');
    return svg;
  });
}
