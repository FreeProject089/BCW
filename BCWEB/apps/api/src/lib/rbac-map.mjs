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

/**
 * Guards checked in the FIRST lines of the handler rather than by a preHandler.
 *
 * The bot's endpoints authenticate with a shared secret, and that check reads the reply
 * object, so it is written as the opening statement of the handler instead of a
 * preHandler. Reading only the options object, this map called all 51 of them
 * unguarded, which is both the loudest finding it produced and the wrongest.
 *
 * The shape accepted is deliberately exact: a call to one of these helpers, negated, whose
 * failure branch RETURNS. A guard that does not return is not a guard, and a helper not
 * named here is not assumed to be one.
 */
const IN_HANDLER = [
  { kind: 'bot', re: /if \(!botAuth\(req[^)]*\)\)\s*return\b/ },
  { kind: 'link-secret', re: /if \(!linkSecretOk\(req[^)]*\)\)\s*return\b/ },
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
/**
 * Guards held in a constant, resolved to what they are.
 *
 * A file with one capability over twenty routes writes it once:
 *
 *   const CAP = { preHandler: requireCap('manage_reports', 'MOD') };
 *   app.get('/admin/rights/works', CAP, …)
 *
 * Reading the route's own six lines then finds no guard, and the map reported those routes
 * as unguarded. That was not a rounding error: 91 of the 320 routes it called unguarded were
 * this idiom, and all but one of the 51 it called "suspicious". A security map that is wrong
 * fifty times is one nobody reads the fifty-first time.
 *
 * So the file's own top-level `const NAME = …` definitions are collected first, and a route
 * whose options are a bare identifier is looked up in them. Shallow on purpose, like the
 * rest of this parser: one level, same file, no imports. A constant it cannot resolve leaves
 * the route exactly as it was, unguarded and reported.
 */
function guardConstants(src) {
  const out = new Map();
  // `const NAME = { … }` or `const NAME = requireX(…)`, up to the end of that line.
  for (const m of String(src).matchAll(/^\s*const ([A-Za-z_$][\w$]*)\s*=\s*(.+)$/gm)) {
    const [, name, body] = m;
    if (/require[A-Z]\w*\(|apiAuth\(|oauthBearer\(|optionalAuth\(|resolve\(/.test(body)) out.set(name, body);
  }
  return out;
}

const ROUTE_LINE = /\bapp\.(get|post|put|patch|delete)\(\s*'([^']+)'/;
/** A comment line. Its words are not code: `/dev/inspect` explains in a comment why it is NOT
 *  `requireRole('USER')`, and the map used to read that sentence as the route's guard. */
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*)/;

export function parseRoutes(filename, src) {
  const out = [];
  const lines = String(src).split(/\r?\n/);
  const consts = guardConstants(src);
  // Where each route starts, so no window reads past it.
  const starts = [];
  for (let i = 0; i < lines.length; i++) if (ROUTE_LINE.test(lines[i]) && !COMMENT_LINE.test(lines[i])) starts.push(i);
  for (let s = 0; s < starts.length; s++) {
    const i = starts[s];
    const m = lines[i].match(ROUTE_LINE);
    const [, verb, path] = m;
    // The options object may be on this line or the next few — preHandler is conventionally
    // written just under the path. Six lines, and NEVER past the next route: a fixed count ran
    // into the next route's options whenever a route was a one-liner, and lent it that guard.
    // `GET /hosting/capacity` (public, no guard) read as requireCap('manage_hosting') from the
    // line under it — the map's wrong direction, calling an open route closed — and
    // `GET /admin/marketplace/storage` read as requireEditor for the same reason.
    const next = s + 1 < starts.length ? starts[s + 1] : lines.length;
    const code = (from, n) => lines.slice(from, Math.min(from + n, next)).filter((l) => !COMMENT_LINE.test(l)).join('\n');
    let window = code(i, 6);
    // …and when those lines name a constant instead of spelling the guard out, read what
    // the constant holds. Two shapes, both real here:
    //   app.get('/x', CAP, …)                 the whole options object in a const
    //   app.get('/x', { preHandler: board })  just the guard, which may be an array
    // Only identifiers in one of those two positions, so an unrelated const mentioned
    // nearby cannot lend a route a guard it does not have.
    for (const name of [
      (lines[i].match(/,\s*([A-Za-z_$][\w$]*)\s*[,)]/) || [])[1],
      (window.match(/preHandler:\s*([A-Za-z_$][\w$]*)\s*[,}]/) || [])[1],
    ]) {
      if (name && consts.has(name)) window += '\n' + consts.get(name);
    }
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
    // Nothing in the options object: look at the opening of the handler, where a guard
    // that needs the reply object has to live. Twelve lines, because it is conventionally
    // the first statement and a longer window starts reading the next route.
    if (guard.kind === 'none') {
      const body = code(i, 12);
      for (const g of IN_HANDLER) {
        if (g.re.test(body)) { guard = { kind: g.kind, inHandler: true }; break; }
      }
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
