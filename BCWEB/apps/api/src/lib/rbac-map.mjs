// Which guard protects which route — read from the routes, not from a document.
//
// BCWEB has SEVEN ways to protect an endpoint — counted in the source, not remembered:
// requireRole, requireCap, optionalAuth, apiAuth, resolve, oauthBearer, requireEditor.
// Nothing anywhere lists which route uses which. The question "is there an admin route with no guard on it" could only be answered
// by reading eleven thousand lines of route files, so in practice it was not answered.
//
// This is a pure function of the source text: hand it the files, get back a map. That means
// it can be tested, and it means the map cannot drift from the code the way a written
// document does — there is nothing to keep in sync.
//
// What it deliberately does NOT do is judge. "Unguarded" is a fact about a line of code;
// whether that is wrong depends on whether the route is meant to be public, and a tool that
// decided for you would either cry wolf on /repos.json or teach you to ignore it.

/**
 * How a route is protected.
 *
 * Every form was COUNTED in the source before this list was written, not remembered:
 * requireRole 321, requireCap 120, optionalAuth 51, apiAuth 20, resolve 13, oauthBearer
 * 11, requireEditor 5. The first version of this file knew four of the seven and reported
 * twenty guarded /admin routes as unguarded — a security report that is wrong in the
 * alarming direction, which is the kind people stop reading after the first false alarm.
 *
 * Order matters: requireCap contains the string "require", so a looser pattern would
 * classify everything as whichever it matched first.
 */
const GUARDS = [
  { kind: 'cap', re: /requireCap\(\s*'([^']+)'((?:\s*,\s*'[^']+')*)\s*\)/ },
  { kind: 'editor', re: /requireEditor\(\s*\)/ },
  // One OR MORE roles. requireRole('MOD', 'ADMIN') is common and a single-argument
  // pattern misses every one of them.
  { kind: 'role', re: /requireRole\(\s*('[^']+'(?:\s*,\s*'[^']+')*)\s*\)/ },
  { kind: 'signed-in', re: /requireRole\(\s*\)/ },
  // Authenticated by an API key rather than a session — guarded, differently.
  { kind: 'api-key', re: /apiAuth\(/ },
  { kind: 'oauth', re: /oauthBearer\(/ },
  // optionalAuth fills req.user when a session exists and allows the request either way.
  // NOT a guard: the route itself decides, which is why /me returns { user: null } rather
  // than a 401. Classified separately so it is never counted as protection.
  { kind: 'optional', re: /optionalAuth\(/ },
  { kind: 'resolver', re: /preHandler: resolve\(/ },
];

/** Routes that are public ON PURPOSE. Prefixes rather than exact paths, because the feeds
 *  carry parameters. Listed here so "unguarded" can mean "unguarded and not meant to be" —
 *  a report where every public feed is a finding is a report nobody reads twice. */
const PUBLIC_BY_DESIGN = [
  '/repos.json', '/catalog.json', '/catalogs.json', '/health', '/live', '/ready',
  '/auth/', '/webhook', '/og/', '/c/', '/u/', '/v1/webhook-events',
];

/**
 * Parse one route file.
 *
 * Matches `app.get('/path', { … }, handler)` and pulls the guard out of the options object
 * when there is one. Deliberately line-based and shallow: a real parser would be better and
 * is not worth a dependency for something whose failure mode is "reports fewer routes than
 * exist", which the count check below catches.
 */
export function parseRoutes(filename, src) {
  const out = [];
  const lines = String(src).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/\bapp\.(get|post|put|patch|delete)\(\s*'([^']+)'/);
    if (!m) continue;
    const [, verb, path] = m;
    // The options object may be on this line or the next few — preHandler is conventionally
    // written just under the path. Six lines covers every shape in this codebase without
    // running into the next route.
    const window = lines.slice(i, i + 6).join('\n');
    let guard = { kind: 'none' };
    for (const g of GUARDS) {
      const hit = window.match(g.re);
      if (!hit) continue;
      if (g.kind === 'cap') {
        const extraRoles = [...(hit[2] || '').matchAll(/'([^']+)'/g)].map((x) => x[1]);
        guard = { kind: 'cap', capability: hit[1], alsoRoles: extraRoles };
      } else if (g.kind === 'role') {
        const roles = [...hit[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
        guard = { kind: 'role', role: roles.join(' or '), roles };
      } else {
        guard = { kind: g.kind };
      }
      break;
    }
    // `line` is unused by this map and needed by the data-flow one, which attributes each
    // database call to the route it sits under.
    out.push({ file: filename, verb: verb.toUpperCase(), path, guard, line: i + 1 });
  }
  return out;
}

/** True when a path is public on purpose. */
export function isPublicByDesign(path) {
  return PUBLIC_BY_DESIGN.some((p) => path === p || path.startsWith(p));
}

/**
 * The map, plus the two things worth looking at.
 *
 * `suspicious` is the useful output: an unguarded route whose path says it is not meant to
 * be public. /admin/ and /me/ are the two prefixes that carry that meaning here — one is
 * staff, the other is somebody's own data, and neither can be served to a stranger.
 */
export function buildRbacMap(files) {
  const routes = files.flatMap(({ name, src }) => parseRoutes(name, src));

  const byCapability = new Map();
  const byRole = new Map();
  const unguarded = [];
  const suspicious = [];

  for (const r of routes) {
    const label = `${r.verb} ${r.path}`;
    if (r.guard.kind === 'cap') {
      const key = r.guard.capability;
      (byCapability.get(key) ?? byCapability.set(key, []).get(key)).push(label);
    } else if (r.guard.kind === 'role') {
      const key = r.guard.role;
      (byRole.get(key) ?? byRole.set(key, []).get(key)).push(label);
    } else if (r.guard.kind === 'none' || r.guard.kind === 'optional') {
      // optionalAuth counts as unguarded here on purpose: it lets the request through and
      // leaves the decision to the handler. That is a legitimate pattern — /me answers
      // { user: null } — and it is also exactly how a route ends up open by accident.
      unguarded.push(r);
      if (/^\/(admin|me)\b/.test(r.path) && !isPublicByDesign(r.path)) suspicious.push(r);
    }
  }

  return {
    total: routes.length,
    routes,
    byCapability: [...byCapability].map(([capability, paths]) => ({ capability, paths })).sort((a, b) => b.paths.length - a.paths.length),
    byRole: [...byRole].map(([role, paths]) => ({ role, paths })).sort((a, b) => b.paths.length - a.paths.length),
    unguarded: unguarded.map((r) => `${r.verb} ${r.path}`),
    suspicious: suspicious.map((r) => ({ route: `${r.verb} ${r.path}`, file: r.file })),
  };
}
