// A project's contact inbox: its topics, and WHO may read and answer it.
//
// The conversations themselves are ordinary ContactThreads (kind 'project', targetId = the
// project ref), so everything a thread already does (rate limits, blocking, receipts, the
// anonymous token link, staff moderation) applies unchanged. This file only answers the two
// questions a project adds: what may somebody write about, and who is on the receiving side.
//
// WHO, reusing the per-project permission system rather than inventing a fourth one:
//
//   managers    manage_projects (official) / manage_showcase (other): every project of the kind
//   editors     ProjectPermission + scoped roles with the `pages` right — unless this project
//               switched `editorsSeeInbox` off
//   inbox role  a scoped CustomRole with the `inbox` right on this project
//   listed      ProjectContactSettings.inboxUserIds
//
// Written once, here, and asked by every path that opens, lists, reads or answers a project
// conversation, because an access rule written twice diverges.
import { canManageProjects, canManageShowcase, projectGrants, inboxRoleGrants, isScopedRole, scopeRights } from './lib.mjs';

/** The topics every project may offer. Labels live in the web bundle (FR + EN). */
export const BASIC_TOPICS = ['question', 'bug', 'translation', 'suggestion', 'other'];
export const MAX_CUSTOM_TOPICS = 12;

export const SETTINGS_DEFAULTS = { enabled: true, basicTopics: BASIC_TOPICS, customTopics: [], editorsSeeInbox: true, inboxUserIds: [] };

/** The stored settings, or the defaults. Never throws. */
export async function settingsFor(p, ref) {
  const row = await p.projectContactSettings.findUnique({ where: { ref } }).catch(() => null);
  if (!row) return { ref, ...SETTINGS_DEFAULTS };
  return {
    ref,
    enabled: row.enabled !== false,
    basicTopics: (row.basicTopics || []).filter((x) => BASIC_TOPICS.includes(x)),
    customTopics: cleanCustomTopics(row.customTopics),
    editorsSeeInbox: row.editorsSeeInbox !== false,
    inboxUserIds: row.inboxUserIds || [],
  };
}

/** Custom topics, sanitised: `{ id, label, labelFr }`, ids unique and never a basic id. */
export function cleanCustomTopics(raw) {
  const out = [];
  const seen = new Set(BASIC_TOPICS);
  for (const t of Array.isArray(raw) ? raw : []) {
    if (!t || typeof t !== 'object') continue;
    const label = String(t.label || '').trim().slice(0, 60);
    if (!label) continue;
    let id = String(t.id || label).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
    if (!id) continue;
    if (seen.has(id)) id = `c-${id}`.slice(0, 30);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label, labelFr: String(t.labelFr || '').trim().slice(0, 60) });
    if (out.length >= MAX_CUSTOM_TOPICS) break;
  }
  return out;
}

/** What a sender may pick: the enabled basic topics, then the project's own. */
export const topicsOf = (s) => [
  ...BASIC_TOPICS.filter((id) => s.basicTopics.includes(id)).map((id) => ({ id, basic: true })),
  ...s.customTopics.map((c) => ({ ...c, basic: false })),
];
export const isTopicOf = (s, id) => topicsOf(s).some((t) => t.id === id);

const managerOf = (user, proj) => (proj.official ? canManageProjects(user) : canManageShowcase(user));

/** Does a grant set (from projectGrants / inboxRoleGrants) cover this project? */
const covers = (g, proj) => (proj.official ? g.projectKeys.has(proj.projectKey) : (g.allShowcase || g.showcaseIds.has(proj.showcaseProjectId)));

/**
 * May `user` read and answer this project's inbox? `proj` is a resolved ref
 * (resolveProjectRef), `s` its settings. Returns the reason, or '' for no.
 */
export async function inboxAccess(user, proj, s) {
  if (!user?.uid || !proj) return '';
  if (managerOf(user, proj)) return 'manager';
  if (s.inboxUserIds.includes(user.uid)) return 'listed';
  if (covers(await inboxRoleGrants(user.uid), proj)) return 'role';
  if (s.editorsSeeInbox && covers(await projectGrants(user.uid), proj)) return 'editor';
  return '';
}

