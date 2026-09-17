// Staff task board — work handed to admins and moderators, in teams with a chief.
//
//   GET    /admin/tasks/meta                          the board's vocabulary + who I may pick
//   GET    /admin/tasks/teams                         the teams, with their chief and members
//   POST   /admin/tasks/teams                         create (admin)
//   PATCH  /admin/tasks/teams/:id                     name / description / chief / archive (admin)
//   DELETE /admin/tasks/teams/:id                     dissolve (admin) — the tasks survive
//   POST   /admin/tasks/teams/:id/members             { userId } add (admin or the chief)
//   DELETE /admin/tasks/teams/:id/members/:userId     remove, or leave (self)
//   GET    /admin/tasks?scope=&state=&teamId=&assignee=&q=
//   POST   /admin/tasks                               create
//   GET    /admin/tasks/:id                           one task + its whole history
//   PATCH  /admin/tasks/:id                           title / body / priority / dueAt / teamId
//   POST   /admin/tasks/:id/assign                    { userId } or { userId: null } to release
//   POST   /admin/tasks/:id/state                     { state, note? }
//   POST   /admin/tasks/:id/note                      { note }
//   DELETE /admin/tasks/:id                           (admin only)
//
// THE GUARD, AND WHY IT IS NOT A NEW CAPABILITY
//
// Every route here goes through `board`, which is `requireEditor()` (signed in, 2FA-walled,
// live role and grants on `req.user`) followed by "is this the admin surface's population, or
// somebody on a staff team". No new entry in CAPABILITIES, for a reason that is a property of
// the feature rather than of the repo: a capability is a thing an admin GRANTS, and this board
// is where an admin hands work to people who are already staff. A `manage_tasks` grant would
// be a permission to receive a task, which is not a permission anybody needs.
//
// What that costs is that the board cannot be delegated separately — whoever is on the admin
// surface can open it. What it buys is that a chief needs nothing granted to dispatch inside
// their own team, which is the entire point of having chiefs.
//
// Every authorisation question below is answered by lib/tasks.mjs, never inline. The screen
// draws its buttons from the same functions; a rule that lives in two places is a rule that
// will disagree with itself.
import { z } from 'zod';
import { db, requireEditor, notify, logAudit, clientIp } from '../lib/lib.mjs';
import {
  TASK_STATES, TASK_PRIORITIES, TERMINAL_STATES, isStaffish, isAdmin, standingFor,
  canView, canAssign, canRelease, canEdit, canMoveTeam, canSetState, canComment, canDelete,
  canManageTeam, canRunTeams, assignableIds, tasksToRelease, orphanedByTeamLoss,
  sortTasks, slugifyTeamName, serTask, serEvent, serStaffTeam,
} from '../lib/tasks.mjs';

const PAGE = 50;
const NOTE_MAX = 2000;

/** The teams this account is on, and the ones it is chief of. One query, once per request. */
async function membershipOf(p, uid) {
  const [rows, chief] = await Promise.all([
    p.staffTeamMember.findMany({ where: { userId: uid }, select: { teamId: true } }),
    p.staffTeam.findMany({ where: { chiefId: uid, archivedAt: null }, select: { id: true } }),
  ]);
  return { memberOf: rows.map((r) => r.teamId), chiefOf: chief.map((r) => r.id) };
}

/**
 * Display names for a set of ids, in one round trip.
 *
 * An id with no row comes back missing rather than as an invented name: the account was
 * deleted, the task still records that they did the work, and the screen says "unknown
 * account" instead of pretending the row is fine.
 */
async function peopleFor(p, ids) {
  const want = [...new Set(ids.filter(Boolean))];
  if (!want.length) return {};
  const rows = await p.user.findMany({ where: { id: { in: want } }, select: { id: true, displayName: true, role: true, avatar: true } });
  return Object.fromEntries(rows.map((u) => [u.id, { id: u.id, displayName: u.displayName, role: u.role, avatar: u.avatar || null }]));
}

/** Append one history row. Never throws into the caller: a lost event must not lose the write. */
const event = (p, taskId, actorId, kind, from = null, to = null, note = '') =>
  p.adminTaskEvent.create({ data: { taskId, actorId, kind, fromValue: from ? String(from) : null, toValue: to ? String(to) : null, note: String(note || '').slice(0, NOTE_MAX) } }).catch(() => null);

