// Moderation the admin asked for on the website, carried out here.
//
// The website cannot reach Discord, so it queues and this polls — the same shape as dm/pending,
// links/pending and kofi/unannounced. Nothing new is invented for this one.
//
// The result is REPORTED, always, including the failures. Discord refuses these constantly for
// reasons that are nobody's mistake — the bot's own role sitting below the target's is the
// usual one — and an admin watching a button go green while nothing happened is the outcome
// this whole queue exists to avoid.

import { api } from '../api.mjs';

const EVERY_MS = 20_000;
// Discord's own ceiling for a timeout. Asking for more is rejected outright rather than
// silently clamped, so nobody believes they set 40 days.
const MAX_TIMEOUT_MIN = 28 * 24 * 60;

/** Carry out one action, and say plainly what happened. */
async function run(guild, a) {
    const reason = `${a.reason || 'No reason given'} — by ${a.requestedByLabel || 'staff'} via the website`;

    if (a.kind === 'ban') {
        await guild.members.ban(a.discordId, { reason });
        return;
    }
    if (a.kind === 'unban') {
        await guild.bans.remove(a.discordId, reason);
        return;
    }

    // The rest need the member to be IN the guild. Fetching says so precisely instead of
    // failing later with something vaguer.
    const member = await guild.members.fetch(a.discordId).catch(() => null);
    if (!member) throw new Error('That member is not in the server.');

    if (a.kind === 'kick') { await member.kick(reason); return; }
    if (a.kind === 'role_add' || a.kind === 'role_remove') {
        if (!a.roleId) throw new Error('No role given.');
        const role = guild.roles.cache.get(a.roleId) || await guild.roles.fetch(a.roleId).catch(() => null);
        if (!role) throw new Error('That role no longer exists.');
        if (role.managed) throw new Error('That role belongs to an integration and cannot be handed out.');
        const top = guild.members.me?.roles?.highest?.position ?? 0;
        if (role.position >= top) throw new Error(`The bot's own role sits below "${role.name}" — move the bot's role above it in Server Settings → Roles.`);
        if (a.kind === 'role_add') await member.roles.add(role, reason); else await member.roles.remove(role, reason);
        return;
    }
    if (a.kind === 'untimeout') { await member.timeout(null, reason); return; }
    if (a.kind === 'timeout') {
        if (!a.minutes) throw new Error('No duration given.');
        if (a.minutes > MAX_TIMEOUT_MIN) throw new Error(`Discord allows at most 28 days; ${a.minutes} minutes was asked for.`);
        await member.timeout(a.minutes * 60_000, reason);
        return;
    }
    throw new Error(`Unknown action "${a.kind}".`);
}

export function startModQueue(client, guildId) {
    const tick = async () => {
        const { actions } = await api.pendingActions();
        if (!actions?.length) return;
        const guild = await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) {
            // Reported per action rather than swallowed: without this the queue would sit at
            // "pending" for ever and look like the bot was ignoring it.
            for (const a of actions) await api.actionResult(a.id, false, 'The bot is not in that server.');
            return;
        }
        for (const a of actions) {
            try {
                await run(guild, a);
                await api.actionResult(a.id, true);
            } catch (e) {
                // Discord's own words. They are specific ("Missing Permissions", "Unknown
                // Member") and far more use to a moderator than anything paraphrased.
                await api.actionResult(a.id, false, String(e?.message || e).slice(0, 500));
            }
        }
    };
    tick().catch(() => {});
    return setInterval(() => tick().catch(() => {}), EVERY_MS);
}
