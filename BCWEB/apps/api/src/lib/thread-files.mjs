// Files in contact conversations: whether a message may carry them, storing them, and
// throwing them away with the conversation.
//
// WHO DECIDES is the target's hosting settings (lib/entity-hosting.mjs), per inbox:
//   a project's conversation  →  EntityHostingSettings kind 'project-contact', ref = project ref
//   a team's conversation     →  kind 'team-contact', ref = team id (also repos/catalogues it owns)
//   anything else             →  no files: a repo, a catalogue or a person has no storage
//                                of its own to put them in
//
// The bytes arrive inline (base64 in the JSON body, like feedback attachments), because an
// anonymous sender has no session to presign with. They land under `contact/<threadId>/`,
// which the public media proxy never serves; the only way back out is the participant
// routes in threads.mjs, sent as an attachment, never rendered on our origin.
import crypto from 'node:crypto';
import { putObject, getObject, deleteObject } from './storage.mjs';
import { hostingFor, attachmentPolicy, limitsFor, siteAttachmentDefault } from './entity-hosting.mjs';

export const MAX_FILES_PER_MESSAGE = 3;
// Documents and pictures. No HTML, no SVG (both can carry script), no executables.
export const FILE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain', 'application/zip', 'application/x-zip-compressed', 'application/json'];

let store = { put: putObject, get: getObject, del: deleteObject };
/** For the tests: object storage is not part of the database they run against. */
export function setThreadFileStore(s) { store = s ? { ...store, ...s } : { put: putObject, get: getObject, del: deleteObject }; }
export const threadFileStore = () => store;

/** Which inbox's settings govern this thread's files: `{ kind, ref }` or null. */
export function hostingTargetOf(thread) {
  if (thread.kind === 'project') return { kind: 'project-contact', ref: thread.targetId };
  if (thread.ownerTeamId) return { kind: 'team-contact', ref: thread.ownerTeamId };
  return null;
}

/** Bytes of files already stored for one inbox. */
async function inboxFileBytes(p, target) {
  const where = target.kind === 'project-contact' ? { thread: { kind: 'project', targetId: target.ref } } : { thread: { ownerTeamId: target.ref } };
  const agg = await p.contactThreadAttachment.aggregate({ where, _sum: { size: true } }).catch(() => null);
  return Number(agg?._sum?.size || 0);
}

/** What the client may be told before it tries: may this thread's messages carry files? */
export async function filePolicyFor(p, thread) {
  const target = hostingTargetOf(thread);
  if (!target) return { allowed: false, why: 'attachments_off', maxBytes: 0, maxFiles: 0 };
  const s = await hostingFor(p, target.kind, target.ref);
  const pol = attachmentPolicy(s, await siteAttachmentDefault(p));
  return { ...pol, maxFiles: pol.allowed ? MAX_FILES_PER_MESSAGE : 0, target, settings: s };
}

/**
 * Check the files of one message BEFORE the message exists. `files` is `[{ name, type, data }]`
 * with `data` base64. Returns `{ decoded }` to hand to commitFiles, or `{ error, ... }`: a
 * refused file must refuse the whole message, not leave a message whose file silently
 * vanished.
 */
export async function prepareFiles(p, thread, files) {
  const list = Array.isArray(files) ? files : [];
  if (!list.length) return { decoded: [] };
  const pol = await filePolicyFor(p, thread);
  if (!pol.allowed) return { error: pol.why || 'attachments_off' };
  if (list.length > pol.maxFiles) return { error: 'too_many_files', max: pol.maxFiles };
  const decoded = [];
  for (const f of list) {
    const type = String(f?.type || '').toLowerCase();
    if (!FILE_TYPES.includes(type)) return { error: 'unsupported_type', allowed: FILE_TYPES };
    const buf = Buffer.from(String(f?.data || ''), 'base64');
    if (!buf.length) return { error: 'empty_file' };
    if (buf.length > pol.maxBytes) return { error: 'too_large', maxBytes: pol.maxBytes };
    const name = String(f?.name || 'file').replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120) || 'file';
    decoded.push({ buf, type, name });
  }
  // The inbox's own cap, or its pool reservation, covers the files already there plus these.
  const lim = limitsFor(pol.settings);
  const adding = decoded.reduce((a, d) => a + d.buf.length, 0);
  if (lim.maxBytes !== null && (await inboxFileBytes(p, pol.target)) + adding > lim.maxBytes) {
    return { error: 'storage_full', source: lim.source, maxBytes: lim.maxBytes };
  }
  return { decoded };
}

/** Store what prepareFiles accepted, against the message that now exists. */
export async function commitFiles(p, thread, messageId, prepared) {
  const rows = [];
  for (const d of prepared?.decoded || []) {
    const key = `contact/${thread.id}/${crypto.randomUUID()}-${d.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60)}`;
    await store.put(key, d.buf, d.type);
    rows.push(await p.contactThreadAttachment.create({ data: { threadId: thread.id, messageId, key, name: d.name, mime: d.type, size: d.buf.length } }));
  }
  return { rows };
}

/** Both steps at once, for a caller that has the message already. */
export async function storeFiles(p, thread, messageId, files) {
  const prep = await prepareFiles(p, thread, files);
  return prep.error ? prep : commitFiles(p, thread, messageId, prep);
}

/** Delete a thread's stored objects. Call BEFORE deleting the thread (the rows cascade). */
export async function deleteThreadFiles(p, threadIds) {
  const ids = [].concat(threadIds).filter(Boolean);
  if (!ids.length) return 0;
  const rows = await p.contactThreadAttachment.findMany({ where: { threadId: { in: ids } }, select: { key: true } }).catch(() => []);
  for (const r of rows) await store.del(r.key);
  return rows.length;
}

/** A file as the thread view lists it. The key never leaves the server. */
export const serFile = (a) => ({ id: a.id, name: a.name, mime: a.mime, size: a.size, messageId: a.messageId });
