// Teams — accounts that manage repos, catalogues and pools together.
//
//   GET    /teams/:slug                      public card: who they are, how to reach them, what they publish
//   GET    /me/teams                         mine (owned, member, invited)
//   POST   /me/teams                         create (owner) — { name } is enough; contactEmail
//                                            defaults to the account's, the rest to empty
//   PATCH  /me/teams/:id                     details (owner / admin)
//   DELETE /me/teams/:id                     dissolve (owner) — repos, catalogues and pools stay with their owners
//   GET    /me/teams/:id/invites             the links: the permanent one, the temporary ones, the caps
//   POST   /me/teams/:id/invites             make one — { role, days } (days 0/absent = the permanent link)
//   DELETE /me/teams/:id/invites/:inviteId   revoke one (the permanent slot frees immediately)
//   POST   /me/teams/:id/members             invite { to } by id, BC id, e-mail or display name (owner / admin)
//   POST   /me/teams/:id/accept | /decline   the invited account answers
//   PATCH  /me/teams/:id/members/:userId     role (owner)
//   DELETE /me/teams/:id/members/:userId     remove (owner / admin), or leave (self)
//   POST   /me/teams/:id/transfer            { userId } hand the team over (owner)
//   PUT    /me/teams/:id/attach              { kind: repo|catalog|group, id, attach } put something under the team
//
// Attaching needs BOTH: a team admin, and the owner of the thing — a team cannot claim a
// stranger's repo, and a member cannot hand the team's repo to another team.
import { z } from 'zod';
import { db, requireRole, optionalAuth, notify, logAudit } from '../lib/lib.mjs';
import { findUserIdByBcId, looksLikeBcId } from '../lib/repofingerprint.mjs';
import { slugifyTeam, teamRoleOf, isStaff, serTeam, teamLimitFor, teamSlotPrice, inviteUsable, invitePolicy, invitePlanFor, serInvite } from '../lib/teams.mjs';
import { settings as hostingSettings, stripe } from './hosting.mjs';
import { recordPendingCheckout } from '../lib/pending-checkout.mjs';
import { teamContactSettings, canAnswerTeam, TEAM_ROLES } from '../lib/team-contact.mjs';
import { hostingFor, saveHosting, serHosting, siteAttachmentDefault, attachmentPolicy, poolRoom } from '../lib/entity-hosting.mjs';
import { deleteThreadFiles } from '../lib/thread-files.mjs';
import crypto from 'node:crypto';
import { ciEquals } from '../lib/ci-equals.mjs';

const contact = {
  contactEmail: z.string().trim().email().max(254),
  contactPhone: z.string().trim().max(40).optional().default(''),
  website: z.string().trim().max(300).optional().default(''),
  discord: z.string().trim().max(300).optional().default(''),
  description: z.string().trim().max(2000).optional().default(''),
};
const httpish = (s) => !s || /^https?:\/\//i.test(s);

/**
 * A pasted address, made into one we can put in an href.
 *
 * "discord.gg/abc" and "example.com" are what people type, and refusing them with a 400 at
 * submit time was the single most expensive way to say "add https://" — the page could only
 * show a generic failure, and the creator lost the rest of the form to find out which field
 * was at fault. A scheme we do not want (javascript:, data:) is still refused by `httpish`;
 * this only fills in the one that was missing. Re-capped after the prefix so a 300-char
 * paste cannot grow past the column.
 */
const normalizeUrl = (s) => {
  const v = String(s || '').trim();
  if (!v || /^[a-z][a-z0-9+.-]*:/i.test(v)) return v.slice(0, 300);
  return `https://${v}`.slice(0, 300);
};

async function uniqueSlug(p, base) {
  let slug = base, i = 2;
  while (await p.team.findUnique({ where: { slug }, select: { id: true } })) slug = `${base}-${i++}`;
  return slug;
}

