import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDailyStepsStore,
  normalizeDailySteps,
} from '../lib/daily-steps-store.js';

function memoryRedis() {
  const hashes = new Map();
  function hash(key) {
    if (!hashes.has(key)) hashes.set(key, {});
    return hashes.get(key);
  }
  return {
    async hgetall(key) { return { ...hash(key) }; },
    async hset(key, values) { Object.assign(hash(key), values); },
  };
}

test('daily steps are shared by profile and mark the 12,500 goal', async () => {
  const store = createDailyStepsStore(memoryRedis(), 'test:steps');
  await store.save({ profile: 'jordan', date: '2026-08-13', steps: 12499 });
  await store.save({ profile: 'kelsey', date: '2026-08-13', steps: 12500 });

  const result = await store.list();
  assert.equal(result.goal, 12500);
  assert.equal(result.profiles.jordan[0].met, false);
  assert.equal(result.profiles.kelsey[0].met, true);
});
test('daily steps overwrite the same person and date with the latest total', async () => {
  const store = createDailyStepsStore(memoryRedis(), 'test:steps');
  await store.save({ profile: 'jordan', date: '2026-08-13', steps: 4000 });
  await store.save({ profile: 'jordan', date: '2026-08-13', steps: 13000 });

  const result = await store.list();
  assert.equal(result.profiles.jordan.length, 1);
  assert.equal(result.profiles.jordan[0].steps, 13000);
  assert.equal(result.profiles.jordan[0].met, true);
});

test('daily steps reject malformed totals', () => {
  assert.throws(() => normalizeDailySteps({
    profile: 'jordan',
    date: '2026-08-13',
    steps: -1,
  }), /between 0 and 250000/);
});
