// The points shop, the inventory, gifts and the ledger — ONE module, whichever door the act
// comes through (Discord /shop, the site's Boutique, an admin grant).
//
// It started as a bot-only route. The site's own shop needs the exact same act, and a second
// copy of "check the price, fulfil, debit, record" would have drifted the first time either
// was touched. So the routes translate the caller (a Discord id, or a session) into a userId
// and call this.
//
// What is written where:
//   · EconomyPurchase — one row per purchase (the inventory). `delivery` holds what was handed
//     over; codes are MINTED ON REVEAL (delivery.revealed), never before, so an unrevealed
//     purchase can be gifted and a code never sits in a database row nobody asked for.
//   · EconomyLedger — every movement of points (level-up grants, staff grants, purchases,
//     casino, gifts both ways). The histories the dashboards show are this table; retention
//     is `economy.historyDays` (sweepEconomyHistory).
import crypto from 'node:crypto';
import { logAudit, notify } from './lib.mjs';
import { emitWebhook } from './webhooks.mjs';
import { ciEquals } from './ci-equals.mjs';

// A shop reveal code that grants free hosting / storage / a discount is a bearer secret, so it
// is drawn from a CSPRNG, not Math.random (whose state is recoverable from a few outputs — an
// attacker who reveals a handful of their own codes could then predict later ones).
const SHOP_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
function newShopCode(len = 10) {
  let s = 'SHOP';
  for (let i = 0; i < len; i++) s += SHOP_CODE_ALPHABET[crypto.randomInt(SHOP_CODE_ALPHABET.length)];
  return s;
}

// What each shop kind hands over. `site` kinds are fulfilled here; `admin` kinds are recorded
// as pending and delivered by a person (a role needs the guild, a custom reward a human).
export const SHOP_KINDS = Object.freeze({
  badge: { label: 'Profile badge', fulfil: 'site', code: false },
  pool: { label: 'Storage pool', fulfil: 'site', code: true },
  boost: { label: 'Catalog / repo boost', fulfil: 'site', code: true },
  hosting: { label: 'Free hosting', fulfil: 'site', code: true },
  promo: { label: 'Promo code', fulfil: 'site', code: true },
  role: { label: 'Discord role', fulfil: 'admin', code: false },
  custom: { label: 'Reward', fulfil: 'admin', code: false },
});

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** One item, with every optional field in its normalised form. */
export function normItem(x) {
  if (!x || !x.id) return null;
  const kind = SHOP_KINDS[x.kind] ? x.kind : 'custom';
  return {
    id: String(x.id), name: String(x.name || '').slice(0, 80), desc: String(x.desc || '').slice(0, 300),
    cost: Math.max(0, Math.round(num(x.cost))), kind, ref: x.ref || null,
    // Precise configuration per kind (the legacy `amount` is read as the size).
    amount: num(x.amount, 0) || null,
    gb: num(x.gb, num(x.amount, 0)) || null,                 // pool / hosting: GB
    days: num(x.days, num(x.amount, 0)) || null,             // boost: days
    months: Math.max(1, num(x.months, 1)),                   // hosting: months
    target: x.target === 'repo' ? 'repo' : 'catalog',        // boost: what it boosts
    promo: { mode: x.promo?.mode === 'fixed' ? 'fixed' : 'generated', code: String(x.promo?.code || '').slice(0, 40), percentOff: num(x.promo?.percentOff, 0) || null, freeMonths: num(x.promo?.freeMonths, 0) || null },
    // Availability and value.
    stock: x.stock == null || x.stock === '' ? null : Math.max(0, Math.round(num(x.stock))),  // null = unlimited
    exclusive: !!x.exclusive,                                 // one per account
    giftable: x.giftable !== false && kind !== 'badge' && kind !== 'role', // a badge/role is bound to the buyer
    codeDays: x.codeDays == null || x.codeDays === '' ? null : Math.max(1, Math.round(num(x.codeDays))), // code validity after reveal
    availableUntil: x.availableUntil ? new Date(x.availableUntil).toISOString() : null,
    active: x.active !== false,
    // Per-door availability: an item can be listed on the Discord bot's /shop, on the site's
    // Boutique, or both. Default both true so every existing item stays exactly where it was.
    onBot: x.onBot !== false,
    onSite: x.onSite !== false,
  };
}

