// Rights notices and protected works — the rules, with no database in them.
//
// What a rights-holder notice has to contain is fixed by the regimes the legal page names:
// DSA Art. 16 (why, exactly where, who, good faith), LCEN 6-I-5 (the notifier, the facts, the
// legal basis), and Swiss CopA 39d — which is the interesting one for a hosting provider,
// because it asks us to PREVENT THE SAME WORK COMING BACK once we have been told about it.
// That "stay-down" duty is what the protected-works registry exists for: a work an admin has
// registered (by file hash, by name pattern, by the address it was taken from) is matched
// against every file that lands and every listing that is created, and a hit lands in the
// same queue as a notice, before anybody has to complain a second time.
//
// Everything here is pure: normalisation, matching, strike counting. The route persists.

export const NOTICE_KINDS = ['copyright', 'trademark', 'privacy', 'illegal', 'other'];
export const NOTICE_STATUSES = ['new', 'reviewing', 'actioned', 'rejected', 'countered', 'restored', 'closed'];
export const TARGET_TYPES = ['repo', 'catalog', 'item', 'user', 'url'];
export const BASIS = ['owner', 'licensee', 'agent'];

const s = (v, n) => String(v ?? '').trim().slice(0, n);

/**
 * A notice as the form sends it, reduced to what the record keeps. Returns the clean shape or
 * `{ error }` naming the first thing that is missing — the four DSA elements plus the two
 * statements are REQUIRED, because a notice without them does not give us actual knowledge
 * and therefore does not start any clock; accepting one and calling it a notice would be
 * lying to the sender about what they had achieved.
 */
export function normalizeNotice(raw, { requireStatements = true } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const kind = NOTICE_KINDS.includes(r.kind) ? r.kind : 'copyright';
  const targets = normalizeTargets(r.targets);
  if (!targets.length) return { error: 'no_target' };
  const explanation = s(r.explanation, 6000);
  if (explanation.length < 20) return { error: 'explanation_short' };
  const name = s(r.name, 120);
  const email = s(r.email, 254).toLowerCase();
  if (!name) return { error: 'name_required' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'email_invalid' };
  if (requireStatements) {
    if (r.goodFaith !== true) return { error: 'good_faith_required' };
    if (r.accurate !== true) return { error: 'accuracy_required' };
    if (s(r.signature, 120).length < 2) return { error: 'signature_required' };
  }
  const work = {
    title: s(r.work?.title, 300),
    urls: uniq((Array.isArray(r.work?.urls) ? r.work.urls : String(r.work?.urls || '').split(/\s+/)).map((u) => s(u, 500)).filter(isHttp)).slice(0, 20),
    basis: BASIS.includes(r.work?.basis) ? r.work.basis : 'owner',
    basisText: s(r.work?.basisText, 2000),
    hashes: uniq((Array.isArray(r.work?.hashes) ? r.work.hashes : String(r.work?.hashes || '').split(/[\s,]+/)).map(normHash).filter(Boolean)).slice(0, 200),
  };
  // A copyright claim names a work; a privacy or an illegal-content report does not have one.
  if (kind === 'copyright' && !work.title && !work.urls.length) return { error: 'work_required' };
  return {
    kind, targets, explanation, work,
    name, email,
    org: s(r.org, 160),
    onBehalfOf: BASIS.includes(r.onBehalfOf) ? r.onBehalfOf : (kind === 'copyright' ? work.basis : 'owner'),
    address: s(r.address, 400),
    country: s(r.country, 2).toUpperCase(),
    phone: s(r.phone, 40),
    goodFaith: r.goodFaith === true,
    accurate: r.accurate === true,
    signature: s(r.signature, 120),
  };
}

/**
 * The targets, precisely. Each names a thing on this service (a repo, a catalogue, an item,
 * an account — or a bare URL when the sender could not tell which), and inside a repo or a
 * catalogue the FILES or ITEMS concerned, so a takedown can be as narrow as the claim.
 */
export function normalizeTargets(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const t of list.slice(0, 20)) {
    if (!t || typeof t !== 'object') continue;
    const type = TARGET_TYPES.includes(t.type) ? t.type : (isHttp(t.url) ? 'url' : null);
    if (!type) continue;
    const o = { type, id: s(t.id, 80), label: s(t.label, 200), url: isHttp(t.url) ? s(t.url, 500) : '', note: s(t.note, 1000) };
    o.files = uniq((Array.isArray(t.files) ? t.files : []).map((f) => s(f, 300)).filter(Boolean)).slice(0, 200);
    if (type !== 'url' && !o.id) continue;
    if (type === 'url' && !o.url) continue;
    out.push(o);
  }
  return out;
}

