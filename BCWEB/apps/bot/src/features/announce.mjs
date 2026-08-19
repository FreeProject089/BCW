// Posting what the site asked to have said: an event, a promotion, a commission waiting, an
// incident.
//
// Same polling shape as every other bot feature, and the same rule as the moderation queue: the
// outcome is REPORTED. A channel that was deleted, or that the bot cannot write to, is a normal
// failure — and an announcement that silently never appeared is the worst version of this,
// because everybody assumes it went out.

import { api } from '../api.mjs';
import { config } from '../config.mjs';
import { routeFor } from './announce-route.mjs';

const EVERY_MS = 20_000;

// A colour per kind, and a word. Colour alone is not a label — somebody reading on a phone in
// dark mode with 300 messages above needs the word.
const KIND = {
    event: { colour: 0x8b5cf6, label: 'Event' },
    promo: { colour: 0xf59e0b, label: 'Promotion' },
    myo: { colour: 0x0ea5e9, label: 'Commission request' },
    incident: { colour: 0xef4444, label: 'Incident' },
    // Red, like an incident, because it carries the same kind of clock: the DSA expects
    // action without undue delay and the LCEN presumption of knowledge starts on arrival.
    legal: { colour: 0xdc2626, label: 'Legal notice' },
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
            for (const a of announcements) {
                // The decision lives in announce-route.mjs, where it can be tested without a
                // Discord connection — see the note there.
                const { channelId, roleId, from } = routeFor(cfg, a);
                if (!channelId) {
                    await api.announcementResult(a.id, false,
                        `No channel is configured for "${a.kind}", and there is no general or alerts channel to fall back to.`);
                    continue;
                }
                // The cache first, then a FETCH. A channel the bot has simply not seen since it
                // started is not a missing channel, and reporting it as one sent somebody
                // hunting for a configuration mistake that did not exist.
                let channel = client.channels.cache.get(channelId);
                if (!channel) {
                    channel = await client.channels.fetch(channelId).catch(() => null);
                }
                if (!channel?.send) {
                    // The two failures a person can act on are different sentences: an id that
                    // is wrong, and an id that is right but invisible to this bot.
                    await api.announcementResult(a.id, false,
                        `Cannot post to ${channelId} (from ${from}): the bot is not in that server, `
                        + 'cannot see the channel, or the id is not a text channel.');
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
