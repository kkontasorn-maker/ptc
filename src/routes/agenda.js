import express from 'express';
import { ForbiddenError, NotFoundError } from '../errors.js';
import { assertEventVisible, requireAuth } from '../auth/access.js';
import { presentEvent } from '../present.js';
import { parseRouteId } from '../validate.js';

const MISSING_STAFF = 'Your staff record is not on file. Ask ICT to sync teachers from PowerSchool.';

export function createAgendaRoutes({ repos, timeZone }) {
  const router = express.Router();

  // Teacher agenda only. staff_id in the query or body is ignored: the
  // staff row comes from the session's powerschool teacher id.
  router.get('/events/:eventId/my-schedule', requireAuth, (req, res) => {
    if (req.user.role !== 'teacher') {
      throw new ForbiddenError('You do not have access to this action');
    }
    const eventId = parseRouteId(req.params.eventId, 'Event id');
    const event = assertEventVisible(repos.events.findById(eventId), req.user.role);
    const staff = req.user.teacherid
      ? repos.staff.findByTeacherId(req.user.teacherid)
      : null;
    if (!staff) throw new NotFoundError(MISSING_STAFF);
    res.json({
      event: presentEvent(event, timeZone),
      staff: {
        id: staff.id,
        display_name: staff.display_name,
        powerschool_teacher_id: staff.powerschool_teacher_id,
      },
      services: repos.services.listForStaffEvent(event.id, staff.id),
      blocks: repos.availability.listForStaffEvent(event.id, staff.id),
      bookings: repos.bookings.listConfirmedForStaffEvent(event.id, staff.id),
    });
  });

  return router;
}
