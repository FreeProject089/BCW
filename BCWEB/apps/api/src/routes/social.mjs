import { z } from 'zod';
import { db, requireRole, optionalAuth, slugify } from '../lib/lib.mjs';
import { looksLikeBcId, findUserIdByBcId } from '../lib/repofingerprint.mjs';
import { emitWebhook } from '../lib/webhooks.mjs';

// Profile badges + public profiles + profile search. A badge is admin-created and shown
// Twitch-chat-style next to a user's name; a profile is a privacy-controlled /u/<id> page.

const STAFF = ['MOD', 'ADMIN', 'SUPERADMIN'];

// Every way a badge can be earned automatically. The first three are the original rules; the
// rest arrived with the Discord economy and the shop, so that a level, a habit or a purchase
// can put something on a profile without a person handing it out.
export const BADGE_RULE_TYPES = [
  'signup_nth', 'signup_before', 'kofi_donation',
  'level_reached', 'messages_sent', 'purchases_made', 'polls_answered', 'items_published',
  'repo_hosted', 'discord_linked', 'twofa_enabled', 'account_age',
];
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
    type: z.enum(BADGE_RULE_TYPES),
    every: z.number().int().min(1).max(1000000).optional(),
    date: z.string().max(40).optional(),
    level: z.number().int().min(1).max(10000).optional(),
    count: z.number().int().min(1).max(100000000).optional(),
    days: z.number().int().min(1).max(36500).optional(),
  }).nullable().optional(),
  earnMessage: z.string().max(600).optional().default(''),
  priority: z.number().int().min(0).max(999).optional().default(0),
  active: z.boolean().optional().default(true),
});

const pubBadge = (ub) => ({ id: ub.badge.id, slug: ub.badge.slug, name: ub.badge.name, description: ub.badge.description, iconType: ub.badge.iconType, icon: ub.badge.icon, color: ub.badge.color });

// Which events each rule listens to. A rule not listed for an event is skipped without a
// query, so the accrue loop (every minute, every active member) only pays for what matters.
const RULE_EVENTS = {
  signup_nth: ['signup'], signup_before: ['signup'], kofi_donation: ['kofi'],
  level_reached: ['level', 'activity'], messages_sent: ['activity'],
  purchases_made: ['purchase'], polls_answered: ['vote'], items_published: ['publish'],
  repo_hosted: ['hosting'], discord_linked: ['discord'], twofa_enabled: ['twofa'], account_age: ['age'],
};

// Does `user` meet rule `r` right now? `ctx` carries what the caller already knows (a fresh
// economy row, the level just reached) so the common cases cost no extra query.
async function ruleMet(p, r, user, event, ctx) {
  switch (r.type) {
    case 'signup_nth': {
      if (!(r.every > 0)) return false;
      // The user's signup ordinal = how many accounts existed up to and including theirs.
      const ordinal = await p.user.count({ where: { createdAt: { lte: user.createdAt } } });
      return ordinal % r.every === 0;
    }
    case 'signup_before': return !!r.date && new Date(user.createdAt) < new Date(r.date);
    case 'kofi_donation': return event === 'kofi';
    case 'level_reached': {
      const lvl = ctx.level ?? ctx.economy?.level ?? (await p.userEconomy.findUnique({ where: { userId: user.id }, select: { level: true } }))?.level ?? 0;
      return lvl >= (r.level || 1);
    }
    case 'messages_sent': {
      const n = ctx.economy?.messages ?? (await p.userEconomy.findUnique({ where: { userId: user.id }, select: { messages: true } }))?.messages ?? 0;
      return n >= (r.count || 1);
    }
    case 'purchases_made': return (await p.economyPurchase.count({ where: { userId: user.id } })) >= (r.count || 1);
    case 'polls_answered': {
      const rows = await p.pollVote.findMany({ where: { userId: user.id }, select: { pollId: true }, distinct: ['pollId'] });
      return rows.length >= (r.count || 1);
    }
    case 'items_published': return (await p.catalogItem.count({ where: { ownerId: user.id, status: 'PUBLISHED' } })) >= (r.count || 1);
    case 'repo_hosted': return event === 'hosting' || (await p.hostingGroup.count({ where: { ownerId: user.id } })) > 0;
    case 'discord_linked': return event === 'discord' || (await p.discordLink.count({ where: { userId: user.id } })) > 0;
    case 'twofa_enabled': return event === 'twofa' || !!(await p.user.findUnique({ where: { id: user.id }, select: { totpEnabled: true } }))?.totpEnabled;
    case 'account_age': return (Date.now() - new Date(user.createdAt).getTime()) >= (r.days || 1) * 864e5;
    default: return false;
  }
}

