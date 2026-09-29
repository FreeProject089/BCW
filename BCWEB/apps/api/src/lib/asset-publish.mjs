// assetskey (agent-assets-key): the CI publish key for platform-asset slots.
//
// WHY IT EXISTS
//
// BMM's release and re-sign workflows mirror a few files to BCWEB (`/api/assets/<slot>`): the
// two signed update manifests and the offline Laya model pack. The asset routes take a staff
// session plus 2FA, which a CI runner cannot hold. This is the narrow door for that one job.
//
// WHAT A KEY CAN DO, AND NOTHING ELSE
//
//   · It is an ordinary ApiKey row (hashed at rest, shown once) carrying ONE scope,
//     `assets:publish`, and an explicit list of slot ids (`assetSlots`). The scope is NOT in
//     API_SCOPES, so `POST /me/api-keys` cannot mint it; only the manage_assets mint route in
//     routes/platform-assets.mjs can, and only for an ADMIN or SUPERADMIN with a fresh TOTP.
//   · It opens exactly two routes: presign an upload for one of its slots, and confirm that
//     upload. No list, no delete, no JSON edit, no admin route: every /admin route asks for a
//     session, and every /v1 route asks for a scope this key does not carry.
//   · It always expires (CI_KEY_MAX_DAYS at most), and it stops working the moment its owner
//     loses manage_assets, stops being ADMIN-tier or is suspended: it is the owner's power,
//     lent, never more than the owner still has.
//   · The confirm is refused unless the bytes the store holds hash to the SHA-256 the caller
//     declared. A mismatch deletes the NEW object and leaves the slot on its old file.
//
// The secret is never logged, never echoed in an error body, and never written to the audit
// chain: only the 12-character prefix identifies a key there.
import crypto from 'node:crypto';
import { db, hashApiKey, safeEqual, hasCap, accountLock } from './lib.mjs';

export const ASSET_PUBLISH_SCOPE = 'assets:publish';

/**
 * The slots a CI key may be bound to, each with its own byte ceiling and content types.
 *
 * A registry and not "any key": a key is minted for named slots, and a slot nobody listed
 * here (an installer, links.json) stays reachable by a staff session only. The ceilings are
 * per slot on purpose — a manifest is kilobytes, the model pack is 327 MB, and one shared cap
 * would let a leaked manifest key park half a gigabyte where a manifest belongs.
 */
export const CI_ASSET_SLOTS = Object.freeze({
  'bmm-update-json': { maxBytes: 1 * 1024 ** 2, types: ['application/json'] },
  'bmm-update-manifest': { maxBytes: 8 * 1024 ** 2, types: ['application/json'] },
  'bmm-laya-offline': { maxBytes: 512 * 1024 ** 2, types: ['application/zip', 'application/octet-stream'] },
});

/** A CI key always expires, and never later than this. */
export const CI_KEY_MAX_DAYS = 90;

/** Lower-case hex SHA-256, exactly 64 characters. */
export const SHA256_RE = /^[a-f0-9]{64}$/;

/** Bearer only. `X-Api-Key` is not accepted here: one way in is one way to audit. */
function presentedBearer(req) {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(String(req.headers?.authorization || ''));
  return m ? m[1] : '';
}

/** Best effort, never blocks the request (same rule as apiAuth's touch). */
function touch(p, id, ip) {
  p.apiKey.update({ where: { id }, data: { lastUsedAt: new Date(), lastUsedIp: ip || null } }).catch(() => {});
}

/**
 * The guard for the two CI routes. Reads `req.params.slot`.
 *
 * The answers, in order: no/short key → 401; unknown, revoked or expired → 401 invalid_key
 * (one answer for the three, as apiAuth does); key without `assets:publish` → 403
 * insufficient_scope; slot not bound to the key → 403 slot_not_allowed; owner no longer
 * entitled → 403 owner_not_permitted; owner suspended/banned → 403 account_<status>.
 *
 * Not behind the public-API switch (`features.publicApiEnabled`): that switch is about third
 * parties reading accounts, and turning it off must not silently stop release mirroring.
 */
export function assetPublishAuth() {
  return async (req, reply) => {
    const secret = presentedBearer(req);
    if (!secret || secret.length < 20) return reply.code(401).send({ error: 'unauthenticated', hint: 'Send Authorization: Bearer <key>' });
    const p = await db();
    const hash = hashApiKey(secret);
    const key = await p.apiKey.findUnique({
      where: { hash },
      select: { id: true, hash: true, prefix: true, userId: true, scopes: true, assetSlots: true, revokedAt: true, expiresAt: true,
        user: { select: { role: true, permissions: true, status: true } } },
    });
    // The lookup is by hash; the compare after it is constant-time anyway, so nothing here
    // depends on how the index answered.
    if (!key || !safeEqual(key.hash, hash) || key.revokedAt || (key.expiresAt && key.expiresAt <= new Date())) {
      return reply.code(401).send({ error: 'invalid_key' });
    }
    req.apiKey = { id: key.id, prefix: key.prefix, scopes: key.scopes, userId: key.userId, assetSlots: key.assetSlots || [] };
    if (!Array.isArray(key.scopes) || !key.scopes.includes(ASSET_PUBLISH_SCOPE)) {
      return reply.code(403).send({ error: 'insufficient_scope', required: ASSET_PUBLISH_SCOPE });
    }
    const slot = String(req.params?.slot || '');
    if (!CI_ASSET_SLOTS[slot] || !(key.assetSlots || []).includes(slot)) {
      return reply.code(403).send({ error: 'slot_not_allowed', slot: slot.slice(0, 64) });
    }
    const owner = { role: key.user?.role, perms: key.user?.permissions || [] };
    if (!['ADMIN', 'SUPERADMIN'].includes(owner.role) || !hasCap(owner, 'manage_assets')) {
      return reply.code(403).send({ error: 'owner_not_permitted' });
    }
    const lock = await accountLock(key.userId);
    if (lock) return reply.code(403).send({ error: `account_${lock.status}` });
    touch(p, key.id, req.ip);
    req.user = { uid: key.userId, role: owner.role };
  };
}

/**
 * SHA-256 and byte count of a stored object, streamed: the model pack is 327 MB and is never
 * held in memory. `getObject` is injected so the routes' storage double can answer in tests.
 */
export async function hashStoredObject(getObject, storageKey) {
  const { body } = await getObject(storageKey);
  const h = crypto.createHash('sha256');
  let size = 0;
  if (body && typeof body[Symbol.asyncIterator] === 'function') {
    for await (const chunk of body) { const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); h.update(b); size += b.length; }
  } else if (body) {
    const b = Buffer.isBuffer(body) ? body : Buffer.from(body);
    h.update(b); size = b.length;
  }
  return { sha256: h.digest('hex'), size };
}
