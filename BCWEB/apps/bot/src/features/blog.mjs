// Blog announcements: posts new PUBLISHED site blog posts (title + excerpt + link,
// cover as embed image) into the configured channel. Only runs when enabled from
// the admin dashboard (Discord bot tab → Blog announcements). Announced ids are
// tracked SERVER-side, so bot restarts/rebuilds never re-announce old posts.
import { EmbedBuilder } from 'discord.js';
import { config } from '../config.mjs';
import { api } from '../api.mjs';

let _running = false;

export async function pollBlog(client) {
    if (_running) return;           // a slow cycle must never overlap the next one
    _running = true;
    try {
        const cfg = await config();
        const b = cfg.blog || {};
        if (!cfg.enabled || !b.enabled || !b.channelId) return;
        const channel = client.channels.cache.get(b.channelId);
        if (!channel?.send) return;

        const posts = await api.blogUnannounced();
        if (!posts.length) return;
        const done = [];
        for (const post of posts) {
            try {
                const embed = new EmbedBuilder()
                    .setColor(0xf59e0b)
                    .setTitle(post.title.slice(0, 250))
                    .setURL(post.url)
                    .setDescription((post.excerpt || '').slice(0, 400) || null)
                    .setTimestamp(post.publishedAt ? new Date(post.publishedAt) : new Date())
                    .setFooter({ text: `${post.project?.name || 'BetterCommunity'} · ${post.author?.displayName || ''}`.trim() });
                if (post.cover && /^https?:\/\//i.test(post.cover)) embed.setImage(post.cover);
                await channel.send({ content: post.url, embeds: [embed] });
                done.push(post.id);
            } catch (e) {
                console.warn('[bot] blog announce failed for', post.slug, '-', e.message);
                break;              // channel/permission issue — retry next cycle
            }
        }
        if (done.length) {
            await api.blogMarkAnnounced(done);
            console.log(`[bot] announced ${done.length} blog post(s)`);
        }
    } finally { _running = false; }
}
