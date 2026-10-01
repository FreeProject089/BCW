#!/usr/bin/env node
// The site must stay installable. landing2 (agent-landing).
//
// WHY THIS EXISTS
//
// Installability fails silently. Chrome simply never fires `beforeinstallprompt`, the corner
// card (ui/pwa-install.jsx) never appears, and nothing anywhere says why: the manifest lost
// its 192px icon, the worker lost its fetch handler, the CSP stopped allowing the worker, and
// the site looks exactly the same. So this checks the criteria from the files that decide them:
//
//   1. public/manifest.webmanifest: parses; has id, name, short_name, start_url, scope, a
//      standalone-type display, theme_color and background_color; start_url inside scope;
//      every icon file exists, and a PNG's real pixel size matches what `sizes` claims; there
//      is a 192x192 and a 512x512 PNG for "any" and at least one "maskable".
//   2. scripts/sw-source.js has a `fetch` listener (Chrome's installability rule for years,
//      and the worker is what makes the offline page work).
//   3. vite.config.js injects <link rel="manifest"> and emits sw.js; lib/pwa.js registers
//      /sw.js with scope '/'; main.jsx calls registerServiceWorker; App mounts the card.
//   4. infra/caddy/Caddyfile: the site CSP lets the worker and the manifest load from 'self'
//      (worker-src, else script-src/default-src; manifest-src, else default-src).
//   5. index.html's apple-touch-icon points at a file that exists (iOS uses it on Add to
//      Home Screen; a transparent one is drawn on black).
//
// Usage: node scripts/check-pwa.mjs [--manifest <path>] [--index <path>]
//   (the flags point it at another copy, which is how it was proven red on the manifest it replaced)
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUB = join(WEB, 'public');
const CADDY = join(WEB, '..', '..', 'infra', 'caddy', 'Caddyfile');
const fail = [];
const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const read = (p) => readFileSync(p, 'utf8');

