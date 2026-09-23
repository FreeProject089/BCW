// D7 / pentest R11: an admin-configured status check fetches a URL on a schedule. That is an
// SSRF primitive unless every fetch refuses internal targets. These tests prove the refusals
// with a target that WOULD answer: a local server counts its hits, and each refused probe must
// leave the count at zero (a refusal that still connected would pass a naive assertion).
//
// Network: none. Literal public addresses go through undici's global dispatcher, which is a
// MockAgent here with real connections disabled; names are resolved by an injected resolver.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';
import {
  staticUrlCheck, assertMonitorUrl, probeMonitor, monitorsSchema, BODY_CAP, runMonitors,
} from '../src/lib/status-monitors.mjs';

const mon = (url, extra = {}) => ({ id: 'c_test', label: 'Test', url, method: 'GET', okMin: 200, okMax: 399, keyword: '', timeoutMs: 2000, enabled: true, ...extra });
const answers = (list) => async () => list;
const PRIVATE_ANSWERS = {
  loopback: [{ address: '127.0.0.1', family: 4 }],
  rfc1918: [{ address: '10.1.2.3', family: 4 }],
  metadata: [{ address: '169.254.169.254', family: 4 }],
  ula6: [{ address: 'fd00::5', family: 6 }],
  mixed: [{ address: '93.184.216.34', family: 4 }, { address: '192.168.1.10', family: 4 }],
};

