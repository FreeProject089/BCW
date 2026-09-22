// Server-perf alerts (CPU/RAM/disk/service-down/errors — see the API's monitor.mjs): ONE
// message per incident, edited in place, closed when it clears, linked to its admin page.
//
// It used to post every unannounced ServerAlertLog row as a new message. The API wrote a new
// row every monitor tick while a condition stayed true (the text carried the live figure, so
// its debounce never matched), and nothing was ever edited or closed — a day of high CPU was a
// day of messages, and the last one about a fixed problem still read as an emergency. The API
// now keeps one row per incident (lib/alert-incident.mjs); this poster:
//   · posts `fresh` rows — one message per incident, events of one kind grouped
//     (features/alerts-plan.mjs), at most MAX_NEW_MESSAGES_PER_POLL per poll;
//   · edits the message of every `updates` row (new figure, raised severity, resolved) and
//     replies once "Resolved … (after 42 min)" when it clears;
//   · reports what it drew (channel, message, fingerprint) back to the API, which stores it
//     server-side — a restart never re-posts, and never loses track of what to edit.
import { ButtonStyle } from 'discord.js';
import * as ui from '../ui.mjs';
import { config } from '../config.mjs';
import { api } from '../api.mjs';
import { makeT, localeOf } from '../i18n.mjs';
import { alertThread } from './logs.mjs';
import { groupFresh, incidentSpec, eventsSpec, resolvedNotice, isPerf, MAX_NEW_MESSAGES_PER_POLL } from './alerts-plan.mjs';

const cardOf = (t, spec) => ui.card({
  title: `${ui.icx(spec.icon)}${spec.title}`, color: spec.color, body: spec.body, footer: spec.footer || null,
  buttons: spec.url ? [ui.btn(spec.url, t('al.details'), ButtonStyle.Link, { emoji: 'site' })] : [],
});

async function fetchChannel(client, id) {
  if (!id) return null;
  return client.channels.cache.get(id) || await client.channels.fetch(id).catch(() => null);
}

let _running = false;
export async function pollAlerts(client) {
  if (_running) return;
  _running = true;
  try {
    const cfg = await config();
    const a = cfg.alerts || {};
    // `channelId` is the perf channel and keeps its name for compatibility with every config
    // already saved. `generalChannelId` is optional: unset, everything lands in the perf
    // channel. With an alerts FORUM configured every alert becomes a post there instead.
    if (!cfg.enabled || !a.enabled || (!a.channelId && !a.forumId)) return;
    const perfChannel = await fetchChannel(client, a.channelId);
    const generalChannel = await fetchChannel(client, a.generalChannelId);
    const t = makeT(localeOf({}, cfg), cfg.i18n);

    const pending = await api.alertsPending();
    if (!pending) return;
    const posts = [];

    // Where a kind goes. Fall back to the perf channel rather than dropping the alert: a
    // general channel that is unset, deleted, or not reachable must never mean silence.
    const targetFor = async (kind) => {
      const thread = await alertThread(isPerf(kind) ? 'perf' : 'incident');
      if (thread?.send) return thread;
      if (isPerf(kind)) return perfChannel?.send ? perfChannel : null;
      return generalChannel?.send ? generalChannel : (perfChannel?.send ? perfChannel : null);
    };

    // 1. New incidents / event groups.
    for (const g of groupFresh(pending.fresh).slice(0, MAX_NEW_MESSAGES_PER_POLL)) {
      try {
        const target = await targetFor(g.kind);
        if (!target) throw new Error('no alerts channel and no alerts forum');
        const spec = g.incident ? incidentSpec(t, g.alerts[0]) : eventsSpec(t, g);
        const msg = await target.send(cardOf(t, spec));
        // An incident already resolved when first posted (the bot was away) carries its
        // outcome in the card itself; no separate "resolved" reply is owed for it.
        for (const al of g.alerts) posts.push({ id: al.id, channelId: msg.channelId, messageId: msg.id, fp: al.fp, resolvedNotice: !!al.resolvedAt });
      } catch (e) {
        console.warn('[bot] alert post failed', e.message);
        break;
      }
    }

    // 2. Incidents that changed since they were drawn: edit the same message.
    for (const al of pending.updates || []) {
      const post = al.post || {};
      try {
        const ch = await fetchChannel(client, post.channelId);
        const msg = ch?.messages ? await ch.messages.fetch(post.messageId).catch(() => null) : null;
        // Only an INCIDENT's message is redrawn from its row: an event shares its message with
        // the others of its burst, and redrawing it as one card would erase them.
        if (msg && al.key) {
          await msg.edit(cardOf(t, incidentSpec(t, al)));
          if (al.resolvedAt && !post.resolvedNotice) {
            await ch.send({ ...ui.card({ title: null, color: 0x16a34a, body: `${ui.icx('done')}${resolvedNotice(t, al)}` }), reply: { messageReference: msg.id, failIfNotExists: false } }).catch(() => {});
          }
        }
        // A message somebody deleted is not re-posted: recording the fingerprint stops the
        // bot asking about it every poll, and the admin page still has the incident.
        // resolvedNotice follows the row: a flap re-opened inside the window is open again, and
        // owes a fresh "resolved" reply when it clears the second time.
        posts.push({ id: al.id, channelId: post.channelId, messageId: post.messageId, fp: al.fp, resolvedNotice: !!al.resolvedAt });
      } catch (e) { console.warn('[bot] alert edit failed', e.message); }
    }

    if (posts.length) await api.alertsPosted(posts);
  } finally { _running = false; }
}
