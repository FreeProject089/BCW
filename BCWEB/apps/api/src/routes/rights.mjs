// Rights notices — the notice as a record, the queue that handles it, and the registry that
// keeps a work from coming back.
//
// A rights-holder notice used to arrive as a contact message of kind "copyright": free text, no
// target, no work, nothing to act on except by hand. This is the route the legal page promised
// — "one route, one queue, read by a person" — built out:
//
//   public   POST /rights/notice        the form (no account needed; PoW; every DSA element)
//            GET  /rights/resolve?q=    turn a pasted link or id into a precise target with
//                                       its files or items, so the sender can point at THE
//                                       file rather than "somewhere in this repo"
//            GET  /rights/notice/:code  follow-up without an account (code + e-mail)
//   account  GET  /me/rights            the sender's own notices
//   staff    /admin/rights/*            the queue: review, take down (as narrowly as the
//                                       claim), reject, counter-notice, restore, and the
//                                       repeat-infringer count per account
//            /admin/rights/works/*      the protected-works registry, and a scan over
//                                       everything already hosted
//
// DETECTION. Every file that lands (registerRepoFile) and every catalogue item that is
// validated is matched against the active works — by hash first, by name pattern, by source
// URL — and a hit opens a `match` notice in the same queue, before anyone has to complain a
// second time. That is the Swiss CopA 39d obligation as code, and the nearest honest thing a
// self-hosted service can do to what YouTube's Content ID or Meta's Rights Manager do for
// theirs: those are their platforms' internal fingerprint systems, not APIs this site could
// plug into.
import { z } from 'zod';
import crypto from 'node:crypto';
import { db, requireRole, requireCap, optionalAuth, notify, logAudit, clientIp } from '../lib/lib.mjs';
import { sendMail, mailShell, emailEnabled, escapeHtml } from '../lib/mail.mjs';
import { powVerify } from './auth.mjs';
import { userBcId, looksLikeBcId, findUserIdByBcId } from '../lib/repofingerprint.mjs';
import {
  normalizeNotice, normalizeWork, matchWorks, strikeStatus, noticeCode,
  NOTICE_KINDS, NOTICE_STATUSES,
} from '../lib/rights-match.mjs';

const SITE_URL = (process.env.SITE_URL || 'https://bettercommunity.ch').replace(/\/+$/, '');
const STAFF = { in: ['MOD', 'ADMIN', 'SUPERADMIN'] };

const DEFAULT_CFG = {
  // Repeat infringer: notices ACTIONED against one account's content inside the window.
  strikeThreshold: 3, strikeWindowDays: 365,
  // How long the person whose content came down has to counter before a takedown is final.
  counterDays: 14,
  // Whether the registry matches on every upload (hash, pattern, URL) or only when asked.
  autoMatch: true,
};
export async function rightsConfig(p) {
  const row = await p.adminSetting.findUnique({ where: { key: 'rights.config' } }).catch(() => null);
  return { ...DEFAULT_CFG, ...(row?.value || {}) };
}

async function newCode(p) {
  for (let i = 0; i < 6; i++) {
    const code = noticeCode(crypto.randomBytes(8));
    if (!(await p.rightsNotice.findUnique({ where: { code }, select: { id: true } }))) return code;
  }
  throw new Error('code space exhausted');
}

// ── resolving a target ─────────────────────────────────────────────────────────────────
/**
 * A pasted address or id → the thing it names, with enough inside it to point precisely.
 *
 *   /r/<id> · /repo/<id>           a server repo, with its files
 *   /c/<slug>                      a community catalogue, with its items
 *   /item/<slug-or-id>             one catalogue item
 *   /u/<id> · BC-XXXX-XXXX         an account
 *   anything else that is a URL    a bare URL target
 */
