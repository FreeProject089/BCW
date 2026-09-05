// The points shop, as ONE function — whichever door the purchase comes through.
//
// It started as a bot-only route: /shop in Discord posted to /bot/economy/buy and the API
// fulfilled from there. The site's own shop (dashboard → Boutique) needs the exact same act,
// and a second copy of "check the price, fulfil, debit, record" would have drifted the first
// time either was touched. So the route(s) translate the caller (a Discord id, or a session)
// into a userId and call this; the record of what was bought lives in EconomyPurchase, which
// is what the inventory reads.
import { logAudit } from './lib.mjs';
import { emitWebhook } from './webhooks.mjs';

// What each shop kind hands over. `site` kinds are fulfilled here; `bot`/`admin` kinds are
// recorded as pending and delivered by a person (a role needs the guild, a custom reward needs
// a human).
export const SHOP_KINDS = Object.freeze({
  badge: { label: 'Profile badge', fulfil: 'site' },
  pool: { label: 'Storage pool', fulfil: 'site' },
  boost: { label: 'Catalog boost', fulfil: 'site' },
  hosting: { label: 'Free hosting', fulfil: 'site' },
  promo: { label: 'Promo code', fulfil: 'admin' },
  role: { label: 'Discord role', fulfil: 'admin' },
  custom: { label: 'Reward', fulfil: 'admin' },
});

/** The shop items a member may see: named, with a badge kind only when the badge still exists. */
export function visibleShopItems(eco) {
  return (Array.isArray(eco?.shop) ? eco.shop : []).filter((x) => x && x.id && x.name && !(x.kind === 'badge' && !x.ref));
}

/**
 * Buy one item for `userId`. Returns the same shape the bot always got:
 *   { ok:true, item, delivery, points, purchaseId }  or  { ok:false, error, points?, cost? }
 * `via` names the door ('discord' | 'site') — kept on the record, shown in the inventory.
 */
export async function buyShopItem(p, eco, { userId, itemId, via = 'site', log = null }) {
  if (!eco?.enabled) return { ok: false, error: 'economy_off' };
  const item = visibleShopItems(eco).find((i) => i.id === itemId);
  if (!item) return { ok: false, error: 'no_such_item' };
  const cur = await p.userEconomy.findUnique({ where: { userId } });
  const cost = Math.max(0, Number(item.cost) || 0);
  if ((cur?.points || 0) < cost) return { ok: false, error: 'insufficient', points: cur?.points || 0, cost };
  // A one-per-account item (a badge) cannot be bought twice; every other kind can.
  let delivery = { kind: item.kind };
  let status = SHOP_KINDS[item.kind]?.fulfil === 'site' ? 'delivered' : 'pending';
  // Fulfil what the API itself can grant BEFORE debiting, so a failed grant never charges the
  // member. `role`/`promo`/`custom` are delivered by a person and recorded as pending.
  try {
    if (item.kind === 'badge' && item.ref) {
      const badge = await p.badge.findUnique({ where: { id: item.ref }, select: { id: true, name: true, active: true } });
      if (!badge || !badge.active) return { ok: false, error: 'badge_unavailable' };
      if (await p.userBadge.findUnique({ where: { userId_badgeId: { userId, badgeId: badge.id } } }))
        return { ok: false, error: 'already_owned' };
      await p.userBadge.create({ data: { userId, badgeId: badge.id, grantedBy: 'system' } });
      delivery = { kind: 'badge', badge: badge.name, badgeId: badge.id };
      emitWebhook(p, userId, 'badge.earned', { id: badge.id, name: badge.name, via: 'shop' }).catch(() => {});
    } else if (item.kind === 'pool' || item.kind === 'boost' || item.kind === 'hosting') {
      // Mint a real single-use promo code assigned to the buyer — redemption, limits and
      // lifecycle are the promo system's, not a bespoke path.
      const promoKind = item.kind === 'pool' ? 'free_pool' : item.kind === 'boost' ? 'free_boost' : 'free_hosting';
      const amount = Math.max(1, Number(item.amount) || 1);
      let code = ('SHOP' + Math.random().toString(36).slice(2, 8)).toUpperCase();
      for (let i = 0; i < 5 && (await p.promoCode.findUnique({ where: { code } })); i++) code = ('SHOP' + Math.random().toString(36).slice(2, 8)).toUpperCase();
      await p.promoCode.create({ data: {
        code, kind: promoKind,
        storageGB: (item.kind === 'pool' || item.kind === 'hosting') ? amount : null,
        boostDays: item.kind === 'boost' ? amount : null,
        hostMonths: item.kind === 'hosting' ? 1 : null,
        maxRedemptions: 1, perUserLimit: 1, assignedUserIds: [userId],
        note: `Shop purchase: ${item.name || item.id}`,
      } });
      delivery = { kind: item.kind, code, amount };
    } else if (item.kind === 'promo' && item.payload) {
      // A fixed code the admin typed into the item: handed over as-is, delivered on the spot.
      delivery = { kind: 'promo', code: String(item.payload) };
      status = 'delivered';
    }
  } catch (e) {
    log?.warn?.({ err: e?.message }, 'economy buy fulfil failed');
    return { ok: false, error: 'fulfil_failed' };
  }
  await p.userEconomy.update({ where: { userId }, data: { points: { decrement: cost } } });
  const rec = await p.economyPurchase.create({ data: {
    userId, itemId: item.id, itemName: String(item.name || item.id).slice(0, 120), kind: String(item.kind || 'custom'),
    cost, via, status, delivery,
  } }).catch(() => null);
  await logAudit(p, 'system', 'economy.buy', `user=${userId} item=${item.id} kind=${item.kind} cost=${cost} via=${via}`);
  emitWebhook(p, userId, 'shop.purchased', { purchaseId: rec?.id || null, itemId: item.id, name: item.name, kind: item.kind, cost, status }).catch(() => {});
  return {
    ok: true,
    item: { id: item.id, name: item.name, kind: item.kind, payload: item.payload || null, ref: item.ref || null, desc: item.desc || '' },
    delivery, status, points: (cur?.points || 0) - cost, purchaseId: rec?.id || null,
  };
}

/** A member's purchases, newest first — the inventory. */
export async function listPurchases(p, userId, take = 100) {
  const rows = await p.economyPurchase.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take });
  return rows.map((r) => ({
    id: r.id, itemId: r.itemId, name: r.itemName, kind: r.kind, cost: r.cost, via: r.via, status: r.status,
    // A code is the buyer's to see (it is theirs); everything else in `delivery` is descriptive.
    delivery: r.delivery || null, createdAt: r.createdAt,
  }));
}
