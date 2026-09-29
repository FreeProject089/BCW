// notify (agent-notify): the routes around lib/notify.mjs.
//
//   PERSONAL FEED   GET/POST/DELETE /me/feed-token      see, rotate, revoke the RSS token
//                   GET /feeds/u/<id>.<secret>.xml|.atom your notifications as RSS 2.0 / Atom
//   PUBLIC FEED     GET /feeds/news.xml|.atom?lang=      public sends + site announcements
//   FOLLOWS         GET/PUT /project-follow/:ref         follow a project's blog
//                   GET /me/follows                      what this account follows
//   ADMIN           /admin/notify/*                      the composer (manage_announcements)
//
// THE FEED URL IS A CREDENTIAL. Anybody holding it reads the account's notifications, so:
//   · only the SHA-256 of the secret is stored, and compared with safeEqual;
//   · the path is redacted in every log line and ErrorEvent row (errorlog.mjs redactPath lists
//     /feeds/u/), because the token is in the PATH and stripping the query string is not enough;
//   · an unknown id, a wrong secret, a closed or banned account all answer the same 404;
//   · the response is `Cache-Control: private` and `Referrer-Policy: no-referrer`, so no shared
//     cache keeps it and no link clicked from a reader leaks it;
//   · it is shown to the member ONCE, when minted. Losing it means rotating it.
import crypto from 'node:crypto';
import { z } from 'zod';
import { db, requireRole, requireCap, optionalAuth, safeEqual, logAudit, clientIp, NOTIF_CATEGORIES } from '../lib/lib.mjs';
import { notify, countAudience, contentHash, notifLink, composeBody, NOTIFY_CONFIG_KEY, notifyConfig, resolveProjectRef } from '../lib/notify.mjs';
import { buildRss, buildAtom, etagOf, notModified, feedLink } from '../lib/feeds.mjs';
import { canSeeProject } from '../lib/project-target.mjs';
import { listPublicProjects } from '../lib/project-ref.mjs';
import { cached, invalidate } from '../lib/cache.mjs';

const siteUrl = () => (process.env.SITE_URL || 'http://localhost:5176').replace(/\/$/, '');
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const FEED_FILE = /^([a-z0-9]{10,40})\.([A-Za-z0-9_-]{32,64})\.(xml|atom)$/;
const FEED_ITEMS = 50;
const NEWS_ITEMS = 30;
const DUPLICATE_WINDOW_MS = 24 * 3600e3;

/** The two URLs of a token, for the member to paste into a reader. */
export function feedUrls(id, secret) {
  const base = `${siteUrl()}/feeds/u/${id}.${secret}`;
  return { rss: `${base}.xml`, atom: `${base}.atom` };
}

/** Mint (or replace) the account's feed token. Returns the id and the raw secret, once. */
export async function rotateFeedToken(p, userId) {
  const secret = crypto.randomBytes(32).toString('base64url'); // 43 chars
  const secretHash = sha256(secret);
  // A new id every rotation, so an old URL cannot match on the id alone either.
  await p.feedToken.deleteMany({ where: { userId } });
  const row = await p.feedToken.create({ data: { userId, secretHash } });
  return { id: row.id, secret };
}

/** The account a feed file name opens, or null. Constant-shape answer for every failure. */
export async function feedOwner(p, file) {
  const m = FEED_FILE.exec(String(file || ''));
  if (!m) return null;
  const row = await p.feedToken.findUnique({ where: { id: m[1] }, include: { user: { select: { id: true, locale: true, closedAt: true, status: true } } } }).catch(() => null);
  // Compared even when there is no row, so a miss and a wrong secret cost the same.
  const ok = safeEqual(sha256(m[2]), row?.secretHash || 'x'.repeat(64));
  if (!row || !ok) return null;
  if (row.user.closedAt || row.user.status === 'banned') return null;
  return { token: row, user: row.user, format: m[3] };
}

const feedHeaders = (reply, format, { personal }) => {
  reply.header('Content-Type', format === 'atom' ? 'application/atom+xml; charset=utf-8' : 'application/rss+xml; charset=utf-8');
  reply.header('Cache-Control', personal ? 'private, max-age=300' : 'public, max-age=300');
  reply.header('X-Content-Type-Options', 'nosniff');
  if (personal) {
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Robots-Tag', 'noindex, nofollow');
  }
};

