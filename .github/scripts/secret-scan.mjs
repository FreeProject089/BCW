#!/usr/bin/env node
// Secret scan for BCW, run by CI (job "Secret scan").
//
//   node .github/scripts/secret-scan.mjs              # scan the tracked files of this repository
//   node .github/scripts/secret-scan.mjs --dir <path> # scan a folder (not a git checkout: walks it)
//   node .github/scripts/secret-scan.mjs --selftest   # prove every shape is caught, and that empty
//                                                     # example values and fixture-style joins pass
//
// What it looks for: a Discord bot token, a Stripe secret / restricted key (live AND test) or
// webhook secret, and a private key with a body. Everywhere, INCLUDING `*.example` files: a real
// Discord bot token sat in `.env.example` from the initial commit, and the grep this replaces
// excluded exactly those files. Empty example values (`DISCORD_TOKEN=`) do not match any shape,
// so placeholders stay allowed.
//
// Still excluded: `*.md` and `guides/`, which quote shapes and truncated prefixes in prose.
//
// Why a script and not the one-line `git grep -E` it replaces: that pattern wrote the Discord shape
// with `\d` and `\w` INSIDE bracket expressions (`[A-Za-z\d]`, `[\w-]`). In a POSIX ERE those are a
// literal backslash plus a letter, so `[\w-]{6}` only accepted the characters `\`, `w` and `-`; the
// Discord pattern could not match a real token.
//
// Test fixtures build secret-shaped strings at run time (`'sk_' + 'live_' + ...`, see the note on
// push protection), so a literal shape in the tree is a real finding, never a fixture.
// Matches are printed redacted (first 10 characters): the job log is not a second leak.
//
// A committed fixture that predates that rule is listed in .github/secret-scan-allow.json by FILE
// and SHA-256 of the exact matched value, with a reason. The same file with any other value still
// fails, and an entry that no longer matches is reported so it gets removed.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve, relative, dirname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const SHAPES = [
  // Discord bot token: base64(user id).base64(timestamp).hmac. The id part starts M/N/O today.
  { name: 'Discord bot token', re: /(?<![A-Za-z0-9_-])[MNO][A-Za-z0-9_-]{23,27}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,40}(?![A-Za-z0-9_-])/g },
  // Stripe secret and restricted keys, live and test (a test key still reads and writes the account's test data).
  { name: 'Stripe secret key', re: /(?<![A-Za-z0-9_])(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{20,}/g },
  { name: 'Stripe webhook secret', re: /(?<![A-Za-z0-9_])whsec_[0-9A-Za-z]{24,}/g },
  // A PEM private key WITH a body (real newlines or escaped \n as in an env value). A code string
  // that only holds the header, or a placeholder "…", is not a key.
  { name: 'private key', re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----(?:\\r|\\n|\s)+[A-Za-z0-9+/=]{40,}/g },
];

const EXCLUDE = [/\.md$/i, /(^|\/)guides\//];
const SKIP_DIRS = new Set(['.git', 'node_modules', 'target', 'dist', 'build', '.turbo']);

function listTracked(root) {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter(Boolean);
}

function walk(root, dir = root, acc = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(root, p, acc);
    else if (st.isFile()) acc.push(relative(root, p).split(sep).join('/'));
  }
  return acc;
}

export function scanText(text) {
  const hits = [];
  for (const { name, re } of SHAPES) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const line = text.slice(0, m.index).split('\n').length;
      hits.push({ name, line, preview: m[0].slice(0, 10) + '…', sha256: createHash('sha256').update(m[0]).digest('hex') });
    }
  }
  return hits;
}

export function scan(root, files) {
  const findings = [];
  for (const f of files) {
    if (EXCLUDE.some(re => re.test(f))) continue;
    let buf;
    try {
      const st = statSync(join(root, f));
      if (!st.isFile() || st.size > 20 * 1024 * 1024) continue;
      buf = readFileSync(join(root, f));
    } catch { continue; } // deleted in the working tree
    if (buf.subarray(0, 8192).includes(0)) continue; // binary
    for (const h of scanText(buf.toString('utf8'))) findings.push({ file: f, ...h });
  }
  return findings;
}

