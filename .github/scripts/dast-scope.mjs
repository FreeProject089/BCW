#!/usr/bin/env node
// DAST scope check. Runs BEFORE ZAP or Nuclei send anything, and fails closed.
//
//   node .github/scripts/dast-scope.mjs --target <url> --mode <local|staging>
//
// local    the instance the DAST job starts inside the runner. Only localhost / 127.0.0.1 /
//          [::1] are accepted: a "local" scan that points anywhere else is a mistake.
// staging  a deployed staging site, from the repository variable DAST_STAGING_URL. Accepted
//          only when ALL of these hold:
//            · the host is written, exactly, in the repository variable DAST_ALLOWED_HOSTS
//              (comma- or space-separated; no wildcards — a scan target is named, not matched);
//            · it is not production: not bettercommunity.ch nor anything under it, and not the
//              production VPS address 45.145.164.20 (both hard-coded below, so no variable can
//              switch them off), and not in DAST_DENY_HOSTS (each entry denies that host AND its
//              subdomains; deny always wins over allow);
//            · it resolves, none of its addresses is 45.145.164.20, and none is an address of a
//              denied host. A staging
//              name that is a CNAME to the production box is production, whatever it is called.
//              If a denied host cannot be resolved, the comparison cannot be made and the check
//              fails rather than assuming.
//
// Exit 0 = in scope, 1 = refused, 2 = usage error. On GitHub Actions it also writes to
// $GITHUB_OUTPUT: `host`, `origin`, and `sinkhole` — `--add-host` arguments that point every
// literal denied name at an address nothing answers on, passed to the scanner containers so a
// redirect or a link to production cannot be followed even if a scanner ignored its scope.

import { lookup } from 'node:dns/promises';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Production. Every entry denies the name and all of its subdomains. Not configurable. */
export const HARD_DENY = Object.freeze(['bettercommunity.ch']);
/** The production VPS. Refused as a literal target AND as an address any target resolves to. */
export const HARD_DENY_ADDRS = Object.freeze(['45.145.164.20']);
/** Names resolved for the address comparison (a wildcard cannot be resolved). */
const HARD_DENY_RESOLVE = Object.freeze(['bettercommunity.ch', 'www.bettercommunity.ch', 'telemetry.bettercommunity.ch']);
/** Where the sinkhole points. Loopback, a port nothing listens on in the job: refused at once. */
export const SINKHOLE_ADDR = '127.0.0.9';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

const list = (v) => String(v || '').split(/[\s,]+/).map((s) => normalHost(s)).filter(Boolean);

/** Lower-case, no trailing dot, no brackets around IPv6. */
function normalHost(h) {
  return String(h || '').trim().toLowerCase().replace(/\.+$/, '');
}

const under = (host, domain) => host === domain || host.endsWith('.' + domain);

async function addresses(resolver, host) {
  const r = await resolver(host);
  // node's lookup(all) gives [{address}], the tests give strings.
  return (Array.isArray(r) ? r : [r]).map((a) => (typeof a === 'string' ? a : a.address));
}

const defaultResolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/**
 * Decide. Never sends a request; only DNS lookups, and only in staging mode.
 * @returns {{ ok: boolean, reason: string, host?: string, origin?: string, sinkhole?: string[] }}
 */
