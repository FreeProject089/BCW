// Creator key v5: the wire format against BMM's own output, v4 and v5 side by side, the
// v4 → v5 upgrade carrying links, claims and bans, replay and fork refusal, and the admin
// fingerprint tool's gating.
//
// The format is minted by BMM in Rust (src-tauri/src/commands/creator_v5.rs). `mintV5` below
// rebuilds it byte-for-byte, and fixtures/creator-v5-vector.json is a token Rust actually
// produced (its test `the_shared_vector_is_unchanged` pins the same bytes). If the two sides
// ever drift, one of those two tests says so.
//
// Every refusal is a MUTATION of something that verifies: a verifier that refuses everything
// would pass a test that only ever fed it garbage.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  verifyCreatorProof, verifyCreatorProofV5, verifyAnyCreatorProof, verifyKeyChain, inspectCreatorToken, MAX_CHAIN,
} from '../src/lib/creator-proof.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const VECTOR = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'creator-v5-vector.json'), 'utf8'));
const AUD = 'https://bettercommunity.test';
const NOW = Math.floor(Date.now() / 1000);
const b64u = (s) => Buffer.from(s, 'utf8').toString('base64url');

function keypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { privateKey, pub: Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('hex') };
}

/** A creator: a root (the v4 key) and a chain of active keys, as BMM's store holds them. */
function creator({ rotations = 1 } = {}) {
  const root = keypair();
  const c = { cid: root.pub, root, keys: [root], chain: [], active: root };
  for (let i = 0; i < rotations; i++) rotate(c);
  return c;
}
function cert(cid, prev, nextPub, seq, iat = NOW - 100) {
  const seg = b64u(`{"t":"bmm-key-rotate","cid":"${cid}","prev":"${prev.pub}","next":"${nextPub}","seq":${seq},"iat":${iat}}`);
  return `bmmk5.${seg}.${crypto.sign(null, Buffer.from(`bmmk5.${seg}`), prev.privateKey).toString('base64url')}`;
}
function rotate(c) {
  const next = keypair();
  c.chain.push(cert(c.cid, c.active, next.pub, c.chain.length + 1));
  c.keys.push(next); c.active = next;
  return c;
}
/** The Rust signer's output, rebuilt. Field order is signed. */
function mintV5(c, { aud = AUD, iat = NOW, exp = NOW + 120, nonce = crypto.randomBytes(16).toString('hex'), fp, chain = c.chain, signer = c.active } = {}) {
  const f = fp || { board: 'a'.repeat(32), os: 'b'.repeat(32), disk: 'c'.repeat(32), canvas: 'd'.repeat(32) };
  const fpJson = `{"fv":1${['board', 'os', 'disk', 'canvas'].filter((k) => f[k]).map((k) => `,"${k}":"${f[k]}"`).join('')}}`;
  const seg = b64u(`{"v":5,"cid":"${c.cid}","kid":"${signer.pub}","aud":"${aud}","iat":${iat},"exp":${exp},"nonce":"${nonce}","fp":${fpJson},"chain":[${chain.map((x) => `"${x}"`).join(',')}]}`);
  return `bmmc5.${seg}.${crypto.sign(null, Buffer.from(`bmmc5.${seg}`), signer.privateKey).toString('base64url')}`;
}
/** A v1 (v4-era) proof, signed by the root. */
function mintV1(c, { aud = AUD, exp = NOW + 120 } = {}) {
  const seg = b64u(`{"cid":"${c.cid}","aud":"${aud}","exp":${exp}}`);
  return `bmmc1.${seg}.${crypto.sign(null, Buffer.from(seg), c.root.privateKey).toString('base64url')}`;
}

