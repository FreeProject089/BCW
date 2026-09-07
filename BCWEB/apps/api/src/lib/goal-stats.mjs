// Measuring one conversion goal over one time range.
//
// Lifted out of routes/analytics.mjs for two reasons.
//
// First, the goals endpoint now measures every goal TWICE — the window you asked for and the
// window immediately before it, so a goal can say whether it is going up or down instead of
// reporting a bare number against nothing. Two windows measured by two slightly different
// pieces of code is how a comparison ends up reporting a change that never happened, so there
// is one function and it takes the range as an argument.
//
// Second, it is untestable where it was. The endpoint is behind requireCap('manage_analytics')
// and admin routes require 2FA, so nothing in a test can reach it — while the part most likely
// to be quietly wrong is the positional-parameter numbering in the SQL below, which shifts with
// every optional clause. Here it can be run against a real Postgres with known rows.
//
// Names of columns are interpolated; VALUES are always parameters.
export const DIMENSION_KINDS = { referrer: 'ref', country: 'country', region: 'region', city: 'city', device: 'device', os: 'os', browser: 'browser' };

/**
 * @param {import('@prisma/client').PrismaClient} p
 * @param {{kind: string, path?: string|null, label?: string|null}} g   the goal
 * @param {Date}      from   inclusive lower bound
 * @param {Date|null} to     exclusive upper bound; null for the live window (no upper bound)
 * @returns {Promise<{completions: number, visitors: number}>}
 */
export async function measureGoal(p, g, from, to = null) {
  const at = to ? { gte: from, lt: to } : { gte: from };
  const pathCond = g.path ? { path: { contains: g.path, mode: 'insensitive' } } : {};

  // Build the parameter list and the SQL together, so an added clause cannot shift a
  // placeholder out from under its value. $1 is always `from`; `to`, when present, is always
  // last — everything optional sits between them and is numbered as it is appended.
  // Each `extra` entry is [sqlWithOneDollarNPerValue, ...values]. `$n` is replaced left to
  // right with the number the value gets as it is pushed, so a clause can never be numbered
  // for a position it does not occupy.
  const build = (table, extra) => {
    const params = [from];
    const where = ['"createdAt" >= $1'];
    for (const [sql, ...vals] of extra) {
      let i = 0;
      where.push(sql.replace(/\$n/g, () => `$${params.length + (++i)}`));
      params.push(...vals);
    }
    if (to) { params.push(to); where[0] = `"createdAt" >= $1 AND "createdAt" < $${params.length}`; }
    return { sql: `SELECT count(DISTINCT visitor)::int AS n FROM "${table}" WHERE ${where.join(' AND ')} AND visitor IS NOT NULL`, params };
  };

  if (g.kind === 'pageview') {
    const { sql, params } = build('AnalyticsEvent', g.path ? [[`path ILIKE $n`, `%${g.path}%`]] : []);
    const [c, v] = await Promise.all([
      p.analyticsEvent.count({ where: { createdAt: at, ...pathCond } }),
      p.$queryRawUnsafe(sql, ...params),
    ]);
    return { completions: c, visitors: Number(v?.[0]?.n || 0) };
  }

  if (DIMENSION_KINDS[g.kind]) {
    // A pageview-dimension goal: match visitors by referrer / geo / tech attribute.
    const field = DIMENSION_KINDS[g.kind];
    const val = (g.label || '').trim();
    // country/device match exactly (short controlled vocab); the rest are contains.
    const exact = g.kind === 'country' || g.kind === 'device';
    const dimCond = val
      ? { [field]: exact ? { equals: val, mode: 'insensitive' } : { contains: val, mode: 'insensitive' } }
      : { [field]: { not: null } };
    const extra = [];
    if (val) extra.push([`"${field}" ILIKE $n`, exact ? val : `%${val}%`]);
    else extra.push([`"${field}" IS NOT NULL`]);
    if (g.path) extra.push([`path ILIKE $n`, `%${g.path}%`]);
    const { sql, params } = build('AnalyticsEvent', extra);
    // Counted in POSTGRES. This branch used findMany({ select: { visitor }, distinct }) and
    // then read the array's length — streaming one row per distinct visitor into node purely
    // to count them, where every other branch asked the database for the integer.
    const [c, v] = await Promise.all([
      p.analyticsEvent.count({ where: { createdAt: at, ...pathCond, ...dimCond } }),
      p.$queryRawUnsafe(sql, ...params),
    ]);
    return { completions: c, visitors: Number(v?.[0]?.n || 0) };
  }

  const labelCond = g.label ? { label: { contains: g.label, mode: 'insensitive' } } : {};
  const extra = [[`kind = $n`, g.kind]];
  if (g.path) extra.push([`path ILIKE $n`, `%${g.path}%`]);
  if (g.label) extra.push([`label ILIKE $n`, `%${g.label}%`]);
  const { sql, params } = build('InteractionEvent', extra);
  const [c, v] = await Promise.all([
    p.interactionEvent.count({ where: { createdAt: at, kind: g.kind, ...pathCond, ...labelCond } }),
    p.$queryRawUnsafe(sql, ...params),
  ]);
  return { completions: c, visitors: Number(v?.[0]?.n || 0) };
}
