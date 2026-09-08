// An admin editing "reset your password" must edit that mail, and no other.
//
// "Every mail we send" is a GALLERY: thirty samples that re-state the wording next to the
// senders that own it. Making the gallery editable without wiring the senders would have
// changed the PREVIEW and nothing else — you edit the text, the screen shows your version,
// the real mail goes out unchanged. That is the worst outcome this feature could have, and it
// is invisible from the screen, because the screen is the thing that lies.
//
// So the wiring is checked, not trusted. `editable: true` on a sample is a claim that some
// sender passes its id; this greps the senders and holds the claim to it, in both directions:
// a sample that promises what no sender delivers, and a sender carrying an id no sample
// declares (a typo, which would silently make that mail un-editable for ever).
//
// Pure file reading — no database, no SMTP.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAIL_SAMPLES } from '../src/lib/mail-samples.mjs';
import { mailSubject, setMailTemplates, mailTemplate } from '../src/lib/mail.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');

/** Every .mjs under src, minus the two files that DEFINE the vocabulary. */
function senderFiles(dir = SRC, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { senderFiles(p, out); continue; }
    if (!p.endsWith('.mjs')) continue;
    if (p.endsWith('mail-samples.mjs') || p.endsWith(join('lib', 'mail.mjs'))) continue;
    out.push(p);
  }
  return out;
}

// Ids as they appear at a call site: mailId: 'verify' in a sendMail argument object, and
// { mailId: 'verify' } as mailShell's options.
const usedIds = new Set();
for (const f of senderFiles()) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\bmailId:\s*'([a-z0-9-]+)'/g)) usedIds.add(m[1]);
}
const sampleIds = new Set(MAIL_SAMPLES.map((s) => s.id));
const editableIds = MAIL_SAMPLES.filter((s) => s.editable).map((s) => s.id);

describe('the wiring behind editable mails', () => {
  test('every mail that claims to be editable has a sender carrying its id', () => {
    const lying = editableIds.filter((id) => !usedIds.has(id));
    assert.deepEqual(lying, [],
      `these say "editable" and no sender passes their id, so an admin would edit them and nothing would change: ${lying.join(', ')}`);
  });

  test('every mail id a sender passes is a mail the gallery knows', () => {
    // A typo here is worse than a missing feature: the override is stored under a key nothing
    // reads, the editor never offers it, and the mail is quietly un-editable for ever.
    const phantom = [...usedIds].filter((id) => !sampleIds.has(id));
    assert.deepEqual(phantom, [],
      `senders pass ids the gallery does not declare: ${phantom.join(', ')}`);
  });

  test('at least the account mails are wired — this is the point of the feature', () => {
    for (const id of ['verify', 'reset', 'password-changed', 'twofa-reset', 'data-export']) {
      assert.ok(editableIds.includes(id), `${id} is not editable`);
    }
  });

  test('a mail with no sender is preview-only, and does not pretend otherwise', () => {
    for (const s of MAIL_SAMPLES) {
      if (s.editable) continue;
      assert.ok(!usedIds.has(s.id) || s.editable,
        `${s.id} has a sender but is not flagged editable — the editor would refuse an edit that would in fact work`);
    }
  });
});

describe('applying an override', () => {
  test('no template leaves the sender’s subject exactly as it was', () => {
    setMailTemplates({});
    assert.equal(mailSubject('verify', 'Confirm your BetterCommunity email'), 'Confirm your BetterCommunity email');
    assert.equal(mailTemplate('verify'), null);
  });

  test('{{subject}} wraps the sender’s own subject rather than replacing it', () => {
    setMailTemplates({ verify: { subject: '[BC] {{subject}}' } });
    assert.equal(mailSubject('verify', 'Confirm your email'), '[BC] Confirm your email');
  });

  test('a subject with no placeholder replaces it outright', () => {
    setMailTemplates({ verify: { subject: 'Please confirm' } });
    assert.equal(mailSubject('verify', 'Confirm your email'), 'Please confirm');
  });

  test('an override never leaks to another mail', () => {
    setMailTemplates({ verify: { subject: 'Only mine' } });
    assert.equal(mailSubject('reset', 'Reset your password'), 'Reset your password');
    assert.equal(mailSubject(undefined, 'No id at all'), 'No id at all');
  });

  test('a blank subject is not an empty subject line', () => {
    setMailTemplates({ verify: { subject: '   ' } });
    assert.equal(mailSubject('verify', 'Confirm your email'), 'Confirm your email');
    setMailTemplates({});
  });
});

describe('the body wrapper', () => {
  test('{{body}} keeps the interpolated content the sender built', async () => {
    const { mailShell } = await import('../src/lib/mail.mjs');
    setMailTemplates({ verify: { body: '<p>Hello!</p>{{body}}<p>— the team</p>' } });
    const html = mailShell('T', '<p>Your code is 4821</p>', undefined, { mailId: 'verify' });
    assert.ok(html.includes('Your code is 4821'), 'the real, interpolated body was dropped');
    assert.ok(html.includes('Hello!') && html.includes('— the team'), 'the override text is missing');
    assert.ok(html.indexOf('Hello!') < html.indexOf('Your code is 4821'), 'the wrapper is out of order');
    setMailTemplates({});
  });

  test('a body without {{body}} replaces it — allowed, and it is a decision', async () => {
    const { mailShell } = await import('../src/lib/mail.mjs');
    setMailTemplates({ verify: { body: '<p>Nothing else.</p>' } });
    const html = mailShell('T', '<p>Your code is 4821</p>', undefined, { mailId: 'verify' });
    assert.ok(!html.includes('4821'));
    assert.ok(html.includes('Nothing else.'));
    setMailTemplates({});
  });

  test('a mail with no id is untouched even when a template exists for another', async () => {
    const { mailShell } = await import('../src/lib/mail.mjs');
    setMailTemplates({ verify: { body: 'X{{body}}X' } });
    const html = mailShell('T', '<p>plain</p>');
    assert.ok(html.includes('plain') && !html.includes('X<p>plain</p>X'));
    setMailTemplates({});
  });
});
