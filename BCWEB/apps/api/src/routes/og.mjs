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
import { db } from '../lib.mjs';

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
export async function metaForPath(path) {
  const site = SITE();
  const clean = String(path || '/').split('?')[0].split('#')[0];
  const url = site + clean;
  const fallback = {
    title: 'BetterCommunity — The home for all Better* projects',
    description: 'Moderated catalogs, community presets, accounts and hosted Server-Repos for the Better* ecosystem.',
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
  // Known static pages get a tailored title but the shared site image.
  else {
    const STATIC = {
      '/': fallback,
      '/catalog': { title: 'Catalog — BetterCommunity', description: 'Browse community apps, plugins, themes and BSM presets — all moderated before they go live.' },
      '/blog': { title: 'Blog — BetterCommunity', description: 'News and updates from across the Better* projects.' },
      '/repos': { title: 'Server Repos — BetterCommunity', description: 'Verified community Server-Repos for BMM — featured first.' },
      '/hosting': { title: 'Hosting — BetterCommunity', description: 'Let us host your Server-Repo, billed by the size you actually use.' },
      '/projects': { title: 'Other projects — BetterCommunity', description: 'More from the Better* ecosystem.' },
    };
    const s = STATIC[clean.replace(/\/$/, '') || '/'];
    if (s) return { ...fallback, ...s, url };
  }
  return fallback;
}

export function renderOgHtml(meta) {
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
    const meta = await metaForPath(req.query?.u || '/').catch(() => null)
      || { title: 'BetterCommunity', description: 'The home for all Better* projects.', image: LOGO(), url: SITE(), type: 'website' };
    return reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('Cache-Control', 'public, max-age=300')
      .header('X-Robots-Tag', 'noindex') // this shell is for unfurlers, not search indexing
      .send(renderOgHtml(meta));
  });
}