/**
 * Tell somebody a task landed on them.
 *
 * The kind is `task_*`, which `notifCategory` does not match, so it falls through to the
 * locked `security` category and CANNOT be switched off. That is deliberate and it is the
 * honest reading of the switch: the preference screen offers to mute categories of things the
 * site sends you unasked, and a task your chief just put your name on is not that. The
 * trade-off is real — somebody with a busy board cannot quiet it — and the answer to that is
 * fewer tasks, not a mute.
 */
const tell = (p, userId, kind, body, bodyFr) =>
  (userId ? notify(p, userId, kind, body, { bodyFr, href: '/admin?s=tasks' }) : Promise.resolve());

export default async function taskRoutes(app) {
  /**
   * The door: requireEditor (signed in, 2FA, live role and grants), then "are you on the
   * admin surface at all".
   *
   * TWO hooks in an array rather than one wrapper calling the other. Fastify 5 removed
   * `reply.sent`, so a wrapper has no way to ask whether the guard it just awaited already
   * refused — it would run its own check over a request that was already rejected, and
   * `req.user` would be undefined. An array is the framework's own answer: the chain stops
   * the moment a hook sends.
   *
   * The membership count is only paid for by accounts that fail the cheap test, which is the
   * rare case (a non-staff account somebody put on a team on purpose).
   */
  const onlyStaff = async (req, reply) => {
    if (isStaffish(req.user)) return;
    const p = await db();
    const onTeam = await p.staffTeamMember.count({ where: { userId: req.user.uid } }).catch(() => 0);
    if (!isStaffish(req.user, onTeam > 0)) return reply.code(403).send({ error: 'forbidden' });
  };
  const board = [requireEditor(), onlyStaff];

  // ── Vocabulary ────────────────────────────────────────────────────────────────────────
  // One call the screen makes on open, so it never has to hard-code the states, the
  // priorities, or the rule about who it may offer as an assignee.
  app.get('/admin/tasks/meta', { preHandler: board }, async (req) => {
    const p = await db();
    const mine = await membershipOf(p, req.user.uid);
    const teams = await p.staffTeam.findMany({ where: { archivedAt: null }, orderBy: { name: 'asc' }, include: { members: { select: { userId: true } } } });
    const ids = [...new Set(teams.flatMap((t) => [t.chiefId, ...t.members.map((m) => m.userId)]))];
    return {
      states: TASK_STATES,
      priorities: TASK_PRIORITIES,
      terminal: TERMINAL_STATES,
      me: { id: req.user.uid, admin: isAdmin(req.user), ...mine },
      teams: teams.map((t) => serStaffTeam(t, { memberIds: t.members.map((m) => m.userId) })),
      people: await peopleFor(p, ids),
    };
  });

  // ── Teams ─────────────────────────────────────────────────────────────────────────────
  app.get('/admin/tasks/teams', { preHandler: board }, async (req) => {
    const p = await db();
    const teams = await p.staffTeam.findMany({ orderBy: [{ archivedAt: 'asc' }, { name: 'asc' }], include: { members: { orderBy: { createdAt: 'asc' } }, _count: { select: { tasks: true } } } });
    const people = await peopleFor(p, teams.flatMap((t) => [t.chiefId, ...t.members.map((m) => m.userId)]));
    return {
      teams: teams.map((t) => serStaffTeam(t, {
        members: t.members.map((m) => ({ userId: m.userId, addedAt: m.createdAt, chief: m.userId === t.chiefId })),
        taskCount: t._count.tasks,
        canManage: canManageTeam(req.user, t),
      })),
      people,
      canRunTeams: canRunTeams(req.user),
    };
  });

  app.post('/admin/tasks/teams', { preHandler: board }, async (req, reply) => {
    if (!canRunTeams(req.user)) return reply.code(403).send({ error: 'forbidden' });
    const b = z.object({
      name: z.string().trim().min(2).max(60),
      description: z.string().trim().max(500).optional().default(''),
      chiefId: z.string().trim().min(1).max(60),
      memberIds: z.array(z.string().trim().min(1).max(60)).max(100).optional().default([]),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const chief = await p.user.findUnique({ where: { id: b.data.chiefId }, select: { id: true, displayName: true } });
    if (!chief) return reply.code(400).send({ error: 'unknown_chief' });
    // The chief is a member row too — see the schema note. Written in the same statement so
    // the "the chief is always on the team" invariant cannot be half-true.
    const members = [...new Set([chief.id, ...b.data.memberIds])];
    const base = slugifyTeamName(b.data.name);
    let slug = base;
    for (let i = 2; await p.staffTeam.findUnique({ where: { slug }, select: { id: true } }); i++) slug = `${base}-${i}`;
    const team = await p.staffTeam.create({
      data: {
        name: b.data.name, description: b.data.description, slug, chiefId: chief.id, createdById: req.user.uid,
        members: { create: members.map((userId) => ({ userId, addedById: req.user.uid })) },
      },
      include: { members: true },
    });
    await logAudit(p, req.user.uid, 'tasks.team.create', `${team.id} ${team.name}`, clientIp(req));
    await tell(p, chief.id, 'task_team_chief', `You are now the chief of the staff team "${team.name}".`, `Vous etes desormais le chef de l'equipe "${team.name}".`);
    return reply.code(201).send({ team: serStaffTeam(team, { members: team.members.map((m) => ({ userId: m.userId, chief: m.userId === team.chiefId })) }) });
  });

  app.patch('/admin/tasks/teams/:id', { preHandler: board }, async (req, reply) => {
    if (!canRunTeams(req.user)) return reply.code(403).send({ error: 'forbidden' });
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
      const next = await p.user.findUnique({ where: { id: b.data.chiefId }, select: { id: true } });
      if (!next) return reply.code(400).send({ error: 'unknown_chief' });
      data.chiefId = next.id;
      // A chief who is not on their own team could not be handed a task by anybody, including
      // themselves. Upsert rather than create: the usual case is promoting an existing member.
      await p.staffTeamMember.upsert({
        where: { teamId_userId: { teamId: team.id, userId: next.id } },
        create: { teamId: team.id, userId: next.id, addedById: req.user.uid },
        update: {},
      });
      await tell(p, next.id, 'task_team_chief', `You are now the chief of the staff team "${team.name}".`, `Vous etes desormais le chef de l'equipe "${team.name}".`);
    }
    const saved = await p.staffTeam.update({ where: { id: team.id }, data, include: { members: true } });
    await logAudit(p, req.user.uid, 'tasks.team.update', `${team.id} ${Object.keys(data).join(',')}`, clientIp(req));
    return { team: serStaffTeam(saved, { members: saved.members.map((m) => ({ userId: m.userId, chief: m.userId === saved.chiefId })) }) };
  });

  app.delete('/admin/tasks/teams/:id', { preHandler: board }, async (req, reply) => {
    if (!canRunTeams(req.user)) return reply.code(403).send({ error: 'forbidden' });
    const p = await db();
    const team = await p.staffTeam.findUnique({ where: { id: req.params.id } });
    if (!team) return reply.code(404).send({ error: 'not_found' });
    // What the team's work becomes is a decision, not a side effect — see orphanedByTeamLoss.
    const tasks = await p.adminTask.findMany({ where: { teamId: team.id }, select: { id: true, state: true, assigneeId: true } });
    const orphans = orphanedByTeamLoss(tasks);
    if (orphans.length) {
      await p.adminTask.updateMany({ where: { id: { in: orphans } }, data: { assigneeId: null } });
      await Promise.all(orphans.map((id) => event(p, id, req.user.uid, 'released', null, null, `team "${team.name}" was dissolved`)));
    }
    await p.staffTeam.delete({ where: { id: team.id } });
    await logAudit(p, req.user.uid, 'tasks.team.delete', `${team.id} ${team.name} orphaned=${orphans.length}`, clientIp(req));
    return { ok: true, orphaned: orphans.length };
  });

  app.post('/admin/tasks/teams/:id/members', { preHandler: board }, async (req, reply) => {
    const b = z.object({ userId: z.string().trim().min(1).max(60) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const team = await p.staffTeam.findUnique({ where: { id: req.params.id } });
    if (!team) return reply.code(404).send({ error: 'not_found' });
    if (!canManageTeam(req.user, team)) return reply.code(403).send({ error: 'forbidden' });
    const who = await p.user.findUnique({ where: { id: b.data.userId }, select: { id: true, displayName: true } });
    if (!who) return reply.code(400).send({ error: 'unknown_user' });
    await p.staffTeamMember.upsert({
      where: { teamId_userId: { teamId: team.id, userId: who.id } },
      create: { teamId: team.id, userId: who.id, addedById: req.user.uid },
      update: {},
    });
    await logAudit(p, req.user.uid, 'tasks.team.member.add', `${team.id} ${who.id}`, clientIp(req));
    await tell(p, who.id, 'task_team_joined', `You were added to the staff team "${team.name}".`, `Vous avez ete ajoute a l'equipe "${team.name}".`);
    return { ok: true };
  });

  app.delete('/admin/tasks/teams/:id/members/:userId', { preHandler: board }, async (req, reply) => {
    const p = await db();
    const team = await p.staffTeam.findUnique({ where: { id: req.params.id } });
    if (!team) return reply.code(404).send({ error: 'not_found' });
    const self = req.params.userId === req.user.uid;
    if (!self && !canManageTeam(req.user, team)) return reply.code(403).send({ error: 'forbidden' });
    // The chief cannot be removed while they are the chief: a team whose dispatcher has left
    // is a team where nobody can hand out the work, and the board would give no clue why.
    // Name a new chief first (admin), or dissolve the team.
    if (team.chiefId === req.params.userId) return reply.code(409).send({ error: 'chief_must_be_replaced' });
    const row = await p.staffTeamMember.findUnique({ where: { teamId_userId: { teamId: team.id, userId: req.params.userId } } });
    if (!row) return reply.code(404).send({ error: 'not_found' });

    // Their open tasks go back to the team's pool. See tasksToRelease for why not the
    // alternatives.
    const tasks = await p.adminTask.findMany({ where: { teamId: team.id, assigneeId: req.params.userId }, select: { id: true, state: true, assigneeId: true, teamId: true, title: true } });
    const release = tasksToRelease(tasks, req.params.userId, team.id);
    if (release.length) {
      await p.adminTask.updateMany({ where: { id: { in: release } }, data: { assigneeId: null } });
      await Promise.all(release.map((id) => event(p, id, req.user.uid, 'released', req.params.userId, null, 'left the team')));
    }
    await p.staffTeamMember.delete({ where: { teamId_userId: { teamId: team.id, userId: req.params.userId } } });
    await logAudit(p, req.user.uid, 'tasks.team.member.remove', `${team.id} ${req.params.userId} released=${release.length}`, clientIp(req));
    if (release.length) {
      await tell(p, team.chiefId, 'task_returned', `${release.length} task(s) came back to "${team.name}" when a member left.`, `${release.length} tache(s) sont revenues a "${team.name}" apres le depart d'un membre.`);
    }
    return { ok: true, released: release.length };
  });

  // ── Tasks ─────────────────────────────────────────────────────────────────────────────
  app.get('/admin/tasks', { preHandler: board }, async (req) => {
    const p = await db();
    const mine = await membershipOf(p, req.user.uid);
    const q = req.query || {};
    const page = Math.max(0, parseInt(q.page, 10) || 0);
    const where = {};
    if (TASK_STATES.includes(q.state)) where.state = q.state;
    else if (q.state === 'open') where.state = { notIn: TERMINAL_STATES };
    if (q.teamId) where.teamId = q.teamId === 'none' ? null : q.teamId;
    if (q.assignee) where.assigneeId = q.assignee === 'none' ? null : q.assignee;
    if (q.priority && TASK_PRIORITIES.includes(q.priority)) where.priority = q.priority;
    const text = String(q.q || '').trim().slice(0, 80);
    if (text) where.OR = [{ title: { contains: text, mode: 'insensitive' } }, { body: { contains: text, mode: 'insensitive' } }];
    // `scope=mine` is the default view: what is on MY name, plus what I asked for. A board
    // that opens on everything is a board nobody reads.
    if (q.scope === 'mine') where.AND = [{ OR: [{ assigneeId: req.user.uid }, { creatorId: req.user.uid }] }];
    // A sentinel that matches no id, so "my teams" for somebody on no team returns
    // nothing rather than everything. It was a literal NUL byte, which made this file
    // read as binary to grep and would have been rejected by Postgres the first time a
    // staff member on no team filtered by team: NUL is not valid in a text value.
    else if (q.scope === 'team') where.AND = [{ teamId: { in: mine.memberOf.length ? mine.memberOf : ['__no_team__'] } }];

    const rows = await p.adminTask.findMany({ where, orderBy: { createdAt: 'desc' }, skip: page * PAGE, take: PAGE });
    const visible = rows.filter((t) => canView(req.user, t, mine));
    const people = await peopleFor(p, visible.flatMap((t) => [t.assigneeId, t.creatorId]));
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
      assigneeId: z.string().trim().min(1).max(60).nullable().optional(),
      dueAt: z.string().datetime().nullable().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const mine = await membershipOf(p, req.user.uid);
    const teamId = b.data.teamId || null;
    // Filing a task under a team you are neither chief nor member of is dispatching for
    // somebody else's team; only an admin may.
    if (teamId && !isAdmin(req.user) && !mine.memberOf.includes(teamId)) return reply.code(403).send({ error: 'forbidden' });

    const draft = { teamId, state: 'todo', assigneeId: null, creatorId: req.user.uid };
    let assigneeId = null;
    if (b.data.assigneeId) {
      const members = await p.staffTeamMember.findMany({ select: { teamId: true, userId: true } });
      const allowed = assignableIds(req.user, draft, members, mine);
      // Assigning to YOURSELF is always allowed — taking a job is not dispatching.
      if (b.data.assigneeId !== req.user.uid && !allowed.includes(b.data.assigneeId)) return reply.code(403).send({ error: 'cannot_assign' });
      assigneeId = b.data.assigneeId;
    }
    const task = await p.adminTask.create({
      data: {
        title: b.data.title, body: b.data.body, priority: b.data.priority, teamId, assigneeId,
        creatorId: req.user.uid, dueAt: b.data.dueAt ? new Date(b.data.dueAt) : null,
      },
    });
    await event(p, task.id, req.user.uid, 'created', null, task.title);
    if (assigneeId) {
      await event(p, task.id, req.user.uid, 'assigned', null, assigneeId);
      if (assigneeId !== req.user.uid) await tell(p, assigneeId, 'task_assigned', `A task was assigned to you: ${task.title}`, `Une tache vous a ete confiee : ${task.title}`);
    }
    return reply.code(201).send({ task: serTask(task) });
  });

  app.get('/admin/tasks/:id', { preHandler: board }, async (req, reply) => {
    const p = await db();
    const mine = await membershipOf(p, req.user.uid);
    const task = await p.adminTask.findUnique({ where: { id: req.params.id } });
    if (!task) return reply.code(404).send({ error: 'not_found' });
    if (!canView(req.user, task, mine)) return reply.code(403).send({ error: 'forbidden' });
    const events = await p.adminTaskEvent.findMany({ where: { taskId: task.id }, orderBy: { createdAt: 'asc' }, take: 500 });
    const members = await p.staffTeamMember.findMany({ select: { teamId: true, userId: true } });
    const assignable = assignableIds(req.user, task, members, mine);
    return {
      task: serTask(task, {
        standing: standingFor(req.user, task, mine),
        can: {
          edit: canEdit(req.user, task, mine), assign: canAssign(req.user, task, mine),
          release: canRelease(req.user, task, mine), comment: canComment(req.user, task, mine),
          moveTeam: canMoveTeam(req.user), del: canDelete(req.user),
        },
        states: TASK_STATES.filter((s) => s !== task.state && canSetState(req.user, task, s, mine)),
        assignable,
      }),
      events: events.map(serEvent),
      people: await peopleFor(p, [task.assigneeId, task.creatorId, task.closedById, ...assignable, ...events.map((e) => e.actorId)]),
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
      // The assignee belonged to the OLD team. Carrying them over would leave a task in team
      // B worked by somebody team B's chief cannot see, let alone reassign.
      if (task.assigneeId) data.assigneeId = null;
    }
    const saved = await p.adminTask.update({ where: { id: task.id }, data });
    if (data.priority && data.priority !== task.priority) await event(p, task.id, req.user.uid, 'priority', task.priority, data.priority);
    if (data.dueAt !== undefined) await event(p, task.id, req.user.uid, 'due', task.dueAt ? task.dueAt.toISOString() : null, data.dueAt ? data.dueAt.toISOString() : null);
    if (data.teamId !== undefined) {
      await event(p, task.id, req.user.uid, 'team', task.teamId, data.teamId);
      if (task.assigneeId) await event(p, task.id, req.user.uid, 'released', task.assigneeId, null, 'the task moved to another team');
    }
    return { task: serTask(saved) };
  });

  app.post('/admin/tasks/:id/assign', { preHandler: board }, async (req, reply) => {
    const b = z.object({ userId: z.string().trim().min(1).max(60).nullable() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const mine = await membershipOf(p, req.user.uid);
    const task = await p.adminTask.findUnique({ where: { id: req.params.id } });
    if (!task) return reply.code(404).send({ error: 'not_found' });
    if (TERMINAL_STATES.includes(task.state)) return reply.code(409).send({ error: 'task_closed' });

    if (b.data.userId === null) {
      if (!canRelease(req.user, task, mine)) return reply.code(403).send({ error: 'forbidden' });
      const saved = await p.adminTask.update({ where: { id: task.id }, data: { assigneeId: null } });
      await event(p, task.id, req.user.uid, 'released', task.assigneeId, null);
      const team = task.teamId ? await p.staffTeam.findUnique({ where: { id: task.teamId }, select: { chiefId: true } }) : null;
      if (team && team.chiefId !== req.user.uid) await tell(p, team.chiefId, 'task_returned', `A task came back to the pool: ${task.title}`, `Une tache est revenue dans la file : ${task.title}`);
      return { task: serTask(saved) };
    }

    const members = await p.staffTeamMember.findMany({ select: { teamId: true, userId: true } });
    const allowed = assignableIds(req.user, task, members, mine);
    const self = b.data.userId === req.user.uid;
    // Taking an UNASSIGNED task off your own team's pool needs no chief: that is what a pool
    // is. Taking one off somebody else's name is a dispatch decision and does.
    const grab = self && !task.assigneeId && standingFor(req.user, task, mine) !== 'none';
    if (!grab && !allowed.includes(b.data.userId)) return reply.code(403).send({ error: 'cannot_assign' });
    const saved = await p.adminTask.update({ where: { id: task.id }, data: { assigneeId: b.data.userId } });
    await event(p, task.id, req.user.uid, 'assigned', task.assigneeId, b.data.userId);
    if (!self) await tell(p, b.data.userId, 'task_assigned', `A task was assigned to you: ${task.title}`, `Une tache vous a ete confiee : ${task.title}`);
    // Somebody just lost a task they were holding; they should not find out by refreshing.
    if (task.assigneeId && task.assigneeId !== b.data.userId && task.assigneeId !== req.user.uid) {
      await tell(p, task.assigneeId, 'task_reassigned', `A task was handed to somebody else: ${task.title}`, `Une tache a ete confiee a quelqu'un d'autre : ${task.title}`);
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
      data: {
        state: b.data.state,
        closedAt: closing ? new Date() : null,
        closedById: closing ? req.user.uid : null,
      },
    });
    await event(p, task.id, req.user.uid, reopening ? 'reopened' : 'state', task.state, b.data.state, b.data.note);
    // Whoever asked for the work, and whoever is doing it, both want to know it changed hands
    // in state. Never notify yourself about your own click.
    const targets = [...new Set([task.creatorId, task.assigneeId].filter((id) => id && id !== req.user.uid))];
    await Promise.all(targets.map((id) => tell(p, id, 'task_state', `Task "${task.title}" is now ${b.data.state}.`, `La tache "${task.title}" est maintenant : ${b.data.state}.`)));
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
    const targets = [...new Set([task.creatorId, task.assigneeId].filter((id) => id && id !== req.user.uid))];
    await Promise.all(targets.map((id) => tell(p, id, 'task_note', `New note on "${task.title}".`, `Nouvelle note sur "${task.title}".`)));
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
