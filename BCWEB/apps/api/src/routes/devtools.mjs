// Small tools for the /dev area that need a server but not a subsystem.
//
// Right now: the catalog/repo feed validator. It exists because the only way to find out
// whether a feed was well-formed was to publish it and watch BMM refuse — a loop with a
// human, a deploy and somebody else's app in it.
import { z } from 'zod';
import { requireRole, requireCap } from '../lib/lib.mjs';
import { inspectBmmpa } from '../lib/bmmpa.mjs';
import { inspectAny } from '../lib/bmm-formats.mjs';
import { buildRbacMap } from '../lib/rbac-map.mjs';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import nodePath from 'node:path';
import { safeFetch } from '../lib/net.mjs';

// What a BMM-native catalog feed has to look like. Written here rather than imported from the
// reader because the reader is forgiving on purpose — it has to keep working against feeds
// published years ago — and a validator that is as forgiving as the reader tells you nothing.
// The rule: the reader accepts it, this says whether you MEANT it.
// The array names a feed may use. Presets are NOT one of them: BetterCommunity publishes
// them under `apps` (see KIND_FEED on the catalog page and the catalog.json renderer, which
// only ever emits apps/plugins/themes), so accepting a `presets` array here would validate a
// shape no reader looks at.
const KINDS = ['app', 'plugin', 'theme'];

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
    const hasPresets = Array.isArray(doc.presets);
    add(out, 'error', '', 'No entries found.',
      hasPresets
        ? 'Found a `presets` array — BetterCommunity publishes presets inside `apps`, and nothing reads `presets`. Rename it.'
        : `Expected at least one of: ${KINDS.map((k) => `${k}s`).join(', ')} — each an array.`);
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
  // Read a submitted BMM automation file without running it.
  //
  // The moderation problem this solves: somebody submits a .bmmpa and the only way to know
  // what is in it is to import it into a real BMM — which is the commitment, made by the
  // person who is supposed to be deciding whether to allow it. This answers from the
  // document alone: what it would do, what permissions it grants itself, what it reaches
  // outside BMM, and the full text of any script it carries.
  //
  // Takes the parsed JSON in the body rather than a URL or an upload. Nothing is fetched
  // and nothing is written: a tool for inspecting untrusted content must not become a way
  // to make the server retrieve untrusted content.
  //
  // manage_catalogs, because this is for reviewing submissions — the same audience that
  // approves the catalog items these arrive as.
  app.post('/admin/bmmpa/inspect', {
    preHandler: requireCap('manage_catalogs', 'MOD'),
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    // A .bmmpa is JSON of unbounded shape, so it is parsed as a raw value rather than
    // described field by field. The size cap is what keeps that safe.
    bodyLimit: 2 * 1024 * 1024,
  }, async (req, reply) => {
    const b = z.object({ doc: z.any() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const report = inspectBmmpa(b.data.doc);
    if (!report.ok) return reply.code(400).send({ error: 'unreadable', detail: report.error });
    return report;
  });

  // Which guard protects which route, read from the route files themselves.
  //
  // Read at request time rather than at boot: this is looked at rarely and the files are
  // a megabyte, so holding the parse in memory for the lifetime of the process would cost
  // more than it saves.
  //
  // ADMIN, not a capability. It reports where the holes are, which is the one map you
  // would want first if you were looking for one — and there is no capability that means
  // "may see the security posture", so the blunt check is the honest one.
  app.get('/admin/rbac-map', {
    preHandler: requireRole('ADMIN'),
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    // Resolved from this module rather than from cwd: the API is started from different
    // directories in dev and in the container, and a relative path silently reads nothing.
    const dir = nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)));
    let files = [];
    try {
      const names = (await fsp.readdir(dir)).filter((f) => f.endsWith('.mjs'));
      files = await Promise.all(names.map(async (name) => ({
        name, src: await fsp.readFile(nodePath.join(dir, name), 'utf8'),
      })));
    } catch (e) {
      return reply.code(500).send({ error: 'unreadable', detail: String(e).slice(0, 200) });
    }
    const map = buildRbacMap(files);
    // A map built from zero files would report zero problems, which is the most
    // dangerous possible answer from a tool like this.
    if (!map.total) return reply.code(500).send({ error: 'parsed_nothing', files: files.length });
    return map;
  });

  // Inspect ANY BMM document — automations, mod lists, session replays, navbar configs.
  //
  // The queue had one button, for .bmmpa. Everything else a person can submit or attach
  // arrived as a blob a moderator could only judge by its filename, which is a guess
  // rather than a decision.
  //
  // Same shape as the .bmmpa route and for the same reasons: the parsed value in the
  // body, never a URL — a tool for inspecting untrusted content must not become a way to
  // make the server fetch untrusted content. Nothing is executed, fetched or written.
  app.post('/admin/inspect', {
    preHandler: requireCap('manage_catalogs', 'MOD'),
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    bodyLimit: 8 * 1024 * 1024,
  }, async (req, reply) => {
    const b = z.object({ doc: z.any() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const report = inspectAny(b.data.doc);
    // 200 with ok:false, not a 4xx: "this is not a format I know" is an ANSWER about the
    // file, and the body carries the keys it did find so the caller can say what it saw.
    return report;
  });

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
