// Checking a `.bmmscript` before you publish it.
//
// **This is not a compiler, and must never become one.** BMM has exactly one BMMScript
// compiler, written in Rust, and the whole design of the language rests on there being only
// one: the text compiles to the block editor's own steps, so the language can never be
// behind the app. A second implementation over here would be behind the day it was written,
// and it would be the one telling authors their scripts are fine.
//
// So this checks two things a second implementation is allowed to check:
//
//   · **shape** — braces that do not balance, which is the mistake that produces BMM's
//     "there is more text after the task ended" and is almost always a `}` one line early;
//   · **names** — actions, conditions, engines and permissions that BMM does not have,
//     compared against the vocabulary BMM PUBLISHES rather than a copy kept here.
//
// Without that published vocabulary it checks the shape and says so. It never guesses that
// an unfamiliar name is a typo, because the list it is guessing from may simply be older
// than the app.

/** The four capabilities a task can grant itself, when the vocabulary is unavailable. */
const FALLBACK_PERMISSIONS = ['command', 'script', 'deeplink', 'stopProcess'];

/**
 * Walk the source, skipping what is not BMMScript.
 *
 * Strings, comments and `script <engine> { … }` bodies are all places where a `{`, a `}` or
 * the word `do` means nothing — and a checker that counted braces inside a Python body would
 * report a balanced file as broken, which is worse than not checking at all.
 *
 * Returns the code with every skipped region blanked to spaces, so offsets and therefore
 * line numbers stay exactly right.
 */
export function blankNonCode(src) {
  const out = src.split('');
  const blank = (from, to) => { for (let i = from; i < to && i < out.length; i++) if (out[i] !== '\n') out[i] = ' '; };
  let i = 0;
  let braceDepth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"') {
      const start = i;
      i += 1;
      while (i < src.length && src[i] !== '"') i += (src[i] === '\\' ? 2 : 1);
      blank(start, Math.min(i + 1, src.length));
      i += 1;
      continue;
    }
    if ((c === '/' && src[i + 1] === '/') || c === '#') {
      const start = i;
      while (i < src.length && src[i] !== '\n') i += 1;
      blank(start, i);
      continue;
    }
    if (c === '{') {
      // A `script <engine> {` opens a body that is not BMMScript. Blank it whole, matching
      // its own braces so `d = {"a": 1}` inside a Python body does not end it early.
      const before = src.slice(Math.max(0, i - 60), i);
      if (/\bscript\s+\w+\s*$/.test(before)) {
        const bodyStart = i;
        let d = 0;
        let j = i;
        for (; j < src.length; j++) {
          if (src[j] === '{') d += 1;
          else if (src[j] === '}' && --d === 0) break;
        }
        // Keep the outer braces so the balance check still sees a matched pair.
        blank(bodyStart + 1, j);
        i = bodyStart + 1;
        continue;
      }
      braceDepth += 1;
    } else if (c === '}') {
      braceDepth -= 1;
    }
    i += 1;
  }
  return out.join('');
}

/** 1-based line number of an offset. */
function lineAt(src, offset) {
  let n = 1;
  for (let i = 0; i < offset && i < src.length; i++) if (src[i] === '\n') n += 1;
  return n;
}

/**
 * Check a `.bmmscript`.
 *
 * `vocab` is BMM's published vocabulary, or null when it has not been uploaded. Returns
 * `{ problems, notes, grants, checkedNames }` — `checkedNames` false means every name went
 * unchecked, which the caller has to say out loud rather than render as a clean bill.
 */
export function lintBmmScript(source, vocab) {
  const src = String(source || '');
  const code = blankNonCode(src);
  const problems = [];
  const notes = [];

  // ── braces ────────────────────────────────────────────────────────────────
  let depth = 0;
  let firstExtraClose = -1;
  const openStack = [];
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '{') { depth += 1; openStack.push(i); }
    else if (code[i] === '}') {
      depth -= 1;
      openStack.pop();
      if (depth < 0 && firstExtraClose < 0) firstExtraClose = i;
    }
  }
  if (firstExtraClose >= 0) {
    problems.push({
      line: lineAt(src, firstExtraClose),
      text: 'A `}` here closes something that was never opened. In BMM this reads as "there is more text after the task ended", and it is almost always a brace one line early.',
    });
  } else if (depth > 0) {
    problems.push({
      line: lineAt(src, openStack[0] ?? 0),
      text: `${depth} block${depth === 1 ? '' : 's'} left open — this one is never closed.`,
    });
  }

  // ── what it grants itself ─────────────────────────────────────────────────
  const knownPerms = vocab?.permissions || FALLBACK_PERMISSIONS;
  const grants = [];
  for (const m of code.matchAll(/^[ \t]*allow[ \t]+([^\n]+)/gm)) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim();
      if (!name) continue;
      if (!grants.includes(name)) grants.push(name);
      if (!knownPerms.includes(name)) {
        problems.push({
          line: lineAt(src, m.index),
          text: `\`${name}\` is not one of BMM's permissions (${knownPerms.join(', ')}) — it grants nothing, and the step that needs it will fail at run time rather than here.`,
        });
      }
    }
  }

  // ── names, only if BMM has published what they are ────────────────────────
  const checkedNames = !!(vocab && Array.isArray(vocab.actions) && vocab.actions.length);
  if (checkedNames) {
    const actionNames = new Set(vocab.actions.map((a) => a.type));
    const conditionNames = new Set(vocab.conditions || []);
    const engines = new Set(vocab.scriptEngines || []);

    for (const m of code.matchAll(/\bdo[ \t]+([A-Za-z_][\w.]*)/g)) {
      if (!actionNames.has(m[1])) {
        problems.push({ line: lineAt(src, m.index), text: `BMM has no action called \`${m[1]}\`.` });
      }
    }
    for (const m of code.matchAll(/\bscript[ \t]+([A-Za-z_]\w*)/g)) {
      if (!engines.has(m[1])) {
        problems.push({ line: lineAt(src, m.index), text: `\`${m[1]}\` is not one of the script engines (${[...engines].join(', ')}).` });
      }
    }
    // A name in a condition slot is a CONDITION only when nothing compares it. `if count >= 3`
    // reads a variable, and variables are whatever the author called them — flagging those
    // would make the checker useless the moment anybody used `set`.
    for (const m of code.matchAll(/\b(if|case|waitfor|while|until|and|or|not)[ \t]+(?!\()([A-Za-z_]\w*)([^\n]*)/g)) {
      const name = m[2];
      const rest = m[3] || '';
      if (/^\s*(==|!=|>=|<=|>|<)/.test(rest)) continue;          // a comparison: left side is a value
      if (['not', 'and', 'or'].includes(name)) continue;          // `if not online`
      if (conditionNames.has(name)) continue;
      problems.push({ line: lineAt(src, m.index), text: `BMM has no condition called \`${name}\`.` });
    }
  }

  // ── what a reader should be told, which is not the same as a problem ──────
  if (/\bscript[ \t]+\w+[ \t]*\{/.test(code) && !grants.includes('script')) {
    problems.push({ line: 0, text: 'This runs a script and does not `allow script` — that step will fail.' });
  }
  if (grants.length) {
    notes.push(`It grants itself: ${grants.join(', ')}. Anyone opening this file has to read and confirm before BMM will run it.`);
  } else {
    notes.push('It grants itself nothing outside BMM, so opening it offers a one-click run — everything it does, a person could do with the app\'s own buttons.');
  }

  problems.sort((a, b) => a.line - b.line);
  return { problems, notes, grants, checkedNames };
}
