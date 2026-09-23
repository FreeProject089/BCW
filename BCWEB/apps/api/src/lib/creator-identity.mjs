// Creator key v5, the stateful half: replay refusal, key pinning, fingerprint history, and the
// analysis staff read in the admin fingerprint tool.
//
// creator-proof.mjs checks a token against itself (format, audience, time, chain, signature).
// What it cannot check without memory lives here:
//
//   · REPLAY. A v5 proof names a random nonce; the first use inserts it, a second use inside
//     the proof's two-minute life collides on the primary key and is refused. Stored in the
//     database rather than in memory so two API processes, or one that restarted, agree.
//   · DOWNGRADE and FORK. The first verified v5 proof pins the id to its key. After that a
//     bare v4 proof for the id is refused (the v4 key can be re-derived by anybody who knows
//     the PC's serials, so it must not speak for an upgraded id on its own), and a v5 chain
//     that does not pass through the pinned key is refused as a fork. A LONGER chain through
//     the pinned key is a normal rotation and moves the pin forward.
//   · FINGERPRINTS. Each hashed component is recorded against the id, with a count and first/
//     last seen, so staff can see how stable a machine is and which other ids share it.
//
// Compatibility, in one place: a v4 client is unchanged — its bmmc1 proof verifies exactly as
// before for as long as its id has never been seen with a v5 key. Nothing about a v4 id is
// migrated when it upgrades, because nothing needs to be: the Creator ID is the same string,
// so every CreatorLink, FreeTierClaim, site ban and access-policy entry keyed on it already
// applies to the v5 client. A banned v4 id cannot escape by upgrading; it would have to
// change its NAME, which is a new identity, which is what the fingerprint tool is for.
import { verifyAnyCreatorProof } from './creator-proof.mjs';
import { getBanPolicy } from './siteban.mjs';

/** Fingerprint rows not seen for this long are deleted (see PRIVACY.md / legal.jsx). */
export const FINGERPRINT_RETENTION_DAYS = 180;
export const FP_COMPONENTS = ['board', 'os', 'disk', 'canvas'];

/**
 * How many DIFFERENT values of one component we will ever store for one creator id.
 *
 * A real machine produces one value per component and changes it when the hardware or a
 * driver changes — three or four over a laptop's life. The hashes are asserted by the
 * client, though, and every path that accepts a proof (`/link/upgrade`, `/link/request`)
 * is unauthenticated and takes a self-minted id, so a caller can write a fresh row on
 * every request for as long as it likes. This is the ceiling on that: past it the id's
 * existing rows still tick over, but no new value is recorded and `stabilityOf` reports a
 * machine that never sits still — which is the honest reading of a client sending twenty
 * different board serials.
 */
export const FP_MAX_VALUES_PER_COMPONENT = 8;

/**
 * Above this many DISTINCT creator ids carrying one hash, that hash stops being evidence.
 *
 * Two ways a hash ends up on many ids, and neither is "these are the same person":
 *
 *   · firmware that never had its serials programmed. BMM now refuses to hash a group with
 *     no real serial in it (`creator_v5::is_placeholder`), but rows recorded before that
 *     fix, and any future group that collapses, land on one shared constant;
 *   · deliberate flooding. Minting a creator id costs one ed25519 keygen, so anybody can
 *     register any number of ids all asserting the SAME hash, and drown the one match that
 *     mattered in a list of throwaways.
 *
 * Either way the analyser used to answer with 25 arbitrary ids sorted by a score they all
 * tied on. It now leaves an over-shared hash out of the ranking and SAYS SO, because a
 * moderator reading "shared with 400 ids" reaches the right conclusion and a moderator
 * reading a confident list of 25 strangers does not.
 */
export const FP_SHARED_MAX = 20;

/**
 * Accept a creator proof (v1 or v5) for this server, with memory.
 *
 * Returns `{ ok: true, version, cid, kid, seq, fp, pinned }` or `{ ok: false, error }`, never
 * throws. `record: false` checks without writing a fingerprint (the pin and nonce are still
 * written: a proof that was accepted has been used).
 *
 * Errors: `invalid` (bad token), `replayed`, `upgraded_key_required` (a v4 proof for a pinned
 * id), `key_retired` (a key older than the pinned one), `key_fork` (a v5 chain that skips the
 * pinned key), `unavailable` (the database could not be asked).
 */
