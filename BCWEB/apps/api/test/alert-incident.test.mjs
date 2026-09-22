// The alerts channel spam, as a unit test: a condition that stays true for an hour is ONE
// incident — one row, one Discord message edited in place, one "resolved" when it clears.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { planAlert, alertFingerprint, pendingAlertUpdates, prunePosts, REOPEN_WINDOW_MS, EVENT_DEBOUNCE_MS } from '../src/lib/alert-incident.mjs';

const T0 = Date.UTC(2026, 8, 22, 10, 0, 0);
const TICK = 10 * 60_000;

// A tiny in-memory ServerAlertLog that applies planAlert the way monitor.mjs's maybeAlert does.
function table() {
    const rows = [];
    let n = 0;
    const raise = (alert, now) => {
        const open = alert.key ? rows.filter((r) => r.key === alert.key && !r.resolvedAt).at(-1) : null;
        const lastResolved = alert.key ? rows.filter((r) => r.key === alert.key && r.resolvedAt).sort((a, b) => a.resolvedAt - b.resolvedAt).at(-1) : null;
        const lastSame = !alert.key ? rows.filter((r) => r.kind === alert.kind && r.message === alert.message).at(-1) : null;
        const plan = planAlert(alert, { open, lastResolved, lastSame }, now);
        if (plan.op === 'create') { const r = { id: `a${++n}`, ...alert, createdAt: new Date(now), resolvedAt: null }; rows.push(r); return { plan, row: r }; }
        if (plan.op === 'update' || plan.op === 'reopen') { const r = rows.find((x) => x.id === plan.id); Object.assign(r, plan.data); return { plan, row: r }; }
        return { plan, row: null };
    };
    const resolve = (key, now) => rows.filter((r) => r.key === key && !r.resolvedAt).forEach((r) => { r.resolvedAt = new Date(now); });
    return { rows, raise, resolve };
}

// What maybeAlert did before: debounce on kind + exact message for 30 min.
function legacyRows(messages) {
    const rows = [];
    messages.forEach((message, i) => {
        const now = T0 + i * TICK;
        const recent = rows.filter((r) => r.message === message).at(-1);
        if (recent && now - recent.at < 30 * 60_000) return;
        rows.push({ message, at: now });
    });
    return rows;
}

