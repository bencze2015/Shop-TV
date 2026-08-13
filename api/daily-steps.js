import { workoutAdminAuthorized } from '../lib/workout-admin-auth.js';
import { getDailyStepsStore } from '../lib/daily-steps-store.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (req.method === 'POST' && !workoutAdminAuthorized(req)) {
    return res.status(401).json({ error: 'Workout Manager authorization is required.' });
  }

  try {
    const store = getDailyStepsStore();
    if (req.method === 'GET') return res.status(200).json(await store.list());
    const entry = await store.save(req.body || {});
    console.log('[daily-steps] total saved', {
      profile: entry.profile,
      date: entry.date,
      steps: entry.steps,
    });
    return res.status(200).json({ entry });
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
