// GitHub tells us the repository changed; the code graph is rebuilt.
//
// Encapsulated as its own plugin for the same reason the Stripe webhook is: the signature is an
// HMAC over the RAW bytes, so this route needs a body parser that hands back a Buffer, and that
// parser must not apply to the rest of the API.
//
// Where the secret comes from is the whole design here:
//   • a showcase project ("other projects") — only from its own page. There is no sensible
//     environment variable for a project an admin created this afternoon.
//   • an official project (bmm/bsm/installer/community/developers) — from its page if set,
//     otherwise from GITHUB_WEBHOOK_SECRET. The page wins so one repo can be rotated without a
//     redeploy, and the env is the floor so the official set works out of the box.
//
// A project with no secret anywhere is REFUSED, never accepted unsigned. An unauthenticated
// endpoint that rebuilds a graph on demand is a way to make the server fetch hundreds of files
// from GitHub on someone else's schedule.

import crypto from 'node:crypto';
import { db, safeEqual } from '../lib/lib.mjs';
import { safeFetch } from '../lib/net.mjs';
import { buildCodeGraph, sourcePathsToFetch, entryPoints } from '../lib/code-graph.mjs';
import { buildEndpointGraph, endpointPathsToFetch } from '../lib/endpoint-graph.mjs';
import { functionEdges, buildFlow, drawableFunctions } from '../lib/code-flow.mjs';

const OFFICIAL = new Set(['community', 'bmm', 'bsm', 'installer', 'developers']);
const GH_REPO_RE = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i;

/** Where a project's snapshot lives. One row per project, replaced on every rebuild. */
export const snapshotKey = (key) => `codegraph.${key}`;
/** The webhook settings an admin edits. */
export const settingsKey = (key) => `codegraph.settings.${key}`;

/**
 * The secret this project's webhook must be signed with, and where it came from.
 *
 * Returned with its origin so the admin screen can say "from the page" or "from the server
 * environment" rather than leaving somebody guessing which one is in force.
 */
export async function secretFor(p, key) {
    const row = await p.adminSetting.findUnique({ where: { key: settingsKey(key) } }).catch(() => null);
    const own = row?.value?.secret;
    if (own) return { secret: own, from: 'page' };
    if (OFFICIAL.has(key) && process.env.GITHUB_WEBHOOK_SECRET) {
        return { secret: process.env.GITHUB_WEBHOOK_SECRET, from: 'env' };
    }
    return { secret: null, from: null };
}

/**
 * GitHub's headers, with a token when there is one.
 *
 * Anonymous, the API allows 60 requests an hour, and reading four projects costs eight —
 * plus one per file over raw.githubusercontent, which is not rate-limited the same way. That
 * is enough until it is not: a rebuild of every project mid-afternoon hits the wall and every
 * project after the first two reports "unreachable", which reads like the repository is gone.
 * `GITHUB_TOKEN` (a read-only PAT, or the one CI already has) raises it to 5000.
 */