/** Resolve "who" the way the economy's gift does: id, BC id, e-mail, or exact display name. */
async function resolveUser(p, to) {
  const s = String(to || '').trim();
  if (!s) return null;
  if (looksLikeBcId(s)) { const id = await findUserIdByBcId(p, s).catch(() => null); if (id) return p.user.findUnique({ where: { id } }); }
  if (s.includes('@')) return p.user.findFirst({ where: { email: ciEquals(s) } });
  return (await p.user.findUnique({ where: { id: s } }).catch(() => null))
    || p.user.findFirst({ where: { displayName: ciEquals(s) } });
}

export default async function teamRoutes(app) {
  app.get('/teams/:slug', { preHandler: optionalAuth() }, async (req, reply) => {
    const p = await db();
    const t = await p.team.findFirst({ where: { OR: [{ slug: req.params.slug }, { id: req.params.slug }] } });
    if (!t) return reply.code(404).send({ error: 'not_found' });
    const [members, repos, catalogs] = await Promise.all([
      p.teamMember.findMany({ where: { teamId: t.id, status: 'active' }, include: { user: { select: { id: true, displayName: true } } }, orderBy: { createdAt: 'asc' } }),
      p.serverRepo.findMany({ where: { teamId: t.id, listed: true, verified: true, pendingReview: false }, select: { id: true, name: true, description: true, hosted: true, status: true } }),
      p.communityCatalog.findMany({ where: { teamId: t.id, listed: true, visibility: 'public', status: 'ACTIVE' }, select: { id: true, slug: true, name: true, description: true } }),
    ]);
    return { team: serTeam(t, {
      members: members.map((m) => ({ id: m.user.id, displayName: m.user.displayName, role: m.role })),
      repos, catalogs,
    }) };
  });

  app.get('/me/teams', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const rows = await p.teamMember.findMany({
      where: { userId: req.user.uid },
      include: { team: { include: { _count: { select: { members: true, repos: true, catalogs: true, groups: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
    return { teams: rows.map((m) => serTeam(m.team, { myRole: m.role, myStatus: m.status, counts: m.team._count })) };
  });

  app.post('/me/teams', { preHandler: requireRole(), config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    // Creating a team asks for ONE thing: a name. Everything else is a detail of a team that
    // already exists and lives in its Edit form, so a creator is never made to decide about a
    // phone number, a Discord invite or a description before there is anything to describe.
    //
    // `contactEmail` is the interesting one: the column is NOT NULL and the public card shows
    // it, so it cannot simply be absent — but the account already told us an address when it
    // signed up, and asking for it again is asking the same question twice. Absent, it
    // defaults to the owner's account e-mail, and the team's Edit form changes it after.
    //
    // The refusals are named per field (`invalid_name`, `invalid_email`) instead of one
    // `invalid_input`, because the page can only put a message under the right field if it is
    // told which field. A website with no scheme is fixed rather than refused (normalizeUrl).
    const b = z.object({
      name: z.string().trim().min(2).max(60),
      ...contact,
      contactEmail: contact.contactEmail.optional(),
    }).safeParse(req.body);
    if (!b.success) {
      const bad = b.error.issues[0]?.path?.[0];
      return reply.code(400).send({ error: bad === 'name' ? 'invalid_name' : bad === 'contactEmail' ? 'invalid_email' : 'invalid_input', field: bad || null });
    }
    b.data.website = normalizeUrl(b.data.website);
    b.data.discord = normalizeUrl(b.data.discord);
    if (!httpish(b.data.website)) return reply.code(400).send({ error: 'invalid_website', field: 'website' });
    if (!httpish(b.data.discord)) return reply.code(400).send({ error: 'invalid_discord', field: 'discord' });
    const p = await db();
    const owned = await p.team.count({ where: { ownerId: req.user.uid } });
    // The admin's limit plus the slots this account bought. The refusal carries the numbers
    // and the price, so the dashboard can offer the slot right there.
    const me = await p.user.findUnique({ where: { id: req.user.uid }, select: { extraTeamSlots: true, email: true } });
    const st = await hostingSettings(p);
    const lim = teamLimitFor(st, me || {});
    if (owned >= lim.limit && !isStaff(req.user)) return reply.code(409).send({ error: 'too_many_teams', owned, limit: lim.limit, slot: teamSlotPrice(st) });
    const slug = await uniqueSlug(p, slugifyTeam(b.data.name));
    const contactEmail = b.data.contactEmail || me?.email || '';
    if (!contactEmail) return reply.code(400).send({ error: 'invalid_email', field: 'contactEmail' });
    const t = await p.team.create({ data: { ...b.data, contactEmail, slug, ownerId: req.user.uid, members: { create: { userId: req.user.uid, role: 'owner', status: 'active' } } } });
    await logAudit(p, req.user.uid, 'team.create', `team=${t.id} ${t.name}`).catch(() => {});
    return reply.code(201).send({ team: serTeam(t, { myRole: 'owner', myStatus: 'active' }) });
  });

  // How many teams this account may own, how many it has, and what one more costs.
  app.get('/me/teams/limits', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const [owned, me, st] = await Promise.all([p.team.count({ where: { ownerId: req.user.uid } }), p.user.findUnique({ where: { id: req.user.uid }, select: { extraTeamSlots: true } }), hostingSettings(p)]);
    const lim = teamLimitFor(st, me || {});
    return { owned, ...lim, staff: isStaff(req.user), slot: teamSlotPrice(st), paymentsEnabled: st['features.paymentsEnabled'] !== false };
  });

  // One more team than the limit: a one-off Stripe payment (metadata.type = team_slot). The
  // webhook credits `extraTeamSlots`; the reconciler finishes it if the webhook never comes.
  app.post('/me/teams/slot/checkout', { preHandler: requireRole(), config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    const p = await db();
    const st = await hostingSettings(p);
    if (st['features.paymentsEnabled'] === false) return reply.code(503).send({ error: 'payments_disabled' });
    const sk = await stripe({ forPurchase: true });
    if (!sk) return reply.code(503).send({ error: 'stripe_not_configured' });
    const price = teamSlotPrice(st);
    const me = await p.user.findUnique({ where: { id: req.user.uid }, select: { email: true } });
    const siteUrl = (process.env.SITE_URL || 'http://localhost').replace(/\/+$/, '');
    const session = await sk.checkout.sessions.create({
      mode: 'payment',
      customer_email: me?.email || undefined,
      line_items: [{ quantity: 1, price_data: { currency: price.currency, unit_amount: price.cents, product_data: { name: 'One extra team' } } }],
      metadata: { type: 'team_slot', userId: req.user.uid },
      success_url: `${siteUrl}/dashboard?s=teams&slot=ok`,
      cancel_url: `${siteUrl}/dashboard?s=teams&slot=cancel`,
    });
    await recordPendingCheckout(p, { kind: 'team_slot', sessionId: session.id, userId: req.user.uid, payload: session.metadata || null });
    return { url: session.url };
  });

  // Invitation links: `/teams/join/<token>`, for a role, permanent or until a date.
  //
  // Two shapes, and the page shows them apart because they are used apart: ONE permanent link
  // that a team pins somewhere and revokes when it is done with it, and a few temporary ones
  // handed to a person for a week. The caps live with the admin (`teams.inviteMaxTemporary`,
  // `teams.inviteLifetimeDays`) beside the team limit and the slot price.
  app.get('/me/teams/:id/invites', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const got = await load(p, req, reply, ['owner', 'admin']); if (!got) return;
    const now = new Date();
    const rows = await p.teamInvite.findMany({ where: { teamId: got.t.id, revokedAt: null }, orderBy: { createdAt: 'desc' } });
    const invites = rows.map((r) => serInvite(r, now));
    return {
      invites,
      permanent: invites.find((i) => i.kind === 'permanent') || null,
      temporary: invites.filter((i) => i.kind === 'temporary'),
      policy: invitePolicy(await hostingSettings(p)),
    };
  });
  app.post('/me/teams/:id/invites', { preHandler: requireRole(), config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    // No `maxUses`: the column exists and `inviteUsable` still honours a row that carries
    // one, but nothing offers it any more, and an input the product does not expose is a
    // way to put a team's link in a state its owner cannot see or undo from the page.
    const b = z.object({ role: z.enum(['admin', 'member']).default('member'), days: z.number().int().min(0).max(365).nullable().optional() }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const got = await load(p, req, reply, ['owner', 'admin']); if (!got) return;
    const policy = invitePolicy(await hostingSettings(p));
    const open = await p.teamInvite.findMany({ where: { teamId: got.t.id, revokedAt: null }, select: { expiresAt: true, maxUses: true, uses: true, revokedAt: true } });
    // One decision, named: the route never refuses on its own, so the rule is testable without
    // a database and the page always gets an error string it can turn into a sentence.
    const plan = invitePlanFor(open, b.data.days, policy);
    if (plan.error) return reply.code(409).send(plan);
    const r = await p.teamInvite.create({ data: { token: crypto.randomBytes(18).toString('base64url'), teamId: got.t.id, role: b.data.role, createdBy: req.user.uid, expiresAt: plan.expiresAt } });
    await logAudit(p, req.user.uid, 'team.invite.link', `team=${got.t.id} role=${r.role} ${plan.permanent ? 'permanent' : `${plan.days}d`}`).catch(() => {});
    return reply.code(201).send({ invite: serInvite(r) });
  });
  app.delete('/me/teams/:id/invites/:inviteId', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const got = await load(p, req, reply, ['owner', 'admin']); if (!got) return;
    // Revoked, not deleted: the row is the record that the link existed and stopped working,
    // and `inviteUsable` already reads `revokedAt` as "no". The permanent one can be made
    // again straight after — revoking it frees the single slot.
    const r = await p.teamInvite.updateMany({ where: { id: req.params.inviteId, teamId: got.t.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!r.count) return reply.code(404).send({ error: 'not_found' });
    await logAudit(p, req.user.uid, 'team.invite.revoke', `team=${got.t.id} invite=${req.params.inviteId}`).catch(() => {});
    return { ok: true };
  });
  // The link's landing: what team, what role, still valid — then the join.
  app.get('/teams/join/:token', { preHandler: optionalAuth() }, async (req, reply) => {
    const p = await db();
    const inv = await p.teamInvite.findUnique({ where: { token: String(req.params.token || '') }, include: { team: { select: { id: true, slug: true, name: true, avatar: true, description: true } } } });
    if (!inv) return reply.code(404).send({ error: 'not_found' });
    const member = req.user ? await p.teamMember.findUnique({ where: { teamId_userId: { teamId: inv.teamId, userId: req.user.uid } } }) : null;
    return { team: inv.team, role: inv.role, usable: inviteUsable(inv), expiresAt: inv.expiresAt, signedIn: !!req.user, alreadyMember: member?.status === 'active' };
  });
  app.post('/teams/join/:token', { preHandler: requireRole(), config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    const p = await db();
    const inv = await p.teamInvite.findUnique({ where: { token: String(req.params.token || '') }, include: { team: true } });
    if (!inv || !inviteUsable(inv)) return reply.code(410).send({ error: 'invite_invalid' });
    const existing = await p.teamMember.findUnique({ where: { teamId_userId: { teamId: inv.teamId, userId: req.user.uid } } });
    if (existing?.status === 'active') return { ok: true, team: serTeam(inv.team, { myRole: existing.role, myStatus: 'active' }), already: true };
    const count = await p.teamMember.count({ where: { teamId: inv.teamId } });
    if (count >= 50 && !existing) return reply.code(409).send({ error: 'team_full' });
    await p.teamMember.upsert({
      where: { teamId_userId: { teamId: inv.teamId, userId: req.user.uid } },
      create: { teamId: inv.teamId, userId: req.user.uid, role: inv.role, status: 'active', invitedBy: inv.createdBy },
      update: { role: inv.role, status: 'active', invitedBy: inv.createdBy },
    });
    await p.teamInvite.update({ where: { id: inv.id }, data: { uses: { increment: 1 } } });
    await notify(p, inv.team.ownerId, 'team_joined', `${req.user.displayName || 'A member'} joined “${inv.team.name}” through an invite link.`, { href: '/dashboard?s=teams' }).catch(() => {});
    return { ok: true, team: serTeam(inv.team, { myRole: inv.role, myStatus: 'active' }) };
  });

  const load = async (p, req, reply, roles) => {
    const t = await p.team.findUnique({ where: { id: req.params.id } });
    if (!t) { reply.code(404).send({ error: 'not_found' }); return null; }
    const role = await teamRoleOf(p, req.user.uid, t.id);
    if (!isStaff(req.user) && (!role || (roles && !roles.includes(role)))) { reply.code(403).send({ error: 'forbidden' }); return null; }
    return { t, role: role || 'staff' };
  };

  app.patch('/me/teams/:id', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ name: z.string().trim().min(2).max(60).optional(), avatar: z.string().trim().max(300).optional(), ...Object.fromEntries(Object.entries(contact).map(([k, v]) => [k, v.optional()])) }).safeParse(req.body);
    if (!b.success) {
      const bad = b.error.issues[0]?.path?.[0];
      return reply.code(400).send({ error: bad === 'name' ? 'invalid_name' : bad === 'contactEmail' ? 'invalid_email' : 'invalid_input', field: bad || null });
    }
    // Same courtesy as create: a scheme-less address is completed, not refused.
    if (b.data.website !== undefined) b.data.website = normalizeUrl(b.data.website);
    if (b.data.discord !== undefined) b.data.discord = normalizeUrl(b.data.discord);
    if (!httpish(b.data.website)) return reply.code(400).send({ error: 'invalid_website', field: 'website' });
    if (!httpish(b.data.discord)) return reply.code(400).send({ error: 'invalid_discord', field: 'discord' });
    const p = await db();
    const got = await load(p, req, reply, ['owner', 'admin']); if (!got) return;
    const data = Object.fromEntries(Object.entries(b.data).filter(([, v]) => v !== undefined));
    if (data.avatar && !/^(\/|https:\/\/)/.test(data.avatar)) delete data.avatar;
    const t = await p.team.update({ where: { id: got.t.id }, data });
    return { team: serTeam(t, { myRole: got.role }) };
  });

  app.delete('/me/teams/:id', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const got = await load(p, req, reply, ['owner']); if (!got) return;
    await p.team.delete({ where: { id: got.t.id } });   // FKs: members cascade, repos/catalogues/pools SET NULL
    await logAudit(p, req.user.uid, 'team.delete', `team=${got.t.id} ${got.t.name}`).catch(() => {});
    return { ok: true };
  });

  app.post('/me/teams/:id/members', { preHandler: requireRole(), config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (req, reply) => {
    const b = z.object({ to: z.string().trim().min(1).max(254), role: z.enum(['admin', 'member']).default('member') }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const got = await load(p, req, reply, ['owner', 'admin']); if (!got) return;
    const u = await resolveUser(p, b.data.to);
    if (!u) return reply.code(404).send({ error: 'user_not_found' });
    if (u.id === req.user.uid) return reply.code(400).send({ error: 'yourself' });
    const existing = await p.teamMember.findUnique({ where: { teamId_userId: { teamId: got.t.id, userId: u.id } } });
    if (existing?.status === 'active') return reply.code(409).send({ error: 'already_member' });
    const count = await p.teamMember.count({ where: { teamId: got.t.id } });
    if (count >= 50) return reply.code(409).send({ error: 'team_full' });
    await p.teamMember.upsert({
      where: { teamId_userId: { teamId: got.t.id, userId: u.id } },
      create: { teamId: got.t.id, userId: u.id, role: b.data.role, status: 'invited', invitedBy: req.user.uid },
      update: { role: b.data.role, status: 'invited', invitedBy: req.user.uid },
    });
    await notify(p, u.id, 'team_invite', `You were invited to the team “${got.t.name}”.`, { bodyFr: `Tu as été invité·e dans l’équipe « ${got.t.name} ».`, href: '/dashboard?s=teams' });
    return { ok: true, invited: { id: u.id, displayName: u.displayName } };
  });

  // Literal paths on purpose: the API-reference test and grep find routes by their string.
  const answerInvite = (verb) => async (req, reply) => {
    const p = await db();
    const m = await p.teamMember.findUnique({ where: { teamId_userId: { teamId: req.params.id, userId: req.user.uid } }, include: { team: true } });
    if (!m || m.status !== 'invited') return reply.code(404).send({ error: 'no_invite' });
    if (verb === 'decline') { await p.teamMember.delete({ where: { teamId_userId: { teamId: m.teamId, userId: m.userId } } }); return { ok: true }; }
    await p.teamMember.update({ where: { teamId_userId: { teamId: m.teamId, userId: m.userId } }, data: { status: 'active' } });
    await notify(p, m.team.ownerId, 'team_joined', `${req.user.displayName || 'A member'} joined “${m.team.name}”.`, { href: '/dashboard?s=teams' });
    return { ok: true, team: serTeam(m.team, { myRole: m.role, myStatus: 'active' }) };
  };
  app.post('/me/teams/:id/accept', { preHandler: requireRole() }, answerInvite('accept'));
  app.post('/me/teams/:id/decline', { preHandler: requireRole() }, answerInvite('decline'));

  app.patch('/me/teams/:id/members/:userId', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ role: z.enum(['admin', 'member']) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const got = await load(p, req, reply, ['owner']); if (!got) return;
    if (req.params.userId === got.t.ownerId) return reply.code(400).send({ error: 'owner_role_fixed' });
    await p.teamMember.update({ where: { teamId_userId: { teamId: got.t.id, userId: req.params.userId } }, data: { role: b.data.role } }).catch(() => null);
    return { ok: true };
  });

  app.delete('/me/teams/:id/members/:userId', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const self = req.params.userId === req.user.uid;
    const got = await load(p, req, reply, self ? null : ['owner', 'admin']); if (!got) return;
    if (req.params.userId === got.t.ownerId) return reply.code(400).send({ error: 'transfer_first' });
    // An admin may remove members, not other admins; the owner may remove anyone.
    if (!self && got.role === 'admin') {
      const target = await teamRoleOf(p, req.params.userId, got.t.id);
      if (target === 'admin') return reply.code(403).send({ error: 'forbidden' });
    }
    await p.teamMember.delete({ where: { teamId_userId: { teamId: got.t.id, userId: req.params.userId } } }).catch(() => null);
    return { ok: true };
  });

  app.post('/me/teams/:id/transfer', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ userId: z.string().min(1).max(64) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const got = await load(p, req, reply, ['owner']); if (!got) return;
    const role = await teamRoleOf(p, b.data.userId, got.t.id);
    if (!role) return reply.code(400).send({ error: 'not_a_member' });
    await p.$transaction([
      p.team.update({ where: { id: got.t.id }, data: { ownerId: b.data.userId } }),
      p.teamMember.update({ where: { teamId_userId: { teamId: got.t.id, userId: b.data.userId } }, data: { role: 'owner' } }),
      p.teamMember.update({ where: { teamId_userId: { teamId: got.t.id, userId: got.t.ownerId } }, data: { role: 'admin' } }),
    ]);
    await logAudit(p, req.user.uid, 'team.transfer', `team=${got.t.id} → ${b.data.userId}`).catch(() => {});
    return { ok: true };
  });

  app.put('/me/teams/:id/attach', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ kind: z.enum(['repo', 'catalog', 'group']), id: z.string().min(1).max(64), attach: z.boolean().default(true) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const got = await load(p, req, reply, ['owner', 'admin']); if (!got) return;
    const model = b.data.kind === 'repo' ? p.serverRepo : b.data.kind === 'catalog' ? p.communityCatalog : p.hostingGroup;
    const row = await model.findUnique({ where: { id: b.data.id }, select: { id: true, ownerId: true, teamId: true } });
    if (!row) return reply.code(404).send({ error: 'not_found' });
    if (row.ownerId !== req.user.uid && !isStaff(req.user)) return reply.code(403).send({ error: 'owner_only' });
    if (!b.data.attach && row.teamId !== got.t.id) return reply.code(409).send({ error: 'not_attached' });
    await model.update({ where: { id: row.id }, data: { teamId: b.data.attach ? got.t.id : null } });
    return { ok: true, teamId: b.data.attach ? got.t.id : null };
  });


  // ── The team's contact inbox ─────────────────────────────────────────────────────────────
  //
  //   GET  /me/teams/:id/contact                  who answers, the caps, storage and files (any member reads)
  //   PUT  /me/teams/:id/contact                  change them (owner / admin)
  //   GET  /me/teams/:id/threads?status=          the team's conversations (members who answer)
  //   POST /me/teams/:id/threads/archive          { ids } put several away at once (members who answer)
  //   DELETE /me/teams/:id/threads/:threadId      delete one, with its files (owner / admin)
  //
  // "The team's conversations" are every thread whose ownerTeamId is the team: addressed to it,
  // or about one of its repos or catalogues. Reading and answering them is lib/team-contact.mjs;
  // storage and files are the team's EntityHostingSettings ('team-contact'), where a team may
  // only point at a pool it owns and may only switch files OFF or to "with a pool": files on
  // the site's own storage are an admin decision (Admin, Storage per blog and inbox).
  const teamPools = (p, team, uid) => p.hostingGroup.findMany({ where: { OR: [{ teamId: team.id }, { ownerId: uid }] }, select: { id: true, name: true, poolBytes: true } });

  app.get('/me/teams/:id/contact', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const got = await load(p, req, reply, null); if (!got) return;
    const [s, h, site] = await Promise.all([teamContactSettings(p, got.t.id), hostingFor(p, 'team-contact', got.t.id), siteAttachmentDefault(p)]);
    const canEdit = ['owner', 'admin', 'staff'].includes(got.role);
    const pools = canEdit ? await Promise.all((await teamPools(p, got.t, req.user.uid)).map(async (g) => ({ id: g.id, name: g.name, sizeMB: Number(g.poolBytes) / 1048576, freeMB: Number((await poolRoom(p, g.id)) ?? 0n) / 1048576 }))) : [];
    const files = attachmentPolicy(h, site);
    return {
      answerRoles: s.answerRoles, maxOpenMembers: s.maxOpenMembers, maxOpenAnon: s.maxOpenAnon, roles: TEAM_ROLES,
      storage: serHosting(h), files: { allowed: files.allowed, why: files.why, maxBytes: files.maxBytes }, siteFiles: site.attachments,
      canEdit, canAnswer: await canAnswerTeam(p, req.user.uid, got.t.id) || got.role === 'staff', pools,
    };
  });

  app.put('/me/teams/:id/contact', { preHandler: requireRole(), config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const b = z.object({
      answerRoles: z.array(z.enum(TEAM_ROLES)).max(3).optional(),
      maxOpenMembers: z.number().int().min(0).max(100000).optional(),
      maxOpenAnon: z.number().int().min(0).max(100000).optional(),
      storage: z.object({ mode: z.enum(['inherit', 'pool']), poolId: z.string().max(64).nullable().optional(), quotaMB: z.number().min(0).max(10 * 1024 * 1024).optional() }).optional(),
      attachments: z.enum(['inherit', 'off', 'pool_only']).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const got = await load(p, req, reply, ['owner', 'admin']); if (!got) return;
    if (b.data.answerRoles || b.data.maxOpenMembers !== undefined || b.data.maxOpenAnon !== undefined) {
      const cur = await teamContactSettings(p, got.t.id);
      const data = {
        answerRoles: b.data.answerRoles ? [...new Set(['owner', ...b.data.answerRoles])] : cur.answerRoles,
        maxOpenMembers: b.data.maxOpenMembers ?? cur.maxOpenMembers,
        maxOpenAnon: b.data.maxOpenAnon ?? cur.maxOpenAnon,
      };
      await p.teamContactSettings.upsert({ where: { teamId: got.t.id }, create: { teamId: got.t.id, ...data }, update: data });
    }
    if (b.data.storage || b.data.attachments) {
      // A team settles storage only between the site's setting and a pool of its own. If an
      // admin gave this inbox something else (own caps, no limit), the team does not undo it
      // by saving its screen: those fields are simply not sent from here.
      const input = { ...(b.data.attachments ? { attachments: b.data.attachments } : {}) };
      if (b.data.storage) Object.assign(input, { mode: b.data.storage.mode, poolId: b.data.storage.poolId ?? null, quotaMB: b.data.storage.quotaMB ?? 0 });
      const own = new Set((await teamPools(p, got.t, req.user.uid)).map((g) => g.id));
      const r = await saveHosting(p, 'team-contact', got.t.id, input, { actorId: req.user.uid, canUsePool: async (id) => own.has(id) || isStaff(req.user) });
      if (r.error) return reply.code(r.error === 'pool_forbidden' ? 403 : 409).send(r);
    }
    await logAudit(p, req.user.uid, 'team.contact.settings', `team=${got.t.id}`).catch(() => {});
    return { ok: true };
  });

  const answering = async (p, req, reply) => {
    const got = await load(p, req, reply, null); if (!got) return null;
    if (got.role !== 'staff' && !(await canAnswerTeam(p, req.user.uid, got.t.id))) { reply.code(403).send({ error: 'not_an_answerer' }); return null; }
    return got;
  };

  app.get('/me/teams/:id/threads', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const got = await answering(p, req, reply); if (!got) return;
    const status = String(req.query?.status || 'open');
    const where = { ownerTeamId: got.t.id, ...(status === 'all' ? {} : { status: ['open', 'archived', 'closed', 'blocked'].includes(status) ? status : 'open' }) };
    const [rows, counts] = await Promise.all([
      p.contactThread.findMany({ where, orderBy: { lastActivityAt: 'desc' }, take: 200, include: { sender: { select: { id: true, displayName: true, avatar: true } }, _count: { select: { messages: true, attachments: true } } } }),
      p.contactThread.groupBy({ by: ['status'], where: { ownerTeamId: got.t.id }, _count: { _all: true } }),
    ]);
    return {
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
      threads: rows.map((t) => ({
        id: t.id, kind: t.kind, targetLabel: t.targetLabel, subject: t.subject, status: t.status, ownerUnread: t.ownerUnread,
        sender: t.sender ? { id: t.sender.id, displayName: t.sender.displayName, avatar: t.sender.avatar || null } : null,
        senderName: t.senderName, anonymous: !t.senderId, messages: t._count.messages, files: t._count.attachments, lastActivityAt: t.lastActivityAt,
      })),
    };
  });

  app.post('/me/teams/:id/threads/archive', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(200), status: z.enum(['archived', 'open']).default('archived') }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const got = await answering(p, req, reply); if (!got) return;
    // Scoped to THIS team's rows in the query itself: an id from another team's inbox is
    // not refused, it simply matches nothing.
    const { count } = await p.contactThread.updateMany({ where: { id: { in: b.data.ids }, ownerTeamId: got.t.id, status: { not: 'blocked' } }, data: { status: b.data.status } });
    return { ok: true, count };
  });

  app.delete('/me/teams/:id/threads/:threadId', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const got = await load(p, req, reply, ['owner', 'admin']); if (!got) return;
    const t = await p.contactThread.findFirst({ where: { id: req.params.threadId, ownerTeamId: got.t.id }, select: { id: true, subject: true } });
    if (!t) return reply.code(404).send({ error: 'not_found' });
    await deleteThreadFiles(p, t.id);
    await p.contactThread.delete({ where: { id: t.id } });
    await logAudit(p, req.user.uid, 'team.thread.delete', `team=${got.t.id} thread=${t.id}`).catch(() => {});
    return { ok: true };
  });
}
