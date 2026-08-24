// Your own backup — the account record AND the files, in one archive you hold.
//
// Everything here already existed in pieces, aimed at somebody else. `exportUser` builds a
// portability document but only an admin could ask for it. The repo dashboard streams a zip
// but only of one repo, and only if you can still reach that dashboard. A catalog payload
// could be downloaded from the public route, which refuses anything not PUBLISHED — so the
// one moment you most want your file back, after a submission was suspended, is the one
// moment nothing would give it to you.
//
// Three rules shape this file.
//
// 1. STREAM. A backup is exactly the request that is too big to hold in memory, and the
//    person taking it is the one with the most content. Each object is piped from storage
//    into the zip and out to the client; nothing is buffered.
//
// 2. A PARTIAL ARCHIVE MUST SAY SO. An object that cannot be fetched is recorded in the
//    manifest and the archive continues — but the manifest is written LAST, listing what was
//    intended and what actually went in. A backup that silently drops a file is worse than
//    one that fails, because it is discovered on the day it is needed.
//
// 3. YOUR OWN, and nothing else. Every query filters on ownerId from the session. There is
//    no id parameter anywhere in this file, so there is nothing to tamper with.
import { z } from 'zod';
import archiver from 'archiver';
import { Prisma } from '@prisma/client';
import { db, requireRole, logAudit, clientIp } from '../lib/lib.mjs';
import { exportUser } from '../lib/user-export.mjs';
import { getObject } from '../lib/storage.mjs';
import { zipEntryName } from '../lib/zip-path.mjs';
import { throttle } from './hosting-content.mjs';
import { effUpload } from './repos.mjs';

