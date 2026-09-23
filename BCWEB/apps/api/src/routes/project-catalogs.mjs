// Project catalogues (G4): every project, official or "other", can carry catalogues of its own,
// configured from the project's admin page by the people who may edit that project.
//
// The shape, the validation and the feeds are in lib/project-catalogs.mjs. This file answers
// two questions and nothing else: who may see a project's catalogues (the page's own
// visibility gate, asked the same way the page asks it) and who may change them (the same
// canEditProject / canEditShowcase the page editor uses, behind requireEditor's 2FA wall).
import { z } from 'zod';
import { db, requireEditor, optionalAuth, canEditProject, canEditShowcase, canViewPage, hasCap, logAudit, clientIp } from '../lib/lib.mjs';
import { projectKeys, isProjectKey } from '../lib/project-keys.mjs';
import { findBlock } from '../lib/urlblock.mjs';
import { CATALOG_KINDS } from '../lib/catalog-kinds.mjs';
import {
  SCOPES, settingKeyFor, BUILTIN_TAGS, INLINE_KINDS, FIELD_TYPES, LIMITS, EMPTY_CONFIG,
  normalizeConfig, urlsOfConfig, tagsFor, inlineDisplay, catalogSummary, feedOf,
} from '../lib/project-catalogs.mjs';

const STAFF = new Set(['MOD', 'ADMIN', 'SUPERADMIN']);
const isStaff = (req) => !!req.user && STAFF.has(req.user.role);
const announcing = (row) => row.announceEnabled && row.announceRevealAt && row.announceRevealAt > new Date();

async function readConfig(p, scope, ref) {
  const row = await p.adminSetting.findUnique({ where: { key: settingKeyFor(scope, ref) } }).catch(() => null);
  return row?.value && typeof row.value === 'object' ? row.value : null;
}

/**
 * The project behind a public (scope, ref), if this visitor may see it.
 *
 * `ref` is the KEY for an official project and the SLUG for an other project: those are the
 * two names that appear in the site's own URLs (/p/<key>, /projects/<slug>). Storage is keyed
 * by the showcase id instead, which a rename cannot change.
 *
 * Visibility is the page's own: public and unlisted are readable by link, a whitelist is
 * asked of canViewPage, private is staff only. A page still behind its countdown shows no
 * catalogue, since it shows nothing else yet either.
 */
async function publicProject(p, scope, ref, req) {
  if (scope === 'project') {
    if (!(await isProjectKey(ref))) return null;
    const row = await p.project.findUnique({ where: { key: ref }, select: { key: true, name: true, visibility: true, visibilityWhitelist: true } });
    if (!row) return null;
    const ok = ref === 'community' || row.visibility === 'public' || row.visibility === 'unlisted' || isStaff(req)
      || await canViewPage(p, { visibility: row.visibility, whitelist: row.visibilityWhitelist }, req);
    if (!ok) return null;
    const cfg = await p.adminSetting.findUnique({ where: { key: `project.${ref}` } }).catch(() => null);
    return { scope, ref, storeRef: ref, official: true, key: ref, name: cfg?.value?.name || row.name, icon: null };
  }
  const row = await p.showcaseProject.findUnique({ where: { slug: ref } });
  if (!row) return null;
  if (!isStaff(req)) {
    if (!row.published || announcing(row)) return null;
    const ok = row.visibility === 'public' || row.visibility === 'unlisted'
      || await canViewPage(p, { visibility: row.visibility, whitelist: row.visibilityWhitelist }, req);
    if (!ok) return null;
  }
  return { scope, ref, storeRef: row.id, official: false, slug: row.slug, name: row.name, icon: row.icon || null };
}

/** A community catalogue a project links to, as the public may see it — or null. */
async function linkedCommunity(p, slug) {
  if (!slug) return null;
  const c = await p.communityCatalog.findUnique({ where: { slug }, select: { slug: true, name: true, status: true, visibility: true, kinds: true } }).catch(() => null);
  return c && c.status === 'ACTIVE' && c.visibility === 'public' ? { slug: c.slug, name: c.name } : null;
}

/** Everything an editor may be told about a catalogue list besides its content. */
const editorMeta = (isOfficial) => ({
  builtinTags: BUILTIN_TAGS, kinds: CATALOG_KINDS, inlineKinds: Object.keys(INLINE_KINDS), inlineFields: INLINE_KINDS,
  fieldTypes: FIELD_TYPES, limits: LIMITS, isOfficial,
});

