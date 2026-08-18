// Derive every project's "How it runs" from its repository, and store it.
//
// The tab existed for months on three hand-written boxes. `project.bmm` and
// `project.installer` each held three nodes and two edges — "App → Backend → Files" — while
// the detector that reads a repository and the graph builder that reads its imports were both
// already here, wired to admin buttons nobody had pressed for those projects. The diagram was
// not wrong; it was a placeholder that had stopped looking like one.
//
// So this runs the SAME two passes the admin buttons run, for every project that names a
// GitHub repository, and writes the result where the page reads it:
//
//   1. detectStack()   — what is deployed: manifests, compose files, frameworks. Every node
//                        carries the path that produced it, and a repo with nothing
//                        recognisable yields nothing rather than a plausible three-tier lie.
//   2. rebuildSnapshot() — what is wired to what: the import graph, the endpoint pairs, the
//                        call flows, read from the source.
//
// What it will NOT do:
//   · invent a node. If the detector finds nothing, the project keeps whatever it had.
//   · overwrite the admin's own words. `note`, `title` and any hand-placed node the detector
//     did not find are kept — a script that erases somebody's annotation to replace it with a
//     generated box is a script nobody runs twice.
//
// Run:  node src/rebuild-project-architecture.mjs [key…]   (default: every configured project)

import { PrismaClient } from '@prisma/client';
import { detectStack, interestingPaths } from './lib/stack-detect.mjs';
import { buildEndpointGraph, endpointPathsToFetch } from './lib/endpoint-graph.mjs';
import { rebuildSnapshot } from './routes/code-webhook.mjs';

const KEYS = ['community', 'bmm', 'bsm', 'installer', 'developers'];
const GH = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i;

const p = new PrismaClient();
const want = process.argv.slice(2).filter((a) => KEYS.includes(a));
if (process.argv.includes('--reset')) console.log('--reset: every stored node is dropped, including hand-written ones.');
const keys = want.length ? want : KEYS;

