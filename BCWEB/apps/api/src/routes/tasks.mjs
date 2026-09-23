// Staff task board — work handed to staff, in teams with a chief.
//
//   GET    /admin/tasks/meta                          the board's vocabulary + what I may do
//   GET    /admin/tasks/people?q=                     staff search for the pickers
//   GET    /admin/tasks/teams                         the teams, with their chief and members
//   POST   /admin/tasks/teams                         create, with its members (manage_teams)
//   PATCH  /admin/tasks/teams/:id                     name / description / chief / archive (manage_teams)
//   DELETE /admin/tasks/teams/:id                     dissolve (manage_teams) — the tasks survive
//   POST   /admin/tasks/teams/:id/members             { userIds } add (chief, or manage_teams + manage_tasks)
//   DELETE /admin/tasks/teams/:id/members/:userId     remove, or leave (self)
//   GET    /admin/tasks/suggestions                   what the site proposes (manage_tasks)
//   POST   /admin/tasks/suggestions/:id/accept        turn one into a task (manage_tasks)
//   POST   /admin/tasks/suggestions/:id/dismiss       (manage_tasks)
//   POST   /admin/tasks/suggestions/:id/restore       undo a dismissal (manage_tasks)
//   GET    /admin/tasks?scope=&state=&teamId=&assignee=&q=
//   POST   /admin/tasks                               create
//   GET    /admin/tasks/:id                           one task + links + its whole history
//   PATCH  /admin/tasks/:id                           title / body / priority / dueAt / teamId
//   POST   /admin/tasks/:id/assign                    { userIds } — the whole list of people on it
//   POST   /admin/tasks/:id/state                     { state, note? }
//   POST   /admin/tasks/:id/note                      { note }
//   POST   /admin/tasks/:id/links                     { otherId, kind: blocks | blocked_by | relates }
//   DELETE /admin/tasks/:id/links/:linkId
//   DELETE /admin/tasks/:id                           (admin role only)
//
// THE GUARDS
//
// The board itself (`board`) is `requireEditor()` — signed in, 2FA-walled, live role and
// grants on `req.user` — followed by "is this the admin surface's population, or somebody on a
// staff team". Everything a person may do INSIDE the board is then a question to lib/tasks.mjs,
// never answered inline, because the screen draws its buttons from the same functions.
//
// Three capabilities (lib.mjs) sit on top: `view_tasks` reads every task, `manage_tasks`
// dispatches every task, `manage_teams` shapes the teams. The routes that ARE one capability —
// team create/rename/dissolve, the suggestions — say so with `requireCap` at the door, so the
// capabilities check (apps/web/scripts/check-capabilities.mjs) sees what they reach. The rules
// that COMBINE a capability with team standing (a chief's powers, "you cannot hand out what you
// do not hold") are lib/tasks.mjs, and test/task-permissions-matrix.test.mjs walks every one of
// them over HTTP.
import { z } from 'zod';
import { db, requireEditor, requireCap, notify, logAudit, clientIp, currentUser, hasCap } from '../lib/lib.mjs';
import {
  TASK_STATES, TASK_PRIORITIES, TERMINAL_STATES, MAX_ASSIGNEES, isStaffish, isAdmin, isDispatcher, seesAllTasks, standingFor,
  canView, canAssign, canRelease, canEdit, canMoveTeam, canSetState, canComment, canDelete, visibilityWhere,
  canManageTeam, canRunTeams, canNameChief, canAddMember, canRemoveMember, assignableIds, assignmentChange, assigneesOf,
  tasksToRelease, orphanedByTeamLoss, wouldCycle, linkFromSide, canLink,
  sortTasks, slugifyTeamName, serTask, serEvent, serStaffTeam,
} from '../lib/tasks.mjs';
import { candidatesFrom, planSuggestions, canSeeSuggestion, serSuggestion, scrub, safeHref } from '../lib/task-suggest.mjs';
import { PENDING_QUEUES } from './misc.mjs';
import { DEP_LABELS } from '../lib/monitor.mjs';

const PAGE = 50;
const NOTE_MAX = 2000;
/** One scan of the site's state per minute at most, however many admins have the tab open. */
const SCAN_EVERY_MS = 60_000;
const STAFF_ROLES = ['MOD', 'ADMIN', 'SUPERADMIN'];

/** The teams this account is on, and the ones it is chief of. Once per request. */
async function membershipOf(p, uid) {
  const [rows, chief] = await Promise.all([
    p.staffTeamMember.findMany({ where: { userId: uid }, select: { teamId: true } }),
    p.staffTeam.findMany({ where: { chiefId: uid, archivedAt: null }, select: { id: true } }),
  ]);
  return { memberOf: rows.map((r) => r.teamId), chiefOf: chief.map((r) => r.id) };
}

/**
 * Display names for a set of ids, in one round trip. An id with no row comes back missing
 * rather than as an invented name: the screen says "unknown account".
 */
async function peopleFor(p, ids) {
  const want = [...new Set(ids.filter(Boolean))];
  if (!want.length) return {};
  const rows = await p.user.findMany({ where: { id: { in: want } }, select: { id: true, displayName: true, role: true, avatar: true } });
  return Object.fromEntries(rows.map((u) => [u.id, { id: u.id, displayName: u.displayName, role: u.role, avatar: u.avatar || null }]));
}

/**
 * Is this account ALREADY on the admin surface? The same population as the board's door:
 * a staff role, a live capability (custom roles expanded by currentUser), or a team.
 */
async function isStaffAccount(p, uid) {
  const cur = await currentUser(uid);
  if (!cur.exists) return false;
  if (isStaffish({ uid, role: cur.role, perms: cur.perms })) return true;
  return (await p.staffTeamMember.count({ where: { userId: uid } }).catch(() => 0)) > 0;
}

/** Append one history row. Never throws into the caller: a lost event must not lose the write. */
const event = (p, taskId, actorId, kind, from = null, to = null, note = '') =>
  p.adminTaskEvent.create({ data: { taskId, actorId, kind, fromValue: from ? String(from) : null, toValue: to ? String(to) : null, note: String(note || '').slice(0, NOTE_MAX) } }).catch(() => null);