export default async function projectCatalogRoutes(app) {
  // ── Public: the project picker on /catalog ──
  // Official projects appear when they publish something (items of a kind, or a catalogue of
  // their own); other projects when they carry at least one catalogue. Discovery lists only
  // PUBLIC pages, like /showcase does: an unlisted page is reachable by its link, not listed.
  app.get('/project-catalogs', async () => {
    const p = await db();
    const keys = await projectKeys();
    const [rows, settings, counts, shows] = await Promise.all([
      p.project.findMany({ where: { key: { in: keys } }, select: { id: true, key: true, name: true, visibility: true } }),
      p.adminSetting.findMany({ where: { key: { startsWith: 'catalogs.' } } }),
      p.catalogItem.groupBy({ by: ['projectId', 'kind'], where: { status: 'PUBLISHED' }, _count: { _all: true } }),
      p.showcaseProject.findMany({ where: { published: true, visibility: 'public' }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] }),
    ]);
    const cfgs = Object.fromEntries(settings.map((s) => [s.key, s.value]));
    const names = Object.fromEntries((await p.adminSetting.findMany({ where: { key: { in: keys.map((k) => `project.${k}`) } }, select: { key: true, value: true } }))
      .map((r) => [r.key.slice(8), r.value?.name]));
    const out = [];
    for (const r of rows) {
      if (r.key !== 'community' && r.visibility !== 'public') continue;
      const cfg = cfgs[settingKeyFor('project', r.key)];
      const live = cfg?.enabled === false ? [] : (cfg?.catalogs || []);
      const kinds = new Set(counts.filter((c) => c.projectId === r.id).map((c) => c.kind));
      for (const c of live) if (c.format === 'bmm' && c.source === 'official') kinds.add(c.kind);
      const items = counts.filter((c) => c.projectId === r.id).reduce((n, c) => n + c._count._all, 0);
      const extra = live.filter((c) => !(c.format === 'bmm' && c.source === 'official'));
      if (!kinds.size && !extra.length) continue;
      out.push({ scope: 'project', ref: r.key, official: true, name: names[r.key] || r.name, icon: null, officialKinds: CATALOG_KINDS.filter((k) => kinds.has(k)), items, catalogs: extra.map(catalogSummary) });
    }
    for (const s of shows) {
      if (announcing(s)) continue;
      const cfg = cfgs[settingKeyFor('showcase', s.id)];
      const live = cfg?.enabled === false ? [] : (cfg?.catalogs || []);
      if (!live.length) continue;
      out.push({ scope: 'showcase', ref: s.slug, official: false, name: s.name, icon: s.icon || null, officialKinds: [], items: 0, catalogs: live.map(catalogSummary) });
    }
    return { projects: out, builtinTags: BUILTIN_TAGS };
  });

  // ── Public: one project's catalogues + the tags it offers ──
  // Answers for any visible official project even with nothing configured: the submission form
  // asks it for the tag list, and the built-in tags apply to every project.
  app.get('/project-catalogs/:scope/:ref', { preHandler: optionalAuth() }, async (req, reply) => {
    const { scope, ref } = req.params;
    if (!SCOPES.includes(scope)) return reply.code(404).send({ error: 'not_found' });
    const p = await db();
    const proj = await publicProject(p, scope, String(ref).slice(0, 120), req);
    if (!proj) return reply.code(404).send({ error: 'not_found' });
    const cfg = (await readConfig(p, scope, proj.storeRef)) || EMPTY_CONFIG;
    const live = cfg.enabled === false ? [] : (cfg.catalogs || []);
    const catalogs = [];
    for (const c of live) {
      const s = catalogSummary(c);
      if (c.format === 'bmm' && c.source === 'community') s.community = await linkedCommunity(p, c.communitySlug);
      catalogs.push(s);
    }
    const { storeRef, ...project } = proj;
    return { project, tags: tagsFor(cfg), catalogs };
  });

  // ── Public: one catalogue's content ──
  app.get('/project-catalogs/:scope/:ref/:id', { preHandler: optionalAuth() }, async (req, reply) => {
    const { scope, ref, id } = req.params;
    if (!SCOPES.includes(scope)) return reply.code(404).send({ error: 'not_found' });
    const p = await db();
    const proj = await publicProject(p, scope, String(ref).slice(0, 120), req);
    if (!proj) return reply.code(404).send({ error: 'not_found' });
    const cfg = await readConfig(p, scope, proj.storeRef);
    const c = cfg?.enabled === false ? null : (cfg?.catalogs || []).find((x) => x.id === id);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    const base = catalogSummary(c);
    const { storeRef, ...project } = proj;
    if (c.format === 'custom') return { project, tags: tagsFor(cfg), catalog: { ...base, fields: c.fields, entries: c.entries } };
    if (c.source === 'inline') return { project, tags: tagsFor(cfg), catalog: { ...base, items: inlineDisplay(c.kind, c.feed) } };
    if (c.source === 'community') return { project, tags: tagsFor(cfg), catalog: { ...base, community: await linkedCommunity(p, c.communitySlug) } };
    return { project, tags: tagsFor(cfg), catalog: base };
  });

  // ── Public: the feed a client downloads ──
  // Official and community sources already HAVE a feed; this sends the reader there rather
  // than serving a second copy that could disagree with the first.
  app.get('/project-catalogs/:scope/:ref/:id/catalog.json', { preHandler: optionalAuth() }, async (req, reply) => {
    const { scope, ref, id } = req.params;
    if (!SCOPES.includes(scope)) return reply.code(404).send({ error: 'not_found' });
    const p = await db();
    const proj = await publicProject(p, scope, String(ref).slice(0, 120), req);
    if (!proj) return reply.code(404).send({ error: 'not_found' });
    const cfg = await readConfig(p, scope, proj.storeRef);
    const c = cfg?.enabled === false ? null : (cfg?.catalogs || []).find((x) => x.id === id);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    if (c.format === 'bmm' && c.source === 'official') return reply.redirect(`/api/catalog.json?${new URLSearchParams({ project: proj.key, kind: c.kind })}`);
    if (c.format === 'bmm' && c.source === 'community') {
      const cc = await linkedCommunity(p, c.communitySlug);
      return cc ? reply.redirect(`/api/c/${encodeURIComponent(cc.slug)}/catalog.json`) : reply.code(404).send({ error: 'not_found' });
    }
    reply.header('Cache-Control', 'public, max-age=60');
    return feedOf(c, proj.name);
  });

  // ── Editor: read + save ──
  // Who: requireEditor (a session + 2FA), then the project's own edit question. A grantee of
  // project A is refused on project B here exactly as on B's page editor.
  async function editable(req, reply) {
    const { scope, ref } = req.params;
    if (!SCOPES.includes(scope)) { reply.code(404).send({ error: 'not_found' }); return null; }
    const p = await db();
    if (scope === 'project') {
      if (!(await isProjectKey(ref))) { reply.code(404).send({ error: 'unknown_project' }); return null; }
      if (!(await canEditProject(req.user, ref))) { reply.code(403).send({ error: 'forbidden' }); return null; }
      return { p, scope, storeRef: ref, isOfficial: true, label: ref };
    }
    const row = await p.showcaseProject.findUnique({ where: { id: String(ref).slice(0, 60) }, select: { id: true, slug: true } }).catch(() => null);
    if (!row) { reply.code(404).send({ error: 'not_found' }); return null; }
    if (!(await canEditShowcase(req.user, row.id))) { reply.code(403).send({ error: 'forbidden' }); return null; }
    return { p, scope, storeRef: row.id, isOfficial: false, label: row.slug };
  }

  app.get('/admin/project-catalogs/:scope/:ref', { preHandler: requireEditor() }, async (req, reply) => {
    const ed = await editable(req, reply);
    if (!ed) return reply;
    const config = (await readConfig(ed.p, ed.scope, ed.storeRef)) || EMPTY_CONFIG;
    // The editor's own hosted catalogues, for the "link a community catalogue" picker.
    const mine = await ed.p.communityCatalog.findMany({ where: { ownerId: req.user.uid, status: 'ACTIVE' }, select: { slug: true, name: true, kinds: true, visibility: true }, take: 100 }).catch(() => []);
    return { config, myCatalogs: mine.map((c) => ({ slug: c.slug, name: c.name, kind: String(c.kinds?.[0] || 'app').toUpperCase(), visibility: c.visibility })), ...editorMeta(ed.isOfficial) };
  });

  app.put('/admin/project-catalogs/:scope/:ref', { preHandler: requireEditor(), bodyLimit: 2 * 1024 * 1024, config: { rateLimit: { max: 60, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const ed = await editable(req, reply);
    if (!ed) return reply;
    const body = z.object({ config: z.record(z.any()) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_config' });
    const out = normalizeConfig(body.data.config, { isOfficial: ed.isOfficial });
    if (out.error) return reply.code(400).send(out);
    const { p } = ed;
    // A linked community catalogue must exist and be live, and be one this editor may point
    // at: their own, a public listed one, or any at all for catalogue staff. Linking somebody
    // else's PRIVATE catalogue would advertise an address its owner never made public.
    for (const c of out.config.catalogs) {
      if (c.format !== 'bmm' || c.source !== 'community') continue;
      const cc = await p.communityCatalog.findUnique({ where: { slug: c.communitySlug }, select: { ownerId: true, status: true, visibility: true, listed: true } }).catch(() => null);
      if (!cc || cc.status !== 'ACTIVE') return reply.code(400).send({ error: 'community_not_found', slug: c.communitySlug });
      const mayLink = cc.ownerId === req.user.uid || (cc.visibility === 'public' && cc.listed) || hasCap(req.user, 'manage_catalogs');
      if (!mayLink) return reply.code(403).send({ error: 'community_not_linkable', slug: c.communitySlug });
    }
    // The takedown blocklist applies here like on every other listing path: a link removed
    // after a rights notice cannot come back as a project catalogue entry.
    const urls = urlsOfConfig(out.config);
    if (urls.length) {
      const rules = await p.blockedUrl.findMany({ select: { id: true, scope: true, pattern: true, allow: true } });
      const hit = findBlock(rules, urls);
      if (hit) return reply.code(409).send({ error: 'url_blocked', url: hit.url, scope: hit.rule.scope });
    }
    const key = settingKeyFor(ed.scope, ed.storeRef);
    await p.adminSetting.upsert({ where: { key }, create: { key, value: out.config }, update: { value: out.config } });
    await logAudit(p, req.user.uid, 'project.catalogs.save', `${ed.scope}:${ed.label} (${out.config.catalogs.length} catalogue(s))`, clientIp(req)).catch(() => {});
    return { ok: true, config: out.config };
  });
}
