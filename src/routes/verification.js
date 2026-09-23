import express from 'express';
import { readDeviceToken, setDeviceCookie } from '../auth/session.js';
import { MailError, RateLimitError, ValidationError } from '../errors.js';
import { asyncHandler } from '../http.js';
import { deliverVerificationCode, verificationPayload } from '../mail/mailer.js';
import { normalizeEmail, validateVerificationConfirm, validateVerificationRequest } from '../validate.js';

export function createVerificationRoutes({ verifications, mail, exposeDevCode }) {
  const router = express.Router();

  router.post('/verification-codes', asyncHandler(async (req, res) => {
    const { email } = validateVerificationRequest(req.body);
    const reserved = verifications.reserveCode(email);
    if (reserved.limited) throw new RateLimitError();
    try {
      await deliverVerificationCode({
        mail,
        email,
        code: reserved.code,
        relatedId: reserved.id,
      });
    } catch (error) {
      verifications.deleteCode(reserved.id);
      console.error(error);
      throw new MailError();
    }
    res.status(201).json(verificationPayload({ exposeDevCode, code: reserved.code }));
  }));

  router.post('/verification-codes/confirm', asyncHandler(async (req, res) => {
    const { email, code } = validateVerificationConfirm(req.body);
    const confirmed = verifications.confirm(email, code, readDeviceToken(req.headers.cookie));
    if (!confirmed) {
      throw new ValidationError('That code is not valid', [{
        field: 'code',
        message: 'That code is not valid',
      }]);
    }
    setDeviceCookie(res, confirmed.deviceToken);
    res.json({ ok: true });
  }));

  router.get('/device-status', (req, res) => {
    const email = normalizeEmail(req.query.email);
    const token = readDeviceToken(req.headers.cookie);
    const verified = Boolean(token && verifications.findValid(email, token));
    res.json({ verified });
  });

  return router;
}
