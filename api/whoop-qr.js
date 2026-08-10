import QRCode from 'qrcode';
import { getWhoopRedirectUri } from '../lib/whoop-oauth.js';
import { normalizeWhoopProfile } from '../lib/whoop-token-store.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const profile = normalizeWhoopProfile(req.query?.profile);
    const reconnectUrl = new URL('/api/whoop-connect', getWhoopRedirectUri());
    reconnectUrl.searchParams.set('profile', profile);
    const svg = await QRCode.toString(reconnectUrl.toString(), {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 240,
      color: { dark: '#07100b', light: '#ffffff' },
    });
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    return res.status(200).send(svg);
  } catch (error) {
    return res.status(500).json({
      error: 'WHOOP reconnect code could not be generated.',
      details: error.message || String(error),
    });
  }
}
