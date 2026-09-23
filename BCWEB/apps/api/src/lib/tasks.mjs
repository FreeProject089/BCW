// The staff task board: who may do what to a task, as pure functions.
//
// Every rule below is a function of (viewer, task, membership) and nothing else — no
// database, no request, no clock it does not receive. That is deliberate: the same three
// questions ("may I see it", "may I hand it to somebody", "may I close it") are asked by the
// list route, by the detail route, by each mutation and by the screen that draws the buttons,
// and a rule written five times is a rule that disagrees with itself the first time one copy
// is edited. The routes ask these; the tests call them directly.
//
// THE STANDINGS
//
//   admin   the DISPATCHER standing: the `manage_tasks` capability, which ADMIN / SUPERADMIN
//           hold implicitly. Dispatches across every team, edits, cancels, reopens, moves a
//           task between teams, accepts a proposal from the site. Deleting a task stays the
//           admin ROLE's (canDelete): it destroys history, and no grant should.
//   chief   the one `chiefId` of a team. Inside THEIR team they are the dispatcher: hand a
//           task to any member, take it back, re-prioritise, close it, add staff to the team.
//           A chief outside their team is an ordinary member.
//   member  somebody on a team. Works what they are given: moves their own task through the
//           states, hands it back to the pool, writes notes. They cannot hand work to somebody
//           else, and they cannot cancel it.
//
// On top of those, `view_tasks` reads every task (and may therefore comment) and dispatches
// nothing, and `manage_teams` shapes the teams.
//
// NON-ESCALATION — THE ONE RULE EVERY "MAY I GIVE" BELOW OBEYS
//
// A grant is only ever of something the granter already holds, and never to themselves.
//
//   · naming a chief hands out dispatch inside a team        → needs manage_tasks (dispatch
//                                                              everywhere) AND manage_teams
//   · adding a member hands out member standing in a team    → the team's chief, or
//                                                              manage_teams AND manage_tasks
//   · a chief may only add people who are ALREADY staff: bringing an outsider onto the admin
//     surface is a decision about the admin surface, not about one team's work
//   · assigning hands out "work this task"                   → dispatch over that task
//   · nobody below admin adds THEMSELVES to a team or names themselves chief. An admin
//     already holds every standing, so for them it is not a grant.
//
// The capabilities themselves (and roles, custom roles, per-project grants) are handed out by
// routes that are ADMIN / SUPERADMIN only and refuse the caller's own account; nothing on this
// board can reach them. test/task-permissions-matrix.test.mjs proves both halves over HTTP.

import { canDispatchTasks, canReadAllTasks, canShapeTeams } from './lib.mjs';

export const TASK_STATES = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'];
export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'];
/** A task in one of these is finished: it leaves the queues and stops being nagged about. */
export const TERMINAL_STATES = ['done', 'cancelled'];
/** How many people one task may be on. Past this it is a team, and a team already exists. */
export const MAX_ASSIGNEES = 10;
/** `blocks` is directed and acyclic; `relates` is an association. See wouldCycle. */
export const LINK_KINDS = ['blocks', 'relates'];
/** Only these two standings may put a task into `cancelled` — see `canSetState`. */
const CANCEL_STANDINGS = ['admin', 'chief'];

const ADMIN_ROLES = ['ADMIN', 'SUPERADMIN'];
const STAFF_ROLES = ['MOD', 'ADMIN', 'SUPERADMIN'];

/** The admin ROLE. Only `canDelete` and the self-grant exemption ask this; every other
 *  board power is a capability an admin holds implicitly. */
export const isAdmin = (user) => !!user && ADMIN_ROLES.includes(user.role);
/** manage_tasks: the board-wide dispatcher. */
export const isDispatcher = (user) => !!user && canDispatchTasks(user);
/** view_tasks or manage_tasks: every task is readable. */
export const seesAllTasks = (user) => !!user && canReadAllTasks(user);

