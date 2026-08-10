import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authorizationStateForProfile,
  createWhoopTokenStore,
  getRedisConfiguration,
  normalizeWhoopProfile,
  profileFromAuthorizationState,
  tokenRecordFromResponse,
} from '../lib/whoop-token-store.js';

test('recognizes current Upstash environment variables', () => {
  assert.deepEqual(
    getRedisConfiguration({
      UPSTASH_REDIS_REST_URL: 'https://redis.example',
      UPSTASH_REDIS_REST_TOKEN: 'secret',
    }),
    { url: 'https://redis.example', token: 'secret' },
  );
});

test('recognizes legacy Vercel KV environment variables', () => {
  assert.deepEqual(
    getRedisConfiguration({
      KV_REST_API_URL: 'https://redis.example',
      KV_REST_API_READ_WRITE_TOKEN: 'secret',
    }),
    { url: 'https://redis.example', token: 'secret' },
  );
});

test('requires both Redis connection values', () => {
  assert.throws(() => getRedisConfiguration({}), /Upstash Redis is not configured/);
});

test('builds an expiring server-side token record', () => {
  assert.deepEqual(
    tokenRecordFromResponse(
      {
        access_token: 'access-one',
        refresh_token: 'refresh-one',
        expires_in: 120,
        scope: 'offline read:recovery',
        token_type: 'bearer',
      },
      {},
      1_000,
    ),
    {
      accessToken: 'access-one',
      refreshToken: 'refresh-one',
      expiresAt: 121_000,
      scope: 'offline read:recovery',
      tokenType: 'bearer',
      updatedAt: 1_000,
    },
  );
});

test('preserves the previous refresh token when WHOOP does not rotate it', () => {
  const record = tokenRecordFromResponse(
    { access_token: 'access-two', expires_in: 60 },
    {
      refreshToken: 'refresh-one',
      scope: 'offline',
      tokenType: 'Bearer',
    },
    5_000,
  );

  assert.equal(record.accessToken, 'access-two');
  assert.equal(record.refreshToken, 'refresh-one');
  assert.equal(record.scope, 'offline');
  assert.equal(record.expiresAt, 65_000);
});

test('requires a refresh token for a new connection', () => {
  assert.throws(
    () => tokenRecordFromResponse({ access_token: 'access-only' }),
    /did not return a refresh token/,
  );
});

test('reads and writes the shared Redis record', async () => {
  const values = new Map();
  const redis = {
    get: async (key) => values.get(key) || null,
    set: async (key, value) => values.set(key, value),
    getdel: async (key) => {
      const value = values.get(key) || null;
      values.delete(key);
      return value;
    },
  };
  const store = createWhoopTokenStore(redis, 'test:whoop');

  assert.equal(await store.get(), null);
  const saved = await store.save({
    access_token: 'access',
    refresh_token: 'refresh',
    expires_in: 3600,
  });

  assert.equal(saved.accessToken, 'access');
  assert.equal((await store.get()).refreshToken, 'refresh');
});

test('stores OAuth state for ten minutes and consumes it only once', async () => {
  const values = new Map();
  let setOptions;
  const redis = {
    get: async (key) => values.get(key) || null,
    set: async (key, value, options) => {
      values.set(key, value);
      setOptions = options;
    },
    getdel: async (key) => {
      const value = values.get(key) || null;
      values.delete(key);
      return value;
    },
  };
  const store = createWhoopTokenStore(redis, 'test:whoop');

  await store.createAuthorizationState('random-state');
  assert.deepEqual(setOptions, { ex: 600 });
  assert.equal(await store.consumeAuthorizationState('random-state'), true);
  assert.equal(await store.consumeAuthorizationState('random-state'), false);
});

test('keeps Jordan and Kelsey token records isolated while migrating Jordan', async () => {
  const values = new Map([
    ['test:whoop', { accessToken: 'legacy-jordan', refreshToken: 'legacy-refresh' }],
  ]);
  const redis = {
    get: async (key) => values.get(key) || null,
    set: async (key, value) => values.set(key, value),
    getdel: async (key) => {
      const value = values.get(key) || null;
      values.delete(key);
      return value;
    },
  };
  const jordan = createWhoopTokenStore(redis, 'test:whoop:jordan', 'test:whoop');
  const kelsey = createWhoopTokenStore(redis, 'test:whoop:kelsey');

  assert.equal((await jordan.get()).accessToken, 'legacy-jordan');
  assert.equal(values.get('test:whoop:jordan').refreshToken, 'legacy-refresh');
  assert.equal(await kelsey.get(), null);

  await kelsey.save({
    access_token: 'kelsey-access',
    refresh_token: 'kelsey-refresh',
    expires_in: 3600,
  });
  assert.equal((await jordan.get()).accessToken, 'legacy-jordan');
  assert.equal((await kelsey.get()).accessToken, 'kelsey-access');
});

test('binds each OAuth state to a supported household profile', () => {
  const state = authorizationStateForProfile('kelsey', 'random-state');
  assert.equal(state, 'kelsey.random-state');
  assert.equal(profileFromAuthorizationState(state), 'kelsey');
  assert.equal(profileFromAuthorizationState('legacy-jordan-state'), 'jordan');
  assert.equal(normalizeWhoopProfile(), 'jordan');
  assert.throws(() => normalizeWhoopProfile('someone-else'), /Unknown WHOOP profile/);
});
