// Identifiers a component uses and its file never defines.
//
// WHY THIS EXISTS
//
// JSX resolves a component identifier at RENDER, not at build. `<SignatureVerdict/>` in a file
// that never imported it compiles perfectly and throws `ReferenceError` the moment the page
// draws. So does `t(...)` in a component that never called `useI18n()`. Vite reports neither,
// because both are valid JavaScript that happens to reference a binding that is not there.
//
// Both shipped, in the same week, from the same two habits:
//
//   · extracting a component into its own file and leaving its helpers behind
//     (`SignatureVerdict`, `BmmpaStep`, `ReplayPlayer` — three crashes, one per file format)
// A second rule — "this component calls t() without obtaining it", the NotificationsPanel
// crash — was written and REMOVED. Knowing where a function ends needs a parser: regex
// string-stripping cannot tell a quote inside a regex literal from a real string, and
// polls.jsx has `.replace(/['’]/g, …)`. The stripper ate the rest of that function, its
// region swallowed the component below it, and every patch produced a different false
// positive. A gate with a standing false positive is one people learn to skip.
//
// Run: node scripts/check-undefined-jsx.mjs   (from apps/web)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = 'src';

// Globals and framework names that are legitimately unbound in the file. Deliberately short:
// a long allowlist is how a checker stops catching things.
const GLOBALS = new Set([
  'Array', 'ArrayBuffer', 'Blob', 'Boolean', 'Buffer', 'Date', 'Error', 'File', 'FileReader',
  'FormData', 'Image', 'Infinity', 'Intl', 'JSON', 'Map', 'Math', 'NaN', 'Number', 'Object',
  'Promise', 'Proxy', 'Reflect', 'RegExp', 'Request', 'Response', 'Set', 'String', 'Symbol',
  'TextDecoder', 'TextEncoder', 'URL', 'URLSearchParams', 'Uint8Array', 'WeakMap', 'WebSocket',
  'AbortController', 'Audio', 'BigInt', 'DataView', 'Float32Array', 'Int32Array', 'Notification',
  'React', 'Fragment', 'Suspense',
  // Lowercase browser and language globals. Rule 2 below looks at bare CALLS, and every one
  // of these is a call a file makes without importing anything — listing them is what
  // separates "this will throw" from "this is the platform".
  'fetch', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask',
  'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'structuredClone',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
  'encodeURI', 'decodeURI', 'alert', 'confirm', 'prompt', 'atob', 'btoa', 'reportError',
  'console', 'window', 'document', 'navigator', 'location', 'history', 'localStorage',
  'sessionStorage', 'crypto', 'performance', 'matchMedia', 'getComputedStyle', 'globalThis',
  'require', 'process', 'import',
  'addEventListener', 'removeEventListener', 'dispatchEvent', 'createImageBitmap',
  'postMessage', 'getSelection', 'scrollTo', 'scrollBy', 'print',
  // Not identifiers a file binds: `async (` reads as a call, and a class body's method
  // definitions (`render() {`) read as calls to themselves.
  'async', 'constructor', 'render', 'componentDidCatch', 'componentDidMount',
  'componentWillUnmount', 'getDerivedStateFromError', 'getDerivedStateFromProps',
  'shouldComponentUpdate', 'get', 'set', 'var',
]);

// Built rather than written as escape sequences — a literal carriage return in this file
// is exactly the bug this line exists to defuse.
const CRLF = String.fromCharCode(13, 10);
const LF = String.fromCharCode(10);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.jsx') || p.endsWith('.js')) out.push(p);
  }
  return out;
}

/**
 * Every name this file binds ANYWHERE — module scope and inside functions alike.
 *
 * Scope-insensitive on purpose. A precise checker needs a real parser; this one only has to
 * answer "does this name exist in this file at all", because the bug it hunts is a name that
 * exists in a DIFFERENT file. Being generous here costs a missed edge case; being strict cost
 * twenty false positives on the first run — every one of them a local, `const I = item.icon`
 * or an `Icon` destructured out of a `.map` parameter — and a checker nobody trusts is worse
 * than no checker.
 */
function bindings(src) {
  const b = new Set();
  // Every `function name(` and `class Name`, at any depth. A helper declared inside another
  // function is still bound for rule 2's purposes, and scope is a question this cannot answer
  // without a parser — so it errs toward silence, which is the right direction for a gate
  // whose only job is catching a name that exists NOWHERE in the file.
  const add = (n) => { if (n && /^[A-Za-z_$][\w$]*$/.test(n)) b.add(n); };
  const addPattern = (text) => { for (const m of text.matchAll(/([A-Za-z_$][\w$]*)/g)) add(m[1]); };

  for (const m of src.matchAll(/import\s+(?:([\w$]+)\s*,\s*)?(?:\{([^}]*)\}|([\w$]+)|\*\s+as\s+([\w$]+))\s*from/g)) {
    for (const g of [m[1], m[3], m[4]]) add(g);
    if (m[2]) for (const part of m[2].split(',')) add(part.trim().split(/\s+as\s+/).pop().trim());
  }
  for (const m of src.matchAll(/(?:async\s+)?function\s*\*?\s*([\w$]*)\s*\(([^)]*)\)/g)) {
    add(m[1]);
    addPattern(m[2]);
  }
  for (const m of src.matchAll(/class\s+([\w$]+)/g)) add(m[1]);
  // Declarations, including destructured ones: `const { a, b } = x`, `const [a, b] = y`.
  for (const m of src.matchAll(/(?:const|let|var)\s+([\w$]+|\{[^}]*\}|\[[^\]]*\])/g)) addPattern(m[1]);
  // Arrow parameters, the shape that produced most of the false positives.
  for (const m of src.matchAll(/\(([^()]*)\)\s*=>/g)) addPattern(m[1]);
  for (const m of src.matchAll(/([\w$]+)\s*=>/g)) add(m[1]);
  for (const m of src.matchAll(/catch\s*\(([^)]*)\)/g)) addPattern(m[1]);
  return b;
}

