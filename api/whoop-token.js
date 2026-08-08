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
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    const cookies = [];
    if (data.access_token) cookies.push(`whoop_access=${encodeURIComponent(data.access_token)}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${Number(data.expires_in || 3600)}`);
    if (data.refresh_token) cookies.push(`whoop_refresh=${encodeURIComponent(data.refresh_token)}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=2592000`);
    if (cookies.length) res.setHeader('Set-Cookie', cookies);
    return res.status(200).json({ connected:true, expires_in:data.expires_in || null, scope:data.scope || null });
  } catch (error) { return res.status(500).json({ error:'Token exchange request failed', details:String(error?.message||error) }); }
}
