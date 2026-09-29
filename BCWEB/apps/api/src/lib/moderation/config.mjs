// Where the engine's settings live, and the short cache in front of them.
//
// Four AdminSetting rows, no new table: they are small, edited rarely, and read on every
// moderated request, which is exactly what the settings table plus a 15-second cache is for.
//
//   moderation.settings   { enabled, retentionDays }
//   moderation.policies   { [surface]: policy }                         (policy.mjs)
//   moderation.rules      { keywords, patterns, blockDomains, allowDomains,
//                           protectedBrands, weights, falsePositives }
//   ai.killed             true | false: the GLOBAL AI kill switch. Owned by the AI layer
//                         (lib/moderation/ai.mjs, AI_KILLED_KEY), read here and written by the
//                         moderation admin too, so there is ONE switch, not two that disagree.
//                         The env AI_KILL_SWITCH=1 wins over it (an admin cannot un-kill what the
//                         operator killed from the shell). Separate from
//                         `moderation.settings.enabled` on purpose: turning the AI off must
//                         never turn the rules off, and the other way round.
//
// Plus the existing BlockedUrl table (the Terms' URL blocklist, lib/urlblock.mjs), read as one
// more link signal so an address staff already blocked is caught in a message too.
import { normalizePolicies } from './policy.mjs';
import { compilePattern, LIMITS } from './patterns.mjs';
import { fold, skeleton } from './text.mjs';

export const KEYS = Object.freeze({
  settings: 'moderation.settings', policies: 'moderation.policies', rules: 'moderation.rules', kill: 'ai.killed',
});
export const DEFAULT_SETTINGS = Object.freeze({ enabled: true, retentionDays: 90 });

const TTL_MS = 15_000;
let cached = null; // { at, cfg }

export function invalidateConfig() { cached = null; }

const str = (v, max) => String(v ?? '').trim().slice(0, max);
const domainOf = (v) => str(v, 253).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').replace(/\.$/, '');
const isDomain = (d) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) || /^xn--/.test(d);
const weight = (v, dflt) => (Number.isFinite(Number(v)) ? Math.max(-100, Math.min(100, Math.round(Number(v)))) : dflt);

export function normalizeSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: r.enabled !== false,
    retentionDays: Number.isFinite(Number(r.retentionDays)) ? Math.max(1, Math.min(3650, Math.round(Number(r.retentionDays)))) : DEFAULT_SETTINGS.retentionDays,
  };
}

/**
 * The rules, from untrusted JSON. Returns `{ rules, errors }`: `rules` is what can be stored
 * and run (a bad pattern is DROPPED, never half-kept), `errors` says which entries were
 * refused and why, so the editor can show it next to the line.
 */
export function normalizeRules(raw, { probe = true } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const errors = [];
  const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
  const surfacesOf = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string').map((s) => s.slice(0, 40)).slice(0, 20) : []);

  const keywords = [];
  for (const [i, k] of list(r.keywords, 500).entries()) {
    const term = fold(str(k?.term, 80));
    if (term.length < 2) { errors.push({ list: 'keywords', index: i, error: 'too_short' }); continue; }
    keywords.push({ id: str(k.id, 40) || `k${i}`, term, weight: weight(k.weight, 25), loose: k.loose === true, surfaces: surfacesOf(k.surfaces) });
  }
  const patterns = [];
  for (const [i, pt] of list(r.patterns, LIMITS.maxPatterns).entries()) {
    const src = str(pt?.pattern, LIMITS.maxLen + 1);
    const c = compilePattern(src, pt?.flags ?? 'i', { probe });
    if (!c.ok) { errors.push({ list: 'patterns', index: i, error: c.error, pattern: src.slice(0, 60) }); continue; }
    patterns.push({ id: str(pt.id, 40) || `p${i}`, pattern: src, flags: c.flags, label: str(pt.label, 80), weight: weight(pt.weight, 30), surfaces: surfacesOf(pt.surfaces) });
  }
  const domains = (v, name) => {
    const out = [];
    for (const [i, d] of list(v, 2000).entries()) {
      const dom = domainOf(d);
      if (!isDomain(dom)) { errors.push({ list: name, index: i, error: 'not_a_domain' }); continue; }
      if (!out.includes(dom)) out.push(dom);
    }
    return out;
  };
  const protectedBrands = [];
  for (const [i, b] of list(r.protectedBrands, 100).entries()) {
    const brand = skeleton(str(b?.brand, 40));
    const doms = (Array.isArray(b?.domains) ? b.domains : []).map(domainOf).filter(isDomain).slice(0, 20);
    if (brand.length < 4 || !doms.length) { errors.push({ list: 'protectedBrands', index: i, error: 'brand_needs_name_and_domain' }); continue; }
    protectedBrands.push({ brand, domains: doms });
  }
  const weights = {};
  for (const [k, v] of Object.entries(r.weights && typeof r.weights === 'object' ? r.weights : {}).slice(0, 100)) {
    if (/^[a-z_]+\.[a-z_]+$/.test(k)) weights[k] = weight(v, 0);
  }
  const falsePositives = list(r.falsePositives, 2000)
    .filter((f) => f && typeof f.hash === 'string' && /^[0-9a-f]{32}$/.test(f.hash))
    .map((f) => ({ hash: f.hash, at: str(f.at, 40), caseId: str(f.caseId, 40) }));
  return {
    rules: {
      keywords, patterns,
      blockDomains: domains(r.blockDomains, 'blockDomains'),
      allowDomains: domains(r.allowDomains, 'allowDomains'),
      protectedBrands, weights, falsePositives,
    },
    errors,
  };
}

/** Compile the stored rules for running. The timed probe ran when they were saved; the
 *  static checks run again here, so a pattern stored by an older build that no longer passes
 *  them is skipped rather than run. */
function compileRules(rules) {
  const compiled = [];
  for (const pt of rules.patterns) {
    const c = compilePattern(pt.pattern, pt.flags, { probe: false });
    if (c.ok) compiled.push({ ...pt, re: c.re });
  }
  return { ...rules, compiled, fpHashes: new Set(rules.falsePositives.map((f) => f.hash)) };
}

async function read(p, key) {
  const row = await p.adminSetting.findUnique({ where: { key } }).catch(() => null);
  return row?.value ?? null;
}

/** Everything the engine needs, cached for TTL_MS. */
export async function loadConfig(p, { fresh = false } = {}) {
  if (!fresh && cached && Date.now() - cached.at < TTL_MS) return cached.cfg;
  const [settings, policies, rules, kill, blocked] = await Promise.all([
    read(p, KEYS.settings), read(p, KEYS.policies), read(p, KEYS.rules), read(p, KEYS.kill),
    p.blockedUrl?.findMany?.({ select: { id: true, scope: true, pattern: true, allow: true } }).catch(() => []) ?? [],
  ]);
  const cfg = {
    settings: normalizeSettings(settings),
    policies: normalizePolicies(policies),
    rules: compileRules(normalizeRules(rules, { probe: false }).rules),
    killSwitch: {
      killed: kill === true || /^(1|true|yes|on)$/i.test(String(process.env.AI_KILL_SWITCH || '').trim()),
      by: /^(1|true|yes|on)$/i.test(String(process.env.AI_KILL_SWITCH || '').trim()) ? 'env' : kill === true ? 'setting' : null,
    },
    blocked: blocked || [],
  };
  cached = { at: Date.now(), cfg };
  return cfg;
}

export async function saveSetting(p, key, value) {
  await p.adminSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  invalidateConfig();
}
