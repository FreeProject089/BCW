import { z } from 'zod';
import { ipOf } from '../lib/client-ip.mjs';
import crypto from 'node:crypto';
import { db, requireRole, notify, hashApiKey, safeEqual, ownedContent } from '../lib/lib.mjs';
import { boundedSet } from '../lib/boundedmap.mjs';
import { mergeShadowEconomy } from '../lib/economy-curve.mjs';
import { genKey, prefixOf } from './api-keys.mjs';
import { grantAutoBadges } from './social.mjs';
import { expectedProofAudience } from '../lib/creator-proof.mjs';
import { acceptCreatorProof, creatorProofGate } from '../lib/creator-identity.mjs';
import { ciEquals } from '../lib/ci-equals.mjs';

// Human-friendly pairing code (no ambiguous chars): e.g. "K7P3-9QMX".
function genCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = (n) => Array.from({ length: n }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  return `${pick(4)}-${pick(4)}`;
}

// ── The pairing-code request limit (per creator id, per IP) ─────────────────────────────
//
// RESIDUAL RISK, recorded deliberately. For a v4 creator id never seen with a v5 key there is
// nothing to check a requester against, so ANYONE may still ask for a pairing code for SOMEONE
// ELSE's id and will be shown the code. That is kept on purpose for compatibility with clients
// that have no v5 key (decision by the owner). The attack it leaves open is: guess or harvest a
// creator id, request its code, and link it to your own account before its real owner does —
// but only while the id is UNLINKED and UNPINNED (`creatorProofGate` refuses an id that has a
// key pin, and an already-linked id returns `{linked:true}` with no code).
//
// What this limit adds is the cost of doing it at scale: creator ids are opaque, so the attack
// needs enumeration, and enumeration is what is now capped — per id, and per client IP, in a
// fixed window. It does NOT make a targeted attempt against one known id impossible. The fix
// for that is a v5 key on the id, which is exactly what `/link/upgrade` is for.
//
// The per-id count is only charged to UNPROVEN (v4) requests: an id that proved ownership must
// never be locked out of its own pairing by a stranger burning its budget. The per-IP count is
// charged to everybody — a proven caller has no reason to ask hundreds of times.
//
// In-process and per-replica (like the account limiter in server.mjs): an attacker behind many
// IPs across many replicas is not what this stops. Bounded so it cannot grow under a flood.
export const LINK_REQUEST_WINDOW_MS = 10 * 60_000;
export const LINK_REQUEST_MAX_PER_ID = 5;   // unproven asks for ONE id
export const LINK_REQUEST_MAX_PER_IP = 30;  // ids asked for by ONE address
const linkHits = new Map(); // key -> { at, n }

/** Charge one request against `key`. Returns { ok } or { ok:false, retryAfterSec }. */
export function hitLinkLimit(key, max, now = Date.now(), map = linkHits) {
  const rec = map.get(key);
  if (!rec || now - rec.at >= LINK_REQUEST_WINDOW_MS) {
    boundedSet(map, key, { at: now, n: 1 }, 20_000, LINK_REQUEST_WINDOW_MS);
    return { ok: true, remaining: max - 1 };
  }
  rec.n += 1;
  if (rec.n > max) return { ok: false, retryAfterSec: Math.ceil((LINK_REQUEST_WINDOW_MS - (now - rec.at)) / 1000) };
  return { ok: true, remaining: max - rec.n };
}

/** The real client IP — the last X-Forwarded-For hop Caddy appends, as server.mjs does. */
const linkClientIp = (req) => ipOf(req, '0.0.0.0');

