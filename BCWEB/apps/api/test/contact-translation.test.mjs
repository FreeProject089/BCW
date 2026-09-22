// The contact form's "translation problem" destination: site or project, and when it is a
// project, WHICH one, picked from the real list and checked on the server.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { validateContactFields, composeContactBody, CONTACT_KINDS } from '../src/lib/contact-triage.mjs';
import { fieldsComplete } from '../../web/src/pages/contact-triage.js';

describe('translation: the rule', () => {
  test('it is a kind the queue counts', () => {
    assert.ok(CONTACT_KINDS.includes('translation'));
    assert.equal(validateContactFields('translation', { scope: 'site', page: '/faq' }).kind, 'translation');
  });
  test('a project is required exactly when the answer is "in a project"', () => {
    assert.deepEqual(validateContactFields('translation', { scope: 'project', page: '/p/bmm' }), { ok: false, error: 'field_required', field: 'project' });
    const ok = validateContactFields('translation', { scope: 'project', project: 'bmm', page: '/p/bmm' });
    assert.equal(ok.ok, true); assert.equal(ok.fields.project, 'bmm');
    // Answered "site" after picking a project: the stale pick does not travel.
    const site = validateContactFields('translation', { scope: 'site', project: 'bmm', page: '/faq' });
    assert.equal(site.ok, true); assert.equal(site.fields.project, undefined);
  });
  test('a scope nobody offered is refused, not dropped', () => {
    assert.deepEqual(validateContactFields('translation', { scope: 'elsewhere', page: 'x' }), { ok: false, error: 'field_invalid', field: 'scope' });
    assert.equal(validateContactFields('translation', { page: 'x' }).error, 'field_required');
  });
  test('the browser applies the same conditional rule before the button lights', () => {
    assert.equal(fieldsComplete('translation', { scope: 'project', page: 'x' }), false);
    assert.equal(fieldsComplete('translation', { scope: 'project', project: 'bmm', page: 'x' }), true);
    assert.equal(fieldsComplete('translation', { scope: 'site', page: 'x' }), true);
  });
  test('the answers are written above the message', () => {
    const body = composeContactBody('translation', { scope: 'project', project: 'Better Mods Manager (bmm)', page: '/p/bmm' }, 'The FR button says "Sauver".');
    assert.match(body, /Where the translation is: project/);
    assert.match(body, /Project: Better Mods Manager \(bmm\)/);
  });
});

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to run the /contact translation tests';
process.env.JWT_SECRET ||= 'contact-translation-secret';
process.env.POW_BITS = '1'; // read at import: a real proof, just a cheap one
let p, app;
const MAIL = '@ctr.test';

before(async () => {
  if (!RUN) return;
  p = await (await import('../src/lib/lib.mjs')).db();
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/auth.mjs')).default);
  await app.register((await import('../src/routes/misc.mjs')).default);
  await app.register((await import('../src/routes/project-contact.mjs')).default);
  await app.ready();
});
after(async () => {
  if (!RUN) return;
  await p.contactMessage.deleteMany({ where: { email: { endsWith: MAIL } } });
  await app?.close();
});

async function pow() {
  const { challenge, difficulty } = (await app.inject({ method: 'GET', url: '/auth/pow' })).json();
  for (let nonce = 0; ; nonce += 1) {
    const h = crypto.createHash('sha256').update(`${challenge}:${nonce}`).digest();
    let bits = 0; for (const b of h) { if (b === 0) { bits += 8; continue; } bits += Math.clz32(b) - 24; break; }
    if (bits >= difficulty) return { challenge, nonce };
  }
}

describe('translation over HTTP', { skip }, () => {
  test('the picker lists real projects, and a picked project is stored by NAME', async () => {
    const list = (await app.inject({ method: 'GET', url: '/contact/projects' })).json().projects;
    assert.ok(list.some((x) => x.ref === 'bmm' && x.official), 'the official BMM project is pickable');
    const bmm = list.find((x) => x.ref === 'bmm');
    const email = `t${Date.now()}${MAIL}`;
    let r = await app.inject({ method: 'POST', url: '/contact', payload: { name: 'T', email, body: 'The FR button says Sauver.', dest: 'translation', fields: { scope: 'project', project: 'bmm', page: '/p/bmm' }, pow: await pow() } });
    assert.equal(r.statusCode, 201, r.body);
    const row = await p.contactMessage.findFirst({ where: { email } });
    assert.equal(row.kind, 'translation');
    assert.ok(row.body.includes(`Project: ${bmm.name} (bmm)`), row.body);
    r = await app.inject({ method: 'POST', url: '/contact', payload: { name: 'T', email, body: 'Nope nope nope.', dest: 'translation', fields: { scope: 'project', project: 'sc:no-such-project-xyz', page: 'x' }, pow: await pow() } });
    assert.equal(r.statusCode, 400); assert.equal(r.json().error, 'unknown_project');
  });
});
