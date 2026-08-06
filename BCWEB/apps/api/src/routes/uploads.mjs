import { z } from 'zod';
import { randomUUID } from 'crypto';
import { db, requireRole } from '../lib/lib.mjs';
import { presignPut, getObject } from '../lib/storage.mjs';
import { imageThumb } from '../lib/native.mjs';

const GiB = 1024 ** 3;

// On-demand thumbnail resize for the /media proxy (list cards request a small ?w=). Only
// downscales raster images; each (key,width) is resized ONCE and kept in a tiny LRU, and the
// response is immutable so a CDN/browser caches it. The resize runs off the event loop via
// the native Rust worker (imageThumb), falling back to @napi-rs/canvas.
const THUMB_WIDTHS = [64, 128, 256, 384, 512, 768]; // snap to a fixed set so the cache stays small
const thumbWidth = (w) => { const n = Number(w); return THUMB_WIDTHS.includes(n) ? n : null; };
const RESIZABLE = /^image\/(png|jpe?g|webp)$/i;
const thumbCache = new Map(); // `${key}|${w}` -> { buffer, type } | null
const THUMB_CACHE_MAX = 64;
async function streamToBuffer(s) {
  if (Buffer.isBuffer(s)) return s;
  const chunks = []; for await (const c of s) chunks.push(c); return Buffer.concat(chunks);
}
async function thumbCached(cacheKey, buf, width) {
  if (thumbCache.has(cacheKey)) return thumbCache.get(cacheKey);
  const out = await imageThumb(buf, width).catch(() => null); // { buffer, type } | null
  thumbCache.set(cacheKey, out);
  if (thumbCache.size > THUMB_CACHE_MAX) thumbCache.delete(thumbCache.keys().next().value);
  return out;
}
// Submission payloads (.bmmplugin / .bmmtheme / app bundles / presets) live in a
// DEDICATED temp margin, separate from the hosted-repo capacity. When it's full,
// uploads are refused until moderation clears space (approve→paid hosting / reject).
export async function tempMarginStatus(p) {
  const row = await p.adminSetting.findUnique({ where: { key: 'hosting.tempMarginGB' } }).catch(() => null);
  const marginGB = Number(row?.value ?? 20);
  // Only PENDING submissions count here — once approved or rejected they no longer
  // occupy "space awaiting a moderation decision" (approved work moves to the
  // permanent submissionsPublished bucket in capacityStatus(); this was the bug
  // where the temp margin filled up forever and never freed after approvals).
  const agg = await p.catalogItem.aggregate({ where: { payloadKey: { not: null }, status: 'PENDING' }, _sum: { payloadSize: true } });
  const usedBytes = Number(agg._sum.payloadSize || 0);
  return { marginGB, usedBytes, usedGB: usedBytes / GiB, freeBytes: Math.max(0, marginGB * GiB - usedBytes) };
}

const IMG = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];
// Per-kind upload caps + allowed content types (defence in depth; MinIO also enforced).
// The MIME labels a browser actually puts on a file, which are not the ones a spec would
// suggest. Windows reads the type from the registry, so the SAME .zip arrives as
// application/zip on one machine and application/x-zip-compressed on another; a file with a
// custom extension (.bmmtheme, .bmmplug, .bmmpreset) has no entry at all and arrives with an
// empty type, which uploadPayload() turns into application/octet-stream.
//
// These lists were narrower and produced a steady trickle of 415 unsupported_type on uploads
// that were perfectly fine — a .zip picked on Windows, or a .json catalog under APP/PLUGIN.
//
// Widening them is not a weakening. application/octet-stream is already accepted for every one
// of these kinds, so anyone could pass the old gate by renaming the file to .dat: the narrowness
// never blocked a byte, it only rejected honest uploads whose browser happened to be MORE
// specific about what they were. Real protection is elsewhere — the byte cap, the temp-storage
// margin, admin-only kinds, and object storage serving these as attachments rather than
// executing them.
const ARCHIVE = ['application/zip', 'application/x-zip-compressed', 'application/x-compressed', 'multipart/x-zip'];
// An opaque or self-describing payload: no type, or a structured one we can serve as bytes.
const OPAQUE = ['application/octet-stream', 'application/json'];

