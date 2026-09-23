// Custom domains: claim one, prove you hold it, and serve on it.
//
// Three audiences, one file, because they are one feature and splitting them is how the rules
// drift apart:
//
//   * the OWNER adds a host to a repo or a catalogue and asks us to check it;
//   * the EDGE asks, before obtaining a TLS certificate, whether a host is one of ours;
//   * every REQUEST arriving on a name that is not the site's own gets rewritten to whatever
//     that name points at.
//
// The eligibility rule (a paid pool) is enforced in all three, not just at the point of
// adding. A pool that lapses has to stop being a reason to renew a certificate, and a domain
// that stops being paid for has to stop resolving to content — otherwise cancelling leaves us
// serving somebody's traffic and buying their certificates indefinitely.
import dns from 'node:dns/promises';
import { z } from 'zod';
import { db, requireRole, logAudit, clientIp } from '../lib/lib.mjs';
import { normaliseHost, isServableHost, isOurOwnHost, domainEligible, txtMatches, genVerifyToken, dnsRecordsFor, pointsAtUs } from '../lib/domain.mjs';
import { recordChange } from '../lib/changelog.mjs';

/** Our own hostname, from the configured site URL. Empty if unset — see isOurOwnHost. */
export function siteHost() {
  try { return new URL(process.env.SITE_URL || '').hostname; } catch { return ''; }
}

/** What the owner is shown. The token is not a secret — it is published in DNS — but the
 *  row's internal ids are noise. */
export function domainView(d) {
  if (!d) return null;
  const records = dnsRecordsFor(d.host, d.verifyToken, siteHost());
  return {
    id: d.id,
    host: d.host,
    verified: !!d.verifiedAt,
    verifiedAt: d.verifiedAt,
    lastCheckedAt: d.lastCheckedAt,
    lastError: d.lastError,
    createdAt: d.createdAt,
    // Everything the owner needs to type into their DNS panel, so the UI never assembles it
    // from parts and gets the separator wrong.
    record: records.proof,
    // Where the traffic goes: a CNAME to our own hostname, from the same helper as the proof
    // (null on a stack with no SITE_URL, where there is no name to point at).
    pointer: records.pointer,
  };
}

/**
 * Resolve a request's Host header to what should serve it.
 *
 * Returns null for our own hostname and for anything unknown — the caller then behaves
 * exactly as it did before custom domains existed. A domain is only honoured when it is
 * verified AND still eligible, which is why the pool is loaded here rather than trusted from
 * the row.
 */
export async function resolveHostTarget(p, hostHeader) {
  const host = normaliseHost(hostHeader);
  if (!host || isOurOwnHost(host, siteHost())) return null;
  const d = await p.customDomain.findUnique({
    where: { host },
    include: {
      repo: { select: { id: true, hosted: true, hostPath: true, published: true, status: true, group: { select: { id: true, freePlan: true } } } },
      catalog: { select: { id: true, slug: true, status: true, visibility: true, group: { select: { id: true, freePlan: true } } } },
    },
  });
  if (!d || !d.verifiedAt) return null;
  if (d.repo) {
    // `hosted` for a repo, and a published one: an unpublished repo has no public path, so a
    // domain pointing at it would 404 on every request with no way to tell why.
    if (!domainEligible(d.repo).ok || !d.repo.published) return null;
    return { kind: 'repo', hostPath: d.repo.hostPath, id: d.repo.id };
  }
  if (d.catalog) {
    if (!domainEligible({ hosted: true, hostPath: d.catalog.slug, group: d.catalog.group }).ok) return null;
    if (d.catalog.status !== 'ACTIVE') return null;
    return { kind: 'catalog', slug: d.catalog.slug, id: d.catalog.id };
  }
  return null;
}

/*
 * The verified domains, synchronously.
 *
 * `rewriteUrl` runs before routing — which is the only place a URL rewrite CAN run — and it
 * cannot await, so the routing table has to be in memory. Refreshed on a timer and invalidated
 * by every write here, so a domain starts and stops working within one refresh at worst and
 * immediately in the ordinary case.
 *
 * Eligibility (a paid pool, still verified, still published) is decided when the map is BUILT,
 * so a lapsed pool stops routing at the next refresh rather than being re-checked per request.
 * The certificate side is unaffected: /domains/ask still asks the database every time.
 */
