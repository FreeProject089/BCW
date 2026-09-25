// prerelease (agent-prerelease): the rules of early access, with no database in them, so each
// one is unit-tested on its own (test/prerelease.test.mjs). The routes are routes/prereleases.mjs.
//
// ── Phases ───────────────────────────────────────────────────────────────────────────────────
// Computed at read time from the stored fields, never stored, so nothing has to sweep:
//
//   draft      not published: its editors only
//   upcoming   published, the sign-up window has not opened yet
//   open       sign-ups accepted
//   selecting  the window has closed, no selection has been made yet
//   available  a selection was made: the selected members may download
//   closed     ended by an editor: no sign-ups, no downloads
//
// Running a selection ends the sign-up window (a draw over a list that is still growing is not
// a draw). Mode `all` is the exception: every sign-up is selected the moment it is made, so the
// window stays open and the selected download while it is.
//
// ── The draw ─────────────────────────────────────────────────────────────────────────────────
// Commit-reveal. The seed is 32 random bytes drawn when the pre-release is created, and its
// SHA-256 (`seedHash`) is public from then on, so the seed cannot be chosen once the sign-ups
// are known; it is revealed after the first round. The winners are a partial Fisher-Yates over
// the entrants in their canonical order (sign-up time, then id), fed by HMAC-SHA256(seed,
// "<round>:<counter>") read as 32-bit words, with rejection sampling so no index is favoured.
// Same seed, same entrants, same round: same winners, on any machine. `drawWinners` is the whole
// algorithm and the record carries every input it needs.
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';

export const MODES = ['manual', 'draw', 'first', 'all'];
export const PHASES = ['draft', 'upcoming', 'open', 'selecting', 'available', 'closed'];
/** The phases a public listing shows ("current" pre-releases). */
export const CURRENT_PHASES = ['upcoming', 'open', 'selecting', 'available'];
/** The phases in which a SELECTED member may download. */
export const DOWNLOAD_PHASES = ['open', 'selecting', 'available'];
export const DRAW_ALGO = 'hmac-sha256-fisher-yates-v1';
export const LIMITS = Object.freeze({ perProject: 50, message: 500, maxCapacity: 100_000, fileBytes: 1536 * 1024 * 1024, list: 200 });
/** How long the presigned GET handed to a selected member lives, in seconds. */
export const DOWNLOAD_TTL_S = 120;

const ms = (d) => (d ? new Date(d).getTime() : null);

/** Which phase a pre-release is in at `now`. */
export function phaseOf(pr, now = Date.now()) {
  if (!pr?.published) return 'draft';
  if (pr.closedAt) return 'closed';
  const t = typeof now === 'number' ? now : new Date(now).getTime();
  const opens = ms(pr.opensAt);
  if (opens != null && t < opens) return 'upcoming';
  const closes = ms(pr.closesAt);
  const windowOpen = closes == null || t < closes;
  if (pr.mode === 'all') return windowOpen ? 'open' : 'available';
  if (pr.selectedAt) return 'available';
  return windowOpen ? 'open' : 'selecting';
}

export const canSignUp = (pr, now) => phaseOf(pr, now) === 'open';
export const canDownloadPhase = (pr, now) => DOWNLOAD_PHASES.includes(phaseOf(pr, now));

// ── the draw ──────────────────────────────────────────────────────────────────────────────
export const newSeed = () => randomBytes(32).toString('hex');
export const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');
export const seedHashOf = (seed) => sha256(seed);
/** The fingerprint of an entrant list, in order. Published with each round. */
export const entrantsHash = (ids) => sha256(ids.join('\n'));

/** 32-bit words from HMAC-SHA256(seed, "<round>:<counter>"), counter 0, 1, 2… */
function* words(seed, round) {
  const key = Buffer.from(String(seed), 'hex');
  for (let counter = 0; ; counter++) {
    const h = createHmac('sha256', key).update(`${round}:${counter}`).digest();
    for (let i = 0; i < h.length; i += 4) yield h.readUInt32BE(i);
  }
}

/** A uniform integer in [0, m): words at or above the largest multiple of m are thrown away,
 *  which is what keeps `u % m` from favouring the small residues. */
function uniformBelow(gen, m) {
  const limit = Math.floor(0x100000000 / m) * m;
  for (;;) {
    const u = gen.next().value;
    if (u < limit) return u % m;
  }
}

/**
 * The winners of one round: `n` of `entrants` (in the order given), chosen by the seed.
 * Pure and deterministic. Throws on a malformed seed rather than drawing from nothing.
 */
