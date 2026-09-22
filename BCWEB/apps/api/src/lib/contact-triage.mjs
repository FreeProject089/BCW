// What the contact form may send, and what each destination must contain.
//
// The contact page stopped being ONE form with a topic dropdown. It asks two short questions
// and sends the person to the destination that fits — and a destination asks for the things
// its answer needs: an invoice question without an invoice reference is a round trip, a
// billing question filed as "Something else" is a queue count that lies.
//
// Two rules this file exists to hold:
//
//   1. THE DESTINATION DECIDES THE KIND, not the client. `kind` is what the admin queue
//      counts and what the legal-notice announcement keys off, so a browser that could send
//      `kind` and `fields` independently could file a security report as `data_export`.
//      The route reads the kind from the destination and ignores the sent one.
//   2. THE FIELDS ARE CHECKED HERE, not only in the browser. The form disables its own send
//      button, which stops nothing: `/contact` is public and takes JSON.
//
// The browser needs the same table to draw the form, and it cannot import this file (a
// different app, a different bundle). So the web copy lives at
// `apps/web/src/pages/contact-triage.js` and `contact-triage.test.mjs` imports both and
// fails when their required fields drift apart. Two tables, one truth, checked.
//
// Fields are deliberately short and few. The message body is still where the person writes;
// these are the two or three things we would otherwise have to write back and ask for.

/**
 * The kinds a ContactMessage may carry. Sender-declared (through a destination) and
 * validated against this closed list, so a client cannot invent a kind no queue counts.
 *
 *   other · bug · billing · appeal          support
 *   data_export · data_delete               legal deadlines (GDPR)
 *   report · copyright                      legal notices (DSA Art. 16, rights holders)
 *   account · security                      added with the triage
 *   translation                             a wrong or missing translation, on the site
 *                                           or in a project (the form asks which)
 *
 * `report` and `copyright` stay: the triage routes those people to /report, but the Terms
 * have pointed here for a long time and a message already sent must still land somewhere
 * countable.
 */
export const CONTACT_KINDS = ['other', 'data_export', 'data_delete', 'bug', 'billing', 'appeal',
  'report', 'copyright', 'account', 'security', 'translation'];

/**
 * A destination: the queue it files into, and the fields it asks for.
 *
 * `max` is a cap, not a promise of quality — the point is that a field cannot be used to
 * store a novel. `type: 'check'` is a statement the sender makes; required means it must be
 * true, not merely present, which is the difference between an acknowledgement and a
 * checkbox nobody read.
 *
 * `label` is English on purpose: it is written into the message body a staff member reads,
 * and a French label in an English queue is harder to scan than an English one. What the
 * SENDER sees is the web copy's own bilingual label.
 */
export const DESTINATIONS = {
  // Hosting: a plan, a pool, a repo. "Which pool" is the first thing the answer needs.
  hosting: {
    kind: 'billing',
    fields: [
      { name: 'pool', label: 'Pool, repo or plan concerned', required: true, max: 200 },
      { name: 'need', label: 'Storage or plan wanted', max: 200 },
    ],
  },
  // Billing: a payment that already happened. Without the reference nobody can look it up.
  invoice: {
    kind: 'billing',
    fields: [
      { name: 'invoice', label: 'Invoice or payment reference', required: true, max: 120 },
      { name: 'amount', label: 'Amount', max: 40 },
      { name: 'paidAt', label: 'Date of the payment', max: 40 },
    ],
  },
  // An account problem. "What you already tried" is asked because the first reply is
  // otherwise always the same three suggestions, and one of them has usually been tried.
  account: {
    kind: 'account',
    fields: [
      { name: 'account', label: 'Account (e-mail or display name)', required: true, max: 200 },
      { name: 'tried', label: 'What you already tried', required: true, max: 600, long: true },
    ],
  },
  data_export: {
    kind: 'data_export',
    fields: [{ name: 'account', label: 'Account (e-mail or display name)', required: true, max: 200 }],
  },
  data_delete: {
    kind: 'data_delete',
    fields: [
      { name: 'account', label: 'Account (e-mail or display name)', required: true, max: 200 },
      { name: 'permanent', label: 'Told that erasure is permanent', type: 'check', required: true },
    ],
  },
  // A security report. The checkbox is the safety rule, made into something the sender
  // has to look at: this form is a plain web form read by staff, so a working exploit
  // against a live account does not belong in it.
  security: {
    kind: 'security',
    fields: [
      { name: 'area', label: 'Where it is (page, endpoint or app)', required: true, max: 200 },
      { name: 'impact', label: 'What someone could do with it', max: 400, long: true },
      { name: 'nosecrets', label: 'Confirmed: no passwords, tokens or data about other people in this message', type: 'check', required: true },
    ],
  },
  // A translation problem. WHERE decides who fixes it: the site's strings are ours, a
  // project's are its maintainers'. `project` is a project ref (lib/project-ref.mjs) and is
  // only asked for, and only required, when the answer to `scope` is a project. The route
  // checks the ref names a real project and writes its NAME into the body.
  translation: {
    kind: 'translation',
    fields: [
      { name: 'scope', label: 'Where the translation is', type: 'choice', options: ['site', 'project'], required: true, max: 20 },
      { name: 'project', label: 'Project', type: 'project', max: 90, requiredIf: { field: 'scope', equals: 'project' } },
      { name: 'page', label: 'Page, screen or text concerned', required: true, max: 300 },
      { name: 'lang', label: 'Language', max: 40 },
    ],
  },
  bug: {
    kind: 'bug',
    fields: [
      { name: 'where', label: 'Where it happens (page or address)', required: true, max: 300 },
      { name: 'version', label: 'App or browser version', max: 120 },
    ],
  },
  other: { kind: 'other', fields: [] },
};