const LIMITS = {
  // Direct uploads are capped at 100MB across the submittable kinds; anything larger is
  // arranged via the contact page (the /submit UI directs there). Apps (installers) may
  // legitimately be bigger, so they keep the higher ceiling.
  APP:    { maxBytes: 500 * 1024 * 1024, types: [...ARCHIVE, ...OPAQUE, 'application/x-msdownload'] },
  PLUGIN: { maxBytes: 100 * 1024 * 1024, types: [...ARCHIVE, ...OPAQUE, 'application/wasm'] },
  // .bmmtheme is a custom extension unknown to browser MIME tables, so
  // <input type=file> reports an empty file.type → uploadPayload() falls back
  // to 'application/octet-stream'. Without it here every real .bmmtheme
  // submission 415'd (this was the "submit content doesn't work" bug).
  THEME:  { maxBytes: 100 * 1024 * 1024, types: [...ARCHIVE, ...OPAQUE, 'text/css'] },
  PRESET: { maxBytes: 2 * 1024 * 1024, types: [...OPAQUE] },
  BLOG:   { maxBytes: 10 * 1024 * 1024, types: IMG, prefix: 'blog' },
  // Report / support-thread image attachments. Public (served from blog/ proxy), any
  // logged-in user. The byte cap is admin-configurable (reports.imageMaxMB), applied below.
  REPORT: { maxBytes: 10 * 1024 * 1024, types: IMG, prefix: 'blog' },
  // Project/showcase page media (visual editor): images, short videos, and rrweb
  // replay JSON. ADMIN-only (enforced below) since it serves arbitrary bytes from
  // our domain and is only used by the project config editor.
  MEDIA:  { maxBytes: 100 * 1024 * 1024, types: [...IMG, 'video/mp4', 'video/webm', 'application/json', 'application/octet-stream'], prefix: 'blog', adminOnly: true },
  // A .bmmreplay rrweb recording embedded in a blog post / doc page via :::replay{src}.
  // JSON only (the client forces application/json for the custom extension), served from
  // the public blog/ proxy which forces Content-Disposition: attachment on non-media — so
  // it never renders/executes on our origin, yet DocReplay's fetch() still reads it.
  REPLAY: { maxBytes: 40 * 1024 * 1024, types: ['application/json'], prefix: 'blog' },
  // A finished "Make Your Own" deliverable an admin uploads into a request conversation —
  // a built app/site/bot bundle, with or without source. Admin-tier only; served from the
  // media proxy behind an unguessable UUID URL (attachment on direct navigation).
  MYO_DELIVER: { maxBytes: 500 * 1024 * 1024, types: [...IMG, 'application/zip', 'application/x-zip-compressed', 'application/octet-stream', 'application/json', 'application/pdf'], prefix: 'blog', adminOnly: true },
};

const schema = z.object({
  kind: z.enum(['APP', 'PLUGIN', 'THEME', 'PRESET', 'BLOG', 'MEDIA', 'REPORT', 'REPLAY', 'MYO_DELIVER']),
  filename: z.string().min(1).max(160),
  contentType: z.string().min(1).max(120),
  size: z.number().int().positive(),
});

