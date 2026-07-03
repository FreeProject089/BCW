// A stable, opaque "Repo ID" printed on every Server-Repo — a support/moderation
// reference that is UNIQUE per repo and derived from the owner's combined
// identities (BCWEB account id + linked BMM creator ids + linked Discord ids +
// Ko-fi donor flag). Because repo.id is itself unique, the fingerprint is unique
// per repo; folding in the identities means the admin "identify" lookup can map
// the code straight back to the full owner picture.
import crypto from 'node:crypto';

const SECRET = () => process.env.JWT_SECRET || 'dev-only-insecure-secret';
// Crockford-ish base32 minus vowels/ambiguous chars → codes are easy to read
// aloud and hard to typo (no O/0, I/1, etc.).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTVWXYZ23456789';

function identityMaterial({ repoId, ownerId, creatorIds = [], discordIds = [], kofi = false }) {
  return [
    repoId,
    ownerId,
    [...creatorIds].sort().join(','),
    [...discordIds].sort().join(','),
    kofi ? 'k1' : 'k0',
  ].join('|');
}

// Shared base32 code builder: HMAC(secret, material) → PREFIX-XXXX-XXXX.
function code(material, prefix) {
  const h = crypto.createHmac('sha256', SECRET()).update(material).digest();
  let out = '';
  for (let i = 0; i < 8; i++) out += ALPHABET[h[i] % ALPHABET.length];
  return `${prefix}-${out.slice(0, 4)}-${out.slice(4, 8)}`;
}

// Returns e.g. "BCR-7K2M-9XQ4". Deterministic for the same inputs, so the repo
// card and the admin lookup always compute the same value.
export function repoFingerprint(parts) {
  return code(identityMaterial(parts), 'BCR');
}

// Per-catalog-item unique id "BCI-XXXX-XXXX" — combines the owning BCWEB account,
// the item id, and the owner's linked creator ids (same identity fold as repos).
export function itemFingerprint({ itemId, ownerId, creatorIds = [] }) {
  return code(['item', itemId, ownerId, [...creatorIds].sort().join(',')].join('|'), 'BCI');
}

// The account-level "Unique BC id" ("BC-XXXX-XXXX") printed on the admin user
// card/modal. Derived from the IMMUTABLE BCWEB account id only, so it's stable
// (doesn't change when creator ids are linked/unlinked) and searchable back to
// the account by recomputation.
export function userBcId(userId) {
  return code(`user|${userId}`, 'BC');
}

// The 8-char body of any BC code (last 8 alphanumerics), used for tolerant
// matching regardless of prefix/spacing/case ("bc 7k2m9xq4" → "7K2M9XQ4").
export function bcIdBody(s) {
  const raw = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return raw.length >= 8 ? raw.slice(-8) : null;
}

// Does this string look like a BC code the admin might paste (BC/BCR/BCI prefix,
// or a bare 8-char body)? Cheap gate before the O(users) recomputation scan.
export function looksLikeBcId(s) {
  const t = String(s || '').trim();
  return /^bc[uri]?[-\s]?[a-z0-9]{4}[-\s]?[a-z0-9]{4}$/i.test(t) || /^[a-z0-9]{8}$/i.test(t);
}

// Resolve a pasted "BC-XXXX-XXXX" back to a user id by recomputing userBcId over
// all accounts (admin-only, infrequent — only ids are loaded). Returns id | null.
export async function findUserIdByBcId(p, codeStr) {
  const target = bcIdBody(codeStr);
  if (!target) return null;
  const users = await p.user.findMany({ select: { id: true } });
  for (const u of users) if (bcIdBody(userBcId(u.id)) === target) return u.id;
  return null;
}

// Normalise user input (case / spacing / missing prefix) so an admin can paste
// "bcr 7k2m9xq4" or "7K2M-9XQ4" and still match.
export function normalizeFingerprint(s) {
  const body = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^BCR/, '');
  if (body.length !== 8) return null;
  return `BCR-${body.slice(0, 4)}-${body.slice(4, 8)}`;
}

// Batch-load the identity bundle for a set of owner ids in a couple of queries
// (never N+1), so the public repo list can fingerprint every row cheaply.
// Returns Map<ownerId, { creatorIds, discordIds, kofi }>.
export async function loadOwnerIdentities(p, ownerIds) {
  const ids = [...new Set(ownerIds.filter(Boolean))];
  const map = new Map(ids.map((id) => [id, { creatorIds: [], discordIds: [], kofi: false }]));
  if (!ids.length) return map;
  const [creators, discords, users] = await Promise.all([
    p.creatorLink.findMany({ where: { userId: { in: ids } }, select: { userId: true, creatorId: true } }),
    p.discordLink.findMany({ where: { userId: { in: ids } }, select: { userId: true, discordId: true } }),
    p.user.findMany({ where: { id: { in: ids } }, select: { id: true, kofiDonorAt: true } }),
  ]);
  for (const c of creators) map.get(c.userId)?.creatorIds.push(c.creatorId);
  for (const d of discords) map.get(d.userId)?.discordIds.push(d.discordId);
  for (const u of users) { const m = map.get(u.id); if (m) m.kofi = !!u.kofiDonorAt; }
  return map;
}
