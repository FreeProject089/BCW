// Server-perf alerts (CPU/RAM/disk/service-down — see the API's monitor.mjs): posts
// each fired ServerAlertLog into the configured channel. Same polling shape as
// blog.mjs's pollBlog — announced ids are tracked SERVER-side so a bot restart
// never re-announces old alerts.
import { EmbedBuilder } from 'discord.js';
import { config } from '../config.mjs';
import { api } from '../api.mjs';

const KIND_COLOR = {
    cpu: 0xf59e0b, mem: 0xf59e0b, disk: 0xf59e0b, web_vitals: 0xf59e0b, storage: 0xf59e0b,
    service_down: 0xef4444, errors: 0xef4444,
};
const KIND_LABEL = {
    cpu: 'CPU', mem: 'Memory', disk: 'Disk', web_vitals: 'Web Vitals', storage: 'Storage',
    service_down: 'Service down', errors: 'Errors',
};

// Which channel a kind belongs in. PERF is the machine and the site's own speed — the
// things you look at when asking "is it slow?". Everything else is an incident: something
// is down, or throwing. They are separated because they are read by different people at
// different times, and a storage warning buried under CPU noise is a storage warning
// nobody acts on.
//
// An unknown kind goes to GENERAL on purpose. A new alert type should be loud in the
// channel people watch, not silently dropped because nobody updated a table here.
const PERF_KINDS = new Set(['cpu', 'mem', 'disk', 'web_vitals', 'storage']);
const isPerf = (kind) => PERF_KINDS.has(kind);

let _running = false;
export async function pollAlerts(client) {
    if (_running) return;
    _running = true;
    try {
        const cfg = await config();
        const a = cfg.alerts || {};
        // `channelId` is the perf channel and keeps its name for compatibility with every
        // config already saved. `generalChannelId` is optional: unset, everything lands in
        // the perf channel exactly as it did before, so adding this changes nothing for an
        // install that does not configure it.
        if (!cfg.enabled || !a.enabled || !a.channelId) return;
        const perfChannel = client.channels.cache.get(a.channelId);
        const generalChannel = a.generalChannelId ? client.channels.cache.get(a.generalChannelId) : null;
        if (!perfChannel?.send) return;

        const alerts = await api.alertsUnannounced();
        if (!alerts.length) return;
        const done = [];
        for (const alert of alerts) {
            // Fall back to the perf channel rather than dropping the alert: a general
            // channel that is unset, deleted, or not in the cache must never mean silence.
            const target = (isPerf(alert.kind) ? perfChannel : (generalChannel?.send ? generalChannel : perfChannel));
            try {
                const embed = new EmbedBuilder()
                    .setColor(KIND_COLOR[alert.kind] || 0xf59e0b)
                    .setTitle(`⚠️ ${KIND_LABEL[alert.kind] || alert.kind}`)
                    .setDescription(alert.message)
                    .setTimestamp(new Date(alert.createdAt));
                await target.send({ embeds: [embed] });
                done.push(alert.id);
            } catch (e) {
                console.warn('[bot] alert announce failed', e.message);
                break;
            }
        }
        if (done.length) await api.alertsMarkAnnounced(done);
    } finally { _running = false; }
}
