// The staff task board: who may do what to a task, as pure functions.
//
// Every rule below is a function of (viewer, task, membership) and nothing else — no
// database, no request, no clock it does not receive. That is deliberate: the same three
// questions ("may I see it", "may I hand it to somebody", "may I close it") are asked by the
// list route, by the detail route, by each mutation and by the screen that draws the buttons,
// and a rule written five times is a rule that disagrees with itself the first time one copy
// is edited. The routes ask these; the tests call them directly.
//
// THE THREE STANDINGS
//
//   admin   ADMIN / SUPERADMIN. Dispatches across every team, creates and dissolves teams,
//           names chiefs, and is the only standing that may delete a task outright.
//   chief   the one `chiefId` of a team. Inside THEIR team they are the dispatcher: hand a
//           task to any member, take it back, re-prioritise, close it, add and remove members.
//           They may not create a team, dissolve one, or name a chief — including themselves
//           somewhere else. A chief outside their team is an ordinary member.
//   member  a moderator or admin-surface grantee on a team. Works what they are given:
//           moves their own task through the states, hands it back to the pool, writes notes.
//           They cannot hand work to somebody else, and they cannot cancel it. "I do not
//           think this should be done" is a note and a `blocked`, not a silent disappearance.
//
// WHO GETS THROUGH THE DOOR AT ALL
//
// `isStaffish` is the same population `ensure2fa` already treats as the admin surface: an
// admin-tier role, or any granted capability. It is not a new capability, and that is a
// choice — see the report and `canSeeBoard` below.

export const TASK_STATES = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'];
export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'];
/** A task in one of these is finished: it leaves the queues and stops being nagged about. */
export const TERMINAL_STATES = ['done', 'cancelled'];
/** Only these two standings may put a task into `cancelled` — see `canSetState`. */
const CANCEL_STANDINGS = ['admin', 'chief'];

const ADMIN_ROLES = ['ADMIN', 'SUPERADMIN'];
const STAFF_ROLES = ['MOD', 'ADMIN', 'SUPERADMIN'];

export const isAdmin = (user) => !!user && ADMIN_ROLES.includes(user.role);

/**
 * May this account reach the board at all?
 *
 * An admin-tier role, or an account somebody has granted a capability to. The second half
 * matters: this site delegates whole sections to non-MOD accounts (a catalogue reviewer, a
 * newsletter writer), and those people do the work a task is about. Locking the board to the
 * three roles would mean the person you want to hand a task to cannot open it.
 *
 * Membership of a staff team is enough too, so an admin can put somebody on a team and have
 * that be the whole act — the routes pass `onTeam`.
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
 * no team has no chief, by construction: nobody has been made responsible for it, so only an
 * admin can dispatch it. That is the honest reading of "unfiled", not an oversight.
 */
export function standingFor(user, task, ctx = {}) {
  if (isAdmin(user)) return 'admin';
  const chiefOf = ctx.chiefOf || [];
  const memberOf = ctx.memberOf || [];
  if (task?.teamId && chiefOf.includes(task.teamId)) return 'chief';
  if (task?.teamId && memberOf.includes(task.teamId)) return 'member';
  return 'none';
}

const isMine = (user, task) => !!user && !!task && task.assigneeId === user.uid;
const isAuthor = (user, task) => !!user && !!task && task.creatorId === user.uid;

/**
 * May the viewer READ this task?
 *
 * Wider than the write rules on purpose. A moderator who can see a colleague's queue can see
 * that the thing they were about to start is already being done, and a board where you can
 * only see your own row is a board where the same job is done twice. What it is NOT is public:
 * an account with no standing and no involvement sees nothing.
 */
export function canView(user, task, ctx = {}) {
  if (!user || !task) return false;
  if (isAdmin(user)) return true;
  if (isMine(user, task) || isAuthor(user, task)) return true;
  return standingFor(user, task, ctx) !== 'none';
}

/** May the viewer hand this task to somebody, or take it back? Admin, or the team's chief. */
export function canAssign(user, task, ctx = {}) {
  return CANCEL_STANDINGS.includes(standingFor(user, task, ctx));
}

/**
 * May the viewer hand the task BACK to the team pool (unassign themselves)?
 *
 * Distinct from `canAssign`, and it is the one power a member has over who does the work:
 * "not me" is always sayable, "you" never is. Releasing leaves the task with its team, so the
 * chief sees it come back rather than losing it.
 */
export function canRelease(user, task, ctx = {}) {
  if (!task || TERMINAL_STATES.includes(task.state)) return false;
  return canAssign(user, task, ctx) || isMine(user, task);
}

