import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { stepSyncProfile } from '../lib/daily-steps-auth.js';

test('step sync tokens are profile locked', () => {
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  const hashes = { jordan: hash('jordan-test'), kelsey: hash('kelsey-test') };
  assert.equal(stepSyncProfile({ headers: {
    authorization: 'Bearer jordan-test',
  } }, hashes), 'jordan');
  assert.equal(stepSyncProfile({ headers: {
    'x-step-sync-token': 'kelsey-test',
  } }, hashes), 'kelsey');
});

test('step sync rejects unknown tokens', () => {
  assert.equal(stepSyncProfile({ headers: { authorization: 'Bearer nope' } }), null);
});