describe('the v5 format', () => {
  test('the token BMM minted verifies here, with its chain and hashed fingerprint', () => {
    const r = verifyCreatorProofV5(VECTOR.token, VECTOR.aud, VECTOR.now);
    assert.ok(r, 'the Rust vector verifies');
    assert.equal(r.cid, VECTOR.cid);
    assert.equal(r.kid, VECTOR.kid);
    assert.equal(r.seq, 2, 'root → first active → second active');
    for (const k of ['board', 'os', 'disk', 'canvas']) assert.match(r.fp[k], /^[0-9a-f]{32}$/);
    // The Creator ID in the vector is the v4 public key of its root seed: the name is unchanged.
    const pub = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(VECTOR.v4Seed, 'hex')]), format: 'der', type: 'pkcs8' });
    assert.equal(Buffer.from(crypto.createPublicKey(pub).export({ format: 'jwk' }).x, 'base64url').toString('hex'), VECTOR.cid);
  });

  test('a v5 proof verifies; each mutation is refused', () => {
    const c = creator({ rotations: 2 });
    assert.equal(verifyCreatorProofV5(mintV5(c), AUD, NOW)?.cid, c.cid);
    assert.equal(verifyCreatorProofV5(mintV5(c, { aud: 'https://elsewhere.test' }), AUD, NOW), null, 'wrong audience');
    assert.equal(verifyCreatorProofV5(mintV5(c, { exp: NOW - 1, iat: NOW - 100 }), AUD, NOW), null, 'expired');
    assert.equal(verifyCreatorProofV5(mintV5(c, { exp: NOW + 3600 }), AUD, NOW), null, 'a long-lived token');
    assert.equal(verifyCreatorProofV5(mintV5(c, { nonce: 'zz' }), AUD, NOW), null, 'no nonce');
    assert.equal(verifyCreatorProofV5(mintV5(c, { chain: c.chain.slice(1) }), AUD, NOW), null, 'a chain that skips the root');
    assert.equal(verifyCreatorProofV5(mintV5(c, { chain: [...c.chain].reverse() }), AUD, NOW), null, 'a reordered chain');
    assert.equal(verifyCreatorProofV5(mintV5(c, { signer: c.keys[1] }), AUD, NOW), null, 'signed by a key the chain does not end at');
    const stranger = keypair();
    assert.equal(verifyCreatorProofV5(mintV5(c, { chain: [...c.chain, cert(c.cid, stranger, keypair().pub, 3)] }), AUD, NOW), null, 'a link signed by an outsider');
    const [h, seg, sig] = mintV5(c).split('.');
    // Flip a bit in the DECODED signature. Rewriting the last two base64url characters looks
    // like the same thing and is not: the final character of an 86-char encoding carries two
    // significant bits, so `…AA` reproduces the original signature byte for byte about 6% of
    // the time — a tamper test that tests nothing, one run in sixteen, and fails nothing.
    const tampered = Buffer.from(sig, 'base64url'); tampered[0] ^= 0xff;
    assert.equal(verifyCreatorProofV5(`${h}.${seg}.${tampered.toString('base64url')}`, AUD, NOW), null, 'a tampered signature');
    assert.equal(verifyCreatorProofV5(`${h}.${b64u(Buffer.from(seg, 'base64url').toString().replace('"v":5', '"v":5 '))}.${sig}`, AUD, NOW), null, 'a tampered payload');
  });

  test('a v5 proof relabelled as v1 does not verify (domain separation)', () => {
    const c = creator({ rotations: 0 }); // a fresh install: the root signs its own proofs
    const [, seg, sig] = mintV5(c).split('.');
    assert.equal(verifyCreatorProof(`bmmc1.${seg}.${sig}`, AUD, NOW), null);
  });

  test('fingerprint: only 128-bit hex hashes are kept, anything else a client sends is dropped', () => {
    const c = creator();
    const r = verifyCreatorProofV5(mintV5(c, { fp: { board: 'SERIAL-123', os: 'e'.repeat(32) } }), AUD, NOW);
    assert.deepEqual(r.fp, { os: 'e'.repeat(32) });
  });

  test('chain length is capped', () => {
    const c = creator({ rotations: MAX_CHAIN + 1 });
    assert.equal(verifyKeyChain(c.cid, c.chain).error, 'chain_too_long');
  });
});

