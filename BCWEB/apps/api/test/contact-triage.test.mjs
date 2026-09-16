// The contact triage: what each destination must contain, and who decides the queue.
//
// Written against three things that are invisible until somebody exploits or forgets them:
//
//   1. the form validates in the browser, which stops nothing — `/contact` is public JSON;
//   2. the destination, not the client, picks the `kind` the admin queue counts;
//   3. the browser has its OWN copy of the field table (a different app, a different
//      bundle), so the two can drift silently. The last test here imports both and compares
//      them, which is the only reason the web copy is plain data with no imports.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CONTACT_KINDS, DESTINATIONS, DESTINATION_IDS, validateContactFields, composeContactBody,
} from '../src/lib/contact-triage.mjs';
import { DESTINATIONS as WEB_DESTINATIONS, requiredFields as webRequired, TOPICS as WEB_TOPICS } from '../../web/src/pages/contact-triage.js';

describe('a destination is a queue plus the fields its answer needs', () => {
  test('every destination files into a kind the closed list knows', () => {
    for (const id of DESTINATION_IDS) {
      assert.ok(CONTACT_KINDS.includes(DESTINATIONS[id].kind), `${id} files into an unknown kind`);
    }
  });
  test('a field name is used once per destination and has a cap', () => {
    for (const id of DESTINATION_IDS) {
      const seen = new Set();
      for (const f of DESTINATIONS[id].fields) {
        assert.ok(!seen.has(f.name), `${id}.${f.name} declared twice`);
        seen.add(f.name);
        if (f.type !== 'check') assert.ok(f.max > 0, `${id}.${f.name} has no max`);
        assert.ok(f.label, `${id}.${f.name} has no label for the queue`);
      }
    }
  });
});

describe('server-side validation of each new form shape', () => {
  test('a hosting question needs the pool it is about', () => {
    assert.deepEqual(validateContactFields('hosting', {}), { ok: false, error: 'field_required', field: 'pool' });
    const ok = validateContactFields('hosting', { pool: '  my-pool  ', need: '200 GB' });
    assert.deepEqual(ok, { ok: true, kind: 'billing', fields: { pool: 'my-pool', need: '200 GB' } });
  });
  test('a billing question needs the invoice reference', () => {
    assert.deepEqual(validateContactFields('invoice', { amount: '12.00' }), { ok: false, error: 'field_required', field: 'invoice' });
    assert.equal(validateContactFields('invoice', { invoice: 'IN-42' }).ok, true);
  });
  test('an account problem needs the account and what was tried', () => {
    assert.equal(validateContactFields('account', { account: 'a@b.co' }).error, 'field_required');
    assert.equal(validateContactFields('account', { account: 'a@b.co', tried: 'password reset' }).kind, 'account');
  });
  test('erasure needs the sender to be told it is permanent, not merely to send the key', () => {
    assert.deepEqual(validateContactFields('data_delete', { account: 'a@b.co' }), { ok: false, error: 'field_required', field: 'permanent' });
    assert.deepEqual(validateContactFields('data_delete', { account: 'a@b.co', permanent: false }), { ok: false, error: 'field_required', field: 'permanent' });
    assert.equal(validateContactFields('data_delete', { account: 'a@b.co', permanent: true }).ok, true);
    // A checkbox travelling through a form encoder arrives as a string.
    assert.equal(validateContactFields('data_delete', { account: 'a@b.co', permanent: 'true' }).ok, true);
  });
  test('a security report needs where it is and the no-secrets statement', () => {
    assert.equal(validateContactFields('security', { nosecrets: true }).field, 'area');
    assert.equal(validateContactFields('security', { area: '/api/x' }).field, 'nosecrets');
    assert.equal(validateContactFields('security', { area: '/api/x', nosecrets: true }).kind, 'security');
  });
  test('a bug needs where it happens; anything else needs nothing', () => {
    assert.equal(validateContactFields('bug', {}).field, 'where');
    assert.deepEqual(validateContactFields('other', {}), { ok: true, kind: 'other', fields: {} });
  });

  test('a field that is too long is refused, and one that is not asked for is dropped', () => {
    assert.deepEqual(validateContactFields('invoice', { invoice: 'x'.repeat(121) }), { ok: false, error: 'field_too_long', field: 'invoice' });
    const r = validateContactFields('bug', { where: '/repos', role: 'SUPERADMIN', kind: 'data_delete' });
    assert.deepEqual(r.fields, { where: '/repos' });
  });
  test('a destination nobody declared is refused, and nothing throws on junk', () => {
    assert.deepEqual(validateContactFields('nope', {}), { ok: false, error: 'unknown_destination' });
    assert.deepEqual(validateContactFields('', {}), { ok: false, error: 'unknown_destination' });
    assert.equal(validateContactFields('other', null).ok, true);
    assert.equal(validateContactFields('other', 'a string').ok, true);
    assert.equal(validateContactFields('bug', { where: ['/a', '/b'] }).ok, false); // an object is not an answer
    assert.equal(validateContactFields('bug', { where: 42 }).fields.where, '42');
  });
});

