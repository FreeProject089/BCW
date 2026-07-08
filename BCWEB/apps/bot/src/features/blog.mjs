// Blog announcements (multi-route / multi-server): posts new PUBLISHED site blog
// posts (title + excerpt + link, cover as embed image) into every configured route.
// A route = { channelId, sources } where `sources` picks which blogs to include:
//   ['*']                     → every blog post
//   ['bmm','bsm', …]          → only those fixed-project blogs
//   ['showcase']              → every "Other projects" (showcase) blog
// A channel id is globally unique, so a route can target a channel in ANY server the
// bot is in. Dedup is tracked per channel SERVER-side, so restarts never re-announce
// and adding a new route never floods with the back-catalogue. Configured from the
// admin dashboard (Discord bot tab → Blog announcements).
import { EmbedBuilder } from 'discord.js';
import { config } from '../config.mjs';
import { api } from '../api.mjs';

let _running = false;

// Resolve the effective route list: the new `routes` array, or the legacy single
// `channelId` treated as one all-sources route (so old configs keep working).
function routesOf(b) {
  const routes = Array.isArray(b.routes) ? b.routes.filter((r) => r && r.channelId) : [];
  if (routes.length) return routes.map((r) => ({ channelId: String(r.channelId), sources: Array.isArray(r.sources) && r.sources.length ? r.sources : ['*'] }));
  if (b.channelId) return [{ channelId: String(b.channelId), sources: ['*'] }];
  return [];
}

const matchesSources = (sources, postSource) => sources.includes('*') || sources.includes(postSource);

export async function pollBlog(client) {
  if (_running) return;             // a slow cycle must never overlap the next one
  _running = true;
  try {
    const cfg = await config();
    const b = cfg.blog || {};
    if (!cfg.enabled || !b.enabled) return;
    const routes = routesOf(b);
    if (!routes.length) return;

    // Ask the API for recent posts + each channel's already-announced set (also
    // seeds brand-new channels server-side so they don't flood).
    const channelIds = [...new Set(routes.map((r) => r.channelId))];
    const { posts, announcedByChannel } = await api.blogSync(channelIds);
    if (!posts.length) return;

    const marks = {}; // channelId -> [postId…] announced this cycle
    for (const route of routes) {
      const channel = client.channels.cache.get(route.channelId);
      if (!channel?.send) continue;             // not a channel the bot can see/post to
      const seen = new Set(announcedByChannel[route.channelId] || []);
      const pending = posts.filter((post) => !seen.has(post.id) && matchesSources(route.sources, post.source));
      for (const post of pending) {
        try {
          const embed = new EmbedBuilder()
            .setColor(0xf59e0b)
            .setTitle(post.title.slice(0, 250))
            .setURL(post.url)
            .setDescription((post.excerpt || '').slice(0, 400) || null)
            .setTimestamp(post.publishedAt ? new Date(post.publishedAt) : new Date())
            .setFooter({ text: `${post.space?.name || 'BetterCommunity'} · ${post.author?.displayName || ''}`.trim() });
          if (post.cover && /^https?:\/\//i.test(post.cover)) embed.setImage(post.cover);
          await channel.send({ content: post.url, embeds: [embed] });
          (marks[route.channelId] ||= []).push(post.id);
        } catch (e) {
          console.warn('[bot] blog announce failed for', post.slug, 'in', route.channelId, '-', e.message);
          break;                                // channel/permission issue — retry next cycle
        }
      }
    }
    const markList = Object.entries(marks).map(([channelId, ids]) => ({ channelId, ids }));
    if (markList.length) {
      await api.blogMarkAnnounced(markList);
      const total = markList.reduce((n, m) => n + m.ids.length, 0);
      console.log(`[bot] announced ${total} blog post(s) across ${markList.length} channel(s)`);
    }
  } finally { _running = false; }
}
