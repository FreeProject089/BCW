// A backup of what people WROTE, as opposed to a backup of the database.
//
// There is already a database backup (`/server/db/backups`), and it is the thing to restore
// from after a disaster: it has every table, every hash, every session. What it is not is
// portable or readable — it is a dump of one Postgres version, and reading one page out of it
// means restoring the whole thing somewhere.
//
// This is the other need: the docs, the blog, the FAQ, the legal versions, the admin settings
// and the account records, as JSON, in a zip you can open. It is what you want before a risky
// edit, when moving to another install, or when somebody asks what the site said in March.
//
// ── What it deliberately does NOT contain ───────────────────────────────────
//
// No password hashes, no TOTP secrets, no API tokens, no session rows. An account here is the
// record of a person — id, name, email, role, dates — not the means to sign in as them. A zip
// that could be restored into a working login is a zip that must be handled like a password
// database, and this one is going to end up in somebody's Downloads folder.
//
// Restoring accounts from this therefore means re-inviting them. That is stated on the screen
// rather than discovered, because "backup" implies "restore" and here it only half does.
import archiver from 'archiver';
import { db, requireCap, logAudit, clientIp } from '../lib/lib.mjs';

/**
 * The sections, what each one reads, and whether it is on by default.
 *
 * Catalogues and repositories are off: they are mostly rows POINTING at uploaded files, and a
 * JSON export of them is a list of addresses whose payloads are not in the zip. Including them
 * silently would make the backup look more complete than it is. On, they still only carry the
 * metadata — which is the honest thing they can carry — and the screen says so.
 */
export const SECTIONS = {
  docs: {
    label: 'Documentation',
    on: true,
    count: (p) => p.docPage.count(),
    read: (p) => p.docPage.findMany({ orderBy: { order: 'asc' } }),
  },
  blog: {
    label: 'Blog posts',
    on: true,
    count: (p) => p.blogPost.count(),
    read: (p) => p.blogPost.findMany({ orderBy: { createdAt: 'asc' } }),
  },
  faq: {
    label: 'FAQ',
    on: true,
    count: (p) => p.faqItem.count(),
    read: (p) => p.faqItem.findMany({ orderBy: { order: 'asc' } }),
  },
  legal: {
    label: 'Legal documents',
    on: true,
    // Every published VERSION, not just the current one: the point of keeping versions is
    // being able to say what the terms were on a given day, and a backup of only the latest
    // throws exactly that away.
    count: (p) => p.legalVersion.count(),
    read: (p) => p.legalVersion.findMany({ orderBy: [{ doc: 'asc' }, { version: 'asc' }] }),
  },
  settings: {
    label: 'Admin settings',
    on: true,
    // The home page, the page builder, the topbar, the showcase, the thresholds — everything
    // an admin configured, which is otherwise invisible until it is missing.
    count: (p) => p.adminSetting.count(),
    read: (p) => p.adminSetting.findMany({ orderBy: { key: 'asc' } }),
  },
  reviews: {
    label: 'Reviews & polls',
    on: true,
    count: async (p) => (await p.review.count()) + (await p.poll.count()),
    read: async (p) => ({
      reviews: await p.review.findMany({ orderBy: { order: 'asc' } }),
      polls: await p.poll.findMany({ orderBy: { createdAt: 'asc' } }),
    }),
  },
  users: {
    label: 'Accounts (records only)',
    on: true,
    count: (p) => p.user.count(),
    // An explicit SELECT, never a `findMany()` with omissions: a spread would hand over the
    // password hash the day somebody adds a column, and this file is the last place that
    // should learn about a new secret by accident.
    read: (p) => p.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, email: true, displayName: true, role: true, status: true,
        emailVerified: true, createdAt: true, bio: true, avatar: true,
      },
    }),
  },
  catalogs: {
    label: 'Catalogue entries (metadata only)',
    on: false,
    count: (p) => p.catalogItem.count(),
    read: (p) => p.catalogItem.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, slug: true, kind: true, name: true, description: true, tags: true,
        version: true, status: true, views: true, downloads: true, meta: true,
        payloadKey: true, payloadSize: true, createdAt: true, updatedAt: true,
      },
    }),
  },
  repos: {
    label: 'Repositories (metadata only)',
    on: false,
    count: (p) => p.serverRepo.count(),
    read: (p) => p.serverRepo.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        // Column names read off the model, not guessed: ServerRepo has `listed` and
        // `storageUsedBytes`, not `visibility` and `sizeBytes`. A wrong one throws at
        // query-BUILD time, which is an instant 500 on a route that looks correct.
        id: true, name: true, description: true, published: true, listed: true,
        category: true, region: true, storageUsedBytes: true, storageQuotaBytes: true,
        createdAt: true, updatedAt: true,
      },
    }),
  },
};

