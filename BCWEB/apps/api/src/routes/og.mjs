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
import { renderCasinoGif } from '../lib/casino-gif.mjs';
import { loadAvatarImage, loadBadgeIcon } from '../lib/avatar-image.mjs';

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
      // A composed card (banner + this member's avatar) rather than the bare site logo, so a
      // shared profile unfurls as that person. Rendered by GET /og/profile/:id.png below.
      return { title: `${u.displayName} — BetterCommunity`, description: u.bio || `${u.displayName} on BetterCommunity.`, image: `${SITE()}/og/profile/${encodeURIComponent(m[1])}.png`, url, type: 'profile' };
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

// Paths a search engine must not index even though the SPA serves them: private, per-account
// or transactional screens. The SPA sets <meta name=robots content=noindex> for these on
// navigation; robots.txt disallows the same prefixes. One list, so they cannot disagree.
const NOINDEX_PREFIXES = ['/dashboard', '/admin', '/profile', '/auth', '/settings', '/notifications', '/repo/', '/myo/deal', '/2fa/fill', '/uploads'];

/** Structured data (schema.org JSON-LD) for a resolved page — what a rich result is built from. */
function jsonLdFor(meta, clean) {
  const site = SITE();
  const org = { '@type': 'Organization', name: 'BetterCommunity', url: site, logo: LOGO() };
  if (clean === '/' || clean === '') {
    return [
      { '@context': 'https://schema.org', ...org },
      { '@context': 'https://schema.org', '@type': 'WebSite', name: 'BetterCommunity', url: site,
        potentialAction: { '@type': 'SearchAction', target: `${site}/catalog?q={search_term_string}`, 'query-input': 'required name=search_term_string' } },
    ];
  }
  if (meta.type === 'article') {
    return [{ '@context': 'https://schema.org', '@type': 'Article', headline: meta.title.replace(/ — BetterCommunity.*$/, ''), description: meta.description, image: meta.image, url: meta.url,
      publisher: org, ...(meta.datePublished ? { datePublished: meta.datePublished } : {}), ...(meta.dateModified ? { dateModified: meta.dateModified } : {}) }];
  }
  if (meta.type === 'profile') {
    return [{ '@context': 'https://schema.org', '@type': 'ProfilePage', name: meta.title.replace(/ — BetterCommunity.*$/, ''), url: meta.url, description: meta.description }];
  }
  if (/^\/(p|item|project)\//.test(clean)) {
    return [{ '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: meta.title.replace(/ — BetterCommunity.*$/, ''), description: meta.description, url: meta.url, image: meta.image,
      applicationCategory: 'UtilitiesApplication', operatingSystem: 'Windows, Linux, macOS', offers: { '@type': 'Offer', price: '0', priceCurrency: 'CHF' }, publisher: org }];
  }
  if (clean === '/faq') return [{ '@context': 'https://schema.org', '@type': 'FAQPage', name: 'FAQ — BetterCommunity', url: meta.url }];
  return [{ '@context': 'https://schema.org', '@type': 'WebPage', name: meta.title, description: meta.description, url: meta.url, isPartOf: { '@type': 'WebSite', name: 'BetterCommunity', url: site } }];
}

/** noindex for a path: a private prefix, or a path an admin marked in the SEO settings. */
async function noindexFor(clean) {
  if (NOINDEX_PREFIXES.some((pre) => clean === pre || clean.startsWith(pre.endsWith('/') ? pre : `${pre}/`) || clean === pre.replace(/\/$/, ''))) return true;
  try {
    const p = await db();
    const row = await p.adminSetting.findUnique({ where: { key: 'seo.config' } });
    const list = (row?.value?.noindexPaths || []).map((v) => String(v).replace(/\/$/, '') || '/');
    return list.includes(clean.replace(/\/$/, '') || '/');
  } catch { return false; }
}

