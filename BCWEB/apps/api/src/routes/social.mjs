import { z } from 'zod';
import { db, requireRole, optionalAuth, slugify } from '../lib/lib.mjs';
import { looksLikeBcId, findUserIdByBcId } from '../lib/repofingerprint.mjs';

// Profile badges + public profiles + profile search. A badge is admin-created and shown
// Twitch-chat-style next to a user's name; a profile is a privacy-controlled /u/<id> page.

const STAFF = ['MOD', 'ADMIN', 'SUPERADMIN'];
const badgeInput = z.object({
  name: z.string().trim().min(1).max(40),
  slug: z.string().trim().max(40).optional(),
  description: z.string().max(200).optional().default(''),
  iconType: z.enum(['lucide', 'brand', 'image']).default('lucide'),
  icon: z.string().max(600).default('BadgeCheck'), // lucide/brand name, or an image URL / data URI
  color: z.string().max(32).default('#f59e0b'),
  grant: z.enum(['manual', 'easter_egg', 'auto']).default('manual'),
  trigger: z.string().max(40).nullable().optional(),
  rule: z.object({
    type: z.enum(['signup_nth', 'signup_before', 'kofi_donation']),
    every: z.number().int().min(1).max(1000000).optional(),
    date: z.string().max(40).optional(),
  }).nullable().optional(),
  earnMessage: z.string().max(600).optional().default(''),
  priority: z.number().int().min(0).max(999).optional().default(0),
  active: z.boolean().optional().default(true),
});

const pubBadge = (ub) => ({ id: ub.badge.id, slug: ub.badge.slug, name: ub.badge.name, description: ub.badge.description, iconType: ub.badge.iconType, icon: ub.badge.icon, color: ub.badge.color });

// Auto-grant badges when a lifecycle event fires. `event`: "signup" | "kofi". Best-effort,
// never throws to the caller. Idempotent (createMany skipDuplicates on the unique pair).
export async function grantAutoBadges(p, { event, user }) {
  try {
    const badges = await p.badge.findMany({ where: { grant: 'auto', active: true } });
    if (!badges.length) return;
    const toGrant = [];
    for (const b of badges) {
      const r = b.rule || {};
      if (event === 'signup') {
        if (r.type === 'signup_nth' && r.every > 0) {
          // The user's signup ordinal = how many accounts existed up to and including theirs.
          const ordinal = await p.user.count({ where: { createdAt: { lte: user.createdAt } } });
          if (ordinal % r.every === 0) toGrant.push(b.id);
        } else if (r.type === 'signup_before' && r.date) {
          if (new Date(user.createdAt) < new Date(r.date)) toGrant.push(b.id);
        }
      } else if (event === 'kofi' && r.type === 'kofi_donation') {
        toGrant.push(b.id);
      }
    }
    if (toGrant.length) {
      await p.userBadge.createMany({ data: toGrant.map((badgeId) => ({ userId: user.id, badgeId, grantedBy: 'system' })), skipDuplicates: true });
    }
  } catch { /* auto-grant is best-effort */ }
}

