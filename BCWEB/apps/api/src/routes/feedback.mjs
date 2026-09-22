import { z } from 'zod';
import crypto from 'node:crypto';
import { db, requireCap, optionalAuth, notify } from '../lib/lib.mjs';
import { findUserIdByBcId, looksLikeBcId } from '../lib/repofingerprint.mjs';
import { verifyCreatorProof, expectedProofAudience } from '../lib/creator-proof.mjs';
import { putObject, getObject, deleteObject, prefixUsage } from '../lib/storage.mjs';
import { sendMail, mailShell, emailEnabled } from '../lib/mail.mjs';
import { deleteSubmission } from '../lib/feedback-thread.mjs';

// Feedback & crash centre. One inbox per project (BMM, BSM, whatever comes next) that any app
// can post feedback, bug reports and crash dumps to — the thing BMM used BetaHub for, now on
// the platform where the person's account already lives. Each project has its own switch,
// size caps, crash sampling and filters; the admin reads everything on one screen.
//
// Who sent it decides where the answer goes. A submission from a linked account (session, or
// the BMM creator id header) opens a thread in the sender's "Messages & reports" dashboard, so
// a staff reply is a notification, a mail and a line in BMM's own notification centre. An
// anonymous one with an e-mail address is answered by mail. One with neither is read-only.

const SITE_URL = (process.env.SITE_URL || 'https://bettercommunity.ch').replace(/\/+$/, '');
const KINDS = ['feedback', 'bug', 'crash'];

// How large the whole REQUEST may be, which is a different limit from how large the
// attachments may be — and the one that produced a bare "413 Content Too Large" in BMM with
// no JSON body to explain it.
//
// The two are easy to confuse and were: maxAttachMB counts DECODED bytes, but an attachment
// travels base64-encoded inside the JSON, so 25 MB of files is a ~34 MB request. A client
// budgeting against maxAttachMB alone believes it is inside every limit and is not.
//
// So the ceiling is published in the config the client fetches before it packs anything,
// instead of each client picking a number and drifting. It is also the route's own bodyLimit,
// from this one constant, so the value a client is told and the value Fastify enforces cannot
// disagree. Anything in front of the API (a reverse proxy, a CDN) must allow at least this.
const MAX_REQUEST_MB = 64;
const STATUSES = ['new', 'triaged', 'resolved', 'ignored'];

export const DEFAULT_PROJECT = {
  enabled: false,
  kinds: { feedback: true, bug: true, crash: true },
  crashSampling: 100,     // % of crash reports kept (the rest are acknowledged and dropped)
  maxBodyKB: 64,
  maxAttachMB: 25,        // total per submission
  maxAttachments: 6,
  dedupeMinutes: 10,      // same fingerprint from the same sender inside this window = +1, not a new row
  minVersion: '',         // "1.4.0" → older app versions are refused (they should update first)
  blockedVersions: [],    // exact versions refused (a build known to spam)
  blockedWords: [],       // any of these in title/body → refused
  requireContact: false,  // anonymous submissions need an e-mail
  openThread: true,       // linked senders get a dashboard thread
  mailFallback: true,     // anonymous senders with an e-mail get a confirmation + replies by mail
};
/** Where the attachments live and how long — Hosting settings → Feedback storage. */
export const DEFAULT_STORAGE = {
  retentionDays: 90,      // attachments older than this are deleted (the report stays)
  maxTotalMB: 2048,       // above this the oldest attachments go first
  closedRowDays: 365,     // resolved / ignored reports older than this are deleted outright (0 = never)
};
export const DEFAULT_LIMITS = {
  perIp: { max: 10, windowMin: 60 },
  perAccount: { max: 20, windowMin: 60 },
  // Anonymous senders, on top of perIp. An account carries its own budget and a name to
  // answer; a sender we cannot recognise carries neither, and the reports that arrive in
  // bulk are the ones nobody can be written back to. Deliberately not zero: somebody whose
  // first experience of BMM is a crash must still be able to say so.
  perAnonIp: { max: 4, windowMin: 60 },
  perProjectDay: 2000,
  // The platform-wide API limiter (server.mjs) — per IP and, new, per signed-in account.
  // Kept here so one screen owns every rate limit an admin can set. 0 = off.
  apiPerIpMin: 0,
  apiPerAccountMin: 0,
};

let cache = { at: 0, cfg: null };
export async function feedbackConfig(p) {
  if (Date.now() - cache.at < 15_000 && cache.cfg) return cache.cfg;
  const row = await p.adminSetting.findUnique({ where: { key: 'feedback.config' } }).catch(() => null);
  const v = row?.value || {};
  const projects = {};
  for (const [k, pc] of Object.entries(v.projects || {})) projects[k] = { ...DEFAULT_PROJECT, ...pc, kinds: { ...DEFAULT_PROJECT.kinds, ...(pc?.kinds || {}) } };
  const cfg = { projects, limits: { ...DEFAULT_LIMITS, ...(v.limits || {}), perIp: { ...DEFAULT_LIMITS.perIp, ...(v.limits?.perIp || {}) }, perAccount: { ...DEFAULT_LIMITS.perAccount, ...(v.limits?.perAccount || {}) }, perAnonIp: { ...DEFAULT_LIMITS.perAnonIp, ...(v.limits?.perAnonIp || {}) } }, storage: { ...DEFAULT_STORAGE, ...(v.storage || {}) } };
  cache = { at: Date.now(), cfg };
  return cfg;
}

// Sliding-window counters, in memory. A feedback endpoint is low-volume by nature; the
// limiter's job is to stop one client from filling the inbox, not to survive a fleet.
const windows = new Map();
function hit(key, max, windowMs) {
  if (!max || max <= 0) return true;
  const now = Date.now();
  const arr = (windows.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { windows.set(key, arr); return false; }
  arr.push(now); windows.set(key, arr);
  if (windows.size > 20_000) for (const [k, v] of windows) { if (!v.length || now - v[v.length - 1] > windowMs) windows.delete(k); }
  return true;
}

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) { const parts = String(xff).split(',').map((s) => s.trim()).filter(Boolean); if (parts.length) return parts[parts.length - 1]; }
  return req.ip || '0.0.0.0';
}
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
const ipHash = (ip) => sha1(`fb:${ip}`).slice(0, 24);

/** "1.4.2" < "1.10.0" — numeric segments, missing = 0, anything else compares as 0. */
function cmpVersion(a, b) {
  const A = String(a || '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const B = String(b || '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(A.length, B.length); i++) { const d = (A[i] || 0) - (B[i] || 0); if (d) return d; }
  return 0;
}

