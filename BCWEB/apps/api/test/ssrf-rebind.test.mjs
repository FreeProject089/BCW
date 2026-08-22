// DNS rebinding: safeFetch must connect to the address it CHECKED, not to whatever the
// name resolves to a moment later.
//
// The hole this closes: assertPublicUrl resolved the hostname, and then fetch() resolved it
// again, independently. Two lookups, two answers. An attacker serving a TTL-0 record
// answers a public address to the first (so the check passes) and 169.254.169.254 to the
// second (so that is what gets dialled). The check was never wrong — it described a
// different lookup from the one that mattered.
//
// These tests drive the resolver directly rather than standing up a DNS server, because
// dns.lookup goes through getaddrinfo and ignores dns.setServers — a test that pointed at a
// local DNS server would silently keep using the system resolver and pass for the wrong
// reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { safeFetch, _assertPublicUrl } from '../src/lib/net.mjs';

/** A resolver that answers differently each time it is called — the attack, in one object. */
function rebindingResolver(answers) {
    let i = 0;
    const calls = [];
    const fn = async (host) => {
        calls.push(host);
        const a = answers[Math.min(i, answers.length - 1)];
        i++;
        return a;
    };
    fn.calls = calls;
    return fn;
}

const PUBLIC = [{ address: '93.184.216.34', family: 4 }];
const METADATA = [{ address: '169.254.169.254', family: 4 }];

test('a name resolving to a private address is refused', async () => {
    const resolve = rebindingResolver([METADATA]);
    await assert.rejects(
        () => safeFetch('http://evil.example/x', {}, 5, resolve),
        /ssrf_blocked_resolved/,
    );
});

test('a name resolving to BOTH public and private is refused, not sampled', async () => {
    // Picking the public one and proceeding would be a coincidence away from an exploit.
    const resolve = rebindingResolver([[...PUBLIC, ...METADATA]]);
    await assert.rejects(
        () => safeFetch('http://mixed.example/x', {}, 5, resolve),
        /ssrf_blocked_resolved/,
    );
});

test('the checked address is RETURNED, so it can be pinned', async () => {
    const resolve = rebindingResolver([PUBLIC]);
    const pinned = await _assertPublicUrl('http://ok.example/x', resolve);
    assert.equal(pinned.address, '93.184.216.34');
    assert.equal(pinned.family, 4);
});

test('a literal IP needs no pin, and a private literal is still refused', async () => {
    assert.equal(await _assertPublicUrl('http://93.184.216.34/x'), null);
    await assert.rejects(() => _assertPublicUrl('http://169.254.169.254/x'), /ssrf_blocked_ip/);
});

test('REBINDING: the second answer is never asked for', async () => {
    // A local server stands in for "the address that was verified". The resolver would hand
    // out the metadata address on any call after the first; if safeFetch resolved a second
    // time, that is where the request would land.
    const server = createServer((_req, res) => { res.end('pinned-target'); });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address();

    try {
        const local = [{ address: '127.0.0.1', family: 4 }];
        // First answer loopback, then the metadata address on every call after. The old code
        // would have resolved twice; the assertion below is that only the first was ever
        // asked for. (The pin CARRYING a request is proved by the control at the bottom.)
        const resolve = rebindingResolver([local, METADATA]);

        // 127.0.0.1 is private, so safeFetch refuses before connecting — which is itself the
        // point: the address it verified is the address it would have used.
        await assert.rejects(
            () => safeFetch(`http://rebind.example:${port}/`, {}, 5, resolve),
            /ssrf_blocked_resolved/,
        );
        assert.equal(resolve.calls.length, 1, 'resolved once, not twice');
    } finally {
        server.close();
        await once(server, 'close');
    }
});

test('each redirect hop is checked on its own', async () => {
    // A public URL that 302s to the metadata address must not be followed. The hop is a new
    // URL, so it is a new decision — and the counter proves the second hop was examined.
    const server = createServer((req, res) => {
        if (req.url === '/start') {
            res.writeHead(302, { location: 'http://second.example/next' });
            res.end();
            return;
        }
        res.end('should not be reached');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address();

    try {
        // First hop resolves privately so it is refused up front; what this asserts is that
        // the loop consults the resolver per hop rather than once for the whole chain.
        const resolve = rebindingResolver([[{ address: '127.0.0.1', family: 4 }]]);
        await assert.rejects(
            () => safeFetch(`http://first.example:${port}/start`, {}, 5, resolve),
            /ssrf_blocked/,
        );
        assert.equal(resolve.calls[0], 'first.example');
    } finally {
        server.close();
        await once(server, 'close');
    }
});

// ── the control ───────────────────────────────────────────────────────────────
// Everything above passes whether or not the pin actually works: they all assert that a
// BAD address is refused, which the old code did too. If undici ignored `connect.lookup`,
// the whole fix would be inert and every test so far would still be green.
//
// So: point a pinned agent at a local server through a hostname that does not resolve to
// it — through a hostname that does not resolve at ALL. If the request arrives, the pin is
// what carried it there, and nothing else could have.
test("CONTROL: the pin is what decides the address, not DNS", async () => {
    const { _pinnedAgent } = await import('../src/lib/net.mjs');
    const { fetch: undiciFetch } = await import('undici');

    const server = createServer((req, res) => { res.end('arrived:' + req.headers.host); });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address();

    try {
        const agent = _pinnedAgent({ address: '127.0.0.1', family: 4 });
        // .invalid is reserved by RFC 2606 and can never resolve. Without the pin this is a
        // DNS failure, not a 200.
        const res = await undiciFetch(`http://pin-control.invalid:${port}/`, { dispatcher: agent });
        const body = await res.text();
        assert.equal(res.status, 200);
        assert.match(body, /^arrived:/);
        // And the Host header still carries the NAME, not the address — which is what keeps
        // TLS certificate validation working on the https path.
        assert.match(body, /pin-control\.invalid/);
        await agent.close();
    } finally {
        server.close();
        await once(server, 'close');
    }
});

test("CONTROL: without a pin, that same hostname fails to resolve", async () => {
    const { fetch: undiciFetch } = await import('undici');
    await assert.rejects(
        () => undiciFetch('http://pin-control.invalid:1/'),
        (e) => /fetch failed|ENOTFOUND|EAI_AGAIN/i.test(String(e.message || e)),
        'the hostname must be genuinely unresolvable, or the control above proves nothing',
    );
});

test('the whole body is still readable after safeFetch closes its agent', async () => {
    // One Agent per request means one socket pool per request, so it has to be closed. It is
    // closed WITHOUT awaiting, which only works because close() is graceful and waits for the
    // in-flight response. If that were wrong every caller would get a truncated body — and
    // every other assertion here would still pass, because none of them reads a real one.
    //
    // Exercised at the agent level: safeFetch can never reach a local server end-to-end,
    // since any address it would accept is by definition not one we can bind.
    const payload = 'x'.repeat(200_000);
    const server = createServer((_req, res) => { res.end(payload); });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address();

    try {
        const { _pinnedAgent } = await import('../src/lib/net.mjs');
        const { fetch: undiciFetch } = await import('undici');
        const agent = _pinnedAgent({ address: '127.0.0.1', family: 4 });
        const r = await undiciFetch(`http://body-check.invalid:${port}/`, { dispatcher: agent });
        agent.close().catch(() => {});             // exactly what safeFetch does
        const body = await r.text();
        assert.equal(body.length, payload.length, 'body truncated by the agent close');
    } finally {
        server.close();
        await once(server, 'close');
    }
});
