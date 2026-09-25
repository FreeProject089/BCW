#!/usr/bin/env node
// The site CSP must not get 'unsafe-inline' back in script-src.
//
// WHY THIS EXISTS (SECURITY_SUMMARY §9 #5, F10-9)
//
// script-src carried 'unsafe-inline' for one reason: a six-line theme bootstrap inline in
// index.html. With it, every stored-markup bug became script execution: W1, W2 and A-4 were
// "an attribute got through the sanitiser" and turned into "a visitor runs the author's
// JavaScript", because the browser had been told inline script is fine. Without it, the same
// bugs are inert text.
//
// It comes back the easy way: somebody adds a small inline <script> to index.html, a Vite
// plugin injects one (the French preload did), a GA snippet is pasted as a string, an API
// page grows an onclick=, and the fix that "works" is to put 'unsafe-inline' back. So this
// checks the policy AND the things that would tempt someone to loosen it:
//
//   1. infra/caddy/Caddyfile: every Content-Security-Policy header. script-src has neither
//      'unsafe-inline' nor 'unsafe-eval' (nor a wildcard host), and connect-src is not
//      "any host" again (https:, http:, ws:, wss:, *). Every policy has a form-action, and the
//      site's is 'self' except on the two OAuth pages listed in section 1b.
//   2. apps/web/index.html: no inline executable <script> (a JSON-LD data block is not
//      executed, so it is allowed) and no on*= handler attribute.
//   3. apps/web/vite.config.js: no transformIndexHtml tag 'script' with `children`.
//   4. apps/web/src: no <script> element created and then given code as text.
//   5. apps/api/src: no inline <script> and no on*= attribute in HTML the API serves on the
//      site's origin (the OIDC logout page had onclick="history.back()").
//
// Usage: node scripts/check-csp.mjs [--caddyfile <path>] [--index <path>] [--vite <path>]
//   (the flags point the check at another copy, which is how it was proven red against the
//    policy it replaced)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..');
const BCWEB = join(WEB, '..', '..');
const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };

const CADDYFILE = arg('--caddyfile') || join(BCWEB, 'infra', 'caddy', 'Caddyfile');
const INDEX = arg('--index') || join(WEB, 'index.html');
const VITE = arg('--vite') || join(WEB, 'vite.config.js');

const fail = [];
const rel = (p) => relative(BCWEB, p).replace(/\\/g, '/');

// ── 1. The policy itself ────────────────────────────────────────────────────────────────
const caddy = readFileSync(CADDYFILE, 'utf8');
const policies = [];
caddy.split(/\r?\n/).forEach((line, i) => {
  const t = line.trim();
  if (t.startsWith('#')) return; // commented-out examples (the telemetry block keeps one)
  const m = /Content-Security-Policy\s+"([^"]*)"/.exec(t);
  if (m) policies.push({ line: i + 1, value: m[1] });
});
if (!policies.length) fail.push(`${rel(CADDYFILE)}: no Content-Security-Policy header found. The check reads the wrong file, or the policy is gone.`);

const directive = (policy, name) => {
  for (const part of policy.split(';')) {
    const toks = part.trim().split(/\s+/);
    if (toks[0] && toks[0].toLowerCase() === name) return toks.slice(1);
  }
  return null;
};

for (const p of policies) {
  const where = `${rel(CADDYFILE)}:${p.line}`;
  const script = directive(p.value, 'script-src') || directive(p.value, 'default-src');
  if (!script) { fail.push(`${where}: no script-src and no default-src: every script source is allowed.`); continue; }
  for (const bad of ["'unsafe-inline'", "'unsafe-eval'", '*', 'https:', 'http:', 'data:', 'blob:']) {
    if (script.some((s) => s.toLowerCase() === bad)) {
      fail.push(`${where}: script-src contains ${bad}.\n`
        + '    Move the inline code to a static file under apps/web/public/ (theme-boot.js is the\n'
        + '    example) or into the bundle; do not loosen the policy (SECURITY_SUMMARY §9 #5).');
    }
  }
  const connect = directive(p.value, 'connect-src');
  if (connect) {
    for (const bad of ['*', 'https:', 'http:', 'ws:', 'wss:']) {
      if (connect.includes(bad)) {
        fail.push(`${where}: connect-src contains ${bad} (any host).\n`
          + '    Name the host, or add it through CSP_CONNECT_SRC_EXTRA in .env.');
      }
    }
  }
}