// Account ↔ BMM creator-id linking. Local-first: BMM keeps working offline; only
// when the user chooses to link does the server learn the account↔creator mapping.
export default async function linkRoutes(app) {
  // ── BMM side (no website login): request a pairing code for a creator id ──
  // Rate-limited so a code can't be brute-forced or spammed.
  app.post('/link/request', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = z.object({ creatorId: z.string().min(1).max(120), creatorName: z.string().max(120).optional(), proof: z.string().max(8192).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    // Whoever requests the code for an id is whoever sees the code, so an id that has been
    // seen with a v5 key must PROVE it here (lib/creator-identity.mjs). A v4 client sends no
    // proof and is answered exactly as before.
    // Per-IP first (it costs nothing and is charged to every caller).
    const ipHit = hitLinkLimit(`ip:${linkClientIp(req)}`, LINK_REQUEST_MAX_PER_IP);
    if (!ipHit.ok) return reply.code(429).send({ error: 'rate_limited', retryAfterSec: ipHit.retryAfterSec });
    const gate = await creatorProofGate(p, b.data.creatorId, b.data.proof, expectedProofAudience());
    if (!gate.ok) return reply.code(gate.error === 'unavailable' ? 503 : 403).send({ error: gate.error });
    // Per-id, unproven callers only — see LINK_REQUEST_* above for the risk this caps and the
    // one it does not.
    if (!gate.version) {
      const idHit = hitLinkLimit(`id:${String(b.data.creatorId).trim().toLowerCase()}`, LINK_REQUEST_MAX_PER_ID);
      if (!idHit.ok) return reply.code(429).send({ error: 'rate_limited', retryAfterSec: idHit.retryAfterSec });
    }
    // Already linked? Tell BMM so it can show "already linked" instead of a code.
    //
    // Case-INSENSITIVELY, because the v5 gate above is: `creatorProofGate` lowercases the id
    // before it looks for a key pin, and `acceptCreatorProof` pins the lowercased id. A
    // creator id is the hex of an ed25519 public key and BMM writes it in lower case, so the
    // two spellings are the same identity — but this lookup was exact, and `findUnique` on a
    // case-sensitive text column answered "nobody" for the upper-case spelling of an id that
    // is already somebody's. That handed out a pairing code for a LINKED id, and
    // `/me/creator-links` (also exact) then created a second CreatorLink for one identity,
    // against the rule this endpoint states two lines below.
    const existing = await p.creatorLink.findFirst({ where: { creatorId: ciEquals(b.data.creatorId) } });
    if (existing) return { linked: true };
    // One active code per creator id at a time.
    await p.linkCode.deleteMany({ where: { creatorId: b.data.creatorId } });
    let code; for (let i = 0; i < 5; i++) { code = genCode(); if (!(await p.linkCode.findUnique({ where: { code } }))) break; }
    const expiresAt = new Date(Date.now() + 15 * 60e3); // 15 min
    await p.linkCode.create({ data: { code, creatorId: b.data.creatorId, displayName: b.data.creatorName || null, expiresAt } });
    return { code, expiresAt, linked: false };
  });

  // ── BMM side: register this creator id's v5 key (creator key v5) ──
  // BMM sends one proof once per active key, for a LINKED install. Accepting it pins the id
  // to its key: from then on a bare v4 proof for the id, or a v5 chain that forks from this
  // one, is refused. Nothing about the id itself changes: links, claims and bans are keyed on
  // the Creator ID, which v5 keeps, so they apply to the upgraded client as they are.
  app.post('/link/upgrade', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = z.object({ proof: z.string().min(10).max(8192) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!b.data.proof.startsWith('bmmc5.')) return reply.code(400).send({ error: 'v5_proof_required' });
    const p = await db();
    const r = await acceptCreatorProof(p, b.data.proof, expectedProofAudience());
    if (!r.ok) return reply.code(r.error === 'unavailable' ? 503 : 403).send({ error: r.error });
    const linked = !!(await p.creatorLink.findUnique({ where: { creatorId: r.cid }, select: { id: true } }).catch(() => null));
    return { ok: true, cid: r.cid, kid: r.kid, seq: r.seq, linked };
  });

  // ── BMM side: is this creator id currently linked? (drives unlink detection) ──
  app.get('/link/status', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const creatorId = String(req.query?.creatorId || '').trim();
    if (!creatorId) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const link = await p.creatorLink.findUnique({
      where: { creatorId },
      include: { user: { select: { displayName: true, discordLinks: { select: { username: true, discordId: true }, take: 1 } } } },
    });
    if (!link) return { linked: false };
    const d = link.user.discordLinks[0];
    return { linked: true, displayName: link.user.displayName, discord: d ? { linked: true, username: d.username || null } : { linked: false } };
  });

  // ── BMM side: link a Discord account to the account tied to this creator id ──
  // The user runs /link in Discord (bot issues a code) then enters it in BMM.
  app.post('/link/discord', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = z.object({ creatorId: z.string().min(1).max(120), code: z.string().min(4).max(20) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const link = await p.creatorLink.findUnique({ where: { creatorId: b.data.creatorId } });
    if (!link) return reply.code(409).send({ error: 'account_not_linked' }); // link the account first
    const raw = b.data.code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const code = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4, 8)}` : raw;
    const row = await p.discordLinkCode.findUnique({ where: { code } });
    if (!row || row.expiresAt < new Date()) return reply.code(400).send({ error: 'invalid_or_expired' });
    if (await p.discordLink.findUnique({ where: { discordId: row.discordId } })) {
      await p.discordLinkCode.delete({ where: { id: row.id } }).catch(() => {});
      return reply.code(409).send({ error: 'already_linked' });
    }
    const dl = await p.discordLink.create({ data: { userId: link.userId, discordId: row.discordId, username: row.username } });
    mergeShadowEconomy(p, row.discordId, link.userId, ((await p.adminSetting.findUnique({ where: { key: 'bot.config' } }))?.value || {}).economy || {}).catch(() => {});
    grantAutoBadges(p, { event: 'discord', user: { id: link.userId } }).catch(() => {});
    await p.discordLinkCode.delete({ where: { id: row.id } }).catch(() => {});
    await notify(p, link.userId, 'discord_linked', `Discord account ${dl.username || dl.discordId} was linked (via BMM).`);
    return { ok: true, username: dl.username || null };
  });

  // ── Server-to-server: resolve creator ids → linked accounts (for BMM telemetry) ──
  // Protected by a shared secret so only trusted backends (the telemetry dashboard) can call it.
  app.post('/link/lookup', async (req, reply) => {
    const secret = process.env.LINK_LOOKUP_SECRET || process.env.JWT_SECRET;
    // safeEqual, not `!==`. A string comparison returns at the first differing byte, so
    // it leaks the length of the matching prefix — and this endpoint hands back
    // creator-id -> account joins with Discord ids and display names attached.
    if (!secret || !safeEqual(req.headers['x-link-secret'] || '', secret)) return reply.code(401).send({ error: 'unauthorized' });
    const b = z.object({ creatorIds: z.array(z.string().max(120)).min(1).max(1000) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const links = await p.creatorLink.findMany({
      where: { creatorId: { in: b.data.creatorIds } },
      include: { user: { select: { id: true, displayName: true, discordLinks: { select: { discordId: true, username: true, linkedAt: true } } } } },
    });
    // Pull Discord activity for all linked Discord ids in one query.
    const discordIds = links.flatMap((l) => l.user.discordLinks.map((d) => d.discordId));
    const activity = discordIds.length
      ? Object.fromEntries((await p.discordActivity.findMany({ where: { discordId: { in: discordIds } } })).map((a) => [a.discordId, a]))
      : {};
    const accounts = {};
    for (const l of links) {
      const d = l.user.discordLinks[0]; // one Discord per account (first)
      const a = d ? activity[d.discordId] : null;
      accounts[l.creatorId] = {
        accountId: l.userId,
        displayName: l.user.displayName,
        discord: d ? {
          id: d.discordId, username: (a?.username) || d.username, avatar: a?.avatar || null, linkedAt: d.linkedAt,
          guildJoinedAt: a?.guildJoinedAt || null, lastMessageAt: a?.lastMessageAt || null,
          lastVoiceJoinAt: a?.lastVoiceJoinAt || null, lastVoiceCreateAt: a?.lastVoiceCreateAt || null,
        } : null,
      };
    }
    return { accounts };
  });

  /**
   * What this account still has published under its creator identity.
   *
   * Unlinking a creator id while repos or catalogs exist is a way to lock yourself out of
   * your own content and not find out for weeks: BMM authenticates to a repo with the
   * `X-Creator-ID` header, and both the per-repo whitelist and the site-wide access policy
   * hold creator ids. Drop the link and those entries stop matching — the repo is still
   * there, still billed, and its owner is refused by their own allow-list.
   *
   * So the count is computed in one place and used twice: to disable the control, and to
   * refuse the request if it is called anyway.
   */
  const publishedUnderIdentity = async (p, userId) => {
    const c = await ownedContent(p, userId);
    // Everything BMM can reach while holding an `X-Creator-ID` header. Pools and
    // subscriptions are money, not identity, so they are not in this sum — they block
    // closing an account, which is a different question with a different answer.
    return { repos: c.repos, catalogs: c.catalogs, items: c.items,
             total: c.repos + c.catalogs + c.items };
  };

  // ── Website side (logged in): list / redeem / unlink creator ids ──
  app.get('/me/creator-links', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const links = await p.creatorLink.findMany({ where: { userId: req.user.uid }, orderBy: { linkedAt: 'desc' } });
    const now = Date.now();
    // Sent whether or not anything is blocked: a control that refuses on click without
    // having said it would reads as a bug, and the numbers are what makes the reason
    // actionable ("2 repos, 1 catalog") rather than a rule the user has to take on faith.
    const hosting = await publishedUnderIdentity(p, req.user.uid);
    return {
      hosting,
      links: links.map((l) => ({
        id: l.id, creatorId: l.creatorId, displayName: l.displayName,
        linkedAt: l.linkedAt, unlinkableAt: l.unlinkableAt,
        locked: new Date(l.unlinkableAt).getTime() > now,
        blockedByContent: hosting.total > 0,
      })),
    };
  });

  app.post('/me/creator-links', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ code: z.string().min(4).max(20) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    // Normalize: strip any separators the user typed → canonical XXXX-XXXX.
    const raw = b.data.code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const code = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
    const p = await db();
    const pending = await p.linkCode.findUnique({ where: { code } });
    if (!pending || pending.expiresAt < new Date()) return reply.code(400).send({ error: 'invalid_or_expired' });
    // One creator id ↔ one account. Case-insensitively: see /link/request. A code minted
    // before that check existed must not still land here and make two links out of one id.
    if (await p.creatorLink.findFirst({ where: { creatorId: ciEquals(pending.creatorId) } })) {
      await p.linkCode.delete({ where: { id: pending.id } }).catch(() => {});
      return reply.code(409).send({ error: 'already_linked' });
    }
    const link = await p.creatorLink.create({ data: {
      userId: req.user.uid, creatorId: pending.creatorId, displayName: pending.displayName,
      linkedAt: new Date(), unlinkableAt: new Date(Date.now() + 14 * 864e5), // 2-week lock
    } });
    await p.linkCode.delete({ where: { id: pending.id } }).catch(() => {});
    await notify(p, req.user.uid, 'creator_linked', `Creator id "${link.creatorId}" is now linked to your account.`);

    // Mint a read-only notifications key and hand it back ONCE, here.
    //
    // BMM has to present a credential to read this account's notifications, and the
    // creator id is not one — it is an identifier the user deliberately hands to repo
    // owners for whitelisting, so anything it unlocked would be unlocked for them too.
    // A key is the right shape; making the user go and create one by hand right after
    // they finished linking is a second chore for the same intent.
    //
    // Returned in THIS response on purpose. This route is authenticated and answers
    // the account owner's own browser session, so the secret goes nowhere the owner is
    // not already. Passing it through the unauthenticated /link/status poll instead
    // would have handed it to everyone holding the creator id — precisely the people
    // it must be kept from.
    //
    // Non-fatal: if key creation fails the link still succeeded, and the user can
    // create a key by hand. Losing an account link over a convenience would be a bad
    // trade, so this cannot throw out of the handler.
    let notifKey = null;
    try {
      const live = await p.apiKey.count({ where: { userId: req.user.uid, revokedAt: null } });
      if (live < 20) {
        const secret = genKey();
        await p.apiKey.create({ data: {
          userId: req.user.uid,
          label: 'BMM notifications',
          prefix: prefixOf(secret),
          hash: hashApiKey(secret),
          scopes: ['notifications:read'],
        } });
        notifKey = secret;
      }
    } catch { /* the link is what mattered */ }

    return {
      link: { id: link.id, creatorId: link.creatorId, displayName: link.displayName, linkedAt: link.linkedAt, unlinkableAt: link.unlinkableAt, locked: true },
      // Shown once and never retrievable again — the hash is all the server keeps.
      notifKey,
    };
  });

  // A notifications key for an account that is ALREADY linked.
  //
  // Minting one at link time only helps people who link from now on. Everyone already
  // linked would have had to create a key by hand — or unlink and relink, which the
  // two-week `unlinkableAt` lock makes impossible anyway. A feature that only works
  // for new users is half a feature.
  //
  // Deliberately not idempotent in the "return the same key" sense: the server keeps
  // only the hash, so an existing key cannot be shown again. Asking again mints a new
  // one and the old is left alone — revoking it is the owner's call, and silently
  // killing a key that something else might be using is not a decision to make on
  // their behalf.
  app.post('/me/notifications-key', { preHandler: requireRole(), config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) => {
    const p = await db();
    const live = await p.apiKey.count({ where: { userId: req.user.uid, revokedAt: null } });
    if (live >= 20) return reply.code(409).send({ error: 'too_many_keys', max: 20 });
    const secret = genKey();
    await p.apiKey.create({ data: {
      userId: req.user.uid,
      label: 'BMM notifications',
      prefix: prefixOf(secret),
      hash: hashApiKey(secret),
      scopes: ['notifications:read'],
    } });
    // Shown once; the hash is all that is kept.
    return { secret };
  });

  // The owner of a linked id forgets its v5 key pin, after losing the key store (a wiped
  // data folder AND registry). The next v5 proof pins the new key. Owner-only: the pin is
  // what stops somebody who re-derived the v4 key from starting a chain of their own.
  app.delete('/me/creator-links/:id/key-pin', { preHandler: requireRole(), config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) => {
    const p = await db();
    const link = await p.creatorLink.findUnique({ where: { id: req.params.id } });
    if (!link || link.userId !== req.user.uid) return reply.code(404).send({ error: 'not_found' });
    const n = (await p.creatorKeyPin.deleteMany({ where: { creatorId: link.creatorId.toLowerCase() } })).count;
    if (n) await notify(p, req.user.uid, 'creator_key_reset', `The key pin of creator id "${link.creatorId}" was reset. The next BMM that proves this id sets a new one.`);
    return { ok: true, reset: n > 0 };
  });

  app.delete('/me/creator-links/:id', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const link = await p.creatorLink.findUnique({ where: { id: req.params.id } });
    if (!link || link.userId !== req.user.uid) return reply.code(404).send({ error: 'not_found' });
    if (new Date(link.unlinkableAt).getTime() > Date.now()) return reply.code(423).send({ error: 'locked', unlinkableAt: link.unlinkableAt });
    // Checked here as well as in the list, and not only because a client can call this
    // directly: the list was fetched at some point in the past, and a repo created since
    // must not be orphaned by a button that was correct when it was drawn.
    const hosting = await publishedUnderIdentity(p, req.user.uid);
    if (hosting.total > 0) return reply.code(409).send({ error: 'has_hosted_content', ...hosting });
    await p.creatorLink.delete({ where: { id: link.id } });
    return { ok: true };
  });
}
