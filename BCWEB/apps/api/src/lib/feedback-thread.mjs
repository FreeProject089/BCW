// One submission, two rows.
//
// A report sent to the feedback centre by a LINKED sender is written twice: a `Feedback` row
// (what the admin triages in Retours & plantages) and a `Report` row with targetType
// 'feedback' (the conversation, listed in Signalements and in the sender's "Messages &
// reports"). They point at each other — `Feedback.reportId` one way, `Report.targetId` the
// other — but there is no foreign key between them, so the database never kept them in step.
//
// It did not have to until somebody deleted one. DELETE /admin/feedback/:id removed the
// Feedback row and nothing else: the Report, its messages and the notifications pointing at it
// stayed, so the "deleted" report sat on in Signalements and in the sender's dashboard. The
// other way round, deleting the thread left a feedback item whose "open in Reports" link and
// reply box pointed at a row that no longer existed, and the reply answered 500.
//
// So the deletion of a submission lives HERE, once, and both routes (and the feedback
// retention sweep) call it. Whichever side you start from, the pair is resolved from both
// pointers, and everything goes in one transaction: a half-applied delete is exactly the
// ghost this file exists to prevent.
import { deleteObject } from './storage.mjs';

/** Where a notification about a report thread points — for the sender and for staff. */
export const reportHrefs = (reportId) => [`/dashboard?s=reports&r=${reportId}`, `/admin?s=reports&r=${reportId}`];

/**
 * Every row that IS this submission, from either end.
 *
 * Both pointers are read because either can be missing: `Feedback.reportId` is written after
 * the Report in a second statement, so a failure between the two leaves only `targetId`.
 */
export async function submissionRows(p, { feedbackId = null, reportId = null }) {
  const fbIds = new Set();
  const repIds = new Set();
  if (reportId) {
    const r = await p.report.findUnique({ where: { id: reportId }, select: { id: true, targetType: true, targetId: true } });
    if (r) {
      repIds.add(r.id);
      if (r.targetType === 'feedback' && r.targetId) fbIds.add(r.targetId);
    }
    for (const f of await p.feedback.findMany({ where: { reportId }, select: { id: true } })) fbIds.add(f.id);
  }
  if (feedbackId) fbIds.add(feedbackId);
  const feedback = fbIds.size
    ? await p.feedback.findMany({ where: { id: { in: [...fbIds] } }, select: { id: true, reportId: true, attachments: true } })
    : [];
  for (const f of feedback) if (f.reportId) repIds.add(f.reportId);
  if (feedback.length) {
    const threads = await p.report.findMany({ where: { targetType: 'feedback', targetId: { in: feedback.map((f) => f.id) } }, select: { id: true } });
    for (const t of threads) repIds.add(t.id);
  }
  return { feedback, reportIds: [...repIds] };
}

/**
 * Delete a submission everywhere it is shown: the feedback row, its thread (messages,
 * participants and invites cascade), the notifications that link to that thread, and — after
 * the rows are gone — the stored attachments.
 *
 * Storage last on purpose: a row pointing at a deleted file is a broken download, a file with
 * no row is only bytes, and the retention sweep never looks for those, so it is the failure
 * worth having. Returns what went, for the route to answer with.
 */
export async function deleteSubmission(p, { feedbackId = null, reportId = null }) {
  const { feedback, reportIds } = await submissionRows(p, { feedbackId, reportId });
  if (!feedback.length && !reportIds.length) return { found: false, feedback: 0, reports: 0 };
  const hrefs = reportIds.flatMap(reportHrefs);
  await p.$transaction([
    ...(hrefs.length ? [p.notification.deleteMany({ where: { href: { in: hrefs } } })] : []),
    ...(reportIds.length ? [p.report.deleteMany({ where: { id: { in: reportIds } } })] : []),
    ...(feedback.length ? [p.feedback.deleteMany({ where: { id: { in: feedback.map((f) => f.id) } } })] : []),
  ]);
  let files = 0; let bytes = 0;
  for (const f of feedback) {
    for (const a of f.attachments || []) { await deleteObject(a.key); files++; bytes += Number(a.size) || 0; }
  }
  return { found: true, feedback: feedback.length, reports: reportIds.length, files, bytes };
}

/**
 * Threads that expire on their own (the reports lifecycle sweep) are NOT a decision about the
 * submission. The feedback row stays — it is what groups crashes — and simply stops pointing
 * at a thread that is about to be gone. Notifications linking to the threads go with them.
 */
export async function detachAndDeleteThreads(p, reportIds) {
  if (!reportIds?.length) return 0;
  const [, , del] = await p.$transaction([
    p.feedback.updateMany({ where: { reportId: { in: reportIds } }, data: { reportId: null } }),
    p.notification.deleteMany({ where: { href: { in: reportIds.flatMap(reportHrefs) } } }),
    p.report.deleteMany({ where: { id: { in: reportIds } } }),
  ]);
  return del.count;
}

/**
 * Mark one thread seen by one person: the side's unread flag, and this person's unread
 * notifications that link to it. Returns the notification ids it read, so the client can drop
 * them from the bell without waiting for its poll.
 *
 * The same flags GET /…/reports/:id already cleared, not a second "seen" state beside them.
 */
export async function markThreadSeen(p, reportId, uid, side) {
  await p.report.update({ where: { id: reportId }, data: side === 'staff' ? { staffUnread: false } : { userUnread: false } }).catch(() => null);
  return readNotifs(p, uid, { href: { in: reportHrefs(reportId) } });
}

/** Kinds written before notifications carried an href — matched by kind when clearing ALL. */
export const LEGACY_REPORT_KINDS = { mine: ['report_reply', 'report_closed', 'report_added'], staff: ['report_new'] };

export async function readNotifs(p, uid, where) {
  const rows = await p.notification.findMany({ where: { userId: uid, readAt: null, ...where }, select: { id: true } });
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  await p.notification.updateMany({ where: { id: { in: ids } }, data: { readAt: new Date() } });
  return ids;
}
