import express from 'express';
import { rejectFrontOfficeWrite, requireAuth, requireItAdminOrFrontOffice } from '../auth/access.js';
import { ForbiddenError, UnauthorizedError } from '../errors.js';
import { asyncHandler } from '../http.js';
import { verifyEmailWebhook } from '../mail/webhooks.js';
import { normalizeEmail } from '../validate.js';

export function createNotificationRoutes({ repos, webhook, staleHours }) {
  const router = express.Router();

  router.get('/admin/parents/contact-preference', requireItAdminOrFrontOffice, (req, res) => {
    const email = normalizeEmail(req.query.email);
    res.json({ preference: repos.notifications.findPreference(email) });
  });

  router.get('/admin/notifications/delivery-issues', requireItAdminOrFrontOffice, (req, res) => {
    res.json({ issues: repos.notifications.listDeliveryIssues(staleHours) });
  });

  router.post(
    '/admin/notifications/delivery-issues',
    requireAuth,
    rejectFrontOfficeWrite,
    (req, res, next) => {
      next(new ForbiddenError('Notification issues are read-only'));
    },
  );

  router.post('/webhooks/email-status', asyncHandler(async (req, res) => {
    const result = verifyEmailWebhook({
      provider: webhook?.provider,
      secret: webhook?.secret,
      rawBody: req.rawBody,
      headers: req.headers,
    });
    if (!result.ok) {
      const configured = result.reason !== 'not_configured' && result.reason !== 'unsupported_provider';
      throw new UnauthorizedError(configured
        ? 'Invalid email webhook signature'
        : 'Email webhook verification is not configured');
    }
    let updated = 0;
    for (const item of result.events || []) {
      updated += repos.notifications.applyStatus({
        providerMessageId: item.provider_message_id,
        status: item.status,
        statusDetail: item.status_detail,
      });
    }
    res.json({ ok: true, updated });
  }));

  return router;
}
