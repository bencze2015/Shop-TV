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

test('Workout Manager can backfill past completions, per profile, without touching rest or future days', async () => {
  const [source, html] = await Promise.all([
    readFile(new URL('../manager.js', import.meta.url), 'utf8'),
    readFile(new URL('../manage.html', import.meta.url), 'utf8'),
  ]);

  // The window matches what the Progress calendar already shows: this training month, through today.
  assert.match(source, /function backfillDates\(\)/);
  assert.match(source, /new Date\(today\.getFullYear\(\), today\.getMonth\(\), 1, 12, 0, 0, 0\)/);
  assert.match(source, /cursor\.getTime\(\) >= first\.getTime\(\)/);

  // Only training days -- rest days for a profile don't get an offered pill.
  assert.match(source, /if \(!plan\.exercises \|\| !plan\.exercises\.length\) return '';/);

  // The store already rejects future dates server-side (normalizeWorkoutCompletion), and the
  // window itself never walks past today, so there's no client-side future-date path to test here.

  // Reuses the existing shared store, no parallel endpoint.
  assert.match(source, /request\('\/api\/workout-history', \{\s*method: 'DELETE'/);
  assert.match(source, /request\('\/api\/workout-history', \{\s*method: 'POST'/);
  assert.match(source, /completionSource: 'backfill'/);

  // Per profile: each pill is scoped to one profile, both render independently, and the source
  // (including WHOOP) is visibly labeled so an existing WHOOP completion is never silently overwritten.
  assert.match(source, /PROFILES\.map\(function \(profile\) \{ return renderBackfillPill\(profile, date\); \}\)/);
  assert.match(source, /entry\.completionSource === 'whoop' \? ' whoop' : ''/);
  assert.match(source, /function completionSourceLabel\(source\)/);
  assert.match(source, /Confirmed by WHOOP/);

  // It's a toggle: the same control marks and un-marks, keyed off current state, not two separate controls.
  assert.match(source, /function toggleBackfill\(profile, key\)/);
  assert.match(source, /var entry = historyEntry\(profile, key\);/);
  assert.match(source, /entry\s*\n\s*\? request\('\/api\/workout-history', \{\s*\n\s*method: 'DELETE'/);

  assert.match(html, /\.backfill-pill\.whoop/);
  assert.match(html, /\.backfill-pill\.done/);
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
