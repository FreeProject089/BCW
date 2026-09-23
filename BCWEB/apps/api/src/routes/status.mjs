// The public status page.
//
// Everything it reports already existed and was admin-only: five services are probed on every
// monitor tick, and ServiceOutage records when each one broke and recovered. What was missing
// was a way for anybody outside the admin to see any of it.
//
// What is NOT exposed here, deliberately: the infra map, the dependency configuration, thresholds,
// hostnames, ports, and the cause strings on an outage — those name internals and sometimes
// secrets. A status page says what is broken and since when. It does not say how the machine
// is wired. The machine's own daily numbers (CPU, memory, disk, latency) were published here
// for a while as a "System metrics" block; they say more about the box than about the service,
// so they moved to the admin's Performance tab (`/admin/server/metrics/daily`).

import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { db, requireCap, logAudit, botAuth } from '../lib/lib.mjs';
import { stripeStatus, STRIPE_STATUS_PAGE } from '../lib/stripe-status.mjs';
import { DEP_LABELS, DEP_KEYS, checkDependencies, getDepsConfig, depLabel } from '../lib/monitor.mjs';
import { monitorsSchema, readMonitors, writeMonitors, assertMonitorUrl, probeMonitor, monitorSchema, monitorLabels, MAX_MONITORS, CUSTOM_PREFIX } from '../lib/status-monitors.mjs';
import { dailyUptime, overallUptime, serviceState, overallState } from '../lib/status-page.mjs';
import { sendMail, mailShell, escapeHtml, emailEnabled } from '../lib/mail.mjs';

const WINDOW_DAYS = 90;
const SITE = (process.env.SITE_URL || 'http://localhost').replace(/\/+$/, '');

