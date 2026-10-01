// The paywall card (agent-bcw-bot): what the bot answers when a server tries something its
// plan does not include, or spends its AI allowance. Never a dead end: two link buttons, one to
// the pricing page (with the feature and the server in the URL, so the page opens on the right
// card) and one to what the feature does. Adapted from OFD's PREMIUM_REQUIRED / LIMIT_REACHED
// replies (apps/bot interactions/errors.ts) and its PremiumLock call to action.
//
// Also the bot's cached view of a server's plan (GET /bot/guilds/:id/plan), for the checks the
// bot makes itself (the voice panel's pro controls). The API stays the authority: the served
// config is already filtered and every paid write is refused there too.
import { ButtonStyle } from 'discord.js';
import * as ui from './ui.mjs';
import { api, SITE_URL } from './api.mjs';

export const FEATURE_KEYS = ['welcome', 'welcomeBanner', 'joinToCreate', 'gating', 'rolePanels', 'blog', 'automod', 'logRouting', 'aiAutomod', 'aiAsk', 'jtcPro', 'aiByok'];
/** The tier that first includes each paid-by-default feature (the button says "Unlock with Pro"). */
const TIER_OF = { aiAutomod: 'pro', jtcPro: 'pro', aiByok: 'pro' };

/** The three links, built the same way the API builds them (routes/bot-billing.mjs paywallLinks). */
export function links({ feature = '', guildId = '' } = {}, site = SITE_URL) {
  const base = String(site || '').replace(/\/+$/, '');
  const q = new URLSearchParams();
  if (feature) q.set('feature', feature);
  if (guildId) q.set('guild', guildId);
  const qs = q.toString();
  return {
    pricing: `${base}/bot/pricing${qs ? `?${qs}` : ''}`,
    features: `${base}/bot/features${feature ? `#${encodeURIComponent(feature)}` : ''}`,
    credits: `${base}/dashboard?s=discord${guildId ? `&guild=${guildId}&view=billing` : ''}`,
  };
}

/**
 * The card options (for ui.reply / ui.card) for a refusal.
 * @param t     the reader's translator
 * @param r     { error: plan_required|plan_limit|ai_quota|ai_credits|ai_cap|no_key, feature?, limit?, max?, need? }
 * @param guildId
 */
export function paywallCard(t, r = {}, guildId = '') {
  const feature = FEATURE_KEYS.includes(r.feature) ? r.feature : '';
  const L = links({ feature, guildId });
  const name = feature ? t(`pw.f.${feature}`) : '';
  const tier = t(`plan.tier.${TIER_OF[feature] || 'pro'}`);
  const ai = ['ai_quota', 'ai_credits', 'ai_cap', 'no_key'].includes(r.error);
  let body;
  if (r.error === 'plan_limit') body = t('pw.limit', { limit: t(`pw.l.${r.limit}`) === `pw.l.${r.limit}` ? r.limit : t(`pw.l.${r.limit}`), max: r.max ?? 0 });
  else if (ai) body = t(`pw.${r.error}`, { n: r.need ?? 0 });
  else body = t('pw.feature', { feature: name || t('pw.thisFeature') });
  const buttons = [
    ui.btn(L.pricing, ai ? t('pw.btn.upgrade') : t('pw.btn.unlock', { tier }), ButtonStyle.Link),
    ai && r.error !== 'no_key' ? ui.btn(L.credits, t('pw.btn.credits'), ButtonStyle.Link) : ui.btn(L.features, t('pw.btn.features'), ButtonStyle.Link),
  ];
  return {
    title: ai ? t('pw.title.ai') : t('pw.title', { tier }),
    body: [body, t('pw.free')],
    color: ui.INFO,
    footer: t('pw.owner'),
    buttons,
  };
}

/** True when an API answer is a plan / budget refusal the paywall card explains. */
export const isPaywall = (r) => !!r && ['plan_required', 'plan_limit', 'ai_quota', 'ai_credits', 'ai_cap', 'no_key'].includes(r.error);

// ── the server's plan, cached ─────────────────────────────────────────────────────────────
const TTL = 60_000;
const cache = new Map();
/** { tier, features, limits, ai, balance } or null when the API did not answer. */
export async function guildPlan(guildId, { force = false, fetcher = api.guildPlan } = {}) {
  const k = String(guildId || '');
  if (!k) return null;
  const hit = cache.get(k);
  if (!force && hit && Date.now() - hit.at < TTL) return hit.plan;
  const plan = await fetcher(k).catch(() => null);
  if (plan) {
    if (cache.size > 2000) cache.delete(cache.keys().next().value);
    cache.set(k, { at: Date.now(), plan });
  }
  return plan || hit?.plan || null;
}
/** May this guild use `feature`? Unknown (API down) counts as yes: the API refuses anyway. */
export async function allows(guildId, feature, opts) {
  const plan = await guildPlan(guildId, opts);
  if (!plan) return true;
  return !!plan.unlimited || (plan.features || []).includes(feature);
}
export function _clearPlanCacheForTests() { cache.clear(); }
