// A team's contact inbox: which of its members answer it, and how many conversations it
// keeps open. See TeamContactSettings in schema.prisma.
//
// "The team's conversations" are every ContactThread whose ownerTeamId is the team: the ones
// addressed to the team itself and the ones about its repos and catalogues. Before this, any
// active member read and answered all of them; now the team chooses which ROLES do, and the
// one predicate below is asked by every path that lists, reads, answers or notifies.

export const TEAM_ROLES = ['owner', 'admin', 'member'];
const DEFAULTS = { answerRoles: TEAM_ROLES, maxOpenMembers: 0, maxOpenAnon: 0 };

/** The stored settings, or the defaults. Never throws. */
export async function teamContactSettings(p, teamId) {
  const row = teamId ? await p.teamContactSettings.findUnique({ where: { teamId } }).catch(() => null) : null;
  if (!row) return { teamId, ...DEFAULTS };
  const roles = (row.answerRoles || []).filter((r) => TEAM_ROLES.includes(r));
  // The owner always answers: a team whose inbox nobody may open is a black hole, and the
  // owner is the one person who could always switch it back anyway.
  return { teamId, answerRoles: roles.includes('owner') ? roles : ['owner', ...roles], maxOpenMembers: row.maxOpenMembers || 0, maxOpenAnon: row.maxOpenAnon || 0 };
}

/** Ids of the teams whose inbox `uid` answers. */
export async function answeringTeamIds(p, uid) {
  if (!uid) return [];
  const rows = await p.teamMember.findMany({ where: { userId: uid, status: 'active' }, select: { teamId: true, role: true } });
  if (!rows.length) return [];
  const settings = await p.teamContactSettings.findMany({ where: { teamId: { in: rows.map((r) => r.teamId) } } }).catch(() => []);
  const byTeam = Object.fromEntries(settings.map((s) => [s.teamId, s]));
  return rows.filter((r) => {
    const s = byTeam[r.teamId];
    if (!s) return true; // defaults: every role answers
    const roles = (s.answerRoles || []).filter((x) => TEAM_ROLES.includes(x));
    return r.role === 'owner' || roles.includes(r.role);
  }).map((r) => r.teamId);
}

/** May `uid` answer this team's conversations? */
export async function canAnswerTeam(p, uid, teamId) {
  return !!teamId && (await answeringTeamIds(p, uid)).includes(teamId);
}

/** The accounts to tell about a message to this team: its answering members. */
export async function teamAnswerers(p, teamId) {
  if (!teamId) return [];
  const s = await teamContactSettings(p, teamId);
  const rows = await p.teamMember.findMany({ where: { teamId, status: 'active', role: { in: s.answerRoles } }, select: { userId: true } });
  return rows.map((r) => r.userId);
}

/**
 * Is the team's inbox full for this sender? Counts OPEN conversations only: archived and
 * closed ones are the team's history, not its workload. Returns the refusal or null.
 */
export async function teamInboxFull(p, teamId, { anonymous }) {
  const s = await teamContactSettings(p, teamId);
  const cap = anonymous ? s.maxOpenAnon : s.maxOpenMembers;
  if (!cap) return null;
  const open = await p.contactThread.count({ where: { ownerTeamId: teamId, status: 'open', senderId: anonymous ? null : { not: null } } });
  return open >= cap ? { error: 'team_inbox_full', limit: cap } : null;
}
