import assert from 'node:assert/strict';
import { parse } from 'acorn';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// The Scriptable widget can't run inside this Node test suite (it depends on Scriptable's own
// runtime globals -- Request, ListWidget, Color, Font, Script, config), but a plain syntax parse
// plus a few structural checks catches the class of mistake that would otherwise only surface as
// a red error screen inside the Scriptable app on Jordan's phone.
test('the Scriptable widget script is syntactically valid and touches only public read endpoints', async () => {
  const source = await readFile(new URL('../tools/shop-tv-widget.js', import.meta.url), 'utf8');

  assert.doesNotThrow(() => parse(source, { ecmaVersion: 2022, sourceType: 'script', allowAwaitOutsideFunction: true }));

  assert.match(source, /const BASE_URL = 'https:\/\/shop-tv-gamma\.vercel\.app'/);
  assert.match(source, /\/api\/workout-plan/);
  assert.match(source, /\/api\/workout-history/);
  assert.match(source, /\/workouts\.json/);

  // A date override must always win outright over the regular weekly plan/rotation -- this is
  // what keeps a travel-block bodyweight day from being silently overwritten by a rotated
  // dumbbell accessory exercise that happens to share the same plan name.
  assert.match(source, /if \(override && override\[profileId\]\) return override\[profileId\];/);

  // The training day rolls over at 7 AM local, matching app-legacy.js, not at midnight.
  assert.match(source, /TRAINING_DAY_START_HOUR = 7/);

  // No write endpoints, no admin token, no credentials of any kind belong in a script that ships
  // as a plain-text file inside a user's Scriptable library.
  assert.doesNotMatch(source, /workout-admin|Bearer|ADMIN_TOKEN|token=/i);
});