describe('v4 and v5 together', () => {
  test('a v4 client is unchanged: its bmmc1 proof verifies as before', () => {
    const c = creator();
    assert.equal(verifyCreatorProof(mintV1(c), AUD, NOW), c.cid);
    assert.equal(verifyAnyCreatorProof(mintV1(c), AUD, NOW).version, 1);
  });
  test('the same id proven by v4 and by v5 is the same Creator ID', () => {
    const c = creator();
    assert.equal(verifyAnyCreatorProof(mintV1(c), AUD, NOW).cid, verifyAnyCreatorProof(mintV5(c), AUD, NOW).cid);
  });
  test('the admin decoder reports each check separately', () => {
    const c = creator();
    const t = inspectCreatorToken(mintV5(c, { iat: NOW - 1000, exp: NOW - 900 }), AUD, NOW);
    assert.equal(t.version, 5);
    assert.deepEqual(t.checks, { id: true, audience: true, unexpired: false, chain: true, signature: true, nonce: true });
    assert.equal(inspectCreatorToken(c.cid.toUpperCase(), AUD, NOW).cid, c.cid);
    assert.equal(inspectCreatorToken('hello', AUD, NOW).kind, 'unknown');
  });
  test('stability: one value per component is 1, two equal values is 0.5', async () => {
    // Imported here, not at the top: creator-identity pulls in lib.mjs, which reads
    // JWT_SECRET when it loads, and the database tests below set it first.
    const { stabilityOf } = await import('../src/lib/creator-identity.mjs');
    const s = stabilityOf([
      { component: 'board', count: 4 }, { component: 'canvas', count: 2 }, { component: 'canvas', count: 2 },
    ]);
    assert.equal(s.perComponent.board.score, 1);
    assert.equal(s.perComponent.canvas.score, 0.5);
    assert.equal(s.overall, 0.75);
  });
});

// ── against the database ──────────────────────────────────────────────────────
const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to run the creator key v5 database tests';
process.env.JWT_SECRET ||= 'creator-key-v5-secret';
process.env.SITE_URL ||= AUD; // expectedProofAudience() for the routes

let p, CI, siteban, jwt, appLinks, appAdmin, appBans, savedBans;
const MAIL = '@ck5.test';
const stamp = `${Date.now()}`;
let seq = 0;
const cids = [];
const track = (c) => { cids.push(c.cid); return c; };

before(async () => {
  if (!RUN) return;
  p = await (await import('../src/lib/lib.mjs')).db();
  CI = await import('../src/lib/creator-identity.mjs');
  siteban = await import('../src/lib/siteban.mjs');
  jwt = (await import('jsonwebtoken')).default;
  const Fastify = (await import('fastify')).default;
  appLinks = Fastify(); await appLinks.register((await import('@fastify/cookie')).default); await appLinks.register((await import('../src/routes/links.mjs')).default); await appLinks.ready();
  appAdmin = Fastify(); await appAdmin.register((await import('@fastify/cookie')).default); await appAdmin.register((await import('../src/routes/admin-fingerprint.mjs')).default); await appAdmin.ready();
  appBans = Fastify(); siteban.installSiteBans(appBans); appBans.get('/ping', async () => ({ ok: true })); await appBans.ready();
  savedBans = await siteban.getBanPolicy(p, { fresh: true });
});

after(async () => {
  if (!RUN) return;
  await siteban.setBanPolicy(p, { creators: savedBans.creators }).catch(() => {});
  await p.creatorKeyPin.deleteMany({ where: { creatorId: { in: cids } } });
  await p.creatorFingerprint.deleteMany({ where: { creatorId: { in: cids } } });
  await p.freeTierClaim.deleteMany({ where: { creatorId: { in: cids } } });
  await p.linkCode.deleteMany({ where: { creatorId: { in: cids } } });
  await p.creatorLink.deleteMany({ where: { creatorId: { in: cids } } });
  const ids = (await p.user.findMany({ where: { email: { endsWith: MAIL } }, select: { id: true } })).map((u) => u.id);
  await p.auditLogEntry.deleteMany({ where: { actorId: { in: ids } } }).catch(() => {});
  await p.notification.deleteMany({ where: { userId: { in: ids } } });
  await p.session.deleteMany({ where: { userId: { in: ids } } });
  await p.user.deleteMany({ where: { id: { in: ids } } });
  await Promise.all([appLinks?.close(), appAdmin?.close(), appBans?.close()]);
});

const mkUser = (data = {}) => p.user.create({ data: { email: `u${stamp}-${seq++}${MAIL}`, displayName: `ck5-${stamp}-${seq}`, emailVerified: true, status: 'active', ...data } });
async function cookieFor(u) {
  const s = await p.session.create({ data: { userId: u.id }, select: { id: true } });
  return `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: s.id }, process.env.JWT_SECRET)}`;
}