// ── 1b. form-action ─────────────────────────────────────────────────────────────────────
// form-action does NOT fall back to default-src: a policy without it lets an injected <form>
// post anywhere (ZAP 10055-13, 2026-09-25). So every policy must carry it, and it must not be
// "any host" — except on the two pages whose form is meant to end on a third party's site
// (the OAuth consent page and the RP-initiated logout page: the POST answers with a redirect
// to the client's registered URL, and browsers check form-action against that redirect).
// The site policy writes it as a placeholder filled by a Caddy `map {path} …` block, so the
// check reads that block: the default must be exactly 'self', only these paths may widen it,
// and even they may not allow http: (other than loopback), data:, javascript: or *.
const FORM_ACTION_WIDENED_PATHS = new Set(['/authorize', '/oauth2/logout']);
const FORM_ACTION_NEVER = ['*', 'http:', 'data:', 'blob:', 'javascript:', "'unsafe-inline'", "'unsafe-eval'"];
const LOOPBACK_SOURCE = /^http:\/\/(localhost|127\.0\.0\.1)(:(\*|\d+))?$/i;

const maps = new Map();
for (const m of caddy.matchAll(/^[ \t]*map[ \t]+(\{[^}\s]+\})[ \t]+(\{[\w.]+\})[ \t]*\{[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\}/gm)) {
  const entries = [];
  for (const raw of m[3].split(/\r?\n/)) {
    const t = raw.trim();
    if (!t || t.startsWith('#')) continue;
    const e = /^(\S+)\s+(?:"([^"]*)"|(\S+))$/.exec(t);
    if (e) entries.push({ key: e[1], value: e[2] ?? e[3] });
    else entries.push({ key: t, value: null });
  }
  maps.set(m[2], { source: m[1], line: caddy.slice(0, m.index).split('\n').length, entries });
}

const badFormSources = (tokens, { widened }) => tokens.filter((s) => {
  const v = s.toLowerCase();
  if (FORM_ACTION_NEVER.includes(v)) return true;
  if (v.startsWith('http://')) return !(widened && LOOPBACK_SOURCE.test(v));
  if (v === 'https:') return !widened;
  return false;
});

for (const p of policies) {
  const where = `${rel(CADDYFILE)}:${p.line}`;
  const fa = directive(p.value, 'form-action');
  if (!fa || !fa.length) {
    fail.push(`${where}: no form-action directive. It does not fall back to default-src, so an injected\n`
      + "    form could post anywhere. Add `form-action 'self'` (or 'none' where no form belongs).");
    continue;
  }
  if (fa.length === 1 && /^\{[\w.]+\}$/.test(fa[0])) {
    const map = maps.get(fa[0]);
    if (!map) { fail.push(`${where}: form-action ${fa[0]} but no \`map … ${fa[0]} { … }\` block defines it: the policy would send an empty form-action.`); continue; }
    const at = `${rel(CADDYFILE)}:${map.line}`;
    if (map.source !== '{path}') fail.push(`${at}: the ${fa[0]} map reads ${map.source}; it must key on {path} (a header or query is the client's to choose).`);
    const def = map.entries.find((e) => e.key === 'default');
    if (!def || def.value !== "'self'") fail.push(`${at}: the ${fa[0]} map's default is ${def ? JSON.stringify(def.value) : 'missing'}; it must be exactly "'self'".`);
    for (const e of map.entries) {
      if (e.key === 'default') continue;
      if (e.value === null) { fail.push(`${at}: unreadable map line "${e.key}".`); continue; }
      if (!FORM_ACTION_WIDENED_PATHS.has(e.key)) {
        fail.push(`${at}: the ${fa[0]} map sets form-action for ${e.key}; only ${[...FORM_ACTION_WIDENED_PATHS].join(' and ')} may differ from 'self'.\n`
          + '    A page that needs another target is a reviewed change to this check, not a new map line.');
        continue;
      }
      const bad = badFormSources(e.value.split(/\s+/).filter(Boolean), { widened: true });
      if (bad.length) fail.push(`${at}: form-action for ${e.key} allows ${bad.join(' ')}.`);
    }
    continue;
  }
  const bad = badFormSources(fa, { widened: false });
  if (bad.length) fail.push(`${where}: form-action allows ${bad.join(' ')} (any host, or a scheme a form must never target).`);
}