/**
 * Tell somebody a task landed on them. The kind is `task_*`, which `notifCategory` does not
 * match, so it falls in the locked category: a task your chief put your name on is not
 * something the site sends you unasked.
 */
const tell = (p, userId, kind, body, bodyFr) =>
  (userId ? notify(p, userId, kind, body, { bodyFr, href: '/admin?s=tasks' }) : Promise.resolve());

/** Take one person off a set of tasks, in one statement (Prisma has no array remove). */
const pullAssignee = (p, taskIds, uid) => (taskIds.length
  ? p.$executeRaw`UPDATE "AdminTask" SET "assigneeIds" = array_remove("assigneeIds", ${uid}), "updatedAt" = now() WHERE "id" = ANY(${taskIds}::text[])`
  : Promise.resolve(0));

const idList = z.array(z.string().trim().min(1).max(60)).max(MAX_ASSIGNEES);

// ── Suggestions: reading the site's state ─────────────────────────────────────────────────
let lastScan = 0;
let scanning = null;

/**
 * Read the four sources and write the plan. Throttled and single-flight: the tab polls, and
 * ten admins with it open must not run ten scans.
 */
async function scanSuggestions(p, force = false) {
  if (scanning) return scanning;
  if (!force && Date.now() - lastScan < SCAN_EVERY_MS) return null;
  scanning = (async () => {
    const scanned = [];
    let outages = [];
    try {
      outages = (await p.serviceOutage.findMany({ where: { endedAt: null }, orderBy: { startedAt: 'desc' }, take: 20 }))
        .map((o) => ({ id: o.id, dep: o.dep, label: DEP_LABELS[o.dep] || o.dep, startedAt: o.startedAt }));
      scanned.push('status');
    } catch { /* not scanned: its proposals stay as they are */ }
    const queues = [];
    let alerts = [];
    let errors = [];
    const ok = { pending: true, alert: true, error: true };
    for (const q of PENDING_QUEUES) {
      try {
        if (q.key === 'alerts') alerts = await q.recent(p);
        else if (q.key === 'errors') errors = await q.recent(p);
        else queues.push({ key: q.key, cap: q.cap, to: q.to, n: await q.count(p) });
      } catch {
        if (q.key === 'alerts') ok.alert = false; else if (q.key === 'errors') ok.error = false; else ok.pending = false;
      }
    }
    for (const k of Object.keys(ok)) if (ok[k]) scanned.push(k);
    const candidates = candidatesFrom({ outages, queues, alerts, errors });
    const keys = candidates.map((c) => c.dedupKey);
    const existing = await p.taskSuggestion.findMany({ where: { OR: [{ dedupKey: { in: keys.length ? keys : ['-'] } }, { state: 'open' }] } });
    const taskIds = existing.filter((r) => r.state === 'accepted' && r.taskId).map((r) => r.taskId);
    const tasks = taskIds.length ? await p.adminTask.findMany({ where: { id: { in: taskIds } }, select: { id: true, state: true } }) : [];
    const plan = planSuggestions(candidates, existing, Object.fromEntries(tasks.map((t) => [t.id, t.state])), scanned);
    for (const op of plan) {
      try {
        if (op.op === 'create') await p.taskSuggestion.create({ data: op.data });
        else if (op.op === 'expire') {
          // undo: a withdrawn proposal was never decided, and the next scan writes it again if
          // the condition comes back — there is nothing here a person made.
          await p.taskSuggestion.delete({ where: { id: op.id } });
        } else await p.taskSuggestion.update({ where: { id: op.id }, data: op.data });
      } catch { /* a concurrent scan wrote it first; the next one reconciles */ }
    }
    return plan.length;
  })().finally(() => { scanning = null; lastScan = Date.now(); });
  return scanning;
}