export default async function statusRoutes(app) {
  app.get('/status', async () => {
    const p = await db();
    const now = new Date();
    const since = new Date(now.getTime() - WINDOW_DAYS * 864e5);

    const [probes, enabled, outages] = await Promise.all([
      // A probe failure must not take the status page down with it — the page saying "we cannot
      // tell" is worth more than a 500.
      checkDependencies(p).catch(() => ({})),
      getDepsConfig(p).catch(() => ({})),
      p.serviceOutage.findMany({
        where: { OR: [{ endedAt: null }, { endedAt: { gte: since } }, { startedAt: { gte: since } }] },
        orderBy: { startedAt: 'desc' },
        include: { notes: { where: { publicNote: true }, orderBy: { createdAt: 'asc' } } },
      }),
    ]);

    // D7: the built-ins that are switched on, then the admin-configured services that answered
    // (runMonitors only returns ENABLED ones). A refused or malformed monitor answers null and
    // shows as "not in use", never as an outage.
    const keys = [...DEP_KEYS.filter((k) => enabled[k] !== false), ...Object.keys(probes).filter((k) => k.startsWith(CUSTOM_PREFIX))];
    const custom = monitorLabels();
    const services = keys.map((key) => {
      const mine = outages.filter((o) => o.dep === key);
      const open = mine.find((o) => !o.endedAt) || null;
      const bars = dailyUptime(mine, WINDOW_DAYS, now);
      return {
        key,
        label: depLabel(key),
        // The admin's French name for a configured service (the built-ins are named from the
        // web dictionary by key). Never the URL: the page says WHAT is down, not where it lives.
        ...(custom[key]?.fr ? { labelFr: custom[key].fr } : {}),
        state: serviceState(probes[key], open),
        uptimePct: overallUptime(bars),
        // One number per day for the 90 bars. The full millisecond counts are not published —
        // a reader wants the colour of the day, and the precise figure invites arguments about
        // clock skew nobody can settle.
        days: bars.map((b) => ({ day: b.day, uptimePct: Math.round(b.uptimePct * 100) / 100 })),
        downSince: open?.startedAt || null,
      };
    });

    // Incidents: the outages, with whatever a human wrote about them. `cause` is NOT included —
    // it holds internal detail ("connect ECONNREFUSED 172.20.0.5:5432").
    const incidents = outages
      .filter((o) => o.dep !== 'stripe' || enabled.stripe !== false)
      .slice(0, 50)
      .map((o) => ({
        id: o.id,
        // Both: `key` so the page can name it in the reader's language, `service` because the
        // English name is what a mail or a Discord message quotes.
        key: o.dep,
        service: depLabel(o.dep),
        ...(custom[o.dep]?.fr ? { serviceFr: custom[o.dep].fr } : {}),
        startedAt: o.startedAt,
        endedAt: o.endedAt,
        minutes: Math.round(((o.endedAt ? new Date(o.endedAt) : now) - new Date(o.startedAt)) / 60000),
        updates: o.notes.map((n) => ({ state: n.state, body: n.body, at: n.createdAt })),
      }));

    return {
      state: overallState(services.map((s) => s.state)),
      windowDays: WINDOW_DAYS,
      services,
      incidents,
      // No `metrics` any more — see the header. The daily figures are an admin read now.
      generatedAt: now,
    };
  });

  // ── What the bot shows as its Discord status ────────────────────────────────
  //
  // The same verdict the public page gives (state per service, overall banner), plus Stripe's
  // OWN published state in detail — the presence line can say "Stripe: degraded" when Stripe
  // says so, which a boolean cannot. Polled by the bot every two minutes; Stripe's part is
  // cached for five (lib/stripe-status.mjs), so this never multiplies requests to Stripe.
  // Bot-secret only: it is the public page's content, but the bot is its only reader.
  app.get('/bot/status', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const p = await db();
    const [probes, enabled, open, stripe] = await Promise.all([
      checkDependencies(p).catch(() => ({})),
      getDepsConfig(p).catch(() => ({})),
      p.serviceOutage.findMany({ where: { endedAt: null } }).catch(() => []),
      process.env.STRIPE_SECRET_KEY ? stripeStatus() : Promise.resolve(null),
    ]);
    const keys = [...DEP_KEYS.filter((k) => enabled[k] !== false), ...Object.keys(probes).filter((k) => k.startsWith(CUSTOM_PREFIX))];
    const services = keys.map((key) => ({
      key, label: depLabel(key), state: serviceState(probes[key], open.find((o) => o.dep === key) || null),
    }));
    return {
      state: overallState(services.map((s) => s.state)),
      services,
      stripe: stripe ? { state: stripe.state, description: stripe.description, stale: !!stripe.stale, page: STRIPE_STATUS_PAGE } : null,
      url: `${SITE}/status`,
    };
  });

  // ── Writing the account of what happened ────────────────────────────────────
  //
  // IncidentNote has existed since the status page shipped, the public page renders every note
  // marked public, and nothing anywhere could write one. Every incident on the page therefore
  // read "no account of this one" — which is the worst thing a status page can say, because it
  // is exactly what somebody came to read.
  //
  // An outage row itself is created by the monitor when a probe fails. Staff do not open or
  // close them by hand: a status page whose incidents are typed in is a blog post, and it will
  // disagree with the uptime bars drawn from the same rows.
  const STATES = ['investigating', 'identified', 'monitoring', 'resolved'];

  app.get('/admin/status/incidents', { preHandler: requireCap('manage_server', 'ADMIN') }, async (req) => {
    const p = await db();
    const days = Math.min(365, Math.max(1, Number(req.query?.days) || 90));
    const outages = await p.serviceOutage.findMany({
      where: { startedAt: { gte: new Date(Date.now() - days * 864e5) } },
      orderBy: { startedAt: 'desc' }, take: 100,
      include: { notes: { orderBy: { createdAt: 'asc' } } },
    });
    return { outages: outages.map((o) => ({ ...o, service: depLabel(o.dep) })) };
  });

  app.post('/admin/status/incidents/:id/notes', { preHandler: requireCap('manage_server', 'ADMIN') }, async (req, reply) => {
    const b = z.object({
      state: z.enum(STATES),
      body: z.string().trim().min(1).max(2000),
      // Private by choice, not by default: the point of the note is that people outside the
      // team read it. An internal one is for the detail that would only worry them.
      publicNote: z.boolean().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const outage = await p.serviceOutage.findUnique({ where: { id: req.params.id } });
    if (!outage) return reply.code(404).send({ error: 'not_found' });
    const me = await p.user.findUnique({ where: { id: req.user.uid }, select: { displayName: true } });
    const note = await p.incidentNote.create({
      data: {
        outageId: outage.id, state: b.data.state, body: b.data.body,
        publicNote: b.data.publicNote !== false,
        authorId: req.user.uid, authorLabel: me?.displayName || '',
      },
    });
    // A cause is the one-line version of the same story, shown beside the incident rather than
    // inside its timeline. Set from the first note that identifies one, and never overwritten:
    // the first explanation is the one people were given.
    if (b.data.state === 'identified' && !outage.cause) {
      await p.serviceOutage.update({ where: { id: outage.id }, data: { cause: b.data.body.slice(0, 300) } }).catch(() => {});
    }
    await logAudit(p, req.user.uid, 'status.note', `${depLabel(outage.dep)} — ${b.data.state}`, req.ip).catch(() => {});
    return { ok: true, note };
  });

  app.patch('/admin/status/notes/:id', { preHandler: requireCap('manage_server', 'ADMIN') }, async (req, reply) => {
    const b = z.object({
      body: z.string().trim().min(1).max(2000).optional(),
      publicNote: z.boolean().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const note = await p.incidentNote.update({ where: { id: req.params.id }, data: b.data }).catch(() => null);
    if (!note) return reply.code(404).send({ error: 'not_found' });
    return { ok: true, note };
  });

  // Deleted, not hidden: a note nobody should have published is the one case where leaving the
  // row would be worse. Unpublishing it is one PATCH away and is the usual answer.
  app.delete('/admin/status/notes/:id', { preHandler: requireCap('manage_server', 'ADMIN') }, async (req, reply) => {
    const p = await db();
    const gone = await p.incidentNote.delete({ where: { id: req.params.id } }).catch(() => null);
    if (!gone) return reply.code(404).send({ error: 'not_found' });
    await logAudit(p, req.user.uid, 'status.note.delete', gone.body.slice(0, 120), req.ip).catch(() => {});
    return { ok: true };
  });

  // ── The services the page watches (D7) ─────────────────────────────────────
  //
  // The built-ins (database, storage, bot, telemetry, website, Stripe) are switched on and off
  // through /admin/server/deps-config, as before. The others are URLs the admin adds here. Each
  // one is fetched on every monitor tick, so each one is an SSRF surface (pentest R11): see
  // lib/status-monitors.mjs for the rules. Here the target is refused at SAVE, with the reason,
  // and the prober re-checks at every fetch.
  app.get('/admin/status/monitors', { preHandler: requireCap('manage_server', 'ADMIN') }, async () => {
    const p = await db();
    return {
      monitors: await readMonitors(p),
      builtin: { keys: DEP_KEYS, labels: DEP_LABELS, enabled: await getDepsConfig(p).catch(() => ({})) },
      max: MAX_MONITORS,
    };
  });

  app.put('/admin/status/monitors', { preHandler: requireCap('manage_server', 'ADMIN') }, async (req, reply) => {
    const b = z.object({ monitors: monitorsSchema }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input', detail: b.error.issues?.[0]?.path?.join('.') || '' });
    const list = b.data.monitors;
    const ids = new Set();
    for (const m of list) {
      if (ids.has(m.id)) return reply.code(400).send({ error: 'duplicate_id', id: m.id });
      ids.add(m.id);
      if (m.okMin > m.okMax) return reply.code(400).send({ error: 'invalid_range', id: m.id });
      // Refused BEFORE it is stored. The code names the rule (ssrf_blocked_resolved, …), never
      // what the name resolved to: an admin screen that printed resolved addresses would be a
      // way to map the internal network one save at a time.
      try { await assertMonitorUrl(m.url); }
      catch (e) { return reply.code(400).send({ error: 'target_refused', id: m.id, code: String(e?.message || 'ssrf_refused').slice(0, 40) }); }
    }
    const p = await db();
    await writeMonitors(p, list);
    await logAudit(p, req.user.uid, 'status.monitors', `${list.length} configured service(s)`, req.ip).catch(() => {});
    return { ok: true, monitors: list };
  });

  // "Test now", from the editor, before saving. Same prober, same rules; the answer is the
  // verdict, a status code and a duration. Never the body or a header of the response.
  app.post('/admin/status/monitors/test', {
    preHandler: requireCap('manage_server', 'ADMIN'),
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const b = z.object({ monitor: monitorSchema }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    try { await assertMonitorUrl(b.data.monitor.url); }
    catch (e) { return { ok: null, ms: null, status: null, error: String(e?.message || 'ssrf_refused').slice(0, 40) }; }
    return probeMonitor(b.data.monitor);
  });

  // ── Being told when it breaks ───────────────────────────────────────────────
  //
  // Double opt-in, like the newsletter: an unconfirmed row is never written to. Without it,
  // anybody could sign up somebody else's address to a stream of outage mail.
  app.post('/status/subscribe', async (req, reply) => {
    const b = z.object({
      email: z.string().email().max(200),
      // A built-in key, or a configured service's `c_<slug>` (D7).
      deps: z.array(z.union([z.enum(DEP_KEYS), z.string().regex(/^c_[a-z0-9-]{1,40}$/)])).max(10).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!emailEnabled()) return reply.code(503).send({ error: 'email_off' });

    const p = await db();
    const email = b.data.email.trim().toLowerCase();
    const confirmToken = randomBytes(24).toString('hex');
    const token = randomBytes(24).toString('hex');

    const existing = await p.statusSubscriber.findUnique({ where: { kind_target: { kind: 'email', target: email } } });
    // Already confirmed → say the same thing as a new sign-up. Answering "you are already
    // subscribed" turns this endpoint into a way to test whether an address is on the list.
    if (existing?.confirmed) return { ok: true };
    const row = existing
      ? await p.statusSubscriber.update({ where: { id: existing.id }, data: { confirmToken, deps: b.data.deps || [] } })
      : await p.statusSubscriber.create({ data: { kind: 'email', target: email, deps: b.data.deps || [], confirmToken, token } });

    const link = `${SITE}/api/status/confirm/${row.confirmToken}`;
    await sendMail({
      to: email,
      mailId: 'status',
      subject: 'Confirm your BetterCommunity status alerts',
      html: mailShell('Confirm your status alerts',

        `<p>You asked to be told when a BetterCommunity service goes down, and when it comes back.</p>
         <p><a href="${escapeHtml(link)}">Confirm</a></p>
         <p>If this was not you, ignore this message — nothing was subscribed.</p>`),
      text: `Confirm your status alerts: ${link}\n\nIf this was not you, ignore this message.`,
    }).catch(() => {});
    return { ok: true };
  });

  app.get('/status/confirm/:token', async (req, reply) => {
    const p = await db();
    const row = await p.statusSubscriber.findUnique({ where: { confirmToken: req.params.token } });
    if (!row) return reply.code(404).send({ error: 'not_found' });
    await p.statusSubscriber.update({ where: { id: row.id }, data: { confirmed: true, confirmToken: null } });
    return reply.redirect(`${SITE}/status?subscribed=1`);
  });

  // One link in every message, no login. The token is the authorisation.
  app.get('/status/unsubscribe/:token', async (req, reply) => {
    const p = await db();
    const row = await p.statusSubscriber.findUnique({ where: { token: req.params.token } });
    if (row) await p.statusSubscriber.delete({ where: { id: row.id } });
    // The same answer either way: a 404 here would say whether a token is live.
    return reply.redirect(`${SITE}/status?unsubscribed=1`);
  });
}
