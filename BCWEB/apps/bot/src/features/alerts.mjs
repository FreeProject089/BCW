// Server-perf alerts (CPU/RAM/disk/service-down — see the API's monitor.mjs): posts
// each fired ServerAlertLog into the configured channel. Same polling shape as
// blog.mjs's pollBlog — announced ids are tracked SERVER-side so a bot restart
// never re-announces old alerts.
import { EmbedBuilder } from 'discord.js';
import { config } from '../config.mjs';
import { api } from '../api.mjs';

const KIND_COLOR = { cpu: 0xf59e0b, mem: 0xf59e0b, disk: 0xf59e0b, service_down: 0xef4444 };
const KIND_LABEL = { cpu: 'CPU', mem: 'Memory', disk: 'Disk', service_down: 'Service down' };

let _running = false;
export async function pollAlerts(client) {
    if (_running) return;
    _running = true;
    try {
        const cfg = await config();
        const a = cfg.alerts || {};
        if (!cfg.enabled || !a.enabled || !a.channelId) return;
        const channel = client.channels.cache.get(a.channelId);
        if (!channel?.send) return;

        const alerts = await api.alertsUnannounced();
        if (!alerts.length) return;
        const done = [];
        for (const alert of alerts) {
            try {
                const embed = new EmbedBuilder()
                    .setColor(KIND_COLOR[alert.kind] || 0xf59e0b)
                    .setTitle(`⚠️ ${KIND_LABEL[alert.kind] || alert.kind}`)
                    .setDescription(alert.message)
                    .setTimestamp(new Date(alert.createdAt));
                await channel.send({ embeds: [embed] });
                done.push(alert.id);
            } catch (e) {
                console.warn('[bot] alert announce failed', e.message);
                break;
            }
        }
        if (done.length) await api.alertsMarkAnnounced(done);
    } finally { _running = false; }
}