describe('one incident per condition', () => {
    const cpu = [91, 93, 92, 95, 94, 96].map((v) => `CPU usage at ${v}% (>90%).`);

    test('the bug, measured: the old rule wrote a row (= a Discord post) for every tick', () => {
        assert.equal(legacyRows(cpu).length, 6);
    });

    test('a condition true for six ticks is one row, updated with the latest figure', () => {
        const t = table();
        const fired = cpu.map((message, i) => t.raise({ kind: 'cpu', key: 'cpu', message, severity: 'warning' }, T0 + i * TICK)).filter((x) => x.plan.fired);
        assert.equal(t.rows.length, 1);
        assert.equal(fired.length, 1, 'people are told once');
        assert.equal(t.rows[0].message, 'CPU usage at 96% (>90%).');
    });

    test('the same text again changes nothing (no write, no Discord edit)', () => {
        const t = table();
        t.raise({ kind: 'disk', key: 'disk', message: 'Disk usage at 95% (>90%).', severity: 'critical' }, T0);
        const again = t.raise({ kind: 'disk', key: 'disk', message: 'Disk usage at 95% (>90%).', severity: 'critical' }, T0 + TICK);
        assert.equal(again.plan.op, 'skip');
    });

    test('severity only ever goes up, and going up is worth telling people about', () => {
        const t = table();
        t.raise({ kind: 'errors', key: 'errors:server', message: '12 errors', severity: 'warning' }, T0);
        const up = t.raise({ kind: 'errors', key: 'errors:server', message: '40 errors', severity: 'critical' }, T0 + TICK);
        assert.equal(up.plan.op, 'update');
        assert.equal(up.plan.fired, true);
        const down = t.raise({ kind: 'errors', key: 'errors:server', message: '15 errors', severity: 'warning' }, T0 + 2 * TICK);
        assert.equal(down.plan.fired, false);
        assert.equal(t.rows[0].severity, 'critical');
    });

    test('a flap inside the window re-opens the same incident; after it, a new one', () => {
        const t = table();
        t.raise({ kind: 'service_down', key: 'service_down:db', message: 'Database is unreachable.' }, T0);
        t.resolve('service_down:db', T0 + TICK);
        const flap = t.raise({ kind: 'service_down', key: 'service_down:db', message: 'Database is unreachable.' }, T0 + 2 * TICK);
        assert.equal(flap.plan.op, 'reopen');
        assert.equal(flap.plan.fired, false);
        assert.equal(t.rows.length, 1);
        assert.equal(t.rows[0].resolvedAt, null);
        t.resolve('service_down:db', T0 + 3 * TICK);
        const later = t.raise({ kind: 'service_down', key: 'service_down:db', message: 'Database is unreachable.' }, T0 + 3 * TICK + REOPEN_WINDOW_MS + 1);
        assert.equal(later.plan.op, 'create');
        assert.equal(t.rows.length, 2);
    });

    test('two conditions of the same kind stay two incidents', () => {
        const t = table();
        t.raise({ kind: 'service_down', key: 'service_down:db', message: 'Database is unreachable.' }, T0);
        t.raise({ kind: 'service_down', key: 'service_down:storage', message: 'Object storage is unreachable.' }, T0);
        assert.equal(t.rows.length, 2);
    });

    test('a keyless EVENT keeps the exact-message debounce', () => {
        const t = table();
        const e = { kind: 'errors', severity: 'info', message: 'New server error: boom' };
        t.raise(e, T0);
        assert.equal(t.raise(e, T0 + TICK).plan.op, 'skip');
        assert.equal(t.raise({ ...e, message: 'New server error: other' }, T0 + TICK).plan.op, 'create');
        assert.equal(t.raise(e, T0 + EVENT_DEBOUNCE_MS + 1).plan.op, 'create');
    });
});

describe('what the bot edits', () => {
    const row = { id: 'a1', message: 'CPU at 91%', severity: 'warning', resolvedAt: null };
    test('the fingerprint moves with the text, the severity and the resolution — nothing else', () => {
        const fp = alertFingerprint(row);
        assert.equal(alertFingerprint({ ...row, createdAt: new Date() }), fp);
        assert.notEqual(alertFingerprint({ ...row, message: 'CPU at 95%' }), fp);
        assert.notEqual(alertFingerprint({ ...row, severity: 'critical' }), fp);
        assert.notEqual(alertFingerprint({ ...row, resolvedAt: new Date(T0) }), fp);
    });
    test('only posted rows whose fingerprint changed are updates', () => {
        const posts = { a1: { channelId: 'c', messageId: 'm1', fp: alertFingerprint(row) }, a2: { channelId: 'c', messageId: 'm2', fp: 'old' } };
        const rows = [row, { id: 'a2', message: 'x', severity: 'warning', resolvedAt: new Date(T0) }, { id: 'a3', message: 'never posted' }];
        const u = pendingAlertUpdates(rows, posts);
        assert.deepEqual(u.map((r) => r.id), ['a2']);
        assert.equal(u[0].post.messageId, 'm2');
    });
    test('the post map forgets settled incidents after a week and stays bounded', () => {
        const now = T0 + 10 * 864e5;
        const posts = { open: { at: T0 }, fresh: { at: now }, old: { at: T0 }, gone: { at: T0 } };
        const rows = { open: { resolvedAt: null }, fresh: { resolvedAt: new Date(now - 864e5) }, old: { resolvedAt: new Date(T0) } };
        assert.deepEqual(Object.keys(prunePosts(posts, rows, now)).sort(), ['fresh', 'open']);
        const many = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`k${i}`, { at: i }]));
        const manyRows = Object.fromEntries(Object.keys(many).map((k) => [k, { resolvedAt: null }]));
        assert.equal(Object.keys(prunePosts(many, manyRows, now)).length, 300);
    });
});
