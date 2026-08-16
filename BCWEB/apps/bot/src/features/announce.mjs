// Posting what the site asked to have said: an event, a promotion, a commission waiting, an
// incident.
//
// Same polling shape as every other bot feature, and the same rule as the moderation queue: the
// outcome is REPORTED. A channel that was deleted, or that the bot cannot write to, is a normal
// failure — and an announcement that silently never appeared is the worst version of this,
// because everybody assumes it went out.

import { api } from '../api.mjs';
import { config } from '../config.mjs';

const EVERY_MS = 20_000;

// A colour per kind, and a word. Colour alone is not a label — somebody reading on a phone in
// dark mode with 300 messages above needs the word.
const KIND = {
    event: { colour: 0x8b5cf6, label: 'Event' },
    promo: { colour: 0xf59e0b, label: 'Promotion' },
    myo: { colour: 0x0ea5e9, label: 'Commission request' },
    incident: { colour: 0xef4444, label: 'Incident' },
    custom: { colour: 0x64748b, label: 'Announcement' },
};

export function startAnnouncer(client) {
    let running = false;
    const tick = async () => {
        if (running) return;
        running = true;
        try {
            const { announcements } = await api.pendingAnnouncements();
            if (!announcements?.length) return;
            const cfg = await config();
            // The general channel is the fallback on purpose: a new kind of announcement should
            // be loud where people watch, not dropped because nobody configured a channel.
            const fallbackId = cfg.alerts?.generalChannelId || cfg.alerts?.channelId;
            // Per-kind routing. Commissions, incidents and the "something is waiting" digest go
            // to different people, and one channel carrying all three is one channel everybody
            // mutes. Unset falls back, so this is additive: a server that configures nothing
            // behaves exactly as it did.
            const routes = cfg.announce?.channels || {};
            const roles = cfg.announce?.roles || {};

            for (const a of announcements) {
                // An announcement that names its own channel keeps it — the admin screen can
                // still send one message somewhere specific.
                const channel = client.channels.cache.get(a.channelId || routes[a.kind] || fallbackId);
                if (!channel?.send) {
                    await api.announcementResult(a.id, false, 'No channel configured, or the bot cannot see it.');
                    continue;
                }
                const k = KIND[a.kind] || KIND.custom;
                const embed = {
                    color: a.urgent ? 0xdc2626 : k.colour,
                    // The urgency is in the title, not only in the colour.
                    title: `${a.urgent ? '⚠ URGENT · ' : ''}${k.label} — ${a.title}`.slice(0, 250),
                    ...(a.body ? { description: a.body.slice(0, 1500) } : {}),
                    ...(a.url ? { url: a.url } : {}),
                    timestamp: new Date(a.createdAt).toISOString(),
                };
                // A role is pinged only when the thing is URGENT, and only where one is
                // configured for that kind. Pinging on every message is how a role gets muted,
                // and a muted role is worse than none — it looks like coverage.
                const roleId = a.urgent ? roles[a.kind] : null;
                const content = roleId ? `<@&${roleId}>` : undefined;
                try {
                    await channel.send({
                        ...(content ? { content, allowedMentions: { roles: [roleId] } } : {}),
                        embeds: [embed],
                    });
                    await api.announcementResult(a.id, true);
                } catch (e) {
                    await api.announcementResult(a.id, false, String(e?.message || e).slice(0, 500));
                }
            }
        } finally { running = false; }
    };
    tick().catch(() => {});
    return setInterval(() => tick().catch(() => {}), EVERY_MS);
}
