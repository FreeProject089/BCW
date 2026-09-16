// The studio's per-user data: saved components.
//
// Signed-in users only, and each sees exactly their own list. There is no admin view and no
// sharing: a component is an author's shorthand, and the page it lands on is what gets
// reviewed. Validation and the storage key live in lib/studio-components.mjs.
import { db, requireRole } from '../lib/lib.mjs';
import { parseComponentList, readStored, storageKey } from '../lib/studio-components.mjs';

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
    const r = parseComponentList(req.body);
    if (!r.ok) return reply.code(r.error === 'too_large' ? 413 : 400).send({ error: r.error });
    const p = await db();
    const key = storageKey(req.user.uid);
    const value = { components: r.components, updatedAt: new Date().toISOString() };
    await p.adminSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    return { ok: true, components: r.components };
  });
}