export async function checkScope({ target, mode, env = process.env, resolver = defaultResolver }) {
  const refuse = (reason) => ({ ok: false, reason });
  if (!['local', 'staging'].includes(mode)) return refuse(`unknown mode "${mode}" (expected local or staging)`);

  let u;
  try { u = new URL(String(target || '')); } catch { return refuse(`target ${JSON.stringify(target)} is not a URL`); }
  if (!['http:', 'https:'].includes(u.protocol)) return refuse(`target scheme ${u.protocol} is not http or https`);
  if (u.username || u.password) return refuse('target carries credentials in the URL; pass them another way');
  const host = normalHost(u.hostname);
  if (!host) return refuse('target has no host');

  const extraDeny = list(env.DAST_DENY_HOSTS);
  const sinkhole = [...new Set([...HARD_DENY_RESOLVE, ...extraDeny.filter((h) => !h.includes('*') && !h.startsWith('['))])]
    .map((h) => `--add-host=${h}:${SINKHOLE_ADDR}`);

  // Production first, in both modes, before anything else is considered.
  const prod = HARD_DENY.find((d) => under(host, d));
  if (prod) return refuse(`${host} is production (${prod} and its subdomains are never a DAST target)`);
  if (HARD_DENY_ADDRS.includes(host)) return refuse(`${host} is the production server's address`);
  const denied = extraDeny.find((d) => under(host, d.replace(/^\*\./, '')));
  if (denied) return refuse(`${host} is denied by DAST_DENY_HOSTS (${denied})`);

  if (mode === 'local') {
    if (!LOCAL_HOSTS.has(host)) return refuse(`local mode only scans this machine (localhost, 127.0.0.1, [::1]); got ${host}`);
    return { ok: true, reason: `local instance ${u.origin}`, host, origin: u.origin, sinkhole };
  }

  // staging
  const allowed = list(env.DAST_ALLOWED_HOSTS);
  if (!allowed.length) return refuse('DAST_ALLOWED_HOSTS is empty: no staging host is authorised');
  if (!allowed.includes(host)) return refuse(`${host} is not in DAST_ALLOWED_HOSTS (${allowed.join(', ')}); an allow list is exact, no wildcards`);

  let mine;
  try { mine = await addresses(resolver, host); } catch (e) { return refuse(`could not resolve ${host} (${e.code || e.message}); nothing to scan`); }
  if (!mine.length) return refuse(`${host} resolved to no address`);
  const onProd = mine.filter((a) => HARD_DENY_ADDRS.includes(a));
  if (onProd.length) return refuse(`${host} resolves to the production server's address (${onProd.join(', ')})`);
  const compare = [...new Set([...HARD_DENY_RESOLVE, ...extraDeny.filter((h) => !h.includes('*'))])];
  for (const d of compare) {
    let theirs;
    try { theirs = await addresses(resolver, d); } catch (e) {
      // A deny name that does not exist (NXDOMAIN) has no address to share, so there is nothing
      // to compare — except the production apex, which must resolve: if it does not, DNS is
      // broken and "no overlap" would be a guess.
      if (e.code === 'ENOTFOUND' && d !== HARD_DENY[0]) continue;
      return refuse(`could not resolve ${d} (${e.code || e.message}) to compare addresses; refusing rather than assuming ${host} is not production`);
    }
    const shared = mine.filter((a) => theirs.includes(a));
    if (shared.length) return refuse(`${host} resolves to the same address as ${d} (${shared.join(', ')}): that is the production machine`);
  }
  return { ok: true, reason: `staging host ${host} is allowlisted and shares no address with a denied host`, host, origin: u.origin, sinkhole };
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] === '--target') a.target = argv[i + 1];
    else if (argv[i] === '--mode') a.mode = argv[i + 1];
    else return null;
  }
  return a.target !== undefined && a.mode ? a : null;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error('usage: dast-scope.mjs --target <url> --mode <local|staging>');
    process.exit(2);
  }
  const r = await checkScope(args);
  if (!r.ok) {
    console.log(`::error title=DAST scope::REFUSED ${args.target} (${args.mode}): ${r.reason}`);
    console.log('No scanner was started. Fix the target or the repository variables (see BCWEB/guides/run/SECURITY_CI_EN.md).');
    process.exit(1);
  }
  console.log(`DAST scope OK: ${r.reason}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `host=${r.host}\norigin=${r.origin}\nsinkhole=${r.sinkhole.join(' ')}\n`);
  }
  process.exit(0);
}