/**
 * May this account reach the board at all?
 *
 * An admin-tier role, or an account somebody has granted a capability to. The second half
 * matters: this site delegates whole sections to non-MOD accounts (a catalogue reviewer, a
 * newsletter writer), and those people do the work a task is about. Locking the board to the
 * three roles would mean the person you want to hand a task to cannot open it.
 *
 * Membership of a staff team is enough too, so putting somebody on a team is the whole act —
 * the routes pass `onTeam`.
 */
export function isStaffish(user, onTeam = false) {
  if (!user) return false;
  if (STAFF_ROLES.includes(user.role)) return true;
  if (Array.isArray(user.perms) && user.perms.length > 0) return true;
  return !!onTeam;
}

/**
 * The viewer's standing, given the teams they are on and the teams they are chief of.
 *
 * `ctx.chiefOf` / `ctx.memberOf` are id lists the route reads once per request. A task with
 * no team has no chief, by construction: nobody has been made responsible for it, so only a
 * dispatcher can dispatch it.
 */
export function standingFor(user, task, ctx = {}) {
  if (isDispatcher(user)) return 'admin';
  const chiefOf = ctx.chiefOf || [];
  const memberOf = ctx.memberOf || [];
  if (task?.teamId && chiefOf.includes(task.teamId)) return 'chief';
  if (task?.teamId && memberOf.includes(task.teamId)) return 'member';
  return 'none';
}

/** The people on a task. Tolerates a row from before the list existed. */
export const assigneesOf = (task) => (Array.isArray(task?.assigneeIds) ? task.assigneeIds : []);
const isMine = (user, task) => !!user && !!task && assigneesOf(task).includes(user.uid);
const isAuthor = (user, task) => !!user && !!task && task.creatorId === user.uid;

/**
 * May the viewer READ this task?
 *
 * Wider than the write rules on purpose: a team sees the team's work, so the same job is not
 * started twice. What it is NOT is public: an account with no standing, no involvement and no
 * read grant sees nothing.
 */
export function canView(user, task, ctx = {}) {
  if (!user || !task) return false;
  if (seesAllTasks(user)) return true;
  if (isMine(user, task) || isAuthor(user, task)) return true;
  return standingFor(user, task, ctx) !== 'none';
}

/**
 * The same rule as `canView`, as a Prisma `where`, so the list query only ever FETCHES and
 * COUNTS what the viewer may read. Filtering after the fetch left `total` counting rows the
 * viewer could not see — and with `?q=` that count answered "does any task anywhere mention
 * X", a search over other teams' work.
 */
export function visibilityWhere(user, ctx = {}) {
  if (seesAllTasks(user)) return {};
  const or = [{ assigneeIds: { has: user.uid } }, { creatorId: user.uid }];
  const teams = [...new Set([...(ctx.memberOf || []), ...(ctx.chiefOf || [])])];
  if (teams.length) or.push({ teamId: { in: teams } });
  return { OR: or };
}

/** May the viewer hand this task to somebody, or take it back? A dispatcher, or the team's chief. */
export function canAssign(user, task, ctx = {}) {
  return CANCEL_STANDINGS.includes(standingFor(user, task, ctx));
}

/**
 * May the viewer take THEMSELVES off the task?
 *
 * The one power a member has over who does the work: "not me" is always sayable, "you" never
 * is. Releasing leaves the task with its team, so the chief sees it come back.
 */
export function canRelease(user, task, ctx = {}) {
  if (!task || TERMINAL_STATES.includes(task.state)) return false;
  return canAssign(user, task, ctx) || isMine(user, task);
}

/** May the viewer edit the title, body, priority, due date — and its links? */
export function canEdit(user, task, ctx = {}) {
  if (!task) return false;
  if (CANCEL_STANDINGS.includes(standingFor(user, task, ctx))) return true;
  // The author may correct what they wrote until somebody ELSE is on it: after that the
  // wording is what the assignees are working from.
  const on = assigneesOf(task);
  return isAuthor(user, task) && on.every((id) => id === user.uid);
}

