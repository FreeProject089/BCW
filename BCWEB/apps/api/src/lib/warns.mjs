// Warnings, and what a count of them is worth.
//
// A warning does nothing by itself — that is the point of it. What makes the system work is
// that the Nth one stops being only a warning: three means a timeout, five means a kick, seven
// means a ban, or whatever the server decided. Written here as a pure function so the rule can
// be read, tested and argued with in one place instead of living inside a Discord handler.
//
// Two things this refuses to do, because both produce a moderation log nobody can defend:
//
//   · fire EVERY threshold that a count has passed. A member reaching five warnings gets the
//     five-warning action, not the three-warning one as well. Stacking them means a single
//     warning issues a timeout AND a kick AND a ban, in that order, and the last one wins by
//     accident.
//   · fire again on a count that is not new. Revoking a warning and re-issuing it must not
//     ban somebody who was already at the threshold before — the action belongs to the
//     warning that CROSSED the line, and to no other.

/** What a threshold may do. `warn` is the do-nothing case, kept so a rule can be written
 *  down and disabled without deleting it. */
export const WARN_ACTIONS = ['warn', 'timeout', 'kick', 'ban'];

/** The default ladder, used when a server has configured none. Deliberately mild: the point
 *  of a default is to be defensible everywhere, not to be right anywhere. */
export const DEFAULT_THRESHOLDS = [
    { count: 3, action: 'timeout', minutes: 60 },
    { count: 5, action: 'kick' },
    { count: 7, action: 'ban' },
];

/**
 * Read a configured ladder into something usable, dropping what cannot be honoured.
 *
 * Kept strict on purpose: a threshold with a count of zero would fire on every warning, and an
 * unknown action would be silently ignored at the point of use — which is the same as a rule
 * that exists in the admin screen and does nothing.
 */
export function normalizeThresholds(raw) {
    const list = Array.isArray(raw) ? raw : [];
    const clean = list
        .map((t) => ({
            count: Math.floor(Number(t?.count)),
            action: String(t?.action || '').toLowerCase(),
            minutes: t?.minutes == null ? null : Math.max(1, Math.floor(Number(t.minutes))),
        }))
        .filter((t) => Number.isFinite(t.count) && t.count >= 1 && WARN_ACTIONS.includes(t.action));
    // Highest first: the rule that matters is the most severe one this count has reached.
    return clean.sort((a, b) => b.count - a.count);
}

/**
 * What the warning that brought the total to `count` should trigger.
 *
 * Returns null when nothing does — which is most of the time, and is the normal case rather
 * than an error.
 */
export function actionFor(count, thresholds = DEFAULT_THRESHOLDS) {
    const n = Math.floor(Number(count));
    if (!Number.isFinite(n) || n < 1) return null;
    const ladder = normalizeThresholds(thresholds.length ? thresholds : DEFAULT_THRESHOLDS);
    // EXACT match, not ">=": the action belongs to the warning that crossed the line. With
    // ">=", every warning after the third would fire the timeout again, for ever.
    const hit = ladder.find((t) => t.count === n);
    if (!hit || hit.action === 'warn') return null;
    return {
        kind: hit.action,
        minutes: hit.action === 'timeout' ? (hit.minutes || 60) : (hit.minutes ?? null),
        at: n,
    };
}

/** The sentence a member is sent, in the words a person would use. `count` is theirs. */
export function warnMessage(count, reason, triggered) {
    const head = count === 1
        ? 'You have been warned.'
        : `You have been warned. That is ${count} warnings on your record.`;
    const why = reason ? ` Reason: ${reason}` : '';
    if (!triggered) return `${head}${why}`;
    const what = triggered.kind === 'timeout'
        ? `you have been timed out for ${triggered.minutes} minute(s)`
        : triggered.kind === 'kick' ? 'you have been removed from the server'
            : 'you have been banned';
    return `${head}${why} Because this is warning ${count}, ${what}.`;
}

/**
 * Record a warning and do whatever its count buys.
 *
 * Here rather than in a route because there are two doors — a moderator typing `/warn` in
 * Discord, and staff clicking in the admin screen — and a warning issued through one must be
 * the same fact as one issued through the other. Two copies of this would disagree about the
 * count the first time either changed.
 *
 * `issuedById` is null for a Discord moderator: they may have no BetterCommunity account at
 * all. The LABEL is what the record shows either way.
 */
export async function issueWarn(p, { discordId, reason, guildId = null, issuedById = null, issuedByLabel = '' }) {
    const [member, cfgRow] = await Promise.all([
        p.discordActivity.findUnique({ where: { discordId }, select: { username: true } }).catch(() => null),
        p.adminSetting.findUnique({ where: { key: 'bot.config' } }).catch(() => null),
    ]);
    const targetLabel = member?.username || discordId;

    // The count INCLUDING this one, and only warnings still standing: a revoked warning stays
    // in the record and must never push somebody over a line.
    const count = 1 + await p.botWarn.count({ where: { discordId, revokedAt: null } });
    const triggered = actionFor(count, cfgRow?.value?.moderation?.warnThresholds || []);

    const warn = await p.botWarn.create({
        data: {
            discordId, targetLabel, reason, guildId,
            issuedById, issuedByLabel: String(issuedByLabel).slice(0, 200),
            triggered: triggered ? `${triggered.kind}${triggered.minutes ? `:${triggered.minutes}` : ''}` : null,
        },
    });

    // Queued as an ordinary BotAction so it lands in the same list, with the same outcome
    // reporting: a ban Discord refuses because the bot's role sits too low must be as visible
    // here as anywhere else.
    let action = null;
    if (triggered) {
        action = await p.botAction.create({
            data: {
                kind: triggered.kind, discordId, minutes: triggered.minutes ?? null,
                reason: `Warning ${count}: ${reason}`.slice(0, 500),
                targetLabel,
                requestedById: issuedById,
                requestedByLabel: `${issuedByLabel || 'Discord moderator'} (automatic at ${count} warnings)`.slice(0, 200),
            },
        });
    }

    // Told why, and what it cost them — through the DM queue the admin screen already uses.
    // Wrapped: a DM that cannot be queued must not undo the warning.
    try {
        const row = await p.adminSetting.findUnique({ where: { key: 'bot.dmQueue' } });
        const items = [...(row?.value?.items || []), {
            id: `w${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
            discordId, message: warnMessage(count, reason, triggered).slice(0, 1900), at: Date.now(),
        }].slice(-200);
        await p.adminSetting.upsert({ where: { key: 'bot.dmQueue' }, create: { key: 'bot.dmQueue', value: { items } }, update: { value: { items } } });
    } catch { /* the warning stands either way */ }

    return { warn, count, triggered, action, targetLabel };
}
