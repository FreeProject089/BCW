// Who counts as staff, and which built-in topbar buttons a given viewer may see.
//
// This lives in its own module rather than in App.jsx because TWO places render the
// topbar: the real one (App.jsx) and its admin Live preview (pages/admin.jsx). The
// preview used to re-implement these rules by hand and drifted — it showed "Log out"
// and "Sign in" side by side, states that can never coexist. One rule, imported twice.
export const ADMIN_TIER_ROLES = ['MOD', 'ADMIN', 'SUPERADMIN'];

// Effective capabilities the viewer holds: individual grants UNION any custom-role
// bundles. The server computes this in /me (effectivePermissions); fall back to the raw
// permissions column for older payloads.
export function effectiveCaps(user) {
  return user?.effectivePermissions || user?.permissions || [];
}

// Does this user hold at least one per-project EDIT grant (a specific project or the
// blanket "all other-projects")? Such a grantee reaches the dashboard's project tabs even
// with no admin role or capability.
export function hasProjectGrant(user) {
  const g = user?.projectGrants;
  return !!g && (g.allShowcase || (g.showcaseIds?.length > 0) || (g.projectKeys?.length > 0));
}

export function canAdmin(user) {
  if (!user) return false;
  return ADMIN_TIER_ROLES.includes(user.role) || effectiveCaps(user).length > 0 || hasProjectGrant(user);
}

// Hard precondition for each configurable topbar utility button. The admin's nav config
// can only further HIDE a button — it can never show one whose precondition says no.
export function utilAllowed(key, user) {
  switch (key) {
    case 'notifications':
    case 'dashboard':
    case 'profile':
    case 'logout':
      return !!user;
    case 'admin':
      return canAdmin(user);
    case 'login':
      return !user;
    default:
      return true; // projects · lang · theme · settings — everyone
  }
}

/**
 * May this person edit THIS project's page?
 *
 * The client's half of the server's `canEditProject` (lib.mjs): the manage_projects
 * capability, or a per-project grant for this key. The grants ride in /me as
 * `projectGrants.projectKeys`, so nothing here needs a request.
 *
 * This decides whether an "Edit page" link is drawn, never whether an edit is allowed — the
 * server answers that again on every write. A link that appears for somebody who cannot use
 * it is a small rudeness; a link that is MISSING for somebody who can is the reason the
 * project page had no way back to its own editor.
 */
export function canEditProject(user, projectKey) {
  if (!user || !projectKey) return false;
  if (effectiveCaps(user).includes('manage_projects')) return true;
  const keys = user?.projectGrants?.projectKeys;
  return Array.isArray(keys) ? keys.includes(projectKey) : !!keys?.has?.(projectKey);
}
