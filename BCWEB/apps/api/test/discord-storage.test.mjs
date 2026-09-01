// B4 — per-guild member-storage admission. The safety property: a non-`pool` guild stores
// nothing (so a 1M-member guild the bot just joined writes zero rows), and a `pool` guild
// never exceeds its byte budget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memberCapacity, admitMembers, capacityStatus, BYTES_PER_MEMBER } from '../src/lib/discord-storage.mjs';

test('mode gate: only pool stores; none/moderation store nothing', () => {
  for (const mode of ['none', 'moderation', 'anything']) {
    const r = admitMembers(mode, 0, Infinity, 5000);
    assert.equal(r.store, false);
    assert.equal(r.reason, 'member_storage_off');
  }
  assert.equal(admitMembers('pool', 0, Infinity, 5000).store, true);
});

test('budget caps a pool guild and reports full when truncated', () => {
  const cap = memberCapacity(1000n * BigInt(BYTES_PER_MEMBER)); // room for exactly 1000
  assert.equal(cap, 1000);
  const fresh = admitMembers('pool', 0, cap, 400);
  assert.equal(fresh.admit, 400);
  assert.equal(fresh.full, false);
  const nearFull = admitMembers('pool', 900, cap, 400); // only 100 room left
  assert.equal(nearFull.admit, 100);
  assert.equal(nearFull.full, true);
  const atCap = admitMembers('pool', 1000, cap, 50);
  assert.equal(atCap.admit, 0);
  assert.equal(atCap.full, true);
});

test('quota 0 = unlimited for an opted-in pool guild', () => {
  assert.equal(memberCapacity(0), Infinity);
  const r = admitMembers('pool', 999999, Infinity, 5000);
  assert.equal(r.admit, 5000);
  assert.equal(r.full, false);
});

test('capacityStatus flags near-full and full', () => {
  const q = 1000n * BigInt(BYTES_PER_MEMBER);
  assert.equal(capacityStatus(q, 0).pct, 0);
  assert.equal(capacityStatus(q, 900).near, true);   // 90%
  assert.equal(capacityStatus(q, 1000).full, true);
  assert.equal(capacityStatus(0, 5000).unlimited, true);
});
