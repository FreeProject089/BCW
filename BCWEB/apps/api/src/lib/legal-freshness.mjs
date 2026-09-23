// Is the date on the legal pages still true?
//
// legal.jsx carries `LEGAL_UPDATED`, a hand-typed date shown to every reader as "Last
// updated". Hand-typed is the problem: editing the terms and forgetting the constant leaves a
// page that states, in writing, a date on which it was not written. That is the one kind of
// staleness that matters here — a privacy policy is quoted by its date, and a wrong one is
// worse than none because it looks authoritative.
//
// Compares the constant against when the FILE actually changed, so the check needs no memory
// and cannot itself go stale.
//
// Pure functions over strings: the caller supplies both dates, so this is testable without a
// git repository or a filesystem.

/** The date the page claims, or null when the constant is missing or malformed. */
export function declaredDate(src) {
  const m = String(src).match(/LEGAL_UPDATED\s*=\s*['"](\d{4}-\d{2}-\d{2})['"]/);
  return m ? m[1] : null;
}

/**
 * The verdict.
 *
 * `fileDate` is when the file last changed according to git — a plain YYYY-MM-DD.
 *
 * A constant NEWER than the file is fine and deliberately not an error: dating a change
 * forward ("these terms take effect on the 1st") is a normal thing to do, and failing on it
 * would teach people to work around the check.
 */
export function checkFreshness(src, fileDate) {
  const declared = declaredDate(src);
  if (!declared) {
    return { ok: false, reason: 'no_constant', message: 'LEGAL_UPDATED is missing or not a YYYY-MM-DD string — the page has no date to show.' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fileDate || ''))) {
    // Unknown is not the same as fine. Reported rather than passed, so a broken lookup cannot
    // read as a clean result.
    return { ok: false, reason: 'unknown_file_date', declared, message: 'Could not read when the file last changed, so freshness is unverified.' };
  }
  if (declared < fileDate) {
    return {
      ok: false,
      reason: 'stale',
      declared,
      fileDate,
      message: `The legal pages changed on ${fileDate} but still say "last updated ${declared}". Set LEGAL_UPDATED to the date the wording actually changed.`,
    };
  }
  return { ok: true, declared, fileDate };
}


// ── when did the WORDING last change ─────────────────────────────────────────────────────
//
// The date to compare against is not "when the file changed" but "when its text changed".
// The first version of both callers dated the file, and a UX pass that only made the
// table-of-contents links 44px tall (class attributes, not one word of any policy) turned the
// gate red: the only way to satisfy it was to tell every reader the policy had changed that
// day, which is exactly the false date this rule exists to prevent.
//
// So a change that is class attributes only does not count. Anything else does -- a comment,
// an import, a component -- because a rule that tries to decide what is "legal text" will one
// day decide wrong in the quiet direction. The patterns leave anything they cannot parse in
// place, so the only possible error is counting a class-only change as a wording change.
//
// ONE implementation, used by apps/web/scripts/check-legal-fresh.mjs AND the API test. They
// used to carry two copies of this rule, and the day one was corrected the other kept failing.

/** The source with its class attributes removed. */
export function stripClasses(src) {
  return String(src)
    .replace(/className="[^"]*"/g, 'className=""')
    .replace(/className=\{`(?:[^`$]|\$\{[^}]*\})*`\}/g, 'className=""');
}

/**
 * The YYYY-MM-DD on which the wording last changed, or '' when history cannot answer.
 * `git(args)` runs git in the repository and returns stdout (injected, so this stays testable
 * and does not decide where the repository is). `rel` is the path from the repository root.
 * `today` is used when the WORKING TREE differs from HEAD in wording: an uncommitted edit to
 * the terms is a change made today, and the check must bite while somebody is editing, not
 * only after the commit.
 */
export function legalWordingDate(git, rel, { working = null, today = new Date().toISOString().slice(0, 10) } = {}) {
  const show = (rev) => { try { return git(['show', `${rev}:${rel}`]); } catch { return null; } };
  if (working != null) {
    const head = show('HEAD');
    if (head != null && stripClasses(working) !== stripClasses(head)) return today;
  }
  const log = String(git(['log', '--format=%H %cs', '--', rel]) || '').trim().split('\n').filter(Boolean);
  for (const line of log) {
    const [sha, date] = line.split(' ');
    const after = show(sha);
    const before = show(`${sha}^`);
    if (before == null || after == null) return date;   // created here, or a root commit
    if (stripClasses(after) !== stripClasses(before)) return date;
  }
  return log.length ? log[log.length - 1].split(' ')[1] : '';
}
