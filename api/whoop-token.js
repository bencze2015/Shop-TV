import { exchangeAuthorizationCode } from '../lib/whoop-api.js';
import { getWhoopRedirectUri } from '../lib/whoop-oauth.js';
import { getWhoopTokenStore } from '../lib/whoop-token-store.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, state } = req.body || {};
  if (!code || !state) {
    return res.status(400).json({ error: 'Missing OAuth code or state.' });
  }

  try {
    const store = getWhoopTokenStore();
    if (!(await store.consumeAuthorizationState(state))) {
      return res.status(400).json({
        error: 'The WHOOP authorization session is invalid or expired. Start the connection again.',
      });
    }
    const data = await exchangeAuthorizationCode(
      code,
      getWhoopRedirectUri(),
    );
    await store.save(data);
    return res.status(200).json({
      connected: true,
      stored_server_side: true,
      expires_in: data.expires_in || null,
      scope: data.scope || null,
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      error: 'WHOOP connection could not be saved.',
      details: error.message || String(error),
    });
  }
}
