// Scheduled-deletion sweeper. Catalog items and hosted repos can be marked with a
// `deleteAt` (a 72h grace window — e.g. a user delete, or a failed hosting payment).
// Their files are kept until that moment, then this job hard-deletes the rows and
// their object-storage bytes. Runs periodically from the API process.
import { db, notify } from './lib.mjs';
import { deleteObject } from './storage.mjs';
import { sampleAndAlert } from './monitor.mjs';
import { FILES_ROOT, FILES_BACKUP_ROOT, snapshotTree, repoSizeBytes, gcRepo } from './gitbackup.mjs';

const DAY_MS = 864e5;

// Daily full-tree snapshot of FILES_ROOT into the git-backed backup repo, so
// there's always a same-day rollback point even if nobody touched anything
// through the file manager. Gated on a timestamp in AdminSetting (not a cron
// schedule) so it just runs on whichever sweeper tick first notices >=24h
// have passed, same pattern as the rest of this file.
async function sweepDailyFileBackup(p, log) {
  const key = 'backup.lastFullSnapshot';
  const row = await p.adminSetting.findUnique({ where: { key } });
  const last = row?.value?.at ? new Date(row.value.at).getTime() : 0;
  if (Date.now() - last < DAY_MS) return false;
  try {
    const limitRow = await p.adminSetting.findUnique({ where: { key: 'backup.maxBytes' } });
    const maxBytes = limitRow?.value?.maxBytes;
    if (maxBytes) {
      const current = await repoSizeBytes(FILES_BACKUP_ROOT);
      if (current > maxBytes) {
        await gcRepo(FILES_BACKUP_ROOT);
        const afterGc = await repoSizeBytes(FILES_BACKUP_ROOT);
        if (afterGc > maxBytes) { log.warn({ afterGc, maxBytes }, 'sweeper: file backup repo over its size limit even after gc — skipping today\'s snapshot'); return false; }
      }
    }
    await snapshotTree(FILES_BACKUP_ROOT, FILES_ROOT, 'daily snapshot');
    await p.adminSetting.upsert({ where: { key }, create: { key, value: { at: new Date().toISOString() } }, update: { value: { at: new Date().toISOString() } } });
    return true;
  } catch (e) { log.warn({ e: String(e?.message || e) }, 'sweeper: daily file backup failed'); return false; }
}

async function sweepItems(p, log) {
  const due = await p.catalogItem.findMany({ where: { deleteAt: { lte: new Date() } }, take: 50 });
  for (const item of due) {
    try {
      if (item.payloadKey) await deleteObject(item.payloadKey); // our-hosted payload bytes
      await p.submission.deleteMany({ where: { itemId: item.id } });
      await p.catalogEvent.deleteMany({ where: { itemId: item.id } });
      await p.catalogItem.delete({ where: { id: item.id } });
    } catch (e) { log.warn({ id: item.id, e: String(e?.message || e) }, 'sweeper: item delete failed'); }
  }
  return due.length;
}

async function sweepRepos(p, log) {
  const due = await p.serverRepo.findMany({ where: { deleteAt: { lte: new Date() } }, include: { files: true }, take: 20 });
  for (const repo of due) {
    try {
      for (const f of repo.files) await deleteObject(f.key); // hosted bytes
      await p.subscription.deleteMany({ where: { serverRepoId: repo.id } });
      await p.serverRepo.delete({ where: { id: repo.id } }); // RepoFile rows cascade
    } catch (e) { log.warn({ id: repo.id, e: String(e?.message || e) }, 'sweeper: repo delete failed'); }
  }
  return due.length;
}

// Prepaid hosting terms (`Subscription.currentPeriodEnd`) never auto-renew — there's
// no recurring Stripe subscription behind them (checkout is `mode: 'payment'`), so
// nothing else in the codebase ever looks at `currentPeriodEnd` once it's written.
// Without this, a repo whose term lapsed just stayed ONLINE forever. This suspends
// the repo (and every sibling repo in its pool, if grouped — they share one paid
// term) and opens the same 72h delete-grace window used everywhere else.
async function sweepExpiredSubscriptions(p, log) {
  const now = new Date();
  const expired = await p.subscription.findMany({
    where: { status: 'active', currentPeriodEnd: { lte: now }, serverRepo: { deleteAt: null, status: { not: 'SUSPENDED' } } },
    include: { serverRepo: { include: { group: { include: { repos: true } } } } },
    take: 50,
  });
  for (const sub of expired) {
    try {
      const repo = sub.serverRepo;
      const deleteAt = new Date(now.getTime() + 3 * DAY_MS);
      const siblings = repo.groupId && repo.group ? repo.group.repos : [repo];
      for (const r of siblings) {
        if (r.status !== 'SUSPENDED') await p.serverRepo.update({ where: { id: r.id }, data: { status: 'SUSPENDED', deleteAt } });
      }
      await p.subscription.update({ where: { id: sub.id }, data: { status: 'expired' } });
      await notify(p, repo.ownerId, 'hosting_stopped', `Your hosting term for "${repo.name}"${repo.groupId ? ' (and its pool)' : ''} has ended — it's suspended and will be deleted in 72h unless you renew.`);
    } catch (e) { log.warn({ id: sub.id, e: String(e?.message || e) }, 'sweeper: subscription expiry failed'); }
  }
  return expired.length;
}

