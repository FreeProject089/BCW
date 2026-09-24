// The studio's per-user data (saved components), and its one site setting (the link policy of
// block actions, phase 5, at the end of the file).
//
// Components: signed-in users only, and each sees exactly their own list. There is no admin view and no
// sharing: a component is an author's shorthand, and the page it lands on is what gets
// reviewed. Validation and the storage key live in lib/studio-components.mjs.
import { db, requireRole, requireCap, logAudit } from '../lib/lib.mjs';
import { parseComponentList, readStored, storageKey } from '../lib/studio-components.mjs';
import { LINK_POLICY_KEY, studioLinkPolicy, normalizeLinkPolicy, linkPolicyProblems } from '../lib/studio-doc.mjs';

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
}
