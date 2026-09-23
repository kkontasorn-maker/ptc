import express from 'express';
import { ConflictError, LockedError, NotFoundError } from '../errors.js';
import {
  assertCanReadAvailability,
  assertCanWriteAvailability,
  assertEventVisible,
  requireAuth,
} from '../auth/access.js';
import { formatCutoffMessage, isPastCutoff } from '../time.js';
import {
  parseRouteId,
  validateAvailabilityCreate,
  validateAvailabilityPatch,
} from '../validate.js';

function assertOpenForChanges(event, timeZone) {
  if (isPastCutoff(event.cutoff_at)) {
    throw new LockedError(formatCutoffMessage(event.cutoff_at, timeZone));
  }
}

export function createAvailabilityRoutes({ repos, timeZone }) {
  const router = express.Router();

  router.get('/events/:eventId/staff/:staffId/availability', requireAuth, (req, res) => {
    const eventId = parseRouteId(req.params.eventId, 'Event id');
    const staffId = parseRouteId(req.params.staffId, 'Staff id');
    const event = assertEventVisible(repos.events.findById(eventId), req.user.role);
    const staff = repos.staff.findById(staffId);
    if (!staff) throw new NotFoundError('Staff not found');
    assertCanReadAvailability(req.user, staff);
    res.json({
      event_id: event.id,
      staff_id: staff.id,
      blocks: repos.availability.listForStaffEvent(eventId, staffId),
    });
  });

  router.post('/events/:eventId/staff/:staffId/availability', requireAuth, (req, res) => {
    const eventId = parseRouteId(req.params.eventId, 'Event id');
    const staffId = parseRouteId(req.params.staffId, 'Staff id');
    const event = assertEventVisible(repos.events.findById(eventId), req.user.role);
    const staff = repos.staff.findById(staffId);
    if (!staff) throw new NotFoundError('Staff not found');
    assertCanWriteAvailability(req.user, staff);
    assertOpenForChanges(event, timeZone);
    const input = validateAvailabilityCreate(req.body, timeZone);
    const block = repos.availability.create({
      staff_id: staffId,
      event_id: eventId,
      ...input,
    });
    res.status(201).json({ block });
  });

  router.patch('/availability/:id', requireAuth, (req, res) => {
    const id = parseRouteId(req.params.id, 'Availability id');
    const existing = repos.availability.findById(id);
    if (!existing) throw new NotFoundError('Availability block not found');
    const staff = repos.staff.findById(existing.staff_id);
    if (!staff) throw new NotFoundError('Staff not found');
    assertCanWriteAvailability(req.user, staff);
    const event = assertEventVisible(repos.events.findById(existing.event_id), req.user.role);
    assertOpenForChanges(event, timeZone);
    const input = validateAvailabilityPatch(req.body, existing, timeZone);
    const block = repos.availability.update(id, input);
    if (!block) throw new NotFoundError('Availability block not found');
    res.json({ block });
  });

  router.delete('/availability/:id', requireAuth, (req, res) => {
    const id = parseRouteId(req.params.id, 'Availability id');
    const existing = repos.availability.findById(id);
    if (!existing) throw new NotFoundError('Availability block not found');
    const staff = repos.staff.findById(existing.staff_id);
    if (!staff) throw new NotFoundError('Staff not found');
    assertCanWriteAvailability(req.user, staff);
    const event = assertEventVisible(repos.events.findById(existing.event_id), req.user.role);
    assertOpenForChanges(event, timeZone);
    const result = repos.availability.deleteIfNoConfirmedBooking(id);
    if (result.missing) throw new NotFoundError('Availability block not found');
    if (result.conflict) {
      throw new ConflictError('This block cannot be deleted because a confirmed booking falls inside it');
    }
    res.json({ ok: true });
  });

  return router;
}
