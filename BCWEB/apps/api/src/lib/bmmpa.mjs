// Reading a BMM automation file (`.bmmpa`) without running it.
//
// DUPLICATED ON PURPOSE, and worth naming rather than discovering later: the same rules
// live in BMM at frontend/src/features/settings/bmmpa-inspect.ts. BMM and BCWEB are
// separate repositories with no shared package, so this cannot import that. BMM's copy is
// the source of truth — it sits next to the scheduler that defines the format — and this
// one must be updated when a new action type or permission is added there. The alternative
// (a moderator with no way to see inside a submitted file) is worse than the duplication.
//
// Nothing here executes, resolves, or fetches anything. A moderator looking at a file must
// not be the file happening — that is the entire reason this exists rather than "import it
// into a test BMM and see".

/** The permission keys a task can grant itself. Mirrors TaskPerms.
 *
 *  Codes, not sentences: this is an API, and a client renders in its own language. Sending
 *  "Runs external programs" made the French moderation screen print English under a French
 *  heading, because there was nothing else it could do with it. */
export const RISK_KEYS = ['command', 'script', 'deeplink', 'stopProcess'];

/** Actions that reach outside BMM whatever the permissions say. A Set of action types
 *  rather than a map to prose — the type IS the stable identifier, and the words belong to
 *  whoever is displaying it. Data rather than a regex on the name: `custom.command` and
 *  `app.stop` share no prefix, and a future `foo.command` should not be flagged by
 *  accident. */
const REACHING_ACTIONS = new Set([
  'custom.command', 'custom.script', 'app.stop', 'app.launch', 'http.request',
  'file.open', 'folder.open', 'open.url', 'restart', 'task.run',
]);

/** Actions that name another thing by id, and what kind. Must match BMM's copy —
 *  check-inspector-parity compares the two. */
const REF_ACTIONS = {
  'task.run': 'task',
  'launchpack.run': 'launchpack',
  'modpack.enable': 'modpack',
  'modpack.disable': 'modpack',
  'profile.activate': 'profile',
};

/**
 * Parameters as short strings, for the moderation view.
 *
 * A summary saying "Run custom command" and nothing else asks a moderator to trust a
 * verb. WHICH program, with which arguments, against which URL, is the decision. Bodies
 * are skipped because they have their own section with a 20 KB cap: repeating a forty-line
 * script inside a tree row makes the tree unreadable for the file that most needs reading.
 */
function flattenParams(p) {
  const out = {};
  for (const [k, v] of Object.entries(p || {})) {
    if (k === 'code' || v === undefined || v === null || v === '') continue;
    const str = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (!str) continue;
    out[k] = str.length > 300 ? str.slice(0, 300) + "…" : str;
  }
  return Object.keys(out).length ? out : undefined;
}

const asArray = (v) => (Array.isArray(v) ? v : []);

function describeTrigger(t) {
  if (!t || typeof t !== 'object') return 'no trigger';
  switch (t.type) {
    case 'interval': return `every ${t.everyMinutes ?? '?'} min`;
    case 'dailyAt': return `daily at ${t.time ?? '?'}`;
    case 'weeklyAt': return `weekly at ${t.time ?? '?'}`;
    case 'monthlyAt': return `monthly at ${t.time ?? '?'}`;
    case 'appStart': return 'when BMM starts';
    case 'manual': return 'manually only';
    // Named rather than blanked: "unknown trigger: foo" tells a moderator something.
    default: return `unknown trigger: ${String(t.type ?? '(none)')}`;
  }
}

/** Walk every branch a step can hold. A dangerous action three levels inside a loop is
 *  still dangerous, and an inspector that reads only the top level produces a CLEAN report
 *  for a file that is not — worse than none, because it is trusted. */
