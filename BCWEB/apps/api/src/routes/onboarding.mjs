// The first-run flow: the account's own view of it, and the admin's editor.
//
//   GET  /me/onboarding          what to show now (or `show: false`)
//   POST /me/onboarding          { action: done|skip|snooze|resume|dismiss, step?, interests? }
//   GET  /admin/onboarding       the config, the defaults, and how many are mid-way
//   PUT  /admin/onboarding       save the config (ONBOARDING_CONFIG_SCHEMA)
//
// The rules themselves (shown once, resumable, never to older accounts) are pure functions in
// lib/onboarding.mjs, where the tests can reach them without a database.
import { db, requireRole, logAudit } from '../lib/lib.mjs';
import { emailEnabled } from '../lib/mail.mjs';
import { oauthProviders } from './oauth.mjs';
import {
  CONFIG_KEY, PROGRESS_PREFIX, progressKey, normalizeConfig, resolveSteps, currentStep, shouldShow,
  applyAction, ACTION_SCHEMA, ONBOARDING_CONFIG_SCHEMA, DEFAULT_CONFIG, STEP_IDS,
} from '../lib/onboarding.mjs';

async function readConfig(p) {
  const row = await p.adminSetting.findUnique({ where: { key: CONFIG_KEY } }).catch(() => null);
  return normalizeConfig(row?.value ?? DEFAULT_CONFIG);
}

/** The facts about this account the steps depend on. */
async function context(p, uid) {
  const [user, links] = await Promise.all([
    p.user.findUnique({ where: { id: uid }, select: { emailVerified: true, totpEnabled: true, passwordHash: true } }),
    p.oAuthAccount.findMany({ where: { userId: uid }, select: { provider: true } }).catch(() => []),
  ]);
  const providers = oauthProviders();
  return {
    emailEnabled: emailEnabled(),
    emailVerified: !!user?.emailVerified,
    totpEnabled: !!user?.totpEnabled,
    oauthAvailable: !!(providers.github || providers.discord || providers.google),
    providers: { github: !!providers.github, discord: !!providers.discord, google: !!providers.google },
    linked: links.map((l) => l.provider),
    hasPassword: !!user?.passwordHash,
  };
}

/** Everything the flow needs to decide, and to draw, in one response. */
async function view(p, uid) {
  const [cfg, row, ctx] = await Promise.all([
    readConfig(p),
    p.adminSetting.findUnique({ where: { key: progressKey(uid) } }).catch(() => null),
    context(p, uid),
  ]);
  const progress = row?.value || null;
  const steps = resolveSteps(cfg, ctx);
  const show = shouldShow(progress, cfg, steps);
  if (!show) return { show: false };
  return {
    show,
    snoozed: !!progress.snoozedAt,
    current: currentStep(progress, steps),
    steps,
    progress: { done: progress.done, skipped: progress.skipped, interests: progress.interests || [] },
    interests: cfg.interests,
    links: cfg.links,
    ctx,
  };
}

export default async function onboardingRoutes(app) {
  app.get('/me/onboarding', { preHandler: requireRole() }, async (req) => view(await db(), req.user.uid));

  app.post('/me/onboarding', { preHandler: requireRole(), config: { rateLimit: { max: 60, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const b = ACTION_SCHEMA.safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const key = progressKey(req.user.uid);
    const row = await p.adminSetting.findUnique({ where: { key } }).catch(() => null);
    // No row = an account that predates the flow, or one that already finished it. Either
    // way there is nothing to move, and creating a row here would be the way to show it twice.
    if (!row) return reply.code(409).send({ error: 'not_onboarding' });
    const [cfg, ctx] = await Promise.all([readConfig(p), context(p, req.user.uid)]);
    const out = applyAction(row.value, b.data, resolveSteps(cfg, ctx), cfg);
    if (out.error) return reply.code(409).send(out);
    await p.adminSetting.update({ where: { key }, data: { value: out.progress } });
    return view(p, req.user.uid);
  });

  // ── Admin ──
  app.get('/admin/onboarding', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    // How many accounts are part-way through, and how the finished ones ended. Bounded: this
    // is a glance for the editor, not a report.
    const rows = await p.adminSetting.findMany({ where: { key: { startsWith: PROGRESS_PREFIX } }, select: { value: true }, take: 20000 }).catch(() => []);
    const stats = { pending: 0, completed: 0, skipped: 0, dismissed: 0 };
    for (const r of rows) {
      if (r.value?.state === 'pending') stats.pending += 1;
      else if (stats[r.value?.how] !== undefined) stats[r.value.how] += 1;
    }
    return { config: await readConfig(p), defaults: DEFAULT_CONFIG, stepIds: STEP_IDS, stats };
  });

  app.put('/admin/onboarding', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const parsed = ONBOARDING_CONFIG_SCHEMA.safeParse(req.body?.config ?? req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input', detail: parsed.error.issues?.[0] ? `${parsed.error.issues[0].path.join('.')}: ${parsed.error.issues[0].message}` : undefined });
    const p = await db();
    const value = normalizeConfig(parsed.data);
    await p.adminSetting.upsert({ where: { key: CONFIG_KEY }, create: { key: CONFIG_KEY, value }, update: { value } });
    await logAudit(p, req.user.uid, 'onboarding.config', `enabled=${value.enabled} steps=${value.steps.filter((s) => s.enabled).map((s) => s.id).join(',')}`);
    return { ok: true, config: value };
  });
}
