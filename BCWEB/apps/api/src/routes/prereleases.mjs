// prerelease (agent-prerelease): early access to a project's next version.
//
// PUBLIC AND MEMBERS
//   GET    /prereleases                       the current ones (?status=, ?project=<ref>, ?limit=)
//   GET    /prereleases/:slug                 one, with the viewer's own status
//   POST   /prereleases/:slug/signup          sign up (an account, a confirmed address where the
//                                             site confirms addresses, a day-old account)
//   DELETE /prereleases/:slug/signup          withdraw (the sign-up is deleted, access with it)
//   GET    /prereleases/:slug/download        SELECTED members only: 302 to a presigned GET that
//                                             lives two minutes, or to the stored external URL
//   GET    /me/prereleases                    my sign-ups, for the dashboard
//
// A PROJECT'S EDITORS (requireEditor, then canEditTarget in the handler: the manager capability
// or a per-project `pages` grant, the rule the project page editor uses)
//   GET    /projects-prereleases/:ref         a project's pre-releases (drafts for its editors)
//   POST   /projects-prereleases/:ref         open one (the project comes from the URL)
//   GET    /prerelease-manage                 every pre-release the caller may manage
//   GET    /prerelease-manage/:id             one, with its sign-ups
//   PATCH  /prerelease-manage/:id             edit
//   DELETE /prerelease-manage/:id             delete (sign-ups and file go with it)
//   POST   /prerelease-manage/:id/file        presign the upload of its file
//   POST   /prerelease-manage/:id/selection/preview   who a round WOULD select (nothing written)
//   POST   /prerelease-manage/:id/selection   run a round: select, record, mail
//   POST   /prerelease-manage/:id/close       end it: no sign-ups, no downloads
//   GET    /prerelease-manage/:id/export.csv  the sign-up list
//
// WHAT NEVER LEAKS. The sign-up list is the editors' only; a member sees their own status and
// nothing about anybody else. The file's key and URL are never serialised to a reader: the only
// way to the bytes is the download route, which asks the database on every call. The seed of a
// draw stays secret until the first round (its hash is public from creation, lib/prerelease.mjs).
import { randomUUID } from 'node:crypto';
import {
  db, optionalAuth, requireRole, requireEditor, requireVerifiedEmail, logAudit, clientIp, notify, accountLock,
} from '../lib/lib.mjs';
import { presignGet, presignPut, deleteObject } from '../lib/storage.mjs';
import {
  LIMITS, DOWNLOAD_TTL_S, CURRENT_PHASES, DRAW_ALGO, phaseOf, canSignUp, canDownloadPhase, newSeed, seedHashOf, entrantsHash,
  selectRound, prereleaseWriteSchema, prereleasePatchSchema, signupSchema, selectionSchema, isOwnFileKey, fileKeyPrefix,
  windowOf, serPublic, serManage, serMine, serSignupForEditor, signupsCsv, prereleaseSlug,
} from '../lib/prerelease.mjs';
import {
  projectByRef, projectsByTargets, projectByTarget, canSeeProject, isListable, liveUser, canEditTarget, projectCard,
} from '../lib/project-target.mjs';
import { mailSignup, mailSelected, mailNotSelected } from '../lib/prerelease-mail.mjs';
import { REVIEW_HAS_LINK, REVIEW_MIN_ACCOUNT_AGE_MS } from '../lib/review-rules.mjs';

const bad = (reply, r) => reply.code(400).send({ error: 'invalid_input', issues: r.error.issues.slice(0, 8).map((i) => ({ path: i.path.join('.'), message: i.message })) });
/** Every column but the seed, which only the selection code and the public serialiser read. */
const PUBLIC_SELECT = Object.fromEntries([
  'id', 'slug', 'target', 'version', 'title', 'titleFr', 'pitch', 'pitchFr', 'body', 'bodyFr', 'published',
  'opensAt', 'closesAt', 'capacity', 'mode', 'selectCount', 'notifyNotSelected', 'downloadKey', 'downloadUrl',
  'downloadName', 'downloadSize', 'seedHash', 'draws', 'selectedAt', 'closedAt', 'createdAt', 'updatedAt',
].map((k) => [k, true]));
// The seed is revealed with the first round, so a row that has rounds needs it for serPublic,
// which prints it only then (lib/prerelease.mjs).
const withSeed = { ...PUBLIC_SELECT, seed: true };