// ── 1. The manifest ──────────────────────────────────────────────────────────────────
let man = null;
try { man = JSON.parse(read(arg('--manifest') || join(PUB, 'manifest.webmanifest'))); } catch (e) { fail.push(`manifest.webmanifest does not parse: ${e.message}`); }
if (man) {
  for (const k of ['id', 'name', 'short_name', 'start_url', 'scope', 'display', 'theme_color', 'background_color']) {
    if (!man[k] || typeof man[k] !== 'string') fail.push(`manifest: "${k}" is missing or not a string.`);
  }
  if (man.display && !['standalone', 'fullscreen', 'minimal-ui'].includes(man.display)) fail.push(`manifest: display "${man.display}" is not installable (standalone, fullscreen or minimal-ui).`);
  if (man.start_url && man.scope && !new URL(man.start_url, 'https://x/').pathname.startsWith(new URL(man.scope, 'https://x/').pathname)) fail.push('manifest: start_url is outside scope.');
  if (man.short_name && man.short_name.length > 15) {
    // Not a hard rule, but the launcher cuts it. Keep it a warning so the owner decides.
    console.warn(`check-pwa: short_name "${man.short_name}" is ${man.short_name.length} characters; launchers show about 12.`);
  }
  const icons = Array.isArray(man.icons) ? man.icons : [];
  const pngSize = (file) => {
    const b = readFileSync(file);
    if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
    return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
  };
  const found = { any192: false, any512: false, maskable: false };
  for (const ic of icons) {
    const file = join(PUB, String(ic.src || '').replace(/^\//, ''));
    if (!ic.src || !existsSync(file)) { fail.push(`manifest: icon ${ic.src} does not exist in public/.`); continue; }
    const purposes = String(ic.purpose || 'any').split(/\s+/);
    if (ic.type === 'image/png') {
      const real = pngSize(file);
      if (!real) { fail.push(`manifest: ${ic.src} is declared image/png and is not a PNG.`); continue; }
      if (ic.sizes !== real) fail.push(`manifest: ${ic.src} says sizes "${ic.sizes}" and is ${real}.`);
      if (purposes.includes('any') && real === '192x192') found.any192 = true;
      if (purposes.includes('any') && real === '512x512') found.any512 = true;
    }
    if (purposes.includes('maskable')) found.maskable = true;
  }
  if (!found.any192) fail.push('manifest: no 192x192 PNG icon with purpose "any".');
  if (!found.any512) fail.push('manifest: no 512x512 PNG icon with purpose "any".');
  if (!found.maskable) fail.push('manifest: no "maskable" icon (Android crops the plain one into a circle).');
}

// ── 2. The worker ──────────────────────────────────────────────────────────────────────
const sw = read(join(WEB, 'scripts', 'sw-source.js'));
if (!/addEventListener\(\s*['"]fetch['"]/.test(sw)) fail.push('scripts/sw-source.js has no fetch listener: the site is not installable without one.');

// ── 3. The wiring ──────────────────────────────────────────────────────────────────────
const vite = read(join(WEB, 'vite.config.js'));
if (!/rel:\s*'manifest'/.test(vite) || !/href:\s*'\/manifest\.webmanifest'/.test(vite)) fail.push('vite.config.js no longer injects <link rel="manifest" href="/manifest.webmanifest">.');
if (!/fileName:\s*'sw\.js'/.test(vite)) fail.push('vite.config.js no longer emits sw.js.');
const pwa = read(join(WEB, 'src', 'lib', 'pwa.js'));
if (!/register\(\s*'\/sw\.js'\s*,\s*\{\s*scope:\s*'\/'\s*\}/.test(pwa)) fail.push("src/lib/pwa.js does not register('/sw.js', { scope: '/' }).");
if (!/registerServiceWorker\(\)/.test(read(join(WEB, 'src', 'main.jsx')))) fail.push('src/main.jsx does not call registerServiceWorker().');
const app = read(join(WEB, 'src', 'App.jsx'));
if (!/<PwaInstallPrompt\s*\/>/.test(app)) fail.push('src/App.jsx does not mount <PwaInstallPrompt />: beforeinstallprompt would be kept and never offered.');
const inst = read(join(WEB, 'src', 'lib', 'pwa-install.js'));
if (!/addEventListener\(\s*'beforeinstallprompt'/.test(inst)) fail.push('src/lib/pwa-install.js no longer listens for beforeinstallprompt.');

// ── 4. The CSP ─────────────────────────────────────────────────────────────────────────
if (existsSync(CADDY)) {
  const directive = (policy, name) => {
    for (const part of policy.split(';')) {
      const toks = part.trim().split(/\s+/);
      if (toks[0] && toks[0].toLowerCase() === name) return toks.slice(1);
    }
    return null;
  };
  const selfOk = (list) => !!list && (list.includes("'self'") || list.includes('*'));
  let n = 0;
  read(CADDY).split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('#')) return;
    const m = /Content-Security-Policy\s+"([^"]*)"/.exec(t);
    if (!m || /\bsandbox\b/.test(m[1])) return; // the sandboxed file-serving policy is not a page that installs
    // A frame-ancestors-only policy (the telemetry origin, framed by the OS mode) restricts no
    // loading at all and is not the site's: nothing to check here.
    if (m[1].split(';').map((x) => x.trim()).filter(Boolean).every((d) => /^frame-ancestors\s/i.test(d))) return;
    n += 1;
    const p = m[1];
    const worker = directive(p, 'worker-src') || directive(p, 'script-src') || directive(p, 'default-src');
    const manifest = directive(p, 'manifest-src') || directive(p, 'default-src');
    if (!selfOk(worker)) fail.push(`Caddyfile:${i + 1}: the CSP does not allow the service worker from 'self' (worker-src).`);
    if (!selfOk(manifest)) fail.push(`Caddyfile:${i + 1}: the CSP does not allow the manifest from 'self' (manifest-src / default-src).`);
  });
  if (!n) fail.push('Caddyfile: no site Content-Security-Policy found; the check reads the wrong file.');
}

// ── 5. iOS ─────────────────────────────────────────────────────────────────────────────
const html = read(arg('--index') || join(WEB, 'index.html'));
const touch = /<link\s+rel="apple-touch-icon"\s+href="([^"]+)"/.exec(html);
if (!touch) fail.push('index.html has no apple-touch-icon.');
else if (!existsSync(join(PUB, touch[1].replace(/^\//, '')))) fail.push(`index.html: apple-touch-icon ${touch[1]} does not exist in public/.`);

if (fail.length) {
  console.error('check-pwa: the site would not be installable, or not cleanly:\n  - ' + fail.join('\n  - '));
  process.exit(1);
}
console.log('check-pwa: manifest, icons, worker, wiring and CSP are installable.');