export default async function ogRoutes(app) {
  // The SPA's head, per route: the SAME title / description / image / type the unfurl shell
  // above serves to crawlers (derived from the page + the admin's per-page overrides), plus
  // whether the page is noindex and the JSON-LD a rich result is built from. Called by the
  // web app on every navigation, so what a search engine reads and what a pasted link shows
  // come from ONE resolver — editing a row in Admin → SEO changes both at once.
  app.get('/seo/meta', async (req, reply) => {
    const lang = String(req.query?.lang || '').toLowerCase() === 'fr' ? 'fr' : 'en';
    const raw = String(req.query?.path || '/');
    const clean = (raw.split('?')[0].split('#')[0] || '/').slice(0, 300);
    if (!clean.startsWith('/')) return reply.code(400).send({ error: 'bad_path' });
    const meta = await metaForRequest(clean, lang).catch(() => null)
      || { title: 'BetterCommunity', description: 'The home for all Better* projects.', image: LOGO(), url: SITE() + clean, type: 'website' };
    const noindex = await noindexFor(clean);
    reply.header('Cache-Control', 'public, max-age=300');
    return { ...meta, path: clean, lang, noindex, jsonLd: noindex ? [] : jsonLdFor(meta, clean.replace(/\/$/, '') || '/') };
  });

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

  // The composed profile card image (banner + this member's avatar + name), 1200x630 PNG. Only
  // for a PUBLIC profile — a private one never renders a name/face, it just bounces to the logo.
  // Rendered with @napi-rs/canvas, dynamically imported so a missing lib degrades ONLY this image
  // (falls back to the site logo) instead of breaking the whole OG route.
  // ── Casino result cards ──────────────────────────────────────────────────────
  // The bot embeds one of these as the image of a /casino reply, so a win or a loss is a
  // picture (big reels / coin / die / roulette pocket + a banner) rather than a line of
  // emoji. Pure canvas, no assets on disk: game + outcome + a short detail in the query.
  //   /og/casino/<coinflip|dice|slots|roulette>/<win|lose>.png?d=<detail>&a=<amount>
  app.get('/og/casino/:game/:outcome', async (req, reply) => {
    const game = String(req.params.game || '').replace(/[^a-z]/g, '');
    const outcome = String(req.params.outcome || '');
    const win = outcome.startsWith('win');
    const detail = String(req.query?.d || '').slice(0, 40);
    const amount = String(req.query?.a || '').replace(/[^0-9,. -]/g, '').slice(0, 16);
    if (!['coinflip', 'dice', 'slots', 'roulette', 'wheel', 'plinko'].includes(game)) return reply.code(404).send({ error: 'not_found' });
    // Animated: the spin that ends on this outcome, seeded per play (?s=) so it differs each
    // time; encoded once and cached five minutes. Falls through to the still card on failure.
    if (/.gif$/i.test(outcome)) {
      try {
        const seed = (parseInt(String(req.query?.s || ''), 10) || Date.now()) >>> 0;
        const buf = await renderCasinoGif({ game, win, detail, amount, seed });
        reply.header('content-type', 'image/gif'); reply.header('cache-control', 'public, max-age=300');
        return reply.send(buf);
      } catch (e) { req.log?.warn?.({ err: e?.message }, 'casino gif failed, serving still'); }
    }
    try {
      const { createCanvas } = await import('@napi-rs/canvas');
      const W = 900, H = 420;
      const c = createCanvas(W, H); const x = c.getContext('2d');
      // Felt background + vignette, tinted by outcome.
      const bg = x.createLinearGradient(0, 0, W, H); bg.addColorStop(0, win ? '#0b2a1c' : '#2a0b12'); bg.addColorStop(1, '#0a0f1e');
      x.fillStyle = bg; x.fillRect(0, 0, W, H);
      const vg = x.createRadialGradient(W / 2, H / 2, 80, W / 2, H / 2, 560); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
      x.fillStyle = vg; x.fillRect(0, 0, W, H);
      // Title strip
      const titles = { coinflip: 'COIN FLIP', dice: 'DICE', slots: 'SLOTS', roulette: 'ROULETTE' };
      x.font = 'bold 22px sans-serif'; x.fillStyle = 'rgba(255,255,255,0.55)'; x.textAlign = 'left'; x.fillText(titles[game], 36, 48);
      x.font = 'bold 20px sans-serif'; x.textAlign = 'right'; x.fillStyle = 'rgba(255,255,255,0.35)'; x.fillText('BetterCommunity', W - 36, 48);
      // The play itself, big and centred. Emoji render through the system font on the server;
      // if it lacks colour emoji the glyph still draws, just monochrome.
      const mid = (s0) => { x.font = '120px sans-serif'; x.textAlign = 'center'; x.fillStyle = '#fff'; x.fillText(s0, W / 2, H / 2 + 42); };
      if (game === 'slots') {
        // three reel boxes
        const reels = (detail || '🍒 🍋 🔔').split(/s+/).slice(0, 3);
        const bw = 170, gap = 26, x0 = W / 2 - (bw * 3 + gap * 2) / 2, y0 = 110;
        reels.forEach((r, i) => { const rx = x0 + i * (bw + gap);
          x.fillStyle = 'rgba(255,255,255,0.08)'; x.strokeStyle = 'rgba(255,255,255,0.25)'; x.lineWidth = 3;
          x.beginPath(); x.roundRect(rx, y0, bw, 190, 22); x.fill(); x.stroke();
          x.font = '100px sans-serif'; x.textAlign = 'center'; x.fillStyle = '#fff'; x.fillText(r, rx + bw / 2, y0 + 138); });
      } else if (game === 'roulette') {
        // a pocket disc in its colour with the number
        const m = /(d+)s*(red|black|green)?/i.exec(detail) || []; const num = m[1] || '?'; const col = (m[2] || '').toLowerCase();
        const fill = col === 'red' ? '#c0392b' : col === 'green' ? '#1e8449' : '#1b1f2a';
        x.beginPath(); x.arc(W / 2, H / 2 + 10, 110, 0, Math.PI * 2); x.fillStyle = fill; x.fill(); x.lineWidth = 8; x.strokeStyle = '#d4af37'; x.stroke();
        x.font = 'bold 96px sans-serif'; x.textAlign = 'center'; x.fillStyle = '#fff'; x.fillText(num, W / 2, H / 2 + 46);
      } else if (game === 'dice') { mid(detail || '🎲'); } else { mid(detail || '🪙'); }
      // Outcome banner
      const bh = 76; x.fillStyle = win ? 'rgba(46,204,113,0.92)' : 'rgba(231,76,60,0.92)'; x.fillRect(0, H - bh, W, bh);
      x.font = 'bold 34px sans-serif'; x.fillStyle = '#0a0f1e'; x.textAlign = 'center';
      x.fillText(win ? `YOU WIN  +${amount}` : `YOU LOSE  −${amount}`, W / 2, H - 26);
      reply.header('content-type', 'image/png'); reply.header('cache-control', 'public, max-age=300');
      return reply.send(await c.encode('png'));
    } catch (e) { req.log?.warn?.({ err: e?.message }, 'casino card failed'); return reply.code(500).send({ error: 'render_failed' }); }
  });

  // The leaderboard as one picture — the bot attaches it to /leaderboard. `guildId` narrows
  // it to a server's linked members; `me` (a user id) highlights that row.
  app.get('/og/leaderboard.png', async (req, reply) => {
    const p = await db();
    const guildId = String(req.query?.guildId || '');
    const meId = String(req.query?.me || '');
    let where = { level: { gt: 0 } };
    let scopeName = 'Global';
    if (guildId) {
      const ids = (await p.discordActivity.findMany({ where: { guildId }, select: { discordId: true }, take: 20000 })).map((r) => r.discordId);
      const userIds = (await p.discordLink.findMany({ where: { discordId: { in: ids } }, select: { userId: true } })).map((l) => l.userId);
      where = { level: { gt: 0 }, userId: { in: userIds } };
      scopeName = (await p.botGuild.findFirst({ where: { guildId }, select: { name: true } }))?.name || 'Server';
    }
    const rows = await p.userEconomy.findMany({ where, include: { user: { select: { id: true, displayName: true } } }, orderBy: [{ level: 'desc' }, { xp: 'desc' }], take: 10 });
    const eco = (await p.adminSetting.findUnique({ where: { key: 'bot.config' } }))?.value?.economy || {};
    try {
      const { createCanvas, loadImage } = await import('@napi-rs/canvas');
      // Redrawn clean: a header band, roomy rows, medal-ringed avatars for the podium, and a
      // coloured-initial fallback so a member without a picture never shows a dead grey disc.
      const W = 920, ROW = 66, TOP = 118, PAD = 26, H = TOP + Math.max(1, rows.length) * ROW + 24;
      const c = createCanvas(W, H); const x = c.getContext('2d');
      const bg = x.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#0e1118'); bg.addColorStop(0.55, '#12101c'); bg.addColorStop(1, '#1a1024'); x.fillStyle = bg; x.fillRect(0, 0, W, H);
      // Header band + accent hairline.
      const hb = x.createLinearGradient(0, 0, W, 0); hb.addColorStop(0, 'rgba(245,158,11,0.14)'); hb.addColorStop(1, 'rgba(245,158,11,0)'); x.fillStyle = hb; x.fillRect(0, 0, W, TOP - 24);
      x.fillStyle = '#f59e0b'; x.fillRect(0, 0, W, 5);
      x.fillStyle = '#fff'; x.font = 'bold 36px sans-serif'; x.textAlign = 'left'; x.textBaseline = 'alphabetic';
      x.fillText('Leaderboard', PAD, 58);
      x.font = '500 19px sans-serif'; x.fillStyle = 'rgba(255,255,255,0.55)'; x.fillText(`${scopeName} · by level`, PAD, 86);
      x.textAlign = 'right'; x.font = '600 17px sans-serif'; x.fillStyle = 'rgba(255,255,255,0.45)'; x.fillText('BetterCommunity', W - PAD, 56); x.textAlign = 'left';
      const cur = eco.currencyName || 'points';
      const medals = ['#f5c542', '#c9d0da', '#cd7f32'];
      // Deterministic pleasant colour for the initial-fallback avatar (same id → same hue).
      const hueOf = (s) => { let h = 0; for (let k = 0; k < s.length; k++) h = (h * 31 + s.charCodeAt(k)) % 360; return h; };
      const topXp = Math.max(1, rows[0]?.xp || 1);
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]; const y = TOP + i * ROW; const cy = y + (ROW - 10) / 2;
        const mine = meId && r.user.id === meId;
        // Row card.
        x.fillStyle = mine ? 'rgba(245,158,11,0.18)' : i % 2 ? 'rgba(255,255,255,0.045)' : 'rgba(255,255,255,0.02)';
        x.beginPath(); if (x.roundRect) x.roundRect(PAD - 6, y, W - (PAD - 6) * 2, ROW - 10, 14); else x.rect(PAD - 6, y, W - (PAD - 6) * 2, ROW - 10); x.fill();
        if (mine) { x.strokeStyle = 'rgba(245,158,11,0.55)'; x.lineWidth = 1.5; x.stroke(); }
        // Rank.
        x.fillStyle = i < 3 ? medals[i] : 'rgba(255,255,255,0.85)'; x.font = i < 3 ? 'bold 24px sans-serif' : '600 20px sans-serif';
        x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(i + 1), 52, cy);
        // Avatar with a ring (medal for podium, subtle otherwise).
        const ax = 108, ar = 22;
        x.save(); x.beginPath(); x.arc(ax, cy, ar + 2.5, 0, Math.PI * 2); x.fillStyle = i < 3 ? medals[i] : 'rgba(255,255,255,0.18)'; x.fill(); x.restore();
        let drew = false;
        try { const av = await loadImage(`${SITE()}/avatar/${encodeURIComponent(r.user.id)}`); x.save(); x.beginPath(); x.arc(ax, cy, ar, 0, Math.PI * 2); x.clip(); x.drawImage(av, ax - ar, cy - ar, ar * 2, ar * 2); x.restore(); drew = true; } catch { /* fallback below */ }
        if (!drew) {
          const hue = hueOf(String(r.user.id || r.user.displayName || 'x'));
          x.save(); x.beginPath(); x.arc(ax, cy, ar, 0, Math.PI * 2); x.fillStyle = `hsl(${hue} 55% 42%)`; x.fill();
          x.fillStyle = '#fff'; x.font = 'bold 20px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
          x.fillText(String(r.user.displayName || 'M').trim().charAt(0).toUpperCase() || 'M', ax, cy + 1); x.restore();
        }
        // Name + level chip + points.
        x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillStyle = '#fff'; x.font = `${mine ? 'bold' : '600'} 22px sans-serif`;
        x.fillText(String(r.user.displayName || 'Member').slice(0, 24), 150, cy - 8);
        // Lv chip.
        const chip = `Lv ${r.level}`; x.font = 'bold 13px sans-serif'; const cw = x.measureText(chip).width + 18;
        x.fillStyle = 'rgba(245,158,11,0.18)'; x.beginPath(); if (x.roundRect) x.roundRect(150, cy + 4, cw, 20, 10); else x.rect(150, cy + 4, cw, 20); x.fill();
        x.fillStyle = '#f9b834'; x.textAlign = 'center'; x.fillText(chip, 150 + cw / 2, cy + 15);
        // XP bar to the right of the chip.
        const barX = 150 + cw + 12, barW = 300;
        x.fillStyle = 'rgba(255,255,255,0.08)'; x.beginPath(); if (x.roundRect) x.roundRect(barX, cy + 10, barW, 6, 3); else x.rect(barX, cy + 10, barW, 6); x.fill();
        x.fillStyle = 'rgba(245,158,11,0.8)'; const bw = Math.max(6, Math.round(barW * (r.xp / topXp))); x.beginPath(); if (x.roundRect) x.roundRect(barX, cy + 10, bw, 6, 3); else x.rect(barX, cy + 10, bw, 6); x.fill();
        // Points.
        x.textAlign = 'right'; x.fillStyle = '#fff'; x.font = 'bold 20px sans-serif'; x.fillText(r.points.toLocaleString('en-US'), W - PAD, cy - 6);
        x.fillStyle = 'rgba(255,255,255,0.45)'; x.font = '500 12px sans-serif'; x.fillText(cur, W - PAD, cy + 12);
      }
      if (!rows.length) { x.fillStyle = 'rgba(255,255,255,0.6)'; x.font = '500 20px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('Nobody has a level yet.', W / 2, TOP + ROW / 2); }
      const png = await c.encode('png');
      return reply.header('Content-Type', 'image/png').header('Cache-Control', 'public, max-age=60').header('X-Robots-Tag', 'noindex').send(png);
    } catch { return reply.redirect(LOGO()); }
  });

  app.get('/og/profile/:id', async (req, reply) => {
    const id = String(req.params.id || '').replace(/\.(png|webp|jpe?g)$/i, '');
    if (!id) return reply.redirect(LOGO());
    const p = await db();
    const u = await p.user.findUnique({ where: { id }, select: {
      displayName: true, avatar: true, profilePublic: true, role: true,
      economy: { select: { level: true } },
      badges: { include: { badge: true }, orderBy: { badge: { priority: 'desc' } }, take: 4 },
    } }).catch(() => null);
    if (!u || !u.profilePublic) return reply.redirect(LOGO());
    try {
      const [{ createCanvas, loadImage }, { OG_BANNER_DATA_URI }] = await Promise.all([
        import('@napi-rs/canvas'), import('../lib/og-banner-data.mjs'),
      ]);
      const W = 1200, H = 630;
      const c = createCanvas(W, H); const x = c.getContext('2d');
      try { const bg = await loadImage(OG_BANNER_DATA_URI); const s = Math.max(W / bg.width, H / bg.height); const bw = bg.width * s, bh = bg.height * s; x.drawImage(bg, (W - bw) / 2, (H - bh) / 2, bw, bh); } catch { x.fillStyle = '#0a0f1e'; x.fillRect(0, 0, W, H); }
      const g = x.createLinearGradient(0, 0, W, 0); g.addColorStop(0, 'rgba(8,11,18,0.80)'); g.addColorStop(0.55, 'rgba(8,11,18,0.32)'); g.addColorStop(1, 'rgba(8,11,18,0.06)'); x.fillStyle = g; x.fillRect(0, 0, W, H);
      const cx = 210, cy = H / 2, r = 120;
      // EXACTLY the picture the site shows for this account — uploaded photo, logo default, or
      // the Boring Avatar with the user's own variant / seed / palette (lib/avatar-image.mjs).
      // The card used to test the avatar JSON against a URL regex, always miss, and draw its
      // own smiley: "a boring avatar", never the member's.
      const av = await loadAvatarImage({ id, displayName: u.displayName, avatar: u.avatar }, 2 * r);
      x.save(); x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.clip();
      if (av) { const s = Math.max((2 * r) / av.width, (2 * r) / av.height); const w = av.width * s, h = av.height * s; x.drawImage(av, cx - w / 2, cy - h / 2, w, h); }
      else { x.fillStyle = '#f59e0b'; x.fillRect(cx - r, cy - r, 2 * r, 2 * r); }
      x.restore();
      x.strokeStyle = 'rgba(255,255,255,0.92)'; x.lineWidth = 7; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.stroke();
      // Text is best-effort: a font-less container must not blank the whole card.
      try {
        x.fillStyle = '#fff'; x.font = 'bold 66px sans-serif'; x.fillText(String(u.displayName || 'Member').slice(0, 22), 380, cy - 40);
        x.fillStyle = 'rgba(255,255,255,0.82)'; x.font = '500 32px sans-serif'; x.fillText('BetterCommunity', 380, cy + 6);
        // A row of chips under the name: level, role, then the badges — each with its REAL icon
        // (the lucide glyph or uploaded image the site shows) in the badge's colour.
        const chip = (tx, label, bg, fg, icon = null, iconBg = null) => {
          x.font = 'bold 26px sans-serif'; const tw = x.measureText(label).width; const pad = 18, h = 44, ic = icon ? 30 : 0, w = tw + pad * 2 + (icon ? ic + 10 : 0);
          x.fillStyle = bg; x.beginPath();
          const rr = 12, yy = cy + 34;
          x.moveTo(tx + rr, yy); x.arcTo(tx + w, yy, tx + w, yy + h, rr); x.arcTo(tx + w, yy + h, tx, yy + h, rr); x.arcTo(tx, yy + h, tx, yy, rr); x.arcTo(tx, yy, tx + w, yy, rr); x.closePath(); x.fill();
          if (icon) {
            if (iconBg) { x.fillStyle = iconBg; x.beginPath(); x.arc(tx + pad + ic / 2, yy + h / 2, ic / 2 + 4, 0, Math.PI * 2); x.fill(); }
            x.drawImage(icon, tx + pad, yy + (h - ic) / 2, ic, ic);
          }
          x.fillStyle = fg; x.fillText(label, tx + pad + (icon ? ic + 10 : 0), yy + h - 14);
          return tx + w + 12;
        };
        let tx = 380;
        const lvl = u.economy?.level || 0;
        if (lvl > 0) tx = chip(tx, `Lv ${lvl}`, '#f59e0b', '#1a1206');
        if (u.role && u.role !== 'USER') tx = chip(tx, String(u.role), 'rgba(88,101,242,0.9)', '#fff');
        for (const b of (u.badges || [])) {
          if (tx > W - 200) break;
          const icon = await loadBadgeIcon(b.badge, '#ffffff', 60).catch(() => null);
          tx = chip(tx, String(b.badge?.name || '').slice(0, 14), 'rgba(255,255,255,0.16)', '#fff', icon, b.badge?.color || 'rgba(255,255,255,0.25)');
        }
      } catch { /* no font */ }
      const png = await c.encode('png');
      return reply.header('Content-Type', 'image/png').header('Cache-Control', 'public, max-age=3600').header('X-Robots-Tag', 'noindex').send(png);
    } catch { return reply.redirect(LOGO()); }
  });
}
