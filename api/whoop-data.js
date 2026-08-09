import { loadWhoopData, refreshWhoopTokens } from '../lib/whoop-api.js';
import { getWhoopTokenStore } from '../lib/whoop-token-store.js';

const REFRESH_EARLY_MS = 60 * 1000;

function accessTokenIsExpiring(tokens) {
  return Number.isFinite(tokens?.expiresAt)
    && tokens.expiresAt <= Date.now() + REFRESH_EARLY_MS;
}

async function refreshAndStore(store, currentTokens) {
  try {
    const response = await refreshWhoopTokens(currentTokens.refreshToken);
    return await store.save(response, currentTokens);
  } catch (error) {
    // A concurrent request may already have rotated the refresh token. Prefer the
    // newer shared record instead of failing this request with a stale token.
    const latestTokens = await store.get();
    if (
      latestTokens?.accessToken
      && latestTokens.updatedAt > (currentTokens.updatedAt || 0)
    ) {
      return latestTokens;
    }
    throw error;
  }
}

function authorizationError(res, details) {
  return res.status(401).json({
    error: 'WHOOP authorization expired. Reconnect WHOOP from a phone or computer.',
    details: details || null,
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let store;
  let tokens;
  try {
    store = getWhoopTokenStore();
    tokens = await store.get();
  } catch (error) {
    return res.status(500).json({
      error: 'WHOOP server-side token storage is unavailable.',
      details: error.message || String(error),
    });
  }

  if (!tokens?.accessToken && !tokens?.refreshToken) {
    return res.status(401).json({
      error: 'WHOOP is not connected on the server. Connect it from a phone or computer.',
    });
  }

  if (!tokens.accessToken || accessTokenIsExpiring(tokens)) {
    if (!tokens.refreshToken) return authorizationError(res);
    try {
      tokens = await refreshAndStore(store, tokens);
    } catch (refreshError) {
      if (refreshError.status === 400 || refreshError.status === 401) {
        return authorizationError(res, refreshError.data || null);
      }
      return res.status(refreshError.status || 500).json({
        error: refreshError.message,
        details: refreshError.data || null,
      });
    }
  }

  try {
    return res.status(200).json(await loadWhoopData(tokens.accessToken));
  } catch (error) {
    if (error.status !== 401 || !tokens.refreshToken) {
      return res.status(error.status || 500).json({
        error: error.message,
        details: error.data || null,
      });
    }

    try {
      tokens = await refreshAndStore(store, tokens);
      return res.status(200).json(await loadWhoopData(tokens.accessToken));
    } catch (refreshError) {
      if (refreshError.status === 400 || refreshError.status === 401) {
        return authorizationError(res, refreshError.data || null);
      }
      return res.status(refreshError.status || 500).json({
        error: refreshError.message,
        details: refreshError.data || null,
      });
    }
  }
}
