// Demo mode's HTTP surface. The model, and why it is an overlay, is in lib/demo.mjs.
//
// THE GUARD, AND WHY IT IS A ROLE AND NOT A CAPABILITY
//
// Every route here is `requireRole('ADMIN')` (SUPERADMIN passes too, as everywhere), written on
// the route itself so the RBAC map and check-capabilities.mjs read it. The owner's words were
// "only by admins". A capability is, by design, a thing an admin can GRANT to somebody who is
// not one (User.permissions, CustomRole) — hasCap() reads the grant list — so a `manage_demo`
// capability would have made "only admins" true until the first time somebody ticked a box.
// The server terminal and the permission editor stay requireRole for the same reason. This
// raises the requireRole('ADMIN') ceiling in apps/web/scripts/capabilities-baseline.json by
// the number of routes below; that ratchet exists to make exactly this a written decision.
//
// requireRole('ADMIN') also applies the admin 2FA gate (ensure2fa): an admin without TOTP gets
// 403 `2fa_required` here like on every other /admin route.
//
// What a guess gets, for each route below:
//   anonymous visitor          → 401 { error: 'unauthenticated' }
//   signed-in USER / MOD / a user holding every grantable capability
//                              → 403 { error: 'forbidden' }
//   ADMIN without 2FA          → 403 { error: '2fa_required' }
// The guard runs before the handler, so none of them learns whether a demo is running.
//
// STRIPE, MAIL, DISCORD: this file imports lib.mjs's guards/db/audit and lib/demo.mjs, and
// nothing else. No Stripe client, no mail.mjs, no bot, no fetch. The test reads this import
// list and fails if that changes.
import { z } from 'zod';
import { db as realDb, requireRole, logAudit } from '../lib/lib.mjs';
import {
  readDemoSession, startDemo, stopDemo, demoAudit, buildDemoData, applyDemoAction,
  sessionMatches, publicSession, MAX_MINUTES, MAX_ITEMS,
} from '../lib/demo.mjs';

const startBody = z.object({
  minutes: z.number().int().min(1).max(MAX_MINUTES).optional(),
  items: z.number().int().min(1).max(MAX_ITEMS).optional(),
  label: z.string().trim().max(80).optional(),
}).strict();

const actionBody = z.object({
  session: z.string().min(1).max(64),
  action: z.string().trim().min(1).max(60),
  note: z.string().max(200).optional(),
}).strict();

// Admin data about a fake site: never cached by anything between us and the browser, never
// indexed. Private because a shared cache must not hand one admin's response to anyone else.
const noStore = (reply) => reply.header('Cache-Control', 'no-store, private').header('X-Robots-Tag', 'noindex');

/**
 * `opts.db` and `opts.audit` are test seams: the test passes a database handle that records
 * every call, to prove the only writes are on AdminSetting, and an audit stub, because a real
 * audit entry is an HMAC-chained row whose foreign key keeps the test's admin account alive
 * for ever. Production registers the plugin with no options.
 */
export default async function demoRoutes(app, opts = {}) {
  const getDb = opts.db || realDb;
  const audit = opts.audit || logAudit;

  // Status. Also the proof: `audit.clean` is what "off" means, counted, not assumed.
  app.get('/admin/demo', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const p = await getDb();
    const s = await readDemoSession(p);
    noStore(reply);
    return { active: !!s, session: s ? publicSession(s) : null, audit: await demoAudit(p) };
  });

  // Enable (or restart: a second POST replaces the session and drops the old overlay).
  app.post('/admin/demo', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = startBody.safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input', issues: b.error.issues.map((i) => i.path.join('.') || i.message) });
    const p = await getDb();
    const s = await startDemo(p, { byUserId: req.user.uid, ...b.data });
    await audit(p, req.user.uid, 'demo.enable', `${s.n} items · ${Math.round((Date.parse(s.expiresAt) - Date.parse(s.startedAt)) / 60000)} min${s.label ? ` · ${s.label}` : ''}`, req.ip);
    noStore(reply);
    return reply.code(201).send({ active: true, session: publicSession(s) });
  });

  // Disable. One action, and it answers with the audit taken AFTER the delete — a 500 if
  // anything demo survived, so "off" can never be reported over something left behind.
  app.delete('/admin/demo', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const p = await getDb();
    const removed = await stopDemo(p);
    const after = await demoAudit(p);
    await audit(p, req.user.uid, 'demo.disable', `removed ${removed.settings} setting(s) · ${removed.overlays} overlay(s) · clean=${after.clean}`, req.ip);
    noStore(reply);
    if (!after.clean) return reply.code(500).send({ error: 'demo_not_clean', removed, audit: after });
    return { active: false, removed, audit: after };
  });

  // The dataset. `?session=` is optional; when given it must be the live one (a stale tab
  // gets 409 rather than silently rendering a different demo).
  app.get('/admin/demo/data', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const p = await getDb();
    const s = await readDemoSession(p);
    noStore(reply);
    if (!s) return reply.code(404).send({ error: 'demo_off' });
    const presented = typeof req.query?.session === 'string' ? req.query.session : '';
    if (presented && !sessionMatches(s, presented)) return reply.code(409).send({ error: 'demo_session_changed', session: publicSession(s) });
    return buildDemoData(s);
  });

  // A demo action: recorded in memory, persisted nowhere, and the reply says so.
  app.post('/admin/demo/actions', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = actionBody.safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await getDb();
    const s = await readDemoSession(p);
    noStore(reply);
    if (!s) return reply.code(404).send({ error: 'demo_off' });
    if (!sessionMatches(s, b.data.session)) return reply.code(409).send({ error: 'demo_session_changed', session: publicSession(s) });
    return reply.code(201).send(applyDemoAction(s, b.data.action, b.data.note));
  });
}
