// Links: extraction and the checks a phishing link fails.
//
// Every check returns a REASON with a weight, never a verdict. A shortener is not phishing, a
// raw IP is not phishing, a login path is not phishing; the three together, on a domain that
// spells "discord" with a Cyrillic "о", are. The policy turns the sum into a decision.
//
// What is deliberately NOT done: fetching the link. A moderation check that makes an outbound
// request per message is an SSRF primitive and a latency floor, and it tells a phisher which
// of their domains we looked at. Everything here is a function of the text.
import { domainToUnicode } from 'node:url';
import { fold, skeleton, editDistance } from './text.mjs';
import { findBlock, hostUnder } from '../urlblock.mjs';

/** Brands people are phished in the name of, with the domains that really belong to them.
 *  The admin adds more in the rules editor (`protectedBrands`).
 *
 *  THE one list. The Discord bot checks look-alikes on its own too (apps/bot features/
 *  automod.mjs), and its image cannot import this file (its build context is apps/bot), so it
 *  reads a GENERATED copy: apps/bot/src/features/brands.generated.mjs. After editing this
 *  list, run `node apps/bot/scripts/sync-brands.mjs` from BCWEB; the API test
 *  moderation-brands-drift.test.mjs fails while the two differ. */
export const DEFAULT_BRANDS = [
  { brand: 'bettercommunity', domains: ['bettercommunity.ch'] },
  { brand: 'bettermodsmanager', domains: ['bettercommunity.ch'] },
  { brand: 'discord', domains: ['discord.com', 'discord.gg', 'discordapp.com', 'discordapp.net', 'discord.media', 'discord.gift', 'discord.new', 'discordstatus.com', 'discord.dev', 'dis.gd'] },
  { brand: 'steam', domains: ['steampowered.com', 'steamcommunity.com', 'steamstatic.com', 'steamgames.com', 'steam.tv', 'steamdeck.com', 'steam-chat.com', 'steamusercontent.com'] },
  { brand: 'steamcommunity', domains: ['steamcommunity.com'] },
  { brand: 'github', domains: ['github.com', 'github.io', 'githubusercontent.com', 'github.dev', 'githubassets.com', 'githubstatus.com'] },
  { brand: 'paypal', domains: ['paypal.com', 'paypal.me', 'paypalobjects.com'] },
  { brand: 'stripe', domains: ['stripe.com', 'stripe.network', 'stripe.dev'] },
  { brand: 'nexusmods', domains: ['nexusmods.com'] },
  { brand: 'curseforge', domains: ['curseforge.com'] },
  { brand: 'epicgames', domains: ['epicgames.com', 'unrealengine.com'] },
  { brand: 'roblox', domains: ['roblox.com', 'rbxcdn.com'] },
  { brand: 'kofi', domains: ['ko-fi.com'] },
  { brand: 'patreon', domains: ['patreon.com'] },
  { brand: 'google', domains: ['google.com', 'google.ch', 'google.fr', 'goo.gl', 'youtube.com', 'youtu.be', 'gstatic.com', 'googleusercontent.com'] },
  { brand: 'microsoft', domains: ['microsoft.com', 'live.com', 'outlook.com', 'office.com', 'xbox.com'] },
  { brand: 'apple', domains: ['apple.com', 'icloud.com'] },
];

/** URL shorteners: they hide the destination, which is the whole point of a phishing link. */
export const SHORTENERS = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'ow.ly', 'buff.ly', 'cutt.ly', 'rb.gy', 'shorturl.at', 'tiny.cc', 'rebrand.ly', 'bl.ink', 'v.gd', 'lnkd.in', 's.id', 'shorte.st', 'adf.ly', 'bit.do', 'clck.ru', 'qr.ae', 'tr.im', 'x.co', 'u.to', 'grabify.link', 'iplogger.org', 'iplogger.com', '2no.co', 'yip.su'];

/** TLDs over-represented in abuse feeds. A small signal on its own. */
const RISKY_TLDS = new Set(['zip', 'mov', 'top', 'click', 'xyz', 'tk', 'ml', 'ga', 'cf', 'gq', 'buzz', 'rest', 'cam', 'monster', 'sbs', 'cfd', 'icu', 'ru.com', 'gift', 'link']);

/** Bare domains are only recognised with a TLD from this list, so "file.txt" or "v1.2" in a
 *  crash report is not read as a link. A URL with a scheme is recognised whatever its TLD. */