describe('proofs with memory', { skip }, () => {
  test('v4 accepted until the id upgrades; then v5 only', async () => {
    const c = track(creator());
    assert.equal((await CI.acceptCreatorProof(p, mintV1(c), AUD)).ok, true, 'an unpinned v4 id is unchanged');
    const r = await CI.acceptCreatorProof(p, mintV5(c), AUD);
    assert.equal(r.ok, true); assert.equal(r.version, 5); assert.equal(r.cid, c.cid);
    assert.equal((await CI.acceptCreatorProof(p, mintV1(c), AUD)).error, 'upgraded_key_required', 'the derivable v4 key no longer speaks alone');
  });

  test('a replayed proof is refused', async () => {
    const c = track(creator());
    const tok = mintV5(c);
    assert.equal((await CI.acceptCreatorProof(p, tok, AUD)).ok, true);
    assert.equal((await CI.acceptCreatorProof(p, tok, AUD)).error, 'replayed');
  });

  test('rotation moves the pin; a retired key and a forked chain are refused', async () => {
    const c = track(creator());
    const old = { ...c, chain: [...c.chain], active: c.active };
    assert.equal((await CI.acceptCreatorProof(p, mintV5(c), AUD)).ok, true);
    rotate(c);
    const r = await CI.acceptCreatorProof(p, mintV5(c), AUD);
    assert.equal(r.ok, true); assert.equal(r.seq, 2);
    assert.equal((await p.creatorKeyPin.findUnique({ where: { creatorId: c.cid } })).kid, c.active.pub);
    assert.equal((await CI.acceptCreatorProof(p, mintV5(old), AUD)).error, 'key_retired');
    // Somebody who re-derived the root starts a chain of their own.
    const thief = keypair();
    const fork = { ...c, chain: [cert(c.cid, c.root, thief.pub, 1)], active: thief };
    assert.equal((await CI.acceptCreatorProof(p, mintV5(rotate(rotate(fork))), AUD)).error, 'key_fork');
  });

  test('fingerprint history is recorded as hashes, with a stability score', async () => {
    const c = track(creator());
    await CI.acceptCreatorProof(p, mintV5(c), AUD);
    await CI.acceptCreatorProof(p, mintV5(c, { fp: { board: 'a'.repeat(32), os: 'b'.repeat(32), disk: 'c'.repeat(32), canvas: 'f'.repeat(32) } }), AUD);
    const a = await CI.creatorAnalysis(p, c.cid);
    assert.equal(a.version, 5);
    assert.equal(a.stability.perComponent.board.score, 1);
    assert.equal(a.stability.perComponent.canvas.score, 0.5, 'a driver update shows as a second canvas value');
  });
});

