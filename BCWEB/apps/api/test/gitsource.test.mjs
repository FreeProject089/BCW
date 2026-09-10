// A forge URL is a web page, not a file. This turns one into the other, or says it cannot.
//
// The failure this prevents is quiet and misleading: a client handed `github.com/me/mods` gets
// HTML back, fails to parse it as a manifest, and reports that the repo is broken — when what
// actually happened is that nobody ever pointed at a file.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { gitManifestUrl, looksLikeForge } from '../src/lib/gitsource.mjs';

describe('gitManifestUrl', () => {
  test('a GitHub project page becomes a raw manifest URL', () => {
    const r = gitManifestUrl('https://github.com/me/mods');
    assert.equal(r.forge, 'GitHub');
    assert.equal(r.manifestUrl, 'https://raw.githubusercontent.com/me/mods/HEAD/repo.json');
  });

  test('HEAD, not main', () => {
    // Guessing `main` 404s on every repository whose default branch is called something else,
    // and a 404 here reads as "the manifest is missing" rather than "the branch is wrong".
    assert.match(gitManifestUrl('https://github.com/me/mods').manifestUrl, /\/HEAD\//);
  });

  test('a .git suffix is dropped', () => {
    assert.equal(gitManifestUrl('https://github.com/me/mods.git').manifestUrl,
      'https://raw.githubusercontent.com/me/mods/HEAD/repo.json');
  });

  test('a branch URL keeps its branch', () => {
    const r = gitManifestUrl('https://github.com/me/mods/tree/dev');
    assert.equal(r.ref, 'dev');
    assert.equal(r.manifestUrl, 'https://raw.githubusercontent.com/me/mods/dev/repo.json');
  });

  test('a file URL keeps the branch and ignores the file', () => {
    // Somebody pastes the address of the file they are looking at. The branch in it is real
    // information; the path is not, because the manifest name is ours to decide.
    const r = gitManifestUrl('https://github.com/me/mods/blob/v2/docs/readme.md');
    assert.equal(r.ref, 'v2');
    assert.equal(r.manifestUrl, 'https://raw.githubusercontent.com/me/mods/v2/repo.json');
  });

  test('a GitLab project, including a nested group', () => {
    assert.equal(gitManifestUrl('https://gitlab.com/team/sub/proj').manifestUrl,
      'https://gitlab.com/team/sub/proj/-/raw/HEAD/repo.json');
  });

  test('Codeberg uses the Gitea shape', () => {
    assert.equal(gitManifestUrl('https://codeberg.org/me/mods').manifestUrl,
      'https://codeberg.org/me/mods/raw/branch/HEAD/repo.json');
  });

  test('a URL that is ALREADY raw is left alone', () => {
    // Rewriting an address that already works would be inventing a second answer for it.
    assert.equal(gitManifestUrl('https://raw.githubusercontent.com/me/mods/HEAD/repo.json'), null);
    assert.equal(gitManifestUrl('https://gitlab.com/me/mods/-/raw/HEAD/repo.json'), null);
    assert.equal(gitManifestUrl('https://codeberg.org/me/mods/raw/branch/HEAD/repo.json'), null);
  });

  test('anything that is not a forge we know is left alone', () => {
    assert.equal(gitManifestUrl('https://example.com/repo.json'), null);
    assert.equal(gitManifestUrl('https://mods.example.com/'), null);
  });

  test('junk in gives null, not a throw', () => {
    for (const x of ['', null, undefined, 'not a url', 'ftp://github.com/me/mods']) {
      assert.equal(gitManifestUrl(x), null);
    }
  });

  test('an owner with no repository is not a project', () => {
    assert.equal(gitManifestUrl('https://github.com/me'), null);
    assert.equal(gitManifestUrl('https://gitlab.com/me'), null);
  });

  test('a ref with a slash survives, encoded', () => {
    const r = gitManifestUrl('https://github.com/me/mods/tree/feature%2Fx');
    assert.equal(r.ref, 'feature/x');
    assert.match(r.manifestUrl, /feature%2Fx/);
  });

  test('the manifest name is a parameter, not a constant here', () => {
    assert.match(gitManifestUrl('https://github.com/me/mods', { path: 'catalog.json' }).manifestUrl, /\/catalog\.json$/);
  });
});

describe('looksLikeForge', () => {
  test('recognises the ones it can convert, and near misses worth mentioning', () => {
    assert.equal(looksLikeForge('https://github.com/me/mods'), true);
    assert.equal(looksLikeForge('https://git.example.org/me/mods'), true);
    assert.equal(looksLikeForge('https://gitlab.example.org/me/mods'), true);
  });

  test('does not shout at an ordinary URL', () => {
    assert.equal(looksLikeForge('https://mods.example.com/repo.json'), false);
    assert.equal(looksLikeForge('nonsense'), false);
  });
});
