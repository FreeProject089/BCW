// `/f/<token>` — a file behind a link that stops working (lib/expiring-files.mjs).
//
//   GET /f/:token/info   what the link is and whether it still works (JSON, for the page)
//   GET /f/:token        the download: a redirect to the bytes, or 410 once expired
//
// A deliverable's link is bound to its owner (they must be signed in as that account); a
// mail attachment's link is for whoever holds the token. The first download of a Make Your
// Own deliverable is written into the request's conversation as the proof of delivery.
import { db, optionalAuth } from '../lib/lib.mjs';
import { resolveToken, downloadUrl, recordDownload, describe, effectiveExpiry } from '../lib/expiring-files.mjs';
import { publishToThread } from '../lib/threadbus.mjs';

export default async function fileLinkRoutes(app) {
  const soft = optionalAuth();
  const who = async (req) => { await soft(req); return req.user?.uid || null; };

  app.get('/f/:token/info', async (req, reply) => {
    const p = await db();
    const r = await resolveToken(p, req.params.token, { userId: await who(req) });
    if (!r.row) return reply.code(404).send({ error: 'not_found' });
    return { ...describe(r.row), reason: r.ok ? null : r.reason, kind: r.row.kind, needsSignIn: r.reason === 'forbidden' };
  });

  app.get('/f/:token', async (req, reply) => {
    const p = await db();
    const r = await resolveToken(p, req.params.token, { userId: await who(req) });
    if (!r.row) return reply.code(404).send({ error: 'not_found' });
    if (!r.ok) return reply.code(r.reason === 'forbidden' ? 403 : 410).send({ error: r.reason, ...describe(r.row) });
    const row = r.row;
    const first = !row.firstDownloadAt;
    const updated = await recordDownload(p, row);
    if (first && row.kind === 'myo' && row.refId) {
      // Proof of delivery, in the conversation both sides read — with the date the link dies.
      try {
        const u = row.ownerId ? await p.user.findUnique({ where: { id: row.ownerId }, select: { displayName: true } }) : null;
        const until = effectiveExpiry(updated);
        const body = `${u?.displayName || 'The customer'} downloaded “${row.fileName || 'the delivery'}” on ${new Date().toISOString().slice(0, 10)}.${until ? ` The download link stays valid until ${until.toISOString().slice(0, 10)}, then the file is removed.` : ''}`;
        const msg = await p.myoMessage.create({ data: { requestId: row.refId, authorId: null, staff: false, body, images: [] } });
        publishToThread('myo', row.refId, { type: 'message', message: { id: msg.id, requestId: msg.requestId, authorId: null, staff: false, body: msg.body, images: [], createdAt: msg.createdAt } });
        await p.myoRequest.update({ where: { id: row.refId }, data: { lastActivityAt: new Date() } }).catch(() => {});
      } catch { /* the download must not fail because the note could not be written */ }
    }
    const url = await downloadUrl(row);
    reply.header('Cache-Control', 'no-store');
    return reply.redirect(url, 302);
  });
}
