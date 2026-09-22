// One way to NAME a project, for everything that has to point at one from outside the
// project pages: the contact form's project picker, a project's contact inbox, its storage
// settings.
//
// The site has two kinds of project and they are keyed differently everywhere else:
//
//   official   a `Project` row, keyed by `key` (bmm, bsm, installer…). ProjectPermission
//              and scoped roles name it by `projectKey`.
//   other      a `ShowcaseProject`, keyed by `slug` in URLs and by `id` in ProjectPermission
//              and scoped roles (`showcaseProjectId` / `showcaseIds`).
//
// A REF is one string for both: `bmm` for an official project, `sc:<slug>` for another one.
// The prefix is what keeps the two namespaces apart: a showcase slug may well be `bmm`.
// resolveProjectRef() turns a ref back into the ids the permission system uses, so nothing
// downstream ever parses the string itself.
import { projectKeys } from './project-keys.mjs';

const SC = 'sc:';
export const REF_SHAPE = /^(sc:)?[a-z0-9][a-z0-9-]{0,79}$/;

/** Is this string shaped like a ref? A cheap check before any database work. */
export const isRefShaped = (ref) => typeof ref === 'string' && REF_SHAPE.test(ref);

/**
 * What a ref IS: `{ ref, name, official, projectKey, showcaseProjectId, slug, visibility }`,
 * or null when it names nothing. `community` resolves too; whether a project may be
 * contacted is a separate question (see project-contact.mjs).
 */
export async function resolveProjectRef(p, ref) {
  if (!isRefShaped(ref)) return null;
  if (ref.startsWith(SC)) {
    const slug = ref.slice(SC.length);
    const s = await p.showcaseProject.findUnique({ where: { slug }, select: { id: true, slug: true, name: true, visibility: true, published: true } }).catch(() => null);
    if (!s) return null;
    return { ref, name: s.name, official: false, projectKey: null, showcaseProjectId: s.id, slug: s.slug, visibility: s.published ? s.visibility : 'private' };
  }
  if (!(await projectKeys()).includes(ref)) return null;
  const [row, cfg] = await Promise.all([
    p.project.findUnique({ where: { key: ref }, select: { visibility: true } }).catch(() => null),
    p.adminSetting.findUnique({ where: { key: `project.${ref}` } }).catch(() => null),
  ]);
  const name = (cfg?.value && typeof cfg.value === 'object' && typeof cfg.value.name === 'string' && cfg.value.name.trim()) || ref.toUpperCase();
  return { ref, name, official: true, projectKey: ref, showcaseProjectId: null, slug: ref, visibility: ref === 'community' ? 'public' : (row?.visibility || 'public') };
}

/**
 * Every project a visitor may pick in a form: official ones, then the published, PUBLIC
 * other ones. Unlisted, private and whitelisted pages are left out on purpose: a picker is
 * a listing, and listing a page is what those settings exist to prevent.
 */
export async function listPublicProjects(p) {
  const keys = await projectKeys();
  const [rows, cfgs, shows] = await Promise.all([
    p.project.findMany({ select: { key: true, visibility: true } }).catch(() => []),
    p.adminSetting.findMany({ where: { key: { in: keys.map((k) => `project.${k}`) } } }).catch(() => []),
    p.showcaseProject.findMany({ where: { published: true, visibility: 'public' }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }], select: { slug: true, name: true } }).catch(() => []),
  ]);
  const vis = Object.fromEntries(rows.map((r) => [r.key, r.visibility]));
  const nameOf = Object.fromEntries(cfgs.map((c) => [c.key.slice('project.'.length), c.value?.name]));
  const official = keys
    .filter((k) => k === 'community' || !vis[k] || vis[k] === 'public')
    .map((k) => ({ ref: k, name: (typeof nameOf[k] === 'string' && nameOf[k].trim()) || k.toUpperCase(), official: true }));
  return [...official, ...shows.map((s) => ({ ref: `${SC}${s.slug}`, name: s.name, official: false }))];
}