/** Sign-up counts per status, for many pre-releases at once. */
async function countsFor(p, ids) {
  const out = new Map(ids.map((id) => [id, { pending: 0, selected: 0, not_selected: 0 }]));
  if (!ids.length) return out;
  const rows = await p.preReleaseSignup.groupBy({ by: ['prereleaseId', 'status'], where: { prereleaseId: { in: ids } }, _count: { _all: true } });
  for (const r of rows) { const c = out.get(r.prereleaseId); if (c) c[r.status] = r._count._all; }
  return out;
}

/** A row as a reader may see it: the seed only once a round revealed it. */
function publicOf(row, extra) {
  const hasRounds = Array.isArray(row.draws) && row.draws.length > 0;
  return serPublic(hasRounds ? row : { ...row, seed: null }, extra);
}

/** The pre-release a management URL names, and the right to manage it. Answers the refusal. */
async function manageTarget(p, req, reply) {
  const row = await p.preRelease.findUnique({ where: { id: String(req.params.id || '').slice(0, 40) } });
  if (!row) { reply.code(404).send({ error: 'not_found' }); return null; }
  const proj = await projectByTarget(p, row.target);
  // A pre-release whose project is gone is managed by whoever manages that kind of project.
  const user = req.user;
  const may = proj ? await canEditTarget(user, proj) : false;
  if (!may) { reply.code(403).send({ error: 'forbidden' }); return null; }
  return { row, proj };
}

/** The accounts behind some sign-ups, with what the mails need. */
async function usersOf(p, ids) {
  if (!ids.length) return new Map();
  const us = await p.user.findMany({ where: { id: { in: ids }, closedAt: null }, select: { id: true, email: true, locale: true, notifPrefs: true, displayName: true } });
  return new Map(us.map((u) => [u.id, u]));
}