/** May `user` change this project's contact settings? Its managers and its editors. */
export async function canConfigure(user, proj) {
  if (!user?.uid || !proj) return false;
  if (managerOf(user, proj)) return true;
  return covers(await projectGrants(user.uid), proj);
}

/**
 * The project conversations `user` may see in their inbox, as a Prisma `where` fragment,
 * or null when there are none. The managers' blanket is expressed as a prefix rule rather
 * than a list, so it stays right when a project is added.
 */
export async function inboxWhere(p, user) {
  if (!user?.uid) return null;
  const or = [];
  if (canManageProjects(user)) or.push({ NOT: { targetId: { startsWith: 'sc:' } } });
  if (canManageShowcase(user)) or.push({ targetId: { startsWith: 'sc:' } });
  const refs = new Set();
  const listed = await p.projectContactSettings.findMany({ where: { inboxUserIds: { has: user.uid } }, select: { ref: true } }).catch(() => []);
  for (const r of listed) refs.add(r.ref);
  const [edit, role] = await Promise.all([projectGrants(user.uid), inboxRoleGrants(user.uid)]);
  const scIds = [...new Set([...edit.showcaseIds, ...role.showcaseIds])];
  const shows = scIds.length || edit.allShowcase || role.allShowcase
    ? await p.showcaseProject.findMany({ where: edit.allShowcase || role.allShowcase ? {} : { id: { in: scIds } }, select: { id: true, slug: true } }).catch(() => [])
    : [];
  const refOfShow = Object.fromEntries(shows.map((x) => [x.id, `sc:${x.slug}`]));
  const roleRefs = [...role.projectKeys, ...(role.allShowcase ? shows.map((x) => `sc:${x.slug}`) : [...role.showcaseIds].map((id) => refOfShow[id]))].filter(Boolean);
  const editRefs = [...edit.projectKeys, ...(edit.allShowcase ? shows.map((x) => `sc:${x.slug}`) : [...edit.showcaseIds].map((id) => refOfShow[id]))].filter(Boolean);
  for (const r of roleRefs) refs.add(r);
  if (editRefs.length) {
    // An editor sees the inbox only where the project did not switch that off.
    const off = await p.projectContactSettings.findMany({ where: { ref: { in: editRefs }, editorsSeeInbox: false }, select: { ref: true } }).catch(() => []);
    const offSet = new Set(off.map((r) => r.ref));
    for (const r of editRefs) if (!offSet.has(r)) refs.add(r);
  }
  if (refs.size) or.push({ targetId: { in: [...refs] } });
  return or.length ? { kind: 'project', OR: or } : null;
}

/**
 * Who to TELL about a new message: the listed accounts, the inbox-role holders and (unless
 * switched off) the editors. Managers are not in it: "every admin of the site" is not a
 * notification list, and they see the conversation in their inbox and in moderation.
 */
export async function inboxRecipients(p, proj, s) {
  const ids = new Set(s.inboxUserIds);
  // Editors = holders of the `pages` right. A studio-only grant (rights: ['studio']) draws the
  // page and is not told about its inbox, like a scoped role with only the studio right below.
  const editorWhere = proj.official
    ? { projectKey: proj.projectKey, rights: { has: 'pages' } }
    : { rights: { has: 'pages' }, OR: [{ showcaseProjectId: proj.showcaseProjectId }, { allShowcase: true }] };
  if (s.editorsSeeInbox) {
    for (const g of await p.projectPermission.findMany({ where: editorWhere, select: { userId: true } }).catch(() => [])) ids.add(g.userId);
  }
  const roles = await p.customRole.findMany({ select: { id: true, scope: true } }).catch(() => []);
  const roleIds = roles.filter((r) => {
    if (!isScopedRole(r)) return false;
    const rights = scopeRights(r);
    const wanted = rights.includes('inbox') || (s.editorsSeeInbox && rights.includes('pages'));
    if (!wanted) return false;
    return proj.official ? (r.scope.projectKeys || []).includes(proj.projectKey) : (r.scope.allShowcase || (r.scope.showcaseIds || []).includes(proj.showcaseProjectId));
  }).map((r) => r.id);
  if (roleIds.length) {
    for (const u of await p.user.findMany({ where: { customRoleIds: { hasSome: roleIds }, status: 'active' }, select: { id: true } }).catch(() => [])) ids.add(u.id);
  }
  return [...ids];
}
