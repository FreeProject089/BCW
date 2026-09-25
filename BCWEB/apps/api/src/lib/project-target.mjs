// prerelease (agent-prerelease): one project, named three ways, and who may do what to it.
//
// The site stores a project's rows under a TARGET (ProjectRelease, ProjectDoc, ProjectVersion):
// the project key for an official project, `sc:<showcaseId>` for an Other project. The id, not
// the slug, because a slug can be renamed and a stored row must not lose its project when it is.
// URLs name it by a REF (lib/project-ref.mjs): the key, or `sc:<slug>`. This file turns either
// into the same record and answers the three questions every route here asks:
//
//   may this request SEE it     the page's own visibility (canViewPage), an unpublished Other
//                               project is nobody's but its editors', `community` is public;
//   may this user EDIT it       canEditProject / canEditShowcase: the manager capability or a
//                               per-project `pages` grant, the rule the page editor already uses;
//   may this user MANAGE it     the manager capability only (manage_projects for an official
//                               project, manage_showcase for the others). Reserved controls:
//                               switching reviews on, broadcasting an announcement.
//
// Nothing here parses a target out of a request body: the routes compute it from the URL.
import { canEditProject, canEditShowcase, canManageProjects, canManageShowcase, canViewPage, currentUser } from './lib.mjs';
import { isRefShaped } from './project-ref.mjs';
import { projectKeys } from './project-keys.mjs';

const SC = 'sc:';

function officialName(cfg, key) {
  const v = cfg?.value;
  return (v && typeof v === 'object' && typeof v.name === 'string' && v.name.trim()) || key.toUpperCase();
}

function officialRecord(key, row, cfg) {
  return {
    ref: key, target: key, official: true, projectKey: key, showcaseProjectId: null, slug: key,
    name: officialName(cfg, key), published: true,
    visibility: key === 'community' ? 'public' : (row?.visibility || 'public'),
    visibilityWhitelist: row?.visibilityWhitelist || [],
    url: `/p/${key}`,
  };
}

function showcaseRecord(s) {
  return {
    ref: `${SC}${s.slug}`, target: `${SC}${s.id}`, official: false, projectKey: null, showcaseProjectId: s.id, slug: s.slug,
    name: s.name, published: !!s.published, visibility: s.visibility || 'public',
    visibilityWhitelist: s.visibilityWhitelist || [], url: `/project/${s.slug}`,
  };
}

const SHOWCASE_SELECT = { id: true, slug: true, name: true, published: true, visibility: true, visibilityWhitelist: true };

/** The project a URL ref names, or null. */
export async function projectByRef(p, ref) {
  if (!isRefShaped(ref)) return null;
  if (ref.startsWith(SC)) {
    const s = await p.showcaseProject.findUnique({ where: { slug: ref.slice(SC.length) }, select: SHOWCASE_SELECT }).catch(() => null);
    return s ? showcaseRecord(s) : null;
  }
  if (!(await projectKeys()).includes(ref)) return null;
  const [row, cfg] = await Promise.all([
    p.project.findUnique({ where: { key: ref }, select: { visibility: true, visibilityWhitelist: true } }).catch(() => null),
    p.adminSetting.findUnique({ where: { key: `project.${ref}` } }).catch(() => null),
  ]);
  return officialRecord(ref, row, cfg);
}

/** Every project named by a list of stored targets, as a Map target -> record. Batched: the
 *  public listings resolve dozens at once. A target whose project is gone is simply absent. */
export async function projectsByTargets(p, targets) {
  const out = new Map();
  const uniq = [...new Set(targets.filter((t) => typeof t === 'string' && t))];
  const scIds = uniq.filter((t) => t.startsWith(SC)).map((t) => t.slice(SC.length));
  const keys = uniq.filter((t) => !t.startsWith(SC));
  const known = new Set(await projectKeys());
  const official = keys.filter((k) => known.has(k));
  const [shows, rows, cfgs] = await Promise.all([
    scIds.length ? p.showcaseProject.findMany({ where: { id: { in: scIds } }, select: SHOWCASE_SELECT }).catch(() => []) : [],
    official.length ? p.project.findMany({ where: { key: { in: official } }, select: { key: true, visibility: true, visibilityWhitelist: true } }).catch(() => []) : [],
    official.length ? p.adminSetting.findMany({ where: { key: { in: official.map((k) => `project.${k}`) } } }).catch(() => []) : [],
  ]);
  for (const s of shows) out.set(`${SC}${s.id}`, showcaseRecord(s));
  const rowBy = new Map(rows.map((r) => [r.key, r]));
  const cfgBy = new Map(cfgs.map((c) => [c.key.slice('project.'.length), c]));
  for (const k of official) out.set(k, officialRecord(k, rowBy.get(k), cfgBy.get(k)));
  return out;
}

/** The project a stored target names, or null. */
export async function projectByTarget(p, target) {
  return (await projectsByTargets(p, [target])).get(target) || null;
}

/** May a reader see this project's page? The page rule, word for word. */
export async function canSeeProject(p, proj, req) {
  if (!proj || !proj.published) return false;
  if (proj.official && proj.projectKey === 'community') return true;
  return canViewPage(p, { visibility: proj.visibility, visibilityWhitelist: proj.visibilityWhitelist }, req);
}

/** Listed publicly: a public page. Unlisted, whitelisted and private pages are reachable by
 *  their link (unlisted) or by their list (whitelist), never through a listing. */
export function isListable(proj) {
  return !!proj && proj.published && (proj.visibility === 'public' || (proj.official && proj.projectKey === 'community'));
}

/**
 * The caller with LIVE capabilities. optionalAuth hands over the token's claims without them;
 * requireEditor / requireRole hand over the live ones. The canEdit* predicates read `perms`.
 */
export async function liveUser(req) {
  if (!req.user?.uid) return null;
  if (Array.isArray(req.user.perms)) return req.user;
  const cur = await currentUser(req.user.uid);
  if (cur.exists === false) return null;
  return { ...req.user, role: cur.role || req.user.role, perms: cur.perms || [] };
}

/** May this user edit this project's content (and so its pre-releases)? */
export async function canEditTarget(user, proj) {
  if (!user?.uid || !proj) return false;
  return proj.official ? canEditProject(user, proj.projectKey) : canEditShowcase(user, proj.showcaseProjectId);
}

/** May this user use a project's RESERVED controls? The manager capability only. */
export function canManageTarget(user, proj) {
  if (!user?.uid || !proj) return false;
  return proj.official ? canManageProjects(user) : canManageShowcase(user);
}

/** Public shape of a project on a card: never its visibility list. */
export const projectCard = (proj) => (proj ? { ref: proj.ref, name: proj.name, url: proj.url, official: proj.official } : null);
