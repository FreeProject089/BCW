// Putting the bot's icons on Discord from the site, and the offline kit (E2, pentest R5).
//
// What this pins down:
//   · the site's upload is IDEMPOTENT by name: an icon already on the application at its
//     current drawing is never sent again, whoever put it there, and a second run uploads
//     nothing;
//   · it is a REST client only, to discord.com, with the token in one header and in no answer,
//     no error message and no stored row;
//   · the downloadable scripts are FIXED FILES: the bytes served are the same whatever the
//     database holds, they contain no token, no shared secret and no stored string, and they
//     fetch nothing to execute.
//
// Discord is never called for real: every test injects `fetch`. The pure half runs everywhere;
// the HTTP half needs DATABASE_URL (as CI provides) and restores every row it touches.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
process.env.JWT_SECRET ||= 'emoji-sync-test-secret';
const { planIconSync, syncIconBatch, discordClient, scrubber, mapFromDiscord, discordWait, SYNC_BATCH_MAX } = await import('../src/lib/app-emoji-sync.mjs');
const { KIT_FILES, buildEmojiKit } = await import('../src/lib/emoji-kit.mjs');
const { findSecrets } = await import('../src/lib/secret-guard.mjs');

const TOKEN = 'MTEST0000000000000000000000.GAbcde.planted_token_value_for_the_test_0001';
const APP = '111111111111111111';
let idSeq = 200000000000000000n;
const nextId = () => String(idSeq++);

/** A fake Discord: GET @me, GET/POST emojis, with a call log. */
function fakeDiscord({ items = [], fail = {}, status401 = false } = {}) {
  const state = { items: items.map((e) => ({ ...e })), calls: [] };
  state.fetch = async (url, init = {}) => {
    const u = new URL(url);
    state.calls.push({ method: init.method || 'GET', host: u.host, path: u.pathname, auth: init.headers?.authorization, body: init.body });
    const json = (status, body) => ({ status, ok: status >= 200 && status < 300, headers: new Headers(), json: async () => body });
    if (status401) return json(401, { message: `401: Unauthorized for Bot ${TOKEN}`, code: 0 });
    if (u.pathname === '/api/v10/applications/@me') return json(200, { id: APP, name: 'bot' });
    if (u.pathname === `/api/v10/applications/${APP}/emojis` && (init.method || 'GET') === 'GET') return json(200, { items: state.items });
    if (u.pathname === `/api/v10/applications/${APP}/emojis` && init.method === 'POST') {
      const b = JSON.parse(init.body);
      if (fail[b.name]) return json(400, { message: `Invalid Form Body (echo ${TOKEN})`, code: 50035 });
      const e = { id: nextId(), name: b.name, animated: false };
      state.items.push(e);
      return json(201, e);
    }
    return json(404, { message: 'Unknown' });
  };
  return state;
}

const KEYS = [
  { key: 'shop', version: 'aaaaaaaa', label: 'Shop' },
  { key: 'casino', version: 'bbbbbbbb', label: 'Casino' },
  { key: 'gift', version: 'cccccccc', label: 'Gift' },
];

describe('planIconSync (pure)', () => {
  test('present / mismatched / missing, against what Discord really has; foreign emojis ignored', () => {
    const plan = planIconSync(KEYS, [
      { id: '300000000000000001', name: 'bc_shop_aaaaaaaa' },
      { id: '300000000000000002', name: 'bc_casino_00000000' },
      { id: '300000000000000003', name: 'party_parrot' },
    ]);
    assert.deepEqual(plan.map((s) => [s.key, s.status]), [['shop', 'present'], ['casino', 'mismatched'], ['gift', 'missing']]);
    assert.deepEqual(plan[1].older, ['bc_casino_00000000']);
    assert.equal(plan[2].want, 'bc_gift_cccccccc');
  });
  test('mapFromDiscord keeps only names and ids the site accepts', () => {
    const m = mapFromDiscord([{ id: '300000000000000001', name: 'bc_shop_aaaaaaaa' }, { id: '12', name: 'bad_id' }, { id: '300000000000000002', name: 'Bad-Name' }, { id: '300000000000000003', name: 'gif_one', animated: true }]);
    assert.deepEqual(m.emojis, { bc_shop_aaaaaaaa: '300000000000000001', gif_one: '300000000000000003' });
    assert.deepEqual(m.animated, ['gif_one']);
    assert.equal(m.skipped, 2);
  });
});