// Auto-grant badges when a lifecycle event fires. `event`: "signup" | "kofi" | "level" |
// "activity" | "purchase" | "vote" | "publish" | "hosting" | "discord" | "twofa" | "age".
// Best-effort, never throws to the caller. Idempotent (skipDuplicates on the unique pair); the
// webhook fires only for a badge the person did not already hold. `user` needs `id` and
// `createdAt` (the two things every rule may read) — pass the row you have.
export async function grantAutoBadges(p, { event, user, level = null, economy = null }) {
  try {
    if (!user?.id) return;
    if (!user.createdAt) user = await p.user.findUnique({ where: { id: user.id }, select: { id: true, createdAt: true } });
    if (!user) return;
    const badges = (await p.badge.findMany({ where: { grant: 'auto', active: true } }))
      .filter((b) => (RULE_EVENTS[b.rule?.type] || []).includes(event));
    if (!badges.length) return;
    const held = new Set((await p.userBadge.findMany({ where: { userId: user.id, badgeId: { in: badges.map((b) => b.id) } }, select: { badgeId: true } })).map((x) => x.badgeId));
    const toGrant = [];
    for (const b of badges) {
      if (held.has(b.id)) continue;
      if (await ruleMet(p, b.rule || {}, user, event, { level, economy })) toGrant.push(b);
    }
    if (!toGrant.length) return;
    await p.userBadge.createMany({ data: toGrant.map((b) => ({ userId: user.id, badgeId: b.id, grantedBy: 'system' })), skipDuplicates: true });
    for (const b of toGrant) emitWebhook(p, user.id, 'badge.earned', { id: b.id, slug: b.slug, name: b.name, via: `rule:${b.rule?.type}` }).catch(() => {});
  } catch { /* auto-grant is best-effort */ }
}

