// "Link Discord" from Profile › Sign-in methods, driven through the real routes with the
// provider stubbed at `fetch`. Against a real database, with namespaced fixtures.
//
// What this pins, and why each case exists:
//
//   · A sign-in link left on a CLOSED account is not "another BetterCommunity account". It is
//     a leftover: closures run between the closure sweeper (Aug 14) and the day
//     anonymiseAccount learned to delete OAuthAccount rows (Sep 5) kept them. The callback
//     answered "already linked to another account" for an account nobody can sign in to, and
//     the "Continue with Discord" button signed people INTO that closed account.
//   · A link held by a LIVE account is still refused, and the row does not move. That is the
//     account-takeover guard; relaxing it is the one fix this must never become.
//   · The bot's DiscordLink (economy / roster) is not a sign-in link and must never produce
//     the "already linked" answer.
//   · A Link click whose session did not survive the round trip is refused, instead of
//     silently creating a second account (which is how a person ends up with a Discord
//     "linked to another account" they never knowingly made).
//   · The CSRF binding from the September pentest (SECURITY_AUDIT.md, finding 1) still holds:
//     a callback without the browser's bind cookie links nothing.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres to run the OAuth link tests';
process.env.JWT_SECRET ||= 'oauth-link-test-secret';
process.env.DISCORD_CLIENT_ID ||= 'test-discord-client';
process.env.DISCORD_CLIENT_SECRET ||= 'test-discord-secret';

const MAIL = '@oauth-link.test';
let p, app, jwt, realFetch;
let seq = 0;
const ids = [];
// Discord ids far outside the real snowflake range in use, so no fixture can collide with a
// real member's row in a developer database.
const did = () => `9${Date.now()}${String(seq++).padStart(3, '0')}`;
// What the stubbed Discord says about "whoever just authorised". Set per test.
let who = null;

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  jwt = (await import('jsonwebtoken')).default;
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.startsWith('https://discord.com/api/oauth2/token')) return new Response(JSON.stringify({ access_token: 'stub-token' }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.startsWith('https://discord.com/api/users/@me')) return new Response(JSON.stringify({ id: who.id, username: who.username, global_name: who.username, avatar: null, verified: true, email: who.email }), { status: 200, headers: { 'content-type': 'application/json' } });
    return realFetch(url, init);
  };
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/oauth.mjs')).default);
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  globalThis.fetch = realFetch;
  // Fire-and-forget side effects (badges, economy merge) may still be landing.
  await new Promise((r) => setTimeout(r, 300));
  const users = await p.user.findMany({ where: { OR: [{ email: { endsWith: MAIL } }, { id: { in: ids } }] }, select: { id: true } });
  const uids = users.map((u) => u.id);
  if (uids.length) {
    await p.oAuthAccount.deleteMany({ where: { userId: { in: uids } } });
    await p.oAuthLinkProposal.deleteMany({ where: { userId: { in: uids } } });
    await p.discordLink.deleteMany({ where: { userId: { in: uids } } });
    await p.session.deleteMany({ where: { userId: { in: uids } } });
    await p.notification.deleteMany({ where: { userId: { in: uids } } });
    await p.passwordReset.deleteMany({ where: { userId: { in: uids } } }).catch(() => {});
    await p.userBadge.deleteMany({ where: { userId: { in: uids } } }).catch(() => {});
    await p.userEconomy.deleteMany({ where: { userId: { in: uids } } }).catch(() => {});
    await p.loginAttempt?.deleteMany?.({ where: { userId: { in: uids } } }).catch(() => {});
    // The first-run marker a new account gets (lib/onboarding.mjs) is a settings row, not a relation.
    await p.adminSetting.deleteMany({ where: { key: { in: uids.map((id) => `onboarding:${id}`) } } });
    await p.user.deleteMany({ where: { id: { in: uids } } });
  }
  const left = await p.user.count({ where: { OR: [{ email: { endsWith: MAIL } }, { id: { in: ids } }] } });
  assert.equal(left, 0, 'fixtures left behind');
  await app?.close();
  await p?.$disconnect?.();
});