describe('syncIconBatch (Discord mocked)', () => {
  const png = async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]);

  test('an icon already there is skipped and never POSTed; a second run uploads nothing', async () => {
    const d = fakeDiscord({ items: [{ id: '300000000000000001', name: 'bc_shop_aaaaaaaa' }] });
    const call = discordClient({ token: TOKEN, fetch: d.fetch, sleep: async () => {} });
    const r1 = await syncIconBatch({ call, keys: KEYS, renderPng: png });
    assert.deepEqual(r1.results.map((r) => [r.key, r.status]), [['shop', 'skipped'], ['casino', 'uploaded'], ['gift', 'uploaded']]);
    const posted = d.calls.filter((c) => c.method === 'POST').map((c) => JSON.parse(c.body).name);
    assert.deepEqual(posted, ['bc_casino_bbbbbbbb', 'bc_gift_cccccccc']);
    const r2 = await syncIconBatch({ call, keys: KEYS, renderPng: png });
    assert.ok(r2.results.every((r) => r.status === 'skipped'), JSON.stringify(r2.results));
    assert.equal(d.calls.filter((c) => c.method === 'POST').length, 2, 'the second run POSTed nothing');
  });

  test('at most `max` uploads per batch, the rest pending; `wanted` limits the batch', async () => {
    const many = Array.from({ length: SYNC_BATCH_MAX + 3 }, (_, i) => ({ key: `k${i}x`, version: 'dddddddd' }));
    const d = fakeDiscord();
    const call = discordClient({ token: TOKEN, fetch: d.fetch, sleep: async () => {} });
    const r = await syncIconBatch({ call, keys: many, renderPng: png });
    assert.equal(r.results.filter((x) => x.status === 'uploaded').length, SYNC_BATCH_MAX);
    assert.equal(r.results.filter((x) => x.status === 'pending').length, 3);
    const only = await syncIconBatch({ call, keys: many, wanted: [`k${SYNC_BATCH_MAX + 2}x`], renderPng: png });
    assert.deepEqual(only.results.map((x) => [x.key, x.status]), [[`k${SYNC_BATCH_MAX + 2}x`, 'uploaded']]);
  });

  test('one refused icon is reported by name and the others go on; the error carries no token', async () => {
    const d = fakeDiscord({ fail: { bc_casino_bbbbbbbb: true } });
    const call = discordClient({ token: TOKEN, fetch: d.fetch, sleep: async () => {} });
    const r = await syncIconBatch({ call, keys: KEYS, renderPng: png, scrub: scrubber(TOKEN) });
    assert.deepEqual(r.results.map((x) => [x.key, x.status]), [['shop', 'uploaded'], ['casino', 'failed'], ['gift', 'uploaded']]);
    const failed = r.results.find((x) => x.status === 'failed');
    assert.match(failed.error, /400/);
    assert.ok(!failed.error.includes(TOKEN), failed.error);
  });

  test('a rejected token stops the batch at once, with a scrubbed message', async () => {
    const d = fakeDiscord({ status401: true });
    const call = discordClient({ token: TOKEN, fetch: d.fetch, sleep: async () => {} });
    await assert.rejects(syncIconBatch({ call, keys: KEYS, renderPng: png }), (e) => e.code === 'bad_token' && !e.message.includes(TOKEN));
    assert.equal(d.calls.length, 1);
  });

  test('only discord.com is called, and the token only ever travels in the Authorization header', async () => {
    const d = fakeDiscord();
    const call = discordClient({ token: TOKEN, fetch: d.fetch, sleep: async () => {} });
    await syncIconBatch({ call, keys: KEYS, renderPng: png });
    assert.ok(d.calls.length >= 3);
    for (const c of d.calls) {
      assert.equal(c.host, 'discord.com');
      assert.equal(c.auth, `Bot ${TOKEN}`);
      assert.ok(!String(c.body || '').includes(TOKEN));
      assert.ok(!c.path.includes(TOKEN));
    }
  });

  test('a 429 is waited out, then retried', async () => {
    let n = 0; const waits = [];
    const fetch = async () => {
      n += 1;
      if (n === 1) return { status: 429, ok: false, headers: new Headers(), json: async () => ({ retry_after: 1.5 }) };
      return { status: 200, ok: true, headers: new Headers(), json: async () => ({ id: APP }) };
    };
    const call = discordClient({ token: TOKEN, fetch, sleep: async (ms) => { waits.push(ms); } });
    assert.deepEqual(await call('GET', '/applications/@me'), { id: APP });
    assert.deepEqual(waits, [1750]);
    assert.equal(discordWait(200, new Headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '2' })), 2100);
  });
});

