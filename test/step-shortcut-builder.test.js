import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Apple Health shortcut reads step samples written by WHOOP only', async () => {
  const builder = await readFile(new URL('../scripts/build-step-shortcut.mjs', import.meta.url), 'utf8');

  assert.match(builder, /<key>Property<\/key><string>Source<\/string>/);
  assert.match(builder, /<key>Enumeration<\/key><string>WHOOP<\/string>/);
  assert.match(builder, /textField\('source', 'whoop-via-apple-health'\)/);
});
