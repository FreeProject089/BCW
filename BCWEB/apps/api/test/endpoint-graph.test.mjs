// Pairing a call with what serves it. The pairs get published as claims about somebody's code,
// so the tests care most about the pairs it must NOT make.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { routeKey, scanFile, buildEndpointGraph, endpointPathsToFetch } from '../src/lib/endpoint-graph.mjs';

describe('routeKey', () => {
    test('every framework spells a parameter differently and they all mean the same thing', () => {
        const k = routeKey('/item/:id');
        assert.equal(routeKey('/item/{id}'), k);
        assert.equal(routeKey('/item/<int:id>'), k);
        assert.equal(routeKey('/item/[id]'), k);
    });
    test('a query string and a trailing slash are not part of the route', () => {
        assert.equal(routeKey('/a/b/?x=1'), routeKey('/a/b'));
    });
    test('an empty path is the root, not an empty key', () => {
        assert.equal(routeKey('/'), '/');
        assert.equal(routeKey(''), '/');
    });
});

describe('scanFile', () => {
    test('reads Express and Fastify routes with their lines', () => {
        const f = scanFile('server.js', "app.get('/users', h);\nrouter.post('/users/:id', h);");
        assert.deepEqual(f.routes.map((r) => [r.method, r.path, r.line]), [['GET', '/users', 1], ['POST', '/users/:id', 2]]);
    });

    test('reads a fetch and an api.get as calls', () => {
        const f = scanFile('web.jsx', "fetch('/api/users');\napi.get('/api/users/1');");
        assert.equal(f.calls.length, 2);
        assert.equal(f.calls[1].method, 'GET');
    });

    test('THE TAURI ONE: a command is the fn the attribute decorates', () => {
        // The name is not on the attribute line — it is on the signature, which may be several
        // lines down past `pub async`. Reading only the attribute line finds nothing at all.
        const rs = '#[tauri::command]\npub async fn scan_mods(app: AppHandle) -> Result<()> {\n  Ok(())\n}';
        const f = scanFile('src-tauri/src/main.rs', rs);
        assert.deepEqual(f.commands.map((c) => c.name), ['scan_mods']);
    });

    test('a bare #[command] counts too', () => {
        const f = scanFile('a.rs', '#[command]\nfn ping() {}');
        assert.deepEqual(f.commands.map((c) => c.name), ['ping']);
    });

    test('reads axum and actix route styles', () => {
        const f = scanFile('a.rs', '.route("/health", get(health))\n#[post("/items")]\nasync fn create() {}');
        assert.deepEqual(f.routes.map((r) => [r.method, r.path]), [['GET', '/health'], ['POST', '/items']]);
    });

    test('reads FastAPI and Flask', () => {
        const f = scanFile('a.py', '@app.get("/items")\ndef items(): pass\n@app.route("/legacy")\ndef legacy(): pass');
        assert.deepEqual(f.routes.map((r) => [r.method, r.path]), [['GET', '/items'], ['ALL', '/legacy']]);
    });

    test('a route inside a comment is not a route', () => {
        // Every README-style example in a source file would otherwise become an endpoint.
        const f = scanFile('a.js', "// app.get('/ghost', h);\n/* app.get('/spectre', h); */\napp.get('/real', h);");
        assert.deepEqual(f.routes.map((r) => r.path), ['/real']);
        assert.equal(f.routes[0].line, 3, 'and the surviving one keeps its true line');
    });

    test('a python comment too', () => {
        const f = scanFile('a.py', '# @app.get("/ghost")\n@app.get("/real")');
        assert.deepEqual(f.routes.map((r) => r.path), ['/real']);
    });

    test('a language it does not read returns null rather than an empty guess', () => {
        assert.equal(scanFile('a.kt', 'fun main() {}'), null);
        assert.equal(scanFile('README.md', 'app.get("/x")'), null);
    });
});