// ── The offline kit: fixed scripts (pentest R5) ─────────────────────────────────────────────
const SCRIPTS = ['sync-icons.bat', 'sync-icons.sh'];

describe('the downloadable scripts are fixed code', () => {
  test('no secret shape, no site address, no templating hole, nothing fetched to run', () => {
    for (const name of SCRIPTS) {
      const s = KIT_FILES[name].body;
      assert.deepEqual(findSecrets({ s }), [], `${name} carries something shaped like a secret`);
      // Only Discord's API and the User-Agent's project URL; never the site's API.
      const urls = [...s.matchAll(/https?:\/\/[^\s'")]+/g)].map((m) => m[0].replace(/[,.]$/, ''));
      assert.deepEqual([...new Set(urls)].sort(), ['https://bettercommunity.ch', 'https://discord.com/api/v10'], `${name}: ${urls}`);
      assert.ok(!/\$\{|\{\{|__[A-Z_]+__/.test(s), `${name} has a placeholder`);
      assert.ok(!/DownloadString|DownloadFile|Invoke-WebRequest|Invoke-RestMethod|\bcurl\b|\bwget\b|\bexec\(|\beval\(|bitsadmin|certutil/i.test(s.replace(/exec python3 -c/, '')), `${name} fetches or evals something`);
      assert.ok(!/x-bot-secret|BOT_SHARED_SECRET|BCWEB_API_URL/i.test(s), `${name} talks to the site`);
    }
  });
  test('the .bat has CRLF endings (cmd.exe needs them), the .sh LF only', () => {
    const bat = KIT_FILES['sync-icons.bat'].body, sh = KIT_FILES['sync-icons.sh'].body;
    assert.ok(bat.includes('\r\n') && !/[^\r]\n/.test(bat));
    assert.ok(!sh.includes('\r'));
    assert.match(sh, /^#!\/bin\/sh\n/);
  });
  test('the zip carries the scripts byte for byte, and names icons by the strict shape only', async () => {
    const AdmZip = (await import('adm-zip')).default;
    const { zip, count } = await buildEmojiKit([{ key: 'shop', want: 'bc_shop_aaaaaaaa' }, { key: 'evil', want: '../../evil' }, { key: 'x', want: 'bc_x_zzzzzzzz' }], async () => Buffer.from([1, 2, 3]));
    assert.equal(count, 1);
    const z = new AdmZip(zip);
    const names = z.getEntries().map((e) => e.entryName).sort();
    assert.deepEqual(names, ['bettercommunity-icons/README.txt', 'bettercommunity-icons/icons/bc_shop_aaaaaaaa.png', 'bettercommunity-icons/sync-icons.bat', 'bettercommunity-icons/sync-icons.sh']);
    for (const n of SCRIPTS) assert.equal(z.readAsText(`bettercommunity-icons/${n}`), KIT_FILES[n].body);
  });
});

// ── Over HTTP, with the dev database ────────────────────────────────────────────────────────
const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres (see CI) to run the emoji-sync route tests';
const MAIL = '@emoji-sync.test';
const PLANT_KEY = 'e2plantedkey';
const PLANT_LABEL = 'PLANTED-LABEL-e2-3f9c';
let p, app, jwt, adminC, userC, savedMap, savedCustom, savedEnvToken, realStoredToken;

async function cookieFor(u) {
  const s = await p.session.create({ data: { userId: u.id }, select: { id: true } });
  return `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: s.id }, process.env.JWT_SECRET)}`;
}
const restore = async (key, row) => {
  if (row) await p.adminSetting.upsert({ where: { key }, create: { key, value: row.value }, update: { value: row.value } });
  else await p.adminSetting.deleteMany({ where: { key } });
};

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  jwt = (await import('jsonwebtoken')).default;
  savedMap = await p.adminSetting.findUnique({ where: { key: 'bot.appEmojis' } });
  savedCustom = await p.adminSetting.findUnique({ where: { key: 'bot.customIcons' } });
  realStoredToken = (await p.adminSetting.findUnique({ where: { key: 'bot.token' } }))?.value?.token || null;
  savedEnvToken = process.env.DISCORD_TOKEN;
  process.env.DISCORD_TOKEN = TOKEN; // env wins over the stored one: the stored row is never touched
  // A stored string an attacker could control: a custom icon's label and key.
  const icons = { ...(savedCustom?.value?.icons || {}), [PLANT_KEY]: { source: 'glyph', icon: 'star', color: '#123456', label: PLANT_LABEL, addedAt: new Date().toISOString() } };
  await p.adminSetting.upsert({ where: { key: 'bot.customIcons' }, create: { key: 'bot.customIcons', value: { icons } }, update: { value: { ...(savedCustom?.value || {}), icons } } });
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/bot-emoji.mjs')).default);
  await app.ready();
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const admin = await p.user.create({ data: { email: `a${stamp}${MAIL}`, displayName: 'emoji admin', role: 'SUPERADMIN', totpEnabled: true, emailVerified: true, status: 'active' } });
  const user = await p.user.create({ data: { email: `u${stamp}${MAIL}`, displayName: 'emoji user', emailVerified: true, status: 'active' } });
  [adminC, userC] = await Promise.all([cookieFor(admin), cookieFor(user)]);
});

after(async () => {
  if (!RUN) return;
  if (savedEnvToken === undefined) delete process.env.DISCORD_TOKEN; else process.env.DISCORD_TOKEN = savedEnvToken;
  await restore('bot.appEmojis', savedMap);
  await restore('bot.customIcons', savedCustom);
  const users = await p.user.findMany({ where: { email: { endsWith: MAIL } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await p.auditLogEntry?.deleteMany?.({ where: { actorId: { in: ids } } }).catch(() => {});
    await p.session.deleteMany({ where: { userId: { in: ids } } });
    await p.user.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
  }
  await app?.close();
});

const as = (cookie, opts) => app.inject({ headers: { cookie }, ...opts });
const withFetch = async (f, fn) => { const real = globalThis.fetch; globalThis.fetch = f; try { return await fn(); } finally { globalThis.fetch = real; } };

describe('emoji sync over HTTP', { skip }, () => {
  test('a member who is not staff gets nothing', async () => {
    for (const [method, url] of [['POST', '/admin/bot/emoji-sync'], ['POST', '/admin/bot/emoji-sync/check'], ['GET', '/admin/bot/emoji-kit.zip'], ['GET', '/admin/bot/emoji-kit/sync-icons.bat']]) {
      const r = await as(userC, { method, url, payload: method === 'POST' ? {} : undefined });
      assert.ok([401, 403].includes(r.statusCode), `${method} ${url} -> ${r.statusCode}`);
    }
  });

  test('check, then batches until nothing is pending; idempotent; the map follows; no token in any answer', async () => {
    const d = fakeDiscord({ items: [{ id: '300000000000000009', name: 'party_parrot' }] });
    await withFetch(d.fetch, async () => {
      const c = await as(adminC, { method: 'POST', url: '/admin/bot/emoji-sync/check', payload: {} });
      assert.equal(c.statusCode, 200, c.body);
      assert.ok(!c.body.includes(TOKEN));
      const before = c.json();
      assert.equal(before.canUpload, true);
      assert.ok(before.counts.missing >= 2, JSON.stringify(before.counts));
      const want = before.icons.filter((s) => s.status !== 'present').map((s) => s.key).slice(0, 7);
      assert.ok(want.includes(PLANT_KEY) || want.length === 7);
      let pending = want, rounds = 0, uploaded = 0;
      while (pending.length && rounds < 5) {
        const r = await as(adminC, { method: 'POST', url: '/admin/bot/emoji-sync', payload: { keys: pending } });
        assert.equal(r.statusCode, 200, r.body);
        assert.ok(!r.body.includes(TOKEN));
        const b = r.json();
        assert.ok(b.results.filter((x) => x.status === 'uploaded').length <= b.batchMax);
        uploaded += b.results.filter((x) => x.status === 'uploaded').length;
        pending = b.pending; rounds += 1;
      }
      assert.equal(uploaded, want.length);
      // Again: everything asked for is already there, so nothing is POSTed.
      const posts = d.calls.filter((x) => x.method === 'POST').length;
      const again = await as(adminC, { method: 'POST', url: '/admin/bot/emoji-sync', payload: { keys: want } });
      assert.ok(again.json().results.every((x) => x.status === 'skipped'));
      assert.equal(d.calls.filter((x) => x.method === 'POST').length, posts);
      assert.ok(d.calls.every((x) => x.host === 'discord.com'));
      // The stored map is Discord's list now, foreign emoji included; the token is not in it.
      const row = await p.adminSetting.findUnique({ where: { key: 'bot.appEmojis' } });
      assert.equal(row.value.source, 'site');
      assert.equal(row.value.emojis.party_parrot, '300000000000000009');
      assert.ok(!JSON.stringify(row.value).includes(TOKEN));
      const st = (await as(adminC, { method: 'GET', url: '/admin/bot/emoji-status' })).json();
      for (const k of want) assert.equal(st.icons.find((s) => s.key === k).status, 'present', k);
    });
  });

  test('a rejected token is a 400 bad_token whose message does not echo it', async () => {
    const d = fakeDiscord({ status401: true });
    await withFetch(d.fetch, async () => {
      const r = await as(adminC, { method: 'POST', url: '/admin/bot/emoji-sync', payload: {} });
      assert.equal(r.statusCode, 400);
      assert.equal(r.json().error, 'bad_token');
      assert.ok(!r.body.includes(TOKEN));
    });
  });

  test('the served scripts are the fixed files, whatever is stored, and carry none of it (R5)', async () => {
    const planted = [TOKEN, PLANT_KEY, PLANT_LABEL, process.env.BOT_SHARED_SECRET, process.env.LINK_LOOKUP_SECRET, process.env.JWT_SECRET, realStoredToken].filter((x) => x && x.length >= 6);
    const served = {};
    for (const name of SCRIPTS) {
      const r = await as(adminC, { method: 'GET', url: `/admin/bot/emoji-kit/${name}` });
      assert.equal(r.statusCode, 200);
      assert.match(r.headers['content-disposition'], new RegExp(`attachment; filename="${name.replace('.', '\\.')}"`));
      served[name] = r.body;
      assert.equal(r.body, KIT_FILES[name].body, `${name} is not the fixed file`);
      for (const s of planted) assert.ok(!r.body.includes(s), `${name} contains a stored string or secret`);
    }
    // The zip: same bytes for the scripts; the planted icon is there as a PNG, named by its key only.
    const z = await as(adminC, { method: 'GET', url: '/admin/bot/emoji-kit.zip' });
    assert.equal(z.statusCode, 200);
    const AdmZip = (await import('adm-zip')).default;
    const zip = new AdmZip(z.rawPayload);
    for (const name of SCRIPTS) assert.equal(zip.readAsText(`bettercommunity-icons/${name}`), served[name]);
    const readme = zip.readAsText('bettercommunity-icons/README.txt');
    for (const s of planted) assert.ok(!readme.includes(s), 'README carries a stored string');
    assert.ok(zip.getEntries().some((e) => new RegExp(`^bettercommunity-icons/icons/bc_${PLANT_KEY}_[0-9a-f]{8}\\.png$`).test(e.entryName)));
    // Change what is stored: the scripts do not move by a byte.
    await p.adminSetting.update({ where: { key: 'bot.customIcons' }, data: { value: { icons: { [PLANT_KEY]: { source: 'glyph', icon: 'heart', color: '#654321', label: `${PLANT_LABEL}-2` } } } } });
    for (const name of SCRIPTS) assert.equal((await as(adminC, { method: 'GET', url: `/admin/bot/emoji-kit/${name}` })).body, served[name]);
    assert.equal((await as(adminC, { method: 'GET', url: '/admin/bot/emoji-kit/..%2Fbot-emoji.mjs' })).statusCode, 404);
    assert.equal((await as(adminC, { method: 'GET', url: '/admin/bot/emoji-kit/constructor' })).statusCode, 404);
  });
});
