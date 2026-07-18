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