const mkUser = async (over = {}) => {
  const u = await p.user.create({ data: { email: `u${Date.now()}-${seq++}${MAIL}`, displayName: `oauth-${seq}`, emailVerified: true, status: 'active', ...over } });
  ids.push(u.id);
  return u;
};
// A real session row + token, exactly what issueSession mints.
async function sessionCookie(user) {
  const s = await p.session.create({ data: { userId: user.id }, select: { id: true } });
  return `bcw_session=${jwt.sign({ uid: user.id, role: user.role, sid: s.id }, process.env.JWT_SECRET, { expiresIn: '1h' })}`;
}
const cookiesOf = (r) => [].concat(r.headers['set-cookie'] || []).map((c) => c.split(';')[0]).filter((c) => !/=;?$/.test(c) && !/=$/.test(c));

/** Start → provider (stubbed) → callback. Returns the callback's redirect target. */
async function runFlow({ session = '', startQuery = '', dropBind = false } = {}) {
  const start = await app.inject({ method: 'GET', url: `/auth/oauth/discord/start${startQuery}`, headers: session ? { cookie: session } : {} });
  assert.equal(start.statusCode, 302, start.body);
  const state = new URL(start.headers.location).searchParams.get('state');
  const bind = cookiesOf(start).find((c) => c.startsWith('bcw_oauth='));
  const cookie = [session, dropBind ? '' : bind].filter(Boolean).join('; ');
  const cb = await app.inject({ method: 'GET', url: `/auth/oauth/discord/callback?code=stub-code&state=${encodeURIComponent(state)}`, headers: cookie ? { cookie } : {} });
  assert.equal(cb.statusCode, 302, cb.body);
  return { location: cb.headers.location, cookies: cookiesOf(cb) };
}