/** Moving a task between teams is a dispatch decision, and it crosses a team boundary. */
export const canMoveTeam = (user) => isDispatcher(user);

/**
 * May the viewer put the task into `state`?
 *
 * The assignees own the PROGRESS of their task (todo → in progress → blocked → done) and
 * nothing else; cancelling is a decision about whether the work should happen at all, which
 * belongs to whoever asked for it. Reopening a finished task is the same decision in reverse.
 */
export function canSetState(user, task, state, ctx = {}) {
  if (!task || !TASK_STATES.includes(state)) return false;
  const standing = standingFor(user, task, ctx);
  const senior = CANCEL_STANDINGS.includes(standing);
  if (state === 'cancelled') return senior || (isAuthor(user, task) && !assigneesOf(task).length);
  if (TERMINAL_STATES.includes(task.state) && !TERMINAL_STATES.includes(state)) return senior;
  if (senior) return true;
  return isMine(user, task);
}

/** May the viewer append a note? Anyone who can read it — a board nobody can answer is a memo. */
export const canComment = (user, task, ctx = {}) => canView(user, task, ctx);

/** Deleting destroys the history with it, so it is the admin ROLE's, not a grant's. */
export const canDelete = (user) => isAdmin(user);

/** The states the viewer may actually pick, for the dropdown and for the route's refusal. */
export const statesFor = (user, task, ctx = {}) =>
  TASK_STATES.filter((s) => s !== task?.state && canSetState(user, task, s, ctx));

// ── Assignment ──────────────────────────────────────────────────────────────────────────

/**
 * Whom may this viewer hand a task to?
 *
 * A dispatcher picks from everybody on a team. A chief picks from their own team only — the
 * reason a chief exists is that the dispatch decision inside a team does not need an admin,
 * not that it becomes unbounded.
 *
 * `members` is `[{ teamId, userId }]`. Returns ids, deduplicated, order preserved.
 */
export function assignableIds(user, task, members = [], ctx = {}) {
  const standing = standingFor(user, task, ctx);
  if (standing === 'admin') return [...new Set(members.map((m) => m.userId))];
  if (standing !== 'chief' || !task?.teamId) return [];
  return [...new Set(members.filter((m) => m.teamId === task.teamId).map((m) => m.userId))];
}

/**
 * Is changing the task's people from its current list to `next` allowed for this viewer?
 *
 * Returns `{ ok, added, removed, error }`. Three kinds of caller, three rules:
 *
 *   dispatcher / chief   any removal; each ADDED person must be assignable (or themselves)
 *   anybody else         may remove themselves (release) and may add themselves to a task
 *                        nobody is on yet if they have standing on it (taking from the pool
 *                        is not dispatching). Nothing else — "you" is never sayable.
 *
 * Nobody can put a task on more than MAX_ASSIGNEES people, and a closed task's people are
 * the record of who did it, so they do not change.
 */
export function assignmentChange(user, task, next = [], members = [], ctx = {}) {
  const cur = assigneesOf(task);
  const want = [...new Set((next || []).filter(Boolean).map(String))];
  const added = want.filter((id) => !cur.includes(id));
  const removed = cur.filter((id) => !want.includes(id));
  const res = (ok, error = null) => ({ ok, added, removed, error, next: want });
  if (!task) return res(false, 'not_found');
  if (TERMINAL_STATES.includes(task.state)) return res(false, 'task_closed');
  if (want.length > MAX_ASSIGNEES) return res(false, 'too_many_assignees');
  if (!added.length && !removed.length) return res(true);
  if (canAssign(user, task, ctx)) {
    const allowed = assignableIds(user, task, members, ctx);
    const bad = added.filter((id) => id !== user.uid && !allowed.includes(id));
    return bad.length ? res(false, 'cannot_assign') : res(true);
  }
  // Not a dispatcher: only ever about yourself.
  if (removed.some((id) => id !== user?.uid) || added.some((id) => id !== user?.uid)) return res(false, 'cannot_assign');
  if (added.length) {
    const grab = !cur.length && standingFor(user, task, ctx) !== 'none';
    if (!grab) return res(false, 'cannot_assign');
  }
  return res(true);
}