function walkSteps(steps, out, depth = 0) {
  // A submitted file is untrusted input; a self-referencing structure would otherwise
  // recurse until the process dies. 40 is far past anything a person builds by hand.
  if (depth > 40) return [];
  return asArray(steps).map((st) => {
    const kind = String(st?.kind || 'action');
    const node = { kind, children: [] };
    if (kind === 'action') {
      const type = String(st?.action?.type || '');
      const p = st?.action?.params || {};
      node.type = type;
      if (REACHING_ACTIONS.has(type)) {
        node.note = type;
        if (!out.reaching.includes(type)) out.reaching.push(type);
      }
      if (type === 'custom.script' && typeof p.code === 'string') {
        // Capped: a moderator needs to read the script, not receive a megabyte of it.
        out.scripts.push({ engine: String(p.engine || 'powershell'), code: p.code.slice(0, 20_000) });
      }
      // Commands belong here beside scripts, and must stay in step with BMM's copy of this
      // reader (frontend/src/features/settings/bmmpa-inspect.ts) — check-inspector-parity
      // fails the build if they drift. `custom.command` running `powershell -Enc <base64>`
      // is a script by any measure that matters to a moderator; listing only `custom.script`
      // would wave the same payload through for spelling itself differently. Joined into one
      // line because that is what will run — arguments listed apart read as harmless nouns.
      if (type === 'custom.command' && typeof p.program === 'string' && p.program.trim()) {
        const args = Array.isArray(p.args) ? p.args.map((a) => String(a)) : [];
        out.scripts.push({ engine: 'command', code: [p.program.trim(), ...args].join(' ').slice(0, 20_000) });
      }
      node.params = flattenParams(p);
      const refKind = REF_ACTIONS[type];
      if (refKind && p.id) { node.refKind = refKind; node.refId = String(p.id); }
      for (const k of ['program', 'url', 'path', 'name', 'exePath']) {
        const v = p[k];
        if (typeof v === 'string' && v.trim() && out.targets.length < 100 && !out.targets.includes(v.trim())) {
          out.targets.push(v.trim());
        }
      }
    }
    for (const key of ['steps', 'then', 'else', 'onError', 'default']) {
      if (Array.isArray(st?.[key])) node.children.push(...walkSteps(st[key], out, depth + 1));
    }
    if (Array.isArray(st?.cases)) {
      for (const c of st.cases) if (Array.isArray(c?.steps)) node.children.push(...walkSteps(c.steps, out, depth + 1));
    }
    return node;
  });
}

const countSteps = (list) => list.reduce((n, s) => n + 1 + countSteps(s.children), 0);

/** Inspect a parsed .bmmpa document. Takes a value, never a path — this runs on a server
 *  that must not touch a filesystem on a moderator's behalf. */
export function inspectBmmpa(doc) {
  const empty = { ok: false, tasks: [], needsReview: false };
  if (!doc || typeof doc !== 'object') return { ...empty, error: 'Not a .bmmpa document.' };

  // A bare array is accepted because BMM's importer accepts one. Refusing a file the
  // importer would take is not strict, it is misleading — a moderator would read the
  // failure as "this file is broken" and never learn what it contained.
  const tasks = Array.isArray(doc) ? doc : asArray(doc.tasks);
  if (!tasks.length) return { ...empty, error: 'No automations in this file.' };
  if (tasks.length > 500) return { ...empty, error: 'That file declares more automations than any real one has.' };

  const out = tasks.slice(0, 500).map((tk) => {
    const s = {
      name: String(tk?.name || '(unnamed)').slice(0, 200),
      description: typeof tk?.description === 'string' ? tk.description.slice(0, 2000) : undefined,
      enabled: tk?.enabled !== false,
      trigger: describeTrigger(tk?.trigger),
      perms: [], reaching: [], scripts: [], targets: [], stepCount: 0, steps: [],
    };
    const perms = tk?.perms && typeof tk.perms === 'object' ? tk.perms : null;
    if (perms) {
      for (const k of RISK_KEYS) if (perms[k]) s.perms.push(k);
    } else if (tk?.allowCustomCommands) {
      // The legacy single flag. Reporting "no permissions" for a file exported before
      // permissions were split would be a lie of omission on the oldest files around.
      s.perms.push('command', 'deeplink');
    }
    s.steps = walkSteps(tk?.steps, s);
    s.stepCount = countSteps(s.steps);
    return s;
  });

  // Resolved after every task is read: a task may call one declared later in the file,
  // and a backwards-only resolver would report half the references as missing — wrong
  // rather than absent, which is the worse of the two for somebody deciding to approve.
  const taskNames = new Map(tasks.slice(0, 500).map((tk) => [String(tk?.id ?? ''), String(tk?.name ?? '(unnamed)')]));
  const included = {
    launchpack: new Set(asArray(doc.includes?.launchpacks).map((x) => String(x?.id ?? ''))),
    modpack: new Set(asArray(doc.includes?.modpacks).map((x) => String(x?.id ?? x?.name ?? ''))),
  };
  const unresolved = [];
  const resolve = (nodes) => {
    for (const n of nodes) {
      if (n.refId && n.refKind) {
        const name = n.refKind === 'task'
          ? (taskNames.get(n.refId) ?? null)
          : (included[n.refKind]?.has(n.refId) ? n.refId : null);
        n.refName = name;
        // A profile is machine-specific and never travels in a .bmmpa, so an unresolved
        // profile reference is normal rather than a gap worth flagging.
        if (name === null && n.refKind !== 'profile') unresolved.push({ kind: n.refKind, id: n.refId });
      }
      resolve(n.children);
    }
  };
  for (const tk of out) resolve(tk.steps);

  return {
    ok: true,
    version: typeof doc.version === 'number' ? doc.version : undefined,
    exported: typeof doc.exported === 'string' ? doc.exported : undefined,
    tasks: out,
    includes: {
      launchpacks: asArray(doc.includes?.launchpacks).length,
      modpacks: asArray(doc.includes?.modpacks).length,
    },
    unresolved,
    needsReview: out.some((t) => t.perms.length > 0 || t.reaching.length > 0),
  };
}