export const SECTION_KEYS = Object.keys(SECTIONS);
const DEFAULT_ON = SECTION_KEYS.filter((k) => SECTIONS[k].on);

/** `?include=a,b` → the sections to write. Unknown names are ignored, not an error. */
function chosen(q) {
  const raw = String(q?.include ?? '').trim();
  if (!raw) return DEFAULT_ON;
  return raw.split(',').map((s) => s.trim()).filter((s) => SECTION_KEYS.includes(s));
}

export default async function contentBackupRoutes(app) {
  /**
   * What is in there, before downloading it.
   *
   * Counts only — no row is read. The screen needs a number beside each checkbox to be a
   * choice rather than a guess, and asking for a 200 MB zip to find out how big it is is not
   * a way to find out how big it is.
   */
  app.get('/admin/content-backup/preview', { preHandler: requireCap('manage_server') }, async () => {
    const p = await db();
    const out = {};
    for (const [key, s] of Object.entries(SECTIONS)) {
      // One failure must not take the whole preview down: a section whose model is missing on
      // an older database should read as unknown, not as zero, because zero is a claim.
      try { out[key] = { label: s.label, on: s.on, count: await s.count(p) }; }
      catch { out[key] = { label: s.label, on: s.on, count: null }; }
    }
    return { sections: out, defaults: DEFAULT_ON };
  });

  /**
   * The zip.
   *
   * Streamed through archiver rather than assembled in memory: the settings table alone can
   * hold a page builder's whole tree, and a backup that a big install cannot produce is not a
   * backup.
   */
  app.get('/admin/content-backup', { preHandler: requireCap('manage_server') }, async (req, reply) => {
    const include = chosen(req.query);
    const p = await db();
    const at = new Date().toISOString();

    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="bettercommunity-content-${at.slice(0, 10)}.zip"`);

    const zip = archiver('zip', { zlib: { level: 9 } });
    // The stream is already going out by the time a late error happens, so the only honest
    // thing left is to stop writing and let the client see a truncated file rather than a
    // complete-looking one. Logged here because the reply cannot say it any more.
    zip.on('error', (e) => { req.log?.error({ err: e }, 'content backup failed mid-stream'); });

    const manifest = { generatedAt: at, sections: {}, notes: [] };
    for (const key of include) {
      const rows = await SECTIONS[key].read(p);
      const n = Array.isArray(rows) ? rows.length : Object.values(rows).reduce((a, v) => a + v.length, 0);
      manifest.sections[key] = { label: SECTIONS[key].label, records: n };
      zip.append(JSON.stringify(rows, null, 2), { name: `${key}.json` });
    }
    if (include.includes('users')) {
      manifest.notes.push('Accounts are records only: no password hashes, no 2FA secrets, no tokens. Restoring them means re-inviting people.');
    }
    if (include.includes('catalogs') || include.includes('repos')) {
      manifest.notes.push('Catalogue and repository sections are metadata. The uploaded files they point at are not in this archive.');
    }
    manifest.notes.push('This is a content backup, not a restore point. For that, use the database backup in Advanced server management.');
    zip.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

    await logAudit(p, req.user.uid, 'content.backup', include.join(','), clientIp(req)).catch(() => {});
    zip.finalize();
    return reply.send(zip);
  });
}
