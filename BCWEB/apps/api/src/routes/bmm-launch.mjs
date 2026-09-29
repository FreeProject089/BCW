// notify (agent-notify): the BMM launch feed, the routes. The rules live in lib/bmm-launch.mjs.
//
//   GET  /bmm/launch?version=&lang=        public, no auth, cached, ETag (the contract document)
//   GET  /admin/bmm-launch                 the admin screen: switch, items (resolved), post picker
//   PUT  /admin/bmm-launch/config          { enabled }  ("none" = switched off)
//   POST /admin/bmm-launch/items           add a card
//   PUT  /admin/bmm-launch/items/:id       edit a card
//   DELETE /admin/bmm-launch/items/:id
//   POST /admin/bmm-launch/preview         an unsaved card, resolved exactly as BMM would get it
//
// All admin routes need manage_announcements: a launch card is an announcement that happens to
// be shown by the desktop app instead of the site.
import crypto from 'node:crypto';
import { z } from 'zod';
import { db, requireCap, logAudit, clientIp } from '../lib/lib.mjs';
import { cached, invalidate } from '../lib/cache.mjs';
import { KEY_SHAPE } from '../lib/project-keys.mjs';
import {
  SOURCES, DISPLAY_MODES, SUMMARY_MAX, MAX_ITEMS, LAUNCH_CONFIG_KEY,
  httpsUrl, isSemver, compareSemver, resolveContent, contentHashOf, isLive, matchesVersion, publicItem, sortItems,
} from '../lib/bmm-launch.mjs';

const CACHE_KEY = 'bmm-launch:resolved';
const CACHE_TTL = 60_000;
const POST_SELECT = { id: true, slug: true, title: true, titleFr: true, excerpt: true, excerptFr: true, cover: true, status: true, publishedAt: true, createdAt: true };

export async function launchConfig(p) {
  const row = await p.adminSetting.findUnique({ where: { key: LAUNCH_CONFIG_KEY } }).catch(() => null);
  const v = row?.value && typeof row.value === 'object' ? row.value : {};
  return { enabled: v.enabled !== false };
}

/** The rows resolveContent needs, fetched in two queries whatever the number of items. */
async function contextFor(p, items) {
  const postIds = [...new Set(items.filter((i) => i.source === 'post' && i.postId).map((i) => i.postId))];
  const keys = [...new Set(items.filter((i) => i.source === 'latest').map((i) => i.projectKey || 'bmm'))];
  const [posts, latest] = await Promise.all([
    postIds.length ? p.blogPost.findMany({ where: { id: { in: postIds } }, select: POST_SELECT }) : [],
    Promise.all(keys.map(async (k) => [k, await p.blogPost.findFirst({
      where: { status: 'PUBLISHED', project: { key: k } }, orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }], select: POST_SELECT,
    })])),
  ]);
  return { postsById: new Map(posts.map((x) => [x.id, x])), latestByProject: new Map(latest.filter(([, v]) => v)) };
}

/**
 * Resolve every enabled item and move `rev` where the content changed. The bump is a
 * conditional update on the old hash, so two replicas noticing the same change bump once.
 * The first resolution of a new item records its hash without bumping: rev 1 is its first
 * content.
 */
export async function resolveItems(p, items) {
  const ctx = await contextFor(p, items);
  const out = [];
  for (const item of items) {
    const c = resolveContent(item, ctx);
    const h = contentHashOf(c);
    let rev = item.rev;
    if (c && h !== item.contentHash) {
      const data = item.contentHash ? { contentHash: h, rev: { increment: 1 } } : { contentHash: h };
      const r = await p.bmmLaunchItem.updateMany({ where: { id: item.id, contentHash: item.contentHash }, data }).catch(() => ({ count: 0 }));
      const fresh = await p.bmmLaunchItem.findUnique({ where: { id: item.id }, select: { rev: true } }).catch(() => null);
      rev = fresh?.rev ?? (r.count && item.contentHash ? item.rev + 1 : item.rev);
    }
    out.push({ item: { ...item, rev }, content: c });
  }
  return out;
}

/** What the public route serves from: every enabled item, resolved; [] when switched off. */
async function publicSnapshot() {
  return cached(CACHE_KEY, CACHE_TTL, async () => {
    const p = await db();
    const cfg = await launchConfig(p);
    const at = new Date().toISOString();
    if (!cfg.enabled) return { at, list: [] };
    const items = await p.bmmLaunchItem.findMany({ where: { enabled: true }, orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }], take: 50 });
    const resolved = await resolveItems(p, items);
    return { at, list: resolved.filter((r) => r.content) };
  });
}

