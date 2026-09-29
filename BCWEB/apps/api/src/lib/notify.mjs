// notify (agent-notify): the notification engine.
//
//   notify({ userIds | audience, kind, title, body, url, dedupeKey, priority, expiresAt })
//
// The contract other modules code against (the moderation engine alerts staff with kind
// `moderation.case`, the blog tells a project's followers about a new post). The older helpers
// in lib.mjs, notify(p, userId, kind, body) and notifyAll(), stay as they are: 80-odd callers
// use them and they write the same Notification rows, so every reader sees both alike.
//
// WHO
//   userIds                     explicit accounts (deduplicated, closed accounts skipped)
//   audience: 'all'             every open account
//   audience: 'role:<ROLE>'     USER | MOD | ADMIN | SUPERADMIN, or STAFF for the three staff tiers
//   audience: 'cap:<cap>'       whoever holds a capability (ADMIN/SUPERADMIN, a direct grant, a
//                               custom role carrying it, MOD for its default ones)
//   audience: 'project:<ref>:followers'   the members following a project (ProjectFollow); the
//                               ref is a project key ("bmm"), `sc:<slug>`, or a bare showcase slug
//
// HOW (the fan-out, and why this shape): one NotificationSend row records the call; one
// Notification row per recipient is written by createMany in chunks of CHUNK. See the comment on
// NotificationSend in schema.prisma for the alternative that was not taken.
//
// IDEMPOTENT on dedupeKey. The send row's key is unique: a repeat finds it and returns
// `deduped: true` when it finished, or RESUMES the fan-out when it did not (a crash half-way),
// and the (sendId, userId) unique index makes the resume write nobody twice.
//
// MUTES are applied at write, exactly like the older helpers: a member who switched a category
// off (User.notifPrefs) gets no row at all. Locked categories (account & security) ignore it.
//
// NEVER THROWS. A notification is a side effect of something else (a moderation case, a post);
// failing it must never fail that. The result says what happened instead.
import crypto from 'node:crypto';
import { db, notifCategory, NOTIF_CATEGORIES, safeNotifHref, CAPABILITIES, insertNotificationRows } from './lib.mjs';
import { projectByRef, projectByTarget, isListable } from './project-target.mjs';

export const CHUNK = 1000;
const ROLES = ['USER', 'MOD', 'ADMIN', 'SUPERADMIN'];
const STAFF = ['MOD', 'ADMIN', 'SUPERADMIN'];
// Mirrors MOD_DEFAULT_CAPS in lib.mjs (not exported there). A MOD holds these without a grant.
const MOD_DEFAULT_CAPS = ['manage_users'];
const KIND_RE = /^[a-z0-9][a-z0-9_.:-]{0,59}$/i;
export const LIMITS = { title: 200, body: 2000, userIds: 50_000, dedupeKey: 200 };

const siteUrl = () => (process.env.SITE_URL || 'http://localhost:5176').replace(/\/$/, '');

/** A link a notification may carry: an in-app path, or an absolute URL on OUR origin (turned
 *  into its path). Anything else is dropped (null), never thrown: a bad link costs the
 *  notification its link, not the notification. */
export function notifLink(url) {
  const v = String(url ?? '').trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) {
    try {
      const u = new URL(v);
      const site = new URL(siteUrl());
      if (u.origin !== site.origin) return null;
      return safeNotifHref(`${u.pathname}${u.search}${u.hash}`);
    } catch { return null; }
  }
  return safeNotifHref(v);
}

/** The text a Notification row carries. The row has ONE text field (every reader, BMM
 *  included, shows `body`), so a title and a body become one line. */
export function composeBody(title, body) {
  const t = String(title || '').trim();
  const b = String(body || '').trim();
  if (!t) return b;
  if (!b) return t;
  return /[.!?:…]$/.test(t) ? `${t} ${b}` : `${t}: ${b}`;
}

/** sha256 over what makes two sends "the same message" (the composer's duplicate guard). */
export function contentHash({ kind, title, body, href, audience }) {
  return crypto.createHash('sha256')
    .update(JSON.stringify([String(kind || ''), String(title || '').trim(), String(body || '').trim(), String(href || ''), String(audience || '')]))
    .digest('hex');
}

/** Parse an audience string. null = not one we understand (the caller gets `bad_audience`). */
export function parseAudience(a) {
  const s = String(a ?? '').trim();
  if (s === 'all') return { type: 'all' };
  let m = /^role:([A-Za-z]+)$/.exec(s);
  if (m) {
    const r = m[1].toUpperCase();
    if (r === 'STAFF') return { type: 'role', roles: STAFF };
    return ROLES.includes(r) ? { type: 'role', roles: [r] } : null;
  }
  m = /^cap:([a-z_]+)$/.exec(s);
  if (m) return CAPABILITIES.includes(m[1]) ? { type: 'cap', cap: m[1] } : null;
  m = /^project:(.+):followers$/.exec(s);
  if (m && m[1].length <= 90) return { type: 'project', ref: m[1] };
  return null;
}