// A user's shareable profile. No PII — pseudo, avatar, badges, join date, role, public
// repos + catalogs, and only the connections the owner opted to show.
//
// Exported and shared by the /u/:id page and the public API, deliberately: this function
// decides who may see a private profile, and two copies of that rule would eventually
// disagree — in the direction that leaks.
//
// `viewer` is { uid, role } or null. Returns { error, code } instead of throwing so both
// callers answer identically.
export async function buildPublicProfile(p, id, viewer) {
    const u = await p.user.findUnique({
      where: { id },
      select: {
        id: true, displayName: true, role: true, avatar: true, bio: true, website: true,
        createdAt: true, profilePublic: true, showConnections: true, status: true,
        badges: { include: { badge: true }, orderBy: { badge: { priority: 'desc' } } },
        oauthAccounts: { select: { provider: true, username: true } },
        discordLinks: { select: { username: true } },
        creatorLinks: { select: { creatorId: true, displayName: true } },
        socialConnections: { select: { provider: true, handle: true, url: true } },
      },
    });
    if (!u || u.status === 'banned') return { error: 'not_found', code: 404 };
    const isSelf = viewer?.uid === u.id;
    const isStaff = STAFF.includes(viewer?.role);
    if (!u.profilePublic && !isSelf && !isStaff) return { error: 'private_profile', code: 403 };

    // Public content owned by this user.
    const [repos, catalogs] = await Promise.all([
      p.serverRepo.findMany({ where: { ownerId: u.id, listed: true, verified: true, pendingReview: false }, select: { id: true, name: true, description: true, _count: { select: { favorites: true } } }, take: 30, orderBy: { createdAt: 'desc' } }),
      p.communityCatalog.findMany({ where: { ownerId: u.id, status: 'ACTIVE', visibility: 'public', listed: true }, select: { slug: true, name: true, downloads: true, _count: { select: { items: true } } }, take: 30, orderBy: { createdAt: 'desc' } }),
    ]);

    // Only the connections the owner chose to surface (never emails).
    const show = new Set(u.showConnections || []);
    const gh = u.oauthAccounts.find((a) => a.provider === 'github');
    const social = Object.fromEntries((u.socialConnections || []).map((c) => [c.provider, c]));
    const connections = {};
    // github can come from a dedicated social connection or the login OAuth account.
    if (show.has('github') && (social.github || gh?.username)) connections.github = social.github ? { handle: social.github.handle, url: social.github.url } : { handle: gh.username, url: `https://github.com/${gh.username}` };
    if (show.has('discord') && (u.discordLinks[0]?.username)) connections.discord = u.discordLinks[0].username;
    if (show.has('bmm') && u.creatorLinks[0]) connections.bmm = u.creatorLinks[0].displayName || u.creatorLinks[0].creatorId;
    if (show.has('website') && u.website) connections.website = u.website;
    for (const prov of ['youtube', 'twitch', 'steam', 'kofi']) {
      if (show.has(prov) && social[prov]) connections[prov] = { handle: social[prov].handle, url: social[prov].url };
    }

    return {
      profile: {
        id: u.id, displayName: u.displayName, role: u.role, avatar: u.avatar, bio: u.bio,
        joinedAt: u.createdAt, private: !u.profilePublic,
        badges: u.badges.map(pubBadge),
        connections,
        repos: repos.map((r) => ({ id: r.id, name: r.name, description: r.description, favorites: r._count.favorites })),
        catalogs: catalogs.map((c) => ({ slug: c.slug, name: c.name, downloads: c.downloads, items: c._count.items })),
      },
    };
}