/** The destination ids, for a client that wants to enumerate them. */
export const DESTINATION_IDS = Object.keys(DESTINATIONS);

/**
 * Check what a destination was sent.
 *
 * Returns `{ ok: true, kind, fields }` with the fields trimmed and unknown keys dropped, or
 * `{ ok: false, error, field }`. Never throws: it is fed request bodies.
 */
export function validateContactFields(dest, raw) {
  const spec = DESTINATIONS[String(dest || '')];
  if (!spec) return { ok: false, error: 'unknown_destination' };
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const f of spec.fields) {
    const v = src[f.name];
    if (f.type === 'check') {
      const on = v === true || v === 'true';
      if (!on) { if (f.required) return { ok: false, error: 'field_required', field: f.name }; continue; }
      out[f.name] = true;
      continue;
    }
    // A choice is one of its options or nothing. An unknown value is refused rather than
    // dropped: it is a client that disagrees with this table, and a silent drop would file
    // a project's problem as the site's.
    if (f.type === 'choice') {
      const c = typeof v === 'string' ? v.trim() : '';
      if (!c) { if (f.required) return { ok: false, error: 'field_required', field: f.name }; continue; }
      if (!f.options.includes(c)) return { ok: false, error: 'field_invalid', field: f.name };
      out[f.name] = c;
      continue;
    }
    // A number or a boolean where a string was expected is a client bug, not an attack:
    // read it as text rather than refusing, then apply the same rules.
    const s = v == null ? '' : String(typeof v === 'object' ? '' : v).trim();
    if (!s) { if (f.required) return { ok: false, error: 'field_required', field: f.name }; continue; }
    if (s.length > f.max) return { ok: false, error: 'field_too_long', field: f.name };
    out[f.name] = s;
  }
  // Conditional requirements, read once every field is in: `project` is required exactly
  // when `scope` says project, and dropped when it does not (a stale pick from before the
  // sender changed their mind must not travel).
  for (const f of spec.fields) {
    if (!f.requiredIf) continue;
    const on = out[f.requiredIf.field] === f.requiredIf.equals;
    if (on && !out[f.name]) return { ok: false, error: 'field_required', field: f.name };
    if (!on) delete out[f.name];
  }
  return { ok: true, kind: spec.kind, fields: out };
}

/**
 * The answers, written above the message, in the one place staff already read.
 *
 * Deliberately NOT a new column. The admin inbox renders `body`; a JSON field beside it
 * would be a second place to look, and the thing every "we replied asking for the invoice
 * number" postmortem has in common is that the number was somewhere nobody looked.
 */
export function composeContactBody(dest, fields, body) {
  const spec = DESTINATIONS[String(dest || '')];
  const text = String(body ?? '');
  if (!spec || !spec.fields.length) return text;
  const lines = [];
  for (const f of spec.fields) {
    const v = fields?.[f.name];
    if (v === undefined || v === '') continue;
    lines.push(`${f.label}: ${v === true ? 'yes' : v}`);
  }
  if (!lines.length) return text;
  return `${lines.join('\n')}\n\n---\n\n${text}`;
}
