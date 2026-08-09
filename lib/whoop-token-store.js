import { Redis } from '@upstash/redis';

const DEFAULT_TOKEN_KEY = 'shop-tv:whoop:tokens';

function firstDefined(env, keys) {
  return keys.map((key) => env[key]).find(Boolean);
}

export function getRedisConfiguration(env = process.env) {
  const url = firstDefined(env, [
    'UPSTASH_REDIS_REST_URL',
    'KV_REST_API_URL',
  ]);
  const token = firstDefined(env, [
    'UPSTASH_REDIS_REST_TOKEN',
    'KV_REST_API_TOKEN',
    'KV_REST_API_READ_WRITE_TOKEN',
  ]);

  if (!url || !token) {
    throw new Error(
      'Upstash Redis is not configured. Expected UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.',
    );
  }

  return { url, token };
}

export function tokenRecordFromResponse(response, previous = {}, now = Date.now()) {
  const accessToken = response?.access_token || previous.accessToken;
  const refreshToken = response?.refresh_token || previous.refreshToken;

  if (!accessToken) throw new Error('WHOOP did not return an access token.');
  if (!refreshToken) {
    throw new Error(
      'WHOOP did not return a refresh token. Reconnect WHOOP and approve offline access.',
    );
  }

  const suppliedLifetime = Number(response?.expires_in);
  const expiresIn = Number.isFinite(suppliedLifetime) && suppliedLifetime > 0
    ? suppliedLifetime
    : 3600;

  return {
    accessToken,
    refreshToken,
    expiresAt: now + expiresIn * 1000,
    scope: response?.scope ?? previous.scope ?? null,
    tokenType: response?.token_type ?? previous.tokenType ?? 'Bearer',
    updatedAt: now,
  };
}

function normalizeStoredRecord(value) {
  if (!value) return null;

  let record = value;
  if (typeof record === 'string') {
    try {
      record = JSON.parse(record);
    } catch {
      throw new Error('The WHOOP token record in Redis is invalid.');
    }
  }

  if (!record || typeof record !== 'object') {
    throw new Error('The WHOOP token record in Redis is invalid.');
  }

  return record;
}

export function createWhoopTokenStore(redis, key = DEFAULT_TOKEN_KEY) {
  return {
    async get() {
      return normalizeStoredRecord(await redis.get(key));
    },

    async save(response, previous) {
      const record = tokenRecordFromResponse(response, previous);
      await redis.set(key, record);
      return record;
    },

    async createAuthorizationState(state) {
      await redis.set(`${key}:oauth-state:${state}`, 'pending', { ex: 600 });
    },

    async consumeAuthorizationState(state) {
      return (await redis.getdel(`${key}:oauth-state:${state}`)) !== null;
    },
  };
}

let sharedStore;

export function getWhoopTokenStore(env = process.env) {
  if (!sharedStore) {
    const redis = new Redis(getRedisConfiguration(env));
    sharedStore = createWhoopTokenStore(
      redis,
      env.WHOOP_REDIS_KEY || DEFAULT_TOKEN_KEY,
    );
  }

  return sharedStore;
}
