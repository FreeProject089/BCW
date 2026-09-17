#!/usr/bin/env node
// A DELETE that cannot be taken back.
//
// This site has a Gmail-style optimistic undo: `toast.action({ onCommit, onCancel })` in
// ui/ui.jsx. The UI changes at once, the write happens when the toast expires, and Cancel
// means the server was never touched. `useUndoableDelete` / `useUndoableToggle` /
// `useUndoableSave` in pages/pages.jsx are the three house wrappers around it.
//
// Not everything deserves that window, and a gate that demands one everywhere is a gate
// somebody switches off. So the rule here is deliberately narrow, and it is a rule about
// ONE shape of code rather than about "destructive actions" in general:
//
//   · the call is `api.del(...)` — the DELETE verb, the one request whose effect the user
//     cannot reproduce by pressing the button again;
//   · the SAME function already raises a bare `toast.success(...)` AFTER it, so the code
//     already has a "done" moment, already tells the user it worked, and already has the
//     exact place an undo window would live. Nothing has to be invented to fix it;
//   · and nowhere in that function is there a `toast.action(` or one of the house wrappers.
//
// Everything else is left alone on purpose:
//   · a DELETE with no success toast is usually a helper, a cleanup, or a step inside a
//     bigger flow, and bolting a toast onto it to satisfy a checker makes the app noisier;
//   · POST/PUT/PATCH are not covered. Some of them are destructive (a POST that revokes a
//     key) and some are not, and no regex can tell which. Guessing there would flag dozens
//     of harmless saves, and that is how a gate gets switched off;
//   · a DELETE already nested inside `toast.action(...)` or one of the house hooks is the
//     shape this gate wants, so it is recognised lexically and never reported.
//
// Exempt at the site, with the reason written there — a `// undo: …` comment in the 500
// characters before the call. It has to be at the site rather than inferred from a path,
// because "this delete does not need undo" is exactly the judgement that rots silently.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'src';
// The house undo machinery. Any of these in the function means the author thought about it.
const UNDOABLE = /toast\.action\s*\(|useUndoableDelete|useUndoableToggle|useUndoableSave|undoableDelete/;

const files = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p)
    : (f.endsWith('.jsx') || f.endsWith('.js')) ? [p] : [];
});

// Blank out strings, template literals, comments and regex literals, keeping every offset.
// Brace matching below is only trustworthy on the blanked copy: a `/\{6}$/` or a "}" inside
// a string would otherwise close a block that was never open, and the function this reports
// would be the wrong one — a checker naming the wrong line is worse than no checker.
function blank(src) {
  const out = src.split('');
  const hide = (a, b) => { for (let i = a; i < b && i < out.length; i += 1) if (out[i] !== '\n') out[i] = ' '; };
  let i = 0;
  // Is a `/` at `i` the start of a regex literal rather than a division? Look back at the
  // last meaningful character: after a value (identifier, ), ], number) it is division.
  const regexHere = (at) => {
    let j = at - 1;
    while (j >= 0 && /\s/.test(src[j])) j -= 1;
    if (j < 0) return true;
    const c = src[j];
    if (/[)\]}]/.test(c)) return false;
    if (/[\w$]/.test(c)) {
      let k = j;
      while (k >= 0 && /[\w$]/.test(src[k])) k -= 1;
      return /^(return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await)$/.test(src.slice(k + 1, j + 1));
    }
    return true;
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); const end = e === -1 ? src.length : e; hide(i, end); i = end; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); const end = e === -1 ? src.length : e + 2; hide(i, end); i = end; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) break;
        // A ${…} inside a template can hold real code with real braces; leave it visible.
        if (c === '`' && src[j] === '$' && src[j + 1] === '{') { hide(i, j); let d = 1; j += 2; while (j < src.length && d) { if (src[j] === '{') d += 1; else if (src[j] === '}') d -= 1; j += 1; } i = j; continue; }
        j += 1;
      }
      hide(i, Math.min(j + 1, src.length)); i = j + 1; continue;
    }
    if (c === '/' && regexHere(i)) {
      let j = i + 1; let cls = false; let ok = false;
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') cls = true;
        else if (src[j] === ']') cls = false;
        else if (src[j] === '/' && !cls) { ok = true; break; }
        j += 1;
      }
      if (ok) { hide(i, j + 1); i = j + 1; continue; }
    }
    i += 1;
  }
  return out.join('');
}