describe('the answers reach the one place staff read', () => {
  test('they are written above the message, labelled', () => {
    const out = composeContactBody('invoice', { invoice: 'IN-42', amount: '12.00' }, 'It was charged twice.');
    assert.match(out, /^Invoice or payment reference: IN-42\n/);
    assert.match(out, /Amount: 12\.00/);
    assert.ok(out.endsWith('It was charged twice.'));
  });
  test('a ticked statement reads as a statement', () => {
    const out = composeContactBody('data_delete', { account: 'a@b.co', permanent: true }, 'please');
    assert.match(out, /Told that erasure is permanent: yes/);
  });
  test('a destination with no fields leaves the message alone', () => {
    assert.equal(composeContactBody('other', {}, 'hello'), 'hello');
    assert.equal(composeContactBody('nope', {}, 'hello'), 'hello');
  });
});

describe('the route uses it the way it is meant to', () => {
  const misc = readFileSync(new URL('../src/routes/misc.mjs', import.meta.url), 'utf8');
  test('the destination decides the kind, and the composed body is what is stored', () => {
    assert.match(misc, /import \{ CONTACT_KINDS, validateContactFields, composeContactBody \}/);
    assert.match(misc, /const v = validateContactFields\(b\.data\.dest, b\.data\.fields\);/);
    assert.match(misc, /if \(!v\.ok\) return reply\.code\(400\)\.send\(\{ error: v\.error, field: v\.field \}\);/);
    assert.match(misc, /\n\s*kind = v\.kind;/);
    assert.match(misc, /body = composeContactBody\(b\.data\.dest, v\.fields, body\);/);
    // The create no longer spreads the parsed body, which is how `kind` used to come
    // straight from the client.
    assert.match(misc, /contactMessage\.create\(\{ data: \{ name: b\.data\.name, email: b\.data\.email, body, kind, ip, userId \} \}\)/);
    assert.ok(!/contactMessage\.create\(\{ data: \{ \.\.\.b\.data/.test(misc));
  });
});

describe('the browser table and this one say the same thing', () => {
  test('the same destinations, filing into the same kinds', () => {
    const formDests = Object.entries(WEB_DESTINATIONS).filter(([, d]) => !d.route).map(([id]) => id).sort();
    assert.deepEqual(formDests, [...DESTINATION_IDS].sort(),
      'a destination the form can end on must be one the server knows');
    for (const id of DESTINATION_IDS) assert.equal(WEB_DESTINATIONS[id].kind, DESTINATIONS[id].kind, `${id} kind`);
  });
  test('the same required fields, with the same caps', () => {
    for (const id of DESTINATION_IDS) {
      const mine = DESTINATIONS[id].fields.filter((f) => f.required).map((f) => f.name).sort();
      assert.deepEqual(webRequired(id), mine, `${id}: required fields differ`);
      for (const f of DESTINATIONS[id].fields) {
        const w = WEB_DESTINATIONS[id].fields.find((x) => x.name === f.name);
        assert.ok(w, `${id}.${f.name} is not on the form`);
        assert.equal(w.max ?? null, f.max ?? null, `${id}.${f.name} cap differs`);
        assert.equal(w.type === 'check', f.type === 'check', `${id}.${f.name} is a statement on one side only`);
      }
    }
  });
  test('every topic link lands on a destination that exists', () => {
    for (const [topic, tp] of Object.entries(WEB_TOPICS)) {
      assert.ok(WEB_DESTINATIONS[tp.dest], `?topic=${topic} points at no destination`);
      assert.ok(DESTINATION_IDS.includes(tp.dest), `?topic=${topic} points at a destination the server refuses`);
    }
  });
  test('every field a French reader sees has both languages', () => {
    for (const d of Object.values(WEB_DESTINATIONS)) {
      assert.ok(d.title.en && d.title.fr, 'a destination title is missing a language');
      assert.ok(d.lead.en && d.lead.fr, 'a destination lead is missing a language');
      for (const f of d.fields || []) {
        assert.ok(f.label.en && f.label.fr, `${f.name}: a label is missing a language`);
        if (f.placeholder) assert.ok(f.placeholder.en && f.placeholder.fr, `${f.name}: a placeholder is missing a language`);
      }
    }
  });
});
