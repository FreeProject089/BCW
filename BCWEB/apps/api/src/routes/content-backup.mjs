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
import path from 'node:path';
import { db, requireRole, requireCanControlServer, requireElevated, logAudit, clientIp } from '../lib/lib.mjs';
import { zipReadAll } from '../lib/native.mjs';
import { backupFile, fileHistory, fileAtCommit } from '../lib/gitbackup.mjs';

/**
 * Where the pre-import state is committed.
 *
 * A sibling of the file and DB backup repos, using the same machinery rather than a second
 * one — `git` is already installed in this image for exactly this, and its history IS the
 * rollback feature. Every import commits what was there BEFORE it, so the commit made by an
 * import is "what the site said a moment ago", which is the only thing an undo can mean.
 */
const CONTENT_BACKUP_ROOT = path.resolve(process.env.SERVER_BACKUP_ROOT || '/app-backups', 'content');

/** One section's snapshot inside that repo. */
const snapPath = (key) => `${key}.json`;

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
    // `restore` is what makes a section importable. Its absence is the refusal, and it is
    // read by the preview so the screen can say which sections a zip will actually put back
    // instead of discovering it halfway through.
    //
    // Upsert by primary key, never delete-then-insert: an id that exists is replaced, one
    // that does not is created, and a page the zip has never heard of is LEFT ALONE. An
    // import is "put these back", not "make the site look exactly like this zip" — the
    // second would silently destroy anything written since the export.
    restore: (p, rows) => rows.map((r) => p.docPage.upsert({ where: { id: r.id }, update: r, create: r })),
    count: (p) => p.docPage.count(),
    read: (p) => p.docPage.findMany({ orderBy: { order: 'asc' } }),
  },
  blog: {
    label: 'Blog posts',
    on: true,
    restore: (p, rows) => rows.map((r) => p.blogPost.upsert({ where: { id: r.id }, update: r, create: r })),
    count: (p) => p.blogPost.count(),
    read: (p) => p.blogPost.findMany({ orderBy: { createdAt: 'asc' } }),
  },
  faq: {
    label: 'FAQ',
    on: true,
    restore: (p, rows) => rows.map((r) => p.faqItem.upsert({ where: { id: r.id }, update: r, create: r })),
    count: (p) => p.faqItem.count(),
    read: (p) => p.faqItem.findMany({ orderBy: { order: 'asc' } }),
  },
  legal: {
    label: 'Legal documents',
    on: true,
    // Every published VERSION, not just the current one: the point of keeping versions is
    // being able to say what the terms were on a given day, and a backup of only the latest
    // throws exactly that away.
    // Versions are append-only by nature: a published version is a record of what the terms
    // WERE on a date, so restoring one must never rewrite it. `create` on a colliding id
    // would throw, which is the honest outcome — but a re-import of the same zip is a normal
    // thing to do, so an existing version is skipped rather than treated as an error.
    restore: (p, rows) => rows.map((r) => p.legalVersion.upsert({ where: { id: r.id }, update: {}, create: r })),
    count: (p) => p.legalVersion.count(),
    read: (p) => p.legalVersion.findMany({ orderBy: [{ doc: 'asc' }, { version: 'asc' }] }),
  },
  settings: {
    label: 'Admin settings',
    on: true,
    // The home page, the page builder, the topbar, the showcase, the thresholds — everything
    // an admin configured, which is otherwise invisible until it is missing.
    restore: (p, rows) => rows.map((r) => p.adminSetting.upsert({ where: { key: r.key }, update: r, create: r })),
    count: (p) => p.adminSetting.count(),
    read: (p) => p.adminSetting.findMany({ orderBy: { key: 'asc' } }),
  },
  reviews: {
    label: 'Reviews & polls',
    on: true,
    // Two models in one section, so the restore takes the same shape the read emits.
    restore: (p, data) => [
      ...(data.reviews || []).map((r) => p.review.upsert({ where: { id: r.id }, update: r, create: r })),
      ...(data.polls || []).map((r) => p.poll.upsert({ where: { id: r.id }, update: r, create: r })),
    ],
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
  // B6(c): the content types the export did not yet cover.
  hostingPlans: {
    label: 'Hosting plans',
    on: true,
    restore: (p, rows) => rows.map((r) => p.hostingPlan.upsert({ where: { id: r.id }, update: r, create: r })),
    count: (p) => p.hostingPlan.count(),
    read: (p) => p.hostingPlan.findMany({ orderBy: { priceMonthlyCents: 'asc' } }),
  },
  showcase: {
    label: 'Other projects (showcase pages)',
    on: true,
    restore: (p, rows) => rows.map((r) => p.showcaseProject.upsert({ where: { id: r.id }, update: r, create: r })),
    count: (p) => p.showcaseProject.count(),
    read: (p) => p.showcaseProject.findMany({ orderBy: { order: 'asc' } }),
  },
  projects: {
    label: 'Project registry',
    on: true,
    // The project ROWS (key + name + scheduling). Their PAGE content is under Admin settings
    // (`project.<key>`), so a full restore of a project wants this AND the settings section.
    restore: (p, rows) => rows.map((r) => p.project.upsert({ where: { key: r.key }, update: r, create: r })),
    count: (p) => p.project.count(),
    read: (p) => p.project.findMany({ orderBy: { key: 'asc' } }),
  },
  platformAssets: {
    label: 'Downloads & platform assets (metadata only)',
    on: false,
    // Metadata only — the actual files live in object storage (storageKey), like catalogs/repos.
    count: (p) => p.platformAsset.count(),
    read: (p) => p.platformAsset.findMany({
      orderBy: { key: 'asc' },
      select: {
        id: true, key: true, kind: true, label: true, filename: true, contentType: true,
        size: true, storageKey: true, version: true, channel: true,
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
   * The same chain the other tools on this screen use.
   *
   * It sits under Advanced server management, beside the DB viewer, the file manager and the
   * power controls, and every one of those runs [ADMIN, canControlServer, elevated]. This
   * route hands over every account record and every word on the site in one file, so being
   * the one button on that screen that any admin could press was not a defensible difference
   * — and the screen itself tells people the whole area is behind the grant and the step-up.
   *
   * It used `requireCap('manage_server')`, which is a real idiom here — a capability kept out
   * of CAPABILITIES on purpose so no bundle can grant it and `hasCap` falls through to the
   * admin check. It is the right gate for a status page. It is not the gate for this screen:
   * "any admin" and "an admin holding the server-control grant, elevated in the last fifteen
   * minutes" are different answers, and the panel only ever mounts behind the second.
   */
  const GUARD = [requireRole('ADMIN'), requireCanControlServer(), requireElevated()];

  /**
   * What is in there, before downloading it.
   *
   * Counts only — no row is read. The screen needs a number beside each checkbox to be a
   * choice rather than a guess, and asking for a 200 MB zip to find out how big it is is not
   * a way to find out how big it is.
   */
  app.get('/admin/content-backup/preview', { preHandler: GUARD }, async () => {
    const p = await db();
    const out = {};
    for (const [key, s] of Object.entries(SECTIONS)) {
      // One failure must not take the whole preview down: a section whose model is missing on
      // an older database should read as unknown, not as zero, because zero is a claim.
      try { out[key] = { label: s.label, on: s.on, restorable: !!s.restore, count: await s.count(p) }; }
      catch { out[key] = { label: s.label, on: s.on, restorable: !!s.restore, count: null }; }
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
  app.get('/admin/content-backup', { preHandler: GUARD }, async (req, reply) => {
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
      // BigInt → Number: some rows carry BigInt columns (repo/catalog quotas, a platform
      // asset's size), and JSON.stringify THROWS on a bigint — which would abort the whole
      // export mid-stream. Prisma accepts a plain number back for those fields on restore.
      zip.append(JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2), { name: `${key}.json` });
    }
    if (include.includes('users')) {
      manifest.notes.push('Accounts are records only: no password hashes, no 2FA secrets, no tokens. Restoring them means re-inviting people.');
    }
    if (include.includes('catalogs') || include.includes('repos') || include.includes('platformAssets')) {
      manifest.notes.push('Catalogue, repository and platform-asset sections are metadata. The uploaded files they point at are not in this archive.');
    }
    if (include.includes('showcase') || include.includes('projects')) {
      manifest.notes.push('Restore the Accounts and Admin settings sections first: a project/showcase page can reference an author or config that must already exist.');
    }
    manifest.notes.push('This is a content backup, not a restore point. For that, use the database backup in Advanced server management.');
    zip.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

    await logAudit(p, req.user.uid, 'content.backup', include.join(','), clientIp(req)).catch(() => {});
    zip.finalize();
    return reply.send(zip);
  });

  // The zip arrives as raw bytes. There is no multipart plugin on this server and adding one
  // for a single admin route would be a dependency the rest of the app does not need; a
  // content-type parser registered HERE is scoped to this plugin and nothing else sees it.
  app.addContentTypeParser(
    ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'],
    { parseAs: 'buffer', bodyLimit: 64 * 1024 * 1024 },
    (_req, body, done) => done(null, body),
  );

  /**
   * What is in this zip, before it overwrites anything.
   *
   * Import read the file, validated it and wrote it in one movement, so the only way to find
   * out whether a zip was the right backup was to apply it and reach for the undo. That undo
   * exists and works, and it is still the wrong shape for the question: "will this replace
   * the twelve pages I just wrote" is answerable from the file itself.
   *
   * Nothing is written here — no snapshot, no rows, and deliberately no audit entry either,
   * because reading a file the admin already holds is not an action on the site.
   */
  app.post('/admin/content-backup/inspect', { preHandler: GUARD }, async (req, reply) => {
    const bytes = req.body;
    if (!Buffer.isBuffer(bytes) || !bytes.length) {
      return reply.code(400).send({ error: 'no_file', detail: 'send the zip as the request body' });
    }
    let entries;
    try {
      const list = await zipReadAll(bytes);
      entries = Object.fromEntries(list.map((e) => [e.name, e.data]));
    } catch { return reply.code(400).send({ error: 'not_a_zip' }); }

    const text = (v) => (Buffer.isBuffer(v) ? v.toString('utf8') : String(v));
    let manifest = null;
    if (entries['manifest.json']) {
      try { manifest = JSON.parse(text(entries['manifest.json'])); } catch { manifest = null; }
    }

    const p = await db();
    const sections = {};
    // Files in the zip that are not a section this build knows. A backup taken from a newer
    // version carries them, and silently ignoring them is how an admin concludes the import
    // covered everything.
    const unknown = Object.keys(entries).filter((n) => n.endsWith('.json') && n !== 'manifest.json'
      && !SECTION_KEYS.includes(n.slice(0, -5)));

    for (const key of SECTION_KEYS) {
      const raw = entries[`${key}.json`];
      if (raw == null) continue;
      const sec = SECTIONS[key];
      let data;
      try { data = JSON.parse(text(raw)); }
      catch { sections[key] = { label: sec.label, restorable: !!sec.restore, error: 'not valid JSON' }; continue; }

      // An array of rows, or an object of named arrays — both shapes exist among the
      // sections, so both are counted rather than one being assumed.
      const lists = Array.isArray(data) ? { '': data } : Object.fromEntries(Object.entries(data).filter(([, v]) => Array.isArray(v)));
      const records = Object.values(lists).reduce((n, v) => n + v.length, 0);

      // New versus replaced, which is the number that decides whether to press the button.
      // Only computable for rows that carry an id; anything else reports null rather than a
      // guess, because "0 replaced" and "we could not tell" must not look the same.
      let replaces = null, adds = null;
      try {
        const current = await sec.read(p);
        const curLists = Array.isArray(current) ? { '': current } : current;
        const have = new Set();
        for (const [k, v] of Object.entries(curLists)) {
          if (Array.isArray(v)) for (const r of v) if (r && r.id != null) have.add(`${k}:${r.id}`);
        }
        if (have.size || records === 0) {
          let hit = 0, miss = 0, unknownId = false;
          for (const [k, v] of Object.entries(lists)) {
            for (const r of v) {
              if (!r || r.id == null) { unknownId = true; continue; }
              if (have.has(`${k}:${r.id}`)) hit++; else miss++;
            }
          }
          if (!unknownId) { replaces = hit; adds = miss; }
        }
      } catch { /* a section this database cannot read reports counts only */ }

      sections[key] = {
        label: sec.label,
        restorable: !!sec.restore,
        records,
        replaces,
        adds,
        // Enough of a row to recognise the backup — a title, a slug, a name. Never the whole
        // record: this is a preview, and some of these tables hold account data.
        sample: Object.values(lists).flat().slice(0, 3).map((r) => {
          if (!r || typeof r !== 'object') return null;
          const pick = {};
          for (const f of ['id', 'slug', 'key', 'title', 'name', 'displayName', 'label', 'updatedAt']) {
            if (r[f] != null) pick[f] = typeof r[f] === 'string' ? r[f].slice(0, 120) : r[f];
          }
          return pick;
        }).filter(Boolean),
      };
    }

    if (!Object.keys(sections).length) return reply.code(400).send({ error: 'nothing_to_import', unknown });
    return { ok: true, manifest, sections, unknown, bytes: bytes.length };
  });

  /**
   * Put content back.
   *
   * Reads and VALIDATES the whole zip before writing anything. Half an import is worse than
   * none — it lands in the middle of somebody's documentation with no record of where it
   * stopped — so a malformed section fails the request with nothing changed.
   */
  app.post('/admin/content-backup/import', { preHandler: GUARD }, async (req, reply) => {
    const bytes = req.body;
    if (!Buffer.isBuffer(bytes) || !bytes.length) {
      return reply.code(400).send({ error: 'no_file', detail: 'send the zip as the request body' });
    }
    // `zipReadAll` answers an ARRAY of { name, data }, not a map — checked rather than
    // assumed, because indexing an array by filename returns undefined for every entry and
    // the import would report "nothing to import" on a perfectly good zip.
    let entries;
    try {
      const list = await zipReadAll(bytes);
      entries = Object.fromEntries(list.map((e) => [e.name, e.data]));
    } catch { return reply.code(400).send({ error: 'not_a_zip' }); }

    const wanted = chosen(req.query);
    const parsed = {};
    const skipped = [];
    for (const key of wanted) {
      const sec = SECTIONS[key];
      // A section the zip HAS and this route will not write. Named in the reply rather than
      // dropped: "accounts did not come back" is a thing somebody must be told, not left to
      // discover by looking.
      if (!sec?.restore) { skipped.push(key); continue; }
      const raw = entries[`${key}.json`];
      if (raw == null) continue;
      try { parsed[key] = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)); }
      catch { return reply.code(400).send({ error: 'bad_section', detail: `${key}.json is not valid JSON` }); }
    }
    if (!Object.keys(parsed).length) {
      return reply.code(400).send({ error: 'nothing_to_import', skipped });
    }

    const p = await db();

    // BEFORE anything is written. If this fails the import does not run: an undo that does
    // not exist is worse than a refusal, because the refusal happens while the site is still
    // the way you left it.
    let snapshot = null;
    try {
      for (const key of Object.keys(parsed)) {
        const current = await SECTIONS[key].read(p);
        snapshot = await backupFile(
          CONTENT_BACKUP_ROOT, snapPath(key), JSON.stringify(current, null, 2),
          `${req.user.uid} imported ${key}`,
        );
      }
    } catch (e) {
      req.log?.error?.({ err: String(e) }, 'content import: could not snapshot');
      return reply.code(500).send({ error: 'snapshot_failed', detail: 'nothing was imported' });
    }

    const applied = {};
    for (const [key, data] of Object.entries(parsed)) {
      const ops = SECTIONS[key].restore(p, data);
      // One transaction per section: a section either lands whole or not at all. Across
      // sections it is sequential on purpose — a single transaction over six tables holds
      // locks for as long as the slowest one, on a live site.
      await p.$transaction(ops);
      applied[key] = ops.length;
    }

    await logAudit(p, req.user.uid, 'content.import', Object.keys(applied).join(','), clientIp(req)).catch(() => {});
    return { ok: true, applied, skipped, undo: snapshot };
  });

  /**
   * What the site said before each import, newest first.
   *
   * The rollback list. `git` keeps it, so it survives a restart and is not capped by anything
   * this file decides.
   */
  app.get('/admin/content-backup/history', { preHandler: GUARD }, async (req) => {
    const key = String(req.query?.section || '');
    if (!SECTIONS[key]?.restore) return { section: key, entries: [] };
    const entries = await fileHistory(CONTENT_BACKUP_ROOT, snapPath(key), 30).catch(() => []);
    return { section: key, entries };
  });

  /**
   * Put one section back to what it was at a commit.
   *
   * This is the undo, and it is also the rollback — the same act, one from a toast and one
   * from a list. It snapshots FIRST, like an import does, so undoing an undo works.
   */
  app.post('/admin/content-backup/rollback', { preHandler: GUARD }, async (req, reply) => {
    const key = String(req.body?.section || '');
    const hash = String(req.body?.hash || '');
    const sec = SECTIONS[key];
    if (!sec?.restore) return reply.code(400).send({ error: 'not_restorable', section: key });

    let rows;
    try { rows = JSON.parse(await fileAtCommit(CONTENT_BACKUP_ROOT, hash, snapPath(key))); }
    catch { return reply.code(404).send({ error: 'no_such_snapshot' }); }

    const p = await db();
    try {
      const current = await sec.read(p);
      await backupFile(CONTENT_BACKUP_ROOT, snapPath(key), JSON.stringify(current, null, 2),
        `${req.user.uid} rolled ${key} back to ${hash.slice(0, 8)}`);
    } catch (e) {
      req.log?.error?.({ err: String(e) }, 'content rollback: could not snapshot');
      return reply.code(500).send({ error: 'snapshot_failed', detail: 'nothing was changed' });
    }

    const ops = sec.restore(p, rows);
    await p.$transaction(ops);
    await logAudit(p, req.user.uid, 'content.rollback', `${key}@${hash.slice(0, 8)}`, clientIp(req)).catch(() => {});
    return { ok: true, section: key, restored: ops.length };
  });
}
