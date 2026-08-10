import { getWorkoutPlanStore } from '../lib/workout-plan-store.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    return res.status(200).json(await getWorkoutPlanStore().get());
  } catch (error) {
    return res.status(500).json({
      error: 'The live workout plan is temporarily unavailable.',
      details: error.message || String(error),
    });
  }
}
