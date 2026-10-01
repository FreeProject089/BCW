// /plan and /ask (agent-bcw-bot).
//
//   /plan  this server's plan, its AI allowance and credits, with the two links an owner needs
//          (manage on the dashboard, compare the plans). Anyone may look; only the dashboard
//          changes anything.
//   /ask   the members' AI helper. Free on every plan, bounded three times: the bot's own
//          buckets (throttle.mjs: per server, per member) and work queue, then the API's burst
//          limit, monthly allowance and credits. A refusal from the API is the paywall card.
import { ButtonStyle } from 'discord.js';
import * as ui from '../ui.mjs';
import { tr } from '../i18n.mjs';
import { api } from '../api.mjs';
import { gates } from '../throttle.mjs';
import { guildPlan, isPaywall, links, paywallCard } from '../paywall.mjs';

export async function cmdPlan(i) {
  const { t } = await tr(i);
  if (!i.guildId) return ui.line(i, t('ask.guildonly'), { color: ui.BAD });
  const plan = await guildPlan(i.guildId, { force: true });
  if (!plan) return ui.line(i, t('plan.unavailable'), { color: ui.BAD });
  const L = links({ guildId: i.guildId });
  const ai = plan.ai || {};
  return ui.reply(i, {
    title: t('plan.title', { server: i.guild?.name || i.guildId, tier: t(`plan.tier.${plan.tier || 'free'}`) }),
    body: [
      t('plan.ai', { used: ai.used?.platform ?? 0, included: ai.included ?? 0, left: ai.left ?? 0 }),
      t('plan.credits', { n: plan.balance ?? 0 }),
      t(ai.source === 'byok' ? 'plan.src.byok' : 'plan.src.platform'),
    ],
    color: plan.tier === 'free' ? ui.INFO : ui.BRAND,
    buttons: [ui.btn(L.credits, t('plan.btn.manage'), ButtonStyle.Link), ui.btn(L.pricing, t('plan.btn.pricing'), ButtonStyle.Link)],
  });
}

// Every /ask reply allows NO mention (the answer is model output, the quoted question is a
// member's text): text sanitising cannot catch every form of ping, the message flag can.
const NO_PING = Object.freeze({ parse: [] });
const quiet = (i, opts) => i.editReply({ ...ui.card(opts), allowedMentions: NO_PING });

export async function cmdAsk(i, { askApi = api.aiAsk, queue = gates.ai, planOf = guildPlan } = {}) {
  const { t } = await tr(i);
  if (!i.guildId) return ui.line(i, t('ask.guildonly'), { color: ui.BAD });
  const question = String(i.options.getString('question') || '').trim().slice(0, 1500);
  // The cheap gates first: a refused question here never reaches the API or the provider.
  if (!gates.askGuild.take(i.guildId).ok || !gates.askMember.take(`${i.guildId}:${i.user.id}`).ok) return ui.line(i, t('ask.busy'), { color: ui.BAD });
  await i.deferReply();
  let r;
  try { r = await queue.run(() => askApi({ guildId: i.guildId, userId: i.user.id, question })); }
  catch { return quiet(i, { body: t('ask.busy'), color: ui.BAD }); }
  if (r?.ok) {
    const plan = await planOf(i.guildId, { force: true }).catch(() => null);
    return quiet(i, { title: t('ask.title'), body: [`> ${question.replace(/\n/g, ' ').slice(0, 200)}`, '', r.text], footer: t('ask.footer', { left: plan?.ai?.left ?? '?' }) });
  }
  if (isPaywall(r)) return quiet(i, paywallCard(t, r, i.guildId));
  if (r?.error === 'rate_limited' || r?.error === 'busy' || r?.status === 429) return quiet(i, { body: t('ask.busy'), color: ui.BAD });
  return quiet(i, { body: t('ask.fail'), color: ui.BAD });
}
