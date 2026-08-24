// Names for entries inside a zip we hand somebody.
//
// A zip entry name is not a string, it is an instruction to the extractor about where to
// write a file. `../../.bashrc` is a valid entry name, and a great many extractors will
// happily follow it out of the target directory (zip-slip). The person extracting is not
// the person who chose the name: repo archives go to collaborators and to anyone holding
// the repo password.
//
// Nothing upstream can be relied on to have cleaned this. `norm()` in hosting-content.mjs
// maps every character outside [A-Za-z0-9._-] to an underscore — which permits '.', so a
// segment of exactly '..' passes through untouched. It has been that way for every file
// registered so far, so rows with such a path may already exist; cleaning at the point the
// archive is BUILT is what makes those harmless without a migration.
//
// Rules, in order:
//   * separators are normalised to '/', and backslash counts as one (a Windows extractor
//     treats 'a\\..\\b' as traversal even though POSIX sees one filename)
//   * '.' and '..' segments are dropped
//   * empty segments collapse, so a leading or doubled slash cannot make an absolute path
//   * a Windows drive prefix ('C:') loses its colon, so it cannot re-anchor a path
//   * control characters and the characters Windows refuses go to '_'
//   * the result is never empty and never starts with '/'
const BAD = /[\x00-\x1f<>:"|?*\\]/g;

/** One safe entry name, built from path pieces. Pieces may themselves contain separators. */
export function zipEntryName(...parts) {
  const segs = [];
  for (const part of parts) {
    for (const raw of String(part ?? '').split(/[\\/]+/)) {
      const seg = raw.replace(BAD, '_').trim();
      // '..' is the whole point of this function; '.' is noise that some extractors also
      // mishandle. Both are dropped rather than renamed, so 'a/../b' becomes 'a/b' — the
      // file still lands somewhere sensible instead of under a folder called '__'.
      if (!seg || seg === '.' || seg === '..') continue;
      // A trailing dot or space is stripped on Windows at creation time, which silently
      // turns 'x.' into 'x' and can collide with a real 'x'.
      const clean = seg.replace(/[. ]+$/, '');
      if (clean) segs.push(clean.slice(0, 120));
    }
  }
  const name = segs.join('/');
  return name || 'unnamed';
}