/** The shop items a member may see: named, active, still listed, with a badge that exists.
 *  `via` ('discord' | 'site') scopes it to that door — a bot-only item never shows on the site
 *  and vice-versa. Omit `via` for the admin preview, which sees everything. */
export function visibleShopItems(eco, via = null) {
  const now = Date.now();
  const door = via === 'discord' ? 'onBot' : via === 'site' ? 'onSite' : null;
  return (Array.isArray(eco?.shop) ? eco.shop : []).map(normItem)
    .filter((x) => x && x.name && x.active && !(x.kind === 'badge' && !x.ref) && !(x.availableUntil && new Date(x.availableUntil).getTime() < now))
    .filter((x) => !door || x[door]);
}

/** How many of an item were sold (a refunded row does not count). */
export async function soldCount(p, itemId) {
  return p.economyPurchase.count({ where: { itemId, status: { not: 'refunded' } } });
}

/** The value tag an item carries: exclusive · limited (with what is left) · timed · none. */
export function itemTag(item, sold = 0) {
  if (item.exclusive) return { tag: 'exclusive', remaining: item.stock != null ? Math.max(0, item.stock - sold) : null };
  if (item.stock != null) return { tag: 'limited', remaining: Math.max(0, item.stock - sold) };
  if (item.availableUntil) return { tag: 'timed', remaining: null };
  return { tag: null, remaining: null };
}

/** Append one ledger row. `balance` is the balance AFTER the movement. */
export async function ledger(p, { userId, kind, delta, balance, ref = null, meta = null }) {
  return p.economyLedger.create({ data: { userId, kind, delta: Math.round(delta), balance: Math.round(balance), ref, meta } }).catch(() => null);
}

/**
 * Move `delta` points on a balance and record it. ATOMIC: a debit is one conditional UPDATE,
 * so two concurrent operations can never both read the same balance and lose an update — the
 * bug that let a gift of the whole balance, fired twice, mint points from nothing, and let two
 * concurrent buys be charged once for two items.
 *
 * A DEBIT (`delta < 0`) applies only if the balance covers it and returns `null` when it does
 * not — the caller MUST treat `null` as "insufficient" and not proceed (credit the other side,
 * hand over the item…). Pass `{ clamp: true }` for a settlement that should take whatever is
 * there instead of failing (a casino loss, an admin zero-out): it never mints, only floors.
 * A CREDIT (`delta > 0`) always applies. Returns the new balance (or `null` on a failed debit).
 */
export async function movePoints(p, userId, delta, entry, { clamp = false } = {}) {
  await p.userEconomy.upsert({ where: { userId }, create: { userId, points: 0 }, update: {} });
  const d = Math.round(Number(delta) || 0);
  if (d < 0) {
    const need = -d;
    const r = await p.userEconomy.updateMany({ where: { userId, points: { gte: need } }, data: { points: { decrement: need } } });
    if (r.count === 0) {
      if (!clamp) return null;                       // insufficient — change nothing, no ledger
      await p.userEconomy.updateMany({ where: { userId }, data: { points: 0 } });
    }
  } else if (d > 0) {
    await p.userEconomy.update({ where: { userId }, data: { points: { increment: d } } });
  }
  const after = (await p.userEconomy.findUnique({ where: { userId }, select: { points: true } }))?.points || 0;
  await ledger(p, { userId, delta: d, balance: after, ...entry });
  return after;
}

// What the buyer may see of a delivery: never the fixed code before it is revealed.
export function pubDelivery(d) {
  if (!d || typeof d !== 'object') return d || null;
  // Never expose the fixed code seed or the giveaway's internal gift config, and keep a sealed
  // prize's content/code hidden until it is actually revealed.
  const { fixedCode, giftConfig, ...rest } = d;
  if (!rest.revealed) { delete rest.content; delete rest.code; }
  return rest;
}

