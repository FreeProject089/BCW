// The server's own signing identity, used for anything it hands out and later needs to
// be able to prove it produced: backup bundles, history exports.
//
// ONE key for all of them, deliberately. Two subsystems each minting their own would mean
// two public keys to publish, two to distribute, and two chances for an admin to check a
// file against the wrong one and conclude it was tampered with.
//
// Ed25519 rather than an HMAC, and this is the whole point of signing here: an HMAC can
// only be verified by whoever holds the secret, which means asking the same server that
// produced the artefact whether the artefact is genuine. That answers nothing precisely
// when it matters — when the server is what you are worried about. An asymmetric
// signature can be checked by anyone, on any machine, with nothing but the public key.
//
// The private key never leaves this module. It is generated on first use rather than
// shipped in config, so a fresh install has one without anybody having to remember.
import crypto from 'node:crypto';
import { db } from './lib.mjs';

const KEY = 'backup.signingKey';

/** Fetch (or create) the server keypair. PEM strings, so they survive JSON storage. */
export async function signingKey(p) {
  const prisma = p || (await db());
  const row = await prisma.adminSetting.findUnique({ where: { key: KEY } });
  if (row?.value?.privateKey && row?.value?.publicKey) return row.value;
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const value = {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    createdAt: new Date().toISOString(),
  };
  await prisma.adminSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  return value;
}

/** Detached base64 signature over exactly these bytes. */
export async function signBytes(bytes, p) {
  const { privateKey } = await signingKey(p);
  // Ed25519 signs the message itself — no digest argument, which is why every verify
  // recipe below and in the UI passes `-rawin`.
  return crypto.sign(null, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes), crypto.createPrivateKey(privateKey)).toString('base64');
}

/** What to publish so somebody else can check a signature without asking us anything. */
export async function publicVerifyInfo(p) {
  const { publicKey, createdAt } = await signingKey(p);
  return {
    publicKey,
    createdAt,
    algorithm: 'Ed25519',
    // Spelled out because a signature nobody knows how to check is decoration. Neither
    // command needs anything from this site beyond the file and the key.
    verify: [
      'printf %s "<the signature>" | base64 -d > artefact.sig',
      'openssl pkeyutl -verify -pubin -inkey server.pub -rawin -in <the file> -sigfile artefact.sig',
    ],
  };
}
