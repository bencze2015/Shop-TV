import { Redis } from '@upstash/redis';
import { getRedisConfiguration } from './whoop-token-store.js';

const DEFAULT_PLAN_KEY = 'shop-tv:workout-plan:v1';
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const PROFILES = ['jordan', 'kelsey'];

export function emptyWorkoutPlanConfig() {
  return {
    schemaVersion: 1,
    revision: 0,
    updatedAt: null,
    sharedSchedule: true,
    profileWeeks: {},
    dateOverrides: {},
    rescheduleEvents: [],
  };
}

function cleanText(value, label, maximum) {
  const text = String(value ?? '').trim();
  if (!text || text.length > maximum) {
    throw new Error(`${label} must contain 1-${maximum} characters.`);
  }
  return text;
}

function normalizeExercise(value, index) {
  const name = cleanText(value?.name, `Exercise ${index + 1} name`, 80);
  const fallbackId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const id = cleanText(value?.id || fallbackId, `Exercise ${index + 1} id`, 80);
  const sets = Number(value?.sets);
  const restSeconds = Number(value?.restSeconds);
  if (!Number.isInteger(sets) || sets < 1 || sets > 10) {
    throw new Error(`${name} sets must be between 1 and 10.`);
  }
  if (!Number.isInteger(restSeconds) || restSeconds < 0 || restSeconds > 600) {
    throw new Error(`${name} rest must be between 0 and 600 seconds.`);
  }
  return {
    id,
    name,
    sets,
    reps: cleanText(value?.reps, `${name} reps`, 40),
    restSeconds,
  };
}

export function normalizePlan(value) {
  const name = cleanText(value?.name || 'Rest', 'Plan name', 40);
  const exercises = Array.isArray(value?.exercises) ? value.exercises : [];
  if (exercises.length > 5) {
    throw new Error(`${name} has more than five exercises; the TV supports five.`);
  }
  return { name, exercises: exercises.map(normalizeExercise) };
}

function normalizeWeek(value, profile) {
  if (!value || typeof value !== 'object') {
    throw new Error(`${profile} weekly plan is invalid.`);
  }
  const week = {};
  for (const day of DAYS) week[day] = normalizePlan(value[day]);
  return week;
}

export function normalizeWorkoutPlanConfig(value = {}) {
  const config = emptyWorkoutPlanConfig();
  config.sharedSchedule = value.sharedSchedule !== false;

  for (const profile of PROFILES) {
    if (value.profileWeeks?.[profile]) {
      config.profileWeeks[profile] = normalizeWeek(value.profileWeeks[profile], profile);
    }
  }

  const overrides = value.dateOverrides || {};
  const dates = Object.keys(overrides);
  if (dates.length > 180) throw new Error('Too many schedule exceptions are stored.');
  for (const date of dates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid override date: ${date}`);
    const entry = overrides[date];
    if (!entry || typeof entry !== 'object') continue;
    const normalizedEntry = {};
    for (const profile of PROFILES) {
      if (entry[profile]) normalizedEntry[profile] = normalizePlan(entry[profile]);
    }
    if (Object.keys(normalizedEntry).length) config.dateOverrides[date] = normalizedEntry;
  }

  const events = Array.isArray(value.rescheduleEvents) ? value.rescheduleEvents : [];
  if (events.length > 180) throw new Error('Too many rescheduled workouts are stored.');
  for (const event of events) {
    if (!PROFILES.includes(event?.profile)) throw new Error('A rescheduled workout has an invalid profile.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(event?.fromDate || '')) {
      throw new Error('A rescheduled workout has an invalid original date.');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(event?.toDate || '')) {
      throw new Error('A rescheduled workout has an invalid destination date.');
    }
    config.rescheduleEvents.push({
      profile: event.profile,
      fromDate: event.fromDate,
      toDate: event.toDate,
      planName: cleanText(event.planName || 'Workout', 'Rescheduled workout name', 40),
      createdAt: event.createdAt ? String(event.createdAt).slice(0, 40) : null,
    });
  }

  return config;
}

export function createWorkoutPlanStore(redis, key = DEFAULT_PLAN_KEY) {
  return {
    async get() {
      const stored = await redis.get(key);
      if (!stored) return emptyWorkoutPlanConfig();
      const value = typeof stored === 'string' ? JSON.parse(stored) : stored;
      const config = normalizeWorkoutPlanConfig(value);
      config.revision = Number.isInteger(value.revision) ? value.revision : 0;
      config.updatedAt = value.updatedAt || null;
      return config;
    },

    async save(nextValue, expectedRevision) {
      const current = await this.get();
      if (Number(expectedRevision) !== current.revision) {
        const error = new Error('The workout plan changed on another device. Reload and try again.');
        error.status = 409;
        throw error;
      }
      const next = normalizeWorkoutPlanConfig(nextValue);
      next.revision = current.revision + 1;
      next.updatedAt = new Date().toISOString();
      await redis.set(key, next);
      return next;
    },
  };
}

let sharedStore;

export function getWorkoutPlanStore(env = process.env) {
  if (!sharedStore) {
    sharedStore = createWorkoutPlanStore(
      new Redis(getRedisConfiguration(env)),
      env.WORKOUT_PLAN_REDIS_KEY || DEFAULT_PLAN_KEY,
    );
  }
  return sharedStore;
}
