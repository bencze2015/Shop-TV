import { randomBytes } from 'node:crypto';
import { getWhoopRedirectUri } from '../lib/whoop-oauth.js';
import { getWhoopTokenStore } from '../lib/whoop-token-store.js';

const WHOOP_AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const WHOOP_SCOPES = [
  'offline',
  'read:recovery',
  'read:cycles',
  'read:sleep',
  'read:workout',
  'read:profile',
];

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const clientId = process.env.WHOOP_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ error: 'WHOOP_CLIENT_ID is not configured.' });
  }

  const state = randomBytes(24).toString('hex');
  const authorizationUrl = new URL(WHOOP_AUTH_URL);
  authorizationUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: getWhoopRedirectUri(),
    scope: WHOOP_SCOPES.join(' '),
    state,
  }).toString();

  try {
    await getWhoopTokenStore().createAuthorizationState(state);
  } catch (error) {
    return res.status(500).json({
      error: 'WHOOP authorization could not be started.',
      details: error.message || String(error),
    });
  }

  res.statusCode = 302;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Location', authorizationUrl.toString());
  return res.end();
}