const pickLang = (q, fallback = 'en') => (String(q || '').toLowerCase().startsWith('fr') ? 'fr' : (q ? 'en' : fallback));

/** The personal feed's items: this account's live notifications, newest first. */
export async function personalItems(p, userId, lang) {
  const now = new Date();
  const rows = await p.notification.findMany({
    where: { userId, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    orderBy: { createdAt: 'desc' }, take: FEED_ITEMS,
    select: { id: true, kind: true, body: true, bodyFr: true, href: true, createdAt: true, send: { select: { title: true, titleFr: true, body: true, bodyFr: true } } },
  });
  const site = siteUrl();
  return rows.map((n) => {
    const fr = lang === 'fr';
    const text = (fr && n.bodyFr) || n.body;
    const title = n.send ? ((fr && n.send.titleFr) || n.send.title) : (text.length > 90 ? `${text.slice(0, 89)}…` : text);
    const description = n.send ? ((fr && n.send.bodyFr) || n.send.body || text) : text;
    return { id: `bcw-notif-${n.id}`, title, description, link: `${site}${n.href || '/notifications'}`, date: n.createdAt, category: n.kind };
  });
}

/** The public feed's items: public sends and active announcements, newest first. */
export async function newsItems(p, lang) {
  const now = new Date();
  const site = siteUrl();
  const [sends, anns] = await Promise.all([
    p.notificationSend.findMany({
      where: { public: true, status: 'done', OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      orderBy: { createdAt: 'desc' }, take: NEWS_ITEMS,
      select: { id: true, kind: true, title: true, titleFr: true, body: true, bodyFr: true, href: true, createdAt: true },
    }),
    p.announcement.findMany({ where: { active: true }, orderBy: { createdAt: 'desc' }, take: NEWS_ITEMS, select: { id: true, title: true, body: true, linkUrl: true, createdAt: true } }),
  ]);
  const fr = lang === 'fr';
  const items = [
    ...sends.map((s) => ({ id: `bcw-send-${s.id}`, title: (fr && s.titleFr) || s.title, description: (fr && s.bodyFr) || s.body, link: `${site}${s.href || '/'}`, date: s.createdAt, category: s.kind })),
    ...anns.map((a) => {
      const l = String(a.linkUrl || '').trim();
      const link = l.startsWith('/') && !l.startsWith('//') ? `${site}${l}` : feedLink(l, `${site}/`);
      return { id: `bcw-announcement-${a.id}`, title: a.title, description: a.body, link, date: a.createdAt, category: 'announcement' };
    }),
  ];
  items.sort((a, b) => new Date(b.date) - new Date(a.date));
  return items.slice(0, NEWS_ITEMS);
}

// ── Admin composer ───────────────────────────────────────────────────────────────────────

const composeSchema = z.object({
  target: z.enum(['users', 'all', 'role', 'project']),
  userIds: z.array(z.string().min(1).max(40)).max(200).optional(),
  role: z.enum(['USER', 'MOD', 'ADMIN', 'SUPERADMIN', 'STAFF']).optional(),
  project: z.string().min(1).max(90).optional(),
  // announce: the mutable "Site news & events" category. admin_notice: account & security,
  // which cannot be muted, so it is only for a message to named accounts.
  kind: z.enum(['announce', 'admin_notice']).default('announce'),
  title: z.string().trim().min(2).max(160),
  titleFr: z.string().trim().max(160).optional().nullable(),
  body: z.string().trim().max(1000).default(''),
  bodyFr: z.string().trim().max(1000).optional().nullable(),
  // An in-app path. Checked by notifLink below: a value that is not one is refused rather
  // than silently dropped, because the admin is looking at the form right now.
  href: z.string().trim().max(300).optional().nullable(),
  priority: z.number().int().min(0).max(2).default(0),
  expiresAt: z.string().datetime().optional().nullable(),
  public: z.boolean().default(false),
});

/** The notify() input a composer body describes, or an error code. */
function composerInput(b) {
  const out = { kind: b.kind, title: b.title, titleFr: b.titleFr || null, body: b.body || '', bodyFr: b.bodyFr || null, priority: b.priority, expiresAt: b.expiresAt || null };
  if (b.href) {
    const h = notifLink(b.href);
    if (!h) return { error: 'bad_link' };
    out.url = h;
  }
  if (b.target === 'users') {
    if (!b.userIds?.length) return { error: 'no_recipients' };
    out.userIds = b.userIds;
  } else {
    if (b.kind === 'admin_notice') return { error: 'notice_needs_users' };
    if (b.target === 'all') out.audience = 'all';
    if (b.target === 'role') { if (!b.role) return { error: 'role_required' }; out.audience = `role:${b.role}`; }
    if (b.target === 'project') { if (!b.project) return { error: 'project_required' }; out.audience = `project:${b.project}:followers`; }
  }
  if (b.public && b.target !== 'all') return { error: 'public_needs_all' };
  out.public = !!b.public;
  return { input: out };
}

/** The audience string a composer body will be stored under, for the duplicate guard. */
async function storedAudience(p, input) {
  if (input.userIds) return `users:${[...new Set(input.userIds)].length}`;
  const m = /^project:(.+):followers$/.exec(input.audience);
  if (m) { const proj = await resolveProjectRef(p, m[1]); return proj ? `project:${proj.ref}:followers` : input.audience; }
  return input.audience;
}

async function findDuplicate(p, input) {
  const hash = contentHash({ kind: input.kind, title: input.title, body: input.body, href: input.url || null, audience: await storedAudience(p, input) });
  return p.notificationSend.findFirst({ where: { contentHash: hash, createdAt: { gt: new Date(Date.now() - DUPLICATE_WINDOW_MS) } }, orderBy: { createdAt: 'desc' }, select: { id: true, createdAt: true, delivered: true } });
}

export default async function notifyRoutes(app) {
  // ── Personal RSS token ──
  app.get('/me/feed-token', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const row = await p.feedToken.findUnique({ where: { userId: req.user.uid }, select: { createdAt: true, lastUsedAt: true } });
    return { active: !!row, createdAt: row?.createdAt || null, lastUsedAt: row?.lastUsedAt || null };
  });

  // Create or rotate. The URL is in THIS response and nowhere else, ever.
  app.post('/me/feed-token', { preHandler: requireRole(), config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) => {
    const p = await db();
    const { id, secret } = await rotateFeedToken(p, req.user.uid);
    reply.header('Cache-Control', 'no-store');
    return { ok: true, ...feedUrls(id, secret) };
  });

  app.delete('/me/feed-token', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const { count } = await p.feedToken.deleteMany({ where: { userId: req.user.uid } });
    return { ok: true, revoked: count > 0 };
  });

  // ── The feeds ──
  app.get('/feeds/u/:file', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const p = await db();
    const owner = await feedOwner(p, req.params.file);
    if (!owner) return reply.code(404).type('text/plain; charset=utf-8').send('Not found');
    const lang = pickLang(req.query?.lang, String(owner.user.locale || '').toLowerCase().startsWith('fr') ? 'fr' : 'en');
    const items = await personalItems(p, owner.user.id, lang);
    const site = siteUrl();
    const ch = {
      title: lang === 'fr' ? 'BetterCommunity : tes notifications' : 'BetterCommunity: your notifications',
      description: lang === 'fr' ? 'Les notifications de ton compte BetterCommunity.' : 'The notifications of your BetterCommunity account.',
      link: `${site}/notifications`, lang, id: `urn:bettercommunity:feed:${owner.token.id}`,
    };
    const text = owner.format === 'atom' ? buildAtom(ch, items) : buildRss(ch, items);
    // Seen in use: at most one write an hour, not one per reader poll.
    if (!owner.token.lastUsedAt || Date.now() - new Date(owner.token.lastUsedAt).getTime() > 3600e3) {
      p.feedToken.update({ where: { id: owner.token.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
    }
    feedHeaders(reply, owner.format, { personal: true });
    if (notModified(req, reply, etagOf(text))) return reply;
    return reply.send(text);
  });

  // Two literal routes rather than a loop: the route maps (lib/rbac-map.mjs) read route paths
  // as string literals, and a path built in a template is a route they cannot see.
  const newsFeed = (format) => async (req, reply) => {
    const lang = pickLang(req.query?.lang);
    const text = await cached(`feed:news:${lang}:${format}`, 60_000, async () => {
      const p = await db();
      const site = siteUrl();
      const ch = {
        title: lang === 'fr' ? 'BetterCommunity : actualités' : 'BetterCommunity news',
        description: lang === 'fr' ? 'Annonces et notifications publiques de BetterCommunity.' : 'Announcements and public notifications from BetterCommunity.',
        link: `${site}/`, lang, selfUrl: `${site}/feeds/news.${format}${lang === 'fr' ? '?lang=fr' : ''}`, id: 'urn:bettercommunity:feed:news',
      };
      const items = await newsItems(p, lang);
      return format === 'atom' ? buildAtom(ch, items) : buildRss(ch, items);
    });
    feedHeaders(reply, format === 'atom' ? 'atom' : 'rss', { personal: false });
    if (notModified(req, reply, etagOf(text))) return reply;
    return reply.send(text);
  };
  app.get('/feeds/news.xml', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, newsFeed('xml'));
  app.get('/feeds/news.atom', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, newsFeed('atom'));

  // ── Following a project ──
  app.get('/project-follow/:ref', { preHandler: optionalAuth() }, async (req, reply) => {
    const p = await db();
    const proj = await resolveProjectRef(p, String(req.params.ref || ''));
    if (!proj || !(await canSeeProject(p, proj, req))) return reply.code(404).send({ error: 'not_found' });
    const [followers, mine] = await Promise.all([
      p.projectFollow.count({ where: { target: proj.target } }),
      req.user?.uid ? p.projectFollow.findUnique({ where: { userId_target: { userId: req.user.uid, target: proj.target } }, select: { id: true } }) : null,
    ]);
    return { ref: proj.ref, following: !!mine, followers };
  });

  app.put('/project-follow/:ref', { preHandler: requireRole(), config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = z.object({ follow: z.boolean() }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const proj = await resolveProjectRef(p, String(req.params.ref || ''));
    if (!proj || !(await canSeeProject(p, proj, req))) return reply.code(404).send({ error: 'not_found' });
    if (b.data.follow) {
      await p.projectFollow.upsert({ where: { userId_target: { userId: req.user.uid, target: proj.target } }, create: { userId: req.user.uid, target: proj.target }, update: {} });
    } else {
      await p.projectFollow.deleteMany({ where: { userId: req.user.uid, target: proj.target } });
    }
    const followers = await p.projectFollow.count({ where: { target: proj.target } });
    return { ok: true, ref: proj.ref, following: b.data.follow, followers };
  });

  app.get('/me/follows', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const rows = await p.projectFollow.findMany({ where: { userId: req.user.uid }, orderBy: { createdAt: 'desc' }, select: { target: true, createdAt: true } });
    const { projectsByTargets } = await import('../lib/project-target.mjs');
    const byTarget = await projectsByTargets(p, rows.map((r) => r.target));
    return {
      follows: rows.map((r) => {
        const proj = byTarget.get(r.target);
        return proj ? { ref: proj.ref, name: proj.name, url: proj.url, since: r.createdAt } : null;
      }).filter(Boolean),
    };
  });

  // ── Admin composer ──
  const ADMIN = requireCap('manage_announcements');

  app.get('/admin/notify/meta', { preHandler: ADMIN }, async () => {
    const p = await db();
    const [projects, counts, cfg] = await Promise.all([
      listPublicProjects(p),
      p.projectFollow.groupBy({ by: ['target'], _count: { _all: true } }).catch(() => []),
      notifyConfig(p),
    ]);
    const byTarget = Object.fromEntries(counts.map((c) => [c.target, c._count._all]));
    // A ref and a target differ for an Other project (slug vs id); resolve the ones that do.
    const withCounts = await Promise.all(projects.map(async (pr) => {
      const r = pr.official ? { target: pr.ref } : await resolveProjectRef(p, pr.ref);
      return { ...pr, followers: byTarget[r?.target] || 0 };
    }));
    return {
      projects: withCounts,
      roles: ['USER', 'MOD', 'ADMIN', 'SUPERADMIN', 'STAFF'],
      categories: Object.entries(NOTIF_CATEGORIES).map(([key, d]) => ({ key, label: d.label, locked: !!d.locked })),
      config: cfg,
      limits: { title: 160, body: 1000 },
    };
  });

  app.put('/admin/notify/config', { preHandler: ADMIN }, async (req, reply) => {
    const b = z.object({ blogFollowers: z.boolean() }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const next = { ...(await notifyConfig(p)), ...b.data };
    await p.adminSetting.upsert({ where: { key: NOTIFY_CONFIG_KEY }, create: { key: NOTIFY_CONFIG_KEY, value: next }, update: { value: next } });
    await logAudit(p, req.user.uid, 'notify.config', `blogFollowers=${next.blogFollowers}`, clientIp(req));
    return { ok: true, config: next };
  });

  // What a send would do: who it reaches after mutes, the text each language gets, and whether
  // the exact same message already went out in the last day. Writes nothing.
  app.post('/admin/notify/preview', { preHandler: ADMIN, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = composeSchema.safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input', details: b.error.flatten() });
    const c = composerInput(b.data);
    if (c.error) return reply.code(400).send({ error: c.error });
    const p = await db();
    const count = await countAudience(c.input, { p });
    if (!count.ok) return reply.code(400).send({ error: count.error });
    const dup = await findDuplicate(p, c.input);
    return {
      ...count,
      text: { en: composeBody(c.input.title, c.input.body), fr: (c.input.titleFr || c.input.bodyFr) ? composeBody(c.input.titleFr || c.input.title, c.input.bodyFr || c.input.body) : null },
      href: c.input.url || null,
      duplicate: dup ? { sendId: dup.id, at: dup.createdAt, delivered: dup.delivered } : null,
    };
  });

  // Send. `requestId` (minted by the form when it opens) is the dedupe key, so a double click
  // or a retried request sends once. The same CONTENT to the same audience inside a day is
  // refused unless `force`: the composer says so and the admin decides.
  app.post('/admin/notify/send', { preHandler: ADMIN, config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const extra = z.object({ requestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/), force: z.boolean().default(false) }).safeParse(req.body || {});
    const b = composeSchema.safeParse(req.body || {});
    if (!b.success || !extra.success) return reply.code(400).send({ error: 'invalid_input' });
    const c = composerInput(b.data);
    if (c.error) return reply.code(400).send({ error: c.error });
    const p = await db();
    const dedupeKey = `admin:${req.user.uid}:${extra.data.requestId}`;
    const already = await p.notificationSend.findUnique({ where: { dedupeKey }, select: { id: true } });
    if (!already && !extra.data.force) {
      const dup = await findDuplicate(p, c.input);
      if (dup) return reply.code(409).send({ error: 'duplicate_content', sendId: dup.id, at: dup.createdAt });
    }
    const r = await notify({ ...c.input, dedupeKey, createdById: req.user.uid }, { p });
    if (!r.ok) return reply.code(r.error === 'failed' ? 500 : 400).send({ error: r.error });
    if (!r.deduped) {
      await logAudit(p, req.user.uid, 'notify.sent', `${b.data.target}${b.data.role ? `:${b.data.role}` : ''}${b.data.project ? `:${b.data.project}` : ''} kind=${b.data.kind} delivered=${r.delivered} muted=${r.muted}${b.data.public ? ' public' : ''} "${b.data.title.slice(0, 80)}"`, clientIp(req));
      if (b.data.public) { for (const l of ['en', 'fr']) for (const f of ['xml', 'atom']) invalidate(`feed:news:${l}:${f}`); }
    }
    return reply.code(r.deduped ? 200 : 201).send(r);
  });

  app.get('/admin/notify/history', { preHandler: ADMIN }, async () => {
    const p = await db();
    const rows = await p.notificationSend.findMany({
      orderBy: { createdAt: 'desc' }, take: 50,
      select: { id: true, kind: true, title: true, audience: true, priority: true, public: true, status: true, targeted: true, delivered: true, muted: true, createdById: true, createdAt: true, expiresAt: true },
    });
    const ids = [...new Set(rows.map((r) => r.createdById).filter(Boolean))];
    const users = ids.length ? await p.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } }) : [];
    const name = Object.fromEntries(users.map((u) => [u.id, u.displayName]));
    return { sends: rows.map((r) => ({ ...r, createdBy: r.createdById ? (name[r.createdById] || null) : null })) };
  });
}

// fin notify (agent-notify)