/** The contract document for one version + language, from a snapshot. Exported for the tests. */
export function launchDocument(snapshot, { version, lang, now = new Date() }) {
  const items = sortItems((snapshot.list || [])
    .filter(({ item }) => isLive(item, now) && matchesVersion(item, version))
    .map(({ item, content }) => publicItem(item, content, lang))
    // Defence in depth: nothing that is not an absolute https link leaves, whatever the row
    // holds (the dev exception is the site's own http://localhost, decided in lib/bmm-launch).
    .filter((it) => it.url && (it.url.startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(it.url))))
    .slice(0, MAX_ITEMS);
  return { v: 1, generatedAt: snapshot.at, items };
}

export const launchEtag = (doc) => `"${crypto.createHash('sha256').update(JSON.stringify([doc.v, doc.items])).digest('base64url').slice(0, 27)}"`;

const optDate = z.string().datetime().nullable().optional();
const optSemver = z.string().trim().max(40).nullable().optional().refine((v) => !v || isSemver(v), { message: 'not a semver' });

const itemSchema = z.object({
  source: z.enum(SOURCES),
  postId: z.string().max(40).nullable().optional(),
  projectKey: z.string().regex(KEY_SHAPE).default('bmm'),
  title: z.string().trim().max(160).default(''),
  titleFr: z.string().trim().max(160).default(''),
  summary: z.string().trim().max(SUMMARY_MAX).default(''),
  summaryFr: z.string().trim().max(SUMMARY_MAX).default(''),
  url: z.string().trim().max(2048).default(''),
  imageUrl: z.string().trim().max(2048).default(''),
  displayMode: z.enum(DISPLAY_MODES).default('once'),
  times: z.number().int().min(1).max(100).default(1),
  startsAt: optDate,
  endsAt: optDate,
  minVersion: optSemver,
  maxVersion: optSemver,
  priority: z.number().int().min(-100).max(100).default(0),
  enabled: z.boolean().default(true),
});

/** Cross-field rules zod cannot say per field. Returns an error code or null. */
export function itemProblem(d) {
  if (d.source === 'post' && !d.postId) return 'post_required';
  if (d.source === 'custom') {
    if (!d.title) return 'title_required';
    // Parsed and https-only: javascript:, data:, http: and a URL carrying credentials all fail.
    if (!httpsUrl(d.url)) return 'url_must_be_https';
  }
  if (d.imageUrl && !httpsUrl(d.imageUrl) && !(d.imageUrl.startsWith('/') && !d.imageUrl.startsWith('//'))) return 'image_must_be_https';
  if (d.startsAt && d.endsAt && new Date(d.endsAt) <= new Date(d.startsAt)) return 'dates_reversed';
  if (d.minVersion && d.maxVersion && isSemver(d.minVersion) && isSemver(d.maxVersion)) {
    if (compareSemver(d.minVersion, d.maxVersion) > 0) return 'versions_reversed';
  }
  return null;
}

const toRow = (d) => ({
  source: d.source, postId: d.source === 'post' ? d.postId : null, projectKey: d.projectKey || 'bmm',
  title: d.title, titleFr: d.titleFr, summary: d.summary, summaryFr: d.summaryFr, url: d.url, imageUrl: d.imageUrl,
  displayMode: d.displayMode, times: d.times,
  startsAt: d.startsAt ? new Date(d.startsAt) : null, endsAt: d.endsAt ? new Date(d.endsAt) : null,
  minVersion: d.minVersion || null, maxVersion: d.maxVersion || null, priority: d.priority, enabled: d.enabled,
});

