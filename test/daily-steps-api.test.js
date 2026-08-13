import assert from 'node:assert/strict';
import test from 'node:test';
import { entriesFromHealthSamples } from '../api/daily-steps.js';

test('Apple Health samples are summed into daily totals', () => {
  assert.deepEqual(entriesFromHealthSamples({
    dates: '2026-08-12\n2026-08-13\n2026-08-13',
    values: '4,000\n5000\n7,750 steps',
  }), [
    { date: '2026-08-12', steps: 4000 },
    { date: '2026-08-13', steps: 12750 },
  ]);
});

test('Apple Health sample columns must stay aligned', () => {
  assert.throws(() => entriesFromHealthSamples({
    dates: '2026-08-12\n2026-08-13',
    values: '4000',
  }), /same number/);
});