function loadAllow(root) {
  try {
    const j = JSON.parse(readFileSync(join(root, '.github', 'secret-scan-allow.json'), 'utf8'));
    for (const e of j.allow || []) {
      if (!e.file || !/^[0-9a-f]{64}$/.test(e.sha256 || '') || !String(e.reason || '').trim()) {
        throw new Error(`entry ${JSON.stringify(e)} needs file, sha256 and reason`);
      }
    }
    return j.allow || [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    console.log(`::error::.github/secret-scan-allow.json: ${err.message}`);
    process.exit(2);
  }
}

function applyAllow(findings, allow) {
  const used = new Set();
  const left = findings.filter(x => {
    const e = allow.find(a => a.file === x.file && a.sha256 === x.sha256);
    if (!e) return true;
    used.add(e);
    console.log(`  allowed ${x.file}:${x.line} ${x.name} (${x.preview}) — ${e.reason}`);
    return false;
  });
  for (const e of allow) {
    if (!used.has(e)) console.log(`::warning::secret-scan-allow.json: ${e.file} ${e.sha256.slice(0, 12)} no longer matches — remove the entry`);
  }
  return left;
}

function report(findings, scanned) {
  for (const x of findings) {
    console.log(`::error file=${x.file},line=${x.line}::${x.name} shape in ${x.file}:${x.line} (${x.preview})`);
  }
  if (findings.length) {
    console.log(`${findings.length} real-looking secret(s) committed. Move the value to an env var / .env (gitignored),`);
    console.log('rotate it (it is public the moment it is pushed), and leave the .example value EMPTY.');
    return 1;
  }
  console.log(`No committed secrets detected (${scanned} files, *.example included; *.md and guides/ excluded).`);
  return 0;
}

function selftest() {
  // Every secret-shaped value below is JOINED at run time, the same rule as the test fixtures, so
  // this file itself never carries a shape and never trips the scan or GitHub push protection.
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const discord = 'M' + 'TIzNDU2Nzg5MDEyMzQ1Njc4' + '.' + 'Gh3Kx9' + '.' + A.slice(0, 38);
  const stripeLive = 's' + 'k_live_' + A.slice(10, 40);
  const stripeTest = 's' + 'k_test_' + A.slice(5, 35);
  const restricted = 'r' + 'k_live_' + A.slice(3, 33);
  const whsec = 'wh' + 'sec_' + A.slice(0, 32);
  const pem = '-----BEGIN ' + 'PRIVATE KEY-----\n' + 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7' + '\n-----END PRIVATE KEY-----\n';
  const pemEscaped = 'KEY="-----BEGIN ' + 'OPENSSH PRIVATE KEY-----\\n' + 'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtz' + '"';
  const dir = mkdtempSync(join(tmpdir(), 'secret-scan-selftest-'));
  const put = (p, s) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), s); };
  try {
    // Must be caught, one file each, inside `.example` files first (the gap being closed).
    const must = {
      'infra/.env.example': `DISCORD_TOKEN=${discord}\n`,
      'server/.env.example': `STRIPE_SECRET_KEY=${stripeLive}\n`,
      'a/test.env.example': `STRIPE_SECRET_KEY=${stripeTest}\n`,
      'b/.env.example': `STRIPE_RESTRICTED=${restricted}\n`,
      'c/.env.example': `STRIPE_WEBHOOK_SECRET=${whsec}\n`,
      'd/key.pem': pem,
      'e/.env.example': pemEscaped + '\n',
      'src/config.mjs': `export const token = '${discord}';\n`,
    };
    // Must pass: empty example values, short placeholders, a header-only code string, the fixture
    // idiom (joined at run time), and a real shape in a markdown file (excluded).
    const pass = {
      'ok/.env.example': 'DISCORD_TOKEN=\nSTRIPE_SECRET_KEY=\nSTRIPE_WEBHOOK_SECRET=\nPRIVATE_KEY=\n',
      'ok/placeholders.env.example': 'STRIPE_SECRET_KEY=sk_live_xxx\nSTRIPE_SECRET_KEY=sk_test_...\nDISCORD_TOKEN=your-bot-token\n',
      'ok/pem.mjs': "const head = '-----BEGIN PRIVATE KEY-----\\n' + b64 + '\\n-----END PRIVATE KEY-----';\n",
      'ok/fixture.test.mjs': "const key = 'sk_' + 'live_' + 'a'.repeat(24);\nconst tok = 'M' + 'x'.repeat(23) + '.' + 'y'.repeat(6) + '.' + 'z'.repeat(27);\n",
      'guides/SECRETS.md': `example: ${discord}\n`,
    };
    for (const [p, s] of Object.entries({ ...must, ...pass })) put(p, s);
    const found = scan(dir, walk(dir));
    const hitFiles = new Set(found.map(f => f.file));
    const missed = Object.keys(must).filter(p => !hitFiles.has(p));
    const falsePos = Object.keys(pass).filter(p => hitFiles.has(p));
    for (const f of found) console.log(`  caught  ${f.file}:${f.line} ${f.name} (${f.preview})`);
    if (missed.length || falsePos.length) {
      if (missed.length) console.log(`::error::selftest: NOT caught: ${missed.join(', ')}`);
      if (falsePos.length) console.log(`::error::selftest: false positive on: ${falsePos.join(', ')}`);
      return 1;
    }
    console.log(`selftest OK: ${Object.keys(must).length} planted secrets caught, ${Object.keys(pass).length} allowed files passed.`);
    return 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) process.exit(selftest());
  const i = args.indexOf('--dir');
  if (i >= 0) {
    const root = resolve(args[i + 1] || '.');
    const files = walk(root);
    process.exit(report(applyAllow(scan(root, files), loadAllow(root)), files.length));
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const files = listTracked(root);
  process.exit(report(applyAllow(scan(root, files), loadAllow(root)), files.length));
}
