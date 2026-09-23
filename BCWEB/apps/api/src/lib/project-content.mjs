// A project's own content beside its page config (PLAN-SEPT23 G2 + G3): release entries, docs
// pages and legal pages. The pure half, kept out of the routes so the rules are unit-testable
// without a database: what a write may carry, which language a reader gets, and how a GitHub
// release or a repository's markdown becomes an entry.
//
// Two things this file is careful about:
//
//   · Nothing here can name a SITE row. The site's docs are DocPage (manage_docs) and the site's
//     legal pages are LegalSection / LegalPage (manage_legal). A project editor holds neither,
//     so the project routes write ProjectDoc / ProjectRelease only, `kind` is one of two words,
//     and the target is always resolved server-side from the URL (pentest R10).
//   · Bodies are B.MD, stored as written. They are rendered by the one renderer the blog and the
//     site docs use (packages/bmd, through apps/web/src/ui/md.jsx), which is where sanitising
//     happens. Escaping here as well would double-encode every `<` a doc legitimately shows.
import { z } from 'zod';
import { httpUrl } from './lib.mjs';
import { isValidLocaleCode } from './locales.mjs';

export const KINDS = Object.freeze(['doc', 'legal']);
export const CHANNELS = Object.freeze(['stable', 'beta', 'rc', 'alpha', 'nightly']);

/** Caps. Generous for real docs, small enough that one project cannot fill the database. */
export const LIMITS = Object.freeze({
  langs: 16,              // languages per entry
  body: 200_000,          // characters of B.MD per language
  notes: 100_000,         // release notes per language
  listItems: 40,          // highlights / breaking changes per language
  assets: 40,             // files per release
  pagesPerKind: 300,      // docs (or legal) pages per project
  releases: 1000,         // release entries per project
  importFiles: 40,        // markdown files one folder import may read
  importBytes: 400_000,   // per imported file
});

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
/** A doc slug from a title or a file name: lower-case ASCII, hyphens, at most 80 characters. */
export function slugifyDoc(s) {
  const out = String(s || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\.md$/i, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 80).replace(/-+$/g, '');
  return out || 'page';
}

/** The legal pages a project usually needs, offered as presets by the editor. */
export const LEGAL_PRESETS = Object.freeze(['privacy', 'terms', 'licence', 'eula', 'cookies', 'notices']);

// ── Languages ────────────────────────────────────────────────────────────────────────────
const langKey = z.string().refine(isValidLocaleCode, { message: 'invalid language code' });

/** A per-language map with at most LIMITS.langs entries and valid codes. */
const langMap = (entry) => z.record(langKey, entry)
  .refine((m) => Object.keys(m).length <= LIMITS.langs, { message: 'too many languages' });

/**
 * Which language a reader gets. The one asked for when it exists, else English, else the first
 * language the entry has. `fallback` says the reader is NOT getting what they asked for, so the
 * page can say "not translated" instead of passing English off as their language.
 */
export function pickLang(content, want) {
  const m = content && typeof content === 'object' && !Array.isArray(content) ? content : {};
  const has = (l) => m[l] && typeof m[l] === 'object';
  const langs = Object.keys(m).filter(has);
  if (want && has(want)) return { lang: want, entry: m[want], fallback: false, langs };
  if (has('en')) return { lang: 'en', entry: m.en, fallback: !!want && want !== 'en', langs };
  if (langs.length) return { lang: langs[0], entry: m[langs[0]], fallback: !!want, langs };
  return { lang: null, entry: null, fallback: false, langs };
}

// ── Docs / legal pages ───────────────────────────────────────────────────────────────────
export const docEntrySchema = z.object({
  title: z.string().trim().max(160).default(''),
  // "Top / Sub" builds the sidebar tree, exactly like the site docs.
  category: z.string().trim().max(120).default(''),
  body: z.string().max(LIMITS.body).default(''),
});

export const docWriteSchema = z.object({
  slug: z.string().trim().regex(SLUG_RE).optional(),
  icon: z.string().trim().max(30).nullish(),
  order: z.number().int().min(-10000).max(10000).optional(),
  published: z.boolean().optional(),
  content: langMap(docEntrySchema).refine(
    (m) => Object.values(m).some((e) => e.title.trim()),
    { message: 'a title in at least one language' },
  ),
  // Version the editor loaded from, for the same conflict check the site docs make.
  baseVersion: z.number().int().optional(),
});

/** Drop empty languages (no title and no body): an empty tab is not a translation. */
export function compactContent(content) {
  const out = {};
  for (const [l, e] of Object.entries(content || {})) {
    if (!e || typeof e !== 'object') continue;
    const has = Object.values(e).some((v) => (Array.isArray(v) ? v.some((x) => String(x || '').trim()) : String(v ?? '').trim()));
    if (has) out[l] = e;
  }
  return out;
}

/** Characters stored for a page, every language: what the per-project size cap counts. */
export const contentSize = (content) => JSON.stringify(content || {}).length;