export async function acceptCreatorProof(p, token, aud, { now = Math.floor(Date.now() / 1000), record = true } = {}) {
  const v = verifyAnyCreatorProof(token, aud, now);
  if (!v) return { ok: false, error: 'invalid' };

  let pin = null;
  try { pin = await p.creatorKeyPin.findUnique({ where: { creatorId: v.cid } }); } catch { return { ok: false, error: 'unavailable' }; }

  if (v.version === 1) {
    if (pin) return { ok: false, error: 'upgraded_key_required' };
    return { ok: true, version: 1, cid: v.cid, kid: v.cid, seq: 0, fp: {}, pinned: false };
  }

  // A key older than the pinned one has been rotated away, and rotating is what a user does
  // after losing a key: it must stop working. The pinned key must then be in this chain AT the
  // position it was pinned at; anywhere else, or absent, means somebody holding the root
  // started a second chain.
  if (pin && v.seq < pin.seq) return { ok: false, error: 'key_retired' };
  if (pin && v.kids[pin.seq] !== pin.kid) return { ok: false, error: 'key_fork' };

  // Replay: the nonce is burned before anything else is written.
  try {
    await p.creatorProofNonce.create({ data: { nonce: v.nonce, expiresAt: new Date(v.exp * 1000) } });
  } catch (e) {
    if (e?.code === 'P2002') return { ok: false, error: 'replayed' };
    return { ok: false, error: 'unavailable' };
  }

  const at = new Date(now * 1000);
  try {
    if (!pin) {
      // Racing first proofs for one id: the second create loses on the primary key; re-read
      // and apply the fork rule to whoever won.
      try {
        await p.creatorKeyPin.create({ data: { creatorId: v.cid, kid: v.kid, seq: v.seq, firstSeenAt: at, lastSeenAt: at } });
      } catch (e) {
        if (e?.code !== 'P2002') throw e;
        const won = await p.creatorKeyPin.findUnique({ where: { creatorId: v.cid } });
        if (!won || v.kids[won.seq] !== won.kid) return { ok: false, error: 'key_fork' };
      }
    } else {
      await p.creatorKeyPin.update({ where: { creatorId: v.cid }, data: v.seq > pin.seq ? { kid: v.kid, seq: v.seq, lastSeenAt: at } : { lastSeenAt: at } });
    }
  } catch { return { ok: false, error: 'unavailable' }; }

  if (record) await recordFingerprint(p, v.cid, v.fp, at);
  return { ok: true, version: 5, cid: v.cid, kid: v.kid, seq: v.seq, fp: v.fp, pinned: true };
}

/**
 * The rule for an endpoint where a client ASSERTS a creator id (the pairing code request):
 *
 *   · a proof, if sent, must be accepted and must name that same id;
 *   · no proof is fine for an id that has never been seen with a v5 key (every v4 client,
 *     unchanged), and refused (`proof_required`) for one that has: the bare id of an upgraded
 *     install is exactly what somebody else would send to claim it.
 */
export async function creatorProofGate(p, claimedId, proof, aud, opts = {}) {
  const claimed = String(claimedId || '').trim().toLowerCase();
  if (proof) {
    const r = await acceptCreatorProof(p, proof, aud, opts);
    if (!r.ok) return r;
    if (r.cid !== claimed) return { ok: false, error: 'proof_mismatch' };
    return r;
  }
  let pin = null;
  try { pin = await p.creatorKeyPin.findUnique({ where: { creatorId: claimed } }); } catch { return { ok: false, error: 'unavailable' }; }
  if (pin) return { ok: false, error: 'proof_required' };
  return { ok: true, version: null, cid: claimed, pinned: false };
}

/**
 * Upsert each hashed component. Best-effort: a failure here never fails the request.
 *
 * A KNOWN value is always updated, however many an id has — refusing to tick over a hash
 * we already hold would only blind the stability score. A NEW value is refused once the id
 * is at FP_MAX_VALUES_PER_COMPONENT, which is what stops an unauthenticated caller with a
 * self-minted id writing rows for ever.
 */