const isHttp = (u) => /^https?:\/\/\S+$/i.test(String(u || ''));
const uniq = (a) => [...new Set(a)];
const normHash = (h) => { const x = String(h || '').trim().toLowerCase().replace(/^sha256:/, ''); return /^[0-9a-f]{64}$/.test(x) ? x : ''; };

/** A protected work as the registry keeps it. */
export function normalizeWork(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const title = s(r.title, 300);
  if (!title) return { error: 'title_required' };
  const patterns = uniq((Array.isArray(r.patterns) ? r.patterns : String(r.patterns || '').split(/\n+/)).map((x) => s(x, 200)).filter(Boolean)).slice(0, 50);
  // A pattern that does not compile matches nothing forever and nobody is told; better to
  // refuse it at the door with its own error than to store a rule that never fires.
  for (const pat of patterns) { try { new RegExp(pat, 'i'); } catch { return { error: 'pattern_invalid', pattern: pat }; } }
  return {
    title,
    owner: s(r.owner, 200),
    contact: s(r.contact, 254),
    urls: uniq((Array.isArray(r.urls) ? r.urls : String(r.urls || '').split(/\s+/)).map((u) => s(u, 500)).filter(isHttp)).slice(0, 50),
    hashes: uniq((Array.isArray(r.hashes) ? r.hashes : String(r.hashes || '').split(/[\s,]+/)).map(normHash).filter(Boolean)).slice(0, 2000),
    patterns,
    notes: s(r.notes, 4000),
    active: r.active !== false,
  };
}

/**
 * Does this thing look like a registered work?
 *
 * Three signals, from strongest to weakest, and the answer says which one fired — a hash is
 * the work itself; a pattern on a name is a guess that a human has to confirm; a URL is the
 * listing pointing at the place the work was taken from.
 *
 *   thing = { sha256?, name?, path?, urls? }
 *
 * Returns [{ work, via: 'hash'|'pattern'|'url', detail }] — every work that matched, so a
 * file that is both hashed and named lands one row per reason rather than one per work.
 */
export function matchWorks(thing, works) {
  const out = [];
  const sha = normHash(thing?.sha256);
  const names = [thing?.name, thing?.path].map((x) => String(x || '')).filter(Boolean);
  const urls = (Array.isArray(thing?.urls) ? thing.urls : []).map((u) => String(u || '').toLowerCase());
  for (const w of works || []) {
    if (!w || w.active === false) continue;
    if (sha && (w.hashes || []).includes(sha)) { out.push({ work: w, via: 'hash', detail: sha }); continue; }
    let hit = null;
    for (const pat of w.patterns || []) {
      let re; try { re = new RegExp(pat, 'i'); } catch { continue; }
      const n = names.find((x) => re.test(x));
      if (n) { hit = { via: 'pattern', detail: `${pat} ~ ${n}` }; break; }
    }
    if (!hit && urls.length) {
      for (const wu of w.urls || []) {
        const base = String(wu).toLowerCase().replace(/\/+$/, '');
        const u = urls.find((x) => x === base || x.startsWith(`${base}/`));
        if (u) { hit = { via: 'url', detail: u }; break; }
      }
    }
    if (hit) out.push({ work: w, ...hit });
  }
  return out;
}

/**
 * Strikes: how many notices have been ACTIONED against one account's content, and whether
 * that crosses the configured line. A repeat-infringer rule is only a rule if it is counted
 * somewhere; this is where.
 */
export function strikeStatus(actionedNotices, { threshold = 3, windowDays = 365, now = Date.now() } = {}) {
  const since = now - Math.max(1, windowDays) * 86_400_000;
  const recent = (actionedNotices || []).filter((n) => {
    const t = new Date(n.decisionAt || n.createdAt || 0).getTime();
    return Number.isFinite(t) && t >= since;
  });
  const th = Math.max(1, Math.floor(Number(threshold) || 3));
  return { strikes: recent.length, threshold: th, over: recent.length >= th, windowDays };
}

/** NTC-XXXX-XXXX, the same alphabet the sanctions use, so a code is never mistaken for a word. */
export function noticeCode(bytes) {
  const A = 'ABCDEFGHJKLMNPQRSTVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += A[bytes[i] % A.length];
  return `NTC-${out.slice(0, 4)}-${out.slice(4, 8)}`;
}
