import express from 'express';
import { NotFoundError, UnauthorizedError, ValidationError } from '../errors.js';
import { asyncHandler } from '../http.js';
import { resolveRole, sessionUser } from '../auth/roles.js';
import { requireAuth } from '../auth/access.js';
import { googleAuthorizationUrl, googleEmailFromCode } from '../auth/google.js';
import {
  OAUTH_STATE_COOKIE,
  clearOauthStateCookie,
  clearSessionCookie,
  createOauthState,
  createSessionToken,
  parseCookies,
  readOauthState,
  setOauthStateCookie,
  setSessionCookie,
} from '../auth/session.js';
import { validateLocalLogin, validateSwitchRole } from '../validate.js';

function externalBase(req) {
  const forwarded = req.get('x-forwarded-proto');
  const proto = forwarded ? forwarded.split(',')[0].trim() : req.protocol;
  return `${proto}://${req.get('host')}`;
}

function redirectUriFor(req, config) {
  return config.google.redirectUri || `${externalBase(req)}/api/v1/auth/google/callback`;
}

function authInfo(config) {
  return { local: config.localAuth, google: config.google.configured };
}

function issueSession(res, user, config, cookieOptions) {
  setSessionCookie(res, createSessionToken({
    email: user.email,
    activeRole: user.activeRole,
    roles: user.roles,
  }, config.sessionSecret), cookieOptions);
}

export function createAuthRoutes(config) {
  const router = express.Router();
  const cookieOptions = { secure: config.cookieSecure };

  router.get('/session', (req, res) => {
    if (!req.user) {
      res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Sign in required' },
        auth: authInfo(config),
      });
      return;
    }
    res.json({
      user: req.user,
      time_zone: config.timeZone,
      auth: authInfo(config),
    });
  });

  router.post('/session', (req, res) => {
    if (!config.localAuth) {
      throw new NotFoundError('Local sign-in is not enabled on this server');
    }
    const { email } = validateLocalLogin(req.body);
    const user = resolveRole(email, config.roleMap);
    if (!user) {
      throw new UnauthorizedError('That email is not assigned a role on this server');
    }
    issueSession(res, user, config, cookieOptions);
    res.json({
      user,
      time_zone: config.timeZone,
      auth: authInfo(config),
    });
  });

  router.delete('/session', (req, res) => {
    clearSessionCookie(res, cookieOptions);
    res.json({ ok: true });
  });

  router.post('/switch-role', requireAuth, (req, res) => {
    const { role } = validateSwitchRole(req.body);
    if (!req.user.roles.includes(role)) {
      throw new ValidationError('Role is not assigned to this account', [
        { field: 'role', message: 'Role is not assigned to this account' },
      ]);
    }
    const user = sessionUser({
      email: req.user.email,
      roles: req.user.roles,
      teacherid: req.user.teacherid,
    }, role);
    issueSession(res, user, config, cookieOptions);
    res.json({
      user,
      activeRole: user.activeRole,
      roles: user.roles,
      time_zone: config.timeZone,
      auth: authInfo(config),
    });
  });

  router.get('/google', (req, res) => {
    if (!config.google.configured) {
      throw new NotFoundError('Google sign-in is not configured');
    }
    const state = createOauthState(config.sessionSecret);
    setOauthStateCookie(res, state, cookieOptions);
    res.redirect(googleAuthorizationUrl({
      clientId: config.google.clientId,
      redirectUri: redirectUriFor(req, config),
      state,
      hostedDomain: config.google.hostedDomain,
    }));
  });

  router.get('/google/callback', asyncHandler(async (req, res) => {
    const fail = (code) => {
      clearOauthStateCookie(res, cookieOptions);
      res.redirect(`/#/sign-in?error=${encodeURIComponent(code)}`);
    };
    if (!config.google.configured) {
      fail('google');
      return;
    }
    const cookies = parseCookies(req.headers.cookie);
    const stateCookie = cookies[OAUTH_STATE_COOKIE];
    const nonce = stateCookie ? readOauthState(stateCookie, config.sessionSecret) : null;
    if (!req.query.code || !req.query.state || req.query.state !== stateCookie || !nonce) {
      fail('google');
      return;
    }
    try {
      const email = await googleEmailFromCode({
        clientId: config.google.clientId,
        clientSecret: config.google.clientSecret,
        redirectUri: redirectUriFor(req, config),
        code: String(req.query.code),
      });
      const user = resolveRole(email, config.roleMap);
      clearOauthStateCookie(res, cookieOptions);
      if (!user) {
        fail('unassigned');
        return;
      }
      issueSession(res, user, config, cookieOptions);
      res.redirect('/#/events');
    } catch (error) {
      console.error(error);
      fail('google');
    }
  }));

  return router;
}
