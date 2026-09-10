// Managing a repo that lives on somebody else's server, from here.
//
// The natural way to ask for this is "let me put an SSH key in BCWEB". We do not take one,
// and that is the whole design. A private key that opens a shell on a machine we do not own
// is the worst asset a web platform can hold: a breach here would stop costing accounts and
// start costing our users their servers, and it would put us inside every incident they ever
// have. There is also no version of it that degrades safely — a key is either usable or it
// is not, and "usable" means arbitrary code on their box.
//
// So the direction is reversed. Their machine holds a credential for US:
//
//   * the owner mints a token in the repo dashboard (shown once, stored as a sha256 hash,
//     exactly like an ApiKey);
//   * their server calls POST /agent/hello on a timer with that token. It says what version
//     and host it is, and gets back the one job the owner may have queued;
//   * it does the job locally — it is their code on their machine, we never see the files —
//     and calls POST /agent/report with counts and an ok/error.
//
// What that buys, honestly: the dashboard knows whether the repo is alive, when it last
// changed, how many files it serves, and what the last run said. Nothing here can reach into
// their server, revoking is one row, and a stolen token buys an attacker the ability to lie
// about a file count.
//
// The report deliberately does NOT touch the repo's own status, sha, verified or
// pendingReview columns. Those decide what the public list shows and whether a moderator has
// checked the content; a self-reported number from a machine we do not run must not move
// them. It writes to its own row and the panel reads it there.
import crypto from 'node:crypto';
import { z } from 'zod';
import { db, requireRole, hashApiKey, clientIp, logAudit } from '../lib/lib.mjs';

/// 32 random bytes, like every other credential here. `bca_` = BetterCommunity agent, so a
/// token found in a log or a crontab is identifiable at a glance.
export const genAgentToken = () => 'bca_' + crypto.randomBytes(32).toString('base64url');
export const agentPrefixOf = (tok) => String(tok).slice(0, 12);

/// The jobs an owner can queue. A closed list, checked on the way in AND on the way out:
/// whatever ends up in the column is something the agent already knows how to refuse.
export const AGENT_COMMANDS = ['rescan', 'ping'];

/**
 * What the dashboard is allowed to see about the agent.
 *
 * Never the hash, obviously — but note it never returns the token either. The secret exists
 * exactly once, in the response that created it. An endpoint that can re-read it turns every
 * later XSS or session theft into credential theft, and there is no reason to have one: the
 * owner who lost the token rotates it, which is a button.
 */
export function agentView(a) {
  if (!a) return null;
  return {
    id: a.id,
    label: a.label || '',
    prefix: a.prefix,
    createdAt: a.createdAt,
    revokedAt: a.revokedAt,
    lastSeenAt: a.lastSeenAt,
    lastIp: a.lastIp,
    agentVersion: a.agentVersion,
    hostLabel: a.hostLabel,
    pendingCmd: a.pendingCmd,
    pendingAt: a.pendingAt,
    reportedAt: a.reportedAt,
    reportOk: a.reportOk,
    reportError: a.reportError,
    fileCount: a.fileCount,
    totalBytes: a.totalBytes == null ? null : Number(a.totalBytes),
    manifestSha: a.manifestSha,
  };
}

/**
 * Is this agent allowed to act?
 *
 * One answer for "no such token" and "revoked", because a caller probing tokens must not
 * learn that one of them was ever real — the same rule apiAuth follows for API keys.
 */
export function agentUsable(a) {
  return !!a && !a.revokedAt;
}