// ── Links ───────────────────────────────────────────────────────────────────────────────

/**
 * Would the edge `from blocks to` close a cycle in the blocks graph?
 *
 * `edges` is every existing `blocks` edge as `{ fromId, toId }`. A cycle exists after adding
 * the edge exactly when `from` is already reachable FROM `to`. A task blocking itself is the
 * one-edge cycle. `relates` edges never reach this: an association has no direction.
 */
export function wouldCycle(edges = [], fromId, toId) {
  if (fromId === toId) return true;
  const next = new Map();
  for (const e of edges) {
    if (!next.has(e.fromId)) next.set(e.fromId, []);
    next.get(e.fromId).push(e.toId);
  }
  const seen = new Set([toId]);
  const stack = [toId];
  while (stack.length) {
    const at = stack.pop();
    if (at === fromId) return true;
    for (const n of next.get(at) || []) if (!seen.has(n)) { seen.add(n); stack.push(n); }
  }
  return false;
}

/**
 * The API's words for a link, read from ONE task's side. The stored row is `from blocks to`;
 * seen from `to` it is "blocked by from". `blocked_by` is only ever a view, never stored.
 */
export function linkFromSide(link, taskId) {
  if (link.kind === 'relates') return { kind: 'relates', otherId: link.fromId === taskId ? link.toId : link.fromId };
  return link.fromId === taskId ? { kind: 'blocks', otherId: link.toId } : { kind: 'blocked_by', otherId: link.fromId };
}

/**
 * May the viewer link task `a` to task `b`?
 *
 * A link is written ON `a` and names `b`, so it needs the right to edit `a` and the right to
 * READ `b`: linking to a task you cannot see would put its existence and title in front of
 * everybody who can see yours.
 */
export const canLink = (user, a, b, ctxA = {}, ctxB = ctxA) => canEdit(user, a, ctxA) && canView(user, b, ctxB);

// ── Teams ───────────────────────────────────────────────────────────────────────────────

const onTeamCtx = (team, ctx) => !!team && ((ctx.memberOf || []).includes(team.id) || (ctx.chiefOf || []).includes(team.id));
const isChiefOf = (user, team, ctx = {}) => !!team && !!user && (team.chiefId === user.uid || (ctx.chiefOf || []).includes(team.id));

/** Create, rename, archive, dissolve — the team as a thing. manage_teams. */
export const canRunTeams = (user) => !!user && canShapeTeams(user);

/**
 * May the viewer name `targetId` chief of a team (including by creating it)?
 *
 * A chief dispatches inside their team, so naming one hands out dispatch: it takes
 * manage_teams to shape the team AND manage_tasks to hold what is being handed out. Never
 * yourself, unless you are an admin, who already holds every standing.
 */
export function canNameChief(user, targetId) {
  if (!canRunTeams(user) || !isDispatcher(user)) return false;
  return isAdmin(user) || targetId !== user.uid;
}

/**
 * May the viewer ADD `target` to `team`?
 *
 * `target` is `{ id, staff }`, where `staff` says whether the account is already on the admin
 * surface (isStaffish). The chief staffs their team from the staff; bringing an outsider in
 * takes manage_teams + manage_tasks. Nobody below admin adds themselves.
 */
export function canAddMember(user, team, target, ctx = {}) {
  if (!user || !team || !target) return false;
  if (target.id === user.uid && !isAdmin(user)) return false;
  if (canRunTeams(user) && isDispatcher(user)) return true;
  return isChiefOf(user, team, ctx) && !!target.staff;
}