// ── Release entries ──────────────────────────────────────────────────────────────────────
const CHECKSUM_RE = /^(?:(sha256|sha512|sha1|md5)[:-])?([a-f0-9]{32,128})$/i;
/** "sha256:abc…", "SHA256-abc…" or a bare hex digest → "sha256:abc…" (lower-case); '' when not one. */
export function normalizeChecksum(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  const m = s.match(CHECKSUM_RE);
  if (!m) return null;
  const hex = m[2].toLowerCase();
  const algo = (m[1] || ({ 32: 'md5', 40: 'sha1', 64: 'sha256', 128: 'sha512' }[hex.length] || 'sha256')).toLowerCase();
  return `${algo}:${hex}`;
}

/** An internal blog path, or an http(s) URL. Never javascript:, never protocol-relative. */
const blogLink = z.string().trim().max(600).refine((v) => {
  if (/^\/blog\/[A-Za-z0-9_-]{1,160}$/.test(v)) return true;
  try { const u = new URL(v); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; }
}, { message: 'a /blog/<slug> path or an http(s) URL' });

export const releaseEntrySchema = z.object({
  title: z.string().trim().max(200).default(''),
  highlights: z.array(z.string().trim().max(400)).max(LIMITS.listItems).default([]),
  notes: z.string().max(LIMITS.notes).default(''),
  breaking: z.array(z.string().trim().max(600)).max(LIMITS.listItems).default([]),
});

export const assetSchema = z.object({
  label: z.string().trim().min(1).max(160),
  url: httpUrl(2048),
  // Bytes. Null when unknown: an honest blank beats a guessed number.
  size: z.number().int().min(0).max(1e13).nullish(),
  checksum: z.string().trim().max(200).nullish()
    .refine((v) => !v || normalizeChecksum(v) !== null, { message: 'sha256:<hex>, sha512:<hex>, sha1:<hex> or md5:<hex>' }),
  platform: z.string().trim().max(40).nullish(),
});

