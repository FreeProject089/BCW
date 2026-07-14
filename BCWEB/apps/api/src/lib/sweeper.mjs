// Scheduled-deletion sweeper. Catalog items and hosted repos can be marked with a
// `deleteAt` (a 72h grace window — e.g. a user delete, or a failed hosting payment).
// Their files are kept until that moment, then this job hard-deletes the rows and
// their object-storage bytes. Runs periodically from the API process.
import { db, notify } from './lib.mjs';
import { resolveRetention } from './retention.mjs';
import { deleteObject } from './storage.mjs';
import { sampleAndAlert } from './monitor.mjs';
import { runEventScheduler } from '../routes/events.mjs';
import { sweepReports } from '../routes/reports.mjs';
import { recomputePoolBytes } from '../routes/hosting.mjs';
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

// Purge the payload FILE of a rejected submission once its grace window elapses,
// reclaiming temp-margin space (the file was squatting it since rejection). The
// REJECTED item row itself stays — only the object bytes go, plus the payloadKey/Size
// are cleared so it no longer counts anywhere. A resubmit within the grace clears
// payloadPurgeAt (see /catalog/:id/update), so anything reaching here is truly stale.
async function sweepRejectedPayloads(p, log) {
  const due = await p.catalogItem.findMany({ where: { payloadPurgeAt: { lte: new Date() }, payloadKey: { not: null } }, take: 50 });
  let purged = 0;
  for (const item of due) {
    try {
      await deleteObject(item.payloadKey);
      await p.catalogItem.update({ where: { id: item.id }, data: { payloadKey: null, payloadSize: 0, payloadPurgeAt: null } });
      purged++;
    } catch (e) { log.warn({ id: item.id, e: String(e?.message || e) }, 'sweeper: rejected-payload purge failed'); }
  }
  return purged;
}