async function gh(url) {
    const res = await fetch(url, { headers: { 'User-Agent': 'bcweb', Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
}

/** The repository a project names, from wherever the config keeps it. */
function repoOf(cfg) {
    const candidates = [cfg?.repo, cfg?.github, cfg?.links?.github, cfg?.stack?.repo];
    return candidates.find((u) => typeof u === 'string' && GH.test(u)) || null;
}

/** Merge a detected draft into the stored stack, keeping everything a person wrote. */
function merge(existing = {}, draft, { reset = false } = {}) {
    const byId = new Map((draft.nodes || []).map((n) => [n.id, n]));
    // A node the admin placed by hand and the detector did not find is KEPT: it is usually
    // the piece no manifest can prove (a game install, an external service).
    //
    // `gen: true` marks a node THIS script drew, so a rerun replaces its own work instead of
    // piling a second copy beside it — which is exactly what the first run did, leaving BSM
    // with both "Main process" and a box called "electron". `--reset` drops everything,
    // including hand-written nodes, and is for the first pass over a stack that predates the
    // marker.
    const kept = (existing.nodes || [])
        .filter((n) => !byId.has(n.id))
        .filter((n) => !reset && n.gen !== true);
    const edgeKey = (e) => (Array.isArray(e) ? `${e[0]}>${e[1]}` : `${e.from ?? e.source}>${e.to ?? e.target}`);
    const draftEdges = new Set((draft.edges || []).map(edgeKey));
    const keepId = new Set([...(draft.nodes || []), ...kept].map((n) => n.id));
    // An edge whose node is gone is not an edge.
    const keptEdges = (existing.edges || [])
        .filter((e) => !draftEdges.has(edgeKey(e)))
        .filter((e) => {
            const [from, to] = Array.isArray(e) ? e : [e.from ?? e.source, e.to ?? e.target];
            return keepId.has(from) && keepId.has(to);
        });
    return {
        ...existing,
        enabled: true,
        nodes: [...(draft.nodes || []), ...kept],
        edges: [...(draft.edges || []), ...keptEdges],
        // The admin's own words survive; only the drawing is regenerated.
        note: existing.note || draft.note || '',
        title: existing.title || undefined,
        // Publishing a code map is a DECISION — it is a description of somebody's repository,
        // and nothing here turns a private detail public because a feature shipped. `--publish`
        // is that decision, made once on the command line rather than by a default.
        showCodeMap: existing.showCodeMap === true || process.argv.includes('--publish') ? true : undefined,
    };
}

for (const key of keys) {
    const row = await p.adminSetting.findUnique({ where: { key: `project.${key}` } });
    if (!row?.value) { console.log(`${key}: not configured — skipped`); continue; }
    const url = repoOf(row.value);
    if (!url) { console.log(`${key}: names no GitHub repository — skipped`); continue; }

    // Publishing is a config flag, not derived data, so it is applied BEFORE the network —
    // a rate-limited GitHub must not be the reason a decision the operator already made
    // fails to stick.
    if (process.argv.includes('--publish') && row.value.stack?.showCodeMap !== true) {
        const stack = { ...(row.value.stack || {}), showCodeMap: true };
        await p.adminSetting.update({ where: { key: `project.${key}` }, data: { value: { ...row.value, stack } } });
        row.value = { ...row.value, stack };
        console.log(`${key}: code map published`);
    }

    const [, owner, repo] = url.match(GH);
    let paths = [];
    try {
        const meta = await gh(`https://api.github.com/repos/${owner}/${repo}`);
        const tree = await gh(`https://api.github.com/repos/${owner}/${repo}/git/trees/${meta.default_branch}?recursive=1`);
        paths = (tree.tree || []).filter((e) => e.type === 'blob').map((e) => e.path);
    } catch (e) {
        console.log(`${key}: ${url} unreachable (${e.message})`);
        continue;
    }

    // ── 1. what is deployed ────────────────────────────────────────────────────
    const wanted = interestingPaths(paths);
    const files = {};
    for (let i = 0; i < wanted.length; i += 10) {
        await Promise.all(wanted.slice(i, i + 10).map(async (path) => {
            try {
                const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${path}`, { headers: { 'User-Agent': 'bcweb' } });
                if (res.ok) files[path] = (await res.text()).slice(0, 200_000);
            } catch { /* one unreadable file is not a failed scan */ }
        }));
    }

    // The calls that join boxes no manifest connects — a desktop app has no compose file, and
    // without this its front end and its backend are two unconnected rectangles.
    let endpointLinks = [];
    try {
        const srcPaths = endpointPathsToFetch(paths, { limit: 120 });
        const srcFiles = {};
        for (let i = 0; i < srcPaths.length; i += 12) {
            await Promise.all(srcPaths.slice(i, i + 12).map(async (path) => {
                try {
                    const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${path}`, { headers: { 'User-Agent': 'bcweb' } });
                    if (res.ok) srcFiles[path] = (await res.text()).slice(0, 200_000);
                } catch { /* same */ }
            }));
        }
        endpointLinks = buildEndpointGraph(srcFiles).links;
    } catch { /* no connections is a poorer draft, not a failed one */ }

    const draft = detectStack(files, { endpointLinks });
    if (!draft.nodes?.length) {
        console.log(`${key}: nothing recognisable in ${wanted.length} manifest(s) — left alone`);
    } else {
        const stack = merge(row.value.stack || {}, draft, { reset: process.argv.includes('--reset') });
        const value = { ...row.value, stack };
        await p.adminSetting.update({ where: { key: `project.${key}` }, data: { value } });
        console.log(`${key}: ${stack.nodes.length} node(s), ${stack.edges.length} edge(s) `
            + `(was ${(row.value.stack?.nodes || []).length}/${(row.value.stack?.edges || []).length}) `
            + `from ${Object.keys(files).length} manifest(s)`);
    }

    // ── 2. what is wired to what ───────────────────────────────────────────────
    const snap = await rebuildSnapshot(p, key, url, 300);
    if (snap.ok) {
        console.log(`   code map: ${snap.stats?.drawn ?? '?'} file(s) drawn of ${snap.stats?.total ?? '?'}, `
            + `${snap.endpointStats?.links ?? 0} call link(s)`);
    } else {
        console.log(`   code map: ${snap.error}${snap.detail ? ` — ${snap.detail}` : ''}`);
    }
}

await p.$disconnect();