/**
 * Buy one item for `userId`. Returns the same shape the bot always got:
 *   { ok:true, item, delivery, status, points, purchaseId }  or  { ok:false, error, points?, cost? }
 * `via` names the door ('discord' | 'site') — kept on the record, shown in the inventory.
 */
export async function buyShopItem(p, eco, { userId, itemId, via = 'site', log = null }) {
  if (!eco?.enabled) return { ok: false, error: 'economy_off' };
  // Scope to the door the buy came through — a bot-only item can't be bought from the site.
  const item = visibleShopItems(eco, via).find((i) => i.id === itemId);
  if (!item) return { ok: false, error: 'no_such_item' };
  const cur = await p.userEconomy.findUnique({ where: { userId } });
  const cost = item.cost;
  if ((cur?.points || 0) < cost) return { ok: false, error: 'insufficient', points: cur?.points || 0, cost };
  // Stock and exclusivity are checked against the purchase table, so both doors count.
  if (item.stock != null && (await soldCount(p, item.id)) >= item.stock) return { ok: false, error: 'sold_out' };
  if (item.exclusive && (await p.economyPurchase.count({ where: { itemId: item.id, userId, status: { not: 'refunded' } } })) > 0) return { ok: false, error: 'already_owned' };
  // Charge atomically FIRST, so two concurrent buys can never be charged once for two items.
  // If the balance no longer covers it (a race lost between the check above and here), nothing
  // is granted and no row is written.
  const points = await movePoints(p, userId, -cost, { kind: 'purchase', ref: item.id, meta: { itemId: item.id, name: item.name, kind: item.kind, via } });
  if (points == null) return { ok: false, error: 'insufficient', points: (await p.userEconomy.findUnique({ where: { userId }, select: { points: true } }))?.points || 0, cost };
  // Put the points back if anything below refuses to complete the sale.
  const refund = (why) => movePoints(p, userId, cost, { kind: 'refund', ref: item.id, meta: { itemId: item.id, name: item.name, reason: why } }, { clamp: true });
  let delivery = { kind: item.kind };
  let status = SHOP_KINDS[item.kind].fulfil === 'site' ? 'delivered' : 'pending';
  // A code is NOT minted here: the purchase holds a sealed envelope until "Reveal".
  try {
    if (item.kind === 'badge') {
      const badge = await p.badge.findUnique({ where: { id: item.ref }, select: { id: true, name: true, active: true } });
      if (!badge || !badge.active) { await refund('badge_unavailable'); return { ok: false, error: 'badge_unavailable' }; }
      if (await p.userBadge.findUnique({ where: { userId_badgeId: { userId, badgeId: badge.id } } })) { await refund('already_owned'); return { ok: false, error: 'already_owned' }; }
      await p.userBadge.create({ data: { userId, badgeId: badge.id, grantedBy: 'system' } });
      delivery = { kind: 'badge', badge: badge.name, badgeId: badge.id, revealed: true };
      emitWebhook(p, userId, 'badge.earned', { id: badge.id, name: badge.name, via: 'shop' }).catch(() => {});
    } else if (SHOP_KINDS[item.kind].code) {
      delivery = { kind: item.kind, revealed: false, ...(item.kind === 'promo' && item.promo.mode === 'fixed' && item.promo.code ? { fixedCode: item.promo.code } : {}) };
    }
  } catch (e) {
    log?.warn?.({ err: e?.message }, 'economy buy fulfil failed');
    await refund('fulfil_failed');
    return { ok: false, error: 'fulfil_failed' };
  }
  const expiresAt = item.codeDays && SHOP_KINDS[item.kind].code ? null : null; // the clock starts at reveal
  const rec = await p.economyPurchase.create({ data: {
    userId, itemId: item.id, itemName: item.name, kind: item.kind, cost, via, status, delivery, expiresAt,
  } }).catch(() => null);
  // Compensating stock / exclusivity guard: the pre-check races (count-then-insert has no DB
  // constraint behind it), so re-rank now that our row exists. Only the first `stock` rows by
  // creation win; a `one-per-account` item allows only the user's earliest. A loser is unwound
  // — row dropped, badge grant undone, points refunded — so the limit can never be oversold.
  if (rec && (item.stock != null || item.exclusive)) {
    let loser = false;
    if (item.stock != null) {
      const sold = await p.economyPurchase.findMany({ where: { itemId: item.id, status: { not: 'refunded' } }, orderBy: { createdAt: 'asc' }, select: { id: true } });
      loser = sold.findIndex((x) => x.id === rec.id) >= item.stock;
    }
    if (!loser && item.exclusive) {
      const mine = await p.economyPurchase.findMany({ where: { itemId: item.id, userId, status: { not: 'refunded' } }, orderBy: { createdAt: 'asc' }, select: { id: true } });
      loser = mine.findIndex((x) => x.id === rec.id) >= 1;
    }
    if (loser) {
      await p.economyPurchase.delete({ where: { id: rec.id } }).catch(() => {});
      if (delivery.kind === 'badge' && delivery.badgeId) await p.userBadge.deleteMany({ where: { userId, badgeId: delivery.badgeId, grantedBy: 'system' } }).catch(() => {});
      await refund(item.stock != null ? 'sold_out' : 'already_owned');
      return { ok: false, error: item.stock != null ? 'sold_out' : 'already_owned' };
    }
  }
  await logAudit(p, 'system', 'economy.buy', `user=${userId} item=${item.id} kind=${item.kind} cost=${cost} via=${via}`);
  emitWebhook(p, userId, 'shop.purchased', { purchaseId: rec?.id || null, itemId: item.id, name: item.name, kind: item.kind, cost, status }).catch(() => {});
  return {
    ok: true,
    item: { id: item.id, name: item.name, kind: item.kind, ref: item.ref, desc: item.desc, giftable: item.giftable },
    delivery: pubDelivery(delivery), status, points, purchaseId: rec?.id || null,
  };
}

