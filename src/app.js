import path from 'node:path';
import express from 'express';
import { openDatabase } from './db.js';
import { errorHandler } from './http.js';
import { ForbiddenError } from './errors.js';
import { resolveRole } from './auth/roles.js';
import { parseCookies, readSessionToken, SESSION_COOKIE } from './auth/session.js';
import { createPsapiClient } from './psapi/client.js';
import { EventRepository } from './repositories/EventRepository.js';
import { ServiceRepository } from './repositories/ServiceRepository.js';
import { StaffRepository } from './repositories/StaffRepository.js';
import { AvailabilityRepository } from './repositories/AvailabilityRepository.js';
import { BookingRepository } from './repositories/BookingRepository.js';
import { VerificationRepository } from './repositories/VerificationRepository.js';
import { createAuthRoutes } from './routes/auth.js';
import { createEventRoutes } from './routes/events.js';
import { createServiceRoutes } from './routes/services.js';
import { createStaffRoutes } from './routes/staff.js';
import { createAvailabilityRoutes } from './routes/availability.js';
import { createAgendaRoutes } from './routes/agenda.js';
import { createVerificationRoutes } from './routes/verification.js';
import { createParentRoutes } from './routes/parents.js';
import { createBookingRoutes } from './routes/bookings.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function securityHeaders(req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  res.set('X-Frame-Options', 'DENY');
  res.set(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' http: https: data:; font-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  );
  next();
}

function rejectCrossSiteMutation(req, res, next) {
  if (!MUTATING.has(req.method)) {
    next();
    return;
  }
  if (req.get('x-requested-with') !== 'XMLHttpRequest') {
    next(new ForbiddenError('This action must be sent from the conferences app'));
    return;
  }
  const origin = req.get('origin');
  if (origin) {
    let host = '';
    try {
      host = new URL(origin).host;
    } catch {
      host = '';
    }
    if (host !== req.get('host')) {
      next(new ForbiddenError('Cross-origin request rejected'));
      return;
    }
  }
  next();
}

export function createApp(config) {
  const db = openDatabase(config.dbPath, config.schemaPath);
  const repos = {
    events: new EventRepository(db),
    services: new ServiceRepository(db),
    staff: new StaffRepository(db),
    availability: new AvailabilityRepository(db),
    bookings: new BookingRepository(db),
    verifications: new VerificationRepository(db),
  };
  const psapi = config.psapiClient || createPsapiClient(config.psapi);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.locals.db = db;
  app.locals.repos = repos;
  app.locals.psapi = psapi;

  app.use(securityHeaders);
  app.use(express.json({ limit: '64kb' }));
  app.use((req, res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    const session = readSessionToken(cookies[SESSION_COOKIE], config.sessionSecret);
    req.user = session ? resolveRole(session.email, config.roleMap) : null;
    next();
  });

  const api = express.Router();
  api.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  api.use(rejectCrossSiteMutation);
  api.use('/auth', createAuthRoutes(config));
  api.use('/auth', createVerificationRoutes({
    verifications: repos.verifications,
    mail: config.mail || { configured: false },
    exposeDevCode: Boolean(config.exposeDevCode),
  }));
  api.use(createParentRoutes({ repos, psapi, timeZone: config.timeZone }));
  api.use(createBookingRoutes({ repos, psapi, timeZone: config.timeZone }));
  api.use(createEventRoutes({ repos, timeZone: config.timeZone }));
  api.use(createServiceRoutes({ repos }));
  api.use(createStaffRoutes({ repos, psapi }));
  api.use(createAvailabilityRoutes({ repos, timeZone: config.timeZone }));
  api.use(createAgendaRoutes({ repos, timeZone: config.timeZone }));
  api.use((req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  app.use('/api/v1', api);
  app.use('/api', (req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });
  app.use(express.static(config.publicDir, { index: 'index.html' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
      return;
    }
    res.sendFile(path.join(config.publicDir, 'index.html'), (error) => {
      if (error) next(error);
    });
  });
  app.use(errorHandler);
  return app;
}
