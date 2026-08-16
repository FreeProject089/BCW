// Pairing a call with the thing that serves it.
//
// The import graph answers "what is wired to what" inside one language. This crosses the gap the
// imports cannot: a `fetch('/api/item/1')` in a browser bundle and a `router.get('/item/:id')`
// in a server, or an `invoke('scan_mods')` in a Tauri front end and a
// `#[tauri::command] fn scan_mods` in Rust. Neither side imports the other — the only thing
// joining them is a string, and that string is IN BOTH FILES.
//
// Which is exactly why this is worth doing and why it stays honest: a pair is reported only when
// the same route appears on both sides, and each half carries its own file and line so a reader
// can check both in one click. Nothing is inferred from a name, a folder or a convention.

const EXT = (p) => (String(p).match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
const JS = new Set(['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts', 'svelte', 'vue']);

/** Blank comments rather than delete them, so every offset — and so every line number — holds. */
function blankComments(src, lang) {
    let s = String(src)
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
    if (lang === 'py') s = s.replace(/#[^\n]*/g, (m) => ' '.repeat(m.length));
    return s;
}

const lineOf = (raw, idx) => raw.slice(0, idx).split('\n').length;
const textOf = (raw, line) => (raw.split('\n')[line - 1] || '').trim().slice(0, 200);

/**
 * A route as a comparable key.
 *
 * Every framework spells a parameter differently — `:id`, `{id}`, `<int:id>`, `[id]`, `*` — and
 * they all mean "anything here". Normalised to one token so `/item/:id` and `/item/{id}` are the
 * same route, which is the entire point: the two sides are written by different tools.
 */
export function routeKey(path) {
    return String(path)
        .split('?')[0]
        .replace(/\/+$/, '')
        .replace(/\{[^}]*\}/g, '/:p')          // {id}
        .replace(/<[^>]*>/g, ':p')             // <int:id>
        .replace(/\[[^\]]*\]/g, ':p')          // [id]  (Next-style)
        .replace(/:[A-Za-z_][\w]*/g, ':p')     // :id
        .replace(/\/\/+/g, '/')
        .toLowerCase() || '/';
}

/** Strip a prefix the client adds and the server does not mount, e.g. `/api`. */
const stripBase = (p, bases) => {
    for (const b of bases) {
        if (b && p.toLowerCase().startsWith(b.toLowerCase())) return p.slice(b.length) || '/';
    }
    return p;
};

/**
 * Does this route serve this call?
 *
 * Not string equality. The client writes a VALUE where the server writes a PARAMETER —
 * `/api/item/42` against `/item/:id` — so they never compare equal, and the first version of
 * this paired nothing at all on the one case the whole feature exists for. Compared segment by
 * segment, where a parameter on the route side accepts any single segment.
 *
 * A parameter on the CALL side (a template literal that became `:p`) also matches, because
 * `fetch(`/item/${id}`)` is the same call written with the value still in a variable.
 */
export function routeServes(routePath, callPath) {
    const r = routeKey(routePath).split('/');
    const c = routeKey(callPath).split('/');
    // A trailing wildcard route (`/files/*`) covers everything below it.
    const wild = r[r.length - 1] === '*' || r[r.length - 1] === ':p*';
    if (!wild && r.length !== c.length) return false;
    for (let i = 0; i < r.length; i++) {
        if (r[i] === '*' || r[i] === ':p*') return true;
        if (r[i] === ':p' || c[i] === ':p') continue;   // either side may hold the parameter
        if (r[i] !== c[i]) return false;
    }
    return true;
}

const METHODS = 'get|post|put|patch|delete|head|options|all';