/** Mint the code of a purchase, once, for whoever holds it now. */
export async function revealPurchase(p, eco, { userId, purchaseId }) {
  const row = await p.economyPurchase.findFirst({ where: { id: purchaseId, userId } });
  if (!row) return { ok: false, error: 'not_found' };
  const d = row.delivery || {};
  if (d.revealed) return { ok: true, delivery: pubDelivery(d), expiresAt: row.expiresAt };
  // A giveaway win in the inventory. Not a shop item (no eco.shop entry), so it reveals from
  // what was stamped on it at draw time: a `custom` prize shows the content the creator typed;
  // a `promo` prize mints its code now (from the attached gift config), bound to the winner.
  if (row.kind === 'giveaway') {
    if (d.custom) {
      const delivery = { kind: 'giveaway', custom: true, revealed: true, content: String(d.content || ''), prizeName: d.name || row.itemName, revealedAt: new Date().toISOString() };
      await p.economyPurchase.update({ where: { id: row.id }, data: { delivery, revealedAt: new Date() } });
      await logAudit(p, 'system', 'economy.reveal', `user=${userId} giveaway=${row.itemId}`);
      return { ok: true, delivery };
    }
    if (d.giftConfig) {
      const g = d.giftConfig;
      let code = newShopCode();
      for (let i = 0; i < 5 && (await p.promoCode.findUnique({ where: { code } })); i++) code = newShopCode();
      await p.promoCode.create({ data: {
        code, kind: g.kind, percentOff: g.percentOff ?? null, freeMonths: g.freeMonths ?? null,
        storageGB: g.storageGB ?? null, uploadMbps: g.uploadMbps ?? null, hostMonths: g.hostMonths ?? null, boostDays: g.boostDays ?? null,
        maxRedemptions: 1, perUserLimit: 1, assignedUserIds: [userId], note: `Giveaway win ${row.id}`,
      } });
      const delivery = { kind: 'giveaway', revealed: true, code, revealedAt: new Date().toISOString() };
      await p.economyPurchase.update({ where: { id: row.id }, data: { delivery, revealedAt: new Date() } });
      await logAudit(p, 'system', 'economy.reveal', `user=${userId} giveaway=${row.itemId}`);
      return { ok: true, delivery };
    }
    return { ok: false, error: 'nothing_to_reveal' };
  }
  if (!SHOP_KINDS[row.kind]?.code) return { ok: false, error: 'nothing_to_reveal' };
  const item = (Array.isArray(eco?.shop) ? eco.shop : []).map(normItem).find((x) => x && x.id === row.itemId);
  const codeDays = item?.codeDays || null;
  const expiresAt = codeDays ? new Date(Date.now() + codeDays * 864e5) : null;
  let code;
  if (row.kind === 'promo' && d.fixedCode) {
    code = d.fixedCode;
  } else {
    const promoKind = row.kind === 'pool' ? 'free_pool' : row.kind === 'boost' ? 'free_boost' : row.kind === 'hosting' ? 'free_hosting' : 'discount';
    code = newShopCode();
    for (let i = 0; i < 5 && (await p.promoCode.findUnique({ where: { code } })); i++) code = newShopCode();
    const gb = item?.gb || item?.amount || 1, days = item?.days || item?.amount || 7;
    await p.promoCode.create({ data: {
      code, kind: promoKind,
      storageGB: (row.kind === 'pool' || row.kind === 'hosting') ? gb : null,
      boostDays: row.kind === 'boost' ? days : null,
      hostMonths: row.kind === 'hosting' ? (item?.months || 1) : null,
      ...(row.kind === 'promo' ? { percentOff: item?.promo?.percentOff || null, freeMonths: item?.promo?.freeMonths || null } : {}),
      maxRedemptions: 1, perUserLimit: 1,
      // A giftable item's code is not bound to a person — it can be handed to anyone.
      assignedUserIds: item?.giftable ? [] : [userId],
      expiresAt,
      note: `Shop purchase ${row.id}: ${row.itemName}`,
    } });
  }
  const delivery = { kind: row.kind, revealed: true, code, revealedAt: new Date().toISOString(), ...(item?.target ? { target: item.target } : {}) };
  await p.economyPurchase.update({ where: { id: row.id }, data: { delivery, expiresAt, revealedAt: new Date() } });
  await logAudit(p, 'system', 'economy.reveal', `user=${userId} purchase=${row.id}`);
  return { ok: true, delivery, expiresAt };
}

