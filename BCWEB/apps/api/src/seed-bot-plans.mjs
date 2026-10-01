// Seed the Discord bot plans (agent-bcw-bot): Pro and Ultra as HostingPlan rows of kind 'bot',
// from the default offer in lib/bot-billing.mjs (TIER_PRESETS, ported from the OFD bot's
// Free / Premium / Ultra). Free is not a row: it is the admin's free tier (bot.entitlements).
//
//   npm run seed:bot-plans              creates the missing tiers SWITCHED OFF (the admin reviews
//                                       the price, then turns them on in Admin → Hosting)
//   npm run seed:bot-plans -- --activate  creates them on sale
//
// Idempotent: a tier that already has a plan row (bot.tier) is left exactly as it is, so a
// price the admin changed is never put back.
import { db } from './lib/lib.mjs';
import { TIER_PRESETS } from './lib/bot-billing.mjs';
import { normalizePlanBot } from './lib/bot-entitlements.mjs';

const activate = process.argv.includes('--activate');
const p = await db();
const rows = await p.hostingPlan.findMany({ where: { kind: 'bot' } });
for (const key of ['pro', 'ultra']) {
  const t = TIER_PRESETS[key];
  const have = rows.find((r) => normalizePlanBot(r.bot)?.tier === key);
  if (have) { console.log(`[seed-bot-plans] ${key}: kept "${have.name}" (${have.priceMonthlyCents} cents, ${have.active ? 'on sale' : 'off'})`); continue; }
  const row = await p.hostingPlan.create({ data: {
    name: `Bot ${t.name}`, kind: 'bot', storageGB: 0, uploadLimitKbps: 0, priceMonthlyCents: t.priceMonthlyCents, active: activate,
    bot: { tier: key, guilds: t.guilds, features: t.features, limits: t.limits },
  } });
  console.log(`[seed-bot-plans] ${key}: created "${row.name}" at ${row.priceMonthlyCents} cents (${activate ? 'on sale' : 'off, turn it on in Admin'})`);
}
await p.$disconnect();