const _hostMap = new Map();
let _hostMapAt = 0;
const HOST_MAP_TTL_MS = 60_000;

/** What should serve this Host header, or null. Synchronous by necessity. */
export function hostTargetSync(hostHeader) {
  const host = normaliseHost(String(hostHeader || '').split(':')[0]);
  if (!host) return null;
  return _hostMap.get(host) || null;
}

/** Rebuild the map. Cheap: one indexed query over a table with one row per customer domain. */
export async function refreshHostMap(p) {
  const rows = await p.customDomain.findMany({
    where: { verifiedAt: { not: null } },
    include: {
      repo: { select: { id: true, hosted: true, hostPath: true, published: true, group: { select: { freePlan: true } } } },
      catalog: { select: { id: true, slug: true, status: true, group: { select: { freePlan: true } } } },
    },
    take: 20_000,
  });
  _hostMap.clear();
  for (const d of rows) {
    if (d.repo) {
      if (!domainEligible(d.repo).ok || !d.repo.published) continue;
      _hostMap.set(d.host, { kind: 'repo', hostPath: d.repo.hostPath, id: d.repo.id });
    } else if (d.catalog) {
      if (!domainEligible({ hosted: true, hostPath: d.catalog.slug, group: d.catalog.group }).ok) continue;
      if (d.catalog.status !== 'ACTIVE') continue;
      _hostMap.set(d.host, { kind: 'catalog', slug: d.catalog.slug, id: d.catalog.id });
    }
  }
  _hostMapAt = Date.now();
  return _hostMap.size;
}

/** Refresh if it is stale. Called from the sweeper; never throws into the caller. */
export async function refreshHostMapIfStale(p) {
  if (Date.now() - _hostMapAt < HOST_MAP_TTL_MS) return -1;
  try { return await refreshHostMap(p); } catch { return -1; }
}

/**
 * The rewrite itself, as a pure function of (host, url, target) so it can be tested without a
 * server. Returns the new URL, or the original when nothing should change.
 */
export function rewriteForTarget(target, url) {
  if (!target) return url;
  const [path, query] = String(url || '/').split('?');
  const q = query ? `?${query}` : '';
  // A `..` segment is refused rather than rewritten. It is not exploitable downstream today —
  // the wildcard is compared against exact stored paths and never reaches a filesystem — but
  // depending on a property of a module two files away is how it quietly stops being true.
  const decoded = (() => { try { return decodeURIComponent(path); } catch { return path; } })();
  if (/(^|\/)\.\.(\/|$)/.test(decoded) || /(^|\/)\.\.(\/|$)/.test(path)) return url;
  if (target.kind === 'repo') {
    const base = `/hosting/${target.hostPath}`;
    // The apex of a repo domain is its manifest: a client handed the bare hostname is asking
    // for the repo, and the repo IS repo.json.
    return (path === '/' || path === '') ? `${base}/repo.json${q}` : `${base}/files${path}${q}`;
  }
  const base = `/c/${target.slug}`;
  return (path === '/' || path === '') ? `${base}/catalog.json${q}` : `${base}${path}${q}`;
}