const BARE_TLDS = 'com|net|org|io|gg|xyz|ru|cn|co|me|app|dev|info|biz|tk|ml|ga|cf|gq|top|click|link|site|online|shop|store|live|pro|us|uk|de|fr|ch|be|ca|eu|nl|it|es|pl|br|in|jp|tv|cc|ly|to|zip|mov|gift|su|ws|icu|cam|sbs|cfd|buzz|rest|monster';

const SCHEME_URL = /\b(?:https?|ftp|javascript|data|vbscript|file):[^\s<>"'`)\]]+/giu;
const BARE_URL = new RegExp(`(?<![@\\w.-])(?:www\\.)?(?:[\\p{L}\\p{N}](?:[\\p{L}\\p{N}-]{0,61}[\\p{L}\\p{N}])?\\.)+(?:${BARE_TLDS})(?![\\p{L}\\p{N}-])(?:/[^\\s<>"'\`)\\]]*)?`, 'giu');

/** Every URL-looking string in `text`, deduplicated, at most `max`. */
export function extractUrls(text, max = 40) {
  const src = String(text || '').slice(0, 20000);
  const out = new Set();
  for (const m of src.matchAll(SCHEME_URL)) { out.add(m[0].replace(/[.,;:!?]+$/, '')); if (out.size >= max) return [...out]; }
  // Bare domains, but not the ones already inside a scheme URL above.
  const withoutSchemes = src.replace(SCHEME_URL, ' ');
  for (const m of withoutSchemes.matchAll(BARE_URL)) { out.add(m[0].replace(/[.,;:!?]+$/, '')); if (out.size >= max) break; }
  return [...out];
}

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** The registrable part of a host, approximated: the last two labels, or three when the
 *  second-to-last is a short second-level like co.uk / com.br. No public-suffix list: the
 *  lookalike check needs "the label a phisher chose", and this finds it. */
export function registrable(host) {
  const labels = host.split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const sl = labels[labels.length - 2];
  const take = (sl.length <= 3 && ['co', 'com', 'net', 'org', 'gov', 'ac', 'edu'].includes(sl)) ? 3 : 2;
  return labels.slice(-take).join('.');
}

function brandList(extra) {
  // Compared as skeletons on both sides (a skeleton collapses doubled letters, so the
  // brand "bettercommunity" must become "betercomunity" too, or it never matches itself).
  const list = DEFAULT_BRANDS.map((b) => ({ brand: skeleton(b.brand), domains: b.domains }));
  for (const b of extra || []) {
    const brand = skeleton(b.brand || '');
    if (brand.length >= 4) list.push({ brand, domains: (b.domains || []).map((d) => String(d).toLowerCase()) });
  }
  // The site's own domain belongs to the site's brand, whatever SITE_URL says it is.
  try {
    const own = new URL(process.env.SITE_URL || 'https://bettercommunity.ch').hostname.replace(/^www\./, '');
    list[0] = { ...list[0], domains: [...new Set([...list[0].domains, own])] };
  } catch { /* keep the default */ }
  return list;
}

const officialFor = (host, b) => b.domains.some((d) => hostUnder(host, d));

/**
 * Check one URL. Returns an array of { rule, weight, detail } (weights are the DEFAULTS; the
 * engine applies the admin's overrides).
 *
 * @param raw   the URL as written
 * @param ctx   { allowDomains, blockDomains, brands, blockedRules } from the engine config
 */
export function checkUrl(raw, ctx = {}) {
  const out = [];
  const s = String(raw || '').trim();
  const scheme = (s.match(/^([a-z][a-z0-9+.-]*):/i)?.[1] || '').toLowerCase();
  if (['javascript', 'data', 'vbscript', 'file'].includes(scheme)) {
    out.push({ rule: 'link.scheme_script', weight: 100, detail: `${scheme}: link` });
    return out;
  }
  let u;
  try { u = new URL(scheme ? s : `https://${s}`); } catch { return out; }
  if (!/^(https?|ftp):$/.test(u.protocol)) return out;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/^www\./, '').replace(/\.$/, '');
  if (!host) return out;
  // An address somebody vouched for is not checked further (the script-scheme check above
  // still ran: an allowlisted domain does not make `javascript:` safe).
  if ((ctx.allowDomains || []).some((d) => hostUnder(host, d))) return out;

  if ((ctx.blockDomains || []).some((d) => hostUnder(host, d))) out.push({ rule: 'link.blocklisted', weight: 100, detail: host });
  else if (ctx.blockedRules?.length) {
    const hit = findBlock(ctx.blockedRules, [u.href]);
    if (hit) out.push({ rule: 'link.blocklisted', weight: 100, detail: `${host} (${hit.rule.scope} rule)` });
  }

  if (IPV4.test(host) || host.includes(':')) out.push({ rule: 'link.ip_host', weight: 35, detail: host });
  if (SHORTENERS.some((d) => hostUnder(host, d))) out.push({ rule: 'link.shortener', weight: 20, detail: host });

  const brands = ctx.brands || brandList();
  const isOfficial = brands.some((b) => officialFor(host, b));
  const labels = host.split('.');
  const reg = registrable(host);
  const regLabel = reg.split('.')[0] || '';
  const tld = labels.slice(-1)[0];
  if (RISKY_TLDS.has(tld)) out.push({ rule: 'link.risky_tld', weight: 8, detail: `.${tld}` });

  // Internationalised labels: decode, and look for Latin mixed with a lookalike script.
  const unicodeHost = host.includes('xn--') ? domainToUnicode(host) : host;
  if (host.includes('xn--')) {
    out.push({ rule: 'link.punycode', weight: 20, detail: `${host} → ${unicodeHost}` });
    for (const lab of unicodeHost.split('.')) {
      const latin = /[a-z]/i.test(lab);
      const other = /[\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Armenian}]/u.test(lab);
      if (latin && other) { out.push({ rule: 'link.mixed_script', weight: 40, detail: lab }); break; }
    }
  }

  if (!isOfficial && !IPV4.test(host)) {
    const regSkel = skeleton(domainToUnicode(reg).split('.')[0] || regLabel);
    const subSkels = unicodeHost.split('.').slice(0, -reg.split('.').length).map((l) => skeleton(l));
    // Every brand is asked, and the STRONGEST finding kept: "steamcommunlty" contains "steam"
    // (a weak signal) and is one edit from "steamcommunity" (a strong one), and the list order
    // must not decide which of the two is reported.
    let best = null;
    const keep = (r) => { if (!best || r.weight > best.weight) best = r; };
    for (const b of brands) {
      const brand = b.brand;
      if (!brand || brand.length < 4) continue;
      if (regSkel === brand) { keep({ rule: 'link.lookalike', weight: 70, detail: `${host} imitates ${brand}` }); break; }
      // One or two edits away from a long brand name ("steamcomrnunity", "dlscord" is caught
      // above by the skeleton, "discorcl" here). Short brands are skipped: "steam" is one edit
      // from "stream", and a check that flags every streaming link is switched off in a week.
      const d = brand.length >= 6 ? editDistance(regSkel, brand, 2) : 99;
      if ((brand.length >= 9 && d <= 2) || (brand.length >= 6 && d <= 1)) { keep({ rule: 'link.lookalike', weight: 70, detail: `${host} is close to ${brand}` }); continue; }
      if (subSkels.some((l) => l === brand || (brand.length >= 5 && l.includes(brand)))) { keep({ rule: 'link.brand_in_subdomain', weight: 50, detail: `${host} puts ${brand} before another domain` }); continue; }
      if (brand.length >= 5 && regSkel.includes(brand)) keep({ rule: 'link.brand_in_domain', weight: 40, detail: `${host} contains ${brand}` });
    }
    if (best) out.push(best);
    // A sign-in / wallet / gift path on a domain that is not the brand's, mentioning a brand.
    const path = fold(decodeURIComponentSafe(`${u.pathname} ${u.search}`));
    if (/(log-?in|sign-?in|verif|account|wallet|password|passwd|2fa|oauth|auth|gift|nitro|claim|airdrop|secure|billing|recover|unlock|appeal)/.test(path)) {
      const mentions = brands.find((b) => b.brand.length >= 5 && (skeleton(path).includes(b.brand) || subSkels.join('').includes(b.brand) || regSkel.includes(b.brand)));
      if (mentions) out.push({ rule: 'link.credential_path', weight: 30, detail: `${host}${u.pathname.slice(0, 60)} (${mentions.brand})` });
    }
    if (/nitro|free-?gift|steam-?gift/.test(fold(`${host} ${u.pathname}`))) out.push({ rule: 'link.gift_scam', weight: 45, detail: host });
  }
  return out;
}

function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch { return s; } }

/** Check every link of a message. Returns reasons (possibly several per link) plus the
 *  distinct hosts, which the "many links" heuristic reads. */
export function checkLinks(urls, ctx = {}) {
  const reasons = [];
  const hosts = new Set();
  const c = { ...ctx, brands: brandList(ctx.extraBrands) };
  for (const raw of urls) {
    for (const r of checkUrl(raw, c)) reasons.push(r);
    try { hosts.add(new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`).hostname); } catch { /* not a URL */ }
  }
  if (hosts.size > 5) reasons.push({ rule: 'link.many', weight: 15, detail: `${hosts.size} different sites` });
  return { reasons, hosts: [...hosts] };
}
