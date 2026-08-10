import { workoutAdminAuthorized } from '../lib/workout-admin-auth.js';
import { getWorkoutPlanStore } from '../lib/workout-plan-store.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!workoutAdminAuthorized(req)) {
    return res.status(401).json({ error: 'Workout Manager authorization is required.' });
  }
  if (req.method !== 'GET' && req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const store = getWorkoutPlanStore();
    if (req.method === 'GET') return res.status(200).json(await store.get());
    const { config, expectedRevision } = req.body || {};
    return res.status(200).json(await store.save(config, expectedRevision));
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'The workout plan could not be saved.',
    });
  }
}