/** What one file declares (routes, Tauri commands) and what it calls. */
export function scanFile(path, source) {
    const ext = EXT(path);
    const lang = JS.has(ext) ? 'js' : ext === 'rs' ? 'rs' : ext === 'py' ? 'py' : ext === 'go' ? 'go' : null;
    if (!lang) return null;

    const raw = String(source);
    const src = blankComments(raw, lang);
    const routes = []; const calls = []; const commands = []; const invokes = [];
    const at = (i) => ({ line: lineOf(raw, i), text: textOf(raw, lineOf(raw, i)) });

    if (lang === 'js') {
        // NOT `api` or a bare `r`: those are client names, and on an HTTP-client library every
        // `r.get(...)` in its own docs and tests became a "route" — 841 of them on one repo.
        // A route is DECLARED on a server object; anything else is a call.
        // Express / Fastify / Koa-router / Hono: `app.get('/x'`, `router.post("/x"`.
        for (const m of src.matchAll(new RegExp(`\\b(?:app|router|server|fastify|routes)\\s*\\.\\s*(${METHODS})\\s*\\(\\s*['"\`]([^'"\`]+)['"\`]`, 'gi'))) {
            routes.push({ method: m[1].toUpperCase(), path: m[2], ...at(m.index) });
        }
        // A client call. `fetch` and the usual wrappers; a template literal keeps its `${}` and
        // routeKey turns that into a parameter, which is what it is.
        for (const m of src.matchAll(/\bfetch\s*\(\s*['"`]([^'"`]+)['"`]/g)) {
            calls.push({ method: 'GET', path: m[1], ...at(m.index) });
        }
        for (const m of src.matchAll(new RegExp(`\\b(?:api|axios|http|client)\\s*\\.\\s*(${METHODS})\\s*\\(\\s*['"\`]([^'"\`]+)['"\`]`, 'gi'))) {
            calls.push({ method: m[1].toUpperCase(), path: m[2], ...at(m.index) });
        }
        // Tauri: the JS side of a command.
        for (const m of src.matchAll(/\binvoke\s*(?:<[^>]*>)?\s*\(\s*['"`]([^'"`]+)['"`]/g)) {
            // A command name built at runtime — invoke(`${kind}_list`) — is not a name.
            // Found on the real repository, reported as an orphan literally called
            // "${m[1]}": pure noise, and noise makes the genuine orphans — a caller
            // nobody updated after a rename — less believable.
            if (m[1].includes('${')) continue;
            invokes.push({ name: m[1], ...at(m.index) });
        }
    } else if (lang === 'rs') {
        // axum / actix builder style: `.route("/x", get(handler))`
        for (const m of src.matchAll(/\.route\s*\(\s*"([^"]+)"\s*,\s*(\w+)/g)) {
            routes.push({ method: m[2].toUpperCase(), path: m[1], ...at(m.index) });
        }
        // actix / rocket attribute style: `#[get("/x")]`
        for (const m of src.matchAll(new RegExp(`#\\[(${METHODS})\\s*\\(\\s*"([^"]+)"`, 'gi'))) {
            routes.push({ method: m[1].toUpperCase(), path: m[2], ...at(m.index) });
        }
        // Tauri: `#[tauri::command]` then the fn it decorates — the name is on the NEXT
        // signature, which may be several lines down past `pub async`.
        for (const m of src.matchAll(/#\[(?:tauri::)?command[^\]]*\]/g)) {
            const after = src.slice(m.index, m.index + 400);
            const fn = after.match(/\bfn\s+([A-Za-z_]\w*)/);
            if (fn) commands.push({ name: fn[1], ...at(m.index) });
        }
    } else if (lang === 'py') {
        // FastAPI / Flask decorators.
        for (const m of src.matchAll(new RegExp(`@\\w+\\.(${METHODS}|route)\\s*\\(\\s*['"]([^'"]+)['"]`, 'gi'))) {
            routes.push({ method: m[1].toLowerCase() === 'route' ? 'ALL' : m[1].toUpperCase(), path: m[2], ...at(m.index) });
        }
    } else if (lang === 'go') {
        for (const m of src.matchAll(new RegExp(`\\.(?:HandleFunc|Handle|${METHODS.split('|').map((x) => x[0].toUpperCase() + x.slice(1)).join('|')})\\s*\\(\\s*"([^"]+)"`, 'g'))) {
            routes.push({ method: 'ALL', path: m[1], ...at(m.index) });
        }
    }

    return { path, lang, routes, calls, commands, invokes };
}

/**
 * Pair every call with the route that serves it, across languages.
 *
 * @param sources {path: contents}
 * @param opts.bases prefixes a client adds that the server does not mount (default `/api`)
 * @returns { links, routes, calls, commands, invokes, unmatched }
 */
export function buildEndpointGraph(sources = {}, { bases = ['/api'], truncated = false } = {}) {
    const scans = Object.entries(sources).map(([p, s]) => scanFile(p, s)).filter(Boolean);

    const routes = []; const calls = []; const commands = []; const invokes = [];
    for (const f of scans) {
        for (const r of f.routes) routes.push({ ...r, file: f.path, lang: f.lang, key: routeKey(r.path) });
        for (const c of f.calls) calls.push({ ...c, file: f.path, lang: f.lang, key: routeKey(stripBase(c.path, bases)) });
        for (const c of f.commands) commands.push({ ...c, file: f.path, lang: f.lang });
        for (const i of f.invokes) invokes.push({ ...i, file: f.path, lang: f.lang });
    }

    const links = [];
    const unmatched = [];

    // HTTP: a call meets a route when the normalised paths agree and the method is compatible.
    // ALL matches anything — that is what a framework's `route()` means.
    for (const c of calls) {
        const hit = routes.filter((r) => routeServes(r.key, c.key) && (r.method === 'ALL' || c.method === 'ALL' || r.method === c.method));
        if (!hit.length) { unmatched.push({ kind: 'http', ...c }); continue; }
        // A call in the same file as its route is somebody's own router being mounted, not a
        // client reaching a server. Skipped: it would draw a file calling itself.
        for (const r of hit) {
            if (r.file === c.file && r.line === c.line) continue;
            links.push({ kind: 'http', method: c.method, route: c.key, from: c, to: r });
        }
    }

    // Tauri: `invoke('x')` meets `#[tauri::command] fn x`. Exact names — a command name is an
    // identifier on both sides, so there is nothing to normalise and nothing to guess.
    const byName = new Map();
    for (const cmd of commands) {
        if (!byName.has(cmd.name)) byName.set(cmd.name, []);
        byName.get(cmd.name).push(cmd);
    }
    for (const inv of invokes) {
        const hit = byName.get(inv.name);
        if (!hit?.length) { unmatched.push({ kind: 'tauri', ...inv }); continue; }
        for (const cmd of hit) links.push({ kind: 'tauri', name: inv.name, from: inv, to: cmd });
    }

    return {
        links, routes, calls, commands, invokes,
        // An unmatched call is worth showing: usually a third-party URL, sometimes a route that
        // moved and a caller nobody updated. Both are things a reader wants to know.
        unmatched: unmatched.slice(0, 100),
        // ...but ONLY when the whole repository was read. On a capped scan of a monorepo the
        // callers land inside the cap and the handlers do not, and every one of them looks
        // orphaned: pointed at tauri-apps/tauri with a 120-file limit this produced 217
        // "orphans" and not one of them was real. A finding that is an artefact of the cap must
        // not be presented as a finding.
        unmatchedReliable: !truncated,
        stats: {
            routes: routes.length, calls: calls.length,
            commands: commands.length, invokes: invokes.length,
            links: links.length, unmatched: unmatched.length,
        },
    };
}

/** Which files are worth reading for endpoints — more languages than the import graph. */
export function endpointPathsToFetch(paths = [], { limit = 400, maxDepth = 8 } = {}) {
    const WANT = new Set([...JS, 'rs', 'py', 'go']);
    return paths
        .filter((p) => WANT.has(EXT(p)))
        .filter((p) => !/(^|\/)(node_modules|vendor|dist|build|out|target|coverage|\.next|\.git)(\/|$)/.test(p))
        .filter((p) => !/\.(test|spec|min|d)\.[cm]?[jt]sx?$/.test(p))
        .filter((p) => p.split('/').length - 1 <= maxDepth)
        .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
        .slice(0, limit);
}
