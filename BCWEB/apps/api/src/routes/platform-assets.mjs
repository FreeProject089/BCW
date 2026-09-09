import { z } from 'zod';
import { db, requireRole, requireCap } from '../lib/lib.mjs';
import { presignPut, getObject, deleteObject } from '../lib/storage.mjs';

// Platform-hosted assets (app installers, auto-update manifests, links.json / contributors.json)
// served at stable public URLs `/api/assets/<key>`. File assets live in object storage; JSON
// assets are stored inline so admins can edit them in the dashboard. Admin-only to write.
const KEY_RE = /^[a-zA-Z0-9._-]{1,64}$/;

/**
 * What may be served INLINE, by exact content type.
 *
 * An allowlist and not a rule about prefixes. `image/*` would admit `image/svg+xml`, which
 * carries scripts and would run them on our own origin — a file an admin uploaded executing
 * as us is an XSS with an admin account behind it. Same reason `text/*` is absent entirely:
 * `text/html` is in it.
 *
 * Everything else stays an attachment no matter what the caller asks for. `inline` requests
 * the rule, it does not lift it.
 */
const INLINE_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp', 'image/x-icon',
  'video/mp4', 'video/webm', 'video/ogg',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/flac', 'audio/aac',
  'application/pdf',
]);

/**
 * The bucket the dashboard groups by, from the content type.
 *
 * Derived once at upload and stored, so a listing does not parse a MIME string per row —
 * and so an admin who corrected a type once keeps the file where they put it.
 */
export function mediaKind(contentType) {
  const ct = String(contentType || '').toLowerCase();
  if (ct.startsWith('image/')) return 'image';
  if (ct.startsWith('video/')) return 'video';
  if (ct.startsWith('audio/')) return 'audio';
  if (ct === 'application/pdf' || ct.startsWith('text/') || ct.includes('json') || ct.includes('xml')) return 'document';
  if (ct.includes('zip') || ct.includes('compressed') || ct.includes('tar') || ct.includes('7z') || ct.includes('rar')) return 'archive';
  return 'other';
}

const ser = (a) => ({
  key: a.key, kind: a.kind, label: a.label, filename: a.filename || null, contentType: a.contentType || null,
  size: Number(a.size), version: a.version || null, channel: a.channel, updatedAt: a.updatedAt,
  media: a.media || '', countStats: !!a.countStats, views: a.views ?? 0, downloads: a.downloads ?? 0,
  // Whether the browser will render it where it stands. The dashboard asks this before it
  // decides between a thumbnail and a file icon — it must not guess from the extension, or a
  // .png the server refuses to serve inline shows as a broken image.
  inlineOk: a.kind === 'file' && INLINE_TYPES.has(String(a.contentType || '').toLowerCase()),
  url: `/api/assets/${a.key}`,
});

/**
 * Record one hit, when this asset is counted.
 *
 * Not awaited, and it swallows its own failure. A counter is a nice-to-have on a route whose
 * job is to serve bytes: making the file wait on a row update — or fail because one did —
 * would be the statistic costing more than the thing it measures.
 *
 * `increment` rather than read-then-write, so two requests at the same moment are two hits.
 */
function countHit(p, a, inline) {
  if (!a.countStats) return;
  p.platformAsset.update({
    where: { key: a.key },
    data: inline ? { views: { increment: 1 } } : { downloads: { increment: 1 } },
  }).catch(() => {});
}

