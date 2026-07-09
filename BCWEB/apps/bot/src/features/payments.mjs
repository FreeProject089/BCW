// Stripe payment & refund announcements. Posts each new successful payment (from
// the API's Payment rows) into the configured channel, and each refund (from the
// Stripe webhook's charge.refunded → bot.refundEvents) into the refund channel
// (falls back to the payment channel). Same server-side announced-set polling as
// blog/kofi, so bot restarts never re-announce old activity.
import { EmbedBuilder } from 'discord.js';
import { config } from '../config.mjs';
import { api } from '../api.mjs';

let _running = false;

const money = (cents, ccy) => `${(Math.abs(cents || 0) / 100).toFixed(2)} ${(ccy || 'usd').toUpperCase()}`;
// Don't leak a full customer email into a Discord channel — mask the local part.
const maskEmail = (e) => { if (!e) return ''; const [u, d] = String(e).split('@'); return d ? `${u.slice(0, 1)}***@${d}` : '***'; };

export async function pollPayments(client) {
  if (_running) return;
  _running = true;
  try {
    const cfg = await config();
    const pay = cfg.payments || {};
    if (!cfg.enabled || !pay.enabled) return;
    // Merge the legacy single fields with the new arrays and de-dupe. Refunds fall
    // back to the payment channels when no dedicated refund channels are configured.
    const uniq = (arr) => [...new Set(arr.filter(Boolean))];
    const payChannelIds = uniq([...(pay.channelIds || []), pay.channelId]);
    const refundChannelIds = uniq([...(pay.refundChannelIds || []), pay.refundChannelId]);
    const refundTargets = refundChannelIds.length ? refundChannelIds : payChannelIds;
    if (!payChannelIds.length && !refundTargets.length) return;

    const { payments, refunds, test } = await api.paymentsUnannounced();

    // Admin "Send test message" → post a sample embed so channel/permissions can be
    // verified without a real payment. Fired before the early-return below.
    if (test) {
      const embed = new EmbedBuilder().setColor(0x16a34a).setTitle('🧪 Test — payments module')
        .setDescription('This is a **test message**. If you can read this, the bot can post payment & refund notifications to this channel. ✅')
        .setTimestamp(new Date());
      const targets = [...new Set([...payChannelIds, ...refundTargets])];
      let ok = false;
      for (const id of targets) { const ch = client.channels.cache.get(id) || await client.channels.fetch(id).catch(() => null); if (ch?.send) { try { await ch.send({ embeds: [embed] }); ok = true; } catch (e) { console.warn('[bot] test post to', id, 'failed', e.message); } } }
      console.log(`[bot] payments test message → ${ok ? `sent to ${targets.length} channel(s)` : 'NO channel reachable — check the channel id + bot permissions'}`);
    }

    if (!payments.length && !refunds.length) return;
    console.log(`[bot] payments: ${payments.length} new payment(s), ${refunds.length} new refund(s) to announce`);

    const marks = { paymentIds: [], refundIds: [] };

    // Fan a built embed out to every configured channel; returns true if it landed
    // in at least one (so we only mark announced when it was actually delivered).
    const sendToAll = async (ids, embed) => {
      let delivered = false;
      for (const id of ids) {
        // Fetch on cache miss so a freshly-configured salon still receives the post.
        const ch = client.channels.cache.get(id) || await client.channels.fetch(id).catch(() => null);
        if (!ch?.send) { console.warn('[bot] payments channel not found/inaccessible:', id); continue; }
        try { await ch.send({ embeds: [embed] }); delivered = true; }
        catch (e) { console.warn('[bot] payments announce to', id, 'failed', e.message); }
      }
      return delivered;
    };

    // Successful payments → green embed in every payment channel.
    if (payChannelIds.length) {
      for (const p of payments) {
        const embed = new EmbedBuilder()
          .setColor(0x16a34a)
          .setTitle('💳 New payment')
          .setDescription(`**${money(p.amountCents, p.currency)}** — ${p.description}`)
          .addFields({ name: 'Type', value: String(p.kind || '—'), inline: true }, ...(p.buyer ? [{ name: 'Customer', value: p.buyer, inline: true }] : []))
          .setTimestamp(p.createdAt ? new Date(p.createdAt) : new Date());
        if (await sendToAll(payChannelIds, embed)) marks.paymentIds.push(p.id);
      }
    }

    // Refunds → amber embed in every refund channel (or the payment channels).
    if (refundTargets.length) {
      for (const r of refunds) {
        const embed = new EmbedBuilder()
          .setColor(0xf59e0b)
          .setTitle('↩️ Refund issued')
          .setDescription(`**${money(r.amountCents, r.currency)}** refunded${r.email ? ` to ${maskEmail(r.email)}` : ''}.`)
          .setTimestamp(r.at ? new Date(r.at) : new Date());
        if (await sendToAll(refundTargets, embed)) marks.refundIds.push(r.id);
      }
    } else {
      // No usable refund channel — still mark them so they don't pile up forever.
      for (const r of refunds) marks.refundIds.push(r.id);
    }

    if (marks.paymentIds.length || marks.refundIds.length) {
      await api.paymentsMarkAnnounced(marks);
      console.log(`[bot] announced ${marks.paymentIds.length} payment(s), ${marks.refundIds.length} refund(s)`);
    }
  } finally { _running = false; }
}
