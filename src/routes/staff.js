import express from 'express';
import { ConflictError, NotFoundError } from '../errors.js';
import { requireAuth, requireItAdmin } from '../auth/access.js';
import { asyncHandler } from '../http.js';
import { presentMergedStaff, safePhotoUrl } from '../present.js';
import { mergeStaff } from '../staff-merge.js';
import { parseRouteId, validateStaffAssign, validateStaffPatch } from '../validate.js';

function presentRecord(staff) {
  return {
    id: staff.id,
    powerschool_teacher_id: staff.powerschool_teacher_id,
    display_name: staff.display_name,
    email: staff.email,
    photo_url: safePhotoUrl(staff.photo_url),
    active: staff.active,
  };
}

function prepareTeachers(teachers) {
  const usable = [];
  let skipped = 0;
  for (const teacher of teachers) {
    const email = String(teacher.email || '').trim().toLowerCase();
    const powerschoolTeacherId = String(teacher.powerschool_teacher_id || '').trim();
    const displayName = String(teacher.display_name || '').trim();
    if (!powerschoolTeacherId || !displayName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      skipped += 1;
      continue;
    }
    usable.push({
      powerschool_teacher_id: powerschoolTeacherId,
      display_name: displayName,
      email,
      photo_url: teacher.photo_url ?? null,
    });
  }
  return { usable, skipped };
}

async function loadPowerschool(psapi) {
  try {
    return { listed: await psapi.listTeachers(), warning: null };
  } catch (error) {
    if (!psapi.configured) throw error;
    return {
      listed: null,
      warning: error instanceof Error ? error.message : 'PowerSchool could not be reached',
    };
  }
}

export function createStaffRoutes({ repos, psapi }) {
  const router = express.Router();

  router.get('/staff', requireAuth, asyncHandler(async (req, res) => {
    if (!['it_admin', 'front_office', 'teacher'].includes(req.user.role)) {
      res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'You do not have access to this action' },
      });
      return;
    }
    const { listed, warning } = await loadPowerschool(psapi);
    if (!listed) {
      const staff = repos.staff.list().map((row) => presentMergedStaff({
        ...row,
        synced: true,
        in_powerschool: false,
        powerschool_room: null,
      }));
      res.json({
        source: 'local',
        warning: warning || 'PowerSchool could not be reached. Showing saved staff only.',
        staff,
      });
      return;
    }
    const staff = mergeStaff(listed.teachers, repos.staff.list()).map(presentMergedStaff);
    res.json({ source: listed.source, staff });
  }));

  router.post('/staff/sync', requireItAdmin, asyncHandler(async (req, res) => {
    const listed = await psapi.listTeachers();
    const { usable, skipped } = prepareTeachers(listed.teachers);
    const counts = repos.staff.sync(usable);
    const staff = mergeStaff(listed.teachers, repos.staff.list()).map(presentMergedStaff);
    res.json({
      source: listed.source,
      created: counts.created,
      updated: counts.updated,
      unchanged: counts.unchanged,
      skipped,
      staff,
    });
  }));

  router.patch('/staff/:id', requireItAdmin, (req, res) => {
    const id = parseRouteId(req.params.id, 'Staff id');
    if (!repos.staff.findById(id)) throw new NotFoundError('Staff not found');
    const patch = validateStaffPatch(req.body);
    const staff = repos.staff.updateOverrides(id, patch);
    if (!staff) throw new NotFoundError('Staff not found');
    res.json({ staff: presentRecord(staff) });
  });

  router.post('/services/:serviceId/staff', requireItAdmin, (req, res) => {
    const serviceId = parseRouteId(req.params.serviceId, 'Service id');
    const service = repos.services.findById(serviceId);
    if (!service) throw new NotFoundError('Service not found');
    const { staff_id: staffId } = validateStaffAssign(req.body);
    if (!repos.staff.findById(staffId)) throw new NotFoundError('Staff not found');
    const result = repos.staff.assign(serviceId, staffId);
    if (result.conflict) throw new ConflictError('That staff member is already assigned to this service');
    res.status(201).json(result);
  });

  router.delete('/services/:serviceId/staff/:staffId', requireItAdmin, (req, res) => {
    const serviceId = parseRouteId(req.params.serviceId, 'Service id');
    const staffId = parseRouteId(req.params.staffId, 'Staff id');
    if (!repos.services.findById(serviceId)) throw new NotFoundError('Service not found');
    if (!repos.staff.findById(staffId)) throw new NotFoundError('Staff not found');
    const removed = repos.staff.unassign(serviceId, staffId);
    if (!removed) throw new NotFoundError('That staff member is not assigned to this service');
    res.json({ ok: true });
  });

  return router;
}
