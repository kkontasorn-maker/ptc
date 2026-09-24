import express from 'express';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { requireAuth, requireItAdmin } from '../auth/access.js';
import {
  parseRouteId,
  validateCustomFieldCreate,
  validateCustomFieldPatch,
  validateCustomFieldReorder,
} from '../validate.js';

function presentField(field) {
  return {
    id: field.id,
    event_id: field.event_id,
    label: field.label,
    required: field.required,
    position: field.position,
    created_at: field.created_at,
    updated_at: field.updated_at,
  };
}

function requireEvent(repos, eventId) {
  const event = repos.events.findById(eventId);
  if (!event) throw new NotFoundError('Event not found');
  return event;
}

export function createCustomFieldRoutes({ repos }) {
  const router = express.Router();

  router.get('/events/:eventId/custom-fields', requireAuth, (req, res) => {
    if (req.user.role !== 'it_admin' && req.user.role !== 'front_office') {
      res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'You do not have access to this action' },
      });
      return;
    }
    const eventId = parseRouteId(req.params.eventId, 'Event id');
    requireEvent(repos, eventId);
    res.json({
      custom_fields: repos.customFields.listForEvent(eventId).map(presentField),
    });
  });

  router.post('/events/:eventId/custom-fields', requireItAdmin, (req, res) => {
    const eventId = parseRouteId(req.params.eventId, 'Event id');
    requireEvent(repos, eventId);
    const input = validateCustomFieldCreate(req.body);
    try {
      const field = repos.customFields.create({
        event_id: eventId,
        label: input.label,
        required: input.required,
        position: input.position,
      });
      res.status(201).json({ custom_field: presentField(field) });
    } catch (error) {
      if (typeof error?.code === 'string' && error.code.startsWith('SQLITE_CONSTRAINT')) {
        throw new ConflictError('Another custom field already uses that position');
      }
      throw error;
    }
  });

  // Register before /:id so "reorder" is not parsed as an id.
  router.patch('/events/:eventId/custom-fields/reorder', requireItAdmin, (req, res) => {
    const eventId = parseRouteId(req.params.eventId, 'Event id');
    requireEvent(repos, eventId);
    const { ordered_ids: orderedIds } = validateCustomFieldReorder(req.body);
    const result = repos.customFields.reorder(eventId, orderedIds);
    if (result.mismatch) {
      throw new ValidationError(
        'ordered_ids must list every custom field for this event exactly once',
        [{
          field: 'ordered_ids',
          message: 'ordered_ids must list every custom field for this event exactly once',
        }],
      );
    }
    res.json({ custom_fields: result.fields.map(presentField) });
  });

  router.patch('/events/:eventId/custom-fields/:id', requireItAdmin, (req, res) => {
    const eventId = parseRouteId(req.params.eventId, 'Event id');
    requireEvent(repos, eventId);
    const id = parseRouteId(req.params.id, 'Field id');
    const existing = repos.customFields.findById(id);
    if (!existing || existing.event_id !== eventId) throw new NotFoundError('Custom field not found');
    const patch = validateCustomFieldPatch(req.body);
    try {
      const field = repos.customFields.update(id, eventId, patch);
      if (!field) throw new NotFoundError('Custom field not found');
      res.json({ custom_field: presentField(field) });
    } catch (error) {
      if (typeof error?.code === 'string' && error.code.startsWith('SQLITE_CONSTRAINT')) {
        throw new ConflictError('Another custom field already uses that position');
      }
      throw error;
    }
  });

  router.delete('/events/:eventId/custom-fields/:id', requireItAdmin, (req, res) => {
    const eventId = parseRouteId(req.params.eventId, 'Event id');
    requireEvent(repos, eventId);
    const id = parseRouteId(req.params.id, 'Field id');
    if (!repos.customFields.delete(id, eventId)) {
      throw new NotFoundError('Custom field not found');
    }
    res.json({ ok: true });
  });

  return router;
}