/** The project a `project:<ref>:followers` audience names, tolerant of a bare showcase slug. */
export async function resolveProjectRef(p, ref) {
  return (await projectByRef(p, ref)) || (!ref.startsWith('sc:') ? await projectByRef(p, `sc:${ref}`) : null);
}

const OPEN = { closedAt: null };

/** Pages of recipients ({ id, notifPrefs }), CHUNK at a time, in id order. */
async function* recipientPages(p, spec) {
  if (spec.type === 'users') {
    for (let i = 0; i < spec.ids.length; i += CHUNK) {
      const ids = spec.ids.slice(i, i + CHUNK);
      const rows = await p.user.findMany({ where: { id: { in: ids }, ...OPEN }, select: { id: true, notifPrefs: true } });
      if (rows.length) yield rows;
    }
    return;
  }
  if (spec.type === 'project') {
    let cursor = null;
    for (;;) {
      const follows = await p.projectFollow.findMany({
        where: { target: spec.target }, orderBy: { id: 'asc' }, take: CHUNK,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, userId: true },
      });
      if (!follows.length) return;
      cursor = follows[follows.length - 1].id;
      const rows = await p.user.findMany({ where: { id: { in: follows.map((f) => f.userId) }, ...OPEN }, select: { id: true, notifPrefs: true } });
      if (rows.length) yield rows;
      if (follows.length < CHUNK) return;
    }
  }
  let where = { ...OPEN };
  if (spec.type === 'role') where = { ...OPEN, role: { in: spec.roles } };
  if (spec.type === 'cap') {
    const roles = await p.customRole.findMany({ where: { capabilities: { has: spec.cap } }, select: { id: true } }).catch(() => []);
    const or = [{ role: { in: ['ADMIN', 'SUPERADMIN'] } }, { permissions: { has: spec.cap } }];
    if (roles.length) or.push({ customRoleIds: { hasSome: roles.map((r) => r.id) } });
    if (MOD_DEFAULT_CAPS.includes(spec.cap)) or.push({ role: 'MOD' });
    where = { ...OPEN, OR: or };
  }
  let cursor = null;
  for (;;) {
    const rows = await p.user.findMany({
      where, orderBy: { id: 'asc' }, take: CHUNK,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, notifPrefs: true },
    });
    if (!rows.length) return;
    yield rows;
    cursor = rows[rows.length - 1].id;
    if (rows.length < CHUNK) return;
  }
}

/** Turn the caller's targeting into a spec, or an error code. */
async function targetSpec(p, input) {
  const hasIds = Array.isArray(input.userIds);
  const hasAud = input.audience != null && input.audience !== '';
  if (hasIds === hasAud) return { error: 'target_required' }; // exactly one of the two
  if (hasIds) {
    const ids = [...new Set(input.userIds.filter((x) => typeof x === 'string' && x && x.length <= 64))];
    if (ids.length > LIMITS.userIds) return { error: 'too_many_users' };
    return { spec: { type: 'users', ids }, audience: `users:${ids.length}` };
  }
  const a = parseAudience(input.audience);
  if (!a) return { error: 'bad_audience' };
  if (a.type === 'project') {
    const proj = await resolveProjectRef(p, a.ref);
    if (!proj) return { error: 'unknown_project' };
    return { spec: { type: 'project', target: proj.target }, audience: `project:${proj.ref}:followers`, project: proj };
  }
  return { spec: a, audience: String(input.audience).trim() };
}

/** Is this recipient muted for the kind? Locked categories never are. */
function mutedFor(kind) {
  const cat = notifCategory(kind);
  const locked = !!NOTIF_CATEGORIES[cat]?.locked;
  return { cat, locked, muted: (u) => !locked && !!(u.notifPrefs && u.notifPrefs[cat] === false) };
}