export default async function domainRoutes(app) {
  // ── the edge, before it obtains a certificate ─────────────────────────────────────────
  //
  // Caddy's `on_demand_tls { ask <url> }` calls this with ?domain=. 200 means "issue"; any
  // other status means refuse. Unauthenticated by necessity — the edge has no session — so
  // it must leak nothing and cost nothing: one indexed lookup, and the same empty answer for
  // "no such domain" and "not allowed any more".
  app.get('/domains/ask', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (req, reply) => {
    // The edge reaches this at http://api:3000/domains/ask, but the public site also proxies
    // /api/* to the same server — so without a guard this is an unauthenticated oracle:
    // 200 means "that hostname is hosted here", 404 means it is not, for any name a stranger
    // cares to try (CWE-200). The edge additionally blocks the public path; this is the half
    // that survives the API being reachable some other way.
    //
    // Optional so an existing deployment does not break by upgrading: unset behaves as before.
    const key = process.env.DOMAIN_ASK_KEY || '';
    if (key && String(req.query?.key || '') !== key) return reply.code(404).send({ error: 'unknown_domain' });
    const host = normaliseHost(req.query?.domain);
    if (!host) return reply.code(400).send({ error: 'bad_request' });
    // Our own name is always allowed: refusing it here would stop the site getting its own
    // certificate the first time it is asked for.
    if (isOurOwnHost(host, siteHost())) return reply.send({ ok: true });
    const p = await db();
    const target = await resolveHostTarget(p, host);
    if (!target) return reply.code(404).send({ error: 'unknown_domain' });
    return reply.send({ ok: true });
  });

  // ── the public guide ──────────────────────────────────────────────────────────────────
  //
  // What /hosting shows a reader who has not bought anything yet: the two records, for an
  // example name (or the one they type), built by the same helper that hands the owner their
  // real ones. Nothing here is secret: the prefix is published in every customer's zone and
  // our hostname is the site's own address. The token is a placeholder, never a real one.
  app.get('/domains/guide', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const asked = normaliseHost(req.query?.host);
    const host = asked && isServableHost(asked) && !isOurOwnHost(asked, siteHost()) ? asked : 'mods.example.com';
    const records = dnsRecordsFor(host, 'bcwv_…', siteHost());
    return { host, proof: records.proof, pointer: records.pointer };
  });

  // ── the owner ─────────────────────────────────────────────────────────────────────────
  //
  // Owner-only, and for a repo the same rule as the agent token: a shared dashboard password
  // must not be able to attach a hostname to somebody else's content.
  const load = async (req, reply) => {
    const p = await db();
    const { kind, id } = req.params;
    if (kind !== 'repos' && kind !== 'catalogs') { reply.code(404).send({ error: 'not_found' }); return null; }
    const subject = kind === 'repos'
      ? await p.serverRepo.findUnique({ where: { id }, select: { id: true, name: true, ownerId: true, hosted: true, hostPath: true, group: { select: { id: true, freePlan: true } }, domain: true } })
      : await p.communityCatalog.findUnique({ where: { id }, select: { id: true, name: true, ownerId: true, slug: true, group: { select: { id: true, freePlan: true } }, domain: true } });
    if (!subject) { reply.code(404).send({ error: 'not_found' }); return null; }
    const staff = req.user.role === 'ADMIN' || req.user.role === 'SUPERADMIN';
    if (subject.ownerId !== req.user.uid && !staff) { reply.code(403).send({ error: 'forbidden' }); return null; }
    // A catalogue is always served from here, so the "is it hosted" half of the rule only
    // applies to repos. Normalised into the shape domainEligible expects.
    const forRule = kind === 'repos' ? subject : { hosted: true, hostPath: subject.slug, group: subject.group };
    return { p, kind, subject, forRule };
  };

  app.get('/me/:kind/:id/domain', { preHandler: requireRole() }, async (req, reply) => {
    const ctx = await load(req, reply); if (!ctx) return;
    return { domain: domainView(ctx.subject.domain), eligible: domainEligible(ctx.forRule) };
  });

  app.put('/me/:kind/:id/domain', {
    preHandler: requireRole(),
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const b = z.object({ host: z.string().min(3).max(253) }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const ctx = await load(req, reply); if (!ctx) return;

    const gate = domainEligible(ctx.forRule);
    if (!gate.ok) return reply.code(403).send({ error: gate.reason });

    const host = normaliseHost(b.data.host);
    if (!isServableHost(host)) return reply.code(400).send({ error: 'bad_host' });
    if (isOurOwnHost(host, siteHost())) return reply.code(400).send({ error: 'our_host' });

    // Taken by somebody else. Deliberately the same message whether it is another account's
    // or another of your own: which of the two it is would tell a stranger that a name they
    // do not control is already on the platform.
    const taken = await ctx.p.customDomain.findUnique({ where: { host }, select: { id: true, repoId: true, catalogId: true } });
    const mine = ctx.subject.domain?.id;
    if (taken && taken.id !== mine) return reply.code(409).send({ error: 'host_taken' });

    const key = ctx.kind === 'repos' ? { repoId: ctx.subject.id } : { catalogId: ctx.subject.id };
    const data = {
      host,
      ownerId: ctx.subject.ownerId,
      ...key,
      // A NEW token every time the host changes, and verification starts again from zero:
      // carrying the old proof across to a different name would verify the wrong zone.
      verifyToken: genVerifyToken(),
      verifiedAt: null, lastCheckedAt: null, lastError: null,
    };
    const out = mine
      ? await ctx.p.customDomain.update({ where: { id: mine }, data })
      : await ctx.p.customDomain.create({ data });
    await refreshHostMap(ctx.p).catch(() => {});
    await logAudit(ctx.p, req.user.uid, 'domain.set', `${ctx.subject.name} — ${host}`, clientIp(req)).catch(() => {});
    await recordChange(ctx.p, ctx.kind === 'repos' ? { repoId: ctx.subject.id } : { catalogId: ctx.subject.id }, {
      actorId: req.user.uid, actorLabel: req.user.name || req.user.uid, action: 'domain', summary: host,
      changes: [{ field: 'host', from: ctx.subject.domain?.host || null, to: host }],
    });
    return { domain: domainView(out) };
  });

  app.delete('/me/:kind/:id/domain', { preHandler: requireRole() }, async (req, reply) => {
    const ctx = await load(req, reply); if (!ctx) return;
    if (!ctx.subject.domain) return reply.code(404).send({ error: 'not_found' });
    await ctx.p.customDomain.delete({ where: { id: ctx.subject.domain.id } });
    await refreshHostMap(ctx.p).catch(() => {});
    await logAudit(ctx.p, req.user.uid, 'domain.remove', `${ctx.subject.name} — ${ctx.subject.domain.host}`, clientIp(req)).catch(() => {});
    await recordChange(ctx.p, ctx.kind === 'repos' ? { repoId: ctx.subject.id } : { catalogId: ctx.subject.id }, {
      actorId: req.user.uid, actorLabel: req.user.name || req.user.uid, action: 'domain', summary: '',
      changes: [{ field: 'host', from: ctx.subject.domain.host, to: null }],
    });
    return { ok: true };
  });

  // Check the zone now. Rate-limited because it makes us perform a DNS lookup on a name the
  // caller chose, and because the honest answer to "did it work yet" is often "not yet" —
  // people press it repeatedly while waiting for propagation.
  app.post('/me/:kind/:id/domain/verify', {
    preHandler: requireRole(),
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const ctx = await load(req, reply); if (!ctx) return;
    const d = ctx.subject.domain;
    if (!d) return reply.code(404).send({ error: 'not_found' });
    const gate = domainEligible(ctx.forRule);
    if (!gate.ok) return reply.code(403).send({ error: gate.reason });

    const name = dnsRecordsFor(d.host, d.verifyToken, '').proof.name;
    let records = null; let err = null;
    try {
      records = await dns.resolveTxt(name);
    } catch (e) {
      // NXDOMAIN is the ordinary case five minutes after somebody added the record, not an
      // incident. The code is kept because it is the difference between "not there yet" and
      // "your zone did not answer at all", and the panel says which.
      err = String(e?.code || e?.message || 'lookup_failed').slice(0, 120);
    }
    const ok = !err && txtMatches(records, d.verifyToken);
    // The second question, answered alongside the first and never instead of it: does the
    // name already send its traffic here? Not stored and not part of `verified` (see
    // pointsAtUs). Each lookup is allowed to fail on its own: no answer is "not yet".
    const target = siteHost();
    let traffic = 'unknown';
    if (target) {
      const [cnames, addrs, ours] = await Promise.all([
        dns.resolveCname(d.host).catch(() => []),
        dns.resolve4(d.host).catch(() => []),
        dns.resolve4(target).catch(() => []),
      ]);
      traffic = pointsAtUs({ cnames, addrs }, { target, addrs: ours }) ? 'ok' : 'missing';
    }
    const out = await ctx.p.customDomain.update({
      where: { id: d.id },
      data: {
        lastCheckedAt: new Date(),
        verifiedAt: ok ? (d.verifiedAt || new Date()) : null,
        lastError: ok ? null : (err || 'txt_mismatch'),
      },
    });
    // A domain that just passed verification has to start working now, not in a minute.
    await refreshHostMap(ctx.p).catch(() => {});
    return { domain: domainView(out), ok, traffic };
  });
}
