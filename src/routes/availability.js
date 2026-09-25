import express from 'express';
import { ConflictError, LockedError, NotFoundError } from '../errors.js';
import {
  assertCanReadAvailability,
  assertCanWriteAvailability,
  assertEventVisible,
  rejectFrontOfficeWrite,
  requireAuth,
} from '../auth/access.js';
import { notifyStrandedParents, readConfirmOverride, rejectIfStranded } from '../conflicts.js';
import { asyncHandler } from '../http.js';
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

export function createAvailabilityRoutes({ repos, timeZone, mail }) {
  const router = express.Router();

  router.get('/events/:eventId/staff/:staffId/availability', requireAuth, (req, res) => {
    const eventId = parseRouteId(req.params.eventId, 'Event id');
    const staffId = parseRouteId(req.params.staffId, 'Staff id');
    const event = assertEventVisible(repos.events.findById(eventId), req.user.activeRole);
    const staff = repos.staff.findById(staffId);
    if (!staff) throw new NotFoundError('Staff not found');
    assertCanReadAvailability(req.user, staff);
    res.json({
      event_id: event.id,
      staff_id: staff.id,
      blocks: repos.availability.listForStaffEvent(eventId, staffId),
    });
  });

  router.post('/events/:eventId/staff/:staffId/availability', requireAuth, rejectFrontOfficeWrite, asyncHandler(async (req, res) => {
    const eventId = parseRouteId(req.params.eventId, 'Event id');
    const staffId = parseRouteId(req.params.staffId, 'Staff id');
    const event = assertEventVisible(repos.events.findById(eventId), req.user.activeRole);
    const staff = repos.staff.findById(staffId);
    if (!staff) throw new NotFoundError('Staff not found');
    assertCanWriteAvailability(req.user, staff);
    assertOpenForChanges(event, timeZone);
    const reason = readConfirmOverride(req.body);
    const input = validateAvailabilityCreate(req.body, timeZone);
    const affected = input.block_type === 'break'
      ? repos.bookings.listConfirmedOverlapping(staffId, eventId, input.end_time, input.start_time)
      : [];
    rejectIfStranded(affected, reason, 'This break overlaps confirmed bookings');
    const saved = repos.bookings.db.transaction(() => {
      const block = repos.availability.create({
        staff_id: staffId,
        event_id: eventId,
        start_time: input.start_time,
        end_time: input.end_time,
        block_type: input.block_type,
      });
      const stranded = affected.length
        ? repos.bookings.strandBookings(affected, { reason, createdBy: req.user.email })
        : [];
      return { block, stranded };
    })();
    if (saved.stranded.length) {
      await notifyStrandedParents({
        mail,
        teacherName: staff.display_name,
        eventDate: event.event_date,
        rows: saved.stranded,
        markNotified: (logIds) => repos.bookings.markConflictNotified(logIds),
      });
    }
    res.status(201).json({ block: saved.block });
  }));

  router.patch('/availability/:id', requireAuth, rejectFrontOfficeWrite, (req, res) => {
    const id = parseRouteId(req.params.id, 'Availability id');
    const existing = repos.availability.findById(id);
    if (!existing) throw new NotFoundError('Availability block not found');
    const staff = repos.staff.findById(existing.staff_id);
    if (!staff) throw new NotFoundError('Staff not found');
    assertCanWriteAvailability(req.user, staff);
    const event = assertEventVisible(repos.events.findById(existing.event_id), req.user.activeRole);
    assertOpenForChanges(event, timeZone);
    const input = validateAvailabilityPatch(req.body, existing, timeZone);
    const block = repos.availability.update(id, input);
    if (!block) throw new NotFoundError('Availability block not found');
    res.json({ block });
  });

  router.delete('/availability/:id', requireAuth, rejectFrontOfficeWrite, (req, res) => {
    const id = parseRouteId(req.params.id, 'Availability id');
    const existing = repos.availability.findById(id);
    if (!existing) throw new NotFoundError('Availability block not found');
    const staff = repos.staff.findById(existing.staff_id);
    if (!staff) throw new NotFoundError('Staff not found');
    assertCanWriteAvailability(req.user, staff);
    const event = assertEventVisible(repos.events.findById(existing.event_id), req.user.activeRole);
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