// For a Content-Disposition filename, and ONLY that: it needs no path semantics, it just
// must not break the header. Zip ENTRY names go through zipEntryName instead — this one
// permits '.', so it would pass a name of '..' straight through.
const safeName = (s) => String(s || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'unnamed';

const README = {
  en: `YOUR BETTERCOMMUNITY BACKUP
===========================

account.json   Everything the site holds about your account, as a data-portability
               document. Credentials (password hash, two-factor secret, API tokens) are
               redacted: they are not what a copy of your data is for, and putting them
               in a file you e-mail yourself would create a risk that did not exist.

repos/         Every file of every server repo you own, under its repo name, with the
               paths the repo uses.

catalog/       Every catalog item you own: item.json with its details, and the uploaded
               file beside it when there is one. Items awaiting review or suspended are
               included — they are yours either way.

manifest.json  What this archive was MEANT to contain, and what actually went in. If
               anything could not be read it is listed there under "skipped", with the
               reason. Read it before assuming the archive is complete.

Nothing in here is encrypted. Keep it somewhere you would keep a password export.
`,
  fr: `VOTRE SAUVEGARDE BETTERCOMMUNITY
================================

account.json   Tout ce que le site conserve sur votre compte, sous forme de document de
               portabilite des donnees. Les identifiants (empreinte du mot de passe,
               secret 2FA, jetons d'API) sont expurges : ce n'est pas l'objet d'une copie
               de vos donnees, et les mettre dans un fichier que vous vous envoyez
               creerait un risque qui n'existait pas.

repos/         Tous les fichiers de chaque depot serveur que vous possedez, sous le nom
               du depot, avec les chemins utilises par le depot.

catalog/       Chaque entree de catalogue que vous possedez : item.json avec ses details,
               et le fichier televerse a cote quand il y en a un. Les entrees en attente
               de validation ou suspendues sont incluses : elles sont a vous dans les deux
               cas.

manifest.json  Ce que cette archive DEVAIT contenir, et ce qui y est reellement. Si
               quelque chose n'a pas pu etre lu, c'est liste sous "skipped", avec la
               raison. Lisez-le avant de supposer que l'archive est complete.

Rien ici n'est chiffre. Rangez-la ou vous rangeriez un export de mots de passe.
`,
};

export default async function myBackupRoutes(app) {
  // ── The account record on its own ──────────────────────────────────────────
  //
  // Separate from the archive below because it answers a different question and costs
  // nothing: "what do you know about me" is a JSON file, not a download that streams for
  // ten minutes. Same document the admin route serves, same redactions.
  app.get('/me/export', {
    preHandler: requireRole(),
    config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
  }, async (req, reply) => {
    const p = await db();
    const doc = await exportUser(p, req.user.uid, Prisma.dmmf, new Date().toISOString());
    if (!doc) return reply.code(404).send({ error: 'not_found' });
    // Logged like the admin path: a data export is a disclosure even when it is you asking,
    // and the day it matters is the day somebody else was in the session.
    await logAudit(p, req.user.uid, 'user.data_export', 'self-service', clientIp(req)).catch(() => {});
    reply.header('Content-Disposition', `attachment; filename="bettercommunity-data-${doc.subject.id}.json"`);
    return doc;
  });

  // ── One catalog payload, back to the person who uploaded it ────────────────
  //
  // The public route only serves PUBLISHED items, which is right for the public and wrong
  // for the owner: a submission held for review, or suspended, is exactly when somebody
  // wants their own file back. Ownership is the whole check.
  app.get('/me/catalog/:id/download', {
    preHandler: requireRole(),
    config: { rateLimit: { max: 60, timeWindow: '10 minutes' } },
  }, async (req, reply) => {
    const p = await db();
    const item = await p.catalogItem.findFirst({
      where: { id: String(req.params.id), ownerId: req.user.uid },
      select: { id: true, name: true, slug: true, payloadKey: true, meta: true },
    });
    // Not-yours and not-there are the same answer on purpose: a different one would tell a
    // stranger which ids exist.
    if (!item) return reply.code(404).send({ error: 'not_found' });
    if (!item.payloadKey) {
      // A link-only item has no file here to give back. Saying so, with the link, beats a
      // 404 that reads as "your item is gone".
      return reply.code(404).send({ error: 'no_payload', downloadUrl: item.meta?.download_url || null });
    }
    let obj;
    try { obj = await getObject(item.payloadKey); }
    catch { return reply.code(502).send({ error: 'storage_unavailable' }); }
    reply.header('Content-Type', obj.contentType || 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename="${safeName(item.slug || item.name)}"`);
    if (obj.length) reply.header('Content-Length', String(obj.length));
    return reply.send(obj.body);
  });

  // ── What a full backup would contain, before asking for it ─────────────────
  //
  // So the button can say "1.4 GB across 3 repos" instead of starting a download of an
  // unknown size. Counted from the database, which already tracks the sizes — no object
  // storage is touched.
  app.get('/me/backup/preview', {
    preHandler: requireRole(),
    config: { rateLimit: { max: 30, timeWindow: '10 minutes' } },
  }, async (req) => {
    const p = await db();
    const [repos, items] = await Promise.all([
      p.serverRepo.findMany({
        where: { ownerId: req.user.uid },
        select: { id: true, name: true, files: { select: { size: true } } },
      }),
      p.catalogItem.findMany({
        where: { ownerId: req.user.uid },
        select: { id: true, name: true, slug: true, status: true, payloadSize: true, payloadKey: true },
      }),
    ]);
    const repoBytes = repos.reduce((n, r) => n + r.files.reduce((m, f) => m + Number(f.size || 0), 0), 0);
    const itemBytes = items.reduce((n, i) => n + (i.payloadKey ? Number(i.payloadSize || 0) : 0), 0);
    return {
      repos: repos.map((r) => ({
        id: r.id, name: r.name, files: r.files.length,
        bytes: r.files.reduce((m, f) => m + Number(f.size || 0), 0),
      })),
      items: items.map((i) => ({
        id: i.id, name: i.name, slug: i.slug, status: i.status,
        // Named per item, because "no file" is the reason a catalog folder can look empty
        // and is not a fault of the backup.
        bytes: i.payloadKey ? Number(i.payloadSize || 0) : 0,
        hasFile: !!i.payloadKey,
      })),
      repoBytes,
      itemBytes,
      totalBytes: repoBytes + itemBytes,
    };
  });

  // ── The archive ────────────────────────────────────────────────────────────
  app.get('/me/backup', {
    preHandler: requireRole(),
    // Expensive, and repeatable by holding a key down. The limiter counts REFUSED requests
    // too, so this has to leave room for a couple of mistakes: at three an hour, two mistyped
    // attempts locked out the real one for an hour, which is how a backup button gets a
    // reputation for being broken.
    config: { rateLimit: { max: 6, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    const q = z.object({
      // A comma list rather than three booleans: the client sends what it ticked, and an
      // absent parameter means everything, which is what "back up my account" should do.
      what: z.string().max(60).optional(),
      lang: z.enum(['en', 'fr']).optional(),
    }).safeParse(req.query || {});
    if (!q.success) return reply.code(400).send({ error: 'invalid_input' });
    const wanted = q.data.what
      ? new Set(q.data.what.split(',').map((s) => s.trim()).filter(Boolean))
      : new Set(['account', 'repos', 'catalog']);
    if (!['account', 'repos', 'catalog'].some((k) => wanted.has(k))) {
      return reply.code(400).send({ error: 'nothing_selected' });
    }

    const p = await db();
    const [repos, items] = await Promise.all([
      wanted.has('repos')
        ? p.serverRepo.findMany({
          where: { ownerId: req.user.uid },
          select: { id: true, name: true, uploadLimitKbps: true, hosted: true, files: { select: { path: true, key: true, size: true } } },
        })
        : [],
      wanted.has('catalog')
        ? p.catalogItem.findMany({
          where: { ownerId: req.user.uid },
          select: {
            id: true, name: true, slug: true, kind: true, status: true, version: true,
            description: true, tags: true, meta: true, payloadKey: true, payloadSize: true,
            createdAt: true, updatedAt: true,
          },
        })
        : [],
    ]);

    // Built BEFORE the response starts, because a failure here should be a JSON error and
    // not a truncated zip the browser has already begun saving.
    let accountDoc = null;
    if (wanted.has('account')) {
      accountDoc = await exportUser(p, req.user.uid, Prisma.dmmf, new Date().toISOString());
      if (!accountDoc) return reply.code(404).send({ error: 'not_found' });
    }

    await logAudit(p, req.user.uid, 'user.data_export',
      `self-service archive (${[...wanted].join('+')}; ${repos.length} repo(s), ${items.length} item(s))`,
      clientIp(req)).catch(() => {});

    // The strictest non-zero cap among the repos included. A mixed archive cannot honour
    // three different per-repo limits at once, and picking the loosest would let this route
    // become the fast path around the tightest one.
    const caps = repos.map(effUpload).filter((n) => n > 0);
    const kbps = caps.length ? Math.min(...caps) : 0;

    const stamp = new Date().toISOString().slice(0, 10);
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="bettercommunity-backup-${stamp}.zip"`,
      ...(kbps > 0 ? { 'X-Sandbox-Upload-Kbps': String(kbps) } : {}),
    });
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', () => { try { reply.raw.destroy(); } catch { /* client gone */ } });
    if (kbps > 0) {
      const shaper = throttle(kbps);
      shaper.on('error', () => { try { reply.raw.destroy(); } catch { /* client gone */ } });
      archive.pipe(shaper).pipe(reply.raw);
    } else {
      archive.pipe(reply.raw);
    }

    const manifest = {
      generatedAt: new Date().toISOString(),
      subject: { id: req.user.uid },
      included: [...wanted],
      entries: [],
      // Empty on a clean run, and present ALWAYS — its absence must never be read as a
      // guarantee that nothing was dropped.
      skipped: [],
    };
    const add = (name, bytes) => manifest.entries.push({ name, bytes });

    archive.append(README[q.data.lang || 'en'], { name: 'README.txt' });

    if (accountDoc) {
      const json = JSON.stringify(accountDoc, null, 2);
      archive.append(json, { name: 'account.json' });
      add('account.json', Buffer.byteLength(json));
    }

    for (const repo of repos) {
      // zipEntryName for the FOLDER too. safeName permits '.', so a repo literally named
      // '..' produced 'repos/..' and every entry interpolated from it escaped — the
      // per-file call below would have caught it, the catalog interpolation would not.
      const folder = zipEntryName('repos', repo.name);
      for (const f of repo.files) {
        // Through zipEntryName, not template interpolation: f.path is whatever the owner
        // registered, and '..' survives the upload validation (see lib/zip-path.mjs).
        const name = zipEntryName(folder, f.path);
        try {
          const { body } = await getObject(f.key);
          archive.append(body, { name });
          add(name, Number(f.size || 0));
        } catch (e) {
          // Recorded and carried on. One unreadable object should not cost somebody the
          // other four hundred — but it must not pass unmentioned either.
          manifest.skipped.push({ name, reason: String(e?.message || e).slice(0, 200) });
        }
      }
      if (!repo.files.length) manifest.entries.push({ name: `${folder}/`, bytes: 0, note: 'no files' });
    }

    for (const item of items) {
      const folder = zipEntryName('catalog', item.slug || item.name);
      const meta = JSON.stringify({
        id: item.id, name: item.name, slug: item.slug, kind: item.kind, status: item.status,
        version: item.version, description: item.description, tags: item.tags, meta: item.meta,
        createdAt: item.createdAt, updatedAt: item.updatedAt,
        payloadSize: item.payloadKey ? item.payloadSize : 0,
      }, null, 2);
      const metaName = zipEntryName(folder, 'item.json');
      archive.append(meta, { name: metaName });
      add(metaName, Buffer.byteLength(meta));
      if (!item.payloadKey) {
        // Not a failure: a link-only item never had a file here. Saying which is the
        // difference between "nothing was uploaded" and "your file is missing".
        manifest.entries.push({ name: `${folder}/`, bytes: 0, note: 'link-only item, no uploaded file' });
        continue;
      }
      const name = zipEntryName(folder, item.slug || item.name);
      try {
        const { body } = await getObject(item.payloadKey);
        archive.append(body, { name });
        add(name, Number(item.payloadSize || 0));
      } catch (e) {
        manifest.skipped.push({ name, reason: String(e?.message || e).slice(0, 200) });
      }
    }

    // LAST, so it describes what actually happened rather than what was hoped for.
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    await archive.finalize();
  });
}
