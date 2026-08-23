// What counts as "the server is running out", exercised against the real function.
//
// The numbers below are a real 100 GB VPS, because the case that matters most is the one the
// shipped default puts every install in: `hosting.totalCapacityGB` is 500, and on a smaller
// machine that is not a rounding error but four hundred gigabytes the platform believes it
// can sell. Nothing else catches it — the ordinary capacity check compares allocation to that
// same declared number, so it stays quiet right up until a write fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { capacityVerdict } from '../src/lib/monitor.mjs';

const T = { capacityPct: 85, capacityFreeGB: 10, telemetryPct: 85, telemetryFreeGB: 1 };
const kinds = (cap) => capacityVerdict(cap, T).map((a) => a.kind).sort();

test('a declared capacity larger than the disk is caught while the server is still empty', () => {
  // 500 GB declared minus 50 reserved, on a 100 GB volume with nothing sold yet.
  assert.deepEqual(kinds({ usableGB: 450, allocatedGB: 0, diskTotalGB: 100, diskFreeGB: 75 }),
    ['capacity_oversold']);
});

test('a capacity the disk can back is silent', () => {
  assert.deepEqual(kinds({ usableGB: 55, allocatedGB: 0, diskTotalGB: 100, diskFreeGB: 75 }), []);
});

test('allocation approaching the declared ceiling fires', () => {
  assert.deepEqual(kinds({ usableGB: 55, allocatedGB: 50, diskTotalGB: 100, diskFreeGB: 25 }),
    ['capacity']);
});

test('the unsold remainder no longer fitting on disk fires, even with little sold', () => {
  // Honest on paper, and still wrong: something outside hosting grew into the volume.
  assert.deepEqual(kinds({ usableGB: 55, allocatedGB: 5, diskTotalGB: 100, diskFreeGB: 8 }),
    ['capacity_oversold']);
});

test('telemetry nearing its allocation fires on the percentage', () => {
  assert.deepEqual(kinds({ usableGB: 55, allocatedGB: 5, diskTotalGB: 100, diskFreeGB: 60, telemetryLimitGB: 2, telemetryUsedGB: 1.8 }),
    ['telemetry_storage']);
});

test('telemetry with a gigabyte left fires on the absolute floor, not the percentage', () => {
  // 200 GB allocated, 199.5 used → 99.75%, but the point is the 0.5 GB. On a large
  // allocation the percentage would still read comfortable at a floor that is not.
  assert.deepEqual(kinds({ usableGB: 5000, allocatedGB: 5, diskTotalGB: 6000, diskFreeGB: 5000, telemetryLimitGB: 200, telemetryUsedGB: 199.5 }),
    ['telemetry_storage']);
});

test('a telemetry limit of zero means "not allocated", not "100% full"', () => {
  // A percentage of zero would divide by zero and fire on every tick, forever.
  assert.deepEqual(kinds({ usableGB: 55, allocatedGB: 5, diskTotalGB: 100, diskFreeGB: 60, telemetryLimitGB: 0, telemetryUsedGB: 0 }), []);
});

test('a healthy server says nothing at all', () => {
  assert.deepEqual(kinds({ usableGB: 55, allocatedGB: 5, diskTotalGB: 100, diskFreeGB: 60, telemetryLimitGB: 2, telemetryUsedGB: 0.2 }), []);
});