export default async function bmmLaunchRoutes(app) {
  app.get('/bmm/launch', { config: { rateLimit: { max: 240, timeWindow: '1 minute' } } }, async (req, reply) => {
    const lang = String(req.query?.lang || '').toLowerCase().startsWith('fr') ? 'fr' : 'en';
    const version = String(req.query?.version || '').slice(0, 40);
    const doc = launchDocument(await publicSnapshot(), { version, lang });
    const etag = launchEtag(doc);
    reply.header('Cache-Control', 'public, max-age=60');
    reply.header('Vary', 'Accept-Encoding');
    reply.header('ETag', etag);
    const inm = String(req.headers['if-none-match'] || '');
    if (inm && inm.split(',').some((t) => t.trim().replace(/^W\//, '') === etag)) return reply.code(304).send();
    return doc;
  });

  const ADMIN = requireCap('manage_announcements');

  app.get('/admin/bmm-launch', { preHandler: ADMIN }, async () => {
    const p = await db();
    const [cfg, items, posts] = await Promise.all([
      launchConfig(p),
      p.bmmLaunchItem.findMany({ orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }] }),
      p.blogPost.findMany({
        where: { status: 'PUBLISHED' }, orderBy: { publishedAt: 'desc' }, take: 40,
        select: { id: true, title: true, slug: true, publishedAt: true, project: { select: { key: true } }, showcaseProject: { select: { name: true } } },
      }),
    ]);
    const resolved = await resolveItems(p, items);
    invalidate(CACHE_KEY);
    const now = new Date();
    return {
      config: cfg,
      items: resolved.map(({ item, content }) => ({
        ...item, live: isLive(item, now) && !!content, broken: !content,
        preview: content ? { en: publicItem(item, content, 'en'), fr: publicItem(item, content, 'fr') } : null,
      })),
      posts: posts.map((x) => ({ id: x.id, title: x.title, slug: x.slug, publishedAt: x.publishedAt, project: x.project?.key || x.showcaseProject?.name || null })),
    };
  });

  app.put('/admin/bmm-launch/config', { preHandler: ADMIN }, async (req, reply) => {
    const b = z.object({ enabled: z.boolean() }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    await p.adminSetting.upsert({ where: { key: LAUNCH_CONFIG_KEY }, create: { key: LAUNCH_CONFIG_KEY, value: b.data }, update: { value: b.data } });
    invalidate(CACHE_KEY);
    await logAudit(p, req.user.uid, 'bmm.launch.config', `enabled=${b.data.enabled}`, clientIp(req));
    return { ok: true, config: b.data };
  });

  app.post('/admin/bmm-launch/preview', { preHandler: ADMIN }, async (req, reply) => {
    const b = itemSchema.safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input', details: b.error.flatten() });
    const problem = itemProblem(b.data);
    if (problem) return reply.code(400).send({ error: problem });
    const p = await db();
    const draft = { id: 'preview', rev: 1, createdAt: new Date(), updatedAt: new Date(), ...toRow(b.data) };
    const content = resolveContent(draft, await contextFor(p, [draft]));
    if (!content) return reply.code(409).send({ error: 'nothing_to_show' });
    return { en: publicItem(draft, content, 'en'), fr: publicItem(draft, content, 'fr') };
  });

  app.post('/admin/bmm-launch/items', { preHandler: ADMIN, config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const b = itemSchema.safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input', details: b.error.flatten() });
    const problem = itemProblem(b.data);
    if (problem) return reply.code(400).send({ error: problem });
    const p = await db();
    if (await p.bmmLaunchItem.count() >= 50) return reply.code(409).send({ error: 'too_many_items' });
    const row = await p.bmmLaunchItem.create({ data: { ...toRow(b.data), createdById: req.user.uid } });
    invalidate(CACHE_KEY);
    await logAudit(p, req.user.uid, 'bmm.launch.item.created', `${row.id} ${row.source}`, clientIp(req));
    return reply.code(201).send({ item: row });
  });

  app.put('/admin/bmm-launch/items/:id', { preHandler: ADMIN }, async (req, reply) => {
    const b = itemSchema.safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input', details: b.error.flatten() });
    const problem = itemProblem(b.data);
    if (problem) return reply.code(400).send({ error: problem });
    const p = await db();
    const row = await p.bmmLaunchItem.update({ where: { id: String(req.params.id) }, data: toRow(b.data) }).catch(() => null);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    invalidate(CACHE_KEY);
    await logAudit(p, req.user.uid, 'bmm.launch.item.updated', `${row.id} ${row.source}`, clientIp(req));
    return { item: row };
  });

  app.delete('/admin/bmm-launch/items/:id', { preHandler: ADMIN }, async (req, reply) => {
    const p = await db();
    const { count } = await p.bmmLaunchItem.deleteMany({ where: { id: String(req.params.id) } });
    if (!count) return reply.code(404).send({ error: 'not_found' });
    invalidate(CACHE_KEY);
    await logAudit(p, req.user.uid, 'bmm.launch.item.deleted', String(req.params.id), clientIp(req));
    return { ok: true };
  });
}
// fin notify (agent-notify)
