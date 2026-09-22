// The sent-mail log keeps nothing a mail exists to deliver. Pure functions, no database.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mailLogRow, redactMailText, maskAddress, recipientsOf, recordMail } from '../src/lib/mail-log.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

describe('mailLogRow', () => {
  test('never carries a body, whatever the caller hands in', () => {
    const row = mailLogRow({ to: 'a@b.co', subject: 'Reset your password', mailId: 'reset', status: 'sent', html: '<a href="https://x/reset?t=SECRET">', text: 'SECRET' });
    assert.deepEqual(Object.keys(row).sort(), ['attachments', 'error', 'mailId', 'status', 'subject', 'to']);
    assert.ok(!JSON.stringify(row).includes('SECRET'));
  });

  test('an unknown status is stored as failed, not as sent', () => {
    assert.equal(mailLogRow({ to: 'a@b.co', status: 'weird' }).status, 'failed');
  });

  test('counts attachments without keeping them', () => {
    const row = mailLogRow({ to: 'a@b.co', status: 'sent', attachments: [{ filename: 'export.json', content: 'PERSONAL' }] });
    assert.equal(row.attachments, 1);
    assert.ok(!JSON.stringify(row).includes('PERSONAL'));
  });
});

describe('redactMailText', () => {
  test('links, tokens, addresses and bare codes are replaced', () => {
    const out = redactMailText('Open https://site/verify?token=abc123 or use eyJhbGciOiJIUzI1NiJ9abc123def with 482913 for me@x.org');
    assert.ok(!out.includes('https://'));
    assert.ok(!out.includes('eyJhbGci'));
    assert.ok(!out.includes('482913'));
    assert.ok(!out.includes('me@x.org'));
  });

  test('an ordinary subject survives', () => {
    assert.equal(redactMailText('[SAN-2041] Your contest was upheld'), '[SAN-2041] Your contest was upheld');
    assert.equal(redactMailText('Confirm your email'), 'Confirm your email');
  });

  test('an error object is reduced to a short redacted message', () => {
    const row = mailLogRow({ to: 'a@b.co', status: 'failed', error: new Error('535 auth failed for https://smtp.example/login?k=9f8e7d6c5b4a39281706f5e4d3c2b1a0') });
    assert.ok(row.error.length <= 300);
    assert.ok(!row.error.includes('9f8e7d6c'));
  });
});

describe('addresses', () => {
  test('masking keeps the shape and hides the rest', () => {
    assert.equal(maskAddress('gougele222@gmail.com'), 'go•••@gm•••.com');
    assert.ok(!maskAddress('a@b.co').includes('b.co') || maskAddress('a@b.co') === 'a•••@b•••.co');
  });

  test('recipients are normalised from every shape nodemailer accepts', () => {
    assert.equal(recipientsOf('Ann <Ann@X.org>'), 'ann@x.org');
    assert.equal(recipientsOf(['a@x.org', { address: 'B@y.org' }]), 'a@x.org, b@y.org');
  });
});

describe('recordMail', () => {
  test('without a database it does nothing, and never throws', () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try { assert.doesNotThrow(() => recordMail({ to: 'a@b.co', status: 'sent' })); }
    finally { if (saved !== undefined) process.env.DATABASE_URL = saved; }
  });

  test('a failing database never reaches the caller', async () => {
    const getDb = async () => { throw new Error('down'); };
    assert.doesNotThrow(() => recordMail({ to: 'a@b.co', status: 'sent' }, { getDb }));
    await new Promise((r) => setTimeout(r, 10));
  });

  test('writes the redacted row and links the account', async () => {
    const writes = [];
    const p = {
      user: { findFirst: async () => ({ id: 'u1' }) },
      mailLog: { create: async ({ data }) => { writes.push(data); } },
    };
    recordMail({ to: 'A@B.co', subject: 'Code 123456', mailId: 'login', status: 'sent' }, { getDb: async () => p, random: () => 1 });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(writes.length, 1);
    assert.equal(writes[0].userId, 'u1');
    assert.equal(writes[0].to, 'a@b.co');
    assert.ok(!writes[0].subject.includes('123456'));
  });
});

test('the MailLog model has no column that could hold a body', () => {
  const schema = readFileSync(join(HERE, '..', '..', '..', 'packages', 'db', 'schema.prisma'), 'utf8');
  const block = schema.slice(schema.indexOf('model MailLog {'), schema.indexOf('}', schema.indexOf('model MailLog {')));
  assert.ok(block.includes('subject'), 'MailLog model not found');
  assert.ok(!/^\s+(html|text|body|content)\s/m.test(block), 'MailLog must not store a body');
});

test('sendMail logs every outcome', () => {
  const src = readFileSync(join(HERE, '../src/lib/mail.mjs'), 'utf8');
  const body = src.slice(src.indexOf('export async function sendMail'), src.indexOf('export function escapeHtml'));
  for (const s of ["status: 'disabled'", "status: 'failed'", "status: 'sent'"]) assert.ok(body.includes(s), `missing ${s}`);
});