export default async function taskRoutes(app) {
  /**
   * The door: requireEditor (signed in, 2FA, live role and grants), then "are you on the admin
   * surface at all". Two hooks in an array: Fastify stops the chain the moment one sends.
   */
  const onlyStaff = async (req, reply) => {
    if (isStaffish(req.user)) return;
    const p = await db();
    const onTeam = await p.staffTeamMember.count({ where: { userId: req.user.uid } }).catch(() => 0);
    if (!isStaffish(req.user, onTeam > 0)) return reply.code(403).send({ error: 'forbidden' });
  };
  const board = [requireEditor(), onlyStaff];

  // ── Vocabulary ────────────────────────────────────────────────────────────────────────
  app.get('/admin/tasks/meta', { preHandler: board }, async (req) => {
    const p = await db();
    const mine = await membershipOf(p, req.user.uid);
    const teams = await p.staffTeam.findMany({ where: { archivedAt: null }, orderBy: { name: 'asc' }, include: { members: { select: { userId: true } } } });
    const ids = [...new Set(teams.flatMap((t) => [t.chiefId, ...t.members.map((m) => m.userId)]))];
    return {
      states: TASK_STATES,
      priorities: TASK_PRIORITIES,
      terminal: TERMINAL_STATES,
      maxAssignees: MAX_ASSIGNEES,
      me: {
        id: req.user.uid, admin: isAdmin(req.user), dispatcher: isDispatcher(req.user), seesAll: seesAllTasks(req.user),
        runTeams: canRunTeams(req.user), nameChiefs: canNameChief(req.user, null), suggestions: hasCap(req.user, 'manage_tasks'), ...mine,
      },
      teams: teams.map((t) => serStaffTeam(t, { memberIds: t.members.map((m) => m.userId) })),
      people: await peopleFor(p, ids),
    };
  });

  /**
   * Search for a person to put on a team or a task.
   *
   * The account search the site already has (`/admin/users`) is `manage_users`, and a chief
   * does not hold it — so a chief could not add anybody. This one answers with names only (no
   * e-mail unless you may read accounts) and, for anybody who may not bring an outsider onto
   * the board, only with accounts that are already staff. The add route re-checks; this is
   * the offer, not the rule.
   */
  app.get('/admin/tasks/people', { preHandler: board }, async (req) => {
    const p = await db();
    const q = String(req.query?.q || '').trim().slice(0, 80);
    if (q.length < 2) return { people: [] };
    const wide = canRunTeams(req.user) && isDispatcher(req.user);
    const emails = hasCap(req.user, 'manage_users');
    const match = { OR: [{ id: q }, { displayName: { contains: q, mode: 'insensitive' } }, ...(emails ? [{ email: { contains: q, mode: 'insensitive' } }] : [])] };
    const onTeam = (await p.staffTeamMember.findMany({ select: { userId: true }, distinct: ['userId'] })).map((r) => r.userId);
    const staff = { OR: [{ role: { in: STAFF_ROLES } }, { NOT: { permissions: { isEmpty: true } } }, { NOT: { customRoleIds: { isEmpty: true } } }, { id: { in: onTeam.length ? onTeam : ['-'] } }] };
    const rows = await p.user.findMany({
      where: wide ? match : { AND: [match, staff] }, take: 8, orderBy: { displayName: 'asc' },
      select: { id: true, displayName: true, avatar: true, role: true, email: emails, permissions: true, customRoleIds: true },
    });
    return {
      wide,
      people: rows.map((u) => ({
        id: u.id, displayName: u.displayName, avatar: u.avatar || null, role: u.role, ...(emails ? { email: u.email } : {}),
        staff: STAFF_ROLES.includes(u.role) || (u.permissions || []).length > 0 || (u.customRoleIds || []).length > 0 || onTeam.includes(u.id),
      })),
    };
  });

  // ── Teams ─────────────────────────────────────────────────────────────────────────────
  app.get('/admin/tasks/teams', { preHandler: board }, async (req) => {
    const p = await db();
    const mine = await membershipOf(p, req.user.uid);
    const teams = await p.staffTeam.findMany({
      orderBy: [{ archivedAt: 'asc' }, { name: 'asc' }],
      include: { members: { orderBy: { createdAt: 'asc' } }, tasks: { where: { state: { notIn: TERMINAL_STATES } }, select: { assigneeIds: true } }, _count: { select: { tasks: true } } },
    });
    const people = await peopleFor(p, teams.flatMap((t) => [t.chiefId, ...t.members.map((m) => m.userId)]));
    return {
      teams: teams.map((t) => {
        // "Who is on it and what are they holding" is the question the card answers at a
        // glance, so each member carries their count of OPEN tasks of this team.
        const load = {};
        for (const task of t.tasks) for (const id of task.assigneeIds) load[id] = (load[id] || 0) + 1;
        return serStaffTeam(t, {
          members: t.members.map((m) => ({ userId: m.userId, addedAt: m.createdAt, chief: m.userId === t.chiefId, open: load[m.userId] || 0 })),
          taskCount: t._count.tasks,
          openCount: t.tasks.length,
          unassigned: t.tasks.filter((x) => !x.assigneeIds.length).length,
          canManage: canManageTeam(req.user, t, mine),
          canAddOutsiders: canRunTeams(req.user) && isDispatcher(req.user),
          you: mine.memberOf.includes(t.id),
        });
      }),
      people,
      canRunTeams: canRunTeams(req.user),
      canNameChiefs: canNameChief(req.user, null),
    };
  });

  app.post('/admin/tasks/teams', { preHandler: requireCap('manage_teams') }, async (req, reply) => {
    const b = z.object({
      name: z.string().trim().min(2).max(60),
      description: z.string().trim().max(500).optional().default(''),
      chiefId: z.string().trim().min(1).max(60),
      memberIds: z.array(z.string().trim().min(1).max(60)).max(100).optional().default([]),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    // Naming a chief hands out dispatch inside the team: it needs what is being handed out.
    if (!canNameChief(req.user, b.data.chiefId)) return reply.code(403).send({ error: 'cannot_name_chief' });
    const p = await db();
    const members = [...new Set([b.data.chiefId, ...b.data.memberIds])];
    // Every id must be a real account (a stray id was a 500 from the foreign key it does not
    // have, and then a member row naming nobody). Every one must also be a grant the caller
    // may make — which, since naming the chief already needed manage_tasks, is "not yourself".
    const found = await p.user.findMany({ where: { id: { in: members } }, select: { id: true } });
    const known = new Set(found.map((u) => u.id));
    if (!known.has(b.data.chiefId)) return reply.code(400).send({ error: 'unknown_chief' });
    const unknown = members.filter((id) => !known.has(id));
    if (unknown.length) return reply.code(400).send({ error: 'unknown_user', ids: unknown });
    const draft = { id: '__new__', chiefId: b.data.chiefId };
    for (const id of members) {
      if (id === b.data.chiefId) continue;
      if (!canAddMember(req.user, draft, { id, staff: true })) return reply.code(403).send({ error: 'cannot_add_member', ids: [id] });
    }
    const base = slugifyTeamName(b.data.name);
    let slug = base;
    for (let i = 2; await p.staffTeam.findUnique({ where: { slug }, select: { id: true } }); i++) slug = `${base}-${i}`;
    const team = await p.staffTeam.create({
      data: {
        name: b.data.name, description: b.data.description, slug, chiefId: b.data.chiefId, createdById: req.user.uid,
        members: { create: members.map((userId) => ({ userId, addedById: req.user.uid })) },
      },
      include: { members: true },
    });
    await logAudit(p, req.user.uid, 'tasks.team.create', `${team.id} ${team.name} members=${members.length}`, clientIp(req));
    await tell(p, team.chiefId, 'task_team_chief', `You are now the chief of the staff team "${team.name}".`, `Vous êtes désormais le chef de l'équipe "${team.name}".`);
    await Promise.all(members.filter((id) => id !== team.chiefId && id !== req.user.uid)
      .map((id) => tell(p, id, 'task_team_joined', `You were added to the staff team "${team.name}".`, `Vous avez été ajouté à l'équipe "${team.name}".`)));
    return reply.code(201).send({ team: serStaffTeam(team, { members: team.members.map((m) => ({ userId: m.userId, chief: m.userId === team.chiefId })) }) });
  });

  app.patch('/admin/tasks/teams/:id', { preHandler: requireCap('manage_teams') }, async (req, reply) => {
    const b = z.object({
      name: z.string().trim().min(2).max(60).optional(),
      description: z.string().trim().max(500).optional(),
      chiefId: z.string().trim().min(1).max(60).optional(),
      archived: z.boolean().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const team = await p.staffTeam.findUnique({ where: { id: req.params.id } });
    if (!team) return reply.code(404).send({ error: 'not_found' });
    const data = {};
    if (b.data.name != null) data.name = b.data.name;
    if (b.data.description != null) data.description = b.data.description;
    if (b.data.archived != null) data.archivedAt = b.data.archived ? new Date() : null;
    if (b.data.chiefId && b.data.chiefId !== team.chiefId) {
      if (!canNameChief(req.user, b.data.chiefId)) return reply.code(403).send({ error: 'cannot_name_chief' });
      const next = await p.user.findUnique({ where: { id: b.data.chiefId }, select: { id: true } });
      if (!next) return reply.code(400).send({ error: 'unknown_chief' });
      data.chiefId = next.id;
      // A chief who is not on their own team could not be handed a task by anybody.
      await p.staffTeamMember.upsert({
        where: { teamId_userId: { teamId: team.id, userId: next.id } },
        create: { teamId: team.id, userId: next.id, addedById: req.user.uid },
        update: {},
      });
      await tell(p, next.id, 'task_team_chief', `You are now the chief of the staff team "${team.name}".`, `Vous êtes désormais le chef de l'équipe "${team.name}".`);
    }
    const saved = await p.staffTeam.update({ where: { id: team.id }, data, include: { members: true } });
    await logAudit(p, req.user.uid, 'tasks.team.update', `${team.id} ${Object.keys(data).join(',')}`, clientIp(req));
    return { team: serStaffTeam(saved, { members: saved.members.map((m) => ({ userId: m.userId, chief: m.userId === saved.chiefId })) }) };
  });

  app.delete('/admin/tasks/teams/:id', { preHandler: requireCap('manage_teams') }, async (req, reply) => {
    const p = await db();
    const team = await p.staffTeam.findUnique({ where: { id: req.params.id } });
    if (!team) return reply.code(404).send({ error: 'not_found' });
    const tasks = await p.adminTask.findMany({ where: { teamId: team.id }, select: { id: true, state: true, assigneeIds: true } });
    const orphans = orphanedByTeamLoss(tasks);
    if (orphans.length) {
      await p.adminTask.updateMany({ where: { id: { in: orphans } }, data: { assigneeIds: [] } });
      await Promise.all(orphans.map((id) => event(p, id, req.user.uid, 'released', null, null, `team "${team.name}" was dissolved`)));
    }
    await p.staffTeam.delete({ where: { id: team.id } });
    await logAudit(p, req.user.uid, 'tasks.team.delete', `${team.id} ${team.name} orphaned=${orphans.length}`, clientIp(req));
    return { ok: true, orphaned: orphans.length };
  });

  app.post('/admin/tasks/teams/:id/members', { preHandler: board }, async (req, reply) => {
    const b = z.object({
      userId: z.string().trim().min(1).max(60).optional(),
      userIds: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
    }).refine((v) => v.userId || v.userIds?.length, { message: 'none' }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const team = await p.staffTeam.findUnique({ where: { id: req.params.id } });
    if (!team) return reply.code(404).send({ error: 'not_found' });
    const mine = await membershipOf(p, req.user.uid);
    if (!canManageTeam(req.user, team, mine)) return reply.code(403).send({ error: 'forbidden' });
    const ids = [...new Set([...(b.data.userIds || []), ...(b.data.userId ? [b.data.userId] : [])])];
    const found = await p.user.findMany({ where: { id: { in: ids } }, select: { id: true } });
    const unknown = ids.filter((id) => !found.some((u) => u.id === id));
    if (unknown.length) return reply.code(400).send({ error: 'unknown_user', ids: unknown });
    // All or nothing: a half-applied batch is a team nobody is sure about.
    const refused = [];
    for (const id of ids) {
      const staff = await isStaffAccount(p, id);
      if (!canAddMember(req.user, team, { id, staff }, mine)) refused.push(id);
    }
    if (refused.length) return reply.code(403).send({ error: 'cannot_add_member', ids: refused });
    for (const id of ids) {
      await p.staffTeamMember.upsert({
        where: { teamId_userId: { teamId: team.id, userId: id } },
        create: { teamId: team.id, userId: id, addedById: req.user.uid },
        update: {},
      });
      await tell(p, id, 'task_team_joined', `You were added to the staff team "${team.name}".`, `Vous avez été ajouté à l'équipe "${team.name}".`);
    }
    await logAudit(p, req.user.uid, 'tasks.team.member.add', `${team.id} ${ids.join(',')}`, clientIp(req));
    return { ok: true, added: ids.length };
  });

  app.delete('/admin/tasks/teams/:id/members/:userId', { preHandler: board }, async (req, reply) => {
    const p = await db();
    const team = await p.staffTeam.findUnique({ where: { id: req.params.id } });
    if (!team) return reply.code(404).send({ error: 'not_found' });
    const mine = await membershipOf(p, req.user.uid);
    if (!canRemoveMember(req.user, team, req.params.userId, mine)) return reply.code(403).send({ error: 'forbidden' });
    // The chief cannot be removed while they are the chief: name a new chief first, or dissolve.
    if (team.chiefId === req.params.userId) return reply.code(409).send({ error: 'chief_must_be_replaced' });
    const row = await p.staffTeamMember.findUnique({ where: { teamId_userId: { teamId: team.id, userId: req.params.userId } } });
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const tasks = await p.adminTask.findMany({ where: { teamId: team.id, assigneeIds: { has: req.params.userId } }, select: { id: true, state: true, assigneeIds: true, teamId: true } });
    const release = tasksToRelease(tasks, req.params.userId, team.id);
    if (release.length) {
      await pullAssignee(p, release, req.params.userId);
      await Promise.all(release.map((id) => event(p, id, req.user.uid, 'released', req.params.userId, null, 'left the team')));
    }
    await p.staffTeamMember.delete({ where: { teamId_userId: { teamId: team.id, userId: req.params.userId } } });
    await logAudit(p, req.user.uid, 'tasks.team.member.remove', `${team.id} ${req.params.userId} released=${release.length}`, clientIp(req));
    if (release.length) {
      await tell(p, team.chiefId, 'task_returned', `${release.length} task(s) came back to "${team.name}" when a member left.`, `${release.length} tâche(s) sont revenues à "${team.name}" après le départ d'un membre.`);
    }
    return { ok: true, released: release.length };
  });

  // ── Suggestions ───────────────────────────────────────────────────────────────────────
  // manage_tasks at the door: accepting one is filing and dispatching a task. Then, per row,
  // the capability of its SOURCE — somebody who cannot read the error log is not shown a
  // proposal made from it, even scrubbed.
  app.get('/admin/tasks/suggestions', { preHandler: requireCap('manage_tasks') }, async (req) => {
    const p = await db();
    await scanSuggestions(p, req.query?.refresh === '1').catch(() => null);
    const want = req.query?.state === 'dismissed' ? 'dismissed' : 'open';
    const rows = await p.taskSuggestion.findMany({ where: { state: want }, orderBy: { lastSeenAt: 'desc' }, take: 100 });
    const visible = rows.filter((s) => canSeeSuggestion(req.user, s));
    return { suggestions: visible.map(serSuggestion), hidden: rows.length - visible.length };
  });

  const suggestionFor = async (req, reply) => {
    const p = await db();
    const s = await p.taskSuggestion.findUnique({ where: { id: req.params.id } });
    // Not found and not yours to see are one answer: the existence of a proposal made from a
    // log you cannot read is itself something that log knows.
    if (!s || !canSeeSuggestion(req.user, s)) { reply.code(404).send({ error: 'not_found' }); return null; }
    return { p, s };
  };

  app.post('/admin/tasks/suggestions/:id/accept', { preHandler: requireCap('manage_tasks') }, async (req, reply) => {
    const b = z.object({
      teamId: z.string().trim().min(1).max(60).nullable().optional(),
      assigneeIds: idList.optional().default([]),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
      dueAt: z.string().datetime().nullable().optional(),
    }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const got = await suggestionFor(req, reply);
    if (!got) return reply;
    const { p, s } = got;
    if (s.state !== 'open') return reply.code(409).send({ error: 'already_decided' });
    const mine = await membershipOf(p, req.user.uid);
    const teamId = b.data.teamId || null;
    if (teamId && !(await p.staffTeam.findUnique({ where: { id: teamId }, select: { id: true } }))) return reply.code(400).send({ error: 'unknown_team' });
    const draft = { teamId, state: 'todo', assigneeIds: [], creatorId: req.user.uid };
    const members = await p.staffTeamMember.findMany({ select: { teamId: true, userId: true } });
    const change = assignmentChange(req.user, draft, b.data.assigneeIds, members, mine);
    if (!change.ok) return reply.code(403).send({ error: change.error });
    // Scrubbed again on the way out: the row was scrubbed when it was written, and a rule
    // that protects a secret should not depend on nobody ever editing that row by hand.
    const href = safeHref(s.href);
    const body = `${scrub(s.body, 2000)}${href ? `\n\n[Open the source](${href})` : ''}`;
    const task = await p.adminTask.create({
      data: {
        title: scrub(s.title, 160).length >= 3 ? scrub(s.title, 160) : 'Proposed task', body, priority: b.data.priority || s.priority, teamId,
        assigneeIds: change.next, creatorId: req.user.uid, dueAt: b.data.dueAt ? new Date(b.data.dueAt) : null,
      },
    });
    const claimed = await p.taskSuggestion.updateMany({ where: { id: s.id, state: 'open' }, data: { state: 'accepted', taskId: task.id, decidedById: req.user.uid, decidedAt: new Date() } });
    if (!claimed.count) {
      // Somebody accepted it in the same second. Theirs stands; ours never existed.
      await p.adminTask.delete({ where: { id: task.id } });
      return reply.code(409).send({ error: 'already_decided' });
    }
    await event(p, task.id, req.user.uid, 'created', null, task.title, `proposed by the site (${s.source})`);
    for (const id of change.added) {
      await event(p, task.id, req.user.uid, 'assigned', null, id);
      if (id !== req.user.uid) await tell(p, id, 'task_assigned', `A task was assigned to you: ${task.title}`, `Une tâche vous a été confiée : ${task.title}`);
    }
    await logAudit(p, req.user.uid, 'tasks.suggestion.accept', `${s.id} ${s.dedupKey} -> ${task.id}`, clientIp(req));
    return reply.code(201).send({ task: serTask(task) });
  });

  app.post('/admin/tasks/suggestions/:id/dismiss', { preHandler: requireCap('manage_tasks') }, async (req, reply) => {
    const got = await suggestionFor(req, reply);
    if (!got) return reply;
    const { p, s } = got;
    if (s.state !== 'open') return reply.code(409).send({ error: 'already_decided' });
    // undo: a dismissal is a state, not a deletion — /restore puts it back exactly as it was.
    await p.taskSuggestion.update({ where: { id: s.id }, data: { state: 'dismissed', decidedById: req.user.uid, decidedAt: new Date() } });
    return { ok: true };
  });

  app.post('/admin/tasks/suggestions/:id/restore', { preHandler: requireCap('manage_tasks') }, async (req, reply) => {
    const got = await suggestionFor(req, reply);
    if (!got) return reply;
    const { p, s } = got;
    if (s.state !== 'dismissed') return reply.code(409).send({ error: 'not_dismissed' });
    await p.taskSuggestion.update({ where: { id: s.id }, data: { state: 'open', decidedById: null, decidedAt: null } });
    return { ok: true };
  });

  // ── Tasks ─────────────────────────────────────────────────────────────────────────────
  app.get('/admin/tasks', { preHandler: board }, async (req) => {
    const p = await db();
    const mine = await membershipOf(p, req.user.uid);
    const q = req.query || {};
    const page = Math.max(0, parseInt(q.page, 10) || 0);
    const and = [visibilityWhere(req.user, mine)];
    if (TASK_STATES.includes(q.state)) and.push({ state: q.state });
    else if (q.state === 'open') and.push({ state: { notIn: TERMINAL_STATES } });
    if (q.teamId) and.push({ teamId: q.teamId === 'none' ? null : String(q.teamId) });
    if (q.assignee) and.push(q.assignee === 'none' ? { assigneeIds: { isEmpty: true } } : { assigneeIds: { has: String(q.assignee) } });
    if (q.priority && TASK_PRIORITIES.includes(q.priority)) and.push({ priority: q.priority });
    const text = String(q.q || '').trim().slice(0, 80);
    if (text) and.push({ OR: [{ title: { contains: text, mode: 'insensitive' } }, { body: { contains: text, mode: 'insensitive' } }] });
    // `scope=mine` is the default view: what is on MY name, plus what I asked for.
    if (q.scope === 'mine') and.push({ OR: [{ assigneeIds: { has: req.user.uid } }, { creatorId: req.user.uid }] });
    else if (q.scope === 'team') and.push({ teamId: { in: mine.memberOf.length ? mine.memberOf : ['__no_team__'] } });
    if (q.exclude) and.push({ id: { not: String(q.exclude) } });
    const where = { AND: and };

    const rows = await p.adminTask.findMany({ where, orderBy: { createdAt: 'desc' }, skip: page * PAGE, take: PAGE });
    // Belt and braces: the where above IS the visibility rule; this is the same rule again,
    // so a mistake in one of them hides a row rather than showing one.
    const visible = rows.filter((t) => canView(req.user, t, mine));
    const people = await peopleFor(p, visible.flatMap((t) => [...assigneesOf(t), t.creatorId]));
    return {
      page,
      pageSize: PAGE,
      total: await p.adminTask.count({ where }),
      tasks: sortTasks(visible).map((t) => serTask(t, {
        standing: standingFor(req.user, t, mine),
        can: { edit: canEdit(req.user, t, mine), assign: canAssign(req.user, t, mine), release: canRelease(req.user, t, mine), del: canDelete(req.user) },
      })),
      people,
    };
  });

  app.post('/admin/tasks', { preHandler: board }, async (req, reply) => {
    const b = z.object({
      title: z.string().trim().min(3).max(160),
      body: z.string().max(20000).optional().default(''),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).optional().default('normal'),
      teamId: z.string().trim().min(1).max(60).nullable().optional(),
      assigneeIds: idList.optional(),
      assigneeId: z.string().trim().min(1).max(60).nullable().optional(),
      dueAt: z.string().datetime().nullable().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const mine = await membershipOf(p, req.user.uid);
    const teamId = b.data.teamId || null;
    // Filing a task under a team you are not on is dispatching for somebody else's team.
    if (teamId && !isDispatcher(req.user) && !mine.memberOf.includes(teamId)) return reply.code(403).send({ error: 'forbidden' });
    const want = b.data.assigneeIds || (b.data.assigneeId ? [b.data.assigneeId] : []);
    const draft = { teamId, state: 'todo', assigneeIds: [], creatorId: req.user.uid };
    const members = await p.staffTeamMember.findMany({ select: { teamId: true, userId: true } });
    // Putting YOURSELF on a task you file is always allowed — taking a job is not dispatching.
    const others = want.filter((id) => id !== req.user.uid);
    const change = assignmentChange(req.user, draft, others, members, mine);
    if (!change.ok) return reply.code(403).send({ error: change.error === 'too_many_assignees' ? change.error : 'cannot_assign' });
    const assigneeIds = [...new Set(want)];
    if (assigneeIds.length > MAX_ASSIGNEES) return reply.code(400).send({ error: 'too_many_assignees' });
    const task = await p.adminTask.create({
      data: {
        title: b.data.title, body: b.data.body, priority: b.data.priority, teamId, assigneeIds,
        creatorId: req.user.uid, dueAt: b.data.dueAt ? new Date(b.data.dueAt) : null,
      },
    });
    await event(p, task.id, req.user.uid, 'created', null, task.title);
    for (const id of assigneeIds) {
      await event(p, task.id, req.user.uid, 'assigned', null, id);
      if (id !== req.user.uid) await tell(p, id, 'task_assigned', `A task was assigned to you: ${task.title}`, `Une tâche vous a été confiée : ${task.title}`);
    }
    return reply.code(201).send({ task: serTask(task) });
  });

  app.get('/admin/tasks/:id', { preHandler: board }, async (req, reply) => {
    const p = await db();
    const mine = await membershipOf(p, req.user.uid);
    const task = await p.adminTask.findUnique({ where: { id: req.params.id } });
    if (!task) return reply.code(404).send({ error: 'not_found' });
    if (!canView(req.user, task, mine)) return reply.code(403).send({ error: 'forbidden' });
    const [events, members, links] = await Promise.all([
      p.adminTaskEvent.findMany({ where: { taskId: task.id }, orderBy: { createdAt: 'asc' }, take: 500 }),
      p.staffTeamMember.findMany({ select: { teamId: true, userId: true } }),
      p.adminTaskLink.findMany({ where: { OR: [{ fromId: task.id }, { toId: task.id }] }, orderBy: { createdAt: 'asc' } }),
    ]);
    const assignable = assignableIds(req.user, task, members, mine);
    // A linked task you may not read is shown as "a task you cannot open", never by its title:
    // the link must not become a window onto another team's board.
    const others = await p.adminTask.findMany({ where: { id: { in: links.map((l) => linkFromSide(l, task.id).otherId) } } });
    const byId = Object.fromEntries(others.map((t) => [t.id, t]));
    const linkRows = links.map((l) => {
      const side = linkFromSide(l, task.id);
      const other = byId[side.otherId];
      const readable = !!other && canView(req.user, other, mine);
      return { id: l.id, kind: side.kind, task: readable ? { id: other.id, title: other.title, state: other.state } : null };
    });
    // Counted over every blocker, readable or not: "blocked by 1 task you cannot open" is
    // still the truth about why this one should wait.
    const openBlockers = links.filter((l) => l.kind === 'blocks' && l.toId === task.id && byId[l.fromId]
      && !TERMINAL_STATES.includes(byId[l.fromId].state)).length;
    return {
      task: serTask(task, {
        standing: standingFor(req.user, task, mine),
        can: {
          edit: canEdit(req.user, task, mine), assign: canAssign(req.user, task, mine),
          release: canRelease(req.user, task, mine), comment: canComment(req.user, task, mine),
          moveTeam: canMoveTeam(req.user), del: canDelete(req.user), link: canEdit(req.user, task, mine),
          grab: !assigneesOf(task).length && !TERMINAL_STATES.includes(task.state) && standingFor(req.user, task, mine) !== 'none',
        },
        states: TASK_STATES.filter((s) => s !== task.state && canSetState(req.user, task, s, mine)),
        assignable,
        links: linkRows,
        openBlockers,
      }),
      events: events.map(serEvent),
      people: await peopleFor(p, [...assigneesOf(task), task.creatorId, task.closedById, ...assignable, ...events.map((e) => e.actorId), ...events.filter((e) => e.kind === 'assigned' || e.kind === 'released').flatMap((e) => [e.fromValue, e.toValue])]),
    };
  });

  app.patch('/admin/tasks/:id', { preHandler: board }, async (req, reply) => {
    const b = z.object({
      title: z.string().trim().min(3).max(160).optional(),
      body: z.string().max(20000).optional(),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
      dueAt: z.string().datetime().nullable().optional(),
      teamId: z.string().trim().min(1).max(60).nullable().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const mine = await membershipOf(p, req.user.uid);
    const task = await p.adminTask.findUnique({ where: { id: req.params.id } });
    if (!task) return reply.code(404).send({ error: 'not_found' });
    if (!canEdit(req.user, task, mine)) return reply.code(403).send({ error: 'forbidden' });
    const data = {};
    if (b.data.title != null) data.title = b.data.title;
    if (b.data.body != null) data.body = b.data.body;
    if (b.data.priority != null) data.priority = b.data.priority;
    if (b.data.dueAt !== undefined) data.dueAt = b.data.dueAt ? new Date(b.data.dueAt) : null;
    if (b.data.teamId !== undefined && (b.data.teamId || null) !== task.teamId) {
      if (!canMoveTeam(req.user)) return reply.code(403).send({ error: 'forbidden' });
      data.teamId = b.data.teamId || null;
      // The people belonged to the OLD team: carrying them over would leave a task in team B
      // worked by somebody team B's chief cannot see, let alone reassign.
      if (assigneesOf(task).length) data.assigneeIds = [];
    }
    const saved = await p.adminTask.update({ where: { id: task.id }, data });
    if (data.priority && data.priority !== task.priority) await event(p, task.id, req.user.uid, 'priority', task.priority, data.priority);
    if (data.dueAt !== undefined) await event(p, task.id, req.user.uid, 'due', task.dueAt ? task.dueAt.toISOString() : null, data.dueAt ? data.dueAt.toISOString() : null);
    if (data.teamId !== undefined) {
      await event(p, task.id, req.user.uid, 'team', task.teamId, data.teamId);
      for (const id of assigneesOf(task)) await event(p, task.id, req.user.uid, 'released', id, null, 'the task moved to another team');
    }
    return { task: serTask(saved) };
  });

  app.post('/admin/tasks/:id/assign', { preHandler: board }, async (req, reply) => {
    const b = z.object({
      userIds: z.array(z.string().trim().min(1).max(60)).max(MAX_ASSIGNEES + 1).optional(),
      // The single-person form the first version spoke. null = "take me off" for somebody who
      // may only release, "clear it" for a dispatcher.
      userId: z.string().trim().min(1).max(60).nullable().optional(),
    }).refine((v) => v.userIds !== undefined || v.userId !== undefined, { message: 'none' }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const mine = await membershipOf(p, req.user.uid);
    const task = await p.adminTask.findUnique({ where: { id: req.params.id } });
    if (!task) return reply.code(404).send({ error: 'not_found' });
    if (!canView(req.user, task, mine)) return reply.code(403).send({ error: 'forbidden' });
    const cur = assigneesOf(task);
    let next = b.data.userIds;
    if (next === undefined) {
      if (b.data.userId === null) next = canAssign(req.user, task, mine) ? [] : cur.filter((id) => id !== req.user.uid);
      else next = [b.data.userId];
    }
    const members = await p.staffTeamMember.findMany({ select: { teamId: true, userId: true } });
    const change = assignmentChange(req.user, task, next, members, mine);
    if (!change.ok) {
      const code = change.error === 'task_closed' ? 409 : change.error === 'too_many_assignees' ? 400 : 403;
      return reply.code(code).send({ error: change.error });
    }
    if (!change.added.length && !change.removed.length) return { task: serTask(task) };
    const saved = await p.adminTask.update({ where: { id: task.id }, data: { assigneeIds: change.next } });
    for (const id of change.removed) await event(p, task.id, req.user.uid, 'released', id, null);
    for (const id of change.added) await event(p, task.id, req.user.uid, 'assigned', null, id);
    await Promise.all(change.added.filter((id) => id !== req.user.uid)
      .map((id) => tell(p, id, 'task_assigned', `A task was assigned to you: ${task.title}`, `Une tâche vous a été confiée : ${task.title}`)));
    // Somebody just lost a task they were holding; they should not find out by refreshing.
    await Promise.all(change.removed.filter((id) => id !== req.user.uid)
      .map((id) => tell(p, id, 'task_reassigned', `You were taken off a task: ${task.title}`, `Vous avez été retiré d'une tâche : ${task.title}`)));
    // Back in the pool with nobody on it: the chief should see it come back.
    if (!change.next.length && task.teamId) {
      const team = await p.staffTeam.findUnique({ where: { id: task.teamId }, select: { chiefId: true } });
      if (team && team.chiefId !== req.user.uid) await tell(p, team.chiefId, 'task_returned', `A task came back to the pool: ${task.title}`, `Une tâche est revenue dans la file : ${task.title}`);
    }
    return { task: serTask(saved) };
  });

  app.post('/admin/tasks/:id/state', { preHandler: board }, async (req, reply) => {
    const b = z.object({ state: z.enum(['todo', 'in_progress', 'blocked', 'done', 'cancelled']), note: z.string().trim().max(NOTE_MAX).optional().default('') }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const mine = await membershipOf(p, req.user.uid);
    const task = await p.adminTask.findUnique({ where: { id: req.params.id } });
    if (!task) return reply.code(404).send({ error: 'not_found' });
    if (!canSetState(req.user, task, b.data.state, mine)) return reply.code(403).send({ error: 'forbidden' });
    const closing = TERMINAL_STATES.includes(b.data.state);
    const reopening = TERMINAL_STATES.includes(task.state) && !closing;
    const saved = await p.adminTask.update({
      where: { id: task.id },
      data: { state: b.data.state, closedAt: closing ? new Date() : null, closedById: closing ? req.user.uid : null },
    });
    await event(p, task.id, req.user.uid, reopening ? 'reopened' : 'state', task.state, b.data.state, b.data.note);
    const targets = [...new Set([task.creatorId, ...assigneesOf(task)].filter((id) => id && id !== req.user.uid))];
    await Promise.all(targets.map((id) => tell(p, id, 'task_state', `Task "${task.title}" is now ${b.data.state}.`, `La tâche "${task.title}" est maintenant : ${b.data.state}.`)));
    return { task: serTask(saved) };
  });

  app.post('/admin/tasks/:id/note', { preHandler: board }, async (req, reply) => {
    const b = z.object({ note: z.string().trim().min(1).max(NOTE_MAX) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const mine = await membershipOf(p, req.user.uid);
    const task = await p.adminTask.findUnique({ where: { id: req.params.id } });
    if (!task) return reply.code(404).send({ error: 'not_found' });
    if (!canComment(req.user, task, mine)) return reply.code(403).send({ error: 'forbidden' });
    await event(p, task.id, req.user.uid, 'note', null, null, b.data.note);
    const targets = [...new Set([task.creatorId, ...assigneesOf(task)].filter((id) => id && id !== req.user.uid))];
    await Promise.all(targets.map((id) => tell(p, id, 'task_note', `New note on "${task.title}".`, `Nouvelle note sur "${task.title}".`)));
    return { ok: true };
  });

  // ── Links ─────────────────────────────────────────────────────────────────────────────
  app.post('/admin/tasks/:id/links', { preHandler: board }, async (req, reply) => {
    const b = z.object({ otherId: z.string().trim().min(1).max(60), kind: z.enum(['blocks', 'blocked_by', 'relates']) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const mine = await membershipOf(p, req.user.uid);
    const [task, other] = await Promise.all([
      p.adminTask.findUnique({ where: { id: req.params.id } }),
      p.adminTask.findUnique({ where: { id: b.data.otherId } }),
    ]);
    if (!task) return reply.code(404).send({ error: 'not_found' });
    if (!canEdit(req.user, task, mine)) return reply.code(403).send({ error: 'forbidden' });
    // A task you cannot read answers exactly like one that does not exist.
    if (!other || !canLink(req.user, task, other, mine)) return reply.code(404).send({ error: 'other_not_found' });
    if (other.id === task.id) return reply.code(400).send({ error: 'self_link' });
    const kind = b.data.kind === 'relates' ? 'relates' : 'blocks';
    const [fromId, toId] = b.data.kind === 'blocked_by' ? [other.id, task.id] : [task.id, other.id];
    if (kind === 'relates') {
      const dup = await p.adminTaskLink.findFirst({ where: { kind: 'relates', OR: [{ fromId, toId }, { fromId: toId, toId: fromId }] }, select: { id: true } });
      if (dup) return reply.code(409).send({ error: 'already_linked' });
    } else {
      const edges = await p.adminTaskLink.findMany({ where: { kind: 'blocks' }, select: { fromId: true, toId: true } });
      if (edges.some((e) => e.fromId === fromId && e.toId === toId)) return reply.code(409).send({ error: 'already_linked' });
      if (wouldCycle(edges, fromId, toId)) return reply.code(409).send({ error: 'link_cycle' });
    }
    const link = await p.adminTaskLink.create({ data: { fromId, toId, kind, createdById: req.user.uid } }).catch(() => null);
    if (!link) return reply.code(409).send({ error: 'already_linked' });
    await event(p, task.id, req.user.uid, 'link', b.data.kind, other.id);
    return reply.code(201).send({ link: { id: link.id, kind: b.data.kind, otherId: other.id } });
  });

  app.delete('/admin/tasks/:id/links/:linkId', { preHandler: board }, async (req, reply) => {
    const p = await db();
    const mine = await membershipOf(p, req.user.uid);
    const task = await p.adminTask.findUnique({ where: { id: req.params.id } });
    if (!task) return reply.code(404).send({ error: 'not_found' });
    if (!canEdit(req.user, task, mine)) return reply.code(403).send({ error: 'forbidden' });
    const link = await p.adminTaskLink.findUnique({ where: { id: req.params.linkId } });
    if (!link || (link.fromId !== task.id && link.toId !== task.id)) return reply.code(404).send({ error: 'not_found' });
    // undo: the edge is two ids and a kind, all still on screen; re-adding it is one pick in
    // the same form, and the history keeps both the link and the unlink.
    await p.adminTaskLink.delete({ where: { id: link.id } });
    const side = linkFromSide(link, task.id);
    await event(p, task.id, req.user.uid, 'unlink', side.kind, side.otherId);
    return { ok: true };
  });

  app.delete('/admin/tasks/:id', { preHandler: board }, async (req, reply) => {
    if (!canDelete(req.user)) return reply.code(403).send({ error: 'forbidden' });
    const p = await db();
    const task = await p.adminTask.findUnique({ where: { id: req.params.id }, select: { id: true, title: true } });
    if (!task) return reply.code(404).send({ error: 'not_found' });
    await p.adminTask.delete({ where: { id: task.id } });
    await logAudit(p, req.user.uid, 'tasks.delete', `${task.id} ${task.title}`, clientIp(req));
    return { ok: true };
  });
}