/** Validate + normalise the message itself. */
function message(input) {
  const kind = String(input.kind || '').trim();
  if (!KIND_RE.test(kind)) return { error: 'bad_kind' };
  const title = String(input.title ?? '').trim().slice(0, LIMITS.title);
  const body = String(input.body ?? '').trim().slice(0, LIMITS.body);
  if (!title && !body) return { error: 'empty' };
  const titleFr = input.titleFr ? String(input.titleFr).trim().slice(0, LIMITS.title) || null : null;
  const bodyFr = input.bodyFr ? String(input.bodyFr).trim().slice(0, LIMITS.body) || null : null;
  let expiresAt = null;
  if (input.expiresAt != null && input.expiresAt !== '') {
    const d = input.expiresAt instanceof Date ? input.expiresAt : new Date(input.expiresAt);
    if (Number.isNaN(d.getTime())) return { error: 'bad_expiry' };
    if (d.getTime() <= Date.now()) return { error: 'already_expired' };
    expiresAt = d;
  }
  // A number (0 normal, 1 high, 2 urgent) or its name; anything else is normal.
  const named = { low: 0, normal: 0, high: 1, urgent: 2 }[String(input.priority ?? '').toLowerCase()];
  const pr = named ?? Number(input.priority);
  const priority = Number.isFinite(pr) ? Math.max(0, Math.min(2, Math.trunc(pr))) : 0;
  const dedupeKey = input.dedupeKey != null && input.dedupeKey !== '' ? String(input.dedupeKey).slice(0, LIMITS.dedupeKey) : null;
  return { kind, title, body, titleFr, bodyFr, href: notifLink(input.url ?? input.href), expiresAt, priority, dedupeKey };
}

/** How many a send would reach, after mutes — the composer's preview. Writes nothing. */
export async function countAudience(input, { p: pIn } = {}) {
  const p = pIn || await db();
  const t = await targetSpec(p, input);
  if (t.error) return { ok: false, error: t.error };
  const { cat, locked, muted } = mutedFor(String(input.kind || ''));
  let targeted = 0; let mutedN = 0;
  for await (const page of recipientPages(p, t.spec)) {
    targeted += page.length;
    mutedN += page.filter(muted).length;
  }
  return { ok: true, audience: t.audience, category: cat, locked, targeted, muted: mutedN, recipients: targeted - mutedN };
}

/** The ids an audience resolves to BEFORE mutes, capped. What the tests use to check targeting
 *  without writing a notification to every account of a shared database. */
export async function listRecipients(input, { p: pIn, max = 100_000 } = {}) {
  const p = pIn || await db();
  const t = await targetSpec(p, input);
  if (t.error) return { ok: false, error: t.error };
  const ids = [];
  for await (const page of recipientPages(p, t.spec)) {
    for (const u of page) { if (ids.length >= max) return { ok: true, ids, truncated: true }; ids.push(u.id); }
  }
  return { ok: true, ids, truncated: false };
}

async function insertChunk(p, rows) {
  // Race-free against an account erased mid-fan-out (see insertNotificationRows in lib.mjs);
  // skipDuplicates keeps a resumed send from writing anybody twice.
  return insertNotificationRows(p, rows, { skipDuplicates: true });
}

/**
 * Send a notification. See the top of this file.
 *
 * Extra, optional fields beyond the contract: titleFr, bodyFr (French versions), public (list it
 * in the public RSS feed), createdById (who sent it, for the admin history).
 *
 * Returns { ok: true, sendId, deduped, targeted, delivered, muted } or { ok: false, error }.
 */
export async function notify(input = {}, { p: pIn } = {}) {
  try {
    const p = pIn || await db();
    const msg = message(input || {});
    if (msg.error) return { ok: false, error: msg.error };
    const t = await targetSpec(p, input || {});
    if (t.error) return { ok: false, error: t.error };

    let send = msg.dedupeKey ? await p.notificationSend.findUnique({ where: { dedupeKey: msg.dedupeKey } }) : null;
    if (send && send.status === 'done') {
      return { ok: true, deduped: true, sendId: send.id, targeted: send.targeted, delivered: send.delivered, muted: send.muted };
    }
    if (!send) {
      const data = {
        dedupeKey: msg.dedupeKey, kind: msg.kind, title: msg.title || msg.body.slice(0, LIMITS.title), titleFr: msg.titleFr,
        body: msg.body, bodyFr: msg.bodyFr, href: msg.href, audience: t.audience, priority: msg.priority,
        expiresAt: msg.expiresAt, public: input.public === true,
        contentHash: contentHash({ kind: msg.kind, title: msg.title, body: msg.body, href: msg.href, audience: t.audience }),
        createdById: typeof input.createdById === 'string' ? input.createdById : null,
      };
      try { send = await p.notificationSend.create({ data }); }
      catch (e) {
        // Two callers raced on the same key: the other one created the row. Carry on with it —
        // both fan-outs insert with skipDuplicates, so the race costs nobody a duplicate.
        if (e?.code !== 'P2002' || !msg.dedupeKey) throw e;
        send = await p.notificationSend.findUnique({ where: { dedupeKey: msg.dedupeKey } });
        if (!send) throw e;
        if (send.status === 'done') return { ok: true, deduped: true, sendId: send.id, targeted: send.targeted, delivered: send.delivered, muted: send.muted };
      }
    }

    const en = composeBody(msg.title, msg.body);
    const fr = (msg.titleFr || msg.bodyFr) ? composeBody(msg.titleFr || msg.title, msg.bodyFr || msg.body) : null;
    const { muted } = mutedFor(msg.kind);
    let targeted = 0; let mutedN = 0;
    for await (const page of recipientPages(p, t.spec)) {
      targeted += page.length;
      const keep = page.filter((u) => !muted(u));
      mutedN += page.length - keep.length;
      if (!keep.length) continue;
      await insertChunk(p, keep.map((u) => ({
        userId: u.id, kind: msg.kind, body: en, ...(fr ? { bodyFr: fr } : {}), ...(msg.href ? { href: msg.href } : {}),
        priority: msg.priority, ...(msg.expiresAt ? { expiresAt: msg.expiresAt } : {}), sendId: send.id,
      })));
    }
    // Counted, not summed: a resumed send inserted only what the first run had not.
    const delivered = await p.notification.count({ where: { sendId: send.id } });
    await p.notificationSend.update({ where: { id: send.id }, data: { status: 'done', targeted, delivered, muted: mutedN, finishedAt: new Date() } });
    return { ok: true, deduped: false, sendId: send.id, targeted, delivered, muted: mutedN };
  } catch (e) {
    return { ok: false, error: 'failed', detail: String(e?.message || e).slice(0, 200) };
  }
}

