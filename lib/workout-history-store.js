import { Redis } from '@upstash/redis';
import { getRedisConfiguration } from './whoop-token-store.js';

const DEFAULT_HISTORY_KEY = 'shop-tv:workout-history:v1';
const PROFILES = ['jordan', 'kelsey'];
const SOURCES = ['manual', 'sets', 'whoop', 'legacy', 'backfill'];
const TRAINING_DAY_START_HOUR = 7;

function localDateKey(value) {
  const adjusted = new Date(new Date(value).getTime() - TRAINING_DAY_START_HOUR * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(adjusted);
  const part = (type) => parts.find((entry) => entry.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function validDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function cleanText(value, fallback, maximum) {
  const text = String(value || fallback).trim();
  if (!text || text.length > maximum) throw new Error(`Workout text must contain 1-${maximum} characters.`);
  return text;
}

export function normalizeWorkoutCompletion(value = {}, now = new Date()) {
  const profile = String(value.profile || '').toLowerCase();
  const date = String(value.date || '');
  if (!PROFILES.includes(profile)) throw new Error('Workout completion profile must be Jordan or Kelsey.');
  if (!validDateKey(date)) throw new Error('Workout completion date is invalid.');
  if (date > localDateKey(now)) throw new Error('A future workout cannot be marked complete.');
  const completionSource = SOURCES.includes(value.completionSource)
    ? value.completionSource
    : 'manual';
  return {
    profile,
    date,
    planName: cleanText(value.planName, 'Workout', 80),
    completionSource,
    completedAt: value.completedAt ? String(value.completedAt).slice(0, 40) : now.toISOString(),
    whoopWorkoutId: value.whoopWorkoutId ? String(value.whoopWorkoutId).slice(0, 120) : null,
  };
}

function strengthWorkout(workout) {
  const name = String(workout?.sport_name || workout?.sport_id || '').toLowerCase();
  return [
    'weightlifting', 'weight lifting', 'strength', 'powerlifting',
    'functional fitness', 'crossfit', 'bodybuilding', 'barre', 'pilates',
  ].some((candidate) => name.includes(candidate));
}

function eligibleWhoopWorkout(workout, now = new Date()) {
  const start = new Date(workout?.start || workout?.created_at || 0);
  const end = new Date(workout?.end || workout?.updated_at || 0);
  return strengthWorkout(workout)
    && Number.isFinite(start.getTime())
    && Number.isFinite(end.getTime())
    && end.getTime() <= now.getTime()
    && end.getTime() - start.getTime() >= 10 * 60 * 1000;
}

function normalizeStoredValue(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}

export function createWorkoutHistoryStore(redis, key = DEFAULT_HISTORY_KEY) {
  return {
    async list() {
      const stored = await redis.hgetall(key) || {};
      const profiles = { jordan: [], kelsey: [] };
      for (const raw of Object.values(stored)) {
        const value = normalizeStoredValue(raw);
        try {
          const entry = normalizeWorkoutCompletion(value, new Date('2999-12-31T12:00:00Z'));
          profiles[entry.profile].push(entry);
        } catch {
          // Ignore one malformed legacy value instead of breaking the whole TV screen.
        }
      }
      for (const profile of PROFILES) {
        profiles[profile].sort((left, right) => right.date.localeCompare(left.date));
      }
      return { profiles };
    },

    async save(value, options = {}) {
      const entry = normalizeWorkoutCompletion(value);
      const field = `${entry.profile}:${entry.date}`;
      if (options.preserveExisting && await redis.hget(key, field)) return null;
      await redis.hset(key, { [field]: entry });
      return entry;
    },

    async remove(profile, date) {
      const normalized = normalizeWorkoutCompletion({ profile, date, planName: 'Workout' });
      await redis.hdel(key, `${normalized.profile}:${normalized.date}`);
    },

    async recordWhoopWorkouts(profile, workouts = [], now = new Date()) {
      const saved = [];
      for (const workout of workouts) {
        if (!eligibleWhoopWorkout(workout, now)) continue;
        const entry = await this.save({
          profile,
          date: localDateKey(workout.end || workout.updated_at),
          planName: workout.sport_name || 'Strength workout',
          completionSource: 'whoop',
          completedAt: workout.end || workout.updated_at,
          whoopWorkoutId: workout.id || workout.uuid || null,
        }, { preserveExisting: true });
        if (entry) saved.push(entry);
      }
      return saved;
    },
  };
}

let sharedStore;

export function getWorkoutHistoryStore(env = process.env) {
  if (!sharedStore) {
    sharedStore = createWorkoutHistoryStore(
      new Redis(getRedisConfiguration(env)),
      env.WORKOUT_HISTORY_REDIS_KEY || DEFAULT_HISTORY_KEY,
    );
  }
  return sharedStore;
}
