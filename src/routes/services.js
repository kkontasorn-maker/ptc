import express from 'express';
import { ConflictError, NotFoundError } from '../errors.js';
import { assertEventVisible, requireAuth, requireItAdmin } from '../auth/access.js';
import { presentService } from '../present.js';
import { parseRouteId, validateServiceCreate, validateServicePatch } from '../validate.js';

function serviceResponse(repos, service) {
  const staff = repos.staff.listAssignmentsForEvent(service.event_id)
    .filter((assignment) => assignment.service_id === service.id);
  return presentService(service, staff);
}

export function createServiceRoutes({ repos }) {
  const router = express.Router();

  router.get('/events/:eventId/services', requireAuth, (req, res) => {
    const eventId = parseRouteId(req.params.eventId, 'Event id');
    assertEventVisible(repos.events.findById(eventId), req.user.role);
    const assignments = repos.staff.listAssignmentsForEvent(eventId);
    const services = repos.services.listByEvent(eventId).map((service) => presentService(
      service,
      assignments.filter((assignment) => assignment.service_id === service.id),
    ));
    res.json({ services });
  });

  router.post('/events/:eventId/services', requireItAdmin, (req, res) => {
    const eventId = parseRouteId(req.params.eventId, 'Event id');
    if (!repos.events.findById(eventId)) throw new NotFoundError('Event not found');
    const input = validateServiceCreate(req.body);
    const service = repos.services.create({ event_id: eventId, ...input });
    res.status(201).json({ service: presentService(service, []) });
  });

  router.patch('/services/:id', requireItAdmin, (req, res) => {
    const id = parseRouteId(req.params.id, 'Service id');
    if (!repos.services.findById(id)) throw new NotFoundError('Service not found');
    const patch = validateServicePatch(req.body);
    const service = repos.services.update(id, patch);
    if (!service) throw new NotFoundError('Service not found');
    res.json({ service: serviceResponse(repos, service) });
  });

  router.delete('/services/:id', requireItAdmin, (req, res) => {
    const id = parseRouteId(req.params.id, 'Service id');
    const result = repos.services.deleteIfNoBookings(id);
    if (result.missing) throw new NotFoundError('Service not found');
    if (result.conflict) {
      throw new ConflictError('This service cannot be deleted because bookings exist');
    }
    res.json({ ok: true });
  });

  return router;
}