function ghHeaders() {
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
    return {
        'User-Agent': 'bcweb',
        Accept: 'application/vnd.github+json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
}

/** Read a repository and store the graph. Shared by the webhook and the manual button. */
export async function rebuildSnapshot(p, key, url, maxFiles = 150) {
    const m = String(url || '').match(GH_REPO_RE);
    if (!m) return { ok: false, error: 'not_a_github_repo' };
    const [, owner, repo] = m;

    let tree;
    try {
        const meta = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: ghHeaders() }).then((r) => r.json());
        tree = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${meta.default_branch}?recursive=1`, { headers: ghHeaders() }).then((r) => r.json());
    } catch (e) {
        return { ok: false, error: 'github_unreachable', detail: String(e.message || e).slice(0, 120) };
    }

    // A rate-limited or errored answer has no `tree` at all. Reported as itself: without this
    // it fell through as "a repository with no files", stored an empty graph, and the project
    // page then showed an architecture that had been successfully read and was empty.
    if (!Array.isArray(tree?.tree)) {
        return { ok: false, error: 'github_unreadable', detail: String(tree?.message || 'no file list in the response').slice(0, 160) };
    }
    const paths = tree.tree.filter((e) => e.type === 'blob').map((e) => e.path);
    const wanted = [...new Set([
        ...sourcePathsToFetch(paths, { limit: maxFiles }),
        ...endpointPathsToFetch(paths, { limit: maxFiles }),
    ])];
    const sources = {};
    for (let i = 0; i < wanted.length; i += 12) {
        await Promise.all(wanted.slice(i, i + 12).map(async (path) => {
            try {
                const res = await safeFetch(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${path}`, { headers: { 'User-Agent': 'bcweb' } });
                if (res.ok) sources[path] = (await res.text()).slice(0, 400_000);
            } catch { /* one unreadable file is not a failed scan */ }
        }));
    }
    // The same refusal the manual endpoint makes: a graph built from a third of the files is
    // not that repository's architecture, and stored it would look like one for ever.
    if (Object.keys(sources).length < wanted.length * 0.6 && wanted.length > 10) {
        return { ok: false, error: 'incomplete_fetch', got: Object.keys(sources).length, wanted: wanted.length };
    }

    const graph = buildCodeGraph(sources);
    const endpoints = buildEndpointGraph(sources, { truncated: !!graph.stats?.truncated });
    // Stored with the snapshot: recomputing the function level needs the SOURCES, and the
    // snapshot is the only place they were ever all held at once.
    const functions = functionEdges(endpoints.links, sources);
    const flows = functions.slice(0, 40).map((e) => buildFlow(e, sources)).filter(Boolean);
    // Which functions are worth drawing inside each file box — only the ones an edge or a
    // flow actually touches, so a 900-line module contributes three chips and not forty.
    const fnByFile = drawableFunctions(functions, sources, flows);
    const value = {
        url, generatedAt: new Date().toISOString(),
        stats: graph.stats, endpointStats: endpoints.stats,
        graph: { ...graph, entries: entryPoints(graph).slice(0, 20) },
        endpoints, functions, flows, fnByFile,
    };
    const k = snapshotKey(key);
    await p.adminSetting.upsert({ where: { key: k }, create: { key: k, value }, update: { value } });
    return { ok: true, stats: value.stats, endpointStats: value.endpointStats };
}

export default async function codeWebhookRoutes(app) {
    // Raw body, scoped to this plugin only — the HMAC is over the bytes GitHub sent, and a
    // parsed-and-restringified body is not those bytes.
    app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

    app.post('/webhooks/code/:key', async (req, reply) => {
        const key = String(req.params.key || '');
        const p = await db();

        const { secret } = await secretFor(p, key);
        // No secret configured anywhere → refuse. Accepting it unsigned would let anybody make
        // this server fetch hundreds of files from GitHub whenever they liked.
        if (!secret) return reply.code(403).send({ error: 'no_secret_configured' });

        const sig = req.headers['x-hub-signature-256'] || '';
        const mine = `sha256=${crypto.createHmac('sha256', secret).update(req.body).digest('hex')}`;
        // safeEqual, never `===`: a byte-by-byte comparison that returns early leaks the
        // signature one character at a time.
        if (!safeEqual(sig, mine)) return reply.code(401).send({ error: 'bad_signature' });

        let payload = {};
        try { payload = JSON.parse(req.body.toString('utf8')); } catch { /* ping has a body too */ }
        const event = req.headers['x-github-event'] || '';
        // Answer a ping so GitHub's "recent deliveries" shows green immediately — the usual way
        // somebody finds out the secret is wrong is by never getting a green tick.
        if (event === 'ping') return { ok: true, pong: true };
        if (event !== 'push') return { ok: true, ignored: event };

        const row = await p.adminSetting.findUnique({ where: { key: settingsKey(key) } }).catch(() => null);
        const url = row?.value?.url || (payload.repository?.html_url ?? null);
        if (!url) return reply.code(400).send({ error: 'no_repo_configured' });

        // Answered BEFORE the rebuild. GitHub gives a webhook ten seconds; reading three hundred
        // files takes longer, and a timeout would mark the delivery failed and invite a retry
        // that starts the whole scan again.
        reply.send({ ok: true, queued: true });
        rebuildSnapshot(p, key, url).catch(() => {});
        return reply;
    });
}
