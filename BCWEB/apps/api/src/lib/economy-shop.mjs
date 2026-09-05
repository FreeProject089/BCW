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
import { logAudit, notify } from './lib.mjs';
import { emitWebhook } from './webhooks.mjs';

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
  };
}

/** The shop items a member may see: named, active, still listed, with a badge that exists. */
export function visibleShopItems(eco) {
  const now = Date.now();
  return (Array.isArray(eco?.shop) ? eco.shop : []).map(normItem)
    .filter((x) => x && x.name && x.active && !(x.kind === 'badge' && !x.ref) && !(x.availableUntil && new Date(x.availableUntil).getTime() < now));
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

/** Move `delta` points on a balance and record it. Never below zero. Returns the new balance. */
export async function movePoints(p, userId, delta, entry) {
  const cur = await p.userEconomy.findUnique({ where: { userId }, select: { points: true } });
  const next = Math.max(0, (cur?.points || 0) + delta);
  await p.userEconomy.upsert({ where: { userId }, create: { userId, points: next }, update: { points: next } });
  await ledger(p, { userId, delta: next - (cur?.points || 0), balance: next, ...entry });
  return next;
}

// What the buyer may see of a delivery: never the fixed code before it is revealed.
export function pubDelivery(d) {
  if (!d || typeof d !== 'object') return d || null;
  const { fixedCode, ...rest } = d;
  return rest;
}

/**
 * Buy one item for `userId`. Returns the same shape the bot always got:
 *   { ok:true, item, delivery, status, points, purchaseId }  or  { ok:false, error, points?, cost? }
 * `via` names the door ('discord' | 'site') — kept on the record, shown in the inventory.
 */
export async function buyShopItem(p, eco, { userId, itemId, via = 'site', log = null }) {
  if (!eco?.enabled) return { ok: false, error: 'economy_off' };
  const item = visibleShopItems(eco).find((i) => i.id === itemId);
  if (!item) return { ok: false, error: 'no_such_item' };
  const cur = await p.userEconomy.findUnique({ where: { userId } });
  const cost = item.cost;
  if ((cur?.points || 0) < cost) return { ok: false, error: 'insufficient', points: cur?.points || 0, cost };
  // Stock and exclusivity are checked against the purchase table, so both doors count.
  if (item.stock != null && (await soldCount(p, item.id)) >= item.stock) return { ok: false, error: 'sold_out' };
  if (item.exclusive && (await p.economyPurchase.count({ where: { itemId: item.id, userId, status: { not: 'refunded' } } })) > 0) return { ok: false, error: 'already_owned' };
  let delivery = { kind: item.kind };
  let status = SHOP_KINDS[item.kind].fulfil === 'site' ? 'delivered' : 'pending';
  // Fulfil what the API itself can grant BEFORE debiting, so a failed grant never charges the
  // member. A code is NOT minted here: the purchase holds a sealed envelope until "Reveal".
  try {
    if (item.kind === 'badge') {
      const badge = await p.badge.findUnique({ where: { id: item.ref }, select: { id: true, name: true, active: true } });
      if (!badge || !badge.active) return { ok: false, error: 'badge_unavailable' };
      if (await p.userBadge.findUnique({ where: { userId_badgeId: { userId, badgeId: badge.id } } })) return { ok: false, error: 'already_owned' };
      await p.userBadge.create({ data: { userId, badgeId: badge.id, grantedBy: 'system' } });
      delivery = { kind: 'badge', badge: badge.name, badgeId: badge.id, revealed: true };
      emitWebhook(p, userId, 'badge.earned', { id: badge.id, name: badge.name, via: 'shop' }).catch(() => {});
    } else if (SHOP_KINDS[item.kind].code) {
      delivery = { kind: item.kind, revealed: false, ...(item.kind === 'promo' && item.promo.mode === 'fixed' && item.promo.code ? { fixedCode: item.promo.code } : {}) };
    }
  } catch (e) {
    log?.warn?.({ err: e?.message }, 'economy buy fulfil failed');
    return { ok: false, error: 'fulfil_failed' };
  }
  const expiresAt = item.codeDays && SHOP_KINDS[item.kind].code ? null : null; // the clock starts at reveal
  const rec = await p.economyPurchase.create({ data: {
    userId, itemId: item.id, itemName: item.name, kind: item.kind, cost, via, status, delivery, expiresAt,
  } }).catch(() => null);
  const points = await movePoints(p, userId, -cost, { kind: 'purchase', ref: rec?.id || item.id, meta: { itemId: item.id, name: item.name, kind: item.kind, via } });
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
  if (!SHOP_KINDS[row.kind]?.code) return { ok: false, error: 'nothing_to_reveal' };
  const item = (Array.isArray(eco?.shop) ? eco.shop : []).map(normItem).find((x) => x && x.id === row.itemId);
  const codeDays = item?.codeDays || null;
  const expiresAt = codeDays ? new Date(Date.now() + codeDays * 864e5) : null;
  let code;
  if (row.kind === 'promo' && d.fixedCode) {
    code = d.fixedCode;
  } else {
    const promoKind = row.kind === 'pool' ? 'free_pool' : row.kind === 'boost' ? 'free_boost' : row.kind === 'hosting' ? 'free_hosting' : 'discount';
    code = ('SHOP' + Math.random().toString(36).slice(2, 8)).toUpperCase();
    for (let i = 0; i < 5 && (await p.promoCode.findUnique({ where: { code } })); i++) code = ('SHOP' + Math.random().toString(36).slice(2, 8)).toUpperCase();
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
  const fromBalance = await movePoints(p, fromUserId, -points, { kind: 'gift_out', ref: to.id, meta: { ...meta, toName: to.displayName } });
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
      canReveal: !!SHOP_KINDS[r.kind]?.code && !d.revealed && r.status !== 'pending',
      canGift: !!it?.giftable && r.status === 'delivered' && (!d.revealed || !!it?.giftable),
      expired: !!(r.expiresAt && new Date(r.expiresAt).getTime() < Date.now()),
    };
  });
}

