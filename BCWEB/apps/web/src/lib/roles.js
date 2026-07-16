// Who counts as staff, and which built-in topbar buttons a given viewer may see.
//
// This lives in its own module rather than in App.jsx because TWO places render the
// topbar: the real one (App.jsx) and its admin Live preview (pages/admin.jsx). The
// preview used to re-implement these rules by hand and drifted — it showed "Log out"
// and "Sign in" side by side, states that can never coexist. One rule, imported twice.
export const ADMIN_TIER_ROLES = ['MOD', 'ADMIN', 'SUPERADMIN'];

export function canAdmin(user) {
  if (!user) return false;
  return ADMIN_TIER_ROLES.includes(user.role) || (user.permissions?.length > 0);
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
