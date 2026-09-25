// The studio's per-user data (saved components), and its one site setting (the link policy of
// block actions, phase 5, at the end of the file).
//
// Components: signed-in users only, and each sees exactly their own list. There is no admin view and no
// sharing: a component is an author's shorthand, and the page it lands on is what gets
// reviewed. Validation and the storage key live in lib/studio-components.mjs.
import { db, requireRole, requireCap, requireEditor, logAudit, studioChecker, studioGrants, accountLock } from '../lib/lib.mjs';
import { parseComponentList, readStored, storageKey } from '../lib/studio-components.mjs';
import { LINK_POLICY_KEY, studioLinkPolicy, normalizeLinkPolicy, linkPolicyProblems, studioValidateOpts, withStudioLock } from '../lib/studio-doc.mjs';
import { libraryKey, libraryRev, readLibrary, parseLibrary, entryRev, parseComponentSave, replaceComponentEntry } from '../lib/studio-library.mjs';
import { isProjectKey } from '../lib/project-keys.mjs';

export default async function studioRoutes(app) {
  app.get('/me/studio/components', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const row = await p.adminSetting.findUnique({ where: { key: storageKey(req.user.uid) } }).catch(() => null);
    return { components: readStored(row?.value) };
  });

  // The whole list, replaced. The studio holds the list and writes it back on every change,
  // which keeps one shape for add, rename, delete and reorder — and a 512 KB body limit, so a
  // pasted SVG in a saved block cannot turn a preference into a storage bill.
  app.put('/me/studio/components', { preHandler: requireRole(), bodyLimit: 600 * 1024, config: { rateLimit: { max: 60, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const p = await db();
    const key = storageKey(req.user.uid);
    // What is stored already: its problems are tolerated, new ones refused (pentest R6).
    const row = await p.adminSetting.findUnique({ where: { key } }).catch(() => null);
    const r = parseComponentList(req.body, row?.value ?? null);
    if (!r.ok) {
      const { ok: _ok, ...body } = r;
      return reply.code(r.error === 'too_large' ? 413 : 400).send(body);
    }
    const value = { components: r.components, updatedAt: new Date().toISOString() };
    await p.adminSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    return { ok: true, components: r.components };
  });

  // ── The studio's link policy (PLAN-STUDIO-2026 D7, phase 5) ───────────────────────────
  // Which hosts a studio block's `external` step may open: every https host but a blocklist
  // (the default, empty), or only an allowlist. The rule is the studio package's
  // (normalizeLinkPolicy / hostAllowed); this only stores it. Public read, small and cached,
  // like the other /site/* settings: the renderer draws a link to a now-blocked host inert,
  // and the studio's "On click" section says so before the author saves.
  app.get('/site/studio-links', async (req, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    return studioLinkPolicy(await db());
  });

  // manage_studio, not a bare ADMIN gate: whoever may draw every studio page decides where those
  // pages may send people (ADMIN and SUPERADMIN hold it implicitly, D8).
  app.get('/admin/studio/links', { preHandler: requireCap('manage_studio') }, async () => studioLinkPolicy(await db()));

  // Replaced whole. Strict (linkPolicyProblems): a host that is not a host name is refused with
  // its index rather than silently dropped, so what the admin sees saved is what they typed.
  app.put('/admin/studio/links', { preHandler: requireCap('manage_studio'), config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const problems = linkPolicyProblems(req.body);
    if (problems.length) return reply.code(400).send({ error: 'invalid_input', path: problems[0].path, reason: problems[0].reason });
    const value = normalizeLinkPolicy(req.body);
    const p = await db();
    await p.adminSetting.upsert({ where: { key: LINK_POLICY_KEY }, create: { key: LINK_POLICY_KEY, value }, update: { value } });
    await logAudit(p, req.user.uid, 'site.studio-links', `mode=${value.mode} hosts=${value.hosts.length}`);
    return value;
  });

  // ── Preset libraries (PLAN-STUDIO-2026 2.6, phase 6) ───────────────────────────────────
  // GET / PUT /admin/studio/library/:scope/:ref, scope `site` (ref `site`), `project` (ref =
  // project key) or `showcase` (ref = the row's id or slug). Behind requireEditor (2FA) like
  // every studio door, then:
  //   · project / showcase: canUseStudio on THAT page, to read and to write (D9: every studio
  //     holder of the page shares its library; a holder of A reads nothing of B);
  //   · site: read by whoever may open some studio (manage_studio, or a studio right on any
  //     page), written by manage_studio only.
  // Validation is lib/studio-library.mjs (every preset doc through validateDoc); the whole list
  // is written back with the revision it was read at, 409 when somebody saved in between.
  async function libraryTarget(scope, ref, user) {
    const p = await db();
    const check = await studioChecker(user);
    // `home` asks exactly manage_studio (lib.mjs studioChecker): the site library's writers.
    const manager = check('home', 'home', { studioEnabled: true });
    if (scope === 'site') {
      if (manager) return { key: libraryKey('site'), read: true, write: true };
      if (await accountLock(user.uid, 'service')) return { key: libraryKey('site'), read: false, write: false };
      const g = await studioGrants(user.uid);
      return { key: libraryKey('site'), read: g.allShowcase || g.showcaseIds.size > 0 || g.projectKeys.size > 0, write: false };
    }
    const r = String(ref || '').slice(0, 80);
    if (scope === 'project') {
      if (!(await isProjectKey(r))) return null;
      const row = await p.adminSetting.findUnique({ where: { key: `project.${r}` } }).catch(() => null);
      const ok = check('project', r, row?.value || {});
      return { key: libraryKey('project', r), read: ok, write: ok };
    }
    if (scope === 'showcase') {
      const row = (await p.showcaseProject.findUnique({ where: { id: r }, select: { id: true, config: true } }).catch(() => null))
        || (await p.showcaseProject.findUnique({ where: { slug: r }, select: { id: true, config: true } }).catch(() => null));
      if (!row) return null;
      const ok = check('showcase', row.id, row.config || {});
      return { key: libraryKey('showcase', row.id), read: ok, write: ok };
    }
    return null;
  }

  app.get('/admin/studio/library/:scope/:ref', { preHandler: requireEditor() }, async (req, reply) => {
    const tg = await libraryTarget(req.params.scope, req.params.ref, req.user);
    if (!tg) return reply.code(404).send({ error: 'not_found' });
    if (!tg.read) return reply.code(403).send({ error: 'forbidden' });
    const p = await db();
    const row = await p.adminSetting.findUnique({ where: { key: tg.key } }).catch(() => null);
    const entries = readLibrary(row?.value);
    return { entries, rev: libraryRev(entries), canWrite: tg.write };
  });

  app.put('/admin/studio/library/:scope/:ref', { preHandler: requireEditor(), bodyLimit: 1_600_000, config: { rateLimit: { max: 60, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const tg = await libraryTarget(req.params.scope, req.params.ref, req.user);
    if (!tg) return reply.code(404).send({ error: 'not_found' });
    if (!tg.write) return reply.code(403).send({ error: 'forbidden' });
    const p = await db();
    const parsed = parseLibrary(req.body, await studioValidateOpts(p));
    if (!parsed.ok) return reply.code(parsed.status).send(parsed.body);
    const out = await withStudioLock(p, tg.key, async (tx) => {
      const row = await tx.adminSetting.findUnique({ where: { key: tg.key } });
      const stored = readLibrary(row?.value);
      const now = libraryRev(stored);
      if (now !== parsed.base) return { status: 409, body: { error: 'conflict', rev: now, entries: stored } };
      const value = { entries: parsed.entries, updatedAt: new Date().toISOString() };
      await tx.adminSetting.upsert({ where: { key: tg.key }, create: { key: tg.key, value }, update: { value } });
      return { entries: parsed.entries };
    });
    if (out.status) return reply.code(out.status).send(out.body);
    if (req.params.scope === 'site') await logAudit(p, req.user.uid, 'site.studio-library', `entries=${out.entries.length}`);
    return { ok: true, entries: out.entries, rev: libraryRev(out.entries) };
  });

  // ── One component of a library (PLAN-STUDIO-2026 phase 7b, the studio's component mode) ──
  // GET / PUT /admin/studio/library/:scope/:ref/components/:cid. The SAME doors as the library
  // itself (libraryTarget): a project or showcase library for canUseStudio on that page, the
  // site's read by any studio holder and written by manage_studio only. The save is one entry
  // from the revision the author opened (409 with the stored entry when it moved), under the
  // library's lock, checked by the library's own rule (every doc through validateDoc, the
  // exposed fields, the loops).
  const CID = /^[A-Za-z0-9_-]{1,60}$/;
  app.get('/admin/studio/library/:scope/:ref/components/:cid', { preHandler: requireEditor() }, async (req, reply) => {
    const tg = await libraryTarget(req.params.scope, req.params.ref, req.user);
    if (!tg) return reply.code(404).send({ error: 'not_found' });
    if (!tg.read) return reply.code(403).send({ error: 'forbidden' });
    if (!CID.test(String(req.params.cid))) return reply.code(404).send({ error: 'not_found' });
    const p = await db();
    const row = await p.adminSetting.findUnique({ where: { key: tg.key } }).catch(() => null);
    const entry = readLibrary(row?.value).find((e) => e.id === req.params.cid && e.sort === 'component');
    if (!entry) return reply.code(404).send({ error: 'not_found' });
    return { entry, rev: entryRev(entry), canWrite: tg.write };
  });

  app.put('/admin/studio/library/:scope/:ref/components/:cid', { preHandler: requireEditor(), bodyLimit: 400_000, config: { rateLimit: { max: 60, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const tg = await libraryTarget(req.params.scope, req.params.ref, req.user);
    if (!tg) return reply.code(404).send({ error: 'not_found' });
    if (!tg.write) return reply.code(403).send({ error: 'forbidden' });
    if (!CID.test(String(req.params.cid))) return reply.code(404).send({ error: 'not_found' });
    const p = await db();
    const parsed = parseComponentSave(req.params.cid, req.body, await studioValidateOpts(p));
    if (!parsed.ok) return reply.code(parsed.status).send(parsed.body);
    const out = await withStudioLock(p, tg.key, async (tx) => {
      const row = await tx.adminSetting.findUnique({ where: { key: tg.key } });
      const r = replaceComponentEntry(readLibrary(row?.value), parsed.entry, parsed.base);
      if (r.status) return r;
      const value = { entries: r.entries, updatedAt: new Date().toISOString() };
      await tx.adminSetting.upsert({ where: { key: tg.key }, create: { key: tg.key, value }, update: { value } });
      return { entry: r.entry };
    });
    if (out.status) return reply.code(out.status).send(out.body);
    if (req.params.scope === 'site') await logAudit(p, req.user.uid, 'site.studio-component', `id=${req.params.cid}`);
    return { ok: true, entry: out.entry, rev: entryRev(out.entry) };
  });
}
