// Pentest round 2, card R11 (Sept 24 2026): the status page's admin-configured monitors fetch a
// URL on every tick through lib/net.mjs `safeFetch`. Its IPv6 rule knew the ranges that ARE
// private (loopback, ULA, link-local, multicast, IPv4-mapped written as dotted quads), and
// treated every other IPv6 address as public. Several IPv6 forms CARRY an IPv4 address, and
// WHATWG URL rewrites them to hex, so the dotted-quad rule never saw it:
//   [::127.0.0.1]            → ::7f00:1             IPv4-compatible (::/96)
//   [64:ff9b::169.254.169.254] → 64:ff9b::a9fe:a9fe NAT64 well-known prefix: on an IPv6-only
//                                                   host with a NAT64 gateway this dials the v4
//   [2002:a9fe:a9fe::1]                              6to4, the v4 in bits 16-47
// plus reserved space outside 2000::/3 (the only global unicast block) and the documentation /
// discard / Teredo ranges. An IPv4-mapped address written in hex (`::ffff:7f00:1`, which is what
// URL produces from `::ffff:127.0.0.1`) was refused only because the fallback called the hex
// tail "unknown format", which also refused every PUBLIC mapped address.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateIp } from '../src/lib/net.mjs';
import { assertMonitorUrl } from '../src/lib/status-monitors.mjs';

const BLOCK = [
  ['::7f00:1', 'IPv4-compatible loopback'],
  ['::a9fe:a9fe', 'IPv4-compatible metadata'],
  ['64:ff9b::a9fe:a9fe', 'NAT64 to the metadata address'],
  ['64:ff9b::a00:1', 'NAT64 to 10.0.0.1'],
  ['64:ff9b::7f00:1', 'NAT64 to loopback'],
  ['64:ff9b:1::a00:1', 'NAT64 local-use prefix'],
  ['2002:a9fe:a9fe::1', '6to4 of the metadata address'],
  ['2002:7f00:1::1', '6to4 of loopback'],
  ['2002:c0a8:101::1', '6to4 of 192.168.1.1'],
  ['::ffff:7f00:1', 'IPv4-mapped loopback, hex (what URL writes)'],
  ['::ffff:a9fe:a9fe', 'IPv4-mapped metadata, hex'],
  ['::ffff:0:7f00:1', 'IPv4-translated loopback'],
  ['2001:0:4136:e378:8000:63bf:3fff:fdd2', 'Teredo'],
  ['2001:db8::1', 'documentation'],
  ['100::1', 'discard-only'],
  ['1::1', 'reserved, outside 2000::/3'],
  ['::1', 'loopback (control of the old rule)'],
  ['fd00:ec2::254', 'ULA metadata (control of the old rule)'],
];
const ALLOW = [
  ['2606:4700:4700::1111', 'Cloudflare DNS'],
  ['2a00:1450:4001:80b::200e', 'a Google address'],
  ['64:ff9b::808:808', 'NAT64 to a PUBLIC v4 (8.8.8.8): an IPv6-only host reaches the web this way'],
  ['2002:808:808::1', '6to4 of a public v4'],
  ['::ffff:808:808', 'IPv4-mapped public, hex'],
  ['::ffff:8.8.8.8', 'IPv4-mapped public, dotted'],
  ['8.8.8.8', 'public v4'],
];

for (const [ip, why] of BLOCK) test(`refused: ${ip} (${why})`, () => assert.equal(isPrivateIp(ip), true));
for (const [ip, why] of ALLOW) test(`allowed: ${ip} (${why})`, () => assert.equal(isPrivateIp(ip), false));

test('a monitor URL naming an embedded private v4 is refused at save, with no DNS at all', async () => {
  const noDns = async () => { throw new Error('DNS must not be asked about a literal'); };
  for (const url of ['http://[::127.0.0.1]:6379/', 'http://[64:ff9b::169.254.169.254]/latest/meta-data/', 'https://[2002:a9fe:a9fe::1]/', 'http://[::ffff:127.0.0.1]:5432/']) {
    await assert.rejects(assertMonitorUrl(url, noDns), /ssrf_blocked_ip/, url);
  }
  await assertMonitorUrl('http://[2606:4700:4700::1111]/', noDns);   // control
});

test('a name that RESOLVES to an embedded private v4 is refused', async () => {
  const resolve = async () => [{ address: '64:ff9b::a9fe:a9fe', family: 6 }];
  await assert.rejects(assertMonitorUrl('https://status.example.com/', resolve), /ssrf_blocked_resolved/);
});