export default async function repoAgentRoutes(app) {
  // ── the owner's side ──────────────────────────────────────────────────────────────────
  //
  // Owner-only, not dashboard-level. The repo dashboard can also be opened with a shared
  // password or by a listed collaborator, and neither of those should be able to mint a
  // credential that outlives their access to the page.
  const ownRepo = async (req, reply) => {
    const p = await db();
    const repo = await p.serverRepo.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, ownerId: true, hosted: true, repoUrl: true },
    });
    if (!repo) { reply.code(404).send({ error: 'not_found' }); return null; }
    if (repo.ownerId !== req.user.uid && req.user.role !== 'ADMIN' && req.user.role !== 'SUPERADMIN') {
      reply.code(403).send({ error: 'forbidden' });
      return null;
    }
    return { p, repo };
  };

  app.get('/me/repos/:id/agent', { preHandler: requireRole() }, async (req, reply) => {
    const ctx = await ownRepo(req, reply); if (!ctx) return;
    const agent = await ctx.p.repoAgent.findUnique({ where: { repoId: ctx.repo.id } });
    return { agent: agentView(agent) };
  });

  // Create, or rotate. The same endpoint on purpose: "I lost it" and "I never had one" want
  // the same thing, and a separate /rotate is a second door onto one idea.
  app.post('/me/repos/:id/agent', {
    preHandler: requireRole(),
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const b = z.object({ label: z.string().max(80).optional() }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const ctx = await ownRepo(req, reply); if (!ctx) return;
    const token = genAgentToken();
    const data = {
      label: (b.data.label || '').trim(),
      prefix: agentPrefixOf(token),
      hash: hashApiKey(token),
      revokedAt: null,
      // A rotation invalidates what the old machine knew, including any job it had not
      // picked up: replaying a queued command against a new credential would be surprising.
      pendingCmd: null, pendingAt: null,
      lastSeenAt: null, lastIp: null, agentVersion: null, hostLabel: null,
      reportedAt: null, reportOk: false, reportError: null,
      fileCount: null, totalBytes: null, manifestSha: null,
    };
    const agent = await ctx.p.repoAgent.upsert({
      where: { repoId: ctx.repo.id },
      create: { repoId: ctx.repo.id, ...data },
      update: data,
    });
    await logAudit(ctx.p, req.user.uid, 'repo.agent.issue',
      `${ctx.repo.name} (${ctx.repo.id}) — agent token ${agent.prefix}…`, clientIp(req)).catch(() => {});
    // The only time the secret exists outside the caller's machine.
    return { token, agent: agentView(agent) };
  });

  app.delete('/me/repos/:id/agent', { preHandler: requireRole() }, async (req, reply) => {
    const ctx = await ownRepo(req, reply); if (!ctx) return;
    const agent = await ctx.p.repoAgent.findUnique({ where: { repoId: ctx.repo.id } });
    if (!agent) return reply.code(404).send({ error: 'not_found' });
    // Revoked, not deleted: the panel keeps saying which token was in use and when it last
    // called, which is what somebody revoking after a scare actually wants to look at.
    const out = await ctx.p.repoAgent.update({
      where: { repoId: ctx.repo.id },
      data: { revokedAt: new Date(), pendingCmd: null, pendingAt: null },
    });
    await logAudit(ctx.p, req.user.uid, 'repo.agent.revoke',
      `${ctx.repo.name} (${ctx.repo.id}) — agent token ${agent.prefix}…`, clientIp(req)).catch(() => {});
    return { agent: agentView(out) };
  });

  app.post('/me/repos/:id/agent/command', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ cmd: z.enum(['rescan', 'ping']) }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const ctx = await ownRepo(req, reply); if (!ctx) return;
    const agent = await ctx.p.repoAgent.findUnique({ where: { repoId: ctx.repo.id } });
    if (!agentUsable(agent)) return reply.code(404).send({ error: 'no_agent' });
    const out = await ctx.p.repoAgent.update({
      where: { repoId: ctx.repo.id },
      data: { pendingCmd: b.data.cmd, pendingAt: new Date() },
    });
    return { agent: agentView(out) };
  });

  // ── the agent's side ──────────────────────────────────────────────────────────────────
  //
  // Bearer token, no session, no cookies. Rate-limited per IP because it is an unauthenticated
  // surface until the token is checked, and a wrong token must cost the same as a right one.
  const bearer = (req) => {
    const h = req.headers['authorization'] || '';
    const m = /^Bearer\s+(.+)$/i.exec(String(h));
    return m ? m[1].trim() : '';
  };

  const authAgent = async (req, reply) => {
    const tok = bearer(req);
    if (!tok) { reply.code(401).send({ error: 'invalid_token' }); return null; }
    const p = await db();
    const agent = await p.repoAgent.findUnique({
      where: { hash: hashApiKey(tok) },
      include: { repo: { select: { id: true, name: true, hosted: true, repoUrl: true, deleteAt: true } } },
    });
    // Same answer for absent and revoked — see agentUsable.
    if (!agentUsable(agent) || !agent.repo || agent.repo.deleteAt) {
      reply.code(401).send({ error: 'invalid_token' });
      return null;
    }
    return { p, agent };
  };

  const RL_AGENT = { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };

  app.post('/agent/hello', RL_AGENT, async (req, reply) => {
    const b = z.object({
      version: z.string().max(40).optional(),
      host: z.string().max(80).optional(),
    }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const ctx = await authAgent(req, reply); if (!ctx) return;
    const out = await ctx.p.repoAgent.update({
      where: { id: ctx.agent.id },
      data: {
        lastSeenAt: new Date(),
        lastIp: clientIp(req) || null,
        // Self-reported and displayed as such. Trimmed, capped by zod above, and never used
        // to decide anything.
        agentVersion: b.data.version ? b.data.version.trim() : ctx.agent.agentVersion,
        hostLabel: b.data.host ? b.data.host.trim() : ctx.agent.hostLabel,
      },
    });
    return {
      repo: { id: ctx.agent.repo.id, name: ctx.agent.repo.name },
      // The one queued job, or none. Checked against the closed list on the way out too, so
      // a value that somehow reached the column cannot be handed to the agent as a command.
      command: AGENT_COMMANDS.includes(out.pendingCmd) ? out.pendingCmd : null,
      commandQueuedAt: out.pendingCmd ? out.pendingAt : null,
    };
  });

  app.post('/agent/report', RL_AGENT, async (req, reply) => {
    const b = z.object({
      command: z.enum(['rescan', 'ping']).nullable().optional(),
      ok: z.boolean(),
      // Counts, not content. We do not host this repo; storing a file list here would make
      // the panel look like it holds files it has never seen.
      fileCount: z.number().int().min(0).max(10_000_000).optional(),
      totalBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
      manifestSha: z.string().max(128).optional(),
      error: z.string().max(500).optional(),
    }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const ctx = await authAgent(req, reply); if (!ctx) return;
    const d = b.data;
    const out = await ctx.p.repoAgent.update({
      where: { id: ctx.agent.id },
      data: {
        lastSeenAt: new Date(),
        lastIp: clientIp(req) || null,
        reportedAt: new Date(),
        reportOk: d.ok,
        reportError: d.ok ? null : (d.error || 'unknown').slice(0, 500),
        fileCount: d.fileCount ?? ctx.agent.fileCount,
        totalBytes: d.totalBytes == null ? ctx.agent.totalBytes : BigInt(d.totalBytes),
        manifestSha: d.manifestSha ?? ctx.agent.manifestSha,
        // The job is cleared only by a report that names it. Without that, an agent
        // reporting a routine heartbeat would swallow a command queued a second earlier.
        pendingCmd: d.command && d.command === ctx.agent.pendingCmd ? null : ctx.agent.pendingCmd,
        pendingAt: d.command && d.command === ctx.agent.pendingCmd ? null : ctx.agent.pendingAt,
      },
    });
    return { ok: true, agent: { pendingCmd: out.pendingCmd } };
  });
}
