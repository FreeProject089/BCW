// Discord roles bought on the marketplace, at the END of their subscription (agent-bcw-bot,
// owner's decision 2026-10-01). Each server chooses, from its dashboard:
//
//   remove  the bot takes the role back as soon as the subscription ends
//   keep    nothing is taken back (a role bought once stays)
//   grace   the role is taken back after N days (default: this, 7 days)
//
// The policy lives in the per-guild bot config (bot.config.guilds[id].purchasedRoles), like
// every other per-server setting. When a marketplace subscription for a `role` product ends
// (stripe-webhook customer.subscription.deleted), scheduleRoleRemovals writes one
// BotRoleRemoval per Discord account the buyer linked; the sweeper (runDueRoleRemovals) queues
// a BotAction role_remove, which the bot already carries out, when the date passes. A buyer who
// is paying for the same role again by then keeps it (outcome `renewed`).
//
// The server a role belongs to is found in the bot's heartbeat (every guild reports its role
// ids): a role id is a snowflake, unique across Discord.
export const ROLE_END_POLICIES = ['remove', 'keep', 'grace'];
export const DEFAULT_ROLE_END = Object.freeze({ onEnd: 'grace', graceDays: 7 });

/** A guild's policy cleaned; anything unknown is the default. Pure. */
export function normalizeRoleEndPolicy(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const onEnd = ROLE_END_POLICIES.includes(r.onEnd) ? r.onEnd : DEFAULT_ROLE_END.onEnd;
  const g = Math.round(Number(r.graceDays));
  return { onEnd, graceDays: Number.isFinite(g) ? Math.max(1, Math.min(90, g)) : DEFAULT_ROLE_END.graceDays };
}

/** When the role goes, for a subscription that ended at `endedAt`; null = never. Pure. */
export function removalDate(policy, endedAt) {
  const pol = normalizeRoleEndPolicy(policy);
  const t = new Date(endedAt);
  if (pol.onEnd === 'keep') return null;
  if (pol.onEnd === 'remove') return t;
  return new Date(t.getTime() + pol.graceDays * 864e5);
}

/** The guild that owns `roleId`, from the heartbeat's guild list, or null. Pure. */
export function guildOfRole(guildList, roleId) {
  const id = String(roleId || '');
  if (!id) return null;
  const g = (guildList || []).find((x) => x && Array.isArray(x.roles) && x.roles.some((r) => String(r?.id) === id));
  return g ? String(g.id) : null;
}

async function context(p) {
  const [cfg, status] = await Promise.all([
    p.adminSetting.findUnique({ where: { key: 'bot.config' } }).catch(() => null),
    p.adminSetting.findUnique({ where: { key: 'bot.status' } }).catch(() => null),
  ]);
  return { guilds: cfg?.value?.guilds || {}, guildList: status?.value?.guildList || [] };
}

/**
 * A marketplace subscription ended. `purchases` are its rows ({ id, productId, buyerId,
 * product: { deliveryKind, roleId } }). Returns how many removals were scheduled.
 */
export async function scheduleRoleRemovals(p, purchases, endedAt = new Date()) {
  const roles = (purchases || []).filter((x) => x?.product?.deliveryKind === 'role' && x.product.roleId);
  if (!roles.length) return 0;
  const ctx = await context(p);
  let n = 0;
  for (const pu of roles) {
    const guildId = guildOfRole(ctx.guildList, pu.product.roleId);
    if (!guildId) continue; // the bot is not in that server (any more): nothing it could take back
    const at = removalDate(ctx.guilds[guildId]?.purchasedRoles, endedAt);
    if (!at) continue; // keep
    const links = await p.discordLink.findMany({ where: { userId: pu.buyerId }, select: { discordId: true } });
    for (const l of links) {
      await p.botRoleRemoval.upsert({
        where: { purchaseId_discordId: { purchaseId: pu.id, discordId: l.discordId } },
        create: { purchaseId: pu.id, productId: pu.productId, buyerId: pu.buyerId, discordId: l.discordId, guildId, roleId: String(pu.product.roleId), removeAt: at },
        update: {},
      });
      n += 1;
    }
  }
  return n;
}

/** The sweeper's half: queue the removals whose date passed. Returns { removed, renewed }. */
export async function runDueRoleRemovals(p, now = new Date(), log = null) {
  const due = await p.botRoleRemoval.findMany({ where: { doneAt: null, removeAt: { lte: new Date(now) } }, take: 200, orderBy: { removeAt: 'asc' } });
  let removed = 0, renewed = 0;
  for (const r of due) {
    // Paying again for the same product (a new subscription, a renewal row) keeps the role.
    const again = await p.projectProductPurchase.findFirst({ where: { productId: r.productId, buyerId: r.buyerId, status: 'active', id: { not: r.purchaseId } }, select: { id: true } }).catch(() => null);
    if (again) {
      await p.botRoleRemoval.update({ where: { id: r.id }, data: { doneAt: new Date(now), outcome: 'renewed' } });
      renewed += 1;
      continue;
    }
    await p.botAction.create({ data: {
      kind: 'role_remove', discordId: r.discordId, guildId: r.guildId, roleId: r.roleId,
      reason: 'Marketplace subscription ended', targetLabel: r.discordId, requestedByLabel: 'subscription end',
    } });
    await p.botRoleRemoval.update({ where: { id: r.id }, data: { doneAt: new Date(now), outcome: 'removed' } });
    removed += 1;
  }
  if (removed || renewed) log?.info?.(`[purchased-roles] ${removed} role(s) queued for removal, ${renewed} kept (renewed)`);
  return { removed, renewed };
}
