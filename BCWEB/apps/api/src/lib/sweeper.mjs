// Scheduled-deletion sweeper. Catalog items and hosted repos can be marked with a
// `deleteAt` (a 72h grace window — e.g. a user delete, or a failed hosting payment).
// Their files are kept until that moment, then this job hard-deletes the rows and
// their object-storage bytes. Runs periodically from the API process.
import { db, notify, catalogLog, clearAccountLockCache } from './lib.mjs';
import { sweepAttention } from './attention.mjs';
import { PENDING_QUEUES } from '../routes/misc.mjs';
import { sendMail, mailShell, emailEnabled } from './mail.mjs';
import { resolveRetention } from './retention.mjs';
import { getRedis } from './redis.mjs';

// With more than one API replica, only ONE should run the sweeper per tick — otherwise
// they'd double-suspend expired subs, double-send expiry warnings, and race the file
// backup. A Redis lock with a TTL just under the interval elects a single runner; it
// expires on its own, so a crashed holder never wedges the job. No Redis (single
// container) → always run.
async function acquireSweepLock(ttlMs) {
  const r = getRedis();
  if (!r) return true;
  try {
    const ok = await r.set('bcw:sweeper:lock', `${process.pid}-${Date.now()}`, 'PX', ttlMs, 'NX');
    return ok === 'OK';
  } catch { return true; } // Redis hiccup must never stop the sweeper on a single-instance deploy
}
import { deleteObject } from './storage.mjs';
import { sampleAndAlert } from './monitor.mjs';
import { runEventScheduler } from '../routes/events.mjs';
import { sweepReports } from '../routes/reports.mjs';
import { recomputePoolBytes, stripe } from '../routes/hosting.mjs';
import { sweepAccountClosures } from '../routes/closure.mjs';
import { FILES_ROOT, FILES_BACKUP_ROOT, snapshotTree, repoSizeBytes, gcRepo } from './gitbackup.mjs';
import { createSnapshot, pruneSnapshots } from './snapshots.mjs';
import { pruneApiRequests } from './apiusage.mjs';
import { runWebhookQueue } from './webhooks.mjs';

const SITE_URL = process.env.SITE_URL || 'http://localhost:5176';
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
import { signBytes } from './signing.mjs';
import { awardSeason } from './game-season.mjs';

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
    // Freeze today's history into a keepable artefact, then rotate. Doing this here and not
    // only behind the admin button is the difference between a retention policy and a
    // suggestion: nobody presses a button every day, and the day they would have is the day
    // the box is already on fire.
    const keep = limitRow?.value?.keep ?? 10;
    await createSnapshot('files', { by: 'sweeper', note: 'daily snapshot', sign: (bytes) => signBytes(bytes, p) })
      .then(() => pruneSnapshots(keep))
      .then((removed) => { if (removed.length) log.info({ removed: removed.length }, 'sweeper: rotated old snapshots'); })
      // A snapshot that cannot be written must not lose the day's history commit, which is
      // already safely in the repo above.
      .catch((e) => log.warn({ e: String(e?.message || e) }, 'sweeper: snapshot archive failed (history still committed)'));
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
      // The tombstone is written BEFORE the row goes, and it is the last thing that will
      // ever say this item existed: `catalogId` is kept for callers that still hold the
      // old id, but the slug is the durable identity from here on.
      await catalogLog(p, item, 'deleted');
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

// The actual destruction, in one place.
//
// Exported because the owner can also choose to skip the 72h wait, and that path must
// destroy exactly what the sweeper destroys. A second copy in the route would be a second
// thing to remember when a repo grows a new kind of attached row — and the copy that
// forgot would leave orphaned bytes nobody is billed for and nobody can find.
export async function purgeRepo(p, repo) {
  for (const f of repo.files) await deleteObject(f.key); // hosted bytes
  await p.subscription.deleteMany({ where: { serverRepoId: repo.id } });
  await p.serverRepo.delete({ where: { id: repo.id } }); // RepoFile rows cascade
}

