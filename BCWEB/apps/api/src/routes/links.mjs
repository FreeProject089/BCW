import { z } from 'zod';
import crypto from 'node:crypto';
import { db, requireRole, notify } from '../lib.mjs';

// Human-friendly pairing code (no ambiguous chars): e.g. "K7P3-9QMX".
function genCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = (n) => Array.from({ length: n }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  return `${pick(4)}-${pick(4)}`;
}

// Account ↔ BMM creator-id linking. Local-first: BMM keeps working offline; only
// when the user chooses to link does the server learn the account↔creator mapping.
export default async function linkRoutes(app) {
  // ── BMM side (no website login): request a pairing code for a creator id ──
  // Rate-limited so a code can't be brute-forced or spammed.
  app.post('/link/request', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = z.object({ creatorId: z.string().min(1).max(120), creatorName: z.string().max(120).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    // Already linked? Tell BMM so it can show "already linked" instead of a code.
    const existing = await p.creatorLink.findUnique({ where: { creatorId: b.data.creatorId } });
    if (existing) return { linked: true };
    // One active code per creator id at a time.
    await p.linkCode.deleteMany({ where: { creatorId: b.data.creatorId } });
    let code; for (let i = 0; i < 5; i++) { code = genCode(); if (!(await p.linkCode.findUnique({ where: { code } }))) break; }
    const expiresAt = new Date(Date.now() + 15 * 60e3); // 15 min
    await p.linkCode.create({ data: { code, creatorId: b.data.creatorId, displayName: b.data.creatorName || null, expiresAt } });
    return { code, expiresAt, linked: false };
  });

  // ── BMM side: is this creator id currently linked? (drives unlink detection) ──
  app.get('/link/status', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const creatorId = String(req.query?.creatorId || '').trim();
    if (!creatorId) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const link = await p.creatorLink.findUnique({
      where: { creatorId },
      include: { user: { select: { displayName: true, discordLinks: { select: { username: true, discordId: true }, take: 1 } } } },
    });
    if (!link) return { linked: false };
    const d = link.user.discordLinks[0];
    return { linked: true, displayName: link.user.displayName, discord: d ? { linked: true, username: d.username || null } : { linked: false } };
  });

  // ── BMM side: link a Discord account to the account tied to this creator id ──
  // The user runs /link in Discord (bot issues a code) then enters it in BMM.
  app.post('/link/discord', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = z.object({ creatorId: z.string().min(1).max(120), code: z.string().min(4).max(20) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const link = await p.creatorLink.findUnique({ where: { creatorId: b.data.creatorId } });
    if (!link) return reply.code(409).send({ error: 'account_not_linked' }); // link the account first
    const raw = b.data.code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const code = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4, 8)}` : raw;
    const row = await p.discordLinkCode.findUnique({ where: { code } });
    if (!row || row.expiresAt < new Date()) return reply.code(400).send({ error: 'invalid_or_expired' });
    if (await p.discordLink.findUnique({ where: { discordId: row.discordId } })) {
      await p.discordLinkCode.delete({ where: { id: row.id } }).catch(() => {});
      return reply.code(409).send({ error: 'already_linked' });
    }
    const dl = await p.discordLink.create({ data: { userId: link.userId, discordId: row.discordId, username: row.username } });
    await p.discordLinkCode.delete({ where: { id: row.id } }).catch(() => {});
    await notify(p, link.userId, 'discord_linked', `Discord account ${dl.username || dl.discordId} was linked (via BMM).`);
    return { ok: true, username: dl.username || null };
  });

  // ── Server-to-server: resolve creator ids → linked accounts (for BMM telemetry) ──
  // Protected by a shared secret so only trusted backends (the telemetry dashboard) can call it.
  app.post('/link/lookup', async (req, reply) => {
    const secret = process.env.LINK_LOOKUP_SECRET || process.env.JWT_SECRET;
    if (!secret || req.headers['x-link-secret'] !== secret) return reply.code(401).send({ error: 'unauthorized' });
    const b = z.object({ creatorIds: z.array(z.string().max(120)).min(1).max(1000) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const links = await p.creatorLink.findMany({
      where: { creatorId: { in: b.data.creatorIds } },
      include: { user: { select: { id: true, displayName: true, discordLinks: { select: { discordId: true, username: true, linkedAt: true } } } } },
    });
    // Pull Discord activity for all linked Discord ids in one query.
    const discordIds = links.flatMap((l) => l.user.discordLinks.map((d) => d.discordId));
    const activity = discordIds.length
      ? Object.fromEntries((await p.discordActivity.findMany({ where: { discordId: { in: discordIds } } })).map((a) => [a.discordId, a]))
      : {};
    const accounts = {};
    for (const l of links) {
      const d = l.user.discordLinks[0]; // one Discord per account (first)
      const a = d ? activity[d.discordId] : null;
      accounts[l.creatorId] = {
        accountId: l.userId,
        displayName: l.user.displayName,
        discord: d ? {
          id: d.discordId, username: (a?.username) || d.username, avatar: a?.avatar || null, linkedAt: d.linkedAt,
          guildJoinedAt: a?.guildJoinedAt || null, lastMessageAt: a?.lastMessageAt || null,
          lastVoiceJoinAt: a?.lastVoiceJoinAt || null, lastVoiceCreateAt: a?.lastVoiceCreateAt || null,
        } : null,
      };
    }
    return { accounts };
  });

  // ── Website side (logged in): list / redeem / unlink creator ids ──
  app.get('/me/creator-links', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const links = await p.creatorLink.findMany({ where: { userId: req.user.uid }, orderBy: { linkedAt: 'desc' } });
    const now = Date.now();
    return { links: links.map((l) => ({ id: l.id, creatorId: l.creatorId, displayName: l.displayName, linkedAt: l.linkedAt, unlinkableAt: l.unlinkableAt, locked: new Date(l.unlinkableAt).getTime() > now })) };
  });

  app.post('/me/creator-links', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ code: z.string().min(4).max(20) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    // Normalize: strip any separators the user typed → canonical XXXX-XXXX.
    const raw = b.data.code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const code = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
    const p = await db();
    const pending = await p.linkCode.findUnique({ where: { code } });
    if (!pending || pending.expiresAt < new Date()) return reply.code(400).send({ error: 'invalid_or_expired' });
    // One creator id ↔ one account.
    if (await p.creatorLink.findUnique({ where: { creatorId: pending.creatorId } })) {
      await p.linkCode.delete({ where: { id: pending.id } }).catch(() => {});
      return reply.code(409).send({ error: 'already_linked' });
    }
    const link = await p.creatorLink.create({ data: {
      userId: req.user.uid, creatorId: pending.creatorId, displayName: pending.displayName,
      linkedAt: new Date(), unlinkableAt: new Date(Date.now() + 14 * 864e5), // 2-week lock
    } });
    await p.linkCode.delete({ where: { id: pending.id } }).catch(() => {});
    await notify(p, req.user.uid, 'creator_linked', `Creator id "${link.creatorId}" is now linked to your account.`);
    return { link: { id: link.id, creatorId: link.creatorId, displayName: link.displayName, linkedAt: link.linkedAt, unlinkableAt: link.unlinkableAt, locked: true } };
  });

  app.delete('/me/creator-links/:id', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const link = await p.creatorLink.findUnique({ where: { id: req.params.id } });
    if (!link || link.userId !== req.user.uid) return reply.code(404).send({ error: 'not_found' });
    if (new Date(link.unlinkableAt).getTime() > Date.now()) return reply.code(423).send({ error: 'locked', unlinkableAt: link.unlinkableAt });
    await p.creatorLink.delete({ where: { id: link.id } });
    return { ok: true };
  });
}
