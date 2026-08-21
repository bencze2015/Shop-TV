import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createWorkoutHistoryStore,
  normalizeWorkoutCompletion,
} from '../lib/workout-history-store.js';

function memoryRedis() {
  const hashes = new Map();
  function hash(key) {
    if (!hashes.has(key)) hashes.set(key, {});
    return hashes.get(key);
  }
  return {
    async hgetall(key) { return { ...hash(key) }; },
    async hget(key, field) { return hash(key)[field] || null; },
    async hset(key, values) { Object.assign(hash(key), values); },
    async hdel(key, field) { delete hash(key)[field]; },
  };
}

test('shared workout history stores both profiles and sorts newest first', async () => {
  const store = createWorkoutHistoryStore(memoryRedis(), 'test:history');
  await store.save({
    profile: 'kelsey',
    date: '2026-08-12',
    planName: 'Pull',
    completionSource: 'manual',
  });
  await store.save({
    profile: 'jordan',
    date: '2026-08-11',
    planName: 'Push',
    completionSource: 'sets',
  });
  await store.save({
    profile: 'jordan',
    date: '2026-08-12',
    planName: 'Pull',
    completionSource: 'manual',
  });

  const result = await store.list();
  assert.deepEqual(result.profiles.jordan.map((entry) => entry.date), [
    '2026-08-12',
    '2026-08-11',
  ]);
  assert.equal(result.profiles.kelsey[0].planName, 'Pull');
});

test('backfilled completions keep their distinct source and can be undone', async () => {
  const store = createWorkoutHistoryStore(memoryRedis(), 'test:history');
  const saved = await store.save({
    profile: 'jordan',
    date: '2026-08-10',
    planName: 'Legs',
    completionSource: 'backfill',
  });
  assert.equal(saved.completionSource, 'backfill', 'backfill is not silently downgraded to manual');

  let result = await store.list();
  assert.deepEqual(result.profiles.jordan.map((entry) => entry.date), ['2026-08-10']);

  await store.remove('jordan', '2026-08-10');
  result = await store.list();
  assert.deepEqual(result.profiles.jordan, []);
});

test('an unrecognized completion source is not silently accepted as backfill', () => {
  const entry = normalizeWorkoutCompletion({
    profile: 'jordan',
    date: '2026-08-10',
    planName: 'Legs',
    completionSource: 'not-a-real-source',
  }, new Date('2026-08-14T12:00:00-07:00'));
  assert.equal(entry.completionSource, 'manual');
});

test('future dates cannot be marked complete', () => {
  assert.throws(() => normalizeWorkoutCompletion({
    profile: 'jordan',
    date: '2026-08-14',
    planName: 'Legs',
  }, new Date('2026-08-13T12:00:00-07:00')), /future workout/);
});

test('WHOOP backfills recent strength workouts without replacing a manual record', async () => {
  const store = createWorkoutHistoryStore(memoryRedis(), 'test:history');
  await store.save({
    profile: 'kelsey',
    date: '2026-08-12',
    planName: 'Pull',
    completionSource: 'manual',
  });
  await store.recordWhoopWorkouts('kelsey', [{
    id: 'whoop-one',
    sport_name: 'Weightlifting',
    start: '2026-08-12T18:00:00-07:00',
    end: '2026-08-12T18:45:00-07:00',
  }], new Date('2026-08-13T12:00:00-07:00'));
  await store.recordWhoopWorkouts('jordan', [{
    id: 'whoop-two',
    sport_name: 'Weightlifting',
    start: '2026-08-12T10:00:00-07:00',
    end: '2026-08-12T10:40:00-07:00',
  }], new Date('2026-08-13T12:00:00-07:00'));

  const result = await store.list();
  assert.equal(result.profiles.kelsey[0].planName, 'Pull');
  assert.equal(result.profiles.kelsey[0].completionSource, 'manual');
  assert.equal(result.profiles.jordan[0].completionSource, 'whoop');
  assert.equal(result.profiles.jordan[0].whoopWorkoutId, 'whoop-two');
});
