// The custom seed v2 (lib/config-transfer.mjs), over HTTP.
//
//   GET  /admin/config-transfer              the domains, what each holds here, what is left out
//   POST /admin/config-transfer/export       { domains, as: 'json' | 'script' } → a download
//   POST /admin/config-transfer/import       { bundle, apply?, domains? } → a per-item report
//
// All three are SUPERADMIN. Import can write the theme and the marketplace margin, which are
// SUPERADMIN-only on their own screens, and a bulk door must not be wider than the single ones.
// Export is the whole site's configuration in one file: nothing in it is secret, but "every
// setting at once" is a decision about the install rather than about one section, and it keeps
// these off the requireRole('ADMIN') ratchet (web/scripts/check-capabilities.mjs).
import { db, requireRole, logAudit } from '../lib/lib.mjs';
import { buildBundle, applyBundle, bundleToScript, DOMAINS, DOMAIN_IDS } from '../lib/config-transfer.mjs';

// The BMM telemetry service, when this api is wired to it (the same two variables the live
// telemetry card uses). Absent, the telemetry domain carries only BCWEB's own settings.
const teleBase = () => (process.env.TELEMETRY_INTERNAL_URL || '').replace(/\/+$/, '');
const teleKey = () => process.env.TELEMETRY_ADMIN_KEY || process.env.TELEMETRY_ADMIN || '';
function telemetryIo(p) {
  if (!teleBase() || !teleKey()) return undefined;
  return {
    async read() {
      const r = await fetch(`${teleBase()}/api/admin/config`, { headers: { 'X-Admin-Key': teleKey() }, signal: AbortSignal.timeout(2500) });
      if (!r.ok) return null;
      return (await r.json())?.config || null;
    },
    async write(cfg) {
      const r = await fetch(`${teleBase()}/api/admin/config`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Key': teleKey() },
        body: JSON.stringify(cfg), signal: AbortSignal.timeout(2500),
      });
      if (!r.ok) throw new Error(`telemetry_unreachable_${r.status}`);
      const out = await r.json().catch(() => ({}));
      // Same mirror PUT /admin/telemetry/config keeps, so the capacity overview agrees.
      if (out?.config?.storageLimitMb != null) {
        const gb = out.config.storageLimitMb / 1024;
        await p.adminSetting.upsert({ where: { key: 'telemetry.storageLimitGB' }, create: { key: 'telemetry.storageLimitGB', value: gb }, update: { value: gb } }).catch(() => {});
      }
    },
  };
}

const pickDomains = (v) => (Array.isArray(v) ? v.map(String).filter((d) => DOMAIN_IDS.includes(d)) : DOMAIN_IDS);

export default async function configTransferRoutes(app) {
  app.get('/admin/config-transfer', { preHandler: requireRole('SUPERADMIN') }, async () => {
    const p = await db();
    const bundle = await buildBundle({ p }, DOMAIN_IDS);
    const byId = Object.fromEntries(bundle.manifest.domains.map((d) => [d.id, d]));
    return {
      domains: DOMAINS.map((d) => ({ id: d.id, label: d.label, labelFr: d.labelFr, desc: d.desc, ...byId[d.id] })),
      redacted: bundle.manifest.redacted,
      excluded: bundle.manifest.excluded,
      telemetryService: !!(teleBase() && teleKey()),
      format: bundle.manifest.format,
      version: bundle.manifest.version,
    };
  });

  app.post('/admin/config-transfer/export', { preHandler: requireRole('SUPERADMIN') }, async (req, reply) => {
    const p = await db();
    const selected = pickDomains(req.body?.domains);
    let bundle;
    try {
      bundle = await buildBundle({ p, telemetry: selected.includes('telemetry') ? telemetryIo(p) : undefined }, selected, {
        source: (process.env.SITE_URL || '').replace(/\/+$/, '') || null,
      });
    } catch (e) {
      // Only ever `secret_in_export`: the per-value pass missed something the whole-file scan
      // caught. The paths say where; the values are never echoed.
      if (e?.message === 'secret_in_export') return reply.code(500).send({ error: 'secret_in_export', paths: e.paths });
      throw e;
    }
    await logAudit(p, req.user.uid, 'seed.export', `${selected.join(',')} redacted=${bundle.manifest.redacted.length}`);
    const stamp = bundle.manifest.generatedAt.slice(0, 10);
    if (req.body?.as === 'script') {
      reply.header('Content-Type', 'text/javascript; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="custom-seed-${stamp}.mjs"`);
      return bundleToScript(bundle);
    }
    reply.header('Content-Type', 'application/json; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="custom-seed-${stamp}.json"`);
    return JSON.stringify(bundle, null, 2);
  });

  app.post('/admin/config-transfer/import', { preHandler: requireRole('SUPERADMIN'), bodyLimit: 16 * 1024 * 1024 }, async (req, reply) => {
    const p = await db();
    let bundle = req.body?.bundle;
    if (typeof bundle === 'string') { try { bundle = JSON.parse(bundle); } catch { return reply.code(400).send({ error: 'not_json' }); } }
    const apply = req.body?.apply === true;
    const only = Array.isArray(req.body?.domains) ? pickDomains(req.body.domains) : null;
    const out = await applyBundle({ p, role: req.user.role, telemetry: telemetryIo(p) }, bundle, { apply, only });
    if (out.error) return reply.code(400).send(out);
    if (apply) {
      const done = out.domains.filter((d) => d.applied).map((d) => d.id);
      const refused = out.domains.filter((d) => !d.ok).map((d) => d.id);
      await logAudit(p, req.user.uid, 'seed.import', `applied=${done.join(',') || '-'} refused=${refused.join(',') || '-'}`);
    }
    return out;
  });
}
