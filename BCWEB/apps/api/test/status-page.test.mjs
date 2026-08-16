// Uptime arithmetic. Every case here produces a plausible-looking wrong percentage if it is
// mishandled, which is the worst kind of bug for a page whose entire job is to be trusted.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { dailyUptime, overallUptime, serviceState, overallState } from '../src/lib/status-page.mjs';

const at = (iso) => new Date(iso);
const NOW = at('2026-08-16T12:00:00Z');   // midday, so "today" is a half day

describe('dailyUptime', () => {
    test('no outages is a clean sheet', () => {
        const d = dailyUptime([], 3, NOW);
        assert.equal(d.length, 3);
        assert.deepEqual(d.map((x) => x.uptimePct), [100, 100, 100]);
    });

    test('an outage inside one day only counts against that day', () => {
        const d = dailyUptime([{ startedAt: at('2026-08-15T01:00:00Z'), endedAt: at('2026-08-15T03:00:00Z') }], 3, NOW);
        assert.equal(d[1].downMs, 2 * 3600e3);
        assert.equal(d[0].downMs, 0);
        assert.equal(d[2].downMs, 0);
        assert.ok(Math.abs(d[1].uptimePct - (100 * (1 - 2 / 24))) < 1e-9);
    });

    test('THE ONE: an outage across midnight is split, not counted twice', () => {
        // Counted whole against both days, this reports more downtime than the day is long.
        const d = dailyUptime([{ startedAt: at('2026-08-14T23:00:00Z'), endedAt: at('2026-08-15T02:00:00Z') }], 3, NOW);
        assert.equal(d[0].downMs, 1 * 3600e3, 'one hour on the 14th');
        assert.equal(d[1].downMs, 2 * 3600e3, 'two on the 15th');
    });

    test('an outage that is still open runs to now, not for ever', () => {
        const d = dailyUptime([{ startedAt: at('2026-08-16T10:00:00Z'), endedAt: null }], 1, NOW);
        assert.equal(d[0].downMs, 2 * 3600e3);
    });

    test('today is measured against how long today has BEEN', () => {
        // Against a full 24h, every current day would read worse than it is, all day, for ever.
        const d = dailyUptime([{ startedAt: at('2026-08-16T00:00:00Z'), endedAt: at('2026-08-16T06:00:00Z') }], 1, NOW);
        // Six hours down out of the twelve elapsed = 50%, not 75%.
        assert.equal(d[0].uptimePct, 50);
    });

    test('an outage starting before the window is clipped to it', () => {
        const d = dailyUptime([{ startedAt: at('2026-08-01T00:00:00Z'), endedAt: at('2026-08-15T06:00:00Z') }], 2, NOW);
        assert.equal(d[0].downMs, 6 * 3600e3, 'only the part inside the 15th');
    });

    test('overlapping outages cannot exceed the day', () => {
        // Two probes disagreeing is a real thing; 200% downtime is not.
        const d = dailyUptime([
            { startedAt: at('2026-08-15T00:00:00Z'), endedAt: at('2026-08-16T00:00:00Z') },
            { startedAt: at('2026-08-15T00:00:00Z'), endedAt: at('2026-08-16T00:00:00Z') },
        ], 2, NOW);
        assert.equal(d[0].downMs, 24 * 3600e3);
        assert.equal(d[0].uptimePct, 0);
    });

    test('the series has one entry per day, oldest first, with no gaps', () => {
        const d = dailyUptime([], 5, NOW);
        assert.equal(d.length, 5);
        for (let i = 1; i < d.length; i++) assert.equal(d[i].day - d[i - 1].day, 864e5);
    });
});

describe('overallUptime', () => {
    test('one bad day in ninety barely moves it', () => {
        const daily = dailyUptime([{ startedAt: at('2026-08-15T00:00:00Z'), endedAt: at('2026-08-15T12:00:00Z') }], 90, NOW);
        const pct = overallUptime(daily);
        assert.ok(pct > 99.4 && pct < 99.6, `got ${pct}`);
    });
});

describe('serviceState', () => {
    test('a probe that says "not applicable" is NOT down', () => {
        // Stripe with no key configured must not read as broken on a public page.
        assert.equal(serviceState(null, null), 'not_configured');
        assert.equal(serviceState(undefined, null), 'not_configured');
    });

    test('an open outage wins over a probe that just came good', () => {
        assert.equal(serviceState(true, { id: 'x' }), 'down');
    });

    test('the plain cases', () => {
        assert.equal(serviceState(true, null), 'operational');
        assert.equal(serviceState(false, null), 'down');
    });
});

describe('overallState', () => {
    test('unconfigured services do not drag the banner down', () => {
        assert.equal(overallState(['operational', 'not_configured']), 'operational');
    });
    test('some down is partial, all down is major', () => {
        assert.equal(overallState(['operational', 'down']), 'partial');
        assert.equal(overallState(['down', 'down']), 'major');
    });
    test('nothing configured at all is unknown, not fine', () => {
        assert.equal(overallState(['not_configured']), 'unknown');
        assert.equal(overallState([]), 'unknown');
    });
});