/** Hand a purchase to another member. Only a giftable item, and only while its code is not
 *  bound to the giver (unrevealed, or revealed unassigned). */
export async function giftPurchase(p, eco, { fromUserId, purchaseId, toUserId }) {
  if (fromUserId === toUserId) return { ok: false, error: 'self' };
  const row = await p.economyPurchase.findFirst({ where: { id: purchaseId, userId: fromUserId } });
  if (!row) return { ok: false, error: 'not_found' };
  if (row.status === 'pending') return { ok: false, error: 'pending' };
  const item = (Array.isArray(eco?.shop) ? eco.shop : []).map(normItem).find((x) => x && x.id === row.itemId);
  if (!item?.giftable) return { ok: false, error: 'not_giftable' };
  const to = await p.user.findUnique({ where: { id: toUserId }, select: { id: true, displayName: true, closedAt: true } });
  if (!to || to.closedAt) return { ok: false, error: 'no_such_user' };
  await p.economyPurchase.update({ where: { id: row.id }, data: { userId: to.id, giftedFromId: fromUserId } });
  const from = await p.user.findUnique({ where: { id: fromUserId }, select: { displayName: true } });
  await ledger(p, { userId: fromUserId, kind: 'gift_item_out', delta: 0, balance: (await p.userEconomy.findUnique({ where: { userId: fromUserId } }))?.points || 0, ref: row.id, meta: { to: to.id, toName: to.displayName, name: row.itemName } });
  await ledger(p, { userId: to.id, kind: 'gift_item_in', delta: 0, balance: (await p.userEconomy.findUnique({ where: { userId: to.id } }))?.points || 0, ref: row.id, meta: { from: fromUserId, fromName: from?.displayName, name: row.itemName } });
  notify(p, to.id, 'promo_gift', `${from?.displayName || 'A member'} gave you “${row.itemName}” from the points shop.`, { bodyFr: `${from?.displayName || 'Un membre'} t’a offert « ${row.itemName} » de la boutique de points.`, href: '/dashboard?s=economy' }).catch(() => {});
  await logAudit(p, 'system', 'economy.gift.item', `purchase=${row.id} ${fromUserId} → ${to.id}`);
  return { ok: true, to: { id: to.id, displayName: to.displayName } };
}