/* ── The same crash, however many people hit it ───────────────────────────────────────────
 *
 * `fingerprint` does NOT answer this. It is a DEDUPE key: supplied by the client or hashed
 * from the title plus the first 2 KB of the body, and only ever compared inside one sender's
 * dedupe window. Two people hitting the identical bug produce two different fingerprints the
 * moment either of their machines puts a different path, a different pointer or a different
 * mod name in the text — which is always.
 *
 * So the grouping key is derived from the STACK, and from nothing else. Frames are stripped
 * of everything that varies between two machines running the same build:
 *
 *   · absolute paths → the base name, because C:\Users\alice\… and /home/bob/… are one frame;
 *   · :line:col → dropped, because a point release moves every line in the file;
 *   · 0x… addresses and Rust's ::h<16 hex> symbol hashes → dropped, they differ per build;
 *   · the frame's ordinal (`12:`) → dropped, it shifts when anything above it inlines.
 *
 * Only the TOP frames count (SIG_FRAMES). Deep in a stack every crash looks alike — main,
 * the runtime, the event loop — so a signature over the whole trace groups everything that
 * ever crashed into one bucket. The top is where the crash actually is.
 *
 * When there is no stack at all the group falls back to a normalised MESSAGE and says so
 * (`weak: true`). That is a materially worse grouping and the screen has to admit it rather
 * than present it as the same thing.
 */
const SIG_FRAMES = 8;

/**
 * Frames that are the CRASH MACHINERY rather than the crash.
 *
 * This is not a nicety, it is what makes the grouping work at all. BMM captures its
 * backtrace inside `generate_report`, called from the panic hook — so the top of every single
 * BMM backtrace is identical: the backtrace crate, `std::panicking`, the hook, and BMM's own
 * crash module. A signature over the literal top eight frames puts every crash BMM has ever
 * produced into one group, which looks like a working feature and tells you nothing.
 *
 * So a LEADING run of these is dropped, and the signature starts at the first frame that
 * belongs to the program. Only leading: the same names further down are real, and cutting
 * them there would merge unrelated crashes that happen to unwind through a panic.
 */
const NOISE_FRAME_RE = new RegExp([
  'backtrace::', 'std::panicking', 'core::panicking', 'rust_begin_unwind', '__rust_',
  'std::sys_common::backtrace', 'std::sys::backtrace', '::commands::crash::',
  'generate_report', 'panic_hook', 'set_hook',
  'captureStackTrace', '^Error$', 'node:internal/process/promises',
].join('|'));

/** Rust's `thread '…' panicked at src/x.rs:1:2:`, JS `at fn (file:1:2)`, and plain frames. */
const FRAME_RE = /^\s*(?:\d+:\s*)?(?:at\s+)?(.+)$/;

/**
 * A `             at src/commands/mods.rs:412` line, which is not a frame.
 *
 * Rust's backtrace printer puts the symbol on one line and its source location on the next,
 * indented. Counted as frames of their own, those locations DOUBLE the stack and — worse —
 * break the skipping of the panic-hook prefix, because `mod.rs` is not a machinery symbol
 * even though it is the machinery's own file. It belongs to the line above it.
 *
 * A JavaScript `at fn (file:1:2)` is a real frame and is deliberately not matched: this is
 * only a bare location, with no callee and no parentheses.
 */
function isLocationOnly(line) {
  return /^\s+at\s+\S+$/.test(String(line)) && !/[()]/.test(line);
}

/** Does this line look like a stack frame rather than prose? */
function looksLikeFrame(line) {
  const s = String(line);
  if (!s.trim()) return false;
  if (/^\s*(?:at\s|\d+:\s)/.test(s)) return true;               // JS "at …", Rust "12: …"
  if (/^\s*\S+\.(?:rs|js|mjs|cjs|ts|jsx|tsx|dll|so|dylib|exe):\d+/.test(s)) return true;
  if (/::[A-Za-z_]\w*/.test(s) && !/\s{2,}\S+\s+\S+\s+\S+\s+\S+/.test(s)) return true; // rust path
  return false;
}

