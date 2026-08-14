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
  assert.match(source, /recordReschedule\(state\.target, yesterday, today, missed\)/);
  assert.match(source, /without changing the permanent schedule/);
});

test('Workout Manager records pushed workouts for the shared progress calendar', async () => {
  const source = await readFile(new URL('../manager.js', import.meta.url), 'utf8');

  assert.match(source, /function recordReschedule\(profile, fromDate, toDate, plan\)/);
  assert.match(source, /state\.config\.rescheduleEvents = events\.slice\(-180\)/);
  assert.match(source, /recordReschedule\(profile, today, tomorrow, current\)/);
  assert.match(source, /event\.fromDate >= mondayKey && event\.fromDate <= sundayKey/);
});

test('Workout Manager leads with a complete week and previews the rotating accessory', async () => {
  const [source, html] = await Promise.all([
    readFile(new URL('../manager.js', import.meta.url), 'utf8'),
    readFile(new URL('../manage.html', import.meta.url), 'utf8'),
  ]);

  assert.match(source, /function renderWeekProjection\(today\)/);
  assert.match(source, /data-week-offset="0"/);
  assert.match(source, /data-week-offset="1"/);
  assert.match(source, /The first two movements stay consistent/);
  assert.match(source, /function rotatedPlan\(plan, date\)/);
  assert.match(html, /\.projection-day/);
  assert.match(html, /\.movement\.rotating/);
});

test('Workout Manager accepts a private fragment invite once and remembers the browser', async () => {
  const [source, html] = await Promise.all([
    readFile(new URL('../manager.js', import.meta.url), 'utf8'),
    readFile(new URL('../manage.html', import.meta.url), 'utf8'),
  ]);

  assert.match(source, /new URLSearchParams\(fragment\)/);
  assert.match(source, /params\.get\('invite'\)/);
  assert.match(source, /localStorage\.setItem\(STORAGE_KEY, inviteToken\)/);
  assert.match(source, /history\.replaceState\(\{\}, '', location\.pathname \+ location\.search\)/);
  assert.doesNotMatch(source, /URLSearchParams\(location\.search\)/);
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
});
