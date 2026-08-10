import { Redis } from '@upstash/redis';

const DEFAULT_TOKEN_KEY = 'shop-tv:whoop:tokens';
const WHOOP_PROFILES = ['jordan', 'kelsey'];

export function normalizeWhoopProfile(value = 'jordan') {
  const profile = String(value || 'jordan').toLowerCase();
  if (!WHOOP_PROFILES.includes(profile)) {
    throw new Error('Unknown WHOOP profile. Expected jordan or kelsey.');
  }
  return profile;
}

export function authorizationStateForProfile(profile, randomState) {
  return `${normalizeWhoopProfile(profile)}.${randomState}`;
}

export function profileFromAuthorizationState(state) {
  const separator = String(state || '').indexOf('.');
  return separator < 0
    ? 'jordan'
    : normalizeWhoopProfile(String(state).slice(0, separator));
}

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

export function createWhoopTokenStore(redis, key = DEFAULT_TOKEN_KEY, legacyKey = null) {
  return {
    async get() {
      const current = normalizeStoredRecord(await redis.get(key));
      if (current || !legacyKey) return current;

      const legacy = normalizeStoredRecord(await redis.get(legacyKey));
      if (!legacy) return null;
      await redis.set(key, legacy);
      return legacy;
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
      const current = await redis.getdel(`${key}:oauth-state:${state}`);
      if (current !== null || !legacyKey) return current !== null;
      return (await redis.getdel(`${legacyKey}:oauth-state:${state}`)) !== null;
    },
  };
}

const sharedStores = new Map();

export function getWhoopTokenStore(profile = 'jordan', env = process.env) {
  const normalizedProfile = normalizeWhoopProfile(profile);
  const baseKey = env.WHOOP_REDIS_KEY || DEFAULT_TOKEN_KEY;
  const configuration = getRedisConfiguration(env);
  const cacheKey = `${configuration.url}:${baseKey}:${normalizedProfile}`;
  if (!sharedStores.has(cacheKey)) {
    const redis = new Redis(configuration);
    sharedStores.set(cacheKey, createWhoopTokenStore(
      redis,
      `${baseKey}:${normalizedProfile}`,
      normalizedProfile === 'jordan' ? baseKey : null,
    ));
  }

  return sharedStores.get(cacheKey);
}
