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
