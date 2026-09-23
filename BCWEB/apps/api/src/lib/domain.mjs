// Custom domains: what counts as one, and who is allowed one.
//
// Two decisions live here rather than in the route, because both are the kind that get made
// twice and drift: what shape of hostname we accept, and which pools may have one. The route
// does the database work; this file answers the questions.
//
// Serving a customer's hostname means issuing a certificate for it on demand, which is a
// standing invitation for anyone who can point a CNAME at us. So the accept rules are
// deliberately narrow, and the eligibility rule is checked at the point of USE (the edge asks
// before issuing a cert), not only at the point of adding — a pool that lapses must stop
// being a reason to hand out certificates.
import crypto from 'node:crypto';

/// The DNS label the owner adds to prove they hold the name. Prefixed so it cannot collide
/// with anything else in their zone, and so a support answer can name the exact record.
export const VERIFY_PREFIX = '_bcw-verify';

/// A token per domain, not per account: revoking one domain must not invalidate the record
/// somebody else already published for another.
export const genVerifyToken = () => 'bcwv_' + crypto.randomBytes(16).toString('hex');

/**
 * Normalise a hostname the way DNS would compare it.
 *
 * Case-folded, trailing dot dropped (a fully-qualified "example.com." IS "example.com"),
 * a pasted URL reduced to its host, and any port removed. Returns '' for anything that is
 * not salvageable, so callers get one falsy answer rather than three shapes of nearly-right.
 */
export function normaliseHost(input) {
  let s = String(input || '').trim().toLowerCase();
  if (!s) return '';
  // People paste the URL, because that is what their browser shows them.
  if (s.includes('://')) {
    try { s = new URL(s).hostname; } catch { return ''; }
  }
  s = s.split('/')[0].split('?')[0];
  // A port on a hostname we will serve over 443 is meaningless, and "example.com:8080"
  // silently becoming a different string than "example.com" is a support ticket.
  s = s.split(':')[0];
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Is this a hostname we are willing to serve?
 *
 * Not "is it syntactically a domain" — it is narrower than that on purpose:
 *
 *   * at least two labels, so a bare "localhost" or a TLD cannot be claimed;
 *   * no wildcard. A wildcard certificate cannot be issued on demand anyway, and accepting
 *     the string would let somebody believe we had;
 *   * no IP address. A certificate for an IP is not what anybody means by "my domain", and
 *     an IP claimed by one account is an IP nobody else can ever use;
 *   * ASCII only. A unicode hostname must be punycoded by the caller — comparing an
 *     un-normalised unicode host against a DNS answer is how two spellings of the same name
 *     end up as two rows, one of which is unreachable.
 */
export function isServableHost(host) {
  const h = normaliseHost(host);
  if (!h || h.length > 253) return false;
  if (h.includes('*') || h.includes('_')) return false;
  // Dotted quad, or anything with a colon left in it (IPv6).
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return false;
  const labels = h.split('.');
  if (labels.length < 2) return false;
  return labels.every((l) => LABEL.test(l));
}

/**
 * Would serving this host collide with our own?
 *
 * Somebody claiming `www.bettercommunity.example` or the apex must not get a certificate, or
 * a verified row that the edge would then honour ahead of our own routing. Compared on the
 * registrable tail rather than by equality, so a subdomain of ours is caught too.
 */
export function isOurOwnHost(host, siteHost) {
  const h = normaliseHost(host);
  const own = normaliseHost(siteHost);
  if (!h || !own) return false;
  return h === own || h.endsWith(`.${own}`);
}

/**
 * May this thing carry a custom domain?
 *
 * Paid pools only, and that is a product rule with a cost behind it: every domain is a
 * certificate we obtain, renew and serve. `subject` is a repo or a catalogue as the route
 * loads it, with its hosting group attached.
 *
 * The free tier is identified by the group's own `freePlan` flag rather than by a price
 * lookup — the flag is what provisioning sets, and a plan's price can change afterwards.
 */
export function domainEligible(subject) {
  if (!subject) return { ok: false, reason: 'not_found' };
  // Not hosted here at all: there is nothing for us to serve at that name. An external repo
  // already lives at the owner's own address, which is the thing a domain would point to.
  if (subject.hosted === false && subject.hostPath == null) return { ok: false, reason: 'not_hosted' };
  const group = subject.group || null;
  if (!group) return { ok: false, reason: 'no_pool' };
  if (group.freePlan) return { ok: false, reason: 'free_plan' };
  return { ok: true };
}

/**
 * Does the zone actually say what we asked it to say?
 *
 * `records` is whatever the resolver returned for `_bcw-verify.<host>` — node's resolveTxt
 * gives an array of arrays, because one TXT record can be split into several strings that
 * must be concatenated. Flattened and compared after trimming, since providers differ on
 * whether they hand back the surrounding quotes.
 */
export function txtMatches(records, token) {
  if (!token) return false;
  const flat = (records || []).map((r) => (Array.isArray(r) ? r.join('') : String(r || '')));
  return flat.some((v) => v.trim().replace(/^"|"$/g, '') === token);
}

/**
 * Every DNS record the owner has to create for `host`, in the order they create them.
 *
 * One function, used by the owner's panel (with their real token) and by the public guide on
 * /hosting (with a placeholder), so the page that explains the records and the panel that
 * hands them out cannot disagree on a name, a separator or a type. The web never assembles a
 * record from parts.
 *
 *   * `proof`   the TXT record that says the name is theirs. Checked by /verify.
 *   * `pointer` the record that sends the traffic here. A CNAME to our own hostname, because
 *               that is the one value that stays right if the server's address changes. It is
 *               null when the site has no hostname configured (a dev stack), rather than a
 *               CNAME to an empty string. A CNAME cannot sit on the bare apex of a zone
 *               (example.com itself), which is why the panel says so and suggests the
 *               provider's flattening record (ALIAS / ANAME) or a subdomain instead.
 */
export function dnsRecordsFor(host, token, target) {
  const h = normaliseHost(host);
  const tgt = normaliseHost(target);
  return {
    proof: { type: 'TXT', name: `${VERIFY_PREFIX}.${h}`, value: String(token || '') },
    pointer: tgt ? { type: 'CNAME', name: h, value: tgt } : null,
  };
}

/**
 * Does the traffic for this name already reach us?
 *
 * Informational only: verification is the TXT proof and nothing else, because the pointer can
 * legitimately be missing while somebody moves a live name over (they prove it first, then
 * switch the traffic). This answers the question the owner has next: "and is it pointing at
 * you yet?".
 *
 * `seen` is what the resolver said about the owner's name: its CNAME chain and its IPv4
 * addresses (resolve4 follows a CNAME, so a correct CNAME shows up here too). `ours` is our own
 * hostname and its addresses. A match on either is a yes.
 */
export function pointsAtUs(seen, ours) {
  const target = normaliseHost(ours?.target);
  if (!target) return false;
  const cn = (seen?.cnames || []).map(normaliseHost);
  if (cn.includes(target)) return true;
  const mine = new Set((ours?.addrs || []).map(String));
  return (seen?.addrs || []).some((a) => mine.has(String(a)));
}
