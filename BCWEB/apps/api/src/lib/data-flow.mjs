// Where the data actually goes: which route touches which table, and how.
//
// The schema map draws the models and their relations. The RBAC map says which guard sits on
// which route. Neither answers the question somebody actually asks — "if I change the User
// model, what breaks", and its sharper form: "what can an unauthenticated request WRITE".
//
// That second one is not answerable by reading either map alone. A route with no guard is
// normal (public feeds, sign-in, webhooks); a route with no guard that CREATES rows is a
// different thing, and the only way to see it is to join the two.
//
// Line-based and shallow on purpose, like the RBAC map it borrows parseRoutes from. Its
// failure mode is reporting FEWER calls than exist, which is visible in a count, rather than
// inventing edges that send somebody to read code that does nothing.

/** Prisma operations, split by what they do to the row. The distinction is the whole point:
 *  a public route that reads is a feed, a public route that writes is a question. */
const WRITES = new Set([
  'create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'upsert',
  'delete', 'deleteMany',
]);
const READS = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany',
  'count', 'aggregate', 'groupBy',
]);

/**
 * Every `p.model.operation(` in a file, with the line it is on.
 *
 * The client is bound to `p` throughout this codebase (`const p = await db()`), so that is
 * what is matched. A call through any other name is missed — which undercounts rather than
 * invents, and the model list is checked against the schema by the caller.
 */
export function findDbCalls(src) {
  const out = [];
  const lines = String(src).split(/\r?\n/);
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    // A commented-out query is not a query, and `$transaction` / `$queryRaw` are not model
    // calls — they are reported separately by the caller if at all.
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    for (const m of line.matchAll(/\bp\.([a-z][A-Za-z0-9]*)\.([a-zA-Z]+)\s*\(/g)) {
      const [, model, op] = m;
      if (!WRITES.has(op) && !READS.has(op)) continue;
      out.push({ model, op, write: WRITES.has(op), line: i + 1 });
    }
  });
  return out;
}

/**
 * Functions in this file that reject a request themselves.
 *
 * Not every guard is a preHandler. bot.mjs authenticates with `botAuth(req, reply)` inside
 * each handler — a safeEqual against a shared secret — and the RBAC map, which only reads
 * preHandler, calls all fifteen of those routes unguarded. Reporting them as writable by an
 * unauthenticated request would be crying wolf on the majority of the list, and a list that
 * is mostly wrong is a list nobody finishes.
 *
 * Derived from the source rather than a hardcoded set of names: a local function that sends
 * a 401 or a 403 is a guard, whatever it is called.
 */
export function findInHandlerGuards(src) {
  const names = new Set();
  const text = String(src);
  for (const m of text.matchAll(/\bfunction\s+([A-Za-z0-9_]+)\s*\([^)]*\)\s*\{/g)) {
    // The body, bounded by the next top-level function or 60 lines — enough for a guard,
    // short enough not to swallow the file.
    const body = text.slice(m.index, m.index + 2000);
    if (/reply\.code\(\s*40[13]\s*\)/.test(body)) names.add(m[1]);
  }
  return names;
}

/**
 * Attribute each call to the route it sits under.
 *
 * A call before the first route in a file belongs to no route — module-level helpers,
 * sweepers, boot code. Those are returned separately rather than folded into the first
 * route, which would be a confident lie about who can reach them.
 */
export function attribute(routes, calls) {
  const sorted = [...routes].sort((a, b) => a.line - b.line);
  const byRoute = new Map();
  const outsideRoutes = [];
  for (const c of calls) {
    let owner = null;
    for (const r of sorted) {
      if (r.line <= c.line) owner = r;
      else break;
    }
    if (!owner) { outsideRoutes.push(c); continue; }
    const key = `${owner.verb} ${owner.path}`;
    if (!byRoute.has(key)) byRoute.set(key, { route: key, guard: owner.guard, file: owner.file, calls: [] });
    byRoute.get(key).calls.push(c);
  }
  return { byRoute: [...byRoute.values()], outsideRoutes };
}

