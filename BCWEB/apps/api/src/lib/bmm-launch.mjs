// notify (agent-notify): the BMM launch feed, the rules.
//
// BMM shows ONE modal at start-up. What goes in it is decided here, by staff, as a short list of
// cards (BmmLaunchItem): a chosen blog post, "whatever the newest BMM post is", or a custom card.
// The public document is `GET /bmm/launch?version=&lang=` (routes/bmm-launch.mjs), shaped exactly
// as the shared contract says (contracts-laya-notify.md, "BCWEB → BMM launch feed"):
//
//   { v: 1, generatedAt, items: [{ id, rev, kind: 'blog'|'custom', title, summary, url, imageUrl,
//     publishedAt, display: { mode, times, from, until, minVersion, maxVersion }, priority }] }
//
// REV. The client counts displays per id+rev, so `rev` must move exactly when what the card SAYS
// moves: a new latest post, an edited title, a new picture. It is derived from a hash of the
// resolved content (both languages) and bumped with a conditional update, so two replicas that
// notice the same change bump it once. Display settings (dates, how many times) do not move it:
// changing "3 times" to "5 times" is not a new message.
//
// URLS. Only absolute https URLs leave this module, checked by parsing (lib.mjs httpUrl explains
// why a prefix test or z.string().url() is not a check). The one exception is a development
// install whose own SITE_URL is http://localhost: its blog links are http, and refusing them
// would make the feed impossible to try locally. A custom card is https, always.
import crypto from 'node:crypto';

export const SOURCES = ['post', 'latest', 'custom'];
export const DISPLAY_MODES = ['always', 'once', 'times'];
export const SUMMARY_MAX = 400;
export const MAX_ITEMS = 10;
export const LAUNCH_CONFIG_KEY = 'bmm.launch';

const siteUrl = () => (process.env.SITE_URL || 'http://localhost:5176').replace(/\/$/, '');
const isLocalHost = (h) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]';

/** An absolute https URL with no credentials in it, or null. `allowLocalHttp` admits
 *  http://localhost for links this site builds to itself in development. */
export function httpsUrl(v, { allowLocalHttp = false } = {}) {
  const s = String(v ?? '').trim();
  if (!s || s.length > 2048) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.username || u.password) return null;
  if (u.protocol === 'https:') return u.toString();
  if (u.protocol === 'http:' && allowLocalHttp && isLocalHost(u.hostname)) return u.toString();
  return null;
}

/** A link to this site: https in production; http only when SITE_URL itself is local http. */
export function siteLink(path) {
  const site = siteUrl();
  const local = (() => { try { const u = new URL(site); return u.protocol === 'http:' && isLocalHost(u.hostname); } catch { return false; } })();
  return httpsUrl(`${site}${path}`, { allowLocalHttp: local });
}

/** A picture: absolute https, or a site-relative path made absolute. */
export function imageLink(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (s.startsWith('/') && !s.startsWith('//')) return siteLink(s);
  return httpsUrl(s);
}

// ── semver ─────────────────────────────────────────────────────────────────────────────

const SEMVER = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-([0-9A-Za-z.-]{1,40}))?(?:\+[0-9A-Za-z.-]{1,40})?$/;
export const isSemver = (v) => SEMVER.test(String(v ?? '').trim());

export function parseSemver(v) {
  const m = SEMVER.exec(String(v ?? '').trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split('.') : [] };
}

/** -1, 0, 1 — semver precedence (a pre-release sorts before its release). */
export function compareSemver(a, b) {
  const x = typeof a === 'string' ? parseSemver(a) : a;
  const y = typeof b === 'string' ? parseSemver(b) : b;
  for (const k of ['major', 'minor', 'patch']) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  if (!x.pre.length && !y.pre.length) return 0;
  if (!x.pre.length) return 1;
  if (!y.pre.length) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i]; const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p); const qn = /^\d+$/.test(q);
    if (pn && qn) { if (+p !== +q) return +p < +q ? -1 : 1; continue; }
    if (pn !== qn) return pn ? -1 : 1;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

// ── text ───────────────────────────────────────────────────────────────────────────────

