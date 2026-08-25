// Dynamic Open Graph / Twitter-card prerender for link-unfurl crawlers (Discord,
// Twitter/X, Slack, Telegram, WhatsApp, Facebook, …). Real users are never routed
// here — the Caddy @unfurl matcher sends ONLY known crawler User-Agents to /og,
// passing the originally-requested path as ?u=. We look that path up and return a
// tiny HTML document whose <head> carries per-page og:title / og:description /
// og:image, so a shared BCWEB link unfurls with the right title + thumbnail
// (a blog post shows its own title and cover image, a project its icon, etc.).
//
// Everything else on the page is a courtesy redirect to the real SPA URL, so if a
// human ever lands here they bounce straight to the app.
import { db } from '../lib/lib.mjs';

const SITE = () => (process.env.SITE_URL || 'https://bettercommunity.ch').replace(/\/+$/, '');
const LOGO = () => `${SITE()}/logo.png`;

// HTML-escape for text placed inside a double-quoted attribute or a text node.
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Only trust an absolute http(s) URL as an image; anything else falls back to the
// site logo (an og:image must be an absolute URL for crawlers to fetch it).
const absImg = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u)) ? u : LOGO();

// Static blurbs for the fixed suite projects (no per-row description to read).
const CORE_PROJECTS = {
  bmm: { name: 'Better Mods Manager', desc: 'Apps, plugins and themes for Better Mods Manager — the community catalog.' },
  bsm: { name: 'Better Sound Manager', desc: 'Community sound presets for BSM — one JSON each, install straight into the app.' },
  installer: { name: 'BetterInstaller', desc: 'A fast, modern installer for the Better* suite — signed, delta-updating, no bloat.' },
};

// Build the metadata for a given app path. Returns { title, description, image,
// url, type }. Falls back to the site defaults for any unrecognised path.
// Exported for unit-testing the routing/escaping without a running server.
/**
 * What an admin typed for this exact path, if anything.
 *
 * Stored as AdminSetting['seo.pages']: a list of { path, title, titleFr, description,
 * descriptionFr, image }. Matched on the EXACT path — no prefixes and no wildcards, because
 * a rule that silently covers a hundred pages is one nobody can predict from the list they
 * are looking at.
 *
 * Applied as an OVERRIDE on top of whatever was derived, field by field. Empty fields keep
 * the derived value, so an admin can retitle a page without also having to restate its
 * description and image — and a blog post's own cover keeps working under a custom title.
 */
async function pageOverride(clean, lang) {
  try {
    const p = await db();
    const row = await p.adminSetting.findUnique({ where: { key: 'seo.pages' } });
    const list = Array.isArray(row?.value) ? row.value : [];
    const want = clean.replace(/\/$/, '') || '/';
    const hit = list.find((x) => String(x?.path || '').replace(/\/$/, '').toLowerCase() === want.toLowerCase()
      || String(x?.path || '').toLowerCase() === want.toLowerCase());
    if (!hit) return null;
    const pick = (en, fr) => (lang === 'fr' && fr ? fr : en) || '';
    return {
      title: pick(hit.title, hit.titleFr),
      description: pick(hit.description, hit.descriptionFr),
      image: typeof hit.image === 'string' ? hit.image : '',
    };
  } catch { return null; }   // a bad row must never take the unfurl down
}

