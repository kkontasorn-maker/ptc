import express from 'express';
import { ConflictError } from '../errors.js';
import { assertEventVisible, requireAuth, requireItAdmin } from '../auth/access.js';
import { presentEvent, presentService } from '../present.js';
import { parseRouteId, validateEventCreate, validateEventPatch } from '../validate.js';

function withStaff(services, assignments) {
  return services.map((service) => presentService(
    service,
    assignments.filter((assignment) => assignment.service_id === service.id),
  ));
}

export function createEventRoutes({ repos, timeZone }) {
  const router = express.Router();

  router.get('/events', requireAuth, (req, res) => {
    let events = repos.events.list().map((event) => presentEvent(event, timeZone));
    if (req.user.activeRole === 'parent') {
      events = events.filter((event) => event.is_open_for_booking);
    }
    res.json({ events });
  });

  router.post('/events', requireItAdmin, (req, res) => {
    const input = validateEventCreate(req.body, timeZone);
    const event = repos.events.create({ ...input, created_by: req.user.email });
    res.status(201).json({ event: presentEvent(event, timeZone) });
  });

  router.get('/events/:id', requireAuth, (req, res) => {
    const id = parseRouteId(req.params.id, 'Event id');
    const event = assertEventVisible(repos.events.findById(id), req.user.activeRole);
    const services = withStaff(repos.services.listByEvent(id), repos.staff.listAssignmentsForEvent(id));
    const assigned = new Set(services.flatMap((service) => service.staff.map((member) => member.id)));
    res.json({
      event: {
        ...presentEvent(event, timeZone),
        services,
        staff_summary: {
          service_count: services.length,
          assigned_staff_count: assigned.size,
        },
      },
    });
  });

  router.patch('/events/:id', requireItAdmin, (req, res) => {
    const id = parseRouteId(req.params.id, 'Event id');
    if (!repos.events.findById(id)) {
      assertEventVisible(null, req.user.activeRole);
    }
    const patch = validateEventPatch(req.body, timeZone);
    const event = repos.events.update(id, patch);
    if (!event) assertEventVisible(null, req.user.activeRole);
    res.json({ event: presentEvent(event, timeZone) });
  });

  router.delete('/events/:id', requireItAdmin, (req, res) => {
    const id = parseRouteId(req.params.id, 'Event id');
    const result = repos.events.deleteIfNoBookings(id);
    if (result.missing) assertEventVisible(null, req.user.activeRole);
    if (result.conflict) {
      throw new ConflictError('This event cannot be deleted because bookings exist');
    }
    res.json({ ok: true });
  });

  return router;
}
