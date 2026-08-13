// Renders a user's avatar as an SVG — the SAME on-brand Boring Avatar the web app
// shows (apps/web/src/Avatar.jsx), so external clients (e.g. the BMM desktop app,
// which has no boring-avatars renderer) can display the exact same picture via a
// plain <img src="/api/avatar/:id">. Uploaded photos 302-redirect to the image.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import BoringAvatarImport from 'boring-avatars';
import { db } from '../lib/lib.mjs';

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
  app.get('/avatar/:id', async (req, reply) => {
    const size = Math.max(16, Math.min(256, parseInt(req.query?.size, 10) || 80));
    const p = await db();
    const u = await p.user.findUnique({ where: { id: req.params.id }, select: { id: true, displayName: true, avatar: true } });
    const a = (u && u.avatar) || {};
    // Fastify 5: redirect(url, code). The old (code, url) form answers 500 with
    // Location: 302 — an uploaded avatar image never resolved.
    if (typeof a === 'object' && a.image) return reply.redirect(a.image, 302);
    // Same fallbacks as Avatar.jsx's avatarOf().
    const variant = a.variant || 'beam';
    const name = String(a.seed || u?.id || u?.displayName || 'bcw');
    const colors = Array.isArray(a.colors) && a.colors.length ? a.colors : PALETTES.orange;
    const svg = renderToStaticMarkup(createElement(BoringAvatar, { size, square: false, variant, name, colors }));
    reply.header('Content-Type', 'image/svg+xml; charset=utf-8').header('Cache-Control', 'public, max-age=86400');
    return svg;
  });
}