export async function recordFingerprint(p, cid, fp, at = new Date()) {
  for (const component of FP_COMPONENTS) {
    const hash = fp?.[component];
    if (!hash) continue;
    try {
      const known = await p.creatorFingerprint.findUnique({
        where: { creatorId_component_hash: { creatorId: cid, component, hash } },
        select: { id: true },
      });
      if (known) {
        await p.creatorFingerprint.update({ where: { id: known.id }, data: { count: { increment: 1 }, lastSeenAt: at } });
        continue;
      }
      if (await p.creatorFingerprint.count({ where: { creatorId: cid, component } }) >= FP_MAX_VALUES_PER_COMPONENT) continue;
      await p.creatorFingerprint.create({ data: { creatorId: cid, component, hash, firstSeenAt: at, lastSeenAt: at } })
        .catch((e) => { if (e?.code !== 'P2002') throw e; }); // raced with another proof for the same id
    } catch { /* the proof was accepted; the history is a convenience */ }
  }
}

/** Retention: expired nonces, and fingerprint rows not seen for FINGERPRINT_RETENTION_DAYS. */
export async function pruneCreatorIdentity(p, now = new Date()) {
  const out = { nonces: 0, fingerprints: 0 };
  try { out.nonces = (await p.creatorProofNonce.deleteMany({ where: { expiresAt: { lt: now } } })).count; } catch { /* next sweep */ }
  try {
    const cutoff = new Date(now.getTime() - FINGERPRINT_RETENTION_DAYS * 864e5);
    out.fingerprints = (await p.creatorFingerprint.deleteMany({ where: { lastSeenAt: { lt: cutoff } } })).count;
  } catch { /* next sweep */ }
  return out;
}

/**
 * How stable an id's machine is, per component: the share of sightings its most frequent
 * hash accounts for. 1 = one value ever; 0.5 = two values seen equally often. `overall` is
 * the mean over the components that were seen at all — canvas included, but as one of four,
 * because a GPU driver update changes it and nothing else.
 */
export function stabilityOf(rows) {
  const per = {};
  for (const c of FP_COMPONENTS) {
    const mine = rows.filter((r) => r.component === c);
    if (!mine.length) continue;
    const total = mine.reduce((s, r) => s + (r.count || 1), 0);
    const top = Math.max(...mine.map((r) => r.count || 1));
    per[c] = { values: mine.length, sightings: total, score: total ? Math.round((top / total) * 100) / 100 : 0 };
  }
  const scores = Object.values(per).map((x) => x.score);
  return { perComponent: per, overall: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : null };
}

/** Is `cid` on the site ban list or the global repo access ban list? */
async function banStateOf(p, cid) {
  const out = { site: null, repos: false };
  try {
    const pol = await getBanPolicy(p);
    const e = (pol.creators || []).find((x) => String(x.v).toLowerCase() === cid);
    if (e) out.site = { note: e.note || '', until: e.until || null };
  } catch { /* unreadable: reported as not banned, with the rest */ }
  try {
    const g = await p.globalAccessPolicy.findUnique({ where: { id: 'global' }, select: { bannedKeys: true } });
    out.repos = !!g?.bannedKeys?.some((k) => String(k).toLowerCase() === cid);
  } catch { /* no policy row */ }
  return out;
}

/**
 * Everything the admin fingerprint tool shows about one id.
 *
 * `canSeeBans` gates the ban sections: the ban list is manage_sanctions' data, and a
 * moderator holding only manage_users must not read it through this side door. Linked
 * accounts show what the users list already shows that role (id, display name, status),
 * never an e-mail or an IP. Fingerprints are shown as the salted hashes they are.
 */