export default async function uploadRoutes(app) {
  // Anti-spam: presigning is rate-limited — a burst of raw uploads can't drain the
  // temp margin or flood object storage even without creating catalog items.
  app.post('/uploads/presign', { preHandler: requireRole(), config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    const { kind, filename, contentType, size } = parsed.data;
    const lim = LIMITS[kind];
    if (lim.adminOnly && !['ADMIN', 'SUPERADMIN'].includes(req.user.role)) return reply.code(403).send({ error: 'forbidden' });
    // Report attachments use an admin-configurable per-image cap (reports.imageMaxMB).
    let maxBytes = lim.maxBytes;
    if (kind === 'REPORT') {
      const row = await (await db()).adminSetting.findUnique({ where: { key: 'reports.imageMaxMB' } }).catch(() => null);
      const mb = Number(row?.value?.mb ?? row?.value ?? 10);
      if (mb > 0) maxBytes = Math.min(mb, 50) * 1024 * 1024;
    }
    if (size > maxBytes) return reply.code(413).send({ error: 'too_large', maxBytes });
    if (!lim.types.includes(contentType)) return reply.code(415).send({ error: 'unsupported_type', allowed: lim.types });
    // Submission payloads draw from the dedicated temp margin — refuse when full.
    // (BLOG images + MEDIA page assets are served publicly, not from that margin.)
    if (!lim.prefix) {
      const temp = await tempMarginStatus(await db());
      if (size > temp.freeBytes) return reply.code(507).send({ error: 'temp_storage_full', marginGB: temp.marginGB, usedGB: Number(temp.usedGB.toFixed(2)) });
    }

    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    const key = lim.prefix ? `${lim.prefix}/${randomUUID()}-${safe}` : `uploads/${req.user.uid}/${randomUUID()}-${safe}`;
    const url = await presignPut(key, contentType);
    // Prefixed kinds (blog/) return a stable public URL served by the media proxy.
    const mediaUrl = lim.prefix ? `/api/media/${key}` : null;
    return { key, url, mediaUrl, expiresIn: 600 };
  });

  // Public media proxy — serves blog images with stable URLs (only the blog/ prefix).
  app.get('/media/*', async (req, reply) => {
    const key = req.params['*'];
    // Public only under the blog/ prefix. Reject any '..' so a crafted key can't
    // escape the prefix into another user's uploads if the store normalises paths.
    if (!key || !key.startsWith('blog/') || key.includes('..')) return reply.code(404).send({ error: 'not_found' });
    try {
      const { body, contentType } = await getObject(key);
      // Harden against XSS from user-uploaded SVG/HTML served from our own origin
      // (CWE-79). `nosniff` stops content-type confusion. The real defence is
      // Content-Disposition: only genuine raster images / video render inline;
      // everything else (SVG — which can carry scripts — JSON, octet-stream) is
      // forced to DOWNLOAD on direct navigation, so no script ever executes on our
      // origin. Attachment is ignored for <img>/<video> subresource loads, so
      // legitimate embeds still display. (The per-response CSP is belt-and-braces;
      // Caddy's edge CSP may override it, hence the disposition guard.)
      // Each key carries a randomUUID(), so a URL's bytes never change (replacing an
      // image mints a new URL). That makes it safe to cache immutably for a year — the
      // browser/CDN never re-validates, which offloads the media proxy on repeat views.
      reply.header('Cache-Control', 'public, max-age=31536000, immutable')
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; sandbox");
      // Thumbnail path: a list card asks for a small ?w=<width>. Downscale raster images
      // to webp (never upscale); the result is inline-safe (a raster we produced ourselves).
      const width = thumbWidth(req.query?.w);
      if (width && RESIZABLE.test(contentType)) {
        const buf = await streamToBuffer(body);
        const thumb = await thumbCached(`${key}|${width}`, buf, width);
        if (thumb) return reply.header('Content-Type', thumb.type).send(thumb.buffer);
        return reply.header('Content-Type', contentType).send(buf); // already small / decode failed → original
      }
      const inlineSafe = /^(image\/(png|jpe?g|webp|gif|avif)|video\/)/i.test(contentType);
      reply.header('Content-Type', contentType);
      if (!inlineSafe) reply.header('Content-Disposition', 'attachment');
      return reply.send(body);
    } catch { return reply.code(404).send({ error: 'not_found' }); }
  });
}