/** Points from one member to another, within the configured daily cap. */
export async function giftPoints(p, eco, { fromUserId, toUserId, points, note = '', via = 'site' }) {
  const cfg = eco?.gifts || {};
  if (!eco?.enabled) return { ok: false, error: 'economy_off' };
  if (cfg.enabled === false) return { ok: false, error: 'gifts_off' };
  if (fromUserId === toUserId) return { ok: false, error: 'self' };
  points = Math.round(num(points));
  const min = Math.max(1, num(cfg.min, 1));
  if (points < min) return { ok: false, error: 'too_small', min };
  const to = await p.user.findUnique({ where: { id: toUserId }, select: { id: true, displayName: true, closedAt: true } });
  if (!to || to.closedAt) return { ok: false, error: 'no_such_user' };
  const cur = await p.userEconomy.findUnique({ where: { userId: fromUserId } });
  if ((cur?.points || 0) < points) return { ok: false, error: 'insufficient', points: cur?.points || 0 };
  const maxPerDay = num(cfg.maxPerDay, 0);
  if (maxPerDay > 0) {
    const since = new Date(Date.now() - 864e5);
    const agg = await p.economyLedger.aggregate({ _sum: { delta: true }, where: { userId: fromUserId, kind: 'gift_out', createdAt: { gte: since } } });
    const given = -(agg._sum.delta || 0);
    if (given + points > maxPerDay) return { ok: false, error: 'daily_cap', maxPerDay, left: Math.max(0, maxPerDay - given) };
  }
  const from = await p.user.findUnique({ where: { id: fromUserId }, select: { displayName: true } });
  const meta = { note: String(note || '').slice(0, 140), via };
  // Debit the sender atomically; the recipient is credited ONLY if it succeeded. Without this
  // ordering two concurrent gifts of the whole balance each "succeeded" on a stale read and the
  // recipient was credited twice — points minted from nothing.
  const fromBalance = await movePoints(p, fromUserId, -points, { kind: 'gift_out', ref: to.id, meta: { ...meta, toName: to.displayName } });
  if (fromBalance == null) return { ok: false, error: 'insufficient', points: (await p.userEconomy.findUnique({ where: { userId: fromUserId }, select: { points: true } }))?.points || 0 };
  await movePoints(p, to.id, points, { kind: 'gift_in', ref: fromUserId, meta: { ...meta, fromName: from?.displayName } });
  notify(p, to.id, 'promo_gift', `${from?.displayName || 'A member'} sent you ${points} ${eco.currencyName || 'points'}${note ? ` — “${String(note).slice(0, 140)}”` : ''}.`, { bodyFr: `${from?.displayName || 'Un membre'} t’a envoyé ${points} ${eco.currencyName || 'points'}${note ? ` — « ${String(note).slice(0, 140)} »` : ''}.`, href: '/dashboard?s=economy' }).catch(() => {});
  await logAudit(p, 'system', 'economy.gift', `${fromUserId} → ${to.id}: ${points}${via ? ` via=${via}` : ''}`);
  return { ok: true, points: fromBalance, to: { id: to.id, displayName: to.displayName } };
}

