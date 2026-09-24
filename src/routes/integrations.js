import express from 'express';
import { requireItAdmin } from '../auth/access.js';
import { RateLimitError, ValidationError } from '../errors.js';
import { asyncHandler } from '../http.js';
import { formatInZone } from '../time.js';

const TEST_LIMIT = 5;
const TEST_WINDOW_MS = 60_000;

function presentStatus(status, timeZone) {
  const at = status?.lastSuccessfulCallAt;
  return {
    connected: Boolean(status?.connected),
    last_successful_call_at: at ? formatInZone(at, timeZone) : null,
    error: status?.error ?? null,
  };
}

function rejectCredentialBody(body) {
  if (body == null) return;
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object');
  }
  if (Object.keys(body).length > 0) {
    throw new ValidationError('This action does not take any fields');
  }
}

function createTestLimiter({ limit = TEST_LIMIT, windowMs = TEST_WINDOW_MS } = {}) {
  const hits = new Map();
  return function allow(key, now = Date.now()) {
    const recent = (hits.get(key) || []).filter((stamp) => now - stamp < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      throw new RateLimitError('Wait a moment before testing PowerSchool again.');
    }
    recent.push(now);
    hits.set(key, recent);
  };
}

export function createIntegrationRoutes({ psapi, timeZone, allowTest = createTestLimiter() }) {
  const router = express.Router();

  router.get('/admin/integrations/powerschool-status', requireItAdmin, (req, res) => {
    res.json(presentStatus(psapi.connectionStatus(), timeZone));
  });

  router.post('/admin/integrations/powerschool-status/test', requireItAdmin, asyncHandler(async (req, res) => {
    rejectCredentialBody(req.body);
    allowTest(req.user.email);
    const status = await psapi.testConnection();
    res.json(presentStatus(status, timeZone));
  }));

  return router;
}