describe('buildEndpointGraph', () => {
    test('a browser call is paired with the server route that serves it', () => {
        const g = buildEndpointGraph({
            'web/item.jsx': "fetch('/api/item/42');",
            'api/routes.js': "app.get('/item/:id', handler);",
        });
        assert.equal(g.links.length, 1);
        const l = g.links[0];
        assert.equal(l.kind, 'http');
        assert.equal(l.from.file, 'web/item.jsx');
        assert.equal(l.to.file, 'api/routes.js');
        // The citation on both halves is the point.
        assert.equal(l.from.line, 1);
        assert.equal(l.to.line, 1);
    });

    test('THE ONE: a path that does not match is NOT paired', () => {
        // A pair is a claim about somebody's code. Pairing on "looks similar" would connect a
        // call to a route it never reaches, and it would look authoritative.
        const g = buildEndpointGraph({
            'web/a.jsx': "fetch('/api/items');",
            'api/r.js': "app.get('/users', h);",
        });
        assert.deepEqual(g.links, []);
        assert.equal(g.unmatched.length, 1);
    });

    test('the method has to agree', () => {
        const g = buildEndpointGraph({
            'web/a.jsx': "api.post('/api/item/1');",
            'api/r.js': "app.get('/item/:id', h);",
        });
        assert.deepEqual(g.links, []);
    });

    test('a Tauri invoke is paired with the Rust command of that name', () => {
        const g = buildEndpointGraph({
            'frontend/src/lib.ts': "await invoke('scan_mods', { id });",
            'src-tauri/src/cmd.rs': '#[tauri::command]\npub fn scan_mods() {}',
        });
        const l = g.links.find((x) => x.kind === 'tauri');
        assert.ok(l, 'paired');
        assert.equal(l.name, 'scan_mods');
        assert.equal(l.from.file, 'frontend/src/lib.ts');
        assert.equal(l.to.file, 'src-tauri/src/cmd.rs');
    });

    test('an invoke with no command behind it is reported, not paired', () => {
        // This is the useful failure: a command that was renamed and a caller nobody updated.
        const g = buildEndpointGraph({ 'a.ts': "invoke('gone_away');" });
        assert.deepEqual(g.links, []);
        assert.equal(g.unmatched[0].kind, 'tauri');
        assert.equal(g.unmatched[0].name, 'gone_away');
    });

    test('the /api prefix the client adds is not part of the server route', () => {
        const g = buildEndpointGraph({ 'w.js': "fetch('/api/health');", 's.js': "app.get('/health', h);" });
        assert.equal(g.links.length, 1);
    });

    test('an empty repo is empty, not a crash', () => {
        const g = buildEndpointGraph({});
        assert.deepEqual(g.links, []);
        assert.equal(g.stats.routes, 0);
    });
});

describe('endpointPathsToFetch', () => {
    test('takes the languages it can read and skips dependencies and builds', () => {
        const got = endpointPathsToFetch(['a.js', 'b.rs', 'c.py', 'd.go', 'e.md', 'node_modules/x.js', 'target/y.rs', 'a.test.js']);
        assert.deepEqual(got, ['a.js', 'b.rs', 'c.py', 'd.go']);
    });
});

describe('names built at runtime', () => {
    test('a command name assembled from a variable is not a name', () => {
        // Found on the real repository: an orphan reported as `${m[1]}`. Pure noise, and noise
        // makes the genuine orphans — a caller nobody updated — less believable.
        const g = buildEndpointGraph({ 'a.ts': 'invoke(`${kind}_list`);\ninvoke("real_one");' });
        assert.deepEqual(g.invokes.map((i) => i.name), ['real_one']);
    });
});

describe('a capped scan does not invent orphans', () => {
    test('unmatched is marked unreliable when the read was truncated', () => {
        // Pointed at tauri-apps/tauri with a 120-file limit, this reported 217 "orphan" invokes
        // and not one was real: the callers were inside the cap and the commands were not.
        const files = { 'a.ts': "invoke('somewhere_else');" };
        assert.equal(buildEndpointGraph(files).unmatchedReliable, true);
        assert.equal(buildEndpointGraph(files, { truncated: true }).unmatchedReliable, false);
    });
});

describe('a client is not a server', () => {
    test('r.get() and api.get() are CALLS, never route declarations', () => {
        // On `got` — an HTTP client — the loose pattern read 841 "routes" out of the library's
        // own examples and tests. A route is declared on a server object.
        const f = scanFile('a.js', "const r = got.extend();\nr.get('/x');\napi.get('/y');\napp.get('/real', h);");
        assert.deepEqual(f.routes.map((x) => x.path), ['/real']);
        assert.deepEqual(f.calls.map((x) => x.path).sort(), ['/y']);
    });
});

describe('Tauri plugin commands', () => {
    test('a plugin invoke is paired with the bare command it names', () => {
        // `plugin:store|get` on the JS side, `fn get` on the Rust side. Found on
        // tauri-apps/tauri-plugin-store: 12 commands, 24 invokes, zero links, every name
        // differing only by the prefix Tauri itself adds.
        const g = buildEndpointGraph({
            'guest-js/index.ts': "await invoke('plugin:store|get', { key });",
            'src/commands.rs': '#[tauri::command]\npub async fn get() {}',
        });
        const l = g.links.find((x) => x.kind === 'tauri');
        assert.ok(l, 'paired');
        assert.equal(l.name, 'plugin:store|get', 'and keeps the name as WRITTEN, not the stripped one');
        assert.equal(l.to.file, 'src/commands.rs');
    });

    test('the prefix is not a licence to match anything', () => {
        const g = buildEndpointGraph({ 'a.ts': "invoke('plugin:store|missing');", 'b.rs': '#[tauri::command]\nfn other() {}' });
        assert.deepEqual(g.links, []);
    });
});
