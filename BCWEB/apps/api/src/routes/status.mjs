// The public status page.
//
// Everything it reports already existed and was admin-only: five services are probed on every
// monitor tick, ServiceOutage records when each one broke and recovered, and ServerMetricDaily
// holds the machine's own numbers. What was missing was a way for anybody outside the admin to
// see any of it.
//
// What is NOT exposed here, deliberately: the infra map, the dependency configuration, thresholds,
// hostnames, ports, and the cause strings on an outage — those name internals and sometimes
// secrets. A status page says what is broken and since when. It does not say how the machine
// is wired.

import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { db } from '../lib/lib.mjs';
import { DEP_LABELS, DEP_KEYS, checkDependencies, getDepsConfig } from '../lib/monitor.mjs';
import { dailyUptime, overallUptime, serviceState, overallState } from '../lib/status-page.mjs';
import { sendMail, mailShell, escapeHtml, emailEnabled } from '../lib/mail.mjs';

const WINDOW_DAYS = 90;
const SITE = (process.env.SITE_URL || 'http://localhost').replace(/\/+$/, '');

export default async function statusRoutes(app) {
  app.get('/status', async () => {
    const p = await db();
    const now = new Date();
    const since = new Date(now.getTime() - WINDOW_DAYS * 864e5);

    const [probes, enabled, outages, daily] = await Promise.all([
      // A probe failure must not take the status page down with it — the page saying "we cannot
      // tell" is worth more than a 500.
      checkDependencies(p).catch(() => ({})),
      getDepsConfig(p).catch(() => ({})),
      p.serviceOutage.findMany({
        where: { OR: [{ endedAt: null }, { endedAt: { gte: since } }, { startedAt: { gte: since } }] },
        orderBy: { startedAt: 'desc' },
        include: { notes: { where: { publicNote: true }, orderBy: { createdAt: 'asc' } } },
      }),
      p.serverMetricDaily.findMany({ where: { day: { gte: since } }, orderBy: { day: 'asc' } }),
    ]);

    const keys = DEP_KEYS.filter((k) => enabled[k] !== false);
    const services = keys.map((key) => {
      const mine = outages.filter((o) => o.dep === key);
      const open = mine.find((o) => !o.endedAt) || null;
      const bars = dailyUptime(mine, WINDOW_DAYS, now);
      return {
        key,
        label: DEP_LABELS[key] || key,
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
        service: DEP_LABELS[o.dep] || o.dep,
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
      // The machine's own numbers, by day. Averages only: peaks are an operations concern and
      // publishing them invites reading a spike as an outage when nothing broke.
      metrics: daily.map((d) => ({
        day: d.day, cpu: Math.round(d.cpuAvg * 10) / 10, mem: Math.round(d.memAvg * 10) / 10,
        disk: Math.round(d.diskAvg * 10) / 10, latencyMs: d.latencyAvg,
      })),
      generatedAt: now,
    };
  });

  // ── Being told when it breaks ───────────────────────────────────────────────
  //
  // Double opt-in, like the newsletter: an unconfirmed row is never written to. Without it,
  // anybody could sign up somebody else's address to a stream of outage mail.
  app.post('/status/subscribe', async (req, reply) => {
    const b = z.object({
      email: z.string().email().max(200),
      deps: z.array(z.enum(DEP_KEYS)).max(10).optional(),
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
