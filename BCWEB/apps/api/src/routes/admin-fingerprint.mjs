// The admin fingerprint tool's API: read a creator id or proof (v4 or v5), decode and
// validate it, and put next to it everything the platform knows about that id — its key pin,
// its linked account, free-tier claims, bans, the hashed fingerprint history with a stability
// score, and the other ids that share a hashed component (ban evasion).
//
// Gating, and why these capabilities:
//
//   · reading is manage_users, the capability moderators hold by default. Spotting a banned
//     person's new id is moderation work, and every datum shown is either already visible to
//     that role (an account's id, display name and status) or a salted hash that identifies
//     nothing on its own;
//   · the BAN sections are shown only to a reader who also holds manage_sanctions, the
//     capability that reads the ban list itself. The tool must not become a side door to it;
//   · resetting a key pin is manage_sanctions: it decides which key may speak for an id.
//
// Every lookup writes an audit line naming the id looked up. Looking somebody up is itself a
// processing of their data, and the audit chain is where staff actions are answerable.
import { z } from 'zod';
import { db, requireCap, logAudit, hasCap } from '../lib/lib.mjs';
import { inspectCreatorToken, expectedProofAudience } from '../lib/creator-proof.mjs';
import { creatorAnalysis } from '../lib/creator-identity.mjs';

export default async function adminFingerprintRoutes(app) {
  app.post('/admin/users/creator-lookup', {
    preHandler: requireCap('manage_users'),
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const b = z.object({ q: z.string().min(1).max(8192) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const token = inspectCreatorToken(b.data.q, expectedProofAudience());
    if (token.kind === 'unknown' || !token.cid) return reply.code(400).send({ error: token.error || 'no_creator_id', token });
    const p = await db();
    const canSeeBans = hasCap(req.user, 'manage_sanctions');
    const analysis = await creatorAnalysis(p, token.cid, { canSeeBans });
    await logAudit(p, req.user.uid, 'creator.fingerprint_lookup', `${token.cid}${token.kind === 'proof' ? ` (pasted v${token.version} proof)` : ''}`, req.ip);
    return { token, analysis, canSeeBans };
  });

  app.delete('/admin/security/creator-pin/:cid', { preHandler: requireCap('manage_sanctions') }, async (req, reply) => {
    const cid = String(req.params.cid || '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(cid)) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const n = (await p.creatorKeyPin.deleteMany({ where: { creatorId: cid } })).count;
    await logAudit(p, req.user.uid, 'creator.key_pin_reset', cid, req.ip);
    return { ok: true, reset: n > 0 };
  });
}
