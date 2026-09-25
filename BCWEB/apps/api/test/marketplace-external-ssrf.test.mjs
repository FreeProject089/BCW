// A key_external product cannot make the API POST to an internal address.
//
// The trigger: a holder of a market-scoped grant (marketPower — delegated shop staff, not only
// admins) sets a product's externalUrl to an address inside the deployment, e.g.
// http://storage:9000/… or http://127.0.0.1:3000/…, and buys it. externalKey() POSTed there
// with a plain fetch and gave the buyer whatever the answer's `key` / `code` field held: a
// server-side request forgery with a readable reply.
//
// Here the "internal service" is a real listener on 127.0.0.1 that answers { key }. On the old
// code the key comes back; with safeFetch the loopback address is refused before any socket
// opens, and the listener sees no request at all.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.JWT_SECRET ||= 'marketplace-external-ssrf-test-secret';
const { externalKey } = await import('../src/routes/marketplace.mjs');

let server; let port; let hits = 0;
before(async () => {
  server = http.createServer((req, res) => { hits++; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ key: 'INTERNAL-SECRET' })); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
after(() => new Promise((r) => server.close(r)));

describe('externalKey', () => {
  test('the listener answers a direct request (control: the target is reachable)', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST' });
    assert.equal((await r.json()).key, 'INTERNAL-SECRET');
    hits = 0;
  });

  for (const host of ['127.0.0.1', 'localhost']) {
    test(`a product pointing at ${host} gets no key and sends nothing`, async () => {
      const product = { id: 'p1', name: 'x', externalUrl: `http://${host}:${port}/mint`, externalSecret: 's' };
      await assert.rejects(externalKey(product, 'u1'), (e) => e.code === 'external_failed');
      assert.equal(hits, 0, 'the internal listener received the POST');
    });
  }
});