describe('the v4 → v5 upgrade carries links, claims and bans', { skip }, () => {
  test('a banned v4 id stays banned after upgrading, and its claim and link are still its own', async () => {
    const c = track(creator());
    const owner = await mkUser();
    // Everything a v4 id collected before it upgraded.
    await p.creatorLink.create({ data: { userId: owner.id, creatorId: c.cid, linkedAt: new Date(), unlinkableAt: new Date(Date.now() + 864e5) } });
    await p.freeTierClaim.create({ data: { kind: 'REPO', creatorId: c.cid, userId: owner.id } });
    await siteban.setBanPolicy(p, { creators: [...savedBans.creators, { v: c.cid, note: 'ck5 test' }] });

    // A v4 client, then the upgrade.
    assert.equal((await appBans.inject({ url: '/ping', headers: { 'x-creator-id': c.cid } })).statusCode, 403, 'banned as v4');
    const up = await appLinks.inject({ method: 'POST', url: '/link/upgrade', payload: { proof: mintV5(c, { aud: new URL(process.env.SITE_URL).origin }) } });
    assert.equal(up.statusCode, 200, up.body);
    assert.equal(up.json().cid, c.cid, 'the upgraded client proves the SAME id');
    assert.equal(up.json().linked, true);

    // …and nothing moved: the same id is still banned, still linked, still holds its claim.
    assert.equal((await appBans.inject({ url: '/ping', headers: { 'x-creator-id': c.cid } })).statusCode, 403, 'still banned as v5');
    const a = await CI.creatorAnalysis(p, c.cid, { canSeeBans: true });
    assert.equal(a.account.id, owner.id);
    assert.equal(a.claims.length, 1);
    assert.ok(a.bans.site, 'the ban applies to the upgraded id');
    // The one-free-repo rule is keyed on the id, so a second claim is still refused.
    await assert.rejects(p.freeTierClaim.create({ data: { kind: 'REPO', creatorId: c.cid, userId: owner.id } }));
  });

  test('an upgraded id must prove itself to request a pairing code; a v4 id need not', async () => {
    const aud = new URL(process.env.SITE_URL).origin;
    const v4 = track(creator());
    assert.equal((await appLinks.inject({ method: 'POST', url: '/link/request', payload: { creatorId: v4.cid } })).statusCode, 200, 'v4 unchanged');
    const v5 = track(creator());
    await CI.acceptCreatorProof(p, mintV5(v5, { aud }), aud);
    const bare = await appLinks.inject({ method: 'POST', url: '/link/request', payload: { creatorId: v5.cid } });
    assert.equal(bare.statusCode, 403); assert.equal(bare.json().error, 'proof_required');
    const other = track(creator());
    const mismatch = await appLinks.inject({ method: 'POST', url: '/link/request', payload: { creatorId: v5.cid, proof: mintV5(other, { aud }) } });
    assert.equal(mismatch.json().error, 'proof_mismatch');
    const ok = await appLinks.inject({ method: 'POST', url: '/link/request', payload: { creatorId: v5.cid, proof: mintV5(v5, { aud }) } });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.ok(ok.json().code);
  });

  test('ids sharing a hashed component are listed as similar', async () => {
    const aud = new URL(process.env.SITE_URL).origin;
    const banned = track(creator());
    const fresh = track(creator());
    const board = crypto.randomBytes(16).toString('hex');
    await CI.acceptCreatorProof(p, mintV5(banned, { aud, fp: { board } }), aud);
    await CI.acceptCreatorProof(p, mintV5(fresh, { aud, fp: { board } }), aud);
    const a = await CI.creatorAnalysis(p, fresh.cid);
    assert.deepEqual(a.similar.map((s) => [s.creatorId, s.components]), [[banned.cid, ['board']]]);
  });
});

describe('the admin fingerprint tool', { skip }, () => {
  test('gated: anonymous 401, a member 403, a moderator reads without bans, an admin with bans; each lookup audited', async () => {
    const c = track(creator());
    const body = { q: c.cid };
    assert.equal((await appAdmin.inject({ method: 'POST', url: '/admin/users/creator-lookup', payload: body })).statusCode, 401);
    const member = await mkUser();
    assert.equal((await appAdmin.inject({ method: 'POST', url: '/admin/users/creator-lookup', payload: body, headers: { cookie: await cookieFor(member) } })).statusCode, 403);

    const mod = await mkUser({ role: 'MOD', totpEnabled: true });
    const rm = await appAdmin.inject({ method: 'POST', url: '/admin/users/creator-lookup', payload: body, headers: { cookie: await cookieFor(mod) } });
    assert.equal(rm.statusCode, 200, rm.body);
    assert.equal(rm.json().canSeeBans, false);
    assert.equal(rm.json().analysis.bans, undefined, 'the ban list is manage_sanctions data');
    assert.equal((await appAdmin.inject({ method: 'DELETE', url: `/admin/security/creator-pin/${c.cid}`, headers: { cookie: await cookieFor(mod) } })).statusCode, 403, 'resetting a pin is manage_sanctions');

    const admin = await mkUser({ role: 'ADMIN', totpEnabled: true });
    const ra = await appAdmin.inject({ method: 'POST', url: '/admin/users/creator-lookup', payload: { q: mintV5(c) }, headers: { cookie: await cookieFor(admin) } });
    assert.equal(ra.statusCode, 200, ra.body);
    assert.equal(ra.json().token.version, 5);
    assert.ok(ra.json().analysis.bans, 'an admin sees bans');
    assert.ok(!JSON.stringify(ra.json()).includes('@'), 'no e-mail address in the answer');

    const audits = await p.auditLogEntry.findMany({ where: { actorId: { in: [mod.id, admin.id] }, action: 'creator.fingerprint_lookup' } });
    assert.equal(audits.length, 2);
    assert.ok(audits.every((a) => a.detail.includes(c.cid)));
  });
});
