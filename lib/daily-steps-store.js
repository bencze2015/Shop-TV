import { Redis } from '@upstash/redis';
import { getRedisConfiguration } from './whoop-token-store.js';

const DEFAULT_STEPS_KEY = 'shop-tv:daily-steps:v1';
const DEFAULT_STEP_GOAL = 12500;
const PROFILES = ['jordan', 'kelsey'];

function validDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}
function normalizeStoredValue(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}

export function normalizeDailySteps(value = {}, now = new Date()) {
  const profile = String(value.profile || '').toLowerCase();
  const date = String(value.date || '');
  const steps = Number(value.steps);
  const goal = value.goal == null ? DEFAULT_STEP_GOAL : Number(value.goal);
  if (!PROFILES.includes(profile)) throw new Error('Step profile must be Jordan or Kelsey.');
  if (!validDateKey(date)) throw new Error('Step date is invalid.');
  if (!Number.isInteger(steps) || steps < 0 || steps > 250000) {
    throw new Error('Steps must be a whole number between 0 and 250000.');
  }
  if (!Number.isInteger(goal) || goal < 1000 || goal > 100000) {
    throw new Error('Step goal must be a whole number between 1000 and 100000.');
  }
  return {
    profile,
    date,
    steps,
    goal,
    met: steps >= goal,
    source: String(value.source || 'health').slice(0, 40),
    updatedAt: value.updatedAt ? String(value.updatedAt).slice(0, 40) : now.toISOString(),
  };
}

export function createDailyStepsStore(redis, key = DEFAULT_STEPS_KEY) {
  return {
    async list() {
      const stored = await redis.hgetall(key) || {};
      const profiles = { jordan: [], kelsey: [] };
      for (const raw of Object.values(stored)) {
        const value = normalizeStoredValue(raw);
        try {
          const entry = normalizeDailySteps(value);
          profiles[entry.profile].push(entry);
        } catch {
          // A malformed legacy value should never blank the TV dashboard.
        }
      }
      for (const profile of PROFILES) {
        profiles[profile].sort((left, right) => right.date.localeCompare(left.date));
      }
      return { goal: DEFAULT_STEP_GOAL, profiles };
    },

    async save(value) {
      const entry = normalizeDailySteps(value);
      await redis.hset(key, { [`${entry.profile}:${entry.date}`]: entry });
      return entry;
    },
  };
}

let sharedStore;

export function getDailyStepsStore(env = process.env) {
  if (!sharedStore) {
    sharedStore = createDailyStepsStore(
      new Redis(getRedisConfiguration(env)),
      env.DAILY_STEPS_REDIS_KEY || DEFAULT_STEPS_KEY,
    );
  }
  return sharedStore;
}