// The rules that are met by TIME PASSING or by a threshold a person may already be past when
// the badge is created ("everyone at level 10" should include the people already there). Run
// by the sweeper once a day: for each such badge, find who qualifies and does not hold it.
export async function sweepAutoBadges(p, log) {
  const badges = await p.badge.findMany({ where: { grant: 'auto', active: true } });
  let granted = 0;
  for (const b of badges) {
    const r = b.rule || {};
    let ids = [];
    try {
      if (r.type === 'account_age') ids = (await p.user.findMany({ where: { createdAt: { lte: new Date(Date.now() - (r.days || 1) * 864e5) }, closedAt: null }, select: { id: true }, take: 5000 })).map((u) => u.id);
      else if (r.type === 'level_reached') ids = (await p.userEconomy.findMany({ where: { level: { gte: r.level || 1 } }, select: { userId: true }, take: 5000 })).map((u) => u.userId);
      else if (r.type === 'messages_sent') ids = (await p.userEconomy.findMany({ where: { messages: { gte: r.count || 1 } }, select: { userId: true }, take: 5000 })).map((u) => u.userId);
      else if (r.type === 'discord_linked') ids = (await p.discordLink.findMany({ select: { userId: true }, distinct: ['userId'], take: 5000 })).map((u) => u.userId);
      else if (r.type === 'twofa_enabled') ids = (await p.user.findMany({ where: { totpEnabled: true, closedAt: null }, select: { id: true }, take: 5000 })).map((u) => u.id);
      else if (r.type === 'repo_hosted') ids = (await p.hostingGroup.findMany({ select: { ownerId: true }, distinct: ['ownerId'], take: 5000 })).map((u) => u.ownerId);
      else if (r.type === 'items_published') {
        const rows = await p.catalogItem.groupBy({ by: ['ownerId'], where: { status: 'PUBLISHED' }, _count: { _all: true } });
        ids = rows.filter((x) => x.ownerId && x._count._all >= (r.count || 1)).map((x) => x.ownerId);
      } else if (r.type === 'purchases_made') {
        const rows = await p.economyPurchase.groupBy({ by: ['userId'], _count: { _all: true } });
        ids = rows.filter((x) => x._count._all >= (r.count || 1)).map((x) => x.userId);
      } else continue; // event-only rules (signup, kofi, polls) have no retroactive form
      if (!ids.length) continue;
      const held = new Set((await p.userBadge.findMany({ where: { badgeId: b.id, userId: { in: ids } }, select: { userId: true } })).map((x) => x.userId));
      const fresh = ids.filter((id) => !held.has(id));
      if (!fresh.length) continue;
      const res = await p.userBadge.createMany({ data: fresh.map((userId) => ({ userId, badgeId: b.id, grantedBy: 'system' })), skipDuplicates: true });
      granted += res.count || 0;
      for (const userId of fresh) emitWebhook(p, userId, 'badge.earned', { id: b.id, slug: b.slug, name: b.name, via: `rule:${r.type}` }).catch(() => {});
    } catch (e) { log?.warn?.({ e: String(e?.message || e), badge: b.slug }, 'badge sweep failed'); }
  }
  return granted;
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
        closedAt: true, moderationUntil: true,
        badges: { include: { badge: true }, orderBy: { badge: { priority: 'desc' } } },
        oauthAccounts: { select: { provider: true, username: true } },
        discordLinks: { select: { username: true } },
        creatorLinks: { select: { creatorId: true, displayName: true } },
        socialConnections: { select: { provider: true, handle: true, url: true } },
      },
    });
    // A banned account and an account that never existed both answered `not_found`, so the
    // page said "nothing here" for three different situations and the reader could not tell
    // which. The STATE is reported; the reason never is — publishing why somebody was
    // sanctioned is a separate decision from saying that they were.
    if (!u) return { error: 'gone', code: 410 };
    if (u.closedAt) return { error: 'closed', code: 410, closedAt: u.closedAt };
    if (u.status === 'banned') {
      // Permanent and temporary are not the same statement about a person. A date still in
      // the future is a suspension that lifts itself; only a ban with no end is named as one.
      const temporary = u.moderationUntil && new Date(u.moderationUntil) > new Date();
      return temporary
        ? { error: 'suspended', code: 403, until: u.moderationUntil }
        : { error: 'banned', code: 403 };
    }
    const isSelf = viewer?.uid === u.id;
    const isStaff = STAFF.includes(viewer?.role);
    if (!u.profilePublic && !isSelf && !isStaff) return { error: 'private_profile', code: 403 };

    // Public content owned by this user.
    const [repos, catalogs, eco] = await Promise.all([
      p.serverRepo.findMany({ where: { ownerId: u.id, listed: true, verified: true, pendingReview: false }, select: { id: true, name: true, description: true, _count: { select: { favorites: true } } }, take: 30, orderBy: { createdAt: 'desc' } }),
      p.communityCatalog.findMany({ where: { ownerId: u.id, status: 'ACTIVE', visibility: 'public', listed: true }, select: { slug: true, name: true, downloads: true, _count: { select: { items: true } } }, take: 30, orderBy: { createdAt: 'desc' } }),
      p.userEconomy.findUnique({ where: { userId: u.id } }).catch(() => null),
    ]);
    // The Discord level is always public; the activity stats follow the member's own toggle
    // (null = the community default, which is public). Only surfaced once they've earned a level.
    const economy = (eco && (eco.level > 0 || eco.xp > 0))
      ? { level: eco.level, xp: eco.xp, ...(eco.statsPublic !== false ? { voiceSeconds: eco.voiceSeconds, messages: eco.messages, reactions: eco.reactions } : {}) }
      : null;

    // Only the connections the owner chose to surface (never emails).
    const show = new Set(u.showConnections || []);
    const gh = u.oauthAccounts.find((a) => a.provider === 'github');
    const social = Object.fromEntries((u.socialConnections || []).map((c) => [c.provider, c]));
    const connections = {};
    // github can come from a dedicated social connection or the login OAuth account.
    if (show.has('github') && (social.github || gh?.username)) connections.github = social.github ? { handle: social.github.handle, url: social.github.url } : { handle: gh.username, url: `https://github.com/${gh.username}` };
    // Discord: the bot's roster link when there is one, else the Discord linked as a sign-in
    // method. Either proves the identity; the second is all a member has when the roster link
    // for that Discord id is held elsewhere or was never made.
    const dc = u.discordLinks[0]?.username || u.oauthAccounts.find((a) => a.provider === 'discord')?.username;
    if (show.has('discord') && dc) connections.discord = dc;
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
        economy,
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
    // The extra fields travel with the error: the page says "closed on <date>" or "suspended
    // until <date>", which is the difference between an answer and a shrug.
    if (r.error) return reply.code(r.code).send({ error: r.error, closedAt: r.closedAt, until: r.until });
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
    // A BMM creator id resolves to the account it is linked to.
    //
    // This is what lets a Server Repo name its author as a person: the manifest carries the
    // signing creator id, and until now nothing PUBLIC could turn that into a profile — the
    // two existing lookups are behind requireRole() and requireCap(). So a repo published by
    // a linked BMM showed a bare identifier that led nowhere.
    //
    // It grants no new visibility: the filter below still requires profilePublic, still
    // excludes banned and closed accounts, and an unlinked creator id simply matches nothing.
    const byCreator = await p.creatorLink.findMany({ where: { creatorId: q }, select: { userId: true } });
    for (const c of byCreator) owners.add(c.userId);
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
        // A closed account is not a person you can find. Its page already answers "closed on
        // <date>" for anyone holding the old link, but listing it in a search offers it as
        // somebody to look at — and the row only still exists because closing anonymises in
        // place rather than deleting (payments and the audit chain point at it).
        //
        // A closure that is merely SCHEDULED is not this: the person still has a month to call
        // it off, and vanishing from search the moment they ask would be the app deciding for
        // them. Only `closedAt` — the day it actually happened — hides them.
        closedAt: null,
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
    emitWebhook(p, req.user.uid, 'badge.earned', { id: badge.id, slug: badge.slug, name: badge.name, via: 'easter_egg' }).catch(() => {});
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
    emitWebhook(p, user.id, 'badge.earned', { id: badge.id, slug: badge.slug, name: badge.name, via: 'staff' }).catch(() => {});
    return { ok: true, userId: user.id, displayName: user.displayName };
  });

  app.delete('/admin/badges/:id/holders/:userId', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    await p.userBadge.deleteMany({ where: { badgeId: req.params.id, userId: req.params.userId } });
    return { ok: true };
  });
}