/** May the viewer edit the title, body, priority, due date or team? */
export function canEdit(user, task, ctx = {}) {
  if (!task) return false;
  if (CANCEL_STANDINGS.includes(standingFor(user, task, ctx))) return true;
  // The author may correct what they wrote, until somebody else has been put on it. After
  // that the wording is what the assignee is working from and changing it under them is how
  // a task ends up done wrong.
  return isAuthor(user, task) && (!task.assigneeId || isMine(user, task));
}

/** Moving a task between teams is a dispatch decision, and it crosses a team boundary. */
export const canMoveTeam = (user) => isAdmin(user);

/**
 * May the viewer put the task into `state`?
 *
 * Splitting this from `canEdit` is the point of the whole file. The assignee owns the
 * PROGRESS of their task (todo → in progress → blocked → done) and nothing else; cancelling
 * is a decision about whether the work should happen at all, which belongs to whoever asked
 * for it. Reopening a finished task is the same decision in reverse, so it takes the same
 * standing.
 */
export function canSetState(user, task, state, ctx = {}) {
  if (!task || !TASK_STATES.includes(state)) return false;
  const standing = standingFor(user, task, ctx);
  const senior = CANCEL_STANDINGS.includes(standing);
  if (state === 'cancelled') return senior || (isAuthor(user, task) && !task.assigneeId);
  // Bringing a closed task back to life.
  if (TERMINAL_STATES.includes(task.state) && !TERMINAL_STATES.includes(state)) return senior;
  if (senior) return true;
  return isMine(user, task);
}

/** May the viewer append a note? Anyone who can read it — a board nobody can answer is a memo. */
export const canComment = (user, task, ctx = {}) => canView(user, task, ctx);

/** Deleting destroys the history with it, so it is admin-only. Everything else cancels. */
export const canDelete = (user) => isAdmin(user);

/** The states the viewer may actually pick, for the dropdown and for the route's refusal. */
export const statesFor = (user, task, ctx = {}) =>
  TASK_STATES.filter((s) => s !== task?.state && canSetState(user, task, s, ctx));

// ── Teams ───────────────────────────────────────────────────────────────────────────────

/** May the viewer change this team's membership? Admin, or its chief. */
export function canManageTeam(user, team, ctx = {}) {
  if (!team) return false;
  if (isAdmin(user)) return true;
  return team.chiefId === user?.uid || (ctx.chiefOf || []).includes(team.id);
}

/** Creating a team, dissolving one and naming its chief are all the same decision. */
export const canRunTeams = (user) => isAdmin(user);

/**
 * Whom may this viewer hand a task to?
 *
 * An admin picks from everybody on the board. A chief picks from their own team, and their
 * own team only — the whole reason a chief exists is that the dispatch decision inside a team
 * does not need an admin, not that it becomes unbounded.
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
 * What happens to a team's tasks when a member leaves.
 *
 * The answer had to be one of three, and two of them are wrong. Deleting their tasks loses
 * work nobody decided to drop. Leaving the tasks assigned to somebody who is gone leaves a
 * queue that looks staffed and is not — which is the failure you only notice at the due date.
 *
 * So: every task of theirs that is still OPEN goes back to the team's pool, unassigned, with
 * a `released` event naming the reason, and the chief is told. Tasks already done or
 * cancelled keep their assignee id for ever: that row records who did the work, and rewriting
 * it because the person later left is falsifying the history.
 *
 * Tasks they CREATED are untouched. Authorship is not a workload.
 *
 * Returns the ids to unassign, so the caller does it in one `updateMany`.
 */
export function tasksToRelease(tasks = [], userId, teamId = null) {
  return tasks
    .filter((t) => t.assigneeId === userId
      && !TERMINAL_STATES.includes(t.state)
      && (teamId == null || t.teamId === teamId))
    .map((t) => t.id);
}

/**
 * What a team's tasks become when the TEAM goes away.
 *
 * Nothing is deleted. The tasks lose their team (the schema's `onDelete: SetNull` does that
 * half) and therefore lose their chief, which is exactly why they also lose their assignee if
 * they are still open: an open task with nobody responsible for dispatching it must be visibly
 * unowned rather than quietly parked on whoever happened to hold it. Admins see them in the
 * unfiled pool and re-file them.
 */
export const orphanedByTeamLoss = (tasks = []) =>
  tasks.filter((t) => !TERMINAL_STATES.includes(t.state)).map((t) => t.id);

// ── Sorting and shaping ─────────────────────────────────────────────────────────────────

const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 };

/**
 * The order the board reads in: open before finished, then by priority, then by the due date
 * (a task with no due date sorts after one that has one — a deadline is information and its
 * absence is not), then newest first.
 *
 * Done in JS rather than in the query because "open before finished" and "urgent before low"
 * are orderings over strings whose alphabet does not match their meaning, and encoding them
 * as integer columns is a second copy of the vocabulary above.
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
  assigneeId: t.assigneeId || null,
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
