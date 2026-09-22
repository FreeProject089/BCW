// The web giveaway form's economy prize preview (apps/web/src/lib/giveaway-prize.js), against the API's own wording and bounds
// (apps/api/src/lib/giveaway-reward.mjs). The API names an unnamed economy prize with
// rewardLabel(); the form shows the same text as a placeholder, so they must agree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normReward, rewardText } from '../../web/src/lib/giveaway-prize.js';
import { normEconomyReward, rewardLabel } from '../src/lib/giveaway-reward.mjs';

const CASES = [null, {}, { points: 0, xp: 0 }, { points: 500 }, { xp: 200 }, { points: 1500, xp: 250 }, { points: '12.7', xp: -3 }, { points: 9e9, xp: 9e12 }];

test('same reward, same words as the API', () => {
  for (const c of CASES) {
    assert.deepEqual(normReward(c), normEconomyReward(c), JSON.stringify(c));
    assert.equal(rewardText(c, 'coins'), rewardLabel(normEconomyReward(c), 'coins'), JSON.stringify(c));
  }
  assert.equal(rewardText({ points: 1500, xp: 250 }, 'coins'), '1,500 coins + 250 XP');
  assert.equal(rewardText({ points: 0, xp: 0 }, 'coins'), '', 'a prize of nothing has no name');
});