// Every balanced `open … close` pair that contains `at`, innermost first.
function enclosing(flat, at, open, close) {
  const stack = [];
  const found = [];
  for (let i = 0; i < flat.length; i += 1) {
    if (flat[i] === open) stack.push(i);
    else if (flat[i] === close) { const o = stack.pop(); if (o !== undefined && o < at && i > at) found.push([o, i]); }
  }
  return found.sort((a, b) => (a[1] - a[0]) - (b[1] - b[0]));
}

// The smallest block `{ … }` around `at` that is a FUNCTION body: its `{` follows a `=>`,
// a `)` (so `function f()` / `async (x)` / a method) or the word `function`.
function enclosingFunction(flat, at) {
  for (const [o, c] of enclosing(flat, at, '{', '}')) {
    let j = o - 1;
    while (j >= 0 && /\s/.test(flat[j])) j -= 1;
    if (flat.slice(Math.max(0, j - 1), j + 1) === '=>' || flat[j] === ')') return [o, c];
    if (/function$/.test(flat.slice(Math.max(0, j - 7), j + 1))) return [o, c];
  }
  return null;
}

// Is `at` an ARGUMENT to a call that already defers the write? That is the correct shape —
//   toast.action({ onCommit: async () => { await api.del(…); toast.success(…); } })
//   del(id, () => api.del(…), msg)
// — and the innermost function around the api.del there is the deferred callback itself,
// which of course holds no toast.action. Asking only about that callback flagged every
// properly undoable delete in the app, which would have made the gate exactly the kind
// nobody trusts. So the question is lexical: is this call nested inside one of those.
// The house hooks are destructured under a dozen names (`undo.del`, `undoSaveCfg`,
// `utog.act`, `undoable`), so the test is on the shape of the callee rather than a list.
const DEFERRING = (name) => /^undo/.test(name) || /(?:^|\.)(?:action|del|act|save)$/.test(name);
function insideDeferredCall(flat, at) {
  for (const [o] of enclosing(flat, at, '(', ')')) {
    let j = o - 1;
    while (j >= 0 && /\s/.test(flat[j])) j -= 1;
    let k = j;
    while (k >= 0 && /[\w$.]/.test(flat[k])) k -= 1;
    if (DEFERRING(flat.slice(k + 1, j + 1))) return true;
  }
  return false;
}

const DEL = /\bapi\.del\s*\(/g;
const hits = [];
let exempt = 0;
for (const f of files(SRC)) {
  const src = readFileSync(f, 'utf8');
  if (!src.includes('api.del')) continue;
  const flat = blank(src);
  for (const m of flat.matchAll(DEL)) {
    const at = m.index;
    // Already deferred behind an undo window by whoever called it.
    if (insideDeferredCall(flat, at)) continue;
    const range = enclosingFunction(flat, at);
    if (!range) continue;
    const [o, c] = range;
    const flatBody = flat.slice(o, c);
    // Already undoable, or thought about: nothing to say.
    if (UNDOABLE.test(flatBody)) continue;
    // The "done" moment has to exist, and it has to come after the delete.
    const ok = /toast\.success\s*\(/.exec(flatBody.slice(at - o));
    if (!ok) continue;
    // The stated exemption, written at the call site.
    if (/undo:\s*\S/.test(src.slice(Math.max(0, at - 500), at))) { exempt += 1; continue; }

    hits.push({ f, line: src.slice(0, at).split('\n').length });
  }
}

if (hits.length) {
  for (const h of hits) console.error(`✗ ${h.f}:${h.line}  api.del + a bare toast.success, no undo window`);
  console.error(`\n${hits.length} delete(s) that tell the user it worked and give no way back.`);
  console.error('Use toast.action({ onCommit, onCancel }) (or useUndoableDelete from pages/pages.jsx),');
  console.error('or write the reason at the call site as a  // undo: …  comment.');
  process.exit(1);
}
console.log(`✓ every api.del with a success toast offers undo${exempt ? `, ${exempt} exempt with a stated reason` : ''}`);