export default async function prereleaseRoutes(app) {
  // ── public ────────────────────────────────────────────────────────────────────────────
  app.get('/prereleases', { preHandler: optionalAuth(), config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    const p = await db();
    const q = req.query || {};
    const status = ['all', ...CURRENT_PHASES].includes(q.status) ? q.status : 'all';
    const limit = Math.min(Math.max(parseInt(q.limit, 10) || 60, 1), LIMITS.list);
    let onlyTarget = null;
    if (typeof q.project === 'string' && q.project) {
      const proj = await projectByRef(p, q.project.slice(0, 90));
      if (!proj) return { prereleases: [] };
      onlyTarget = proj.target;
    }
    const rows = await p.preRelease.findMany({
      where: { published: true, closedAt: null, ...(onlyTarget ? { target: onlyTarget } : {}) },
      orderBy: [{ createdAt: 'desc' }], take: LIMITS.list, select: withSeed,
    });
    const projects = await projectsByTargets(p, rows.map((r) => r.target));
    const now = Date.now();
    // A listing lists PUBLIC pages only: an unlisted or whitelisted project's pre-release is
    // reached by its link, like the page itself.
    const kept = rows.filter((r) => isListable(projects.get(r.target)))
      .filter((r) => { const ph = phaseOf(r, now); return CURRENT_PHASES.includes(ph) && (status === 'all' || ph === status); })
      .slice(0, limit);
    const counts = await countsFor(p, kept.map((r) => r.id));
    const mine = req.user?.uid && kept.length
      ? new Map((await p.preReleaseSignup.findMany({ where: { userId: req.user.uid, prereleaseId: { in: kept.map((r) => r.id) } } })).map((s) => [s.prereleaseId, s]))
      : new Map();
    // Open first, then upcoming, then the rest; newest first within each.
    const rank = { open: 0, upcoming: 1, selecting: 2, available: 3 };
    const out = kept.map((r) => ({ ...publicOf(r, { project: projectCard(projects.get(r.target)), counts: counts.get(r.id), now }), me: serMine(mine.get(r.id)) }));
    out.sort((a, b) => (rank[a.phase] - rank[b.phase]));
    return { prereleases: out };
  });

  app.get('/prereleases/:slug', { preHandler: optionalAuth() }, async (req, reply) => {
    const p = await db();
    const row = await p.preRelease.findUnique({ where: { slug: String(req.params.slug || '').slice(0, 90) }, select: withSeed });
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const proj = await projectByTarget(p, row.target);
    const user = await liveUser(req);
    const canManage = !!proj && (await canEditTarget(user, proj));
    // A draft, or a project the reader may not see, is a 404: "it exists but is not yours" is
    // itself information about an unannounced version.
    if (!canManage && (!row.published || !proj || !(await canSeeProject(p, proj, req)))) return reply.code(404).send({ error: 'not_found' });
    const [counts, mine] = await Promise.all([
      countsFor(p, [row.id]),
      req.user?.uid ? p.preReleaseSignup.findUnique({ where: { prereleaseId_userId: { prereleaseId: row.id, userId: req.user.uid } } }) : null,
    ]);
    return { prerelease: publicOf(row, { project: projectCard(proj), counts: counts.get(row.id) }), me: serMine(mine), canManage };
  });

  app.post('/prereleases/:slug/signup', {
    preHandler: [requireRole(), requireVerifiedEmail()],
    config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
  }, async (req, reply) => {
    const b = signupSchema.safeParse(req.body || {});
    if (!b.success) return bad(reply, b);
    if (b.data.message && REVIEW_HAS_LINK.test(b.data.message)) return reply.code(400).send({ error: 'no_links' });
    const p = await db();
    const row = await p.preRelease.findUnique({ where: { slug: String(req.params.slug || '').slice(0, 90) }, select: { ...PUBLIC_SELECT } });
    if (!row || !row.published) return reply.code(404).send({ error: 'not_found' });
    const proj = await projectByTarget(p, row.target);
    if (!proj || !(await canSeeProject(p, proj, req))) return reply.code(404).send({ error: 'not_found' });
    const me = await p.user.findUnique({ where: { id: req.user.uid }, select: { id: true, email: true, locale: true, notifPrefs: true, createdAt: true, status: true, closedAt: true } });
    if (!me || me.closedAt || (me.status && me.status !== 'active')) return reply.code(403).send({ error: 'forbidden' });
    // A draw invites accounts made for it. The review rule: a day old at least.
    if (Date.now() - new Date(me.createdAt).getTime() < REVIEW_MIN_ACCOUNT_AGE_MS) return reply.code(403).send({ error: 'account_too_new' });
    let created;
    try {
      created = await p.$transaction(async (tx) => {
        // One sign-up at a time per pre-release, so the capacity cannot be overrun by a race.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`prerelease:${row.id}`}))`;
        const cur = await tx.preRelease.findUnique({ where: { id: row.id }, select: { ...PUBLIC_SELECT } });
        if (!cur || !canSignUp(cur)) return { error: 'closed' };
        const had = await tx.preReleaseSignup.findUnique({ where: { prereleaseId_userId: { prereleaseId: row.id, userId: me.id } } });
        if (had) return { error: 'already_signed_up', signup: had };
        if (cur.capacity != null && (await tx.preReleaseSignup.count({ where: { prereleaseId: row.id } })) >= cur.capacity) return { error: 'full' };
        const selected = cur.mode === 'all';
        return {
          signup: await tx.preReleaseSignup.create({
            data: { prereleaseId: row.id, userId: me.id, message: b.data.message || '', status: selected ? 'selected' : 'pending', ...(selected ? { decidedAt: new Date() } : {}) },
          }),
        };
      });
    } catch { return reply.code(409).send({ error: 'busy' }); }
    if (created.error) return reply.code(409).send({ error: created.error, me: serMine(created.signup) });
    await mailSignup(me, row, proj.name, created.signup.status);
    if (created.signup.status === 'selected') {
      await notify(p, me.id, 'prerelease_selected', `You have early access to ${row.title}.`, { bodyFr: `Tu as l’accès anticipé à ${row.titleFr || row.title}.`, href: `/prereleases/${row.slug}` });
    }
    return reply.code(201).send({ me: serMine(created.signup) });
  });

  app.delete('/prereleases/:slug/signup', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const row = await p.preRelease.findUnique({ where: { slug: String(req.params.slug || '').slice(0, 90) }, select: { id: true } });
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const gone = await p.preReleaseSignup.deleteMany({ where: { prereleaseId: row.id, userId: req.user.uid } });
    if (!gone.count) return reply.code(404).send({ error: 'not_signed_up' });
    return { ok: true, me: null };
  });

  // The ONLY door to the file. Asked of the database on every call: withdrawing, a new round,
  // closing or a suspension take effect on the next click, not when some link expires.
  app.get('/prereleases/:slug/download', { preHandler: requireRole(), config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const p = await db();
    const row = await p.preRelease.findUnique({ where: { slug: String(req.params.slug || '').slice(0, 90) }, select: { ...PUBLIC_SELECT } });
    if (!row || !row.published) return reply.code(404).send({ error: 'not_found' });
    const signup = await p.preReleaseSignup.findUnique({ where: { prereleaseId_userId: { prereleaseId: row.id, userId: req.user.uid } }, select: { status: true } });
    if (!signup || signup.status !== 'selected') return reply.code(403).send({ error: 'not_selected' });
    if (!canDownloadPhase(row)) return reply.code(403).send({ error: 'not_available', phase: phaseOf(row) });
    // A suspended account keeps its sign-in (to read why) and loses its services.
    if (await accountLock(req.user.uid, 'service')) return reply.code(403).send({ error: 'account_locked' });
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
    if (row.downloadKey && isOwnFileKey(row.id, row.downloadKey)) {
      let url;
      try { url = await presignGet(row.downloadKey, DOWNLOAD_TTL_S); } catch { return reply.code(503).send({ error: 'storage_unavailable' }); }
      return reply.redirect(url, 302);
    }
    if (row.downloadUrl) return reply.redirect(row.downloadUrl, 302);
    return reply.code(404).send({ error: 'no_file' });
  });

  app.get('/me/prereleases', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const mine = await p.preReleaseSignup.findMany({ where: { userId: req.user.uid }, orderBy: { createdAt: 'desc' }, take: 100, include: { prerelease: { select: withSeed } } });
    const projects = await projectsByTargets(p, mine.map((s) => s.prerelease.target));
    return {
      signups: mine.filter((s) => s.prerelease.published).map((s) => ({
        me: serMine(s),
        prerelease: publicOf(s.prerelease, { project: projectCard(projects.get(s.prerelease.target)) }),
      })),
    };
  });

  // ── a project's editors ───────────────────────────────────────────────────────────────
  app.get('/projects-prereleases/:ref', { preHandler: optionalAuth() }, async (req, reply) => {
    const p = await db();
    const proj = await projectByRef(p, String(req.params.ref || ''));
    if (!proj) return reply.code(404).send({ error: 'unknown_project' });
    const user = await liveUser(req);
    const canManage = await canEditTarget(user, proj);
    if (!canManage && !(await canSeeProject(p, proj, req))) return reply.code(404).send({ error: 'not_found' });
    const rows = await p.preRelease.findMany({
      where: { target: proj.target, ...(canManage ? {} : { published: true }) },
      orderBy: { createdAt: 'desc' }, take: LIMITS.perProject, select: withSeed,
    });
    const counts = await countsFor(p, rows.map((r) => r.id));
    const card = projectCard(proj);
    return {
      canManage,
      prereleases: rows.map((r) => (canManage
        ? serManage(r.draws?.length ? r : { ...r, seed: null }, { project: card, counts: counts.get(r.id) })
        : publicOf(r, { project: card, counts: counts.get(r.id) }))),
    };
  });

  app.post('/projects-prereleases/:ref', { preHandler: requireEditor(), config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const p = await db();
    const proj = await projectByRef(p, String(req.params.ref || ''));
    if (!proj) return reply.code(404).send({ error: 'unknown_project' });
    if (!(await canEditTarget(req.user, proj))) return reply.code(403).send({ error: 'forbidden' });
    const b = prereleaseWriteSchema.safeParse(req.body || {});
    if (!b.success) return bad(reply, b);
    if (b.data.downloadKey) return reply.code(400).send({ error: 'upload_after_create' });
    const win = windowOf(b.data);
    if (win.error) return reply.code(400).send({ error: win.error });
    if ((await p.preRelease.count({ where: { target: proj.target } })) >= LIMITS.perProject) return reply.code(409).send({ error: 'limit', limit: LIMITS.perProject });
    const seed = newSeed();
    const d = b.data;
    const row = await p.preRelease.create({
      data: {
        slug: prereleaseSlug(d.title), target: proj.target, title: d.title, titleFr: d.titleFr || '', pitch: d.pitch || '', pitchFr: d.pitchFr || '',
        body: d.body || '', bodyFr: d.bodyFr || '', version: d.version || '', published: !!d.published,
        opensAt: win.opensAt, closesAt: win.closesAt, capacity: d.capacity ?? null, mode: d.mode || 'manual',
        selectCount: d.selectCount ?? null, notifyNotSelected: !!d.notifyNotSelected,
        downloadUrl: d.downloadUrl || null, downloadName: d.downloadName || '', downloadSize: d.downloadSize ?? null,
        seed, seedHash: seedHashOf(seed), createdById: req.user.uid,
      },
    });
    await logAudit(p, req.user.uid, 'prerelease.created', `${proj.ref} ${row.slug} seed=${row.seedHash.slice(0, 16)}`, clientIp(req));
    return reply.code(201).send({ prerelease: serManage({ ...row, seed: null }, { project: projectCard(proj) }) });
  });

  app.get('/prerelease-manage', { preHandler: requireEditor() }, async (req) => {
    const p = await db();
    const rows = await p.preRelease.findMany({ orderBy: { createdAt: 'desc' }, take: 500, select: withSeed });
    const projects = await projectsByTargets(p, rows.map((r) => r.target));
    const mayBy = new Map();
    for (const t of new Set(rows.map((r) => r.target))) {
      const proj = projects.get(t);
      mayBy.set(t, proj ? await canEditTarget(req.user, proj) : false);
    }
    const kept = rows.filter((r) => mayBy.get(r.target));
    const counts = await countsFor(p, kept.map((r) => r.id));
    return {
      prereleases: kept.map((r) => serManage(r.draws?.length ? r : { ...r, seed: null }, { project: projectCard(projects.get(r.target)), counts: counts.get(r.id) })),
    };
  });

  app.get('/prerelease-manage/:id', { preHandler: requireEditor() }, async (req, reply) => {
    const p = await db();
    const m = await manageTarget(p, req, reply);
    if (!m) return reply;
    const [counts, signups] = await Promise.all([
      countsFor(p, [m.row.id]),
      p.preReleaseSignup.findMany({ where: { prereleaseId: m.row.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 5000, include: { user: { select: { displayName: true } } } }),
    ]);
    const row = m.row.draws?.length ? m.row : { ...m.row, seed: null };
    return { prerelease: serManage(row, { project: projectCard(m.proj), counts: counts.get(m.row.id) }), signups: signups.map(serSignupForEditor) };
  });

  app.patch('/prerelease-manage/:id', { preHandler: requireEditor() }, async (req, reply) => {
    const p = await db();
    const m = await manageTarget(p, req, reply);
    if (!m) return reply;
    const b = prereleasePatchSchema.safeParse(req.body || {});
    if (!b.success) return bad(reply, b);
    const d = b.data;
    // The file key is the one the upload route minted for THIS pre-release, or nothing: a key
    // naming any other object would make this route a way to hand out somebody else's bytes.
    if (d.downloadKey != null && !isOwnFileKey(m.row.id, d.downloadKey)) return reply.code(400).send({ error: 'invalid_file_key' });
    const win = windowOf(d, m.row);
    if (win.error) return reply.code(400).send({ error: win.error });
    // The mode is what the sign-ups were promised. Once a round has run it is history.
    if (d.mode && d.mode !== m.row.mode && (m.row.draws || []).length) return reply.code(409).send({ error: 'mode_locked' });
    const data = {};
    for (const k of ['title', 'titleFr', 'pitch', 'pitchFr', 'body', 'bodyFr', 'version', 'published', 'capacity', 'mode', 'selectCount', 'notifyNotSelected', 'downloadUrl', 'downloadKey', 'downloadName', 'downloadSize']) {
      if (d[k] !== undefined) data[k] = d[k];
    }
    if (d.opensAt !== undefined) data.opensAt = win.opensAt;
    if (d.closesAt !== undefined) data.closesAt = win.closesAt;
    const oldKey = m.row.downloadKey;
    const row = await p.preRelease.update({ where: { id: m.row.id }, data });
    if (oldKey && data.downloadKey !== undefined && data.downloadKey !== oldKey) await deleteObject(oldKey);
    await logAudit(p, req.user.uid, 'prerelease.edited', `${m.proj.ref} ${row.slug} ${Object.keys(data).join(',')}`.slice(0, 300), clientIp(req));
    return { prerelease: serManage(row.draws?.length ? row : { ...row, seed: null }, { project: projectCard(m.proj) }) };
  });

  app.delete('/prerelease-manage/:id', { preHandler: requireEditor() }, async (req, reply) => {
    const p = await db();
    const m = await manageTarget(p, req, reply);
    if (!m) return reply;
    await p.preRelease.delete({ where: { id: m.row.id } });
    if (m.row.downloadKey) await deleteObject(m.row.downloadKey);
    await logAudit(p, req.user.uid, 'prerelease.deleted', `${m.proj.ref} ${m.row.slug}`, clientIp(req));
    return { ok: true };
  });

  // The file goes straight to storage, under prerelease/<id>/, which the public media proxy
  // never serves (it serves blog/ only). Signed over the type and the exact size.
  app.post('/prerelease-manage/:id/file', { preHandler: requireEditor(), config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const p = await db();
    const m = await manageTarget(p, req, reply);
    if (!m) return reply;
    const filename = String(req.body?.filename || '').slice(0, 160);
    const contentType = String(req.body?.contentType || 'application/octet-stream').slice(0, 120) || 'application/octet-stream';
    const size = Number(req.body?.size);
    if (!filename) return reply.code(400).send({ error: 'invalid_input' });
    if (!Number.isSafeInteger(size) || size <= 0) return reply.code(400).send({ error: 'invalid_size' });
    if (size > LIMITS.fileBytes) return reply.code(413).send({ error: 'too_large', maxBytes: LIMITS.fileBytes });
    if (!/^[\w.+-]+\/[\w.+-]+$/.test(contentType)) return reply.code(415).send({ error: 'unsupported_type' });
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    const key = `${fileKeyPrefix(m.row.id)}${randomUUID()}-${safe}`;
    let url;
    try { url = await presignPut(key, { contentType, size }); } catch { return reply.code(503).send({ error: 'storage_unavailable' }); }
    return { key, url, expiresIn: 600, name: filename, size };
  });

  const loadPending = (p, id) => p.preReleaseSignup.findMany({ where: { prereleaseId: id, status: 'pending' }, select: { id: true, createdAt: true, userId: true } });

  app.post('/prerelease-manage/:id/selection/preview', { preHandler: requireEditor() }, async (req, reply) => {
    const p = await db();
    const m = await manageTarget(p, req, reply);
    if (!m) return reply;
    const b = selectionSchema.safeParse(req.body || {});
    if (!b.success) return bad(reply, b);
    const pending = await loadPending(p, m.row.id);
    const round = (m.row.draws || []).length + 1;
    const r = selectRound(pending, { ...b.data, count: b.data.count ?? m.row.selectCount, seed: m.row.seed, round });
    if (r.error) return reply.code(400).send({ error: r.error });
    const names = new Map((await p.preReleaseSignup.findMany({ where: { id: { in: r.winners } }, include: { user: { select: { displayName: true } } } })).map((s) => [s.id, s.user?.displayName || '']));
    return { round, mode: b.data.mode, entrants: r.entrants.length, entrantsHash: entrantsHash(r.entrants), seedHash: m.row.seedHash, algo: DRAW_ALGO, winners: r.winners.map((id) => ({ id, name: names.get(id) || '' })) };
  });

  app.post('/prerelease-manage/:id/selection', { preHandler: requireEditor(), config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const p = await db();
    const m = await manageTarget(p, req, reply);
    if (!m) return reply;
    const b = selectionSchema.safeParse(req.body || {});
    if (!b.success) return bad(reply, b);
    if (!m.row.published) return reply.code(409).send({ error: 'not_published' });
    if (m.row.closedAt) return reply.code(409).send({ error: 'closed' });
    const notifyOthers = b.data.notifyOthers ?? m.row.notifyNotSelected;
    let out;
    try {
      out = await p.$transaction(async (tx) => {
        // The same lock as the sign-ups: nobody joins the list while a round is drawn over it.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`prerelease:${m.row.id}`}))`;
        const cur = await tx.preRelease.findUnique({ where: { id: m.row.id } });
        const pending = await loadPending(tx, cur.id);
        const round = (cur.draws || []).length + 1;
        const r = selectRound(pending, { ...b.data, count: b.data.count ?? cur.selectCount, seed: cur.seed, round });
        if (r.error) return { error: r.error };
        const eh = entrantsHash(r.entrants);
        // A draw runs over the list its preview showed, or not at all.
        if (b.data.mode === 'draw' && b.data.entrantsHash && b.data.entrantsHash !== eh) return { error: 'entrants_changed' };
        const now = new Date();
        const winners = new Set(r.winners);
        const others = notifyOthers ? r.entrants.filter((id) => !winners.has(id)) : [];
        if (r.winners.length) await tx.preReleaseSignup.updateMany({ where: { id: { in: r.winners }, status: 'pending' }, data: { status: 'selected', decidedAt: now } });
        if (others.length) await tx.preReleaseSignup.updateMany({ where: { id: { in: others }, status: 'pending' }, data: { status: 'not_selected', decidedAt: now } });
        const record = {
          round, mode: b.data.mode, at: now.toISOString(), by: req.user.uid, n: b.data.count ?? cur.selectCount ?? null,
          entrants: r.entrants, winners: r.winners, entrantsHash: eh, algo: b.data.mode === 'draw' ? DRAW_ALGO : null, seedHash: cur.seedHash,
        };
        const updated = await tx.preRelease.update({ where: { id: cur.id }, data: { draws: [...(cur.draws || []), record], selectedAt: cur.selectedAt || now } });
        return { record, others, updated };
      });
    } catch { return reply.code(409).send({ error: 'busy' }); }
    if (out.error) return reply.code(out.error === 'entrants_changed' ? 409 : 400).send({ error: out.error });
    const { record, others, updated } = out;
    // The audit chain carries what makes the round checkable: the committed seed, the entrant
    // list's fingerprint and the counts. The full lists are on the pre-release's record.
    await logAudit(p, req.user.uid, 'prerelease.selection',
      `${m.proj.ref} ${m.row.slug} r${record.round} ${record.mode} ${record.winners.length}/${record.entrants.length} seed=${record.seedHash.slice(0, 16)} entrants=${record.entrantsHash.slice(0, 16)}`, clientIp(req));
    // Mail after the transaction: a mail cannot be rolled back, a row can.
    const sel = await p.preReleaseSignup.findMany({ where: { id: { in: [...record.winners, ...others] } }, select: { id: true, userId: true } });
    const users = await usersOf(p, sel.map((s) => s.userId));
    const winnerSet = new Set(record.winners);
    const now = new Date();
    for (const s of sel) {
      const u = users.get(s.userId);
      if (!u) continue;
      if (winnerSet.has(s.id)) {
        await mailSelected(u, updated, m.proj.name);
        await notify(p, u.id, 'prerelease_selected', `You have early access to ${updated.title}.`, { bodyFr: `Tu as l’accès anticipé à ${updated.titleFr || updated.title}.`, href: `/prereleases/${updated.slug}` });
      } else {
        const sent = await mailNotSelected(u, updated, m.proj.name);
        await notify(p, u.id, 'prerelease_not_selected', `You were not selected for ${updated.title} this time.`, { bodyFr: `Tu n’as pas été sélectionné pour ${updated.titleFr || updated.title} cette fois.`, href: `/prereleases/${updated.slug}` });
        if (sent !== false) await p.preReleaseSignup.update({ where: { id: s.id }, data: { notifiedAt: now } }).catch(() => {});
      }
    }
    return { round: record.round, selected: record.winners.length, entrants: record.entrants.length, notSelected: others.length, entrantsHash: record.entrantsHash, seed: updated.seed, seedHash: updated.seedHash };
  });

  app.post('/prerelease-manage/:id/close', { preHandler: requireEditor() }, async (req, reply) => {
    const p = await db();
    const m = await manageTarget(p, req, reply);
    if (!m) return reply;
    if (m.row.closedAt) return { ok: true, closedAt: m.row.closedAt };
    const row = await p.preRelease.update({ where: { id: m.row.id }, data: { closedAt: new Date() } });
    await logAudit(p, req.user.uid, 'prerelease.closed', `${m.proj.ref} ${row.slug}`, clientIp(req));
    return { ok: true, closedAt: row.closedAt };
  });

  app.get('/prerelease-manage/:id/export.csv', { preHandler: requireEditor() }, async (req, reply) => {
    const p = await db();
    const m = await manageTarget(p, req, reply);
    if (!m) return reply;
    const rows = await p.preReleaseSignup.findMany({ where: { prereleaseId: m.row.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { user: { select: { displayName: true } } } });
    await logAudit(p, req.user.uid, 'prerelease.exported', `${m.proj.ref} ${m.row.slug} ${rows.length} rows`, clientIp(req));
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="prerelease-${m.row.slug}.csv"`)
      .header('Cache-Control', 'no-store')
      .send(signupsCsv(rows));
  });
}