// ── 2. index.html ───────────────────────────────────────────────────────────────────────
const html = readFileSync(INDEX, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  const attrs = m[1];
  const body = m[2].trim();
  if (/\bsrc\s*=/.test(attrs)) continue;
  if (/\btype\s*=\s*["']application\/(ld\+)?json["']/i.test(attrs)) continue; // data, not code
  if (body) fail.push(`${rel(INDEX)}: an inline <script> (${body.slice(0, 60).replace(/\s+/g, ' ')}…). Put it in public/ and load it with src=.`);
}
for (const m of html.matchAll(/<[a-z][^>]*\s(on[a-z]+)\s*=/gi)) {
  fail.push(`${rel(INDEX)}: an inline ${m[1]}= handler. The CSP refuses it; attach the listener from a script file.`);
}

// ── 3. Vite plugins injecting inline scripts ────────────────────────────────────────────
const vite = readFileSync(VITE, 'utf8');
// Not `[^}]*`: the attrs object has its own closing brace before `children`, which is exactly
// how the French preload's inline script would have slipped past.
for (const m of vite.matchAll(/tag:\s*['"]script['"][\s\S]{0,300}?\bchildren\s*:/g)) {
  const line = vite.slice(0, m.index).split('\n').length;
  fail.push(`${rel(VITE)}:${line}: a transformIndexHtml tag 'script' with children is an inline script.\n`
    + '    Pass data in a <meta> and read it from public/theme-boot.js, as the French preload does.');
}

// ── 4 & 5. Source trees ─────────────────────────────────────────────────────────────────
function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

let webFiles = 0;
for (const file of walk(join(WEB, 'src'), ['.js', '.jsx', '.mjs'])) {
  webFiles++;
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/(\w+)\s*=\s*document\.createElement\(\s*['"]script['"]\s*\)/g)) {
    const v = m[1];
    const isData = new RegExp(`${v}\\.type\\s*=\\s*['"]application/(ld\\+)?json['"]`).test(src);
    const asCode = new RegExp(`${v}\\.(textContent|text|innerHTML|innerText)\\s*=`).test(src);
    if (asCode && !isData) {
      fail.push(`${rel(file)}: a <script> created and given code as text (${v}). Run the code from the bundle instead (src/lib/gtm.js shows how for gtag).`);
    }
  }
}

let apiFiles = 0;
for (const file of walk(join(BCWEB, 'apps', 'api', 'src'), ['.mjs', '.js'])) {
  apiFiles++;
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    const inline = /<script(?![^>]*\bsrc\s*=)(?![^>]*application\/(ld\+)?json)[^>]*>/i.exec(line);
    if (inline) fail.push(`${rel(file)}:${i + 1}: an inline <script> in HTML the API serves on the site origin.`);
    const handler = /<[a-z][^<>]*\s(on[a-z]+)\s*=\s*["']/i.exec(line);
    if (handler) fail.push(`${rel(file)}:${i + 1}: an inline ${handler[1]}= handler in HTML the API serves on the site origin.`);
  });
}

if (fail.length) {
  console.error(`✗ csp: ${fail.length} problem(s)\n`);
  for (const f of fail) console.error(`  ${f}\n`);
  process.exit(1);
}
console.log(`✓ csp OK — ${policies.length} policy header(s) without 'unsafe-inline' in script-src, `
  + `connect-src bounded, form-action on every one; index.html, vite.config.js, ${webFiles} web and ${apiFiles} API file(s) carry no inline script`);
