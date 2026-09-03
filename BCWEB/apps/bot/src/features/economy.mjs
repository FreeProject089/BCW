// B-econ: activity tracking for the levelling / economy system. Buffers per-member messages,
// reactions and voice seconds, and flushes them to the API once a minute, where they become XP.
// The API only credits members whose Discord is linked to a BCWEB account, so unlinked activity
// is simply ignored server-side — the bot buffers everyone and lets the API decide.
import { api } from '../api.mjs';

const buf = new Map();        // discordId → { messages, reactions, voiceSeconds }
const voiceJoin = new Map();  // discordId → joinedAt (ms), while they are in a voice channel

function bump(id, field, n = 1) {
  if (!id) return;
  const e = buf.get(id) || { messages: 0, reactions: 0, voiceSeconds: 0 };
  e[field] += n;
  buf.set(id, e);
}

export function wireEconomy(client) {
  client.on('messageCreate', (m) => {
    try { if (m.author?.bot || !m.guildId) return; bump(m.author.id, 'messages'); } catch { /* never crash the gateway */ }
  });
  client.on('messageReactionAdd', (_reaction, user) => {
    try { if (!user || user.bot) return; bump(user.id, 'reactions'); } catch { /* */ }
  });
  client.on('voiceStateUpdate', (oldS, newS) => {
    try {
      const id = newS?.id || oldS?.id;
      const wasIn = !!oldS?.channelId, isIn = !!newS?.channelId;
      const isBot = (newS?.member || oldS?.member)?.user?.bot;
      if (isBot) return;
      if (!wasIn && isIn) { voiceJoin.set(id, Date.now()); }
      else if (wasIn && !isIn) {
        const t = voiceJoin.get(id);
        if (t) { bump(id, 'voiceSeconds', Math.floor((Date.now() - t) / 1000)); voiceJoin.delete(id); }
      }
      // A channel move keeps the same join time — they never left voice.
    } catch { /* */ }
  });
}

// Called on a timer. Credits any ongoing voice session so a long call is not lost on restart,
// then ships the buffer.
export async function flushEconomy() {
  const now = Date.now();
  for (const [id, t] of voiceJoin) {
    const secs = Math.floor((now - t) / 1000);
    if (secs >= 30) { bump(id, 'voiceSeconds', secs); voiceJoin.set(id, now); }
  }
  if (!buf.size) return;
  const events = [...buf.entries()].map(([discordId, e]) => ({ discordId, ...e }));
  buf.clear();
  await api.accrueEconomy(events);
}
