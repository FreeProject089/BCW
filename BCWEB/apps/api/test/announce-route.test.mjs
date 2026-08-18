// Where an announcement goes, and who gets pinged.
//
// The decision used to sit inside the bot's posting loop, three `||` in a line that also did
// the network — so the one part that can be WRONG (a commission landing in the incidents
// channel, a role pinged on a routine message) was the one part nothing could check without a
// live Discord server.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { routeFor } from '../../bot/src/features/announce-route.mjs';

const CFG = {
    alerts: { channelId: 'perf-1', generalChannelId: 'general-1' },
    announce: {
        channels: { myo: 'myo-1', incident: 'incident-1', event: '', promo: '', custom: '' },
        roles: { myo: 'role-myo', incident: 'role-incident', event: '', promo: '', custom: '' },
    },
};

describe('which channel', () => {
    test('the one configured for that kind', () => {
        assert.equal(routeFor(CFG, { kind: 'myo' }).channelId, 'myo-1');
        assert.equal(routeFor(CFG, { kind: 'incident' }).channelId, 'incident-1');
    });

    test('a kind with no channel falls back to general, not to another kind', () => {
        // The failure this guards: an event landing in the commissions channel because the
        // fallback walked the list of configured routes.
        const r = routeFor(CFG, { kind: 'event' });
        assert.equal(r.channelId, 'general-1');
        assert.equal(r.from, 'the general channel');
    });

    test('no general channel falls back to the alerts one', () => {
        const cfg = { ...CFG, alerts: { channelId: 'perf-1', generalChannelId: '' } };
        assert.equal(routeFor(cfg, { kind: 'event' }).channelId, 'perf-1');
    });

    test('a message that names its own channel wins over everything', () => {
        const r = routeFor(CFG, { kind: 'myo', channelId: 'one-off' });
        assert.equal(r.channelId, 'one-off');
        assert.equal(r.from, 'the message itself');
    });

    test('nothing configured anywhere is null, and says so', () => {
        // Null rather than an empty string: the caller reports "nothing is configured" instead
        // of trying to post to "" and reporting that the bot cannot see a channel.
        const r = routeFor({}, { kind: 'event' });
        assert.equal(r.channelId, null);
        assert.equal(r.from, 'nothing');
    });

    test('an empty string in the config is not a channel', () => {
        // The admin screen writes '' for a box somebody cleared.
        const cfg = { announce: { channels: { myo: '   ' } }, alerts: { generalChannelId: 'general-1' } };
        assert.equal(routeFor(cfg, { kind: 'myo' }).channelId, 'general-1');
    });
});

describe('who gets pinged', () => {
    test('nobody, on a routine announcement', () => {
        // Pinging on every message is how a role gets muted, and a muted role is worse than
        // no role because it looks like coverage.
        assert.equal(routeFor(CFG, { kind: 'myo' }).roleId, null);
    });

    test('the role for THAT kind, when it is urgent', () => {
        assert.equal(routeFor(CFG, { kind: 'myo', urgent: true }).roleId, 'role-myo');
        assert.equal(routeFor(CFG, { kind: 'incident', urgent: true }).roleId, 'role-incident');
    });

    test('urgent with no role for that kind pings nobody — never a different kind\'s role', () => {
        // An urgent event must not ping the commissions role because it is the only one set.
        assert.equal(routeFor(CFG, { kind: 'event', urgent: true }).roleId, null);
    });

    test('an urgent message to a one-off channel still uses its own kind\'s role', () => {
        const r = routeFor(CFG, { kind: 'incident', channelId: 'one-off', urgent: true });
        assert.equal(r.channelId, 'one-off');
        assert.equal(r.roleId, 'role-incident');
    });
});

describe('what it reports', () => {
    test('`from` names the rule, not the id', () => {
        // A failure has to read "the channel configured for myo", or somebody is left staring
        // at an 18-digit number wondering where it came from.
        assert.equal(routeFor(CFG, { kind: 'myo' }).from, 'the channel configured for myo');
    });
});