// YYYY-MM-DD, or a full ISO datetime.
const dateish = z.string().trim().refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isNaN(Date.parse(v)), { message: 'a date' });
export const toDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00Z`) : new Date(v));

export const releaseWriteSchema = z.object({
  channel: z.enum(CHANNELS).default('stable'),
  date: dateish.optional(),
  content: langMap(releaseEntrySchema).default({}),
  assets: z.array(assetSchema).max(LIMITS.assets).default([]),
  links: z.object({ blog: blogLink.nullish().or(z.literal('')), github: httpUrl(600).nullish().or(z.literal('')) }).partial().default({}),
  published: z.boolean().default(true),
});

export const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$/;

/** A write, cleaned for storage: normalised checksums, empty links and languages dropped. */
export function cleanRelease(d) {
  const links = {};
  if (d.links?.blog) links.blog = d.links.blog;
  if (d.links?.github) links.github = d.links.github;
  const content = {};
  for (const [l, e] of Object.entries(compactContent(d.content))) {
    content[l] = { ...e, highlights: e.highlights.filter(Boolean), breaking: e.breaking.filter(Boolean) };
  }
  return {
    channel: d.channel,
    content,
    assets: d.assets.map((a) => ({
      label: a.label, url: a.url, size: a.size ?? null,
      checksum: a.checksum ? normalizeChecksum(a.checksum) : null, platform: a.platform || null,
    })),
    links,
    published: d.published,
  };
}

/** "v2.4.0" → "2.4.0", "release-7" stays. Only a leading v before a digit is a prefix. */
export const versionFromTag = (tag) => String(tag || '').trim().replace(/^[vV](?=\d)/, '').slice(0, 40);

/** The bullet lines under a "Breaking" heading of a release body, if it has one. */
export function breakingFrom(body) {
  const lines = String(body || '').split(/\r?\n/);
  const out = [];
  let inside = false;
  for (const line of lines) {
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) { inside = /breaking|cassant|incompatib/i.test(h[1]); continue; }
    if (!inside) continue;
    const b = line.match(/^\s*[-*+]\s+(.*\S)\s*$/);
    if (b && out.length < LIMITS.listItems) out.push(b[1].slice(0, 600));
  }
  return out;
}

/**
 * GitHub's /releases list → release entries. Drafts are skipped (a draft is not a release),
 * a pre-release lands on `beta` unless its tag says rc / alpha / nightly, and every asset keeps
 * its size and, when GitHub publishes one, its sha256 digest.
 */
export function releasesFromGithub(list) {
  const out = [];
  const seen = new Set();
  for (const r of Array.isArray(list) ? list : []) {
    if (!r || r.draft) continue;
    const version = versionFromTag(r.tag_name || r.name);
    if (!version || !VERSION_RE.test(version) || seen.has(version)) continue;
    seen.add(version);
    const tag = String(r.tag_name || '');
    const channel = !r.prerelease ? 'stable'
      : /nightly/i.test(tag) ? 'nightly' : /alpha/i.test(tag) ? 'alpha' : /rc/i.test(tag) ? 'rc' : 'beta';
    const name = String(r.name || '').trim();
    const body = String(r.body || '').slice(0, LIMITS.notes);
    out.push({
      version,
      channel,
      date: String(r.published_at || r.created_at || '') || null,
      content: { en: { title: name && name !== tag && name !== version ? name.slice(0, 200) : '', highlights: [], notes: body, breaking: breakingFrom(body) } },
      assets: (Array.isArray(r.assets) ? r.assets : []).slice(0, LIMITS.assets)
        .filter((a) => a && /^https:\/\//.test(String(a.browser_download_url || '')))
        .map((a) => ({
          label: String(a.name || 'file').slice(0, 160),
          url: String(a.browser_download_url),
          size: Number.isFinite(a.size) ? a.size : null,
          checksum: a.digest ? normalizeChecksum(a.digest) || null : null,
          platform: null,
        })),
      links: /^https:\/\/github\.com\//.test(String(r.html_url || '')) ? { github: String(r.html_url) } : {},
      source: 'github',
    });
  }
  return out;
}

// ── Import from a repository's markdown ─────────────────────────────────────────────────
const SEG = /^[A-Za-z0-9_.-]{1,100}$/;
/**
 * Where to read markdown from, from a URL somebody pasted. GitHub only, on purpose: the
 * import reads what it is pointed at, and "any URL" is a server-side fetch of any URL.
 *
 *   github.com/o/r/blob/<branch>/<path>.md   one file
 *   raw.githubusercontent.com/o/r/<branch>/<path>.md
 *   github.com/o/r/tree/<branch>/<dir>        every .md in that folder
 *   github.com/o/r                            the repo's docs/ folder on its default branch
 */
export function githubMarkdownSource(input) {
  let u;
  try { u = new URL(String(input || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const parts = u.pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
  if (parts.some((s) => s === '..' || s === '.')) return null;
  const ok = (a) => a.every((s) => SEG.test(s));
  if (u.hostname === 'raw.githubusercontent.com') {
    const [owner, repo, branch, ...rest] = parts;
    if (!owner || !repo || !branch || !rest.length || !ok([owner, repo, branch, ...rest]) || !/\.md$/i.test(rest[rest.length - 1])) return null;
    return { kind: 'file', owner, repo, branch, path: rest.join('/') };
  }
  if (u.hostname !== 'github.com' && u.hostname !== 'www.github.com') return null;
  const [owner, repo0, mode, branch, ...rest] = parts;
  const repo = String(repo0 || '').replace(/\.git$/, '');
  if (!owner || !repo || !ok([owner, repo])) return null;
  if (!mode) return { kind: 'dir', owner, repo, branch: null, path: 'docs' };
  if (!branch || !ok([branch, ...rest])) return null;
  if (mode === 'blob' && rest.length && /\.md$/i.test(rest[rest.length - 1])) return { kind: 'file', owner, repo, branch, path: rest.join('/') };
  if (mode === 'tree') return { kind: 'dir', owner, repo, branch, path: rest.join('/') };
  return null;
}

export const rawUrl = (s, path) => `https://raw.githubusercontent.com/${s.owner}/${s.repo}/${s.branch}/${path.split('/').map(encodeURIComponent).join('/')}`;

/**
 * A repository's markdown, made to stand on its own on this site: the leading `# Title` becomes
 * the page title (the page draws its own heading), and relative images and links, which pointed
 * at files beside it in the repo, point at those files on GitHub instead of at nothing here.
 */
export function importMarkdown(md, src, path) {
  let body = String(md || '').replace(/^﻿/, '');
  let title = '';
  const h1 = body.match(/^\s*#\s+(.+?)\s*#*\s*$/m);
  if (h1 && body.slice(0, h1.index).trim() === '') {
    title = h1[1].trim().slice(0, 160);
    body = body.slice(h1.index + h1[0].length).replace(/^\s*\n/, '');
  }
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
  const resolve = (rel) => {
    const segs = (dir + rel).split('/');
    const outp = [];
    for (const s of segs) { if (s === '..') outp.pop(); else if (s !== '.' && s !== '') outp.push(s); }
    return outp.join('/');
  };
  const relative = (h) => !/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(h);
  body = body.replace(/(!?)\[([^\]]*)\]\(\s*([^)\s]+)((?:\s+"[^"]*")?)\s*\)/g, (all, bang, text, href, ttl) => {
    if (!relative(href)) return all;
    const [p0, hash = ''] = href.split('#');
    if (!p0) return all;
    const abs = bang
      ? rawUrl(src, resolve(p0))
      : `https://github.com/${src.owner}/${src.repo}/blob/${src.branch}/${resolve(p0).split('/').map(encodeURIComponent).join('/')}${hash ? `#${hash}` : ''}`;
    return `${bang}[${text}](${abs}${ttl})`;
  });
  const file = path.split('/').pop();
  return { slug: slugifyDoc(file === 'README.md' || file === 'index.md' ? (path.split('/').slice(-2, -1)[0] || title || 'readme') : file), title: title || file.replace(/\.md$/i, ''), body };
}
