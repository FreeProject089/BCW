// Where an announcement goes, and who gets pinged.
//
// Pulled out of the posting loop so it can be tested without a Discord connection. The
// decision is three lines of `||` and it was written inside a try block that also does the
// network — which meant the one part that can be WRONG (a commission landing in the incidents
// channel, a role pinged on a routine message) was the one part nothing could check.
//
// The rules, in order:
//
//   1. An announcement that names its own channel keeps it. The admin screen can still send
//      one message somewhere specific, and that must beat any configuration.
//   2. Otherwise the channel configured for its KIND. Commissions, incidents and the
//      "something is waiting" digest go to different people; one channel carrying all three
//      is one channel everybody mutes.
//   3. Otherwise the general channel, then the perf channel. A new kind of announcement
//      should be loud where people watch, not dropped because nobody configured it.
//
// A role is pinged ONLY when the announcement is urgent AND a role is configured for that
// kind. Pinging on every message is how a role gets muted, and a muted role is worse than no
// role because it looks like coverage.

/**
 * @param cfg  the bot config (announce.channels / announce.roles / alerts.*)
 * @param a    the announcement ({ kind, channelId?, urgent? })
 * @returns {{channelId: string|null, roleId: string|null, from: string}}
 *          `from` says WHICH rule decided, so a failure can be reported as
 *          "the channel configured for commissions" rather than as an id.
 */
export function routeFor(cfg = {}, a = {}) {
    const routes = cfg.announce?.channels || {};
    const roles = cfg.announce?.roles || {};
    const general = cfg.alerts?.generalChannelId || '';
    const perf = cfg.alerts?.channelId || '';

    const explicit = String(a.channelId || '').trim();
    const forKind = String(routes[a.kind] || '').trim();

    const channelId = explicit || forKind || general || perf || null;
    const from = explicit ? 'the message itself'
        : forKind ? `the channel configured for ${a.kind}`
            : general ? 'the general channel'
                : perf ? 'the alerts channel' : 'nothing';

    // Only for an urgent one, and only the role belonging to THIS kind — never the general
    // one, which would ping everybody about a commission.
    const roleId = a.urgent ? (String(roles[a.kind] || '').trim() || null) : null;

    return { channelId, roleId, from };
}
