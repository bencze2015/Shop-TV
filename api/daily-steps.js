import { workoutAdminAuthorized } from '../lib/workout-admin-auth.js';
import { stepSyncProfile } from '../lib/daily-steps-auth.js';
import { getDailyStepsStore } from '../lib/daily-steps-store.js';

function lines(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

export function entriesFromHealthSamples(body = {}) {
  const dates = lines(body.dates);
  const totals = lines(body.values ?? body.steps);
  if (!dates.length && !totals.length) return null;
  if (!dates.length || dates.length !== totals.length || dates.length > 5000) {
    throw new Error('Apple Health dates and step values must contain the same number of samples.');
  }
  const grouped = new Map();
  dates.forEach((date, index) => {
    const numeric = Number(String(totals[index]).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)?.[0]);
    if (!Number.isFinite(numeric) || numeric < 0) throw new Error('Apple Health returned an invalid step sample.');
    grouped.set(date, (grouped.get(date) || 0) + numeric);
  });
  if (grouped.size > 45) throw new Error('Apple Health sync may include at most 45 days.');
  return Array.from(grouped, ([date, steps]) => ({ date, steps: Math.round(steps) }));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const syncProfile = req.method === 'POST' ? stepSyncProfile(req) : null;
  if (req.method === 'POST' && !syncProfile && !workoutAdminAuthorized(req)) {
    return res.status(401).json({ error: 'Step sync authorization is required.' });
  }

  try {
    const store = getDailyStepsStore();
    if (req.method === 'GET') return res.status(200).json(await store.list());
    const body = req.body || {};
    const healthSamples = entriesFromHealthSamples(body);
    const sourceValues = healthSamples || (Array.isArray(body.entries) ? body.entries : [body]);
    const entries = sourceValues.map((value) => ({
      ...value,
      ...(syncProfile ? { profile: syncProfile } : {}),
      source: value.source || body.source || 'apple-health',
    }));
    const saved = await store.saveMany(entries);
    console.log('[daily-steps] totals saved', {
      profile: syncProfile || 'manager',
      count: saved.length,
      firstDate: saved[0]?.date,
      lastDate: saved.at(-1)?.date,
    });
    return res.status(200).json({ ok: true, entries: saved });
  } catch (error) {
    console.error('[daily-steps] request failed', {
      method: req.method,
      error: error.message || String(error),
    });
    return res.status(/invalid|must|between/i.test(error.message || '') ? 400 : 500).json({
      error: error.message || 'Daily steps are temporarily unavailable.',
    });
  }
}
