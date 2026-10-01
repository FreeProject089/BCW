// agent-bcw-nav: the topbar's ONE projects menu.
//
// There used to be two ways to the projects: the "Projects" group in the pill bar (the site's
// own apps) and a separate Orbit button at the right end of the bar (the other projects). The
// owner wanted one door. This module decides what that single menu holds, so the desktop
// dropdown and the phone sheet can never disagree about it.

/** The nav group that holds the projects: the first group whose links point at project pages,
 *  or the built-in Apps / Projects group. -1 when the configured nav has none (then the old
 *  separate button stays, so the projects are never unreachable). */
export function findProjectsGroup(items) {
  const list = Array.isArray(items) ? items : [];
  return list.findIndex((it) => it && it.type === 'group' && (
    it.k === 'nav.apps' || it.k === 'nav.projects'
    || (it.children || []).some((c) => /^\/(p|project)\//.test(String(c?.to || '')))
  ));
}

/** The other projects the menu lists after the group's own links: the pinned ones, or the first
 *  few when none is pinned, never one the group already links to, capped at `max`. */
export function otherProjectsFor({ groupChildren = [], pinned = [], all = [], max = 6 } = {}) {
  const taken = new Set(groupChildren.map((c) => String(c?.to || '')));
  const source = pinned.length ? pinned : all;
  return source.filter((p) => p && p.slug && !taken.has(`/project/${p.slug}`)).slice(0, Math.max(0, max));
}

/** How the phone sheet lays out `count` projects in a row of `columns` tiles.
 *  - 'row':  everything fits one row of tiles;
 *  - 'more': the first `columns - 1` as tiles, then a "More" tile opening a compact list.
 *  Never the old boxed strip that wrapped three tiles onto two lines. */
export function mobileProjectsLayout(count, columns = 4) {
  const cols = columns === 3 ? 3 : 4;
  if (count <= cols) return { mode: 'row', tiles: count, rest: 0, columns: Math.max(1, count) };
  return { mode: 'more', tiles: cols - 1, rest: count - (cols - 1), columns: cols };
}
