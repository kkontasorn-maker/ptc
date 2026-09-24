import express from 'express';
import { readDeviceToken } from '../auth/session.js';
import { NoStudentMatchError, NotFoundError, UnauthorizedError } from '../errors.js';
import { asyncHandler } from '../http.js';
import { buildParentView, presentChildren } from '../parent-view.js';
import { guardianStudents } from '../psapi/guardian-cache.js';
import { normalizeEmail, parseRouteId, validateContactPreference } from '../validate.js';

function requireDevice(req, email, verifications) {
  const token = readDeviceToken(req.headers.cookie);
  if (!token || !verifications.findValid(email, token)) {
    throw new UnauthorizedError('Verify your email before continuing.');
  }
}

async function matchedStudents(psapi, email) {
  const students = await guardianStudents(psapi, email);
  if (students.length === 0) throw new NoStudentMatchError();
  return students;
}

export function createParentRoutes({ repos, psapi, timeZone }) {
  const router = express.Router();

  router.get('/parents/me/children', asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.query.email);
    requireDevice(req, email, repos.verifications);
    const students = await matchedStudents(psapi, email);
    res.json(presentChildren(students));
  }));

  router.patch('/parents/me/contact-preference', asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    requireDevice(req, email, repos.verifications);
    const preference = validateContactPreference(req.body);
    res.json({ preference: repos.notifications.upsertPreference(preference) });
  }));

  router.get('/events/:eventId/parent-view', asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.query.email);
    requireDevice(req, email, repos.verifications);
    const eventId = parseRouteId(req.params.eventId, 'Event id');
    const event = repos.events.findById(eventId);
    if (!event || !event.is_open_for_booking) {
      throw new NotFoundError('Event not found');
    }
    const students = await matchedStudents(psapi, email);
    const view = buildParentView({
      students,
      schedule: repos.staff.listSchedule(eventId),
      bookableBlocks: repos.availability.listBookableForEvent(eventId),
      bookings: repos.bookings.listConfirmedForEvent(eventId),
      parentEmail: email,
      timeZone,
    });
    res.json({
      ...view,
      custom_field_definitions: repos.customFields.listForEvent(eventId).map((field) => ({
        id: field.id,
        event_id: field.event_id,
        label: field.label,
        required: field.required,
        position: field.position,
      })),
    });
  }));

  return router;
}