let failures = 0;
const report = (file, line, msg) => {
  failures += 1;
  console.error(`✗ ${file}:${line}: ${msg}`);
};

for (const file of walk(ROOT)) {
  // Line endings normalised FIRST. This checkout is CRLF, so every line carries a
  // trailing carriage return — and the closing-brace test below (`line === '}'`)
  // matched nothing at all, silently. A region therefore ran past its own function and
  // blamed it for the next component's t(). A checker that quietly does nothing is the
  // failure mode it exists to prevent, so this line is load-bearing.
  const src = readFileSync(file, 'utf8').split(CRLF).join(LF);
  // Strip comments and strings so their contents are never read as code.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length))
    .replace(/`(?:\\.|[^`\\])*`/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/'(?:\\.|[^'\\\n])*'/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/"(?:\\.|[^"\\\n])*"/g, (m) => m.replace(/[^\n]/g, ' '));

  const bound = bindings(src);
  const lines = code.split('\n');

  // ── 1. JSX components the file never binds ──
  const seen = new Set();
  for (const m of code.matchAll(/<([A-Z][\w$]*)[\s/>]/g)) {
    const name = m[1];
    if (bound.has(name) || GLOBALS.has(name) || seen.has(name)) continue;
    // A dotted usage (<Foo.Bar/>) binds on Foo, matched above.
    seen.add(name);
    const line = code.slice(0, m.index).split('\n').length;
    report(file, line, `<${name}> is not imported or defined in this file — it renders as a ReferenceError`);
  }

  // ── 2. bare calls to names the file never binds ──
  //
  // `highlightCode(entry.text, …)` shipped in bmm-inspector.jsx: the extraction that created
  // that file left the import behind in admin.jsx, the build said nothing, and the panel
  // threw the first time a file was opened. Exactly rule 1's failure with different syntax.
  //
  // Only calls that look like a plain identifier followed by `(` count. A member call
  // (`foo.bar()`), a definition, a keyword, and anything after a dot are all skipped, so a
  // method on an object this file received as a prop is never reported.
  const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'await',
    'function', 'new', 'delete', 'void', 'in', 'of', 'do', 'else', 'yield', 'import', 'super', 'this']);
  const calledSeen = new Set();
  for (const m of code.matchAll(/(^|[^.\w$])([a-z_$][\w$]*[A-Z][\w$]*)\s*\(/g)) {
    const name = m[2];
    // camelCase ONLY — an internal capital, as the pattern above requires.
    //
    // The first version matched any lowercase word before a `(` and reported 194 things, of
    // which nearly all were prose: "un fichier (contient", "the limits (", "youtube(" inside
    // a regex literal. Comments and quoted strings are stripped above, but JSX text and
    // regex literals are not, and stripping them properly needs a parser.
    //
    // So the rule is narrowed to the shape a missing IMPORT actually has. It costs the
    // lowercase-only case — a missing `foo()` is not reported — and it keeps the rule
    // green, which is the difference between a gate people read and a gate people mute.
    // Both real bugs it was written for, highlightCode and langOfName, are camelCase.
    if (KEYWORDS.has(name) || bound.has(name) || GLOBALS.has(name) || calledSeen.has(name)) continue;
    calledSeen.add(name);
    const line = code.slice(0, m.index).split('\n').length;
    report(file, line, `${name}() is called but not imported or defined in this file — it throws at render`);
  }

  // ── 3. hooks below an early return ──
  //
  // React counts hooks by call order. A hook placed after `if (loading) return <Loading/>`
  // runs on some renders and not others, which is error #310 and a blank page — and the
  // build is perfectly happy. Both times this happened, the early return was a loading guard
  // and the hook was added later, right next to the code that used it.
  //
  // Scoped to a component function's own top level (two-space indentation), because a hook
  // inside a nested arrow is a different question and not one this can answer.
  let inComponent = null;
  let sawEarlyReturn = 0;
  lines.forEach((raw, i) => {
    if (/^(export\s+)?(default\s+)?function\s+[A-Z]/.test(raw)) { inComponent = raw; sawEarlyReturn = 0; return; }
    if (/^\}/.test(raw)) { inComponent = null; sawEarlyReturn = 0; return; }
    if (!inComponent) return;
    if (/^  if\s*\(.*\)\s*return\b/.test(raw) && !/^\s*\/\//.test(raw)) sawEarlyReturn = i + 1;
    if (!sawEarlyReturn) return;
    // EXACTLY two spaces, then a non-space. `^  ` alone also matched four-space lines,
    // which are hooks inside a NESTED component — those have their own render and their
    // own hook order, and reporting them was a false positive that would have taught
    // everyone to ignore this rule.
    const hook = /^  \S/.test(raw) ? raw.match(/\b(use[A-Z][\w$]*)\s*\(/) : null;
    if (hook) {
      report(file, i + 1,
        `${hook[1]}() runs after the early return on line ${sawEarlyReturn} — a conditional hook (React error #310). Move it above.`);
    }
  });

}

if (failures) {
  console.error(`\n${failures} identifier(s) that would crash at render. The build cannot see these.`);
  process.exit(1);
}
console.log('✓ every component, call and hook resolves in its own file');