let server; let port; let hits = 0;
let mock; let prevDispatcher;
before(async () => {
  server = createServer((_req, res) => { hits++; res.end('internal secret'); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  port = server.address().port;
  prevDispatcher = getGlobalDispatcher();
  mock = new MockAgent();
  mock.disableNetConnect();
  setGlobalDispatcher(mock);
});
after(async () => {
  server.close();
  await once(server, 'close');
  setGlobalDispatcher(prevDispatcher);
  await mock.close();
});

test('only http and https, and no credentials in the URL', () => {
  for (const u of ['file:///etc/passwd', 'gopher://x/', 'ftp://example.com/', 'javascript:alert(1)', 'data:text/plain,x', 'not a url']) {
    assert.throws(() => staticUrlCheck(u), /ssrf_bad_(scheme|url)/, u);
  }
  assert.throws(() => staticUrlCheck('http://user:pw@example.com/'), /ssrf_credentials/);
  assert.throws(() => staticUrlCheck('http://public.example@10.0.0.1/'), /ssrf_credentials/);
  assert.ok(staticUrlCheck('https://example.com/health'));
});

test('SAVE refuses every internal range, literal or behind a name', async () => {
  const literals = [
    `http://127.0.0.1:${port}/`, 'http://10.0.0.1/', 'http://172.16.5.4/', 'http://192.168.0.1/',
    'http://169.254.169.254/latest/meta-data/', 'http://100.64.0.1/', 'http://0.0.0.0/',
    'http://[::1]/', 'http://[fd00::1]/', 'http://[fe80::1]/', 'http://[::ffff:127.0.0.1]/',
  ];
  for (const u of literals) await assert.rejects(() => assertMonitorUrl(u), /ssrf_blocked/, u);
  for (const u of ['http://localhost/', 'http://db.internal/', 'http://printer.local/']) {
    await assert.rejects(() => assertMonitorUrl(u), /ssrf_blocked_host/, u);
  }
  for (const [name, list] of Object.entries(PRIVATE_ANSWERS)) {
    await assert.rejects(() => assertMonitorUrl('http://looks-public.example/', answers(list)), /ssrf_blocked_resolved/, name);
  }
  // The control: a name answering only public addresses passes. Without it, a check that
  // refused everything would pass every assertion above.
  await assertMonitorUrl('http://ok.example/', answers([{ address: '93.184.216.34', family: 4 }]));
});

test('PROBE refuses an internal target and never connects to it', async () => {
  hits = 0;
  const lit = await probeMonitor(mon(`http://127.0.0.1:${port}/`));
  assert.equal(lit.ok, null, 'refused by policy is "cannot tell", never an outage');
  assert.equal(lit.error, 'ssrf_blocked_ip');
  // A name that resolves to loopback AFTER the save (DNS changed): refused at probe time.
  const rebound = await probeMonitor(mon(`http://status.example:${port}/`), { resolve: answers(PRIVATE_ANSWERS.loopback) });
  assert.equal(rebound.ok, null);
  assert.equal(rebound.error, 'ssrf_blocked_resolved');
  assert.equal(hits, 0, 'the internal server was never reached');
});

test('a public target that redirects inward is refused at the hop', async () => {
  const pool = mock.get('http://93.184.216.34');
  pool.intercept({ path: '/health', method: 'GET' }).reply(302, '', { headers: { location: 'http://169.254.169.254/latest/meta-data/' } });
  const r = await probeMonitor(mon('http://93.184.216.34/health'));
  assert.equal(r.ok, null);
  assert.equal(r.error, 'ssrf_blocked_ip');
  // And to a name that resolves inward.
  pool.intercept({ path: '/health2', method: 'GET' }).reply(301, '', { headers: { location: `http://inner.example:${port}/` } });
  hits = 0;
  const r2 = await probeMonitor(mon('http://93.184.216.34/health2'), { resolve: answers(PRIVATE_ANSWERS.rfc1918) });
  assert.equal(r2.ok, null);
  assert.equal(r2.error, 'ssrf_blocked_resolved');
  assert.equal(hits, 0);
});

test('a public target is probed: status range, keyword, and a body read capped at BODY_CAP', async () => {
  const pool = mock.get('http://93.184.216.34');
  pool.intercept({ path: '/up', method: 'GET' }).reply(200, 'all good');
  assert.deepEqual((await probeMonitor(mon('http://93.184.216.34/up'))).ok, true);
  pool.intercept({ path: '/err', method: 'GET' }).reply(503, 'down');
  const down = await probeMonitor(mon('http://93.184.216.34/err'));
  assert.equal(down.ok, false);
  assert.equal(down.status, 503);
  assert.equal(down.error, 'bad_status');
  pool.intercept({ path: '/kw', method: 'GET' }).reply(200, 'status: ok');
  assert.equal((await probeMonitor(mon('http://93.184.216.34/kw', { keyword: 'status: ok' }))).ok, true);
  // The keyword sits just past the cap, so finding it would mean more than BODY_CAP was read.
  pool.intercept({ path: '/big', method: 'GET' }).reply(200, 'x'.repeat(BODY_CAP) + 'MARK');
  const big = await probeMonitor(mon('http://93.184.216.34/big', { keyword: 'MARK' }));
  assert.equal(big.ok, false);
  assert.equal(big.error, 'keyword_missing');
});

test('a probe that does not answer in time is down, with a timeout', async () => {
  const pool = mock.get('http://93.184.216.34');
  pool.intercept({ path: '/slow', method: 'GET' }).reply(200, 'late').delay(4000);
  const t0 = Date.now();
  const r = await probeMonitor(mon('http://93.184.216.34/slow', { timeoutMs: 1000 }));
  assert.equal(r.ok, false);
  assert.equal(r.error, 'timeout');
  assert.ok(Date.now() - t0 < 3500, 'the timeout cut it short');
});

test('the stored shape is bounded', () => {
  assert.equal(monitorsSchema.safeParse([mon('https://example.com/', { id: 'bad id' })]).success, false);
  assert.equal(monitorsSchema.safeParse([mon('https://example.com/', { timeoutMs: 60000 })]).success, false);
  assert.equal(monitorsSchema.safeParse(Array.from({ length: 21 }, (_, i) => mon('https://example.com/', { id: `c_m${i}` }))).success, false);
  assert.equal(monitorsSchema.safeParse([mon('https://example.com/')]).success, true);
});

test('runMonitors reads the stored list and never throws on a refused one', async () => {
  const p = { adminSetting: { findUnique: async () => ({ value: [mon(`http://127.0.0.1:${port}/`, { id: 'c_inner' })] }) } };
  hits = 0;
  const res = await runMonitors(p);
  assert.equal(res.c_inner.ok, null);
  assert.equal(hits, 0);
});
