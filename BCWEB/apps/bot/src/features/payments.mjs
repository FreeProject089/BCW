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
    const payChannelId = pay.channelId;
    const refundChannelId = pay.refundChannelId || pay.channelId;
    if (!payChannelId && !refundChannelId) return;

    const { payments, refunds } = await api.paymentsUnannounced();
    if (!payments.length && !refunds.length) return;

    const marks = { paymentIds: [], refundIds: [] };

    // Successful payments → green embed in the payments channel.
    const payChannel = payChannelId ? client.channels.cache.get(payChannelId) : null;
    if (payChannel?.send) {
      for (const p of payments) {
        try {
          const embed = new EmbedBuilder()
            .setColor(0x16a34a)
            .setTitle('💳 New payment')
            .setDescription(`**${money(p.amountCents, p.currency)}** — ${p.description}`)
            .addFields({ name: 'Type', value: String(p.kind || '—'), inline: true }, ...(p.buyer ? [{ name: 'Customer', value: p.buyer, inline: true }] : []))
            .setTimestamp(p.createdAt ? new Date(p.createdAt) : new Date());
          await payChannel.send({ embeds: [embed] });
          marks.paymentIds.push(p.id);
        } catch (e) { console.warn('[bot] payment announce failed', e.message); break; }
      }
    }

    // Refunds → amber embed in the refund channel (or payments channel).
    const refundChannel = refundChannelId ? client.channels.cache.get(refundChannelId) : null;
    if (refundChannel?.send) {
      for (const r of refunds) {
        try {
          const embed = new EmbedBuilder()
            .setColor(0xf59e0b)
            .setTitle('↩️ Refund issued')
            .setDescription(`**${money(r.amountCents, r.currency)}** refunded${r.email ? ` to ${maskEmail(r.email)}` : ''}.`)
            .setTimestamp(r.at ? new Date(r.at) : new Date());
          await refundChannel.send({ embeds: [embed] });
          marks.refundIds.push(r.id);
        } catch (e) { console.warn('[bot] refund announce failed', e.message); break; }
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