export async function resolveTarget(p, q) {
  const raw = String(q || '').trim();
  if (!raw) return null;
  let path = raw;
  try { if (/^https?:\/\//i.test(raw)) path = new URL(raw).pathname; } catch { /* not a URL */ }
  const m = (re) => { const x = re.exec(path); return x ? decodeURIComponent(x[1]) : null; };
  const repoId = m(/^\/(?:r|repo)\/([^/?#]+)/) || (/^c[a-z0-9]{20,}$/.test(raw) ? raw : null);
  if (repoId) {
    const r = await p.serverRepo.findUnique({ where: { id: repoId }, select: { id: true, name: true, ownerId: true, status: true, files: { select: { path: true, size: true, sha256: true }, orderBy: { path: 'asc' }, take: 500 } } }).catch(() => null);
    if (r) return { type: 'repo', id: r.id, label: r.name, url: `${SITE_URL}/r/${r.id}`, ownerId: r.ownerId, status: r.status, files: r.files.map((f) => ({ path: f.path, size: Number(f.size || 0), sha256: f.sha256 || null })) };
  }
  const slug = m(/^\/c\/([^/?#]+)/);
  if (slug) {
    const c = await p.communityCatalog.findFirst({ where: { OR: [{ slug }, { id: slug }] }, select: { id: true, slug: true, name: true, ownerId: true, items: { select: { id: true, name: true, slug: true }, take: 500 } } }).catch(() => null);
    if (c) return { type: 'catalog', id: c.slug || c.id, label: c.name, url: `${SITE_URL}/c/${c.slug || c.id}`, ownerId: c.ownerId, items: c.items.map((i) => ({ id: i.id, name: i.name, slug: i.slug })) };
  }
  const itemRef = m(/^\/item\/([^/?#]+)/);
  if (itemRef) {
    const it = await p.catalogItem.findFirst({ where: { OR: [{ slug: itemRef }, { id: itemRef }] }, select: { id: true, name: true, slug: true, ownerId: true } }).catch(() => null);
    if (it) return { type: 'item', id: it.id, label: it.name, url: `${SITE_URL}/item/${it.slug || it.id}`, ownerId: it.ownerId };
  }
  const uid = m(/^\/u\/([^/?#]+)/);
  if (uid) {
    const u = await p.user.findUnique({ where: { id: uid }, select: { id: true, displayName: true } }).catch(() => null);
    if (u) return { type: 'user', id: u.id, label: u.displayName, url: `${SITE_URL}/u/${u.id}`, ownerId: u.id };
  }
  if (looksLikeBcId(raw)) {
    const id = await findUserIdByBcId(p, raw).catch(() => null);
    if (id) { const u = await p.user.findUnique({ where: { id }, select: { id: true, displayName: true } }); if (u) return { type: 'user', id: u.id, label: u.displayName, url: `${SITE_URL}/u/${u.id}`, ownerId: u.id }; }
  }
  if (/^https?:\/\//i.test(raw)) return { type: 'url', id: '', label: raw, url: raw };
  return null;
}

/** The accounts answerable for a notice's targets — what strikes are counted over. */
async function ownersOf(p, targets) {
  const out = new Set();
  for (const t of targets) {
    if (t.type === 'user' && t.id) { out.add(t.id); continue; }
    if (t.type === 'repo') { const r = await p.serverRepo.findUnique({ where: { id: t.id }, select: { ownerId: true } }).catch(() => null); if (r) out.add(r.ownerId); }
    if (t.type === 'catalog') { const c = await p.communityCatalog.findFirst({ where: { OR: [{ slug: t.id }, { id: t.id }] }, select: { ownerId: true } }).catch(() => null); if (c) out.add(c.ownerId); }
    if (t.type === 'item') { const i = await p.catalogItem.findUnique({ where: { id: t.id }, select: { ownerId: true } }).catch(() => null); if (i) out.add(i.ownerId); }
  }
  return [...out];
}

// ── mail ───────────────────────────────────────────────────────────────────────────────
async function mailNotice(to, subject, lines, code, mailId) {
  if (!emailEnabled() || !to) return;
  const html = lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('');
  const cta = { label: 'Follow your notice', url: `${SITE_URL}/report?code=${encodeURIComponent(code)}` };
  await sendMail({ to, mailId, subject, html: mailShell(subject, html, cta, { mailId }), text: `${lines.join('\n\n')}\n\n${cta.url}` }).catch(() => {});
}

// ── detection ──────────────────────────────────────────────────────────────────────────
let worksCache = { at: 0, list: [] };
async function activeWorks(p) {
  if (Date.now() - worksCache.at < 60_000) return worksCache.list;
  const list = await p.protectedWork.findMany({ where: { active: true } }).catch(() => []);
  worksCache = { at: Date.now(), list };
  return list;
}
export function invalidateWorks() { worksCache = { at: 0, list: [] }; }

/**
 * Best-effort, never throws, never blocks the upload it rides on: match one thing against
 * the registry and open a `match` notice for each work that fired — unless one is already
 * open for that work and that target, because a thousand-file repo must not raise a thousand
 * rows for the same work.
 */
export async function flagIfProtected(p, thing, target) {
  try {
    const cfg = await rightsConfig(p);
    if (cfg.autoMatch === false) return [];
    const hits = matchWorks(thing, await activeWorks(p));
    const made = [];
    for (const h of hits) {
      const open = await p.rightsNotice.findFirst({ where: { kind: 'match', workId: h.work.id, status: { in: ['new', 'reviewing'] }, targets: { path: ['0', 'id'], equals: target.id } }, select: { id: true } }).catch(() => null);
      if (open) continue;
      const owners = target.ownerId ? [target.ownerId] : [];
      const n = await p.rightsNotice.create({ data: {
        code: await newCode(p), kind: 'match', status: 'new', workId: h.work.id, matchVia: h.via,
        name: 'Protected-works registry', email: '', explanation: `Matched "${h.work.title}" by ${h.via}: ${h.detail}`,
        targets: [{ type: target.type, id: target.id, label: target.label || '', url: target.url || '', files: thing.path ? [thing.path] : [], note: h.detail }],
        work: { title: h.work.title, urls: h.work.urls, basis: 'owner', hashes: thing.sha256 ? [thing.sha256] : [] },
        ownerIds: owners, goodFaith: true, accurate: true, signature: 'registry',
      } });
      await p.protectedWork.update({ where: { id: h.work.id }, data: { hits: { increment: 1 } } }).catch(() => {});
      made.push(n);
    }
    if (made.length) {
      const staff = await p.user.findMany({ where: { OR: [{ role: STAFF }, { permissions: { has: 'manage_reports' } }] }, select: { id: true } });
      for (const s of staff) notify(p, s.id, 'rights_match', `The protected-works registry matched ${made.length} thing(s) — ${made[0].code}.`).catch(() => {});
    }
    return made;
  } catch { return []; }
}

const pub = (n) => ({
  id: n.id, code: n.code, kind: n.kind, status: n.status, targets: n.targets, work: n.work,
  explanation: n.explanation, decision: n.decision, decisionAt: n.decisionAt, restoredAt: n.restoredAt,
  createdAt: n.createdAt, updatedAt: n.updatedAt, counter: n.counter ? { at: n.counter.at } : null,
});
const staffView = (n) => ({
  ...pub(n), name: n.name, email: n.email, org: n.org, onBehalfOf: n.onBehalfOf, address: n.address, country: n.country, phone: n.phone,
  goodFaith: n.goodFaith, accurate: n.accurate, signature: n.signature, ip: n.ip, reporterId: n.reporterId,
  reviewedById: n.reviewedById, internalNote: n.internalNote, sanctionIds: n.sanctionIds, ownerIds: n.ownerIds, counter: n.counter,
  workId: n.workId, matchVia: n.matchVia, work_: n.work_ ? { id: n.work_.id, title: n.work_.title } : null,
  reporter: n.reporter ? { id: n.reporter.id, displayName: n.reporter.displayName } : null,
});

// The body PUT /admin/rights/config validates. Module-level and exported so the config import (lib/config-transfer.mjs) checks a seed with this schema rather than a copy of it.
export const RIGHTS_CONFIG_BODY = z.object({ strikeThreshold: z.number().int().min(1).max(50), strikeWindowDays: z.number().int().min(1).max(3650), counterDays: z.number().int().min(1).max(90), autoMatch: z.boolean() }).partial();

export default async function rightsRoutes(app) {
  // ── public ───────────────────────────────────────────────────────────────────────────
  app.get('/rights/resolve', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const t = await resolveTarget(await db(), req.query?.q);
    if (!t) return reply.code(404).send({ error: 'not_found' });
    // What a sender is shown: no owner ids. They can point at files; they do not learn who.
    const { ownerId, ...rest } = t;
    return { target: rest };
  });

  app.post('/rights/notice', { preHandler: optionalAuth(), config: { rateLimit: { max: 6, timeWindow: '10 minutes' } } }, async (req, reply) => {
    if (!powVerify(req.body?.pow)) return reply.code(400).send({ error: 'pow_required' });
    const n = normalizeNotice(req.body);
    if (n.error) return reply.code(400).send({ error: n.error, pattern: n.pattern });
    const p = await db();
    const ip = String(clientIp(req) || '').slice(0, 64);
    const since = new Date(Date.now() - 864e5);
    const daily = await p.rightsNotice.count({ where: { createdAt: { gte: since }, OR: [{ ip }, { email: n.email }] } });
    if (daily >= 5) return reply.code(429).send({ error: 'daily_limit' });
    const ownerIds = await ownersOf(p, n.targets);
    // You cannot notice your own content into a takedown, and a notice against yourself is
    // a support request wearing a legal form.
    if (req.user?.uid && ownerIds.length && ownerIds.every((o) => o === req.user.uid)) return reply.code(400).send({ error: 'own_content' });
    const row = await p.rightsNotice.create({ data: {
      code: await newCode(p), kind: n.kind, status: 'new', reporterId: req.user?.uid || null,
      name: n.name, email: n.email, org: n.org, onBehalfOf: n.onBehalfOf, address: n.address, country: n.country, phone: n.phone,
      targets: n.targets, work: n.work, explanation: n.explanation,
      goodFaith: n.goodFaith, accurate: n.accurate, signature: n.signature, ip, ownerIds,
    } });
    const staff = await p.user.findMany({ where: { OR: [{ role: STAFF }, { permissions: { has: 'manage_reports' } }] }, select: { id: true } });
    for (const s of staff) notify(p, s.id, 'rights_notice', `A ${n.kind} notice arrived — ${row.code} (${n.targets.length} target(s)).`).catch(() => {});
    // The doorbell on Discord, opt-in, without the body — a notice names its sender.
    const bot = (await p.adminSetting.findUnique({ where: { key: 'bot.config' } }))?.value || {};
    const channelId = String(bot?.announce?.channels?.legal || '').trim();
    if (channelId) await p.botAnnouncement.create({ data: { kind: 'legal', channelId, urgent: true, title: 'Rights notice', body: `${row.code} — ${n.kind}, ${n.targets.length} target(s). Open the dashboard to read it.`, url: `${SITE_URL}/admin?s=rights` } }).catch(() => {});
    await mailNotice(n.email, `Your notice ${row.code} was received`, [
      `We received your ${n.kind} notice and gave it the reference ${row.code}. Keep this code: it is how you follow it up, with or without an account.`,
      `A person will review it. You will be told what was decided at this address.`,
    ], row.code, 'rights-received');
    return reply.code(201).send({ notice: pub(row) });
  });

  // Follow-up without an account: the code and the e-mail it was filed with.
  app.get('/rights/notice/:code', { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const p = await db();
    const n = await p.rightsNotice.findUnique({ where: { code: String(req.params.code || '').toUpperCase() } });
    const email = String(req.query?.email || '').trim().toLowerCase();
    if (!n || !email || n.email !== email) return reply.code(404).send({ error: 'not_found' });
    return { notice: pub(n) };
  });

  app.get('/me/rights', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const rows = await p.rightsNotice.findMany({ where: { reporterId: req.user.uid }, orderBy: { createdAt: 'desc' }, take: 100 });
    return { notices: rows.map(pub) };
  });

  // ── staff: the queue ─────────────────────────────────────────────────────────────────
  const CAP = { preHandler: requireCap('manage_reports', 'MOD') };

  app.get('/admin/rights', CAP, async (req) => {
    const p = await db();
    const status = String(req.query?.status || 'open');
    const where = status === 'open' ? { status: { in: ['new', 'reviewing', 'countered'] } } : status === 'all' ? {} : { status };
    const rows = await p.rightsNotice.findMany({ where, orderBy: [{ createdAt: 'desc' }], take: 200, include: { reporter: { select: { id: true, displayName: true } }, work_: { select: { id: true, title: true } } } });
    const counts = Object.fromEntries(await Promise.all(NOTICE_STATUSES.map(async (s) => [s, await p.rightsNotice.count({ where: { status: s } })])));
    return { notices: rows.map(staffView), counts, config: await rightsConfig(p) };
  });

  app.get('/admin/rights/:id', CAP, async (req, reply) => {
    const p = await db();
    const n = await p.rightsNotice.findUnique({ where: { id: req.params.id }, include: { reporter: { select: { id: true, displayName: true } }, work_: { select: { id: true, title: true } } } });
    if (!n) return reply.code(404).send({ error: 'not_found' });
    // Resolved targets (live: what is there NOW), the sanctions, and the strike count per
    // answerable account — the three things a decision needs on one screen.
    const cfg = await rightsConfig(p);
    const resolved = [];
    for (const t of n.targets || []) {
      const live = t.type === 'url' ? null : await resolveTarget(p, t.type === 'catalog' ? `/c/${t.id}` : t.type === 'item' ? `/item/${t.id}` : t.type === 'user' ? `/u/${t.id}` : t.id).catch(() => null);
      resolved.push({ ...t, live: live ? { status: live.status || null, files: live.files?.length ?? null, items: live.items?.length ?? null, ownerId: live.ownerId || null, exists: true } : { exists: false } });
    }
    const sanctions = n.sanctionIds.length ? await p.sanction.findMany({ where: { id: { in: n.sanctionIds } }, select: { id: true, code: true, kind: true, status: true, targetType: true, targetName: true, contestedAt: true } }) : [];
    const owners = [];
    for (const oid of n.ownerIds || []) {
      const u = await p.user.findUnique({ where: { id: oid }, select: { id: true, displayName: true, email: true, status: true } });
      const actioned = await p.rightsNotice.findMany({ where: { status: { in: ['actioned', 'countered'] }, ownerIds: { has: oid }, id: { not: n.id } }, select: { code: true, decisionAt: true, createdAt: true } });
      owners.push({ ...(u || { id: oid, displayName: '(gone)' }), bcId: userBcId(oid), strikes: strikeStatus(actioned, { threshold: cfg.strikeThreshold, windowDays: cfg.strikeWindowDays }), prior: actioned.map((a) => a.code) });
    }
    return { notice: staffView(n), resolved, sanctions, owners, config: cfg };
  });

  app.post('/admin/rights/:id/status', CAP, async (req, reply) => {
    const b = z.object({ status: z.enum(['reviewing', 'closed', 'new']), internalNote: z.string().max(4000).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const n = await p.rightsNotice.update({ where: { id: req.params.id }, data: { status: b.data.status, reviewedById: req.user.uid, ...(b.data.internalNote != null ? { internalNote: b.data.internalNote } : {}) } }).catch(() => null);
    if (!n) return reply.code(404).send({ error: 'not_found' });
    return { notice: staffView(n) };
  });

  app.post('/admin/rights/:id/note', CAP, async (req, reply) => {
    const b = z.object({ internalNote: z.string().max(4000) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    await p.rightsNotice.update({ where: { id: req.params.id }, data: { internalNote: b.data.internalNote } }).catch(() => null);
    return { ok: true };
  });

  /**
   * Take the targets down — as narrowly as the notice: a content sanction per repo /
   * catalogue / item target, through the same endpoint the report threads use, so a takedown
   * from a notice and a takedown from a report are the same record with the same mail, the
   * same contest route, the same lift. `protect` registers the work (title, URLs, the hashes
   * of the files taken down) so the same file is caught the next time it lands.
   */
  app.post('/admin/rights/:id/takedown', CAP, async (req, reply) => {
    const b = z.object({
      decision: z.string().trim().max(4000).optional().default(''),
      reason: z.string().trim().max(1000).optional(),
      protect: z.boolean().default(true),
      tellReporter: z.boolean().default(true),
    }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const n = await p.rightsNotice.findUnique({ where: { id: req.params.id } });
    if (!n) return reply.code(404).send({ error: 'not_found' });
    if (n.ownerIds.includes(req.user.uid)) return reply.code(403).send({ error: 'own_content' });
    const cfg = await rightsConfig(p);
    const reason = b.data.reason || `Rights notice ${n.code}${n.work?.title ? ` — "${n.work.title}"` : ''}. You may contest this within ${cfg.counterDays} days.`;
    const sanctionIds = [...(n.sanctionIds || [])];
    const hashes = [];
    const done = []; const failed = [];
    for (const t of n.targets || []) {
      if (!['repo', 'catalog', 'item'].includes(t.type) || !t.id) continue;
      // The catalogue's stored id may be a slug; the sanction endpoint wants the row id.
      let targetId = t.id;
      if (t.type === 'catalog') { const c = await p.communityCatalog.findFirst({ where: { OR: [{ slug: t.id }, { id: t.id }] }, select: { id: true } }); if (!c) { failed.push({ target: t, error: 'not_found' }); continue; } targetId = c.id; }
      if (t.type === 'repo' && b.data.protect) {
        const files = await p.repoFile.findMany({ where: { serverRepoId: t.id, ...(t.files?.length ? { path: { in: t.files } } : {}) }, select: { sha256: true } });
        for (const f of files) if (f.sha256) hashes.push(f.sha256.toLowerCase());
      }
      const out = await app.inject({ method: 'POST', url: '/admin/sanctions/content', headers: { cookie: req.headers.cookie || '' }, payload: { targetType: t.type, targetId, kind: 'takedown', reason, internalNote: `From rights notice ${n.code}` } });
      if (out.statusCode !== 200) { failed.push({ target: t, error: out.json()?.error || out.statusCode }); continue; }
      const s = out.json().sanction;
      sanctionIds.push(s.id);
      done.push({ target: t, code: s.code });
    }
    let workId = n.workId;
    if (b.data.protect && n.kind !== 'match') {
      const w = normalizeWork({ title: n.work?.title || n.targets?.[0]?.label || n.code, owner: n.org || n.name, contact: n.email, urls: n.work?.urls || [], hashes: [...(n.work?.hashes || []), ...hashes], notes: `Registered from notice ${n.code}.` });
      if (!w.error) { const row = await p.protectedWork.create({ data: { ...w, createdById: req.user.uid } }); workId = row.id; invalidateWorks(); }
    } else if (n.kind === 'match' && n.workId && hashes.length) {
      const w = await p.protectedWork.findUnique({ where: { id: n.workId } });
      if (w) { await p.protectedWork.update({ where: { id: w.id }, data: { hashes: [...new Set([...w.hashes, ...hashes])] } }); invalidateWorks(); }
    }
    const updated = await p.rightsNotice.update({ where: { id: n.id }, data: { status: 'actioned', decision: b.data.decision, decisionAt: new Date(), reviewedById: req.user.uid, sanctionIds, workId } });
    await logAudit(p, req.user.uid, 'rights.takedown', `${n.code}: ${done.length} taken down, ${failed.length} failed`, req.ip);
    if (b.data.tellReporter && n.email) {
      await mailNotice(n.email, `Your notice ${n.code}: content taken down`, [
        `We reviewed your notice ${n.code} and took the reported content down (${done.length} item(s)).`,
        ...(b.data.decision ? [b.data.decision] : []),
        `The person who posted it has ${cfg.counterDays} days to contest. If they do, we will tell you.`,
      ], n.code, 'rights-actioned');
    }
    return { notice: staffView(updated), done, failed };
  });

  app.post('/admin/rights/:id/reject', CAP, async (req, reply) => {
    const b = z.object({ decision: z.string().trim().min(3).max(4000), tellReporter: z.boolean().default(true) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const n = await p.rightsNotice.findUnique({ where: { id: req.params.id } });
    if (!n) return reply.code(404).send({ error: 'not_found' });
    const updated = await p.rightsNotice.update({ where: { id: n.id }, data: { status: 'rejected', decision: b.data.decision, decisionAt: new Date(), reviewedById: req.user.uid } });
    await logAudit(p, req.user.uid, 'rights.reject', `${n.code}: ${b.data.decision.slice(0, 120)}`, req.ip);
    if (b.data.tellReporter && n.email) await mailNotice(n.email, `Your notice ${n.code}: no action taken`, [`We reviewed your notice ${n.code} and did not take the content down.`, b.data.decision], n.code, 'rights-rejected');
    return { notice: staffView(updated) };
  });

  // The other side's answer, recorded by staff (it arrives by mail or through a sanction
  // contest). The reporter is told, because a counter-notice is their cue to act elsewhere.
  app.post('/admin/rights/:id/counter', CAP, async (req, reply) => {
    const b = z.object({ name: z.string().trim().max(120), email: z.string().trim().max(254), body: z.string().trim().min(3).max(6000), tellReporter: z.boolean().default(true) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const n = await p.rightsNotice.findUnique({ where: { id: req.params.id } });
    if (!n) return reply.code(404).send({ error: 'not_found' });
    const updated = await p.rightsNotice.update({ where: { id: n.id }, data: { status: 'countered', counter: { name: b.data.name, email: b.data.email, body: b.data.body, at: new Date().toISOString() } } });
    if (b.data.tellReporter && n.email) await mailNotice(n.email, `Your notice ${n.code}: a counter-notice was received`, [`The person whose content you reported has contested your notice ${n.code}. Their statement is available to staff; we will tell you what is decided next.`], n.code, 'rights-countered');
    return { notice: staffView(updated) };
  });

  // Put the content back: lift every sanction the takedown issued.
  app.post('/admin/rights/:id/restore', CAP, async (req, reply) => {
    const b = z.object({ decision: z.string().trim().max(4000).optional().default(''), tellReporter: z.boolean().default(true) }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const n = await p.rightsNotice.findUnique({ where: { id: req.params.id } });
    if (!n) return reply.code(404).send({ error: 'not_found' });
    const lifted = []; const failed = [];
    for (const sid of n.sanctionIds || []) {
      const out = await app.inject({ method: 'POST', url: `/admin/sanctions/${sid}/lift`, headers: { cookie: req.headers.cookie || '' }, payload: { reason: `Restored after notice ${n.code}${b.data.decision ? `: ${b.data.decision.slice(0, 200)}` : ''}` } });
      if (out.statusCode === 200) lifted.push(sid); else failed.push({ sid, error: out.json()?.error || out.statusCode });
    }
    const updated = await p.rightsNotice.update({ where: { id: n.id }, data: { status: 'restored', restoredAt: new Date(), decision: b.data.decision || n.decision, reviewedById: req.user.uid } });
    await logAudit(p, req.user.uid, 'rights.restore', `${n.code}: ${lifted.length} lifted`, req.ip);
    if (b.data.tellReporter && n.email) await mailNotice(n.email, `Your notice ${n.code}: content restored`, [`The content reported in ${n.code} has been restored.`, ...(b.data.decision ? [b.data.decision] : [])], n.code, 'rights-restored');
    return { notice: staffView(updated), lifted, failed };
  });

  // ── staff: the registry ──────────────────────────────────────────────────────────────
  app.get('/admin/rights/works', CAP, async () => {
    const p = await db();
    const works = await p.protectedWork.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
    return { works: works.map((w) => ({ ...w, hashCount: w.hashes.length, hashes: w.hashes.slice(0, 50) })) };
  });
  app.post('/admin/rights/works', CAP, async (req, reply) => {
    const w = normalizeWork(req.body);
    if (w.error) return reply.code(400).send({ error: w.error, pattern: w.pattern });
    const p = await db();
    const row = await p.protectedWork.create({ data: { ...w, createdById: req.user.uid } });
    invalidateWorks();
    await logAudit(p, req.user.uid, 'rights.work.add', row.title, req.ip);
    return reply.code(201).send({ work: row });
  });
  app.patch('/admin/rights/works/:id', CAP, async (req, reply) => {
    const p = await db();
    const cur = await p.protectedWork.findUnique({ where: { id: req.params.id } });
    if (!cur) return reply.code(404).send({ error: 'not_found' });
    const w = normalizeWork({ ...cur, ...(req.body || {}) });
    if (w.error) return reply.code(400).send({ error: w.error, pattern: w.pattern });
    const row = await p.protectedWork.update({ where: { id: cur.id }, data: w });
    invalidateWorks();
    return { work: row };
  });
  app.delete('/admin/rights/works/:id', CAP, async (req, reply) => {
    const p = await db();
    await p.protectedWork.delete({ where: { id: req.params.id } }).catch(() => null);
    invalidateWorks();
    await logAudit(p, req.user.uid, 'rights.work.remove', req.params.id, req.ip);
    return reply.code(204).send();
  });

  // Everything already hosted, against the registry — the stay-down check run by hand.
  app.post('/admin/rights/scan', CAP, async (req) => {
    const p = await db();
    const works = await p.protectedWork.findMany({ where: { active: true } });
    invalidateWorks();
    let files = 0, items = 0; const made = [];
    if (works.length) {
      const rf = await p.repoFile.findMany({ select: { path: true, sha256: true, repo: { select: { id: true, name: true, ownerId: true } } }, take: 50_000 });
      for (const f of rf) {
        files++;
        const hits = matchWorks({ sha256: f.sha256, path: f.path, name: f.path.split('/').pop() }, works);
        if (hits.length) made.push(...await flagIfProtected(p, { sha256: f.sha256, path: f.path, name: f.path.split('/').pop() }, { type: 'repo', id: f.repo.id, label: f.repo.name, url: `${SITE_URL}/r/${f.repo.id}`, ownerId: f.repo.ownerId }));
      }
      const ci = await p.catalogItem.findMany({ select: { id: true, name: true, slug: true, ownerId: true, meta: true }, take: 20_000 });
      for (const it of ci) {
        items++;
        const urls = [it.meta?.url, it.meta?.source, it.meta?.homepage, it.meta?.repo].filter(Boolean);
        const thing = { sha256: it.meta?.sha256, name: it.name, urls };
        if (matchWorks(thing, works).length) made.push(...await flagIfProtected(p, thing, { type: 'item', id: it.id, label: it.name, url: `${SITE_URL}/item/${it.slug || it.id}`, ownerId: it.ownerId }));
      }
    }
    await logAudit(p, req.user.uid, 'rights.scan', `${files} files, ${items} items, ${made.length} new match(es)`, req.ip);
    return { files, items, works: works.length, matches: made.map((m) => m.code) };
  });

  app.get('/admin/rights/config', CAP, async () => ({ config: await rightsConfig(await db()) }));
  app.put('/admin/rights/config', { preHandler: requireCap('manage_reports') }, async (req, reply) => {
    const b = RIGHTS_CONFIG_BODY.safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const cfg = { ...(await rightsConfig(p)), ...b.data };
    await p.adminSetting.upsert({ where: { key: 'rights.config' }, create: { key: 'rights.config', value: cfg }, update: { value: cfg } });
    return { config: cfg };
  });

  // Which kinds the form offers — kept beside the route so the form cannot drift from the enum.
  app.get('/rights/kinds', async () => ({ kinds: NOTICE_KINDS.filter((k) => k !== 'match') }));
}
