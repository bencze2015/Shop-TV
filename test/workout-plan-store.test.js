import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { tokenMatchesHash } from '../lib/workout-admin-auth.js';
import {
  createWorkoutPlanStore,
  emptyWorkoutPlanConfig,
  normalizeWorkoutPlanConfig,
} from '../lib/workout-plan-store.js';

function memoryRedis() {
  const values = new Map();
  return {
    async get(key) { return values.get(key) ?? null; },
    async set(key, value) { values.set(key, value); },
  };
}

function exercise(index = 1) {
  return {
    id: `exercise-${index}`,
    name: `Exercise ${index}`,
    sets: 3,
    reps: '8–12',
    restSeconds: 90,
  };
}

function week() {
  return {
    Monday: { name: 'Push', exercises: [exercise()] },
    Tuesday: { name: 'Rest', exercises: [] },
    Wednesday: { name: 'Pull', exercises: [exercise(2)] },
    Thursday: { name: 'Rest', exercises: [] },
    Friday: { name: 'Legs', exercises: [exercise(3)] },
    Saturday: { name: 'Rest', exercises: [] },
    Sunday: { name: 'Rest', exercises: [] },
  };
}

test('workout plan storage starts empty and increments revisions on save', async () => {
  const store = createWorkoutPlanStore(memoryRedis(), 'test-plan');
  assert.deepEqual(await store.get(), emptyWorkoutPlanConfig());

  const saved = await store.save({
    sharedSchedule: false,
    profileWeeks: { jordan: week() },
    dateOverrides: {
      '2026-08-11': { jordan: { name: 'Push', exercises: [exercise()] } },
    },
  }, 0);

  assert.equal(saved.revision, 1);
  assert.equal(saved.sharedSchedule, false);
  assert.equal(saved.profileWeeks.jordan.Monday.name, 'Push');
  assert.equal(saved.dateOverrides['2026-08-11'].jordan.name, 'Push');
  assert.ok(saved.updatedAt);
  assert.deepEqual(await store.get(), saved);
});

test('workout plan storage rejects stale edits and TV-overflowing sessions', async () => {
  const store = createWorkoutPlanStore(memoryRedis(), 'test-plan');
  await store.save({ profileWeeks: { jordan: week() } }, 0);
  await assert.rejects(
    store.save({ profileWeeks: { jordan: week() } }, 0),
    /changed on another device/,
  );

  const invalid = emptyWorkoutPlanConfig();
  invalid.profileWeeks.jordan = week();
  invalid.profileWeeks.jordan.Monday.exercises = [1, 2, 3, 4, 5, 6].map(exercise);
  assert.throws(() => normalizeWorkoutPlanConfig(invalid), /more than five exercises/);
});

test('Workout Manager authorization compares hashes without storing plaintext secrets', () => {
  const token = 'test-only-private-key';
  const hash = createHash('sha256').update(token).digest('hex');
  assert.equal(tokenMatchesHash(token, hash), true);
  assert.equal(tokenMatchesHash('wrong-key', hash), false);
  assert.equal(tokenMatchesHash('', hash), false);
});