// ── Blog → followers ─────────────────────────────────────────────────────────────────────

export const NOTIFY_CONFIG_KEY = 'notify.config';
export const NOTIFY_CONFIG_DEFAULTS = Object.freeze({ blogFollowers: true });

export async function notifyConfig(p) {
  const row = await p.adminSetting.findUnique({ where: { key: NOTIFY_CONFIG_KEY } }).catch(() => null);
  const v = row?.value && typeof row.value === 'object' ? row.value : {};
  return { ...NOTIFY_CONFIG_DEFAULTS, ...v };
}

/**
 * A post was saved: if it is published, in a public project's blog, and the setting is on,
 * tell the project's followers. Once per post (dedupeKey), so a later edit or an unpublish /
 * republish never re-sends it. Never throws.
 */
export async function notifyFollowersOfPost(p, post) {
  try {
    if (!post || post.status !== 'PUBLISHED') return { ok: true, skipped: 'not_published' };
    // A post back-dated or re-published long after it first went out is not news.
    if (post.publishedAt && Date.now() - new Date(post.publishedAt).getTime() > 7 * 86400e3) return { ok: true, skipped: 'old' };
    const cfg = await notifyConfig(p);
    if (cfg.blogFollowers === false) return { ok: true, skipped: 'disabled' };
    let target = null;
    if (post.projectId) {
      const pr = await p.project.findUnique({ where: { id: post.projectId }, select: { key: true } });
      target = pr?.key || null;
    } else if (post.showcaseProjectId) target = `sc:${post.showcaseProjectId}`;
    if (!target) return { ok: true, skipped: 'no_project' };
    const proj = await projectByTarget(p, target);
    // Only a public page: a follower of an unlisted or private project may no longer be let in.
    if (!isListable(proj)) return { ok: true, skipped: 'not_public' };
    return await notify({
      audience: `project:${proj.ref}:followers`, kind: 'project_post',
      title: `${proj.name}: ${post.title}`.slice(0, LIMITS.title),
      titleFr: post.titleFr ? `${proj.name} : ${post.titleFr}`.slice(0, LIMITS.title) : null,
      body: String(post.excerpt || '').slice(0, 280), bodyFr: post.excerptFr ? String(post.excerptFr).slice(0, 280) : null,
      url: `/blog/${post.slug}`, dedupeKey: `blog-post:${post.id}`,
    }, { p });
  } catch (e) {
    return { ok: false, error: 'failed', detail: String(e?.message || e).slice(0, 200) };
  }
}

// ── Retention ────────────────────────────────────────────────────────────────────────────

/** Expired notifications go; send records older than a year go unless they feed the public
 *  RSS. Called from the sweeper. */
export async function sweepNotifications(p, log) {
  const now = new Date();
  const a = await p.notification.deleteMany({ where: { expiresAt: { lt: now } } }).catch(() => ({ count: 0 }));
  const b = await p.notificationSend.deleteMany({ where: { public: false, createdAt: { lt: new Date(now.getTime() - 365 * 86400e3) } } }).catch(() => ({ count: 0 }));
  if ((a.count || b.count) && log) log.info(`[sweeper] notifications: ${a.count} expired row(s), ${b.count} old send record(s) removed`);
  return { expired: a.count, sends: b.count };
}
// fin notify (agent-notify)