/**
 * The map.
 *
 * `writableUnauthenticated` is the list to read. It is NOT automatically a fault: sign-up
 * creates a User, a webhook writes a Payment, the 404 game records a score — all correct,
 * all unguarded by design. It is the list somebody should be able to recite, and the point
 * is that until now nobody could.
 */
export function buildDataFlow(files, parseRoutes) {
  const allRoutes = [];
  const perModel = new Map();
  const outside = [];

  for (const { name, src } of files) {
    const routes = parseRoutes(name, src);
    allRoutes.push(...routes);
    const { byRoute, outsideRoutes } = attribute(routes, findDbCalls(src));
    outside.push(...outsideRoutes.map((c) => ({ ...c, file: name })));

    for (const entry of byRoute) {
      for (const c of entry.calls) {
        if (!perModel.has(c.model)) perModel.set(c.model, { model: c.model, reads: 0, writes: 0, routes: new Set() });
        const m = perModel.get(c.model);
        if (c.write) m.writes++; else m.reads++;
        m.routes.add(entry.route);
      }
    }
  }

  const writableUnauthenticated = [];
  const writableInHandlerGuard = [];
  for (const { name, src } of files) {
    const routes = parseRoutes(name, src).sort((a, b) => a.line - b.line);
    const { byRoute } = attribute(routes, findDbCalls(src));
    const guards = findInHandlerGuards(src);
    const lines = String(src).split(/\r?\n/);

    for (const entry of byRoute) {
      if (entry.guard?.kind !== 'none') continue;
      const models = [...new Set(entry.calls.filter((c) => c.write).map((c) => c.model))];
      if (!models.length) continue;

      // Does this route's own body call one of the file's rejecting functions? The span runs
      // to the next route, which is where a handler ends in every file here.
      const me = routes.find((r) => `${r.verb} ${r.path}` === entry.route);
      const next = routes.find((r) => r.line > (me?.line ?? 0));
      const body = lines.slice((me?.line ?? 1) - 1, next ? next.line - 1 : lines.length).join('\n');
      const used = [...guards].filter((g) => new RegExp(`\\b${g}\\s*\\(`).test(body));

      const row = { route: entry.route, file: entry.file, models };
      if (used.length) { writableInHandlerGuard.push({ ...row, guard: used.join(', ') }); continue; }

      // Some routes do their own check inline instead of through a helper: /webhooks/kofi
      // safeEquals a configured token and 401s before writing anything.
      //
      // Reported as a FACT, not promoted to "guarded" — because /auth/login/2fa also 401s,
      // and there the 401 is a failed password check on a genuinely public endpoint. The two
      // are structurally identical and mean opposite things, and no rule I can write tells
      // them apart. A flag that says "this one rejects on its own, go look" is worth more
      // than a verdict that is right half the time.
      writableUnauthenticated.push({ ...row, selfRejects: /reply\.code\(\s*40[13]\s*\)/.test(body) });
    }
  }

  const models = [...perModel.values()]
    .map((m) => ({ model: m.model, reads: m.reads, writes: m.writes, routes: m.routes.size }))
    .sort((a, b) => (b.reads + b.writes) - (a.reads + a.writes));

  return {
    counts: {
      routes: allRoutes.length,
      models: models.length,
      calls: models.reduce((n, m) => n + m.reads + m.writes, 0),
      outsideRoutes: outside.length,
      writableUnauthenticated: writableUnauthenticated.length,
      writableInHandlerGuard: writableInHandlerGuard.length,
    },
    models,
    writableUnauthenticated,
    // Guarded, just not by a preHandler — so they belong beside the list rather than in it.
    writableInHandlerGuard,
    // Sweepers, boot code and helpers. Reachable by no request, which is worth seeing
    // separately rather than attributed to whichever route happened to be above them.
    outsideRoutes: outside.slice(0, 40),
  };
}