// Hard-delete community catalogs whose 72h grace elapsed: their managed items' payload
// bytes go, then the rows (CommunityCatalogItem cascades on catalog delete).
async function sweepCommunityCatalogs(p, log) {
  const due = await p.communityCatalog.findMany({ where: { deleteAt: { lte: new Date() } }, include: { items: { select: { payloadKey: true } } }, take: 20 });
  for (const cat of due) {
    try {
      for (const it of cat.items) { if (it.payloadKey) await deleteObject(it.payloadKey); }
      await p.communityCatalog.delete({ where: { id: cat.id } });
    } catch (e) { log.warn({ id: cat.id, e: String(e?.message || e) }, 'sweeper: community catalog delete failed'); }
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
  const deleteAt = new Date(now.getTime() + 3 * DAY_MS);
  const expired = await p.subscription.findMany({
    where: { status: 'active', currentPeriodEnd: { lte: now } },
    include: { serverRepo: { include: { group: { include: { repos: true } } } }, hostingGroup: { include: { repos: true } } },
    take: 50,
  });
  let handled = 0;
  for (const sub of expired) {
    try {
      if (sub.hostingGroupId && sub.hostingGroup) {
        // Pool subscription: mark it expired, then recompute the pool's storage from its
        // REMAINING active subs. A single-sub pool drops to 0 → recompute suspends repos +
        // hides catalogs (72h grace), exactly as before. A merged pool with other active
        // subs just shrinks by this sub's contribution and keeps its content online.
        await p.subscription.update({ where: { id: sub.id }, data: { status: 'expired' } });
        await recomputePoolBytes(p, sub.hostingGroupId);
        await notify(p, sub.hostingGroup.ownerId, 'hosting_stopped', `A subscription on your storage pool "${sub.hostingGroup.name}" has ended — the pool shrank by its share; anything over the remaining space is suspended (72h grace) unless you renew.`);
        handled++;
      } else if (sub.serverRepoId && sub.serverRepo) {
        const repo = sub.serverRepo;
        if (repo.deleteAt || repo.status === 'SUSPENDED') { await p.subscription.update({ where: { id: sub.id }, data: { status: 'expired' } }); continue; }
        const siblings = repo.groupId && repo.group ? repo.group.repos : [repo];
        for (const r of siblings) {
          if (r.status !== 'SUSPENDED') await p.serverRepo.update({ where: { id: r.id }, data: { status: 'SUSPENDED', deleteAt } });
        }
        await p.subscription.update({ where: { id: sub.id }, data: { status: 'expired' } });
        await notify(p, repo.ownerId, 'hosting_stopped', `Your hosting term for "${repo.name}"${repo.groupId ? ' (and its pool)' : ''} has ended — it's suspended and will be deleted in 72h unless you renew.`);
        handled++;
      } else {
        // Orphan sub (neither anchor) — just mark expired so it stops being scanned.
        await p.subscription.update({ where: { id: sub.id }, data: { status: 'expired' } });
      }
    } catch (e) { log.warn({ id: sub.id, e: String(e?.message || e) }, 'sweeper: subscription expiry failed'); }
  }
  return handled;
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
  // One warning per term, tracked on the subscription (works for both a repo sub and a
  // pool sub). warnedAt is cleared on renewal so the next term warns again.
  const soonExpiring = await p.subscription.findMany({
    where: { status: 'active', currentPeriodEnd: { gt: now, lte: soon }, warnedAt: null },
    include: { serverRepo: true, hostingGroup: true },
    take: 100,
  });
  let warned = 0;
  for (const sub of soonExpiring) {
    try {
      await p.subscription.update({ where: { id: sub.id }, data: { warnedAt: now } });
      if (sub.hostingGroup) {
        await notify(p, sub.hostingGroup.ownerId, 'hosting_expiring', `Your storage pool "${sub.hostingGroup.name}" expires in 72 hours — renew to keep its repos and catalogs online.`);
      } else if (sub.serverRepo) {
        await notify(p, sub.serverRepo.ownerId, 'hosting_expiring', `"${sub.serverRepo.name}" hosting expires in 72 hours — renew to keep it online, or it will be suspended and later deleted.`);
      }
      warned++;
    } catch (e) { log.warn({ id: sub.id, e: String(e?.message || e) }, 'sweeper: expiry warning failed'); }
  }
  return warned;
}

// ── Analytics retention ──────────────────────────────────────────────────────
// The high-volume, append-only analytics tables (AnalyticsEvent, InteractionEvent,
// WebVital, LoginAttempt) grow without bound — every pageview, click, web-vital
// sample and sign-in attempt is a row, and none is ever deleted. Left alone the
// raw-SQL aggregations that power the admin dashboards degrade and the DB bloats.
// This purges rows older than a per-table retention window (config in retention.mjs).
// Cap rows removed per table per sweep, so the very first purge of a large backlog
// is spread over several 10-minute ticks instead of one giant table-locking DELETE.
const RETENTION_BATCH = 5000;

async function purgeOlderThan(model, days, log, name) {
  if (!Number.isFinite(days) || days <= 0) return 0; // 0 = keep forever
  const cutoff = new Date(Date.now() - days * DAY_MS);
  try {
    // Bounded batch: take up to N oldest rows past the cutoff by id, delete just those.
    const victims = await model.findMany({ where: { createdAt: { lt: cutoff } }, orderBy: { createdAt: 'asc' }, take: RETENTION_BATCH, select: { id: true } });
    if (!victims.length) return 0;
    const { count } = await model.deleteMany({ where: { id: { in: victims.map((x) => x.id) } } });
    return count;
  } catch (e) { log?.warn?.({ table: name, e: String(e?.message || e) }, 'sweeper: analytics retention purge failed'); return 0; }
}

export async function sweepAnalyticsRetention(p, log) {
  const row = await p.adminSetting.findUnique({ where: { key: 'analytics.retention' } }).catch(() => null);
  const cfg = resolveRetention(row?.value);
  const purged = await purgeOlderThan(p.analyticsEvent, cfg.pageviewDays, log, 'AnalyticsEvent')
    + await purgeOlderThan(p.interactionEvent, cfg.interactionDays, log, 'InteractionEvent')
    + await purgeOlderThan(p.webVital, cfg.vitalDays, log, 'WebVital')
    + await purgeOlderThan(p.loginAttempt, cfg.loginDays, log, 'LoginAttempt');
  return purged;
}

export function startSweeper(app) {
  const run = async () => {
    try {
      const p = await db();
      const [items, repos, cats, rejPayloads, expired, warned, pruned, backedUp, analytics] = [
        await sweepItems(p, app.log), await sweepRepos(p, app.log),
        await sweepCommunityCatalogs(p, app.log), await sweepRejectedPayloads(p, app.log),
        await sweepExpiredSubscriptions(p, app.log), await sweepExpiryWarnings(p, app.log),
        await sweepDiscordActivityCap(p, app.log), await sweepDailyFileBackup(p, app.log),
        await sweepAnalyticsRetention(p, app.log),
      ];
      await sweepReports(p).catch((e) => app.log.warn({ e: String(e) }, 'report sweep failed'));
      await sampleAndAlert(p, app.log);
      await runEventScheduler(p).catch((e) => app.log.warn({ e: String(e) }, 'event scheduler failed'));
      if (items || repos || cats || rejPayloads || expired || warned || pruned || backedUp || analytics) app.log.info(`[sweeper] hard-deleted ${items} item(s), ${repos} repo(s), ${cats} catalog(s) · purged ${rejPayloads} rejected payload(s) · suspended ${expired} expired term(s) · warned ${warned} · pruned ${pruned} old Discord member row(s) · aged out ${analytics} analytics row(s)${backedUp ? ' · took daily file backup snapshot' : ''}`);
    } catch (e) { app.log.warn({ e: String(e) }, 'sweeper run failed'); }
  };
  run(); // sweep once at boot
  return setInterval(run, 10 * 60 * 1000); // then every 10 minutes
}
