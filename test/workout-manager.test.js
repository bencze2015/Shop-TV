import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Workout Manager offers a person-scoped missed-workout catch-up action', async () => {
  const source = await readFile(new URL('../manager.js', import.meta.url), 'utf8');

  assert.match(source, /data-action="catch-up"/);
  assert.match(source, /function catchUpYesterday\(\)/);
  assert.match(source, /if \(state\.target === 'both'\)/);
  assert.match(source, /missed = clone\(resolvedPlan\(state\.target, yesterday\)\)/);
  assert.match(source, /setOverride\(state\.target, today, missed\)/);
  assert.match(source, /without changing the permanent schedule/);
});
