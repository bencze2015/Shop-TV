import { getWorkoutHistoryStore } from '../lib/workout-history-store.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const store = getWorkoutHistoryStore();
  try {
    if (req.method === 'GET') return res.status(200).json(await store.list());
    if (req.method === 'DELETE') {
      await store.remove(req.body?.profile, req.body?.date);
      console.log('[workout-history] completion removed', {
        profile: req.body?.profile,
        date: req.body?.date,
      });
      return res.status(200).json({ removed: true });
    }
    const completion = await store.save(req.body || {});
    console.log('[workout-history] completion saved', {
      profile: completion.profile,
      date: completion.date,
      source: completion.completionSource,
    });
    return res.status(200).json({ completion });
  } catch (error) {
    console.error('[workout-history] request failed', {
      method: req.method,
      error: error.message || String(error),
    });
    return res.status(/invalid|cannot|must/i.test(error.message || '') ? 400 : 500).json({
      error: error.message || 'Workout history is temporarily unavailable.',
    });
  }
}