export async function metaForPath(path, lang = 'en') {
  const site = SITE();
  const clean = String(path || '/').split('?')[0].split('#')[0];
  const url = site + clean;
  const fallback = {
    title: 'BetterCommunity — The home for all Better* projects',
    description: 'The hub for the Better* projects: moderated catalogs of apps, plugins, themes and presets, shared Server-Repos, hosting, and the docs for building your own.',
    image: LOGO(), url, type: 'website',
  };

  let m;
  // /blog/<slug> — a published blog post: its own title, excerpt and cover.
  if ((m = clean.match(/^\/blog\/([^/]+)\/?$/))) {
    const p = await db();
    const post = await p.blogPost.findUnique({
      where: { slug: decodeURIComponent(m[1]) },
      select: { title: true, excerpt: true, cover: true, status: true, project: { select: { name: true, icon: true } }, showcaseProject: { select: { name: true, icon: true } } },
    }).catch(() => null);
    if (post && post.status === 'PUBLISHED') {
      const space = post.project || post.showcaseProject;
      return {
        title: `${post.title} — BetterCommunity Blog`,
        description: post.excerpt || `A new post on the ${space?.name || 'BetterCommunity'} blog.`,
        image: absImg(post.cover || space?.icon),
        url, type: 'article',
      };
    }
  }
  // /project/<slug> — an admin-curated "Other projects" showcase page.
  else if ((m = clean.match(/^\/project\/([^/]+)\/?$/))) {
    const p = await db();
    const sp = await p.showcaseProject.findUnique({
      where: { slug: decodeURIComponent(m[1]) },
      select: { name: true, short: true, icon: true, published: true },
    }).catch(() => null);
    if (sp && sp.published) {
      return { title: `${sp.name} — BetterCommunity`, description: sp.short || sp.name, image: absImg(sp.icon), url, type: 'website' };
    }
  }
  // /item/<slug> — a published catalog entry (app / plugin / theme / preset).
  else if ((m = clean.match(/^\/item\/([^/]+)\/?$/))) {
    const p = await db();
    const it = await p.catalogItem.findUnique({
      where: { slug: decodeURIComponent(m[1]) },
      select: { name: true, description: true, kind: true, status: true, meta: true },
    }).catch(() => null);
    if (it && it.status === 'PUBLISHED') {
      const img = it.meta?.cover || it.meta?.image || it.meta?.icon || it.meta?.download?.image;
      return { title: `${it.name} — BetterCommunity`, description: it.description || `A community ${String(it.kind || '').toLowerCase()} on BetterCommunity.`, image: absImg(img), url, type: 'website' };
    }
  }
  // /p/<key> — a fixed suite project page (bmm / bsm / installer).
  else if ((m = clean.match(/^\/p\/([a-z]+)\/?$/i))) {
    const proj = CORE_PROJECTS[m[1].toLowerCase()];
    if (proj) return { title: `${proj.name} — BetterCommunity`, description: proj.desc, image: `${site}/icons/${m[1].toLowerCase()}.png`, url, type: 'website' };
  }
  // /c/<slug> — a PUBLIC community catalog (listed + ACTIVE only; private/hidden ones
  // fall through to the generic site card so a shared /c link never leaks their name).
  else if ((m = clean.match(/^\/c\/([^/]+)\/?$/))) {
    const p = await db();
    const c = await p.communityCatalog.findUnique({
      where: { slug: decodeURIComponent(m[1]) },
      select: { name: true, description: true, status: true, listed: true },
    }).catch(() => null);
    if (c && c.listed && c.status === 'ACTIVE') {
      return { title: `${c.name} — BetterCommunity`, description: c.description || 'A community catalog on BetterCommunity.', image: LOGO(), url, type: 'website' };
    }
  }
  // /r/<id> — a PUBLICLY LISTED Server-Repo only. Unlisted repos (reachable solely via
  // their owner's ?k= share link) are NOT unfurled — a crawler has no share key.
  else if ((m = clean.match(/^\/r\/([^/]+)\/?$/))) {
    const p = await db();
    const r = await p.serverRepo.findUnique({
      where: { id: decodeURIComponent(m[1]) },
      select: { name: true, description: true, listed: true },
    }).catch(() => null);
    if (r && r.listed) {
      return { title: `${r.name} — Server Repo — BetterCommunity`, description: r.description || 'A community Server-Repo hosted on BetterCommunity.', image: LOGO(), url, type: 'website' };
    }
  }
  // /u/<id> — a PUBLIC profile only. profilePublic=false must never leak a display name
  // or bio to an unauthenticated crawler, so it falls through to the generic site card.
  else if ((m = clean.match(/^\/u\/([^/]+)\/?$/))) {
    const p = await db();
    const u = await p.user.findUnique({
      where: { id: decodeURIComponent(m[1]) },
      select: { displayName: true, bio: true, profilePublic: true },
    }).catch(() => null);
    if (u && u.profilePublic) {
      return { title: `${u.displayName} — BetterCommunity`, description: u.bio || `${u.displayName} on BetterCommunity.`, image: LOGO(), url, type: 'profile' };
    }
  }
  // Known static pages get a tailored title but the shared site image.
  else {
    // Nine of these existed and half the site was missing — a page with no entry unfurls as
    // the generic site card, so sharing it says nothing about what was shared. The wording is
    // rewritten too: several of these described the site as it was a good while ago.
    //
    // Each answers "what will I find here", never "what is this section called". A preview
    // that repeats the title in the description wastes the only two lines it gets.
    const STATIC = {
      '/': fallback,
      '/catalog': { title: 'Catalog — BetterCommunity', description: 'Apps, plugins, themes, modpacks and BSM presets published by the community, moderated before they go live. Install straight into the app.' },
      '/blog': { title: 'Blog — BetterCommunity', description: 'Release notes, build logs and news from across the Better* projects.' },
      '/repos': { title: 'Server Repos — BetterCommunity', description: 'Shared mod repositories for BMM — one address, and everyone in your group ends up on the same setup.' },
      '/hosting': { title: 'Hosting — BetterCommunity', description: 'We host your Server-Repo or your catalog files, billed by the size you actually use. There is a free tier to start with.' },
      '/projects': { title: 'Other projects — BetterCommunity', description: 'Projects built by the community and by us, beyond the Better* suite itself.' },
      '/faq': { title: 'FAQ — BetterCommunity', description: 'Short answers about catalogs, hosting, accounts, payments and moderation.' },
      '/contact': { title: 'Contact — BetterCommunity', description: 'Questions, bug reports, data requests and partnerships — straight to the team.' },
      '/docs': { title: 'Docs — BetterCommunity', description: 'How everything works: catalog formats, the BMM API, BMMScript, hosting, and publishing your own.' },
      '/dev': { title: 'Developers — BetterCommunity', description: 'The public API, webhooks and API keys, plus tools to check a catalog feed, a .bmmscript or a signature before you publish it.' },
      '/users': { title: 'Members — BetterCommunity', description: 'The people publishing here — their catalogs, repos and profiles.' },
      '/myo': { title: 'Make Your Own — BetterCommunity', description: 'Have something built for you: a consultation first, a quote after, and nothing charged before you agree to it.' },
      '/status': { title: 'Status — BetterCommunity', description: 'Live service status, and the history of past incidents with what happened and what changed afterwards.' },
      '/2fa': { title: 'Authenticator — BetterCommunity', description: 'A two-factor authenticator that runs entirely in your browser and sends nothing anywhere. Works for any site, not only this one.' },
      '/legal': { title: 'Legal — BetterCommunity', description: 'Terms, privacy, cookies, refunds and who we are — all in one place.' },
      '/legal/privacy': { title: 'Privacy — BetterCommunity', description: 'What we store, why, how long for, and how to have it exported or erased.' },
      '/legal/terms': { title: 'Terms — BetterCommunity', description: 'The rules for using BetterCommunity and for publishing here.' },
      '/legal/cookies': { title: 'Cookies — BetterCommunity', description: 'Which cookies we set, which we do not, and what happens when you decline.' },
      '/legal/refunds': { title: 'Payments & refunds — BetterCommunity', description: 'How billing works for hosting and commissions, and when a refund applies.' },
      '/legal/about': { title: 'About — BetterCommunity', description: 'Who runs BetterCommunity, and what it is for.' },
    };
    const s = STATIC[clean.replace(/\/$/, '') || '/'];
    if (s) return { ...fallback, ...s, url };
  }
  return fallback;
}

