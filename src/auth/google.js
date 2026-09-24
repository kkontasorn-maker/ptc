export function googleAuthorizationUrl({ clientId, redirectUri, state, hostedDomain }) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'select_account');
  if (hostedDomain) url.searchParams.set('hd', hostedDomain);
  return url.toString();
}

export async function googleEmailFromCode({ clientId, clientSecret, redirectUri, code, fetchImpl = fetch }) {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const tokenResponse = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
    signal: AbortSignal.timeout(15000),
  });
  if (!tokenResponse.ok) {
    throw new Error('Google token exchange failed');
  }
  const token = await tokenResponse.json();
  if (!token.access_token) throw new Error('Google token exchange failed');

  const infoResponse = await fetchImpl('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!infoResponse.ok) throw new Error('Google userinfo failed');
  const info = await infoResponse.json();
  if (typeof info.email !== 'string' || !info.email_verified) {
    throw new Error('Google account has no verified email');
  }
  return info.email.trim().toLowerCase();
}