describe('link a sign-in provider from the profile', { skip }, () => {
  test('a link left on a CLOSED account is reclaimed, not reported as "another account"', async () => {
    const id = did();
    const gone = await mkUser({ closedAt: new Date(), displayName: 'Closed account' });
    await p.user.update({ where: { id: gone.id }, data: { email: `closed+${gone.id}@account.invalid` } });
    await p.oAuthAccount.create({ data: { userId: gone.id, provider: 'discord', providerAccountId: id, username: 'old' } });
    const me = await mkUser();
    who = { id, username: 'reclaimer', email: `other-${id}${MAIL}` };
    const { location } = await runFlow({ session: await sessionCookie(me), startQuery: '?intent=link' });
    assert.match(location, /linked=discord/, `expected a link, got ${location}`);
    const row = await p.oAuthAccount.findUnique({ where: { provider_providerAccountId: { provider: 'discord', providerAccountId: id } } });
    assert.equal(row?.userId, me.id, 'the row now belongs to the signed-in account');
  });

  test('a link held by a LIVE account is refused and does not move (takeover guard)', async () => {
    const id = did();
    const holder = await mkUser();
    await p.oAuthAccount.create({ data: { userId: holder.id, provider: 'discord', providerAccountId: id, username: 'theirs' } });
    const me = await mkUser();
    who = { id, username: 'theirs', email: `x-${id}${MAIL}` };
    const mine = await sessionCookie(me);
    const { location, cookies } = await runFlow({ session: mine, startQuery: '?intent=link' });
    assert.match(location, /link_error=already_linked/, location);
    assert.doesNotMatch(location, /@|holder|email/i, 'nothing about the holder rides in the URL');
    const row = await p.oAuthAccount.findUnique({ where: { provider_providerAccountId: { provider: 'discord', providerAccountId: id } } });
    assert.equal(row.userId, holder.id, 'the row stayed with its owner');
    // The refusal says WHICH account, to the person who just proved they control the provider
    // identity (and so could already sign in to that account with it).
    const conflict = cookies.find((c) => c.startsWith('bcw_link_conflict='));
    assert.ok(conflict, 'conflict details are handed to the profile page');
    let r = await app.inject({ method: 'GET', url: '/me/oauth/conflict', headers: { cookie: `${mine}; ${conflict}` } });
    assert.equal(r.statusCode, 200, r.body);
    const c = r.json().conflict;
    assert.equal(c.provider, 'discord');
    assert.equal(c.handle, 'theirs');
    assert.equal(c.holder.displayName, holder.displayName);
    assert.ok(c.holder.email.includes('*') && !c.holder.email.startsWith(holder.email.split('@')[0]), 'the address is masked');
    // Bound to the account it was refused for: somebody else's session reads nothing.
    const other = await mkUser();
    r = await app.inject({ method: 'GET', url: '/me/oauth/conflict', headers: { cookie: `${await sessionCookie(other)}; ${conflict}` } });
    assert.equal(r.json().conflict, null);
  });

  test('suspended is still an account: its link is refused too', async () => {
    const id = did();
    const holder = await mkUser({ status: 'suspended' });
    await p.oAuthAccount.create({ data: { userId: holder.id, provider: 'discord', providerAccountId: id } });
    const me = await mkUser();
    who = { id, username: 'susp', email: `s-${id}${MAIL}` };
    const { location } = await runFlow({ session: await sessionCookie(me), startQuery: '?intent=link' });
    assert.match(location, /link_error=already_linked/, location);
  });

  test('your OWN existing link is not "another account"', async () => {
    const id = did();
    const me = await mkUser();
    await p.oAuthAccount.create({ data: { userId: me.id, provider: 'discord', providerAccountId: id } });
    who = { id, username: 'mine', email: `m-${id}${MAIL}` };
    const { location } = await runFlow({ session: await sessionCookie(me), startQuery: '?intent=link' });
    assert.match(location, /linked=discord/, location);
  });

  test('a bot DiscordLink held by someone else is not a sign-in link', async () => {
    const id = did();
    const botSide = await mkUser();
    await p.discordLink.create({ data: { userId: botSide.id, discordId: id, username: 'roster' } });
    const me = await mkUser();
    who = { id, username: 'roster', email: `b-${id}${MAIL}` };
    const { location } = await runFlow({ session: await sessionCookie(me), startQuery: '?intent=link' });
    assert.match(location, /linked=discord/, location);
    assert.match(location, /roster=held/, 'the person is told the bot link stayed elsewhere');
    const dl = await p.discordLink.findUnique({ where: { discordId: id } });
    assert.equal(dl.userId, botSide.id, 'the roster link is left where it was');
  });

  test('a Link click that arrives signed out creates no account', async () => {
    const id = did();
    who = { id, username: 'nobody', email: `n-${id}${MAIL}` };
    // Counted by THIS provider identity's address, not across the whole table: the suite runs
    // its files in parallel, and any other file creating a user between the two counts made
    // a global count read as a ghost account.
    const ghosts = () => p.user.count({ where: { email: { equals: who.email, mode: 'insensitive' } } });
    const before = await ghosts();
    const { location, cookies } = await runFlow({ startQuery: '?intent=link' });
    assert.match(location, /link_error=signed_out/, location);
    assert.equal(await ghosts(), before, 'no ghost account');
    assert.ok(!cookies.some((c) => c.startsWith('bcw_session=')), 'no session issued');
    assert.equal(await p.oAuthAccount.count({ where: { provider: 'discord', providerAccountId: id } }), 0);
  });

  test('"Continue with Discord" never signs in to a closed account', async () => {
    const id = did();
    const gone = await mkUser({ closedAt: new Date() });
    await p.oAuthAccount.create({ data: { userId: gone.id, provider: 'discord', providerAccountId: id } });
    who = { id, username: 'fresh', email: `fresh-${id}${MAIL}` };
    const { cookies } = await runFlow();
    const tok = cookies.find((c) => c.startsWith('bcw_session='));
    assert.ok(tok, 'a sign-in happened');
    const uid = jwt.decode(tok.slice('bcw_session='.length)).uid;
    ids.push(uid);
    assert.notEqual(uid, gone.id, 'not into the closed account');
  });

  test('the CSRF binding holds: no bind cookie, nothing linked', async () => {
    const id = did();
    const me = await mkUser();
    who = { id, username: 'csrf', email: `c-${id}${MAIL}` };
    const { location } = await runFlow({ session: await sessionCookie(me), startQuery: '?intent=link', dropBind: true });
    assert.match(location, /oauth_error=bad_state/, location);
    assert.equal(await p.oAuthAccount.count({ where: { provider: 'discord', providerAccountId: id } }), 0);
  });
});