/** Plain text from a blog excerpt (which may carry light markdown), at most SUMMARY_MAX. */
export function plainSummary(s) {
  const t = String(s ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')          // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')       // links keep their text
    .replace(/<[^>]*>/g, '')                        // stray tags
    .replace(/[*_`#>~]+/g, '')                      // emphasis, headings, quotes
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > SUMMARY_MAX ? `${t.slice(0, SUMMARY_MAX - 1).trimEnd()}…` : t;
}

// ── resolution ─────────────────────────────────────────────────────────────────────────

/** The post an item shows, from rows already fetched. */
function postFor(item, { postsById, latestByProject }) {
  if (item.source === 'post') return postsById.get(item.postId) || null;
  if (item.source === 'latest') return latestByProject.get(item.projectKey || 'bmm') || null;
  return null;
}

/**
 * What an item SAYS, resolved, both languages. null when it has nothing to show (the chosen
 * post is gone or unpublished, the project has no post yet, a custom card lost its https link).
 */
export function resolveContent(item, ctx) {
  if (item.source === 'custom') {
    const url = httpsUrl(item.url);
    const title = String(item.title || '').trim();
    if (!url || !title) return null;
    return {
      kind: 'custom', title, titleFr: String(item.titleFr || '').trim() || null,
      summary: plainSummary(item.summary), summaryFr: plainSummary(item.summaryFr) || null,
      // createdAt, not updatedAt: recording the content hash touches updatedAt, and a date that
      // moved on every resolution would change the document (and its ETag) for nothing.
      url, imageUrl: imageLink(item.imageUrl), publishedAt: item.createdAt || null,
    };
  }
  const post = postFor(item, ctx);
  if (!post || post.status !== 'PUBLISHED') return null;
  const url = siteLink(`/blog/${encodeURIComponent(post.slug)}`);
  if (!url) return null;
  return {
    kind: 'blog', title: post.title, titleFr: post.titleFr || null,
    summary: plainSummary(post.excerpt), summaryFr: plainSummary(post.excerptFr) || null,
    url, imageUrl: imageLink(post.cover), publishedAt: post.publishedAt || post.createdAt || null,
    postId: post.id,
  };
}

export function contentHashOf(c) {
  if (!c) return '';
  return crypto.createHash('sha256').update(JSON.stringify([c.kind, c.postId || null, c.title, c.titleFr, c.summary, c.summaryFr, c.url, c.imageUrl])).digest('hex');
}

/** Is an item live at `now`? (enabled, inside its dates) */
export function isLive(item, now = new Date()) {
  if (!item.enabled) return false;
  if (item.startsAt && new Date(item.startsAt) > now) return false;
  if (item.endsAt && new Date(item.endsAt) <= now) return false;
  return true;
}

/** Does an item apply to this BMM version? An unparseable or absent version is not filtered:
 *  the bounds travel in the item and the client applies them. */
export function matchesVersion(item, version) {
  const v = parseSemver(version);
  if (!v) return true;
  if (item.minVersion && isSemver(item.minVersion) && compareSemver(v, parseSemver(item.minVersion)) < 0) return false;
  if (item.maxVersion && isSemver(item.maxVersion) && compareSemver(v, parseSemver(item.maxVersion)) > 0) return false;
  return true;
}

/** The public shape of one resolved item, in one language. */
export function publicItem(item, c, lang) {
  const fr = lang === 'fr';
  const mode = DISPLAY_MODES.includes(item.displayMode) ? item.displayMode : 'once';
  return {
    id: item.id, rev: item.rev, kind: c.kind,
    title: (fr && c.titleFr) || c.title,
    summary: (fr && c.summaryFr) || c.summary || '',
    url: c.url, imageUrl: c.imageUrl || null,
    publishedAt: c.publishedAt ? new Date(c.publishedAt).toISOString() : null,
    display: {
      mode,
      times: mode === 'times' ? Math.max(1, item.times || 1) : (mode === 'once' ? 1 : null),
      from: item.startsAt ? new Date(item.startsAt).toISOString() : null,
      until: item.endsAt ? new Date(item.endsAt).toISOString() : null,
      minVersion: item.minVersion || null, maxVersion: item.maxVersion || null,
    },
    priority: item.priority || 0,
  };
}

/** Order: priority first, then newest content. */
export function sortItems(list) {
  return list.sort((a, b) => (b.priority - a.priority) || (new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0)));
}
// fin notify (agent-notify)