export function drawWinners(seed, entrants, n, round = 1) {
  if (!/^[0-9a-f]{64}$/.test(String(seed))) throw new TypeError('drawWinners: the seed is 32 bytes of hex');
  const a = [...entrants];
  const k = Math.max(0, Math.min(Number(n) || 0, a.length));
  const gen = words(seed, round);
  for (let i = 0; i < k; i++) {
    const j = i + uniformBelow(gen, a.length - i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
}

/** Entrants in their canonical order: sign-up time, then id. Both are stored, so the order is
 *  reproducible from the rows, and the record carries the list anyway. */
export function canonicalEntrants(signups) {
  return [...signups]
    .sort((x, y) => (ms(x.createdAt) - ms(y.createdAt)) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
    .map((s) => s.id);
}

/**
 * Who one selection round picks, from the PENDING sign-ups.
 * `opts`: { mode, count, signupIds (manual), seed, round }. Returns { winners, entrants } or
 * { error } for a request that does not describe a round.
 */
export function selectRound(pending, opts) {
  const entrants = canonicalEntrants(pending);
  const mode = opts.mode;
  if (!MODES.includes(mode)) return { error: 'invalid_mode' };
  if (mode === 'all') return { entrants, winners: entrants };
  if (mode === 'manual') {
    const want = [...new Set(opts.signupIds || [])];
    if (!want.length) return { error: 'nobody_picked' };
    const known = new Set(entrants);
    if (want.some((id) => !known.has(id))) return { error: 'not_a_pending_signup' };
    // Kept in the canonical order, so the record reads the same however the editor clicked.
    return { entrants, winners: entrants.filter((id) => want.includes(id)) };
  }
  const n = Number(opts.count);
  if (!Number.isInteger(n) || n < 1) return { error: 'invalid_count' };
  if (mode === 'first') return { entrants, winners: entrants.slice(0, n) };
  return { entrants, winners: drawWinners(opts.seed, entrants, n, opts.round) };
}

/** The part of a round anyone may read. A draw carries everything needed to recompute it (the
 *  entrants and winners are sign-up ids, which name nobody); the other modes carry counts. */
export function publicRound(r) {
  const base = { round: r.round, mode: r.mode, at: r.at, entrants: (r.entrants || []).length, selected: (r.winners || []).length, entrantsHash: r.entrantsHash, algo: r.algo || null };
  return r.mode === 'draw' ? { ...base, entrantIds: r.entrants || [], winnerIds: r.winners || [] } : base;
}

// ── input ─────────────────────────────────────────────────────────────────────────────────
const when = z.union([z.string().max(40).refine((v) => Number.isFinite(Date.parse(v)), { message: 'not a date' }), z.null()]);
/** An external download: https only, stored for redirecting a selected member, never shown. */
const httpsUrl = z.string().trim().max(1000).refine((v) => {
  try { const u = new URL(v); return u.protocol === 'https:' && !!u.hostname; } catch { return false; }
}, { message: 'must be an https URL' });

export const prereleaseWriteSchema = z.object({
  title: z.string().trim().min(2).max(120),
  titleFr: z.string().trim().max(120).optional(),
  pitch: z.string().trim().max(300).optional(),
  pitchFr: z.string().trim().max(300).optional(),
  body: z.string().max(20_000).optional(),
  bodyFr: z.string().max(20_000).optional(),
  version: z.string().trim().max(40).optional(),
  published: z.boolean().optional(),
  opensAt: when.optional(),
  closesAt: when.optional(),
  capacity: z.number().int().min(1).max(LIMITS.maxCapacity).nullable().optional(),
  mode: z.enum(MODES).optional(),
  selectCount: z.number().int().min(1).max(LIMITS.maxCapacity).nullable().optional(),
  notifyNotSelected: z.boolean().optional(),
  downloadUrl: httpsUrl.nullable().optional(),
  downloadKey: z.string().max(300).nullable().optional(),
  downloadName: z.string().trim().max(160).optional(),
  downloadSize: z.number().int().min(0).max(LIMITS.fileBytes).nullable().optional(),
});
export const prereleasePatchSchema = prereleaseWriteSchema.partial();

export const signupSchema = z.object({ message: z.string().trim().max(LIMITS.message).optional() });

export const selectionSchema = z.object({
  mode: z.enum(MODES),
  count: z.number().int().min(1).max(LIMITS.maxCapacity).optional(),
  signupIds: z.array(z.string().max(40)).max(5000).optional(),
  /** Mark everybody this round leaves out as not selected, and tell them. */
  notifyOthers: z.boolean().optional(),
  /** The entrants the preview was computed over. A draw refuses to run over a different list. */
  entrantsHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
});

/** A stored object key for THIS pre-release's file: the only keys PATCH accepts. */
export const fileKeyPrefix = (id) => `prerelease/${id}/`;
export const isOwnFileKey = (id, key) => typeof key === 'string' && key.startsWith(fileKeyPrefix(id)) && !key.includes('..') && key.length <= 300;

/** The dates a write asks for, checked together. Returns { error } or { opensAt, closesAt }. */
export function windowOf(data, current = {}) {
  const pick = (k) => (data[k] === undefined ? current[k] ?? null : data[k]);
  const opensAt = pick('opensAt') ? new Date(pick('opensAt')) : null;
  const closesAt = pick('closesAt') ? new Date(pick('closesAt')) : null;
  if (opensAt && closesAt && closesAt.getTime() <= opensAt.getTime()) return { error: 'closes_before_opens' };
  return { opensAt, closesAt };
}

// ── output ────────────────────────────────────────────────────────────────────────────────
/** What any reader may know. Never the seed before a round, never the file's key or URL. */
export function serPublic(pr, { project = null, counts = null, now = Date.now() } = {}) {
  const phase = phaseOf(pr, now);
  const draws = Array.isArray(pr.draws) ? pr.draws : [];
  const taken = counts ? (counts.pending || 0) + (counts.selected || 0) + (counts.not_selected || 0) : null;
  return {
    id: pr.id, slug: pr.slug, title: pr.title, titleFr: pr.titleFr || '', pitch: pr.pitch || '', pitchFr: pr.pitchFr || '',
    body: pr.body || '', bodyFr: pr.bodyFr || '', version: pr.version || '', phase, mode: pr.mode,
    opensAt: pr.opensAt, closesAt: pr.closesAt, capacity: pr.capacity ?? null,
    signups: taken, spotsLeft: pr.capacity != null && taken != null ? Math.max(0, pr.capacity - taken) : null,
    project, hasFile: !!(pr.downloadKey || pr.downloadUrl), downloadName: pr.downloadName || '', downloadSize: pr.downloadSize ?? null,
    seedHash: pr.seedHash, seed: draws.length ? pr.seed : null, algo: DRAW_ALGO,
    rounds: draws.map(publicRound), createdAt: pr.createdAt, updatedAt: pr.updatedAt,
  };
}

/** What an editor of the project sees on top: the settings and every round in full. */
export function serManage(pr, opts = {}) {
  return {
    ...serPublic(pr, opts), published: pr.published, selectCount: pr.selectCount ?? null, notifyNotSelected: !!pr.notifyNotSelected,
    downloadKey: pr.downloadKey || null, downloadUrl: pr.downloadUrl || null, selectedAt: pr.selectedAt, closedAt: pr.closedAt,
    target: pr.target, counts: opts.counts || null,
  };
}

/** A member's own sign-up. */
export const serMine = (s) => (s ? { id: s.id, status: s.status, message: s.message || '', createdAt: s.createdAt, decidedAt: s.decidedAt } : null);

/** One sign-up, for the project's editors. No e-mail address: the platform writes to members
 *  itself, and a project editor is not staff. */
export const serSignupForEditor = (s) => ({
  id: s.id, userId: s.userId, name: s.user?.displayName || '', status: s.status, message: s.message || '',
  createdAt: s.createdAt, decidedAt: s.decidedAt, notifiedAt: s.notifiedAt,
});

/** A cell that a spreadsheet will not run: a leading = + - @ (or tab / CR) is neutralised. */
export function csvCell(v) {
  let s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function signupsCsv(rows) {
  const head = ['signup_id', 'member', 'member_id', 'status', 'signed_up_at', 'decided_at', 'message'];
  const lines = rows.map((s) => [s.id, s.user?.displayName || '', s.userId, s.status, s.createdAt, s.decidedAt, s.message].map(csvCell).join(','));
  return `${head.join(',')}\n${lines.join('\n')}${lines.length ? '\n' : ''}`;
}

/** A URL-safe slug: the title's words plus a short random tail (titles repeat across projects). */
export function prereleaseSlug(title) {
  const base = String(title || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'early-access';
  return `${base}-${randomBytes(3).toString('hex')}`;
}