/** A member's point movements, newest first. */
export async function listLedger(p, userId, { kind = null, take = 100 } = {}) {
  const rows = await p.economyLedger.findMany({ where: { userId, ...(kind ? { kind } : {}) }, orderBy: { createdAt: 'desc' }, take });
  return rows.map((r) => ({ id: r.id, kind: r.kind, delta: r.delta, balance: r.balance, ref: r.ref, meta: r.meta || null, createdAt: r.createdAt }));
}

/** Retention: forget ledger rows older than `economy.historyDays` (0 = keep forever). */
export async function sweepEconomyHistory(p, eco) {
  const days = num(eco?.historyDays, 180);
  if (!(days > 0)) return 0;
  const r = await p.economyLedger.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - days * 864e5) } } });
  return r.count || 0;
}

/** Resolve "who": a user id, a BC id, an e-mail, or an exact display name. */
export async function resolveUser(p, q, { looksLikeBcId, findUserIdByBcId } = {}) {
  const s = String(q || '').trim();
  if (!s) return null;
  const sel = { id: true, displayName: true, closedAt: true };
  let u = await p.user.findUnique({ where: { id: s }, select: sel }).catch(() => null);
  if (!u && looksLikeBcId?.(s)) { const id = await findUserIdByBcId(p, s).catch(() => null); if (id) u = await p.user.findUnique({ where: { id }, select: sel }); }
  if (!u && s.includes('@')) u = await p.user.findFirst({ where: { email: { equals: s, mode: 'insensitive' } }, select: sel });
  if (!u) u = await p.user.findFirst({ where: { displayName: { equals: s, mode: 'insensitive' } }, select: sel });
  return u && !u.closedAt ? u : null;
}