async function sweepRepos(p, log) {
  const due = await p.serverRepo.findMany({ where: { deleteAt: { lte: new Date() } }, include: { files: true }, take: 20 });
  for (const repo of due) {
    try {
      await purgeRepo(p, repo);
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
/** End suspensions whose clock ran out.
 *
 *  Until now this only happened at the next sign-in, which is the wrong moment twice over: a
 *  person who does not come back keeps their repos offline for ever, and the ones they were
 *  serving to are punished for a sanction that ended. So the clock is checked here, the
 *  content is put back where it was, and the person is told — including which subscriptions
 *  were cancelled while they were out, because the offer to take them out again is the whole
 *  point of having cancelled only the ones that were expiring anyway.
 */
export async function sweepEndedSuspensions(p, log) {
  const now = new Date();
  // Both statuses. A timed BAN was never swept — only 'suspended' was looked at — so a ban
  // with an end date ran out on paper while the repos and catalogs it froze stayed offline
  // for ever, and nobody was told. A sanction that ends has to end for the content too.
  const due = await p.user.findMany({
    where: { status: { in: ['suspended', 'banned'] }, moderationUntil: { not: null, lte: now } },
    select: { id: true, email: true, displayName: true, status: true, moderationSuspendState: true },
    take: 50,
  }).catch(() => []);
  let ended = 0;
  for (const u of due) {
    try {
      const { restoreOwned } = await import('../routes/closure.mjs');
      const restored = await restoreOwned(p, u.id, u.moderationSuspendState);
      await p.user.update({ where: { id: u.id }, data: { status: 'active', moderationUntil: null, moderationReason: null, moderationSuspendState: null } });
      clearAccountLockCache(u.id);

      const open = await p.sanction.findFirst({
        where: { userId: u.id, kind: { in: ['suspension', 'ban'] }, status: 'active' }, orderBy: { issuedAt: 'desc' },
      }).catch(() => null);
      if (open) await p.sanction.update({ where: { id: open.id }, data: { status: 'expired' } }).catch(() => {});

      const cancelled = Array.isArray(open?.meta?.cancelledSubs) ? open.meta.cancelledSubs : [];
      const back = restored.repos + restored.catalogs + restored.items;
      const word = u.status === 'banned' ? 'ban' : 'suspension';
      await notify(p, u.id, 'account_sanction',
        `Your ${word} has ended${open ? ` (${open.code})` : ''}. ${back} item(s) are back the way they were.`
        + (cancelled.length ? ` ${cancelled.length} subscription(s) were cancelled while you were out — you can take them out again from Billing.` : ''))
        .catch(() => {});

      if (emailEnabled()) {
        const rows = cancelled.map((c) => `<li>${escapeHtml(c.planName || 'Hosting')}${c.priceCents ? ` — ${(c.priceCents / 100).toFixed(2)}/month` : ''}</li>`).join('');
        await sendMail({
          to: u.email, subject: open ? `[${open.code}] Your ${word} has ended` : `Your ${word} has ended`,
          html: mailShell(`Your ${word} has ended`, `
            <p>Hi ${escapeHtml(u.displayName || '')},</p>
            <p>Your account is active again and ${back} item(s) have been put back exactly as they were.</p>
            ${cancelled.length ? `<p style="margin-top:12px">These subscriptions were cancelled while you were suspended, because their term ended before the suspension did:</p><ul>${rows}</ul><p>Nothing was taken out again on your behalf — you decide.</p>` : ''}`,
            cancelled.length ? { url: `${SITE_URL}/dashboard?s=billing`, label: 'Take them out again' } : { url: `${SITE_URL}/dashboard`, label: 'Open your dashboard' }),
          text: `Your ${word} has ended. ${back} item(s) restored.${cancelled.length ? ` ${cancelled.length} subscription(s) can be taken out again: ${SITE_URL}/dashboard?s=billing` : ''}`,
        }).catch(() => {});
      }
      ended++;
    } catch (e) { log?.warn?.({ e: String(e?.message || e) }, 'ending a suspension failed'); }
  }
  if (ended) log?.info?.({ ended }, 'sweeper: locks ended');
  return ended;
}

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
    + await purgeOlderThan(p.loginAttempt, cfg.loginDays, log, 'LoginAttempt')
    + await purgeOlderThan(p.errorEvent, cfg.errorDays, log, 'ErrorEvent');
  return purged;
}

// ── Analytics daily rollup ───────────────────────────────────────────────────
// Pre-aggregates AnalyticsEvent into AnalyticsDaily (day → views + unique visitors) so the
// dashboard's day-granularity series is a tiny PK read instead of two full-window GROUP BYs.
// Every tick keeps the last few days fresh (today is partial, late events arrive); once a day
// it does a full recompute over the retention horizon — which also BACKFILLS on first run
// (no timestamp yet) so existing history is rolled up. Uses the same date_trunc('day') the
// read uses, so the rollup and any raw fallback always agree.
export async function rollupAnalyticsDaily(p, log) {
  try {
    // cheap: refresh the trailing window every tick (self-heals recent days too)
    await p.$executeRaw`
      INSERT INTO "AnalyticsDaily" (day, views, visitors, "updatedAt")
      SELECT date_trunc('day', "createdAt")::date, count(*)::int, count(DISTINCT "visitor")::int, now()
      FROM "AnalyticsEvent" WHERE "createdAt" >= now() - interval '3 days'
      GROUP BY 1
      ON CONFLICT (day) DO UPDATE SET views = EXCLUDED.views, visitors = EXCLUDED.visitors, "updatedAt" = now()`;
    // heavy: full recompute at most once per day (and immediately on first run → backfill)
    const row = await p.adminSetting.findUnique({ where: { key: 'analytics.rollupAt' } }).catch(() => null);
    const lastAt = row?.value?.at ? new Date(row.value.at).getTime() : 0;
    if (Date.now() - lastAt >= DAY_MS) {
      await p.$executeRaw`
        INSERT INTO "AnalyticsDaily" (day, views, visitors, "updatedAt")
        SELECT date_trunc('day', "createdAt")::date, count(*)::int, count(DISTINCT "visitor")::int, now()
        FROM "AnalyticsEvent" WHERE "createdAt" >= now() - interval '400 days'
        GROUP BY 1
        ON CONFLICT (day) DO UPDATE SET views = EXCLUDED.views, visitors = EXCLUDED.visitors, "updatedAt" = now()`;
      const at = new Date().toISOString();
      await p.adminSetting.upsert({ where: { key: 'analytics.rollupAt' }, create: { key: 'analytics.rollupAt', value: { at } }, update: { value: { at } } });
    }
  } catch (e) { log?.warn?.({ e: String(e?.message || e) }, 'sweeper: analytics rollup failed'); }
}

// ── Signed-in devices ────────────────────────────────────────────────────────
// Session rows are kept after revocation so "signed out from X" stays answerable for a
// while, but they must not accumulate forever. Two kinds are dead beyond recovery:
//
//  - revoked more than 30 days ago — long past the point anyone is auditing it;
//  - last seen beyond the token's own 7-day lifetime (plus a day of slack), which means
//    the JWT pointing at the row expired on its own and no request can ever revive it.
//
// Live sessions are never touched: `lastSeenAt` is refreshed on use, so an actively used
// device keeps moving out of the window.
const SESSION_REVOKED_KEEP_DAYS = 30;
const SESSION_IDLE_DEAD_DAYS = 8; // 7-day token + 1 day of slack
export async function sweepDeadSessions(p, log) {
  const now = Date.now();
  const revokedBefore = new Date(now - SESSION_REVOKED_KEEP_DAYS * 864e5);
  const idleBefore = new Date(now - SESSION_IDLE_DEAD_DAYS * 864e5);
  try {
    const { count } = await p.session.deleteMany({
      where: {
        OR: [
          { revokedAt: { lt: revokedBefore } },
          { lastSeenAt: { lt: idleBefore } },
        ],
      },
    });
    if (count) log?.info(`[sweeper] pruned ${count} dead session row(s)`);
    return count;
  } catch (e) {
    log?.warn({ e: String(e) }, 'session sweep failed');
    return 0;
  }
}

/// Apply price changes whose day has come.
///
/// The announcement already went out when the change was scheduled; this is only the
/// swap. It is idempotent by construction — the pending columns are cleared in the same
/// update, so a plan can never be repriced twice by two sweeper passes.
///
/// Existing subscriptions are deliberately untouched. They keep the terms they were sold
/// under until their next renewal, which is what both the policy and the announcement
/// email promise, and Stripe holds its own copy of the price for the current period.
export async function sweepScheduledPrices(p, log) {
  const due = await p.hostingPlan.findMany({
    where: { pendingPriceAt: { lte: new Date() }, pendingPriceCents: { not: null } },
    select: { id: true, name: true, priceMonthlyCents: true, pendingPriceCents: true, pendingApplyExisting: true },
  });
  let n = 0;
  for (const plan of due) {
    // Existing subscribers FIRST, then the plan row. If Stripe is unreachable the plan
    // keeps its pending change and the whole thing is retried in ten minutes — whereas
    // clearing the staging first would leave the announcement made, the plan repriced,
    // and the subscriptions silently untouched with nothing left to say they should not
    // have been.
    if (plan.pendingApplyExisting) {
      const moved = await repriceExistingSubscribers(p, plan, log);
      if (moved === null) { log?.warn?.(`[sweeper] ${plan.name}: could not reprice existing subscribers — leaving the change pending`); continue; }
      log?.info?.(`[sweeper] ${plan.name}: moved ${moved} existing subscription(s) to the new price`);
    }
    await p.hostingPlan.update({
      where: { id: plan.id },
      data: {
        priceMonthlyCents: plan.pendingPriceCents,
        pendingPriceCents: null, pendingPriceAt: null, pendingNoticeAt: null, pendingNoticeCount: 0,
        pendingApplyExisting: false,
      },
    });
    log?.info?.(`[sweeper] ${plan.name}: announced price change applied (${plan.priceMonthlyCents} → ${plan.pendingPriceCents} cents/mo)`);
    n++;
  }
  return n;
}

/// Move every live subscription on this plan onto the new amount.
///
/// Each subscription is pinned to its OWN ad-hoc Price, created at its checkout — that is
/// why a plan's price never reaches an existing customer by itself, and why raising one
/// means minting a new Price and swapping the subscription item onto it.
///
/// `proration_behavior: 'none'` is the whole promise in one argument: no mid-term
/// invoice, no credit, no charge today. The new amount simply becomes what the NEXT
/// renewal bills — which is exactly what the notice email said would happen.
///
/// Returns the number moved, or null if Stripe could not be reached at all (the caller
/// then leaves the change pending rather than half-applying it).
export async function repriceExistingSubscribers(p, plan, log) {
  let sk;
  try { sk = await stripe(); } catch { return null; }
  if (!sk) return null;
  const subs = await p.subscription.findMany({
    where: { planId: plan.id, status: 'active', stripeSubId: { not: null } },
    select: { id: true, stripeSubId: true },
  });
  if (!subs.length) return 0;
  let moved = 0;
  for (const sub of subs) {
    try {
      const live = await sk.subscriptions.retrieve(sub.stripeSubId);
      const item = live.items?.data?.[0];
      if (!item) continue;
      // Keep the cadence the customer actually bought (monthly, or a multi-month term):
      // repricing must not quietly turn a 6-month term into a monthly one.
      const rec = item.price?.recurring || { interval: 'month', interval_count: 1 };
      const months = rec.interval === 'month' ? (rec.interval_count || 1) : 1;
      const price = await sk.prices.create({
        currency: item.price?.currency || 'usd',
        unit_amount: Math.max(50, plan.pendingPriceCents * months),
        recurring: { interval: rec.interval || 'month', interval_count: rec.interval_count || 1 },
        product_data: { name: `${plan.name} hosting (auto-renew)` },
      });
      await sk.subscriptions.update(sub.stripeSubId, {
        items: [{ id: item.id, price: price.id }],
        proration_behavior: 'none',
      });
      moved++;
    } catch (e) {
      // One customer's subscription failing (deleted in Stripe, card issue, whatever)
      // must not stop the others — and must not be silent.
      log?.warn?.(`[sweeper] ${plan.name}: subscription ${sub.stripeSubId} not repriced: ${e?.message}`);
    }
  }
  return moved;
}

export function startSweeper(app) {
  const run = async () => {
    try {
      // Single-runner election across replicas (TTL just under the 10-min interval).
      if (!(await acquireSweepLock(9.5 * 60 * 1000))) return;
      const p = await db();
      const [items, repos, cats, rejPayloads, expired, warned, pruned, backedUp, analytics] = [
        await sweepItems(p, app.log), await sweepRepos(p, app.log),
        await sweepCommunityCatalogs(p, app.log), await sweepRejectedPayloads(p, app.log),
        await sweepExpiredSubscriptions(p, app.log), await sweepExpiryWarnings(p, app.log),
        await sweepDiscordActivityCap(p, app.log), await sweepDailyFileBackup(p, app.log),
        await sweepEndedSuspensions(p, app.log),
        await runWebhookQueue(p, app.log),
        await sweepAnalyticsRetention(p, app.log),
      ];
      await sweepDeadSessions(p, app.log);
      await sweepScheduledPrices(p, app.log).catch((e) => app.log.warn({ e: String(e) }, 'scheduled price sweep failed'));
      await sweepAccountClosures(p, app.log).catch((e) => app.log.warn({ e: String(e) }, 'account closure sweep failed'));
      await rollupAnalyticsDaily(p, app.log).catch((e) => app.log.warn({ e: String(e) }, 'analytics rollup failed'));
      await sweepReports(p).catch((e) => app.log.warn({ e: String(e) }, 'report sweep failed'));
      await pruneApiRequests(p, app.log).catch((e) => app.log.warn({ e: String(e) }, 'api request prune failed'));
      await sampleAndAlert(p, app.log);
      await runEventScheduler(p).catch((e) => app.log.warn({ e: String(e) }, 'event scheduler failed'));
      // The 404 game's monthly podium. Idempotent in the database (GameAward is unique on
      // game+season+rank), so running this every ten minutes mints nothing after the first.
      await awardSeason(p)
        .then((r) => { if (r.awarded?.length) app.log.info(`[sweeper] Orb Fall ${r.season}: awarded ${r.awarded.length} code(s)`); })
        .catch((e) => app.log.warn({ e: String(e) }, 'game season award failed'));
      if (items || repos || cats || rejPayloads || expired || warned || pruned || backedUp || analytics) app.log.info(`[sweeper] hard-deleted ${items} item(s), ${repos} repo(s), ${cats} catalog(s) · purged ${rejPayloads} rejected payload(s) · suspended ${expired} expired term(s) · warned ${warned} · pruned ${pruned} old Discord member row(s) · aged out ${analytics} analytics row(s)${backedUp ? ' · took daily file backup snapshot' : ''}`);
    } catch (e) { app.log.warn({ e: String(e) }, 'sweeper run failed'); }
  };
  run(); // sweep once at boot
  return setInterval(run, 10 * 60 * 1000); // then every 10 minutes
}