export default async function platformAssetRoutes(app) {
  // Admin: list every asset (JSON payload included so it can be edited inline).
  app.get('/admin/assets', { preHandler: requireCap('manage_assets') }, async () => {
    const p = await db();
    const rows = await p.platformAsset.findMany({ orderBy: { key: 'asc' } });
    return { assets: rows.map((a) => ({ ...ser(a), json: a.kind === 'json' ? (a.json ?? null) : undefined })) };
  });

  // Admin: upsert a JSON asset (links.json / contributors.json — edited inline).
  app.put('/admin/assets/json/:key', { preHandler: requireCap('manage_assets') }, async (req, reply) => {
    const key = String(req.params.key);
    if (!KEY_RE.test(key)) return reply.code(400).send({ error: 'bad_key' });
    const b = z.object({ label: z.string().max(120).optional(), json: z.any() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const data = { kind: 'json', label: b.data.label ?? '', json: b.data.json ?? {}, updatedById: req.user.uid, storageKey: null };
    await p.platformAsset.upsert({ where: { key }, create: { key, ...data }, update: data });
    return { ok: true };
  });

  // Admin: presign a direct-to-storage upload. The storageKey is minted server-side (under
  // the platform/ prefix) so a client can never target another prefix.
  app.post('/admin/assets/presign', { preHandler: requireCap('manage_assets') }, async (req, reply) => {
    const b = z.object({ key: z.string(), filename: z.string().min(1).max(200), contentType: z.string().max(120).optional() }).safeParse(req.body);
    if (!b.success || !KEY_RE.test(b.data.key)) return reply.code(400).send({ error: 'invalid_input' });
    const safeName = b.data.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storageKey = `platform/${b.data.key}/${Date.now()}-${safeName}`;
    const url = await presignPut(storageKey, b.data.contentType || 'application/octet-stream');
    return { url, storageKey };
  });

  // Admin: confirm a file asset after the presigned PUT succeeded.
  app.put('/admin/assets/file/:key', { preHandler: requireCap('manage_assets') }, async (req, reply) => {
    const key = String(req.params.key);
    if (!KEY_RE.test(key)) return reply.code(400).send({ error: 'bad_key' });
    const b = z.object({
      label: z.string().max(120).optional(), filename: z.string().min(1).max(200),
      contentType: z.string().max(120).optional(), size: z.number().int().nonnegative().max(50 * 1024 ** 3).optional(),
      storageKey: z.string().max(300), version: z.string().max(40).optional(), channel: z.string().max(40).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!b.data.storageKey.startsWith('platform/') || b.data.storageKey.includes('..')) return reply.code(400).send({ error: 'bad_storage_key' });
    const p = await db();
    const prev = await p.platformAsset.findUnique({ where: { key } });
    if (prev?.storageKey && prev.storageKey !== b.data.storageKey) await deleteObject(prev.storageKey).catch(() => {});
    const data = {
      kind: 'file', label: b.data.label ?? prev?.label ?? '', filename: b.data.filename,
      contentType: b.data.contentType || 'application/octet-stream', size: BigInt(b.data.size || 0),
      storageKey: b.data.storageKey, version: b.data.version ?? null, channel: b.data.channel || 'stable',
      media: mediaKind(b.data.contentType),
      updatedById: req.user.uid, json: null,
    };
    await p.platformAsset.upsert({ where: { key }, create: { key, ...data }, update: data });
    return { ok: true };
  });

  /**
   * Admin: the settings that are not the file — its label, and whether it is counted.
   *
   * Separate from the upload on purpose: turning counting on for a video already hosted must
   * not mean re-uploading it, and re-uploading must not silently reset a number somebody has
   * been watching. `resetStats` is the only way the two counters go back to zero, and it says
   * so in its name rather than happening as a side effect of anything else.
   */
  app.patch('/admin/assets/:key', { preHandler: requireCap('manage_assets') }, async (req, reply) => {
    const key = String(req.params.key);
    if (!KEY_RE.test(key)) return reply.code(400).send({ error: 'bad_key' });
    const b = z.object({
      label: z.string().max(120).optional(),
      countStats: z.boolean().optional(),
      resetStats: z.boolean().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const data = {};
    if (b.data.label !== undefined) data.label = b.data.label;
    if (b.data.countStats !== undefined) data.countStats = b.data.countStats;
    if (b.data.resetStats) { data.views = 0; data.downloads = 0; }
    if (!Object.keys(data).length) return reply.code(400).send({ error: 'nothing_to_change' });
    const n = await p.platformAsset.updateMany({ where: { key }, data });
    if (!n.count) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  // Admin: delete an asset (+ purge its stored object).
  app.delete('/admin/assets/:key', { preHandler: requireCap('manage_assets') }, async (req, reply) => {
    const key = String(req.params.key);
    if (!KEY_RE.test(key)) return reply.code(400).send({ error: 'bad_key' });
    const p = await db();
    const a = await p.platformAsset.findUnique({ where: { key } });
    if (!a) return reply.code(404).send({ error: 'not_found' });
    if (a.storageKey) await deleteObject(a.storageKey).catch(() => {});
    await p.platformAsset.delete({ where: { key } });
    return { ok: true };
  });

  // ── Auto-update feed ─────────────────────────────────────────────────────────
  // BMM/BSM check for updates against a GitHub-releases-compatible endpoint (the app's
  // `autoupdate_api` link). These routes mirror that shape from the hosted installer +
  // optional update-manifest, so an app can point `autoupdate_api` at BCWEB instead of
  // GitHub. Maps app slug → asset keys.
  const UPDATE_APPS = { bmm: { inst: 'bmm-installer', manifest: 'bmm-update-manifest', page: 'bmm' },
                        bsm: { inst: 'bsm-installer', manifest: 'bsm-update-manifest', page: 'bsm' },
                        bi:  { inst: 'bi-installer',  manifest: 'bi-update-manifest',  page: 'installer' } };

  const releaseShape = (cfg, installer, manifest, notes, origin) => {
    const version = installer.version || '0.0.0';
    const assets = [{ name: installer.filename || `${cfg.inst}`, browser_download_url: `${origin}/api/assets/${installer.key}`, size: Number(installer.size) }];
    if (manifest) assets.push({ name: 'update-manifest.json', browser_download_url: `${origin}/api/assets/${manifest.key}` });
    return {
      tag_name: `v${version}`, name: `v${version}`,
      prerelease: !!(installer.channel && installer.channel !== 'stable'), draft: false,
      html_url: `${origin}/p/${cfg.page}`, body: notes || '',
      published_at: installer.updatedAt, assets,
    };
  };

  const buildRelease = async (appSlug, origin) => {
    const cfg = UPDATE_APPS[String(appSlug).toLowerCase()];
    if (!cfg) return { code: 404, error: 'unknown_app' };
    const p = await db();
    const installer = await p.platformAsset.findUnique({ where: { key: cfg.inst } });
    if (!installer || installer.kind !== 'file' || !installer.storageKey) return { code: 404, error: 'no_release' };
    const manifest = await p.platformAsset.findUnique({ where: { key: cfg.manifest } }).catch(() => null);
    // Optional release-notes JSON asset (<app>-release-notes → { body }).
    const notesAsset = await p.platformAsset.findUnique({ where: { key: `${appSlug}-release-notes` } }).catch(() => null);
    const notes = notesAsset?.json?.body || '';
    return { release: releaseShape(cfg, installer, manifest && manifest.storageKey ? manifest : null, notes, origin) };
  };

  const originOf = () => (process.env.SITE_URL || 'https://bettercommunity.ch').replace(/\/+$/, '');

  // Latest release (GitHub /releases/latest shape).
  app.get('/updates/:app/latest', async (req, reply) => {
    const r = await buildRelease(req.params.app, originOf());
    reply.header('Cache-Control', 'public, max-age=60').header('Access-Control-Allow-Origin', '*');
    if (r.error) return reply.code(r.code).send({ error: r.error });
    return r.release;
  });
  // Release list (GitHub /releases shape — newest first; we host one).
  app.get('/updates/:app/releases', async (req, reply) => {
    const r = await buildRelease(req.params.app, originOf());
    reply.header('Cache-Control', 'public, max-age=60').header('Access-Control-Allow-Origin', '*');
    if (r.error) return r.code === 404 && r.error === 'no_release' ? [] : reply.code(r.code).send({ error: r.error });
    return [r.release];
  });

  // Public: serve an asset at a stable URL. JSON returns inline (CORS-open so BMM/BSM can
  // fetch it cross-origin); files stream from storage, forced to download. This is the
  // "BCWEB-first" source the apps point at (GitHub, then a bundled local copy, are fallbacks).
  app.get('/assets/:key', async (req, reply) => {
    const key = String(req.params.key);
    if (!KEY_RE.test(key)) return reply.code(404).send({ error: 'not_found' });
    const p = await db();
    const a = await p.platformAsset.findUnique({ where: { key } });
    if (!a) return reply.code(404).send({ error: 'not_found' });
    if (a.kind === 'json') {
      reply.header('Cache-Control', 'public, max-age=120').header('Access-Control-Allow-Origin', '*');
      return reply.send(a.json ?? {});
    }
    if (!a.storageKey) return reply.code(404).send({ error: 'not_found' });
    // Asked for, and granted only for types a browser cannot execute. `inline` requests the
    // rule; it does not lift it — see INLINE_TYPES.
    const wantsInline = req.query?.inline === '1' || req.query?.inline === 'true';
    const type = String(a.contentType || '').toLowerCase();
    const inline = wantsInline && INLINE_TYPES.has(type);
    try {
      const { body, contentType } = await getObject(a.storageKey);
      reply.header('Content-Type', a.contentType || contentType || 'application/octet-stream')
        .header('Cache-Control', 'public, max-age=300')
        .header('Access-Control-Allow-Origin', '*')
        .header('X-Content-Type-Options', 'nosniff')
        // Belt and braces beside the allowlist: even for the types served inline, nothing
        // here may pull in a script, a frame or a stylesheet of its own.
        .header('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; media-src 'self'; object-src 'none'; sandbox")
        .header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${(a.filename || key).replace(/[^a-zA-Z0-9._-]/g, '_')}"`);
      countHit(p, a, inline);
      return reply.send(body);
    } catch { return reply.code(404).send({ error: 'not_found' }); }
  });
}
