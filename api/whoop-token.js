export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { code, redirect_uri } = req.body || {};
  if (!code || !redirect_uri) return res.status(400).json({ error: 'Missing code or redirect_uri' });
  const clientId = process.env.WHOOP_CLIENT_ID;
  const clientSecret = process.env.WHOOP_CLIENT_SECRET;
  if (!clientId || !clientSecret) return res.status(500).json({ error: 'WHOOP credentials are not configured on the server' });
  try {
    const body = new URLSearchParams({ grant_type:'authorization_code', code, client_id:clientId, client_secret:clientSecret, redirect_uri });
    const response = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:body.toString() });
    const text = await response.text();
    let data; try { data=JSON.parse(text); } catch { data={raw:text}; }
    if (!response.ok) return res.status(response.status).json({ error:'WHOOP token exchange failed', details:data });
    return res.status(200).json(data);
  } catch (error) { return res.status(500).json({ error:'Token exchange request failed', details:String(error?.message||error) }); }
}