/** May the viewer REMOVE somebody from `team`? Taking standing away needs no more than
 *  shaping the team or running it. Leaving (yourself) is always allowed — see the route. */
export function canRemoveMember(user, team, targetId, ctx = {}) {
  if (!user || !team) return false;
  if (targetId === user.uid) return true;
  return canRunTeams(user) || isChiefOf(user, team, ctx);
}

/** The team card's "may I change the membership at all" — draws the buttons. */
export function canManageTeam(user, team, ctx = {}) {
  if (!team || !user) return false;
  return canRunTeams(user) || isChiefOf(user, team, ctx);
}

/** Is the viewer on this team? Used by the list to say "you" without a second query. */
export const isOnTeam = (team, ctx = {}) => onTeamCtx(team, ctx);

/**
 * What happens to a team's tasks when a member leaves.
 *
 * Every task of theirs that is still OPEN loses them (and goes back to the pool if they were
 * the only one on it), with a `released` event, and the chief is told. Tasks already done or
 * cancelled keep them for ever: that row records who did the work.
 *
 * Returns the ids to update.
 */
export function tasksToRelease(tasks = [], userId, teamId = null) {
  return tasks
    .filter((t) => assigneesOf(t).includes(userId)
      && !TERMINAL_STATES.includes(t.state)
      && (teamId == null || t.teamId === teamId))
    .map((t) => t.id);
}

/**
 * What a team's tasks become when the TEAM goes away: nothing is deleted, and the open ones
 * lose their people, because an open task with nobody responsible for dispatching it must be
 * visibly unowned rather than quietly parked on whoever happened to hold it.
 */
export const orphanedByTeamLoss = (tasks = []) =>
  tasks.filter((t) => !TERMINAL_STATES.includes(t.state)).map((t) => t.id);

// ── Sorting and shaping ─────────────────────────────────────────────────────────────────

const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 };

/**
 * The order the board reads in: open before finished, then by priority, then by the due date
 * (a task with no due date sorts after one that has one), then newest first.
 */
export function sortTasks(tasks = []) {
  return [...tasks].sort((a, b) => {
    const at = TERMINAL_STATES.includes(a.state) ? 1 : 0;
    const bt = TERMINAL_STATES.includes(b.state) ? 1 : 0;
    if (at !== bt) return at - bt;
    const ap = PRIORITY_RANK[a.priority] ?? 2;
    const bp = PRIORITY_RANK[b.priority] ?? 2;
    if (ap !== bp) return ap - bp;
    const ad = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
    const bd = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
    if (ad !== bd) return ad - bd;
    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
  });
}

/** Is this task past its due date and still open? */
export const isOverdue = (task, now = new Date()) =>
  !!task?.dueAt && !TERMINAL_STATES.includes(task.state) && new Date(task.dueAt).getTime() < now.getTime();

export function slugifyTeamName(name) {
  return String(name || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'team';
}

/** One task, as the board reads it. An allowlist, not a spread — see the house note on ser(). */
export const serTask = (t, extra = {}) => (t ? {
  id: t.id,
  title: t.title,
  body: t.body || '',
  state: t.state,
  priority: t.priority,
  teamId: t.teamId || null,
  assigneeIds: assigneesOf(t),
  creatorId: t.creatorId,
  dueAt: t.dueAt,
  closedAt: t.closedAt,
  closedById: t.closedById || null,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
  overdue: isOverdue(t),
  ...extra,
} : null);

export const serEvent = (e) => ({
  id: e.id, kind: e.kind, actorId: e.actorId || null,
  from: e.fromValue || null, to: e.toValue || null, note: e.note || '', createdAt: e.createdAt,
});

export const serStaffTeam = (t, extra = {}) => (t ? {
  id: t.id, name: t.name, slug: t.slug, description: t.description || '',
  chiefId: t.chiefId, archivedAt: t.archivedAt, createdAt: t.createdAt, ...extra,
} : null);