/**
 * The derived metadata, with any admin override laid on top.
 *
 * Separate from metaForPath so the derivation stays testable on its own — and so the
 * override is applied in exactly ONE place rather than at each of the eight returns above,
 * which is how one of them ends up not honouring it.
 */
export async function metaForRequest(path, lang = 'en') {
  const base = await metaForPath(path, lang);
  const clean = String(path || '/').split('?')[0].split('#')[0];
  const over = await pageOverride(clean, lang);
  if (!over) return base;
  return {
    ...base,
    ...(over.title ? { title: over.title } : {}),
    ...(over.description ? { description: over.description } : {}),
    ...(over.image ? { image: absImg(over.image) } : {}),
  };
}

export function renderOgHtml(meta, lang = 'en') {
  // A LOGO in a large card is a small mark floating in a wide grey box. A real cover — a
  // blog post's, a project's icon — is what the large shape is for, so the card follows the
  // picture instead of being fixed.
  const twCard = meta.image && meta.image !== LOGO() ? 'summary_large_image' : 'summary';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(meta.title)}</title>
<meta name="description" content="${esc(meta.description)}" />
<link rel="canonical" href="${esc(meta.url)}" />
<meta property="og:type" content="${esc(meta.type)}" />
<meta property="og:site_name" content="BetterCommunity" />
<meta property="og:title" content="${esc(meta.title)}" />
<meta property="og:description" content="${esc(meta.description)}" />
<meta property="og:image" content="${esc(meta.image)}" />
<meta property="og:url" content="${esc(meta.url)}" />
<meta name="twitter:card" content="${twCard}" />
<meta name="twitter:title" content="${esc(meta.title)}" />
<meta name="twitter:description" content="${esc(meta.description)}" />
<meta name="twitter:image" content="${esc(meta.image)}" />
<meta name="twitter:image:alt" content="${esc(meta.title)}" />
${twCard === 'summary_large_image' ? `<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />` : ''}
<meta property="og:image:alt" content="${esc(meta.title)}" />
<meta property="og:locale" content="${lang === 'fr' ? 'fr_FR' : 'en_GB'}" />
<meta name="theme-color" content="#f97316" />
<meta http-equiv="refresh" content="0; url=${esc(meta.url)}" />
</head>
<body>
<p>Redirecting to <a href="${esc(meta.url)}">${esc(meta.url)}</a>…</p>
<script>location.replace(${JSON.stringify(meta.url)});</script>
</body>
</html>`;
}

export default async function ogRoutes(app) {
  // Reached only via the Caddy @unfurl handler (bot User-Agents). `u` is the
  // originally-requested app path (e.g. /blog/my-post). Never authenticated.
  app.get('/og', async (req, reply) => {
    // The language the shared link was for. A French page unfurled in English is the same
    // mismatch as a French page describing itself in English.
    const lang = String(req.query?.lang || '').toLowerCase() === 'fr' ? 'fr' : 'en';
    const meta = await metaForRequest(req.query?.u || '/', lang).catch(() => null)
      || { title: 'BetterCommunity', description: 'The home for all Better* projects.', image: LOGO(), url: SITE(), type: 'website' };
    return reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('Cache-Control', 'public, max-age=300')
      .header('X-Robots-Tag', 'noindex') // this shell is for unfurlers, not search indexing
      .send(renderOgHtml(meta, lang));
  });
}
