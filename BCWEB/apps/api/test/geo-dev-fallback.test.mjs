// The dev geo fallback must never run in production.
//
// geoOf() invents a country, region, city and coordinates when it cannot see the client IP,
// so that a developer's localhost traffic populates the analytics screens. The trigger is
// not "we are in dev" — it is `isPrivateIp(clientIp(req))`, which is ALSO true in
// production whenever the client IP is not visible: a request that reaches the API inside
// the Docker network, or a proxy that dropped X-Forwarded-For. Those rows would land in
// AnalyticsEvent indistinguishable from real visits, and be charted as fact.
//
// NODE_ENV is read at import time, so each case imports the module fresh with a cache
// buster — setting the variable after the first import would prove nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const req = (ip) => ({ headers: { 'user-agent': 'test' }, ip });

async function geoWith(nodeEnv, ip) {
    const before = process.env.NODE_ENV;
    const beforeDev = process.env.ANALYTICS_DEV_GEO;
    process.env.NODE_ENV = nodeEnv;
    delete process.env.ANALYTICS_DEV_GEO;
    try {
        const mod = await import(`../src/lib/geo.mjs?case=${nodeEnv}-${ip}`);
        return await mod.geoOf(req(ip));
    } finally {
        if (before === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = before;
        if (beforeDev !== undefined) process.env.ANALYTICS_DEV_GEO = beforeDev;
    }
}

test('production + unresolvable client IP → no location at all', async () => {
    const g = await geoWith('production', '127.0.0.1');
    assert.equal(g.country, null, 'a country was invented for a request with no visible IP');
    assert.equal(g.region, null);
    assert.equal(g.city, null);
    assert.equal(g.lat, null);
    assert.equal(g.lng, null);
});

test('production + a private LAN IP → still no location', async () => {
    // 10/8 reaches here from inside a Docker network, which is a real production path.
    const g = await geoWith('production', '10.1.2.3');
    assert.equal(g.country, null);
    assert.equal(g.city, null);
});

test('a CDN country header is still honoured in production', async () => {
    // The header is real data from the edge, not a guess, so the production gate must not
    // throw it away along with the invented cities.
    const mod = await import('../src/lib/geo.mjs?case=header');
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
        const g = await mod.geoOf({ headers: { 'cf-ipcountry': 'FR', 'user-agent': 'x' }, ip: '127.0.0.1' });
        assert.equal(g.country, 'FR');
    } finally {
        if (before === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = before;
    }
});

test('outside production the fallback still fills the screens', async () => {
    // The convenience it exists for: a developer on localhost sees populated maps. The
    // sample cities are real places, so whatever comes back must be a usable location.
    const g = await geoWith('development', '127.0.0.1');
    assert.match(String(g.country), /^[A-Z]{2}$/, 'dev traffic should still resolve to somewhere');
    assert.ok(Number.isFinite(g.lat) && Number.isFinite(g.lng), 'and to real coordinates');
});
