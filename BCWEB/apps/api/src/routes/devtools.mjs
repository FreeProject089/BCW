// Small tools for the /dev area that need a server but not a subsystem.
//
// Right now: the catalog/repo feed validator. It exists because the only way to find out
// whether a feed was well-formed was to publish it and watch BMM refuse — a loop with a
// human, a deploy and somebody else's app in it.
import { z } from 'zod';
import { requireRole } from '../lib/lib.mjs';
import { safeFetch } from '../lib/net.mjs';

// What a BMM-native catalog feed has to look like. Written here rather than imported from the
// reader because the reader is forgiving on purpose — it has to keep working against feeds
// published years ago — and a validator that is as forgiving as the reader tells you nothing.
// The rule: the reader accepts it, this says whether you MEANT it.
const KINDS = ['app', 'plugin', 'theme', 'preset'];

const add = (out, level, path, message, hint) => out.push({ level, path, message, hint });

function checkEntry(out, entry, i, kind) {
  const at = `${kind}s[${i}]`;
  if (!entry || typeof entry !== 'object') return add(out, 'error', at, 'Not an object.');
  const need = ['id', 'name', 'version'];
  for (const k of need) {
    if (!entry[k]) add(out, 'error', `${at}.${k}`, `Missing ${k}.`, 'Every entry needs an id, a name and a version.');
  }
  if (entry.id && !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(String(entry.id))) {
    add(out, 'error', `${at}.id`, 'An id may only contain letters, digits, dot, dash and underscore.', 'Ids end up in file paths and URLs.');
  }
  if (entry.version && !/^\d+(\.\d+){0,3}([-+].+)?$/.test(String(entry.version))) {
    add(out, 'warn', `${at}.version`, 'Not a numeric version.', 'BMM compares versions numerically; anything else can never be "newer".');
  }
  const url = entry.download || entry.url;
  if (!url) add(out, 'error', `${at}.download`, 'No download URL.', 'Without it nothing can be installed from this entry.');
  else if (!/^https:\/\//i.test(String(url))) add(out, 'error', `${at}.download`, 'The download URL must be https.', 'BMM refuses plain http downloads.');
  if (entry.sha256 && !/^[a-f0-9]{64}$/i.test(String(entry.sha256))) {
    add(out, 'error', `${at}.sha256`, 'Not a SHA-256 hex digest.', 'It should be 64 hex characters.');
  }
  if (!entry.sha256) add(out, 'warn', `${at}.sha256`, 'No checksum.', 'Without one nobody can tell a corrupted or swapped download from a good one.');
  if (entry.description && String(entry.description).length > 2000) {
    add(out, 'warn', `${at}.description`, 'Very long description.', 'Listings truncate it; the first sentence is what people read.');
  }
}

/** Everything wrong with a feed, in one pass — not the first error. Finding out one problem
 *  per publish is the loop this tool exists to break. */
export function validateFeed(doc) {
  const out = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    add(out, 'error', '', 'The top level must be a JSON object.');
    return out;
  }
  const known = KINDS.filter((k) => Array.isArray(doc[`${k}s`]));
  if (!known.length) {
    add(out, 'error', '', 'No entries found.', `Expected at least one of: ${KINDS.map((k) => `${k}s`).join(', ')} — each an array.`);
  }
  for (const k of KINDS) {
    const arr = doc[`${k}s`];
    if (arr === undefined) continue;
    if (!Array.isArray(arr)) { add(out, 'error', `${k}s`, 'Must be an array.'); continue; }
    const seen = new Map();
    arr.forEach((e, i) => {
      checkEntry(out, e, i, k);
      const id = e && e.id;
      if (id) {
        if (seen.has(id)) add(out, 'error', `${k}s[${i}].id`, `Duplicate id "${id}" (also at index ${seen.get(id)}).`, 'An id must be unique within its list — the second one is unreachable.');
        else seen.set(id, i);
      }
    });
  }
  if (doc.version !== undefined && typeof doc.version !== 'number' && typeof doc.version !== 'string') {
    add(out, 'warn', 'version', 'The feed version should be a number or a string.');
  }
  if (!doc.updated && !doc.updatedAt) {
    add(out, 'warn', '', 'No `updated` timestamp.', 'Clients use it to skip a feed that has not changed.');
  }
  return out;
}

export default async function devtoolRoutes(app) {
  // Paste or point. Signed in, because it makes an outbound request on the caller's behalf —
  // anonymous would make this a URL prober with our IP on it.
  app.post('/dev/validate-feed', {
    preHandler: requireRole(), config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const b = z.object({
      url: z.string().url().max(500).optional(),
      body: z.string().max(2_000_000).optional(),
    }).refine((v) => v.url || v.body, { message: 'url or body' }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input', detail: 'Send a url or a body.' });

    let text = b.data.body || '';
    let fetched = null;
    if (!text) {
      try {
        // safeFetch, not fetch: the URL comes from the caller and a plain fetch here would
        // reach anything the container can.
        const res = await safeFetch(b.data.url, { signal: AbortSignal.timeout(10_000) });
        text = (await res.text()).slice(0, 2_000_000);
        fetched = { status: res.status, contentType: res.headers.get('content-type') || null, bytes: text.length };
        if (!res.ok) return reply.send({ ok: false, fetched, problems: [{ level: 'error', path: '', message: `The URL answered ${res.status}.`, hint: 'A feed has to be readable without credentials.' }] });
      } catch (e) {
        const msg = String(e?.message || e);
        return reply.send({ ok: false, problems: [{ level: 'error', path: '', message: msg.startsWith('ssrf_') ? 'That address is not reachable from here (private or blocked).' : `Could not fetch it: ${msg}`, hint: 'The feed must be on a public https URL.' }] });
      }
    }

    let doc;
    try { doc = JSON.parse(text); }
    catch (e) {
      // The parser's own message names the offset, which is the most useful thing anybody
      // gets out of a broken JSON file.
      return reply.send({ ok: false, fetched, problems: [{ level: 'error', path: '', message: `Not valid JSON: ${String(e?.message || e)}`, hint: 'A trailing comma and a smart quote are the usual two.' }] });
    }

    const found = validateFeed(doc);
    const errors = found.filter((f) => f.level === 'error').length;
    const counts = KINDS.reduce((a, k) => (Array.isArray(doc[`${k}s`]) ? { ...a, [k]: doc[`${k}s`].length } : a), {});
    return { ok: errors === 0, fetched, counts, problems: found };
  });
}