/** A member's purchases, newest first — the inventory, with what may be done to each. */
export async function listPurchases(p, eco, userId, take = 100) {
  const items = new Map((Array.isArray(eco?.shop) ? eco.shop : []).map(normItem).filter(Boolean).map((x) => [x.id, x]));
  const rows = await p.economyPurchase.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take });
  return rows.map((r) => {
    const it = items.get(r.itemId);
    const d = r.delivery || {};
    return {
      id: r.id, itemId: r.itemId, name: r.itemName, kind: r.kind, cost: r.cost, via: r.via, status: r.status,
      delivery: pubDelivery(d), createdAt: r.createdAt, expiresAt: r.expiresAt, giftedFromId: r.giftedFromId || null,
      canReveal: (r.kind === 'giveaway' ? (!!d.custom || !!d.giftConfig) : !!SHOP_KINDS[r.kind]?.code) && !d.revealed && r.status !== 'pending',
      canGift: !!it?.giftable && r.status === 'delivered' && (!d.revealed || !!it?.giftable),
      expired: !!(r.expiresAt && new Date(r.expiresAt).getTime() < Date.now()),
    };
  });
}

/** Land a giveaway win in a member's inventory: a sealed EconomyPurchase they reveal to get the
 *  promo code (from the gift config) or the custom content the creator typed. Idempotent per
 *  (giveaway, user) so a re-draw or a double-call cannot hand out the same prize twice. */
export async function deliverGiveawayPrize(p, { userId, giveaway, via = 'site' }) {
  // A `none` prize (a member's own /giveaway — the host hands it over on Discord) has nothing
  // to put in the inventory.
  let delivery = null;
  if (giveaway.prizeKind === 'custom' && giveaway.prizeContent) delivery = { custom: true, content: giveaway.prizeContent, name: giveaway.prize, revealed: false };
  else if (giveaway.prizeKind === 'promo' && giveaway.giftConfig) delivery = { giftConfig: giveaway.giftConfig, revealed: false };
  if (!delivery) return null;
  const itemId = `gw:${giveaway.id}`;
  const existing = await p.economyPurchase.findFirst({ where: { userId, itemId } });
  if (existing) return existing;
  return p.economyPurchase.create({ data: {
    userId, itemId, itemName: giveaway.prize, kind: 'giveaway', cost: 0, via, status: 'delivered', delivery,
  } });
}

/** Draw the SITE giveaways that are due — the bot draws the Discord ones, but a site-only
 *  giveaway has no bot to pick winners, so the sweeper does it: shuffle `siteEntrants`, take N,
 *  end it, land each win in the winner's inventory, and notify their dashboard. */
export async function drawDueSiteGiveaways(p, log = null) {
  const due = await p.giveaway.findMany({ where: { status: 'active', audience: 'site', endsAt: { lte: new Date() } }, take: 50 });
  let drawn = 0;
  for (const gw of due) {
    const pool = [...new Set(gw.siteEntrants || [])];
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const winners = pool.slice(0, Math.min(gw.winnersCount, pool.length));
    // Taken, not overwritten (lib/giveaway-reward.mjs): a second sweeper tick or a second API
    // replica that reaches the same giveaway gets count 0 and delivers nothing. Imported lazily:
    // that module imports movePoints from this one.
    const { claimDraw, rewardOf, awardEconomyReward } = await import('./giveaway-reward.mjs');
    if (!(await claimDraw(p, gw.id, winners))) continue;
    const eco = rewardOf(gw) ? ((await p.adminSetting.findUnique({ where: { key: 'bot.config' } }).catch(() => null))?.value?.economy || {}) : null;
    for (const uid of winners) {
      if (eco) await awardEconomyReward(p, eco, { giveaway: gw, userId: uid }).catch(() => {});
      await deliverGiveawayPrize(p, { userId: uid, giveaway: gw, via: 'site' }).catch(() => {});
      if (eco) await notify(p, uid, 'giveaway_win', `You won “${gw.prize}” — it has been added to your balance.`, { bodyFr: `Tu as gagné « ${gw.prize} » — c’est ajouté à ton solde.`, href: '/dashboard?s=economy' }).catch(() => {});
      else await notify(p, uid, 'giveaway_win', `You won “${gw.prize}” — it’s in your inventory; reveal it to claim.`, { bodyFr: `Tu as gagné « ${gw.prize} » — c’est dans ton inventaire ; révèle-le pour le récupérer.`, href: '/dashboard?s=economy' }).catch(() => {});
    }
    drawn += 1;
    if (log) log.info?.(`[sweeper] site giveaway ${gw.id} drawn: ${winners.length} winner(s)`);
  }
  return drawn;
}

