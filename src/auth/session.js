import crypto from 'node:crypto';

export const SESSION_COOKIE = 'nis_ptc_session';
export const OAUTH_STATE_COOKIE = 'nis_ptc_oauth_state';
export const DEVICE_COOKIE = 'nis_ptc_device';
const SESSION_MS = 12 * 60 * 60 * 1000;
export const DEVICE_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

export function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }
  return cookies;
}

function sign(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function unsign(token, secret) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const index = token.lastIndexOf('.');
  const body = token.slice(0, index);
  const signature = token.slice(index + 1);
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function createSessionToken(email, secret, now = Date.now()) {
  return sign({ email, exp: now + SESSION_MS }, secret);
}

export function readSessionToken(token, secret, now = Date.now()) {
  const payload = unsign(token, secret);
  if (!payload || typeof payload.email !== 'string' || typeof payload.exp !== 'number') return null;
  if (payload.exp < now) return null;
  return { email: payload.email };
}

export function createOauthState(secret) {
  const nonce = crypto.randomBytes(16).toString('base64url');
  return sign({ nonce, exp: Date.now() + 10 * 60 * 1000 }, secret);
}

export function readOauthState(token, secret) {
  const payload = unsign(token, secret);
  if (!payload || typeof payload.nonce !== 'string' || typeof payload.exp !== 'number') return null;
  if (payload.exp < Date.now()) return null;
  return payload.nonce;
}

function cookieBase({ secure }) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: Boolean(secure),
    path: '/',
  };
}

export function setSessionCookie(res, token, options) {
  res.cookie(SESSION_COOKIE, token, {
    ...cookieBase(options),
    maxAge: SESSION_MS,
  });
}

export function clearSessionCookie(res, options) {
  res.clearCookie(SESSION_COOKIE, cookieBase(options));
}

export function setOauthStateCookie(res, token, options) {
  res.cookie(OAUTH_STATE_COOKIE, token, {
    ...cookieBase(options),
    maxAge: 10 * 60 * 1000,
  });
}

export function clearOauthStateCookie(res, options) {
  res.clearCookie(OAUTH_STATE_COOKIE, cookieBase(options));
}

export function readDeviceToken(header) {
  const token = parseCookies(header)[DEVICE_COOKIE];
  return typeof token === 'string' && token ? token : null;
}

// The device token is a credential. httpOnly keeps it out of page scripts.
// secure is always on (§5.4), including when the staff session cookie is not.
export function setDeviceCookie(res, token) {
  res.cookie(DEVICE_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: DEVICE_MAX_AGE_MS,
  });
}
