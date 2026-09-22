// A copy of a conversation for the people in it: readable, and SIGNED so it can later prove
// it is genuine and unmodified.
//
// WHAT IS IN A COPY is exactly what that participant saw, built by the same rules as their
// view of the thread: no message staff hid, no IP, no staff flag, no e-mail they were not
// shown. Each side gets its own copy, so the sender's copy never carries what only the
// answering side saw (an anonymous sender's own address is theirs; a member's BC id is shown
// to the side that answers them, and only there). A file sent in the conversation appears by
// name and size, never its bytes: the copy proves what was said, it is not a second place
// the files are stored.
//
// THE SIGNATURE is the platform's own Ed25519 key (lib/signing.mjs), the one backups and
// history exports are signed with, so there is one public key to check everything against.
// It covers the canonical JSON of the payload (keys sorted, no whitespace): the same object
// always gives the same bytes, and changing one character of one message breaks it.
//
// Checking needs nothing from us: the zip carries the exact signed bytes, the signature and
// the public key, and HOW-TO-VERIFY.txt gives the one openssl command. The site's verify
// route (POST /conversation-copy/verify) does the same with the key it holds, and refuses a
// file that brings its own key: a copy that carries the key it was checked against proves
// nothing.
import crypto from 'node:crypto';
import { signBytes, signingKey } from './signing.mjs';
import { zipCreate } from './native.mjs';
import { escapeHtml } from './mail.mjs';

export const COPY_FORMAT = 'bettercommunity.conversation-copy';
export const COPY_VERSION = 1;

/** Keys sorted at every depth, no whitespace: one object, one byte string. */
export function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
}

const iso = (d) => (d ? new Date(d).toISOString() : null);

/**
 * The payload for ONE side. `thread` is a ContactThread with messages (author displayName),
 * attachments and sender; `side` is 'sender' | 'owner'. `site` is the origin, for the record.
 */
export function buildPayload(thread, { side, site = '', issuedAt = new Date(), recipient = '' } = {}) {
  const owner = side === 'owner';
  const filesBy = {};
  for (const a of thread.attachments || []) (filesBy[a.messageId || ''] ||= []).push({ name: a.name, size: a.size, type: a.mime });
  const sender = thread.sender
    ? { name: thread.sender.displayName, account: true, ...(owner ? { profile: `${site}/u/${thread.sender.id}` } : {}) }
    : { name: thread.senderName || '', account: false, ...(owner || side === 'sender' ? { email: thread.senderEmail || '' } : {}) };
  return {
    format: COPY_FORMAT, version: COPY_VERSION,
    issuedAt: iso(issuedAt), site,
    recipient: { side, name: recipient },
    conversation: {
      id: thread.id, kind: thread.kind, about: thread.targetLabel, subject: thread.subject, topic: thread.topic || '',
      status: thread.status, openedAt: iso(thread.createdAt), lastActivityAt: iso(thread.lastActivityAt),
      sender,
      with: thread.ownerTeam?.name || thread.ownerUser?.displayName || thread.targetLabel,
    },
    // Hidden messages are left out entirely, not blanked: a participant never saw them.
    messages: (thread.messages || []).filter((m) => !m.hidden).map((m) => ({
      at: iso(m.createdAt), side: m.side,
      from: m.author?.displayName || (m.side === 'sender' ? (thread.sender?.displayName || thread.senderName || 'Sender') : m.side === 'staff' ? 'Staff' : 'Owner'),
      body: m.body,
      files: filesBy[m.id] || [],
    })),
  };
}

/** Sign a payload: `{ payload, signature: { alg, keyId, value } }`. */
export async function signPayload(p, payload) {
  const bytes = Buffer.from(canonical(payload), 'utf8');
  const { publicKey } = await signingKey(p);
  return { payload, signature: { alg: 'Ed25519', keyId: keyIdOf(publicKey), value: await signBytes(bytes, p) } };
}

export const keyIdOf = (pem) => crypto.createHash('sha256').update(String(pem)).digest('hex').slice(0, 16);

/**
 * Check a signed copy against THIS server's key. Never throws; returns
 * `{ valid, reason }` with reason one of: ok · malformed · wrong_format · other_key · tampered.
 */
export async function verifyCopy(p, doc) {
  try {
    if (!doc || typeof doc !== 'object' || !doc.payload || !doc.signature?.value) return { valid: false, reason: 'malformed' };
    if (doc.payload.format !== COPY_FORMAT) return { valid: false, reason: 'wrong_format' };
    const { publicKey } = await signingKey(p);
    if (doc.signature.keyId && doc.signature.keyId !== keyIdOf(publicKey)) return { valid: false, reason: 'other_key' };
    const ok = crypto.verify(null, Buffer.from(canonical(doc.payload), 'utf8'), crypto.createPublicKey(publicKey), Buffer.from(String(doc.signature.value), 'base64'));
    return ok ? { valid: true, reason: 'ok' } : { valid: false, reason: 'tampered' };
  } catch {
    return { valid: false, reason: 'malformed' };
  }
}