/** One frame, with everything that differs between two machines taken out of it. */
export function normaliseFrame(line) {
  let s = String(line).replace(FRAME_RE, '$1').trim();
  s = s.replace(/\(([^)]*)\)\s*$/, ' $1');                      // "fn (file:1:2)" → "fn file:1:2"
  s = s.replace(/0x[0-9a-fA-F]+/g, '');                         // addresses
  s = s.replace(/::h[0-9a-f]{4,20}\b/g, '');                    // Rust symbol hashes
  s = s.replace(/[A-Za-z]:[\\/][^\s:]*[\\/]/g, '');             // C:\Users\alice\…\
  s = s.replace(/(?:^|[\s(])\/[^\s:]*\//g, ' ');                // /home/bob/…/
  s = s.replace(/:\d+(?::\d+)?\b/g, '');                        // :line:col
  s = s.replace(/<[^>]{0,40}>/g, '<>');                         // generics, <anonymous>
  s = s.replace(/-[0-9a-f]{8,}\b/g, '');                        // vite/webpack chunk hashes
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * The stack text a report carries, wherever the sender put it.
 *
 * BMM has no single agreed field, so every place one has been seen is checked and the first
 * non-empty one wins. The BODY is last on purpose: it is prose plus a trace, and a dedicated
 * field is always the better source when there is one.
 */
export function stackTextOf(row) {
  const m = row?.meta && typeof row.meta === 'object' ? row.meta : {};
  for (const k of ['stack', 'stackTrace', 'stack_trace', 'backtrace', 'panic', 'trace']) {
    const v = m[k];
    if (typeof v === 'string' && v.trim()) return v;
    if (Array.isArray(v) && v.length) return v.join('\n');
  }
  if (m.error && typeof m.error === 'object' && typeof m.error.stack === 'string') return m.error.stack;
  return String(row?.body || '');
}

/** A message with the variable parts taken out, for reports that carry no stack at all. */
function normaliseMessage(s) {
  return String(s || '')
    .replace(/[A-Za-z]:[\\/][^\s"']+/g, '<path>')
    .replace(/\/[^\s"']{4,}/g, '<path>')
    .replace(/0x[0-9a-fA-F]+/g, '<addr>')
    .replace(/\b\d[\d.]*\b/g, '<n>')
    .replace(/["'][^"']{0,80}["']/g, '<s>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/**
 * `{ sig, weak, frames }` for one report. Exported so the test suite can assert that two
 * traces from two machines land in one bucket and two different bugs do not.
 */
export function stackSignature(row) {
  // Already derived from the crash BUNDLE by whoever opened it (see
  // POST /admin/feedback/:id/crashsig). That reading saw the real backtrace; this one is
  // looking at prose the sender typed, so the bundle always wins.
  const idx = row?.meta && typeof row.meta === 'object' ? row.meta._crash : null;
  if (idx && typeof idx.sig === 'string' && idx.sig) {
    return { sig: idx.sig, weak: !!idx.weak, frames: Array.isArray(idx.frames) ? idx.frames : [], source: 'bundle' };
  }
  const text = stackTextOf(row);
  const all = [];
  for (const line of String(text).split('\n')) {
    if (isLocationOnly(line) && all.length) {
      const loc = normaliseFrame(line);
      if (loc) all[all.length - 1] = `${all[all.length - 1]} ${loc}`;
      continue;
    }
    if (!looksLikeFrame(line)) continue;
    const n = normaliseFrame(line);
    // A frame that normalises away to nothing (a bare address, a lone path) carries no
    // grouping information; keeping it would make the signature depend on how many of them
    // the runtime happened to print.
    if (n.length < 3) continue;
    all.push(n);
    if (all.length >= SIG_FRAMES * 4) break;
  }
  let cut = 0;
  while (cut < all.length && NOISE_FRAME_RE.test(all[cut])) cut++;
  // Every frame was machinery: that is a stack, just not one with a program in it. Better to
  // sign what is there than to fall back to the message and call it weak.
  const frames = (cut < all.length ? all.slice(cut) : all).slice(0, SIG_FRAMES);
  if (frames.length) return { sig: sha1(frames.join('\n')).slice(0, 16), weak: false, frames, source: 'text' };
  const msg = normaliseMessage(row?.title || String(row?.body || '').split('\n')[0]);
  return { sig: `m${sha1(msg).slice(0, 15)}`, weak: true, frames: [], message: msg, source: 'message' };
}

const safeName = (n) => String(n || 'file').replace(/[^\w.-]+/g, '_').slice(0, 80) || 'file';
const attachmentIn = z.object({
  name: z.string().min(1).max(160),
  type: z.string().max(100).optional().default('application/octet-stream'),
  data: z.string().min(1), // base64
});
const submitIn = z.object({
  kind: z.enum(['feedback', 'bug', 'crash']),
  title: z.string().trim().max(200).optional().default(''),
  body: z.string().max(2_000_000).optional().default(''),
  email: z.string().trim().email().max(160).optional().or(z.literal('')).default(''),
  discord: z.string().trim().max(80).optional().default(''),
  appVersion: z.string().trim().max(40).optional().default(''),
  os: z.string().trim().max(120).optional().default(''),
  meta: z.record(z.any()).optional(),
  fingerprint: z.string().trim().max(120).optional().default(''),
  attachments: z.array(attachmentIn).max(40).optional().default([]),
});

const pub = (f) => ({
  id: f.id, projectKey: f.projectKey, kind: f.kind, title: f.title, body: f.body, appVersion: f.appVersion, os: f.os,
  meta: f.meta, attachments: (f.attachments || []).map((a, i) => ({ i, name: a.name, type: a.type, size: a.size })),
  fingerprint: f.fingerprint, count: f.count, status: f.status, userId: f.userId, email: f.email, creatorId: f.creatorId,
  reportId: f.reportId, createdAt: f.createdAt, updatedAt: f.updatedAt,
});

/**
 * Which account a submission is from, or null.
 *
 * Three sources, in order of how much they prove:
 *
 *   1. a session — a report sent from the website is already signed in;
 *   2. a PROVEN creator id — BMM has no session and identifies itself with `X-Creator-ID`,
 *      which is an ed25519 public key and therefore something other people hold. So the
 *      header is ignored unless `X-Creator-Proof` verifies against it: a short, origin-bound
 *      signature made with the private half. Resolved through CreatorLink, the table the
 *      whole pairing flow in links.mjs exists to fill;
 *   3. a BC code — for a caller that really does send one. Reached only for something shaped
 *      like one, because resolving it costs a scan over every account and this endpoint is
 *      public.
 *
 * Step 2 used to BE step 3: the creator id went straight to the BC-code lookup, whose own gate
 * refuses anything longer than eight characters. It never matched, so every BMM report was
 * anonymous — while the app promised the sender a thread.
 *
 * The lookups are arguments so the rule can be checked without a database; the route passes
 * the real ones.
 */
export async function senderIdFrom({ sessionUid = null, headers = {}, aud, now, byCreatorId, byBcId }) {
  if (sessionUid) return sessionUid;
  const claimed = String(headers['x-creator-id'] || '').slice(0, 200).toLowerCase();
  const proven = verifyCreatorProof(headers['x-creator-proof'], aud, now);
  // The proof carries its own id; the header is consulted only to notice a DISAGREEMENT,
  // which means a misconfigured client rather than an attack — either way, not this account.
  if (proven) {
    if (claimed && claimed !== proven) return null;
    return (await byCreatorId(proven)) || null;
  }
  if (!claimed) return null;
  // Unproven. A creator id alone identifies nobody (see above); a BC code is a different
  // thing, pasted by a human, and carries no such promise either — but it is the pre-existing
  // path for non-BMM callers and it stays.
  if (!looksLikeBcId(claimed)) return null;
  if (await byCreatorId(claimed)) return null;   // a linked creator id still needs a proof
  return (await byBcId(claimed)) || null;
}

// Module-level and exported so the config import (lib/config-transfer.mjs) validates a seed
// with the schema this route uses rather than a copy of it.
export const projectIn = z.object({
  enabled: z.boolean(), kinds: z.object({ feedback: z.boolean(), bug: z.boolean(), crash: z.boolean() }),
  crashSampling: z.number().min(0).max(100), maxBodyKB: z.number().int().min(1).max(4096), maxAttachMB: z.number().int().min(0).max(200),
  maxAttachments: z.number().int().min(0).max(40), dedupeMinutes: z.number().int().min(0).max(1440), minVersion: z.string().max(40),
  blockedVersions: z.array(z.string().max(40)).max(50), blockedWords: z.array(z.string().max(60)).max(200),
  requireContact: z.boolean(), openThread: z.boolean(), mailFallback: z.boolean(),
});

export const limitsIn = z.object({
  perIp: z.object({ max: z.number().int().min(0).max(100000), windowMin: z.number().int().min(1).max(1440) }),
  perAccount: z.object({ max: z.number().int().min(0).max(100000), windowMin: z.number().int().min(1).max(1440) }),
  perProjectDay: z.number().int().min(0).max(10_000_000),
  apiPerIpMin: z.number().int().min(0).max(100000), apiPerAccountMin: z.number().int().min(0).max(100000),
});

export const storageIn = z.object({ retentionDays: z.number().int().min(0).max(3650), maxTotalMB: z.number().int().min(0).max(1_000_000), closedRowDays: z.number().int().min(0).max(3650) });
/** The body PUT /admin/feedback/config validates, and what `feedback.config` holds. */
export const FEEDBACK_CONFIG_BODY = z.object({ projects: z.record(z.string().regex(/^[a-z0-9_-]{1,40}$/), projectIn), limits: limitsIn, storage: storageIn.optional() });

export default async function feedbackRoutes(app) {
  // ── Public: what a client may send, before it builds the payload ──
  app.get('/feedback/:project/config', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const p = await db();
    const cfg = await feedbackConfig(p);
    const pc = cfg.projects[req.params.project];
    if (!pc || !pc.enabled) return { enabled: false };
    return { enabled: true, kinds: pc.kinds, crashSampling: pc.crashSampling, maxBodyKB: pc.maxBodyKB, maxAttachMB: pc.maxAttachMB, maxAttachments: pc.maxAttachments, maxRequestMB: MAX_REQUEST_MB, requireContact: pc.requireContact, minVersion: pc.minVersion };
  });

  // ── Public: submit ──
  app.post('/feedback/:project', { preHandler: optionalAuth(), bodyLimit: MAX_REQUEST_MB * 1024 * 1024, config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const p = await db();
    const cfg = await feedbackConfig(p);
    const key = String(req.params.project || '').slice(0, 40);
    const pc = cfg.projects[key];
    if (!pc || !pc.enabled) return reply.code(404).send({ error: 'project_disabled' });
    const b = submitIn.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input', detail: b.error.issues?.[0]?.message });
    const d = b.data;
    if (!pc.kinds[d.kind]) return reply.code(403).send({ error: 'kind_disabled' });

    // ── Who is this ──────────────────────────────────────────────────────────────────
    //
    // A session first: a report sent from the website is already signed in.
    //
    // Then BMM, which has no session and identifies itself with `X-Creator-ID`. That header
    // used to be handed straight to findUserIdByBcId — the BC ID lookup, which matches an
    // eight-character code like "BC-7K2M-9XQ4". BMM sends a 64-character ed25519 public key,
    // so the gate refused it before the scan began and userId was ALWAYS null: every BMM
    // report was filed anonymously while the app promised the sender a thread. CreatorLink is
    // the table that answers this question, and it is asked first now; the BC ID scan stays
    // for a caller that really does send a BC code.
    //
    // But only when PROVEN. A creator id is a public key — repo owners hold other people's,
    // which is the entire point of a whitelist — so the header alone identifies nobody, and
    // acting on it would let anyone who has seen your id file reports in your name and have
    // us mail you about them. BMM signs an audience-bound statement with the key the id names;
    // an unsigned or unverifiable header is simply anonymous, exactly as it was.
    const userId = await senderIdFrom({
      sessionUid: req.user?.uid || null,
      headers: req.headers,
      aud: expectedProofAudience(),
      byCreatorId: (cid) => p.creatorLink.findUnique({ where: { creatorId: cid }, select: { userId: true } }).then((r) => r?.userId || null).catch(() => null),
      byBcId: (code) => findUserIdByBcId(p, code).catch(() => null),
    });
    const ip = clientIp(req);

    // Limits: per IP, per account, per project per day — and a tighter one for senders we
    // cannot recognise, so the cost of being anonymous falls on anonymity and not on whoever
    // else is behind the same address.
    const L = cfg.limits;
    if (!hit(`ip:${ip}`, L.perIp.max, L.perIp.windowMin * 60_000)) return reply.code(429).send({ error: 'rate_limited', retryAfterSec: L.perIp.windowMin * 60 });
    const anon = L.perAnonIp || DEFAULT_LIMITS.perAnonIp;
    if (!userId && anon?.max > 0 && !hit(`anon:${ip}`, anon.max, anon.windowMin * 60_000)) return reply.code(429).send({ error: 'rate_limited', retryAfterSec: anon.windowMin * 60, anonymous: true });
    if (userId && !hit(`acct:${userId}`, L.perAccount.max, L.perAccount.windowMin * 60_000)) return reply.code(429).send({ error: 'rate_limited', retryAfterSec: L.perAccount.windowMin * 60 });
    if (!hit(`proj:${key}`, L.perProjectDay, 86_400_000)) return reply.code(429).send({ error: 'project_quota', retryAfterSec: 3600 });

    // Filters.
    if (pc.minVersion && d.appVersion && cmpVersion(d.appVersion, pc.minVersion) < 0) return reply.code(422).send({ error: 'version_too_old', minVersion: pc.minVersion });
    if (pc.blockedVersions?.includes(d.appVersion)) return reply.code(422).send({ error: 'version_blocked' });
    const text = `${d.title}\n${d.body}`.toLowerCase();
    if ((pc.blockedWords || []).some((w) => w && text.includes(String(w).toLowerCase()))) return reply.code(422).send({ error: 'filtered' });
    if (Buffer.byteLength(d.body, 'utf8') > pc.maxBodyKB * 1024) return reply.code(413).send({ error: 'body_too_large', maxBodyKB: pc.maxBodyKB });
    if (!userId && !d.email && pc.requireContact) return reply.code(422).send({ error: 'contact_required' });
    if (d.attachments.length > pc.maxAttachments) return reply.code(413).send({ error: 'too_many_attachments', max: pc.maxAttachments });

    // Crash sampling: acknowledged, not stored. The client is told so it does not retry.
    if (d.kind === 'crash' && pc.crashSampling < 100 && Math.random() * 100 >= pc.crashSampling) return reply.code(202).send({ ok: true, sampled: false });

    // Dedupe: the same thing from the same sender inside the window bumps the counter.
    const fingerprint = d.fingerprint || sha1(`${key}|${d.kind}|${d.title}|${d.body.slice(0, 2000)}`).slice(0, 40);
    if (pc.dedupeMinutes > 0) {
      const since = new Date(Date.now() - pc.dedupeMinutes * 60_000);
      const dup = await p.feedback.findFirst({ where: { projectKey: key, fingerprint, createdAt: { gte: since }, ...(userId ? { userId } : { ipHash: ipHash(ip) }) }, select: { id: true, reportId: true } });
      if (dup) { await p.feedback.update({ where: { id: dup.id }, data: { count: { increment: 1 } } }); return { ok: true, id: dup.id, threadId: dup.reportId, duplicate: true, linked: !!userId }; }
    }

    // Attachments: decoded, capped, stored. Never served publicly — a crash zip is the
    // sender's machine in a bottle.
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    const stored = []; let total = 0;
    for (let i = 0; i < d.attachments.length; i++) {
      const a = d.attachments[i];
      let buf; try { buf = Buffer.from(a.data, 'base64'); } catch { return reply.code(400).send({ error: 'bad_attachment' }); }
      total += buf.length;
      if (total > pc.maxAttachMB * 1024 * 1024) return reply.code(413).send({ error: 'attachments_too_large', maxAttachMB: pc.maxAttachMB });
      const skey = `feedback/${key}/${id}/${i}-${safeName(a.name)}`;
      try { await putObject(skey, buf, a.type || 'application/octet-stream'); }
      catch (e) { req.log.warn({ e: String(e) }, 'feedback attachment store failed'); return reply.code(503).send({ error: 'storage_unavailable' }); }
      stored.push({ key: skey, name: safeName(a.name), type: a.type || 'application/octet-stream', size: buf.length });
    }

    const meta = d.meta && typeof d.meta === 'object' ? JSON.parse(JSON.stringify(d.meta).slice(0, 16_000)) : undefined;
    // The creator id as SENT, kept for the record even when it proved nothing.
    //
    // This line used to read a bare `creatorId` that was never declared anywhere in the
    // module: a ReferenceError inside the handler, so every single submission — feedback,
    // bug and crash alike — answered 500 after the attachments had already been written to
    // storage. It parses, it lints, and it throws at the one moment nobody is watching. The
    // column is `String @default("")`, so an unproven or absent header stores the empty
    // string rather than null.
    const creatorId = String(req.headers['x-creator-id'] || '').slice(0, 200).toLowerCase();
    const row = await p.feedback.create({ data: {
      id, projectKey: key, kind: d.kind, title: d.title.slice(0, 200), body: d.body, appVersion: d.appVersion, os: d.os, meta: meta ?? undefined,
      attachments: stored, fingerprint, userId, email: d.email, creatorId, ipHash: ipHash(ip),
    } });

    // Where the conversation lives.
    let threadId = null;
    if (userId && pc.openThread) {
      const label = d.title || `${d.kind} · ${key}`;
      const lines = [d.body || '(no description)', '', `-# ${key} ${d.appVersion || ''} · ${d.os || ''}`.trim()];
      if (stored.length) lines.push(`-# ${stored.length} attachment(s) kept with the report — staff can open them from the feedback centre.`);
      const r = await p.report.create({ data: {
        targetType: 'feedback', targetId: id, targetLabel: label.slice(0, 160), reporterId: userId, reason: d.kind,
        messages: { create: { authorId: userId, staff: false, body: lines.join('\n').slice(0, 4000) } },
      } }).catch(() => null);
      if (r) { threadId = r.id; await p.feedback.update({ where: { id }, data: { reportId: r.id } }); }
    } else if (d.email && pc.mailFallback && emailEnabled()) {
      sendMail({
        to: d.email,
        subject: `We received your ${d.kind === 'feedback' ? 'feedback' : d.kind === 'bug' ? 'bug report' : 'crash report'} (${key})`,
        html: mailShell('Thanks — we have it', `Your ${d.kind} for <b>${key}</b> reached the team. Reference: <code>${id}</code>. If we need more, or once it is handled, we will answer at this address. Create a BetterCommunity account with this e-mail to follow it from your dashboard instead.`, { url: `${SITE_URL}/auth`, label: 'Open BetterCommunity' }),
        text: `We received your ${d.kind} for ${key}. Reference: ${id}.`,
      }).catch(() => {});
    }
    return { ok: true, id: row.id, threadId, linked: !!userId, sampled: true };
  });

  // ── Admin ──
  const READ = requireCap('manage_reports', 'MOD');
  const WRITE = requireCap('manage_reports');

  app.get('/admin/feedback/config', { preHandler: READ }, async () => {
    const p = await db();
    const cfg = await feedbackConfig(p);
    const [projects, showcase] = await Promise.all([
      p.project.findMany({ select: { key: true, name: true } }).catch(() => []),
      p.showcaseProject.findMany({ select: { slug: true, name: true } }).catch(() => []),
    ]);
    const known = [...projects.map((x) => ({ key: x.key, name: x.name })), ...showcase.map((x) => ({ key: x.slug, name: x.name }))];
    for (const k of Object.keys(cfg.projects)) if (!known.some((x) => x.key === k)) known.push({ key: k, name: k });
    return { ...cfg, knownProjects: known, defaults: { project: DEFAULT_PROJECT, limits: DEFAULT_LIMITS } };
  });

  app.put('/admin/feedback/config', { preHandler: WRITE }, async (req, reply) => {
    const b = FEEDBACK_CONFIG_BODY.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input', detail: b.error.issues?.[0] });
    const p = await db();
    // Storage is edited on the Hosting screen; a save from the feedback screen keeps it.
    const prev = await p.adminSetting.findUnique({ where: { key: 'feedback.config' } }).catch(() => null);
    const value = { ...b.data, storage: b.data.storage || prev?.value?.storage || DEFAULT_STORAGE };
    await p.adminSetting.upsert({ where: { key: 'feedback.config' }, create: { key: 'feedback.config', value }, update: { value } });
    // The platform-wide limiter reads its own keys (server.mjs polls them every 15 s).
    const upd = (key, v) => p.adminSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
    await upd('hosting.apiRateLimitMax', b.data.limits.apiPerIpMin || null);
    await upd('hosting.apiRateLimitPerAccount', b.data.limits.apiPerAccountMin || null);
    cache = { at: 0, cfg: null };
    return { ok: true };
  });

  app.get('/admin/feedback', { preHandler: READ }, async (req) => {
    const p = await db();
    const q = req.query || {};
    const where = {};
    if (q.project) where.projectKey = String(q.project).slice(0, 40);
    if (q.kind && KINDS.includes(q.kind)) where.kind = q.kind;
    if (q.status && STATUSES.includes(q.status)) where.status = q.status;
    if (q.version) where.appVersion = String(q.version).slice(0, 40);
    if (q.q) { const s = String(q.q).slice(0, 120); where.OR = [{ title: { contains: s, mode: 'insensitive' } }, { body: { contains: s, mode: 'insensitive' } }, { email: { contains: s, mode: 'insensitive' } }, { fingerprint: { contains: s } }]; }
    const page = Math.max(0, parseInt(q.page, 10) || 0); const take = 50;
    // Sort: newest (default), oldest, or BY SEVERITY (crash > bug > feedback, newest within a
    // kind). Severity has no DB column to order on, so it ranks a bounded window in memory —
    // feedback volumes per project are small, so a 1000-row window covers it comfortably.
    const sort = ['new', 'old', 'severity'].includes(q.sort) ? q.sort : 'new';
    const total = await p.feedback.count({ where });
    let rows;
    // Severity paginates over the WINDOW, so the page count has to follow the window, not the
    // table. With more rows than the window, `total` sent the pager past where the slice can
    // reach and every page beyond it came back empty — a pager offering pages that render
    // nothing, with no way to tell that from "no results". `pageTotal` is what the pager counts
    // against; `windowed` lets the screen say why the tail is missing instead of just losing it.
    const SEV_WINDOW = 1000;
    let pageTotal = total;
    let windowed = false;
    if (sort === 'severity') {
      const RANK = { crash: 0, bug: 1, feedback: 2 };
      const win = await p.feedback.findMany({ where, orderBy: { createdAt: 'desc' }, take: SEV_WINDOW });
      win.sort((a, b) => (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9)); // stable → keeps newest-first within a kind
      rows = win.slice(page * take, page * take + take);
      pageTotal = win.length;
      windowed = total > win.length;
    } else {
      rows = await p.feedback.findMany({ where, orderBy: { createdAt: sort === 'old' ? 'asc' : 'desc' }, skip: page * take, take });
    }
    const [byStatus, versions] = await Promise.all([
      p.feedback.groupBy({ by: ['status'], where: where.projectKey ? { projectKey: where.projectKey } : {}, _count: { _all: true } }),
      p.feedback.groupBy({ by: ['appVersion'], where: where.projectKey ? { projectKey: where.projectKey } : {}, _count: { _all: true }, orderBy: { _count: { appVersion: 'desc' } }, take: 30 }).catch(() => []),
    ]);
    const users = rows.some((r) => r.userId) ? await p.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId).filter(Boolean))] } }, select: { id: true, displayName: true } }) : [];
    const uname = Object.fromEntries(users.map((u) => [u.id, u.displayName]));
    return {
      items: rows.map((r) => ({ ...pub(r), body: r.body.slice(0, 400), userName: r.userId ? uname[r.userId] || null : null })),
      total: pageTotal, totalAll: total, windowed, windowSize: SEV_WINDOW, page, take,
      counts: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
      versions: versions.map((v) => ({ version: v.appVersion, n: v._count._all })),
    };
  });

  /* ── Crashes, grouped ──────────────────────────────────────────────────────────────────
   *
   * The list answers "what arrived"; this answers "what is BROKEN", which is a different
   * question and the one the inbox could not be made to answer by sorting it. One group is
   * one crash: how many reports, how many DISTINCT senders, over what period, on which
   * versions and which systems.
   *
   * "Distinct senders" counts accounts where there is one and salted IP hashes otherwise, so
   * it is a floor, not a headcount: one person on two networks counts twice, a household
   * behind one address counts once, and a report with neither counts as its own. The screen
   * says "at least N" for exactly that reason.
   *
   * A bounded window, like the severity sort: crashes are grouped in memory because the
   * signature is derived, not stored in a column that could be grouped on in SQL.
   */
  const CRASH_WINDOW = 3000;
  app.get('/admin/feedback/crashes', { preHandler: READ }, async (req) => {
    const p = await db();
    const q = req.query || {};
    const days = Math.min(365, Math.max(1, parseInt(q.days, 10) || 30));
    const where = { kind: 'crash', createdAt: { gte: new Date(Date.now() - days * 86_400_000) } };
    if (q.project) where.projectKey = String(q.project).slice(0, 40);
    if (q.version) where.appVersion = String(q.version).slice(0, 40);
    if (q.status && STATUSES.includes(q.status)) where.status = q.status;
    const total = await p.feedback.count({ where });
    const rows = await p.feedback.findMany({ where, orderBy: { createdAt: 'desc' }, take: CRASH_WINDOW });

    const groups = new Map();
    let indexed = 0;
    for (const r of rows) {
      const s = stackSignature(r);
      if (s.source === 'bundle') indexed++;
      let g = groups.get(s.sig);
      if (!g) {
        g = {
          sig: s.sig, weak: s.weak, source: s.source, frames: s.frames.slice(0, SIG_FRAMES),
          title: r.title || s.message || '', reports: 0, occurrences: 0,
          first: r.createdAt, last: r.createdAt,
          versions: new Map(), os: new Map(), senders: new Set(), statuses: new Map(),
          sampleId: r.id, ids: [],
        };
        groups.set(s.sig, g);
      }
      // The best title in the group wins: a signature is shared by reports whose titles are
      // "crash", "it closed" and the actual panic line, and the last of those is the one an
      // admin can act on.
      if ((r.title || '').length > (g.title || '').length) g.title = r.title;
      // A group built from bundles must SAY so even if the first row it met had none.
      if (s.source === 'bundle' && g.source !== 'bundle') { g.source = 'bundle'; g.weak = s.weak; g.frames = s.frames.slice(0, SIG_FRAMES); g.sampleId = r.id; }
      g.reports++;
      g.occurrences += Math.max(1, r.count || 1);
      if (r.createdAt < g.first) g.first = r.createdAt;
      if (r.createdAt > g.last) g.last = r.createdAt;
      const bump = (m, k) => { if (k) m.set(k, (m.get(k) || 0) + 1); };
      bump(g.versions, r.appVersion);
      bump(g.os, r.os);
      bump(g.statuses, r.status);
      g.senders.add(r.userId ? `u:${r.userId}` : r.ipHash ? `i:${r.ipHash}` : `r:${r.id}`);
      if (g.ids.length < 200) g.ids.push(r.id);
    }
    const pair = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ k, n }));
    const out = [...groups.values()].map((g) => ({
      sig: g.sig, weak: g.weak, source: g.source, frames: g.frames, title: g.title,
      reports: g.reports, occurrences: g.occurrences, people: g.senders.size,
      first: g.first, last: g.last,
      versions: pair(g.versions), os: pair(g.os), statuses: Object.fromEntries(pair(g.statuses).map((x) => [x.k, x.n])),
      sampleId: g.sampleId, ids: g.ids,
    }));
    // People first, then occurrences: a crash two hundred people met once outranks one a
    // single person met two hundred times, which is usually one broken install.
    out.sort((a, b) => b.people - a.people || b.occurrences - a.occurrences || new Date(b.last) - new Date(a.last));
    return {
      groups: out, days, scanned: rows.length, total,
      windowed: total > rows.length, windowSize: CRASH_WINDOW,
      indexed, unindexed: rows.length - indexed,
    };
  });

  /**
   * The signature a browser derived from the attached crash BUNDLE, written onto the report.
   *
   * The server never OPENS the zip. It is the sender's machine in a bottle — personal paths,
   * a game library, sometimes a token in a log line — and unzipping arbitrary archives in the
   * API is a decompression bomb waiting for a slow afternoon. The admin screen reads it
   * locally, with the same reader the developer tool uses, and posts back the one entry that
   * decides the grouping: `stacktrace.txt`.
   *
   * The SERVER computes the signature from it, and that is the point of doing it this way
   * round. A signature computed in the browser would be a second implementation of the
   * normalising rules, and the day the two drift the same crash quietly splits into two
   * groups with nothing to report it. The raw text is used for the hash and thrown away; what
   * is stored is normalised frames, which have had the paths taken out of them already.
   *
   * Sending the trace to us discloses nothing new: the archive it came out of is sitting in
   * our own object storage, submitted as an attachment.
   *
   * It is stored under `meta._crash`, a reserved key on a column that already exists, so the
   * grouping gets better every time somebody opens a crash and nothing had to be migrated.
   */
  const crashSigIn = z.object({
    stack: z.string().max(400_000),
    reason: z.string().max(400).optional().default(''),
    version: z.string().max(40).optional().default(''),
  });
  app.post('/admin/feedback/:id/crashsig', { preHandler: READ }, async (req, reply) => {
    const b = crashSigIn.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input', detail: b.error.issues?.[0]?.message });
    const p = await db();
    const r = await p.feedback.findUnique({ where: { id: req.params.id }, select: { meta: true, title: true, body: true } });
    if (!r) return reply.code(404).send({ error: 'not_found' });
    // Signed on the BUNDLE's trace, with the report's own title only as the last-resort
    // fallback inside stackSignature — never on `meta`, which is where the answer will be
    // written and would otherwise be read back as its own input.
    const s = stackSignature({ meta: {}, title: b.data.reason || r.title, body: b.data.stack });
    const meta = r.meta && typeof r.meta === 'object' && !Array.isArray(r.meta) ? { ...r.meta } : {};
    // Only `_crash` is writable here. Everything else in `meta` is what the SENDER said, and
    // a staff endpoint that could rewrite it would make the report unciteable.
    meta._crash = {
      sig: s.sig, weak: s.weak, frames: s.frames.slice(0, SIG_FRAMES),
      reason: b.data.reason, version: b.data.version, at: new Date().toISOString(),
    };
    await p.feedback.update({ where: { id: req.params.id }, data: { meta } });
    return { ok: true, crash: meta._crash };
  });

  app.get('/admin/feedback/:id', { preHandler: READ }, async (req, reply) => {
    const p = await db();
    const r = await p.feedback.findUnique({ where: { id: req.params.id } });
    if (!r) return reply.code(404).send({ error: 'not_found' });
    const u = r.userId ? await p.user.findUnique({ where: { id: r.userId }, select: { id: true, displayName: true, email: true } }) : null;
    return { item: { ...pub(r), user: u } };
  });

  app.get('/admin/feedback/:id/attachments/:i', { preHandler: READ }, async (req, reply) => {
    const p = await db();
    const r = await p.feedback.findUnique({ where: { id: req.params.id }, select: { attachments: true } });
    const a = r?.attachments?.[parseInt(req.params.i, 10)];
    if (!a?.key) return reply.code(404).send({ error: 'not_found' });
    try {
      const obj = await getObject(a.key);
      reply.header('Content-Type', a.type || 'application/octet-stream');
      reply.header('Content-Disposition', `attachment; filename="${a.name}"`);
      // The type is whatever the SENDER claimed. The admin screen previews images with an
      // <img> pointed here; nosniff keeps a browser from second-guessing a mislabelled file
      // into something it would execute, and nothing here should sit in a shared cache.
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Cache-Control', 'private, no-store');
      if (obj.length) reply.header('Content-Length', obj.length);
      return reply.send(obj.body);
    } catch { return reply.code(404).send({ error: 'not_found' }); }
  });

  app.post('/admin/feedback/:id/status', { preHandler: READ }, async (req, reply) => {
    const b = z.object({ status: z.enum(['new', 'triaged', 'resolved', 'ignored']) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const r = await p.feedback.update({ where: { id: req.params.id }, data: { status: b.data.status } }).catch(() => null);
    if (!r) return reply.code(404).send({ error: 'not_found' });
    // A resolved feedback closes its thread too, with a line saying so — the sender sees the
    // outcome where they have been following it.
    if (r.reportId && (b.data.status === 'resolved' || b.data.status === 'ignored')) {
      await p.report.update({ where: { id: r.reportId }, data: { status: 'closed', userUnread: true, lastActivityAt: new Date(), messages: { create: { staff: true, body: b.data.status === 'resolved' ? 'Marked as resolved by the team.' : 'Closed without action.' } } } }).catch(() => {});
      if (r.userId) notify(p, r.userId, 'report_closed', `Your ${r.kind} "${r.title || r.id}" was ${b.data.status === 'resolved' ? 'resolved' : 'closed'}.`, { bodyFr: `Ton ${r.kind} « ${r.title || r.id} » a été ${b.data.status === 'resolved' ? 'résolu' : 'fermé'}.`, href: `/dashboard?s=reports&r=${r.reportId}` }).catch(() => {});
    }
    return { ok: true, item: pub(r) };
  });

  // Reply: into the dashboard thread when there is one, by mail otherwise.
  app.post('/admin/feedback/:id/reply', { preHandler: READ }, async (req, reply) => {
    const b = z.object({ body: z.string().trim().min(1).max(4000) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const r = await p.feedback.findUnique({ where: { id: req.params.id } });
    if (!r) return reply.code(404).send({ error: 'not_found' });
    // A thread that is gone (expired by the reports sweep before it learned to detach, or
    // removed by hand) used to throw inside the update below and answer 500. Clear the stale
    // pointer and fall through to the mail path, which is where an unthreaded report goes.
    if (r.reportId && !(await p.report.findUnique({ where: { id: r.reportId }, select: { id: true } }))) {
      await p.feedback.update({ where: { id: r.id }, data: { reportId: null } });
      r.reportId = null;
    }
    if (r.reportId) {
      await p.report.update({ where: { id: r.reportId }, data: { userUnread: true, lastActivityAt: new Date(), status: 'open', messages: { create: { authorId: req.user.uid, staff: true, body: b.data.body } } } });
      if (r.userId) notify(p, r.userId, 'report_reply', `Staff replied about your ${r.kind} "${r.title || r.id}".`, { bodyFr: `L’équipe a répondu à ton ${r.kind} « ${r.title || r.id} ».`, href: `/dashboard?s=reports&r=${r.reportId}` }).catch(() => {});
      if (r.status === 'new') await p.feedback.update({ where: { id: r.id }, data: { status: 'triaged' } });
      return { ok: true, via: 'thread' };
    }
    if (r.email && emailEnabled()) {
      const sent = await sendMail({
        to: r.email, subject: `About your ${r.kind} (${r.projectKey}) — BetterCommunity`,
        html: mailShell('A reply from the team', `<p style="white-space:pre-wrap">${b.data.body.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</p><p>Reference: <code>${r.id}</code></p>`, { url: `${SITE_URL}/auth`, label: 'Open BetterCommunity' }),
        text: `${b.data.body}\n\nReference: ${r.id}`,
      }).catch(() => false);
      if (!sent) return reply.code(503).send({ error: 'mail_failed' });
      if (r.status === 'new') await p.feedback.update({ where: { id: r.id }, data: { status: 'triaged' } });
      return { ok: true, via: 'mail' };
    }
    return reply.code(409).send({ error: 'no_channel' });
  });

  // ── Storage: what the attachments weigh, the retention, and a purge ──
  app.get('/admin/feedback/storage', { preHandler: READ }, async () => {
    const p = await db();
    const cfg = await feedbackConfig(p);
    const [usage, rows, closed] = await Promise.all([
      prefixUsage('feedback/').catch(() => ({ bytes: 0, count: 0 })),
      p.feedback.count(),
      p.feedback.count({ where: { status: { in: ['resolved', 'ignored'] } } }),
    ]);
    return { storage: cfg.storage, usage, rows, closed, prefix: 'feedback/' };
  });
  app.put('/admin/feedback/storage', { preHandler: WRITE }, async (req, reply) => {
    const b = z.object({ retentionDays: z.number().int().min(0).max(3650), maxTotalMB: z.number().int().min(0).max(1_000_000), closedRowDays: z.number().int().min(0).max(3650) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const prev = (await p.adminSetting.findUnique({ where: { key: 'feedback.config' } }).catch(() => null))?.value || {};
    const value = { ...prev, storage: b.data };
    await p.adminSetting.upsert({ where: { key: 'feedback.config' }, create: { key: 'feedback.config', value }, update: { value } });
    cache = { at: 0, cfg: null };
    return { ok: true };
  });
  app.post('/admin/feedback/storage/purge', { preHandler: WRITE }, async (req) => {
    const p = await db();
    const cfg = await feedbackConfig(p);
    const result = await sweepFeedbackStorage(p, cfg.storage, { force: !!req.body?.all });
    return { ok: true, ...result };
  });

  // Hourly: attachments past their retention go, the oldest go when the total is over the
  // cap, and closed reports past their own retention go with everything they carry.
  const timer = setInterval(async () => {
    try { const p = await db(); const cfg = await feedbackConfig(p); await sweepFeedbackStorage(p, cfg.storage, {}); } catch { /* next hour */ }
  }, 60 * 60 * 1000);
  timer.unref?.();

  // The submission, everywhere it is shown. This used to delete the Feedback row alone, and
  // the Report thread that represents the same submission in Signalements and in the sender's
  // dashboard stayed behind — see lib/feedback-thread.mjs. The admin screen holds this call
  // until its undo window closes, so nothing here is ever half of an undoable action.
  app.delete('/admin/feedback/:id', { preHandler: WRITE }, async (req, reply) => {
    const p = await db();
    if (!(await p.feedback.findUnique({ where: { id: req.params.id }, select: { id: true } }))) return reply.code(404).send({ error: 'not_found' });
    const out = await deleteSubmission(p, { feedbackId: req.params.id });
    return { ok: true, threads: out.reports };
  });
}

/** The retention rules, applied. `force` drops every attachment regardless of age. */
export async function sweepFeedbackStorage(p, storage = DEFAULT_STORAGE, { force = false } = {}) {
  const st = { ...DEFAULT_STORAGE, ...(storage || {}) };
  let deletedFiles = 0, freedBytes = 0, deletedRows = 0;
  const strip = async (row, keep) => {
    const gone = (row.attachments || []).filter((a) => !keep(a));
    if (!gone.length) return;
    for (const a of gone) { await deleteObject(a.key); deletedFiles++; freedBytes += Number(a.size) || 0; }
    await p.feedback.update({ where: { id: row.id }, data: { attachments: (row.attachments || []).filter(keep) } }).catch(() => {});
  };
  // 1. Age.
  if (force || st.retentionDays > 0) {
    const cutoff = new Date(Date.now() - st.retentionDays * 86_400_000);
    const rows = await p.feedback.findMany({ where: force ? {} : { createdAt: { lt: cutoff } }, select: { id: true, attachments: true } });
    for (const r of rows) if ((r.attachments || []).length) await strip(r, () => false);
  }
  // 2. Closed reports past their retention.
  if (st.closedRowDays > 0) {
    const cutoff = new Date(Date.now() - st.closedRowDays * 86_400_000);
    const rows = await p.feedback.findMany({ where: { status: { in: ['resolved', 'ignored'] }, updatedAt: { lt: cutoff } }, select: { id: true, attachments: true } });
    // With their thread: a closed report past retention is deleted, not half-deleted — the
    // same rule as the admin's own delete, from the same function.
    for (const r of rows) {
      const out = await deleteSubmission(p, { feedbackId: r.id }).catch(() => null);
      if (out?.found) { deletedFiles += out.files; freedBytes += out.bytes; deletedRows++; }
    }
  }
  // 3. The cap: oldest attachments first until under it.
  if (st.maxTotalMB > 0) {
    const cap = st.maxTotalMB * 1024 * 1024;
    const rows = await p.feedback.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, attachments: true } });
    let total = rows.reduce((n, r) => n + (r.attachments || []).reduce((m, a) => m + (Number(a.size) || 0), 0), 0);
    for (const r of rows) {
      if (total <= cap) break;
      const size = (r.attachments || []).reduce((m, a) => m + (Number(a.size) || 0), 0);
      if (!size) continue;
      await strip(r, () => false);
      total -= size;
    }
  }
  return { deletedFiles, freedBytes, deletedRows };
}
