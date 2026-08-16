// Checking an installer.toml against the schema that will actually read it.
//
// The failure this exists for is silent by construction: no struct in bpkg-core's config.rs
// uses `deny_unknown_fields`, so serde DISCARDS any key it does not recognise. Write
// `[[componentss]]` and the installer builds perfectly with no components — nothing errors,
// nothing warns, and the mistake surfaces as a missing feature in a shipped installer.
//
// The schema is never restated here. It arrives as a list of key paths derived, in Rust, by
// round-tripping a parsed config — the same derivation the engine's own test uses. A list
// written out in JavaScript would be wrong the first time somebody adds a field, and wrong
// silently, which is the exact shape of the bug it is meant to catch.

/**
 * Every key path in a parsed TOML document, with array indices collapsed to `[]`.
 *
 * `[[components]]` produces `components[].id`, not `components.0.id`, because the schema
 * describes a shape and the recipe describes an instance of it — comparing them by index
 * would report the second component's every key as unknown.
 *
 * Leaf arrays (`tags = ["a", "b"]`) are a VALUE, not a path: their elements are data, and
 * walking into them would invent `tags[]` as a key nobody declared.
 */
export function keyPaths(doc, prefix = '', out = new Set()) {
    if (!doc || typeof doc !== 'object') return out;
    if (Array.isArray(doc)) {
        // An array of tables. Every element contributes to the SAME shape.
        for (const el of doc) if (el && typeof el === 'object' && !Array.isArray(el)) keyPaths(el, prefix, out);
        return out;
    }
    for (const [k, v] of Object.entries(doc)) {
        const path = prefix ? `${prefix}.${k}` : k;
        const isTableArray = Array.isArray(v) && v.some((e) => e && typeof e === 'object' && !Array.isArray(e));
        if (isTableArray) {
            // `components`, then `components[].id` — and NOT a bare `components[]`. This
            // must match the Rust derivation exactly, and it did not: the schema artifact
            // has no `components[]` entry, so emitting one here reported every array-of-
            // tables section in a perfectly good recipe as an unknown key. Caught by
            // running the real schema against the real recipe, which is the only check
            // that compares the two derivations rather than each against itself.
            out.add(path);
            keyPaths(v, `${path}[]`, out);
        } else if (v && typeof v === 'object' && !Array.isArray(v)) {
            out.add(path);
            keyPaths(v, path, out);
        } else {
            out.add(path);
        }
    }
    return out;
}

/**
 * What the schema makes of this recipe.
 *
 * Three answers, and they are different questions:
 *   dropped   the recipe sets it and the schema has never heard of it. Serde discards it.
 *             This is the finding — everything else is context.
 *   dead      the schema knows the key and NOTHING reads it. It parses and does nothing,
 *             which is worse than a typo because it looks correct.
 *   unset     the schema knows it and the recipe is silent. Almost always fine; listed so
 *             "which knobs exist?" has an answer, and never counted as a problem.
 */
export function checkRecipe(doc, schema) {
    const known = new Set(schema?.keys || []);
    const dead = new Set(schema?.knownDead || []);
    if (!known.size) return { ok: false, error: 'schema_empty' };

    const used = keyPaths(doc);

    // Dead keys are NOT dropped keys. They are absent from `keys` too — the schema lists what
    // it READS — so without this they appear twice, once as known debt and once as a mystery,
    // and the author goes looking for a typo in a key that is spelled perfectly.
    const allDropped = [...used].filter((p) => !known.has(p) && !dead.has(p));

    // Report the SHALLOWEST unknown path and nothing beneath it. `[[componentss]]` is ONE
    // typo, and listing it beside `componentss[].id` and `componentss[].name` makes the reader
    // find the common prefix themselves — the mistake is the table name, once.
    //
    // Both separators, and that is not cosmetic: a child of `componentss` is
    // `componentss[].id`, so testing only `${q}.` misses every array-of-tables section and
    // reports the typo twice.
    const hasDroppedAncestor = (p) => allDropped.some((q) => q !== p && (p.startsWith(`${q}.`) || p.startsWith(`${q}[]`)));
    const dropped = allDropped.filter((p) => !hasDroppedAncestor(p)).sort();
    const deadUsed = [...used].filter((p) => dead.has(p)).sort();
    const unset = [...known].filter((p) => !used.has(p)).sort();

    return {
        ok: dropped.length === 0,
        counts: { used: used.size, known: known.size, dropped: dropped.length, dead: deadUsed.length, unset: unset.length },
        dropped,
        dead: deadUsed,
        unset,
    };
}

/**
 * The closest schema key to a dropped one, when there obviously is one.
 *
 * `componentss` → `components[]` is the whole reason this feature exists, and a checker that
 * reports the typo without naming the word it meant makes the reader do the diff themselves.
 * Deliberately conservative: only a genuinely near miss, so a suggestion is a fact rather than
 * a guess. Distance is computed on the LAST segment — `install.mian_exe` and `app.mian_exe`
 * are different mistakes and only one of them has a candidate.
 */
export function nearest(path, known) {
    const seg = (p) => p.split('.').pop().replace(/\[\]$/, '');
    const parent = path.split('.').slice(0, -1).join('.');
    const target = seg(path);
    let best = null;
    let bestD = Infinity;
    for (const k of known) {
        if (k.split('.').slice(0, -1).join('.') !== parent) continue;
        const d = editDistance(target, seg(k));
        if (d < bestD) { bestD = d; best = k; }
    }
    // At most a third of the word, and never for very short names where every word is close.
    const cap = Math.max(1, Math.floor(target.length / 3));
    return best && bestD <= cap && target.length >= 4 ? { key: best, distance: bestD } : null;
}

function editDistance(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
        const cur = [i];
        for (let j = 1; j <= n; j++) {
            cur[j] = Math.min(
                prev[j] + 1,
                cur[j - 1] + 1,
                prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
            );
        }
        prev = cur;
    }
    return prev[n];
}