// Keeps the Discord bot's per-user activity table (join date, last message, last
// voice, avatar/username — see DiscordActivity) under the admin-configured cap
// (`bot.config.limits.storageMB`, previously a dead field nothing enforced) by
// pruning the least-recently-active rows first. The bot itself never touches
// storage directly — it just POSTs activity over HTTP, so this stays cheap and
// keeps the table bounded regardless of server size.
async function sweepDiscordActivityCap(p, log) {
  try {
    const row = await p.adminSetting.findUnique({ where: { key: 'bot.config' } });
    const capMB = row?.value?.limits?.storageMB;
    if (!capMB || capMB <= 0) return 0;
    const capBytes = capMB * 1024 * 1024;
    const [{ bytes }] = await p.$queryRaw`SELECT pg_total_relation_size('"DiscordActivity"')::bigint AS bytes`;
    if (Number(bytes) <= capBytes) return 0;
    const total = await p.discordActivity.count();
    if (total === 0) return 0;
    // Prune down to ~90% of the cap (proportionally, by row count) rather than
    // pruning to the exact byte boundary every single sweep.
    const targetBytes = capBytes * 0.9;
    const keepFraction = targetBytes / Number(bytes);
    const toDelete = Math.max(0, total - Math.floor(total * keepFraction));
    if (toDelete === 0) return 0;
    const victims = await p.discordActivity.findMany({ orderBy: { updatedAt: 'asc' }, take: toDelete, select: { discordId: true } });
    await p.discordActivity.deleteMany({ where: { discordId: { in: victims.map((v) => v.discordId) } } });
    return victims.length;
  } catch (e) { log.warn({ e: String(e?.message || e) }, 'sweeper: discord activity cap failed'); return 0; }
}

// Warn 72h ahead of a lapsing term (once per term — flagged in the repo's existing
// misc `settings` JSON bag so no schema change is needed). Only fires for terms
// that haven't already lapsed/been scheduled for deletion.
async function sweepExpiryWarnings(p, log) {
  const now = new Date();
  const soon = new Date(now.getTime() + 3 * DAY_MS);
  const soonExpiring = await p.subscription.findMany({
    where: { status: 'active', currentPeriodEnd: { gt: now, lte: soon }, serverRepo: { deleteAt: null } },
    include: { serverRepo: true },
    take: 100,
  });
  let warned = 0;
  for (const sub of soonExpiring) {
    const repo = sub.serverRepo;
    if (repo.settings?._expiryWarnedAt) continue;
    try {
      await p.serverRepo.update({ where: { id: repo.id }, data: { settings: { ...(repo.settings || {}), _expiryWarnedAt: now.toISOString() } } });
      await notify(p, repo.ownerId, 'hosting_expiring', `"${repo.name}" hosting expires in 72 hours — renew to keep it online, or it will be suspended and later deleted.`);
      warned++;
    } catch (e) { log.warn({ id: sub.id, e: String(e?.message || e) }, 'sweeper: expiry warning failed'); }
  }
  return warned;
}

export function startSweeper(app) {
  const run = async () => {
    try {
      const p = await db();
      const [items, repos, expired, warned, pruned, backedUp] = [
        await sweepItems(p, app.log), await sweepRepos(p, app.log),
        await sweepExpiredSubscriptions(p, app.log), await sweepExpiryWarnings(p, app.log),
        await sweepDiscordActivityCap(p, app.log), await sweepDailyFileBackup(p, app.log),
      ];
      await sampleAndAlert(p, app.log);
      if (items || repos || expired || warned || pruned || backedUp) app.log.info(`[sweeper] hard-deleted ${items} item(s), ${repos} repo(s) · suspended ${expired} expired term(s) · warned ${warned} · pruned ${pruned} old Discord member row(s)${backedUp ? ' · took daily file backup snapshot' : ''}`);
    } catch (e) { app.log.warn({ e: String(e) }, 'sweeper run failed'); }
  };
  run(); // sweep once at boot
  return setInterval(run, 10 * 60 * 1000); // then every 10 minutes
}