export default async function socialRoutes(app) {
  app.get('/u/:id', { preHandler: optionalAuth() }, async (req, reply) => {
    const p = await db();
    const r = await buildPublicProfile(p, req.params.id, req.user);
    if (r.error) return reply.code(r.code).send({ error: r.error });
    return r;
  });

  // Public: search users by display name (public profiles only, unless staff). Returns a
  // light card: id, name, avatar, role, top badges.
  app.get('/users/search', { preHandler: optionalAuth() }, async (req) => {
    const p = await db();
    const q = String(req.query?.q || '').trim();
    if (q.length < 2) return { users: [] };
    const isStaff = STAFF.includes(req.user?.role);
    const userSelect = { id: true, displayName: true, role: true, avatar: true, profilePublic: true, badges: { include: { badge: true }, orderBy: { badge: { priority: 'desc' } }, take: 4 } };
    // Direct lookups: a BC id, a repo id, or a catalog slug/id all resolve to the owner.
    const owners = new Set();
    if (looksLikeBcId(q)) { const uid = await findUserIdByBcId(p, q); if (uid) owners.add(uid); }
    const [repo, cat] = await Promise.all([
      p.serverRepo.findUnique({ where: { id: q }, select: { ownerId: true } }).catch(() => null),
      p.communityCatalog.findFirst({ where: { OR: [{ id: q }, { slug: q }] }, select: { ownerId: true } }).catch(() => null),
    ]);
    if (repo) owners.add(repo.ownerId);
    if (cat) owners.add(cat.ownerId);
    // Name search + any resolved owners, deduped.
    const rows = await p.user.findMany({
      where: {
        OR: [{ displayName: { contains: q, mode: 'insensitive' } }, ...(owners.size ? [{ id: { in: [...owners] } }] : [])],
        status: { not: 'banned' },
        ...(isStaff ? {} : { profilePublic: true }),
      },
      select: userSelect, take: 20, orderBy: { createdAt: 'asc' },
    });
    return { users: rows.map((u) => ({ id: u.id, displayName: u.displayName, role: u.role, avatar: u.avatar, private: !u.profilePublic, badges: u.badges.map(pubBadge), matchedById: owners.has(u.id) })) };
  });

  // Public: the badge tied to a trigger (e.g. the footer 5x-click easter egg) + its message,
  // so the client can render the reveal modal and know what claiming grants.
  app.get('/badges/trigger/:trigger', async (req) => {
    const p = await db();
    const b = await p.badge.findFirst({ where: { trigger: req.params.trigger, grant: 'easter_egg', active: true } });
    // 200 with badge:null (not 404) — a missing easter-egg badge is a normal state, not an
    // error, so the footer/click probe doesn't spam the console with a 404.
    if (!b) return { badge: null };
    return { badge: { id: b.id, slug: b.slug, name: b.name, description: b.description, iconType: b.iconType, icon: b.icon, color: b.color, message: b.earnMessage } };
  });

  // Auth: claim an easter-egg badge (idempotent). Only badges configured as easter_egg
  // can be self-claimed; manual/auto badges cannot be granted this way.
  app.post('/me/badges/claim', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ trigger: z.string().max(40) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const badge = await p.badge.findFirst({ where: { trigger: b.data.trigger, grant: 'easter_egg', active: true } });
    if (!badge) return reply.code(404).send({ error: 'no_such_badge' });
    const existing = await p.userBadge.findUnique({ where: { userId_badgeId: { userId: req.user.uid, badgeId: badge.id } } });
    if (existing) return { alreadyHad: true, badge: { name: badge.name, icon: badge.icon, iconType: badge.iconType, color: badge.color } };
    await p.userBadge.create({ data: { userId: req.user.uid, badgeId: badge.id, grantedBy: 'system' } });
    return { alreadyHad: false, badge: { name: badge.name, icon: badge.icon, iconType: badge.iconType, color: badge.color } };
  });

  // ── Admin: badge CRUD + grant/revoke (ADMIN/SUPERADMIN). ──
  app.get('/admin/badges', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    const rows = await p.badge.findMany({ orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }], include: { _count: { select: { holders: true } } } });
    return { badges: rows.map((b) => ({ ...b, holders: b._count.holders, _count: undefined })) };
  });

  app.post('/admin/badges', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = badgeInput.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const base = slugify(b.data.slug || b.data.name);
    let slug = base; for (let i = 2; await p.badge.findUnique({ where: { slug } }); i++) slug = `${base}-${i}`;
    // Only one easter-egg badge per trigger.
    if (b.data.grant === 'easter_egg' && b.data.trigger) {
      const clash = await p.badge.findFirst({ where: { trigger: b.data.trigger, grant: 'easter_egg' } });
      if (clash) return reply.code(409).send({ error: 'trigger_taken' });
    }
    const badge = await p.badge.create({ data: { ...b.data, slug, trigger: b.data.grant === 'easter_egg' ? (b.data.trigger || null) : null, rule: b.data.grant === 'auto' ? (b.data.rule || null) : null } });
    return reply.code(201).send({ badge });
  });

  app.patch('/admin/badges/:id', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = badgeInput.partial().safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const data = { ...b.data }; delete data.slug; // slug is immutable
    if (data.grant && data.grant !== 'easter_egg') data.trigger = null;
    if (data.grant && data.grant !== 'auto') data.rule = null;
    const badge = await p.badge.update({ where: { id: req.params.id }, data });
    return { badge };
  });

  app.delete('/admin/badges/:id', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    await p.badge.delete({ where: { id: req.params.id } }); // cascades UserBadge
    return { ok: true };
  });

  app.get('/admin/badges/:id/holders', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    const rows = await p.userBadge.findMany({ where: { badgeId: req.params.id }, include: { user: { select: { id: true, displayName: true, email: true } } }, orderBy: { grantedAt: 'desc' }, take: 500 });
    return { holders: rows.map((h) => ({ userId: h.user.id, displayName: h.user.displayName, email: h.user.email, grantedAt: h.grantedAt, grantedBy: h.grantedBy })) };
  });

  // Grant a badge to a user by id or email.
  app.post('/admin/badges/:id/grant', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = z.object({ userId: z.string().optional(), email: z.string().email().optional() }).safeParse(req.body);
    if (!b.success || (!b.data.userId && !b.data.email)) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const badge = await p.badge.findUnique({ where: { id: req.params.id } });
    if (!badge) return reply.code(404).send({ error: 'no_such_badge' });
    const user = await p.user.findFirst({ where: b.data.userId ? { id: b.data.userId } : { email: b.data.email } });
    if (!user) return reply.code(404).send({ error: 'no_such_user' });
    await p.userBadge.upsert({
      where: { userId_badgeId: { userId: user.id, badgeId: badge.id } },
      create: { userId: user.id, badgeId: badge.id, grantedBy: req.user.uid },
      update: {},
    });
    return { ok: true, userId: user.id, displayName: user.displayName };
  });

  app.delete('/admin/badges/:id/holders/:userId', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    await p.userBadge.deleteMany({ where: { badgeId: req.params.id, userId: req.params.userId } });
    return { ok: true };
  });
}
