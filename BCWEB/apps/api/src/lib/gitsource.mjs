// Turning a git forge URL into something a client can actually fetch.
//
// People say "link my git repo" and paste `https://github.com/me/mods`. That page is HTML: a
// client asking it for a manifest gets a web page, and the failure reads as "your repo is
// broken" rather than "that is not the address of a file". Every forge also serves the same
// tree as raw files, at a URL nobody remembers the shape of.
//
// So derive it. This is deliberately NOT git: no clone, no protocol, no credentials, no
// history — the forge is being used as a static file host, which is exactly what a repo
// already is. That means it works today with the client that exists, it costs us nothing to
// serve, and a private repository is simply not supported (its raw URLs 404 without a token,
// and holding somebody's forge token would be the SSH-key mistake again).
//
// Everything here is a pure string transform so it can be checked without a network.

/** github.com/me/mods → raw.githubusercontent.com/me/mods/<ref>/<path> */
function github(u, ref, path) {
  const [owner, repo] = u.pathname.replace(/^\/+/, '').split('/');
  if (!owner || !repo) return null;
  return `https://raw.githubusercontent.com/${owner}/${repo.replace(/\.git$/, '')}/${ref}/${path}`;
}

/** gitlab.com/group/sub/proj → gitlab.com/group/sub/proj/-/raw/<ref>/<path> — the group may
 *  be nested any number of levels, so the whole path is kept rather than the first two parts. */
function gitlab(u, ref, path) {
  const proj = u.pathname.replace(/^\/+/, '').replace(/\.git$/, '').replace(/\/-\/.*$/, '');
  if (!proj || !proj.includes('/')) return null;
  return `https://${u.hostname}/${proj}/-/raw/${ref}/${path}`;
}

/** codeberg / any Gitea: same shape as GitHub's web UI, /raw/branch/<ref>/<path>. */
function gitea(u, ref, path) {
  const [owner, repo] = u.pathname.replace(/^\/+/, '').split('/');
  if (!owner || !repo) return null;
  return `https://${u.hostname}/${owner}/${repo.replace(/\.git$/, '')}/raw/branch/${ref}/${path}`;
}

const FORGES = [
  { host: 'github.com', build: github, label: 'GitHub' },
  { host: 'www.github.com', build: github, label: 'GitHub' },
  { host: 'gitlab.com', build: gitlab, label: 'GitLab' },
  { host: 'codeberg.org', build: gitea, label: 'Codeberg' },
];

/**
 * Is this a forge URL we can turn into a raw file URL, and what would that URL be?
 *
 * Returns `{ forge, manifestUrl, ref }`, or null for anything else — including a URL that is
 * ALREADY a raw file URL, because rewriting one of those would be inventing a second answer
 * for an address that already works.
 *
 * `ref` defaults to HEAD rather than to `main`: a repository whose default branch is `master`
 * (or anything else) is common, and guessing `main` would produce a 404 that looks like the
 * manifest is missing. GitHub and Gitea both accept HEAD in a raw path; GitLab does too.
 */
export function gitManifestUrl(input, { ref = 'HEAD', path = 'repo.json' } = {}) {
  let u;
  try { u = new URL(String(input || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  // Already raw: leave it exactly as it is.
  if (host === 'raw.githubusercontent.com' || u.pathname.includes('/-/raw/') || u.pathname.includes('/raw/branch/')) return null;
  const forge = FORGES.find((f) => f.host === host);
  if (!forge) return null;

  // A URL copied from a branch or file view carries the ref in it, and honouring that is what
  // somebody pasting `.../tree/dev` means. Checked before the generic build so the explicit
  // ref wins over the default.
  const m = /^\/(?:[^/]+\/)+?(?:tree|blob|-\/(?:tree|blob))\/([^/]+)(?:\/.*)?$/.exec(u.pathname);
  const useRef = m ? decodeURIComponent(m[1]) : ref;
  // The project part only: everything from /tree or /blob onward describes where in the
  // repository somebody happened to be looking, which is not where the manifest is.
  const clean = new URL(u.origin + u.pathname.replace(/\/(?:tree|blob|-\/(?:tree|blob))\/.*$/, ''));
  const manifestUrl = forge.build(clean, encodeURIComponent(useRef), path);
  return manifestUrl ? { forge: forge.label, manifestUrl, ref: useRef } : null;
}

/** Does this look like somebody trying to link a git forge at all? Used only to decide
 *  whether to SAY something helpful, never to refuse. */
export function looksLikeForge(input) {
  try {
    const h = new URL(String(input || '').trim()).hostname.toLowerCase();
    return FORGES.some((f) => f.host === h) || /(^|\.)git(hub|lab)\./.test(h) || h.startsWith('git.');
  } catch { return false; }
}
