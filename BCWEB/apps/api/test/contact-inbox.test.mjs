// The contact inbox, and the two rules in it that a reader cannot see from a screenshot.
//
// Like contact-security-alert.test.mjs next door, these are asserted on the SOURCE. The
// behaviour lives inside route closures that need a database, a mail transport and a signed
// admin session with a second factor; this suite has none of those, and a test that spun all
// three up to re-check what a `grep` can check would be slower and no more true.
//
// What is checked here is the part that regresses silently:
//
//   · a security report's body must appear in exactly ONE response, and never in a list, a
//     mail, a webhook or a notification;
//   · the member-to-member precedence must be decided in ONE function, because a visibility
//     rule written twice diverges — and this one is written across a site switch, a member
//     preference, and three write paths.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const misc = readFileSync(new URL('../src/routes/misc.mjs', import.meta.url), 'utf8');
const threads = readFileSync(new URL('../src/routes/threads.mjs', import.meta.url), 'utf8');

/** A route handler, from its path literal to the next `app.<verb>(` after it. */
function route(src, verb, path) {
  const at = src.indexOf(`app.${verb}('${path}'`);
  assert.notEqual(at, -1, `${verb.toUpperCase()} ${path} is not declared — this test is reading a file that moved`);
  const next = src.slice(at + 10).search(/\n {2}app\.(get|post|put|patch|delete)\(/);
  return src.slice(at, next === -1 ? src.length : at + 10 + next);
}

describe('a security report is readable in exactly one place', () => {
  const inbox = route(misc, 'get', '/admin/contact/inbox');
  const thread = route(misc, 'get', '/admin/contact/:id/thread');

  test('the list ships an excerpt, and a secret kind ships none', () => {
    // The excerpt is what makes an inbox readable at a glance, and it is the exact shape of
    // "the body, repeated somewhere else". So the function that builds it answers '' for a
    // secret kind, unconditionally, before it ever touches m.body.
    assert.match(misc, /const SECRET_KINDS = \['security'\];/);
    assert.match(misc, /const excerptOf = \(m\) => \(SECRET_KINDS\.includes\(m\.kind\) \? '' :/);
    assert.match(inbox, /excerpt: excerptOf\(m\)/);
    // and nothing in the list reads the body directly.
    assert.ok(!/body: m\.body/.test(inbox), 'the inbox list must not carry a body');
  });

  test('the one response that carries it is the detail route, behind the admin 2FA wall', () => {
    assert.match(thread, /body: m\.body/);
    // requireRole with roles runs ensure2fa for every admin-tier role, MOD included — see
    // lib.mjs. A detail route guarded by anything weaker would hand the report to a session
    // with one factor.
    assert.match(thread, /preHandler: requireRole\('MOD', 'ADMIN'\)/);
    const lib = readFileSync(new URL('../src/lib/lib.mjs', import.meta.url), 'utf8');
    assert.match(lib, /if \(roles\.length && ADMIN_TIER_ROLES\.includes\(role\)\) \{ if \(!\(await ensure2fa\(user\.uid, reply\)\)\) return; \}/);
    assert.match(lib, /const ADMIN_TIER_ROLES = \['MOD', 'ADMIN', 'SUPERADMIN'\]/);
  });

  test('a reply carries what staff wrote and never quotes the message back', () => {
    const at = misc.indexOf('function composeReplyMail');
    assert.notEqual(at, -1, 'composeReplyMail is gone — the reply path no longer has one place that decides what leaves');
    const compose = misc.slice(at, misc.indexOf('app.post', at));
    // The only thing rendered into the mail is the staff member's own text.
    assert.match(compose, /mdToEmailHtml\(body\)/);
    assert.ok(!/msg\.body/.test(compose), 'the reply mail must not quote the original body');
    // …and the reply route sends that, rather than assembling its own.
    const replies = route(misc, 'post', '/admin/contact/:id/replies');
    assert.match(replies, /sendMail\(composeReplyMail\(m, b\.data\.body\)\)/);
    assert.ok(!/mailShell\(/.test(replies), 'the reply route must not build a second mail body of its own');
  });

  test('an internal note is stored and never sent', () => {
    const replies = route(misc, 'post', '/admin/contact/:id/replies');
    // One branch mails, and it is guarded on the kind. A note falls past it with
    // delivered=false and never reaches sendMail.
    assert.match(replies, /if \(b\.data\.kind === 'reply'\) \{\n\s+if \(!emailEnabled\(\)\)/);
    const beforeSend = replies.slice(0, replies.indexOf('sendMail('));
    assert.match(beforeSend, /kind === 'reply'/);
  });
});

describe('member-to-member: one rule, one place', () => {
  test('the precedence is decided by directMessaging and nothing else', () => {
    assert.match(threads, /async function directMessaging\(p, cfg, ownerId\)/);
    // The ceiling: the site switch is read first and a member preference is never consulted
    // when it is off, so nothing can opt back in above it.
    const at = threads.indexOf('async function directMessaging');
    const fn = threads.slice(at, threads.indexOf('\n}', at));
    const siteAt = fn.indexOf('md.enabled === false');
    const prefAt = fn.indexOf('userMessagingPref');
    assert.ok(siteAt !== -1 && prefAt !== -1 && siteAt < prefAt, 'the site ceiling must be checked before the member floor');
    // The floor only ever subtracts: the member branch can return false, never true-over-off.
    assert.match(fn, /if \(pref && pref\.acceptsDirect === false\) return \{ openNew: false, reply: false/);
  });

  test('every write path asks it, not just the one the UI uses', () => {
    // Opening a thread, a signed-in reply, and the anonymous token reply. The UI hides the
    // button; only these three refuse, so all three have to ask.
    assert.match(route(threads, 'post', '/threads'), /gate\.openNew/);
    assert.match(route(threads, 'post', '/me/threads/:id/messages'), /gate\.reply/);
    assert.match(route(threads, 'post', '/threads/t/:token/messages'), /gate\.reply/);
    // And the two READ paths ask the same function, so the client can hide a reply box that
    // is going to be refused. A box that takes text and then rejects it is worse than none.
    assert.match(route(threads, 'get', '/me/threads/:id'), /canWrite: gate\.reply/);
    assert.match(route(threads, 'get', '/threads/t/:token'), /canWrite: gate\.reply/);
    // Five call sites, no sixth. The count is the part that catches a path added later that
    // forgets to ask — the three assertions above only prove the ones we already knew about.
    const calls = [...threads.matchAll(/await directMessaging\(/g)];
    assert.equal(calls.length, 5, `expected 3 write paths + 2 read paths to call directMessaging, found ${calls.length}`);
  });

  test('switching off freezes, it does not delete', () => {
    // Nothing in the preference route or in directMessaging writes to contactThread: the
    // fate of an open conversation is a read-time rule, which is what makes switching back
    // on a no-op instead of a repair.
    const put = route(threads, 'put', '/me/messaging');
    assert.ok(!/contactThread/.test(put), 'flipping the member switch must not rewrite conversations');
    const at = threads.indexOf('async function directMessaging');
    assert.ok(!/contactThread/.test(threads.slice(at, threads.indexOf('\n}', at))));
    // The admin's 'keep' choice is the one softening, and it applies to replies only.
    assert.match(threads, /return \{ openNew: false, reply: md\.whenOff === 'keep', why: 'messaging_off_site' \}/);
  });

  test('there is no open-conversation cap any more, and the archive clocks are read from the config', () => {
    // The owner retired the cap (Sept 22): the rate limits stop floods, the archive clocks
    // keep lists short. A stored `maxOpen` is dropped on read AND on save, so an old row
    // cannot bring the cap back. The behaviour itself is proven over HTTP in
    // member-messaging.test.mjs; this only pins the shape.
    const open = route(threads, 'post', '/threads');
    assert.ok(!/maxOpen/.test(open), 'the open route must not read a conversation cap');
    assert.ok(!/too_many_open/.test(threads));
    assert.match(threads, /delete md\.maxOpen;/);
    assert.match(threads, /const days = Number\(md\.autoArchiveDays \|\| 0\);/);
    assert.match(threads, /const anonDays = Number\(md\.autoArchiveAnonDays \|\| 0\);/);
    // Archived, not deleted.
    assert.match(threads, /data: \{ status: 'archived' \}/);
  });

  test('a saved config cannot lose the defaults it did not name', () => {
    // A shallow spread over a stored config written before memberDirect existed turns a cap
    // of 5 into undefined, and `Number(undefined || 0)` is 0, which is "no cap". That is a
    // limit silently removing itself on save.
    assert.match(threads, /const md = \{ \.\.\.MEMBER_DIRECT_DEFAULTS, \.\.\.\(stored\.memberDirect/);
    assert.match(threads, /memberDirect: \{ \.\.\.prev\.memberDirect, \.\.\.\(b\.data\.memberDirect \|\| \{\}\) \}/);
    // zod strips what it does not name, so the block has to be declared on the way in.
    assert.match(threads, /memberDirect: z\.object\(\{/);
  });
});
