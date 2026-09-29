import crypto from 'node:crypto';
import { z } from 'zod';
import { db, requireRole, requireCap, safeEqual, hashApiKey, logAudit, clientIp } from '../lib/lib.mjs';
import { presignPut, getObject, deleteObject } from '../lib/storage.mjs';
import { verifyTotp } from '../lib/totp.mjs';
import { genKey, prefixOf } from './api-keys.mjs';
import { ASSET_PUBLISH_SCOPE, CI_ASSET_SLOTS, CI_KEY_MAX_DAYS, SHA256_RE, assetPublishAuth, hashStoredObject } from '../lib/asset-publish.mjs';

// assetskey (agent-assets-key): the storage calls go through this object so the route tests can
// hand in a double (CI has no object store). Production never touches it.
const store = { presignPut, getObject, deleteObject };
export function _setAssetStoreForTests(s) {
  Object.assign(store, s || { presignPut, getObject, deleteObject });
}

// Platform-hosted assets (app installers, auto-update manifests, links.json / contributors.json)
// served at stable public URLs `/api/assets/<key>`. File assets live in object storage; JSON
// assets are stored inline so admins can edit them in the dashboard. Admin-only to write.
const KEY_RE = /^[a-zA-Z0-9._-]{1,64}$/;
// The largest platform file (an installer) the presign and the confirm accept.
const ASSET_MAX_BYTES = 50 * 1024 ** 3;

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
  sha256: a.sha256 || null,
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
  // the platform/ prefix) so a client can never target another prefix. `size` is required and
  // signed into the URL with the type (storage.mjs presignPut): the store refuses any other
  // byte count. Capped at the ceiling the confirm route below already accepts.
  app.post('/admin/assets/presign', { preHandler: requireCap('manage_assets') }, async (req, reply) => {
    const b = z.object({ key: z.string(), filename: z.string().min(1).max(200), contentType: z.string().max(120).optional(), size: z.number().int().positive().max(ASSET_MAX_BYTES) }).safeParse(req.body);
    if (!b.success || !KEY_RE.test(b.data.key)) return reply.code(400).send({ error: 'invalid_input' });
    const safeName = b.data.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storageKey = `platform/${b.data.key}/${Date.now()}-${safeName}`;
    const url = await store.presignPut(storageKey, { contentType: b.data.contentType || 'application/octet-stream', size: b.data.size });
    return { url, storageKey };
  });

  // Admin: confirm a file asset after the presigned PUT succeeded.
  app.put('/admin/assets/file/:key', { preHandler: requireCap('manage_assets') }, async (req, reply) => {
    const key = String(req.params.key);
    if (!KEY_RE.test(key)) return reply.code(400).send({ error: 'bad_key' });
    const b = z.object({
      label: z.string().max(120).optional(), filename: z.string().min(1).max(200),
      contentType: z.string().max(120).optional(), size: z.number().int().nonnegative().max(ASSET_MAX_BYTES).optional(),
      storageKey: z.string().max(300), version: z.string().max(40).optional(), channel: z.string().max(40).optional(),
      // assetskey (agent-assets-key): optional here, required on the CI route. When given, the
      // bytes in storage must hash to it before the slot moves; a mismatch keeps the old file.
      sha256: z.string().regex(SHA256_RE).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!b.data.storageKey.startsWith('platform/') || b.data.storageKey.includes('..')) return reply.code(400).send({ error: 'bad_storage_key' });
    const p = await db();
    if (b.data.sha256) {
      const got = await hashStoredObject(store.getObject, b.data.storageKey).catch(() => null);
      if (!got) return reply.code(409).send({ error: 'upload_missing' });
      if (!safeEqual(got.sha256, b.data.sha256)) {
        await store.deleteObject(b.data.storageKey).catch(() => {});
        return reply.code(422).send({ error: 'hash_mismatch' });
      }
    }
    const prev = await p.platformAsset.findUnique({ where: { key } });
    if (prev?.storageKey && prev.storageKey !== b.data.storageKey) await store.deleteObject(prev.storageKey).catch(() => {});
    const data = {
      kind: 'file', label: b.data.label ?? prev?.label ?? '', filename: b.data.filename,
      contentType: b.data.contentType || 'application/octet-stream', size: BigInt(b.data.size || 0),
      storageKey: b.data.storageKey, version: b.data.version ?? null, channel: b.data.channel || 'stable',
      media: mediaKind(b.data.contentType), sha256: b.data.sha256 || null,
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
    if (a.storageKey) await store.deleteObject(a.storageKey).catch(() => {});
    await p.platformAsset.delete({ where: { key } });
    return { ok: true };
  });

  // ── assetskey (agent-assets-key): the CI publish key ──────────────────────────
  //
  // Minted here, by an ADMIN or SUPERADMIN holding manage_assets, with a fresh TOTP code: it
  // is a credential that outlives the session that made it. Bound to named slots from
  // CI_ASSET_SLOTS, always expiring. Used only by the two /ci/assets routes below. The rules,
  // and why each exists, are in lib/asset-publish.mjs.
  const ciKeyView = { id: true, label: true, prefix: true, assetSlots: true, expiresAt: true, revokedAt: true, lastUsedAt: true, createdAt: true,
    user: { select: { id: true, displayName: true } } };
  const ciKeyOut = (k) => { const { user, ...rest } = k; return { ...rest, owner: user ? { id: user.id, displayName: user.displayName } : null }; };
  const RL_MINT = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };
  // Per IP. A release pushes three files, each two calls; a runner retrying stays far below.
  const RL_CI = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

  app.get('/admin/assets/ci-keys', { preHandler: requireCap('manage_assets') }, async () => {
    const p = await db();
    const keys = await p.apiKey.findMany({ where: { scopes: { has: ASSET_PUBLISH_SCOPE } }, select: ciKeyView, orderBy: { createdAt: 'desc' }, take: 100 });
    return {
      keys: keys.map(ciKeyOut),
      slots: Object.entries(CI_ASSET_SLOTS).map(([id, s]) => ({ id, maxBytes: s.maxBytes, types: s.types })),
      maxDays: CI_KEY_MAX_DAYS,
    };
  });

  app.post('/admin/assets/ci-keys', { preHandler: requireCap('manage_assets'), ...RL_MINT }, async (req, reply) => {
    // manage_assets alone is not enough to mint: a delegated asset manager may upload by hand,
    // but handing a credential to a CI runner is an administrator's decision.
    if (!['ADMIN', 'SUPERADMIN'].includes(req.user.role)) return reply.code(403).send({ error: 'admin_only' });
    const b = z.object({
      label: z.string().max(60).optional(),
      slots: z.array(z.string().max(64)).min(1).max(Object.keys(CI_ASSET_SLOTS).length),
      expiresInDays: z.number().int().min(1).max(CI_KEY_MAX_DAYS),
      totp: z.string().max(12),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const slots = [...new Set(b.data.slots)];
    if (slots.some((s) => !CI_ASSET_SLOTS[s])) return reply.code(400).send({ error: 'unknown_slot', allowed: Object.keys(CI_ASSET_SLOTS) });
    const p = await db();
    const u = await p.user.findUnique({ where: { id: req.user.uid }, select: { totpSecret: true } });
    if (!u?.totpSecret || !verifyTotp(u.totpSecret, b.data.totp)) return reply.code(401).send({ error: 'totp_invalid' });
    const live = await p.apiKey.count({ where: { userId: req.user.uid, revokedAt: null, scopes: { has: ASSET_PUBLISH_SCOPE } } });
    if (live >= 5) return reply.code(409).send({ error: 'too_many_keys', max: 5 });
    const secret = genKey();
    const expiresAt = new Date(Date.now() + b.data.expiresInDays * 86400_000);
    const label = (b.data.label || '').trim().slice(0, 60) || 'CI publish';
    const row = await p.apiKey.create({
      data: { userId: req.user.uid, label, prefix: prefixOf(secret), hash: hashApiKey(secret), scopes: [ASSET_PUBLISH_SCOPE], assetSlots: slots, expiresAt },
      select: ciKeyView,
    });
    await logAudit(p, req.user.uid, 'assets.ci_key_minted', `${row.prefix}… slots=${slots.join(',')} expires=${expiresAt.toISOString().slice(0, 10)}`, clientIp(req));
    // The only time the secret leaves the server: it is stored as a hash and cannot be shown again.
    return reply.code(201).send({ key: ciKeyOut(row), secret });
  });

  app.post('/admin/assets/ci-keys/:id/revoke', { preHandler: requireCap('manage_assets') }, async (req, reply) => {
    const p = await db();
    const k = await p.apiKey.findFirst({ where: { id: String(req.params.id), scopes: { has: ASSET_PUBLISH_SCOPE } }, select: { id: true, prefix: true, revokedAt: true } });
    if (!k) return reply.code(404).send({ error: 'not_found' });
    if (!k.revokedAt) {
      await p.apiKey.update({ where: { id: k.id }, data: { revokedAt: new Date() } });
      await logAudit(p, req.user.uid, 'assets.ci_key_revoked', `${k.prefix}…`, clientIp(req));
    }
    return { ok: true };
  });

  // CI, step 1: a presigned PUT for one slot the key is bound to. Same storage path as the
  // dashboard's upload (the bytes go straight to the store, never through the API), with the
  // slot's own byte ceiling and content types instead of the installer-sized global one.
  app.post('/ci/assets/:slot/presign', { preHandler: assetPublishAuth(), ...RL_CI }, async (req, reply) => {
    const slot = String(req.params.slot);
    const cfg = CI_ASSET_SLOTS[slot];
    const b = z.object({
      filename: z.string().min(1).max(200), contentType: z.string().max(120),
      size: z.number().int().positive(), sha256: z.string().regex(SHA256_RE),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!cfg.types.includes(b.data.contentType)) return reply.code(415).send({ error: 'bad_content_type', allowed: cfg.types });
    if (b.data.size > cfg.maxBytes) return reply.code(413).send({ error: 'too_large', maxBytes: cfg.maxBytes });
    const safeName = b.data.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storageKey = `platform/${slot}/ci-${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeName}`;
    const url = await store.presignPut(storageKey, { contentType: b.data.contentType, size: b.data.size, expiresIn: 900 });
    return { url, storageKey, expiresIn: 900 };
  });

  // CI, step 2: switch the slot to the uploaded object, but only once the bytes the store holds
  // hash to the declared SHA-256 and fit the slot. Otherwise the new object is deleted and the
  // slot keeps serving its old file. Audit-chained either way.
  app.put('/ci/assets/:slot', { preHandler: assetPublishAuth(), ...RL_CI }, async (req, reply) => {
    const slot = String(req.params.slot);
    const cfg = CI_ASSET_SLOTS[slot];
    const b = z.object({
      filename: z.string().min(1).max(200), contentType: z.string().max(120),
      size: z.number().int().positive(), sha256: z.string().regex(SHA256_RE),
      storageKey: z.string().max(300), version: z.string().max(40).optional(), channel: z.string().max(40).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const sk = b.data.storageKey;
    // Only an object this slot's presign could have named: its own `ci-` prefix, no climbing.
    if (!sk.startsWith(`platform/${slot}/ci-`) || sk.includes('..') || sk.includes(String.fromCharCode(92))) return reply.code(400).send({ error: 'bad_storage_key' });
    if (!cfg.types.includes(b.data.contentType)) return reply.code(415).send({ error: 'bad_content_type', allowed: cfg.types });
    const p = await db();
    const who = `${req.apiKey.prefix}…`;
    const got = await hashStoredObject(store.getObject, sk).catch(() => null);
    if (!got) return reply.code(409).send({ error: 'upload_missing' });
    const reject = async (error) => {
      await store.deleteObject(sk).catch(() => {});
      await logAudit(p, req.user.uid, 'assets.ci_publish_rejected', `${slot} ${error} key=${who}`, clientIp(req));
      return reply.code(422).send({ error });
    };
    if (got.size > cfg.maxBytes) return reject('too_large');
    if (got.size !== b.data.size) return reject('size_mismatch');
    if (!safeEqual(got.sha256, b.data.sha256)) return reject('hash_mismatch');
    const prev = await p.platformAsset.findUnique({ where: { key: slot }, select: { storageKey: true, label: true } });
    const data = {
      kind: 'file', label: prev?.label || '', filename: b.data.filename, contentType: b.data.contentType,
      size: BigInt(got.size), storageKey: sk, version: b.data.version ?? null, channel: b.data.channel || 'stable',
      media: mediaKind(b.data.contentType), sha256: got.sha256, updatedById: req.user.uid, json: null,
    };
    await p.platformAsset.upsert({ where: { key: slot }, create: { key: slot, ...data }, update: data });
    // The old object goes only AFTER the slot points at the new one: a failure between the two
    // leaves an orphan in storage, never a slot pointing at nothing.
    if (prev?.storageKey && prev.storageKey !== sk) await store.deleteObject(prev.storageKey).catch(() => {});
    await logAudit(p, req.user.uid, 'assets.ci_publish', `${slot} v=${b.data.version || '-'} sha256=${got.sha256} size=${got.size} key=${who}`, clientIp(req));
    return { ok: true, key: slot, sha256: got.sha256, size: got.size, version: b.data.version || null, url: `/api/assets/${slot}` };
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
      const { body, contentType } = await store.getObject(a.storageKey);
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
