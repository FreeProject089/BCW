// What counts as a colour, for anything the theme emits into CSS.
//
// Its own module, with no imports, for two reasons: the gradient stops and the page tokens
// must not each grow their own opinion of what a colour is (that is how one of two gates ends
// up looser than the other), and scripts/check-site-theme.mjs runs this in plain node to
// compare it against the API's copy — it cannot pull in React to do that.

// A token value ends up inside a <style> element served to every visitor, so it is a place
// where a stray `}` would end the rule and everything after it would be attacker-chosen CSS.
//
// This used to be a shape check whose `color-mix` branch was `color-mix\(in srgb[^;{}]*\)` —
// "anything at all as long as it has no semicolon or brace and ends in a paren". That is much
// wider than it reads. `color-mix(in srgb, red, blue) url(https://evil/x)` passes it, and
// `background: <colour> <image>` is perfectly valid CSS, so `--surface` alone turned every
// `.card` on the site into a request to a third party — on every page load, for every
// visitor, and *before* the cookie banner, which gates scripts and knows nothing about
// stylesheets. Verified: the string passed this gate, passed the API's copy of it, was
// emitted into the theme <style>, and the browser resolved it to a real `url()`. The edge CSP
// does not stop it either — `img-src` allows `https:`.
//
// So it is an ALLOWLIST now, the way `safeColor` in packages/bmd already was after the
// September pass closed the same class for directive `color=`. That pass hardened the half
// an ordinary author could reach and left this one, which reaches every page — hence the
// second look. Nothing but a colour gets through: a hex, an rgb/hsl function of numbers, a
// bare colour NAME, a `var(--token)`, or a `color-mix(in srgb, …)` whose arguments are
// themselves those things with an optional percentage. No `url()`, no `image-set()`, no
// `element()`, no nesting we did not name.
//
// The API enforces the identical rule (config-schemas.mjs) and scripts/check-site-theme.mjs
// asserts the two agree on a shared corpus, so the copy cannot drift into a preview that
// renders what the server would refuse — or, worse, accepts what the server would take.
const HEX = /^#[0-9a-fA-F]{3,8}$/;
const FUNC = /^(?:rgb|rgba|hsl|hsla)\(\s*[0-9.,%\s/-]+\)$/;
const NAMED = /^[a-zA-Z]{1,24}$/;               // transparent, currentColor, red…
const VAR = /^var\(\s*--[a-zA-Z0-9_-]{1,48}\s*\)$/;
const PCT = /^-?[0-9.]{1,8}%$/;
const simpleColour = (s) => HEX.test(s) || FUNC.test(s) || NAMED.test(s) || VAR.test(s);

/** Split on commas at depth 0, so `rgb(1, 2, 3) 40%` stays one argument. */
function splitArgs(s) {
  const out = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

export function safeColour(v) {
  const s = String(v ?? '').trim();
  if (!s || s.length > 120) return null;
  if (simpleColour(s)) return s;
  // color-mix(in srgb, <colour> <pct>?, <colour> <pct>?) — the shape the engine itself emits
  // for every derived surface, and the only reason this branch exists at all.
  const m = /^color-mix\(\s*in\s+srgb\s*,([\s\S]+)\)$/i.exec(s);
  if (!m) return null;
  const args = splitArgs(m[1]);
  if (args.length < 2 || args.length > 3) return null;
  for (const a of args) {
    const parts = a.split(/\s+/).filter(Boolean);
    if (!parts.length || parts.length > 2) return null;
    // A percentage may sit on either side of the colour, which is what CSS allows.
    const colour = parts.find((x) => !PCT.test(x));
    const pcts = parts.filter((x) => PCT.test(x));
    if (!colour || pcts.length > 1 || !simpleColour(colour)) return null;
  }
  return s;
}