/** A member's point movements, newest first. */
export async function listLedger(p, userId, { kind = null, take = 100 } = {}) {
  const rows = await p.economyLedger.findMany({ where: { userId, ...(kind ? { kind } : {}) }, orderBy: { createdAt: 'desc' }, take });
  return rows.map((r) => ({ id: r.id, kind: r.kind, delta: r.delta, balance: r.balance, ref: r.ref, meta: r.meta || null, createdAt: r.createdAt }));
}

/**
 * Retention for the point ledger: forget rows older than `economy.historyDays` AND, beyond
 * that, rows past `economy.historyMax` (newest kept). Either is 0 = no limit of that kind;
 * both off means the ledger is kept for ever, which is the old behaviour and still allowed.
 *
 * The two limits exist because they fail differently: an age limit alone lets a busy month
 * put a million rows in the table and keeps every one of them for 180 days, and a row cap
 * alone keeps a quiet server's history from 2019 for ever. The cap is a global newest-N over
 * the table, not per member — the thing being bounded is the TABLE.
 *
 * It never touches UserEconomy: a balance is a column on that row, not a sum of the ledger,
 * so forgetting history cannot move anyone's points. That is the property the tests pin.
 *
 * Returns { aged, capped, total } — counts, for the sweeper's log line.
 */
export async function sweepEconomyHistory(p, eco, now = Date.now()) {
  const days = num(eco?.historyDays, 180);
  const max = Math.max(0, Math.round(num(eco?.historyMax, 0)));
  let aged = 0, capped = 0;
  if (days > 0) {
    aged = (await p.economyLedger.deleteMany({ where: { createdAt: { lt: new Date(now - days * 864e5) } } })).count || 0;
  }
  if (max > 0) {
    // Find the boundary row (the max-th newest) and delete everything older, rather than
    // reading ids for what may be hundreds of thousands of rows. Ties on createdAt are broken
    // by id so the boundary is a single, stable row.
    const edge = await p.economyLedger.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: max - 1, take: 1, select: { createdAt: true, id: true } });
    if (edge.length) {
      const { createdAt, id } = edge[0];
      capped = (await p.economyLedger.deleteMany({ where: { OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }] } })).count || 0;
    }
  }
  return { aged, capped, total: aged + capped };
}

/**
 * An admin emptying the point history on purpose. Same guarantee as the sweep: ledger rows
 * only, never a balance. `olderThanDays` keeps the recent tail; `userId` limits it to one
 * member. Returns the number of rows removed. The CALLER writes the audit entry (it has the
 * acting user); there is no path to this function that should skip it.
 */
export async function clearEconomyHistory(p, { olderThanDays = 0, userId = null } = {}, now = Date.now()) {
  const days = Math.max(0, Math.round(num(olderThanDays, 0)));
  const where = {
    ...(days > 0 ? { createdAt: { lt: new Date(now - days * 864e5) } } : {}),
    ...(userId ? { userId: String(userId) } : {}),
  };
  const r = await p.economyLedger.deleteMany({ where });
  return r.count || 0;
}

/** Resolve "who": a user id, a BC id, an e-mail, or an exact display name. */
export async function resolveUser(p, q, { looksLikeBcId, findUserIdByBcId } = {}) {
  const s = String(q || '').trim();
  if (!s) return null;
  const sel = { id: true, displayName: true, closedAt: true };
  let u = await p.user.findUnique({ where: { id: s }, select: sel }).catch(() => null);
  if (!u && looksLikeBcId?.(s)) { const id = await findUserIdByBcId(p, s).catch(() => null); if (id) u = await p.user.findUnique({ where: { id }, select: sel }); }
  if (!u && s.includes('@')) u = await p.user.findFirst({ where: { email: ciEquals(s) }, select: sel });
  if (!u) u = await p.user.findFirst({ where: { displayName: ciEquals(s) }, select: sel });
  return u && !u.closedAt ? u : null;
}
