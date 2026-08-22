// The address ranges safeFetch refuses. A guard whose job is completeness needs a test
// that says which addresses it is complete ABOUT, or the next edit narrows it silently.
//
// This exists because two ranges were getting through: `fe80::/10` was matched as the text
// prefix "fe80", which covers fe80 but not fe81-fe8f, and `fec0::/10` (site-local) was not
// checked at all. Both are IPv6 ranges defined by bit length, and a text prefix cannot
// express a bit length — which is the actual lesson, and why the code computes the range now.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateIp } from '../src/lib/net.mjs';

const BLOCKED = [
    ['127.0.0.1', 'IPv4 loopback'],
    ['10.0.0.1', 'private 10/8'],
    ['172.16.0.1', 'private 172.16/12'],
    ['172.31.255.255', 'private 172.16/12, top of range'],
    ['192.168.1.1', 'private 192.168/16'],
    ['169.254.169.254', 'link-local — the cloud metadata address'],
    ['100.64.0.1', 'CGNAT 100.64/10'],
    ['0.0.0.0', 'the unspecified address'],
    ['224.0.0.1', 'multicast'],
    ['::1', 'IPv6 loopback'],
    ['::', 'IPv6 unspecified'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ['::ffff:169.254.169.254', 'IPv4-mapped metadata'],
    ['fc00::1', 'unique-local, bottom of fc00::/7'],
    ['fd00::1', 'unique-local'],
    ['fdff:ffff::1', 'unique-local, top of range'],
    ['fe80::1', 'link-local'],
    ['fe81::1', 'link-local — inside fe80::/10, missed by a "fe80" prefix test'],
    ['fe8f::1', 'link-local — same'],
    ['febf::1', 'link-local, top of fe80::/10'],
    ['fec0::1', 'site-local fec0::/10 — was not checked at all'],
    ['feff::1', 'site-local, top of range'],
    ['ff02::1', 'IPv6 multicast'],
    ['not-an-ip', 'unparseable → must fail closed'],
    ['', 'empty → must fail closed'],
];

// The control. Without these, a function that returned `true` unconditionally would pass
// every assertion above and the file would prove nothing.
const ALLOWED = [
    ['8.8.8.8', 'public IPv4'],
    ['1.1.1.1', 'public IPv4'],
    ['203.0.113.10', 'TEST-NET-3, public as far as routing is concerned'],
    ['172.15.0.1', 'just BELOW the private 172.16/12 range'],
    ['172.32.0.1', 'just ABOVE it'],
    ['100.63.0.1', 'just below CGNAT'],
    ['100.128.0.1', 'just above CGNAT'],
    ['2606:4700::1', 'public IPv6'],
    ['fe7f::1', 'just below fe80::/10'],
    ['fb00::1', 'just below fc00::/7'],
];

test('every private / reserved range is refused', () => {
    for (const [ip, why] of BLOCKED) {
        assert.equal(isPrivateIp(ip), true, `${ip} should be blocked — ${why}`);
    }
});

test('public addresses are allowed, including the ones adjacent to a blocked range', () => {
    for (const [ip, why] of ALLOWED) {
        assert.equal(isPrivateIp(ip), false, `${ip} should be allowed — ${why}`);
    }
});