/** The readable copy, as HTML. Every value escaped: a message body is somebody's input. */
export function renderHtml(payload) {
  const c = payload.conversation;
  const rows = payload.messages.map((m) => `
    <div style="margin:10px 0;padding:10px 12px;border:1px solid #ddd;border-radius:10px;${m.side === 'sender' ? '' : 'background:#f6f7fb;'}">
      <div style="font-size:12px;color:#666">${escapeHtml(m.from)} · ${escapeHtml(new Date(m.at).toUTCString())}</div>
      <div style="white-space:pre-wrap;margin-top:4px">${escapeHtml(m.body)}</div>
      ${m.files.length ? `<div style="font-size:12px;color:#666;margin-top:6px">Files: ${m.files.map((f) => `${escapeHtml(f.name)} (${Math.max(1, Math.round(f.size / 1024))} KB)`).join(', ')}</div>` : ''}
    </div>`).join('');
  const who = c.sender.account ? escapeHtml(c.sender.name) : `${escapeHtml(c.sender.name || 'Anonymous')}${c.sender.email ? ` &lt;${escapeHtml(c.sender.email)}&gt;` : ''}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(c.subject)}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:720px;margin:24px auto;padding:0 16px;color:#111">
  <h1 style="font-size:20px;margin:0 0 4px">${escapeHtml(c.subject)}</h1>
  <div style="font-size:13px;color:#555">About ${escapeHtml(c.about)} · between ${who} and ${escapeHtml(c.with)} · ${escapeHtml(c.status)}</div>
  <div style="font-size:12px;color:#777;margin-top:2px">Copy issued ${escapeHtml(new Date(payload.issuedAt).toUTCString())} for ${escapeHtml(payload.recipient.name || payload.recipient.side)}. The signed file in the same archive proves this conversation is unmodified.</div>
  ${rows}
</body></html>`;
}

/** The readable copy, as plain text. */
export function renderText(payload) {
  const c = payload.conversation;
  const lines = [`${c.subject}`, `About ${c.about}, with ${c.with} (${c.status})`, `Copy issued ${payload.issuedAt}`, ''];
  for (const m of payload.messages) {
    lines.push(`--- ${m.from}, ${m.at}`, m.body);
    if (m.files.length) lines.push(`[files: ${m.files.map((f) => f.name).join(', ')}]`);
    lines.push('');
  }
  return lines.join('\n');
}

/** The archive: readable copy, signed copy, the exact signed bytes, the key, how to check. */
export async function buildCopyZip(p, signed, { site = '' } = {}) {
  const { publicKey } = await signingKey(p);
  const payloadBytes = Buffer.from(canonical(signed.payload), 'utf8');
  const howto = [
    'This archive is a copy of a conversation on BetterCommunity, and a proof that it is genuine.',
    '',
    'conversation.html / conversation.txt   the conversation, to read',
    'conversation.signed.json              the same conversation, signed by the site',
    'conversation.payload.json             the exact bytes that were signed',
    'conversation.sig                      the signature (base64)',
    'server-public-key.pem                 the key to check it with',
    '',
    `Check it on the site: drop conversation.signed.json on ${site}/verify-copy`,
    '',
    'Or check it yourself, with nothing from us but the key:',
    '  base64 -d conversation.sig > conversation.sig.bin',
    '  openssl pkeyutl -verify -pubin -inkey server-public-key.pem -rawin -in conversation.payload.json -sigfile conversation.sig.bin',
    '"Signature Verified Successfully" means not one byte was changed.',
    `Compare the key with the one the site publishes before you trust it (key id ${signed.signature.keyId}).`,
    '',
  ].join('\n');
  return zipCreate([
    { name: 'conversation.html', data: Buffer.from(renderHtml(signed.payload), 'utf8') },
    { name: 'conversation.txt', data: Buffer.from(renderText(signed.payload), 'utf8') },
    { name: 'conversation.signed.json', data: Buffer.from(JSON.stringify(signed, null, 2), 'utf8') },
    { name: 'conversation.payload.json', data: payloadBytes },
    { name: 'conversation.sig', data: Buffer.from(signed.signature.value, 'utf8') },
    { name: 'server-public-key.pem', data: Buffer.from(publicKey, 'utf8') },
    { name: 'HOW-TO-VERIFY.txt', data: Buffer.from(howto, 'utf8') },
  ]);
}