export async function creatorAnalysis(p, cid, { canSeeBans = false, similarLimit = 25 } = {}) {
  const id = String(cid || '').toLowerCase();
  const [pin, link, claims, fps] = await Promise.all([
    p.creatorKeyPin.findUnique({ where: { creatorId: id } }),
    p.creatorLink.findUnique({ where: { creatorId: id }, include: { user: { select: { id: true, displayName: true, status: true } } } }),
    p.freeTierClaim.findMany({ where: { creatorId: id }, select: { kind: true, createdAt: true } }),
    p.creatorFingerprint.findMany({ where: { creatorId: id }, orderBy: [{ component: 'asc' }, { lastSeenAt: 'desc' }] }),
  ]);

  // How WIDELY each of this id's hashes is shared, before anything is read as evidence.
  //
  // This count is the difference between "these two machines are the same box" and "these
  // four hundred people have the same CPU". It is asked first, per hash, over the whole
  // table — not inferred from a page of results — and a hash above FP_SHARED_MAX is left
  // out of the matching below and reported as `overshared` instead. A `take: 500` over an
  // unranked set used to decide this silently and arbitrarily: 501 ids tie on the same
  // score, twenty-five of them are printed, and the one that mattered may not be among
  // them. See FP_SHARED_MAX for the two ways a hash gets that wide.
  const shareCounts = new Map(); // `${component}:${hash}` -> ids carrying it, this id included
  if (fps.length) {
    const grouped = await p.creatorFingerprint.groupBy({
      by: ['component', 'hash'],
      where: { OR: fps.map((r) => ({ component: r.component, hash: r.hash })) },
      _count: { creatorId: true },
    }).catch(() => []);
    for (const g of grouped) shareCounts.set(`${g.component}:${g.hash}`, g._count.creatorId);
  }
  const shareOf = (r) => shareCounts.get(`${r.component}:${r.hash}`) || 1;
  const discriminating = fps.filter((r) => shareOf(r) <= FP_SHARED_MAX);
  const overshared = fps.filter((r) => shareOf(r) > FP_SHARED_MAX)
    .map((r) => ({ component: r.component, hash: r.hash, ids: shareOf(r) }));

  // Other ids that presented one of this id's hashes. Matching on the same component only:
  // a board hash equal to a canvas hash would be a coincidence of formats, not of machines.
  const matches = new Map();
  if (discriminating.length) {
    const others = await p.creatorFingerprint.findMany({
      where: { creatorId: { not: id }, OR: discriminating.map((r) => ({ component: r.component, hash: r.hash })) },
      select: { creatorId: true, component: true, lastSeenAt: true },
      // Bounded by FP_SHARED_MAX per hash now, not by an arbitrary page: at most
      // FP_SHARED_MAX ids can match each of the id's own rows.
      take: FP_SHARED_MAX * FP_MAX_VALUES_PER_COMPONENT * FP_COMPONENTS.length,
    });
    for (const o of others) {
      const m = matches.get(o.creatorId) || { creatorId: o.creatorId, components: new Set(), lastSeenAt: o.lastSeenAt };
      m.components.add(o.component);
      if (o.lastSeenAt > m.lastSeenAt) m.lastSeenAt = o.lastSeenAt;
      matches.set(o.creatorId, m);
    }
  }
  // Strongest first: sharing the board is stronger than sharing a canvas, and more shared
  // components is stronger than fewer.
  const weight = { board: 4, os: 3, disk: 2, canvas: 1 };
  const similar = [...matches.values()]
    .map((m) => ({ ...m, components: [...m.components], score: [...m.components].reduce((s, c) => s + (weight[c] || 0), 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, similarLimit);
  if (similar.length) {
    const ids = similar.map((s) => s.creatorId);
    const links = await p.creatorLink.findMany({ where: { creatorId: { in: ids } }, select: { creatorId: true, user: { select: { id: true, displayName: true } } } });
    const byId = new Map(links.map((l) => [l.creatorId, l.user]));
    for (const s of similar) {
      s.account = byId.get(s.creatorId) || null;
      if (canSeeBans) s.bans = await banStateOf(p, s.creatorId);
    }
  }

  const seen = [pin?.firstSeenAt, pin?.lastSeenAt, link?.linkedAt, ...fps.flatMap((r) => [r.firstSeenAt, r.lastSeenAt])].filter(Boolean).map((d) => new Date(d).getTime());
  return {
    cid: id,
    version: pin ? 5 : null,
    key: pin ? { kid: pin.kid, seq: pin.seq, pinnedAt: pin.firstSeenAt, lastSeenAt: pin.lastSeenAt } : null,
    firstSeen: seen.length ? new Date(Math.min(...seen)) : null,
    lastSeen: seen.length ? new Date(Math.max(...seen)) : null,
    account: link ? { id: link.user.id, displayName: link.user.displayName, status: link.user.status, linkedAt: link.linkedAt } : null,
    claims,
    bans: canSeeBans ? await banStateOf(p, id) : undefined,
    fingerprints: fps.map((r) => ({
      component: r.component, hash: r.hash, count: r.count,
      firstSeenAt: r.firstSeenAt, lastSeenAt: r.lastSeenAt,
      // Shown beside every hash, not only the excluded ones: "1" is what makes the rest of
      // this page mean anything, and it is the number a moderator needs before acting.
      sharedWithIds: shareOf(r), discriminating: shareOf(r) <= FP_SHARED_MAX,
    })),
    // Hashes too widely shared to be evidence, left out of `similar` on purpose.
    overshared,
    stability: stabilityOf(fps),
    similar,
  };
}

