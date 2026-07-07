// Line-based 3-way merge (à la git). Given a common ancestor `base` and two edited
// versions `mine` and `theirs`, produce a merged text — resolving non-overlapping
// changes automatically and marking overlapping ones with git-style conflict markers
// (<<<<<<<, =======, >>>>>>>). Used for concurrent blog/doc editing: when a save
// collides with someone else's, we merge instead of clobbering.

// LCS of two line arrays → the matched index pairs [i, j] (a[i] === b[j]), increasing.
function lcsPairs(a, b) {
  const n = a.length, m = b.length;
  // DP table of LCS lengths (row-major). Capped by the caller for huge inputs.
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

// base index → matched index in `other` (or -1). Monotonic where defined (LCS order).
function matchMap(base, other) {
  const map = new Array(base.length).fill(-1);
  for (const [bi, oi] of lcsPairs(base, other)) map[bi] = oi;
  return map;
}

const eq = (x, y) => x.length === y.length && x.every((v, k) => v === y[k]);

// Merge three line arrays. Returns { lines, conflicts }.
function mergeLines(base, mine, theirs, labels) {
  const mMap = matchMap(base, mine);
  const tMap = matchMap(base, theirs);
  // Sync anchors = base lines unchanged in BOTH edits (present in both LCSs).
  const anchors = [];
  for (let i = 0; i < base.length; i++) if (mMap[i] >= 0 && tMap[i] >= 0) anchors.push(i);

  const out = []; let conflicts = 0;
  let bi = 0, mi = 0, ti = 0;
  const resolve = (bSlice, mSlice, tSlice) => {
    if (eq(mSlice, tSlice)) { out.push(...mSlice); return; }        // both made the same edit
    if (eq(mSlice, bSlice)) { out.push(...tSlice); return; }        // only theirs changed
    if (eq(tSlice, bSlice)) { out.push(...mSlice); return; }        // only mine changed
    conflicts++;                                                     // both changed, differently
    out.push(`<<<<<<< ${labels.mine}`, ...mSlice, '=======', ...tSlice, `>>>>>>> ${labels.theirs}`);
  };
  for (const a of anchors) {
    resolve(base.slice(bi, a), mine.slice(mi, mMap[a]), theirs.slice(ti, tMap[a]));
    out.push(base[a]);                                              // the common line itself
    bi = a + 1; mi = mMap[a] + 1; ti = tMap[a] + 1;
  }
  resolve(base.slice(bi), mine.slice(mi), theirs.slice(ti));        // tail after the last anchor
  return { lines: out, conflicts };
}

const CAP = 8000; // lines — beyond this, skip the O(n·m) merge and force a manual resolve

// Public: merge3(base, mine, theirs) → { text, conflicts }. `\n`-line based; keeps the
// original text's dominant EOL is out of scope (we normalise to \n).
export function merge3(base, mine, theirs, labels = { mine: 'yours', theirs: 'theirs' }) {
  const B = String(base ?? '').split('\n');
  const M = String(mine ?? '').split('\n');
  const T = String(theirs ?? '').split('\n');
  if (B.length > CAP || M.length > CAP || T.length > CAP) {
    // Too large to merge safely in-browser — surface as one big conflict.
    return { text: `<<<<<<< ${labels.mine}\n${mine}\n=======\n${theirs}\n>>>>>>> ${labels.theirs}`, conflicts: 1 };
  }
  const { lines, conflicts } = mergeLines(B, M, T, labels);
  return { text: lines.join('\n'), conflicts };
}

// Does a body still contain unresolved conflict markers?
export function hasConflictMarkers(text) {
  return /^<<<<<<< |^=======$|^>>>>>>> /m.test(String(text || ''));
}
