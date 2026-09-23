import crypto from 'node:crypto';
import express from 'express';
import { readDeviceToken } from '../auth/session.js';
import {
  ConflictError,
  ForbiddenError,
  LockedError,
  NoStudentMatchError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../errors.js';
import { asyncHandler } from '../http.js';
import { guardianStudents } from '../psapi/guardian-cache.js';
import { formatCutoffMessage, isPastCutoff } from '../time.js';
import { normalizeEmail, parseRouteId, validateBookingCreate, validateReschedule } from '../validate.js';

const BATCH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireDevice(req, email, verifications) {
  const token = readDeviceToken(req.headers.cookie);
  if (!token || !verifications.findValid(email, token)) {
    throw new UnauthorizedError('Verify your email before continuing.');
  }
}

function deviceEmail(req, verifications) {
  const token = readDeviceToken(req.headers.cookie);
  if (!token) return null;
  return verifications.findValidByToken(token)?.email || null;
}

function assertOpen(event) {
  if (!event || !event.is_open_for_booking) throw new NotFoundError('Event not found');
}

function assertBeforeCutoff(event, timeZone) {
  if (isPastCutoff(event.cutoff_at)) {
    throw new LockedError(formatCutoffMessage(event.cutoff_at, timeZone));
  }
}

function roomFor(assignment, psRoom) {
  if (typeof assignment?.room_override === 'string' && assignment.room_override.trim()) {
    return assignment.room_override;
  }
  return psRoom || null;
}

function presentBooking(row, { displayName, room }) {
  return {
    id: row.id,
    event_id: row.event_id,
    service_id: row.service_id,
    staff_id: row.staff_id,
    start_time: row.start_time,
    end_time: row.end_time,
    booking_batch_id: row.booking_batch_id,
    student_powerschool_id: row.student_powerschool_id,
    student_name: row.student_name,
    student_nickname: row.student_nickname,
    student_grade: row.student_grade,
    parent_email: row.parent_email,
    parent_first_name: row.parent_first_name,
    parent_last_name: row.parent_last_name,
    parent_relationship: row.parent_relationship,
    parent_relationship_other: row.parent_relationship_other,
    status: row.status,
    display_name: displayName,
    room,
  };
}

export function createBookingRoutes({ repos, psapi, timeZone }) {
  const router = express.Router();

  router.post('/bookings', asyncHandler(async (req, res) => {
    if (req.body && typeof req.body === 'object' && !Array.isArray(req.body) && typeof req.body.parent_email === 'string') {
      try {
        requireDevice(req, normalizeEmail(req.body.parent_email, 'parent_email'), repos.verifications);
      } catch (error) {
        if (error?.code !== 'VALIDATION') throw error;
      }
    }
    const input = validateBookingCreate(req.body, timeZone);
    requireDevice(req, input.parent_email, repos.verifications);

    const prepared = [];
    let event = null;
    for (const pick of input.picks) {
      const assignment = repos.staff.findAssignment(pick.staff_id, pick.service_id);
      if (!assignment) {
        throw new ValidationError('Choose a teacher from the conference schedule', [{
          field: 'picks',
          message: 'Choose a teacher from the conference schedule',
        }]);
      }
      const found = repos.events.findById(assignment.event_id);
      assertOpen(found);
      if (!event) event = found;
      else if (event.id !== found.id) {
        throw new ValidationError('Book one conference at a time', [{
          field: 'picks',
          message: 'Book one conference at a time',
        }]);
      }
      prepared.push({ pick, assignment });
    }
    assertBeforeCutoff(event, timeZone);

    const students = await guardianStudents(psapi, input.parent_email);
    if (students.length === 0) throw new NoStudentMatchError();
    const byStudent = new Map(students.map((student) => [student.student_powerschool_id, student]));
    const batchId = crypto.randomUUID();
    const items = prepared.map(({ pick, assignment }) => {
      const student = byStudent.get(pick.student_powerschool_id);
      if (!student) {
        throw new ValidationError('Choose a student linked to this email', [{
          field: 'picks',
          message: 'Choose a student linked to this email',
        }]);
      }
      const psTeacher = student.teachers.find((teacher) => (
        teacher.powerschool_teacher_id === assignment.powerschool_teacher_id
      ));
      if (!psTeacher) {
        throw new ValidationError("That teacher is not on this student's schedule", [{
          field: 'picks',
          message: "That teacher is not on this student's schedule",
        }]);
      }
      return {
        event_id: event.id,
        service_id: pick.service_id,
        staff_id: pick.staff_id,
        start_time: pick.start_time,
        end_time: pick.end_time,
        booking_batch_id: batchId,
        student_powerschool_id: student.student_powerschool_id,
        student_name: student.name,
        student_nickname: student.nickname,
        student_grade: student.grade,
        parent_email: input.parent_email,
        parent_first_name: input.parent_first_name,
        parent_last_name: input.parent_last_name,
        parent_relationship: input.parent_relationship,
        parent_relationship_other: input.parent_relationship_other,
        slot_duration_minutes: assignment.slot_duration_minutes,
        display_name: assignment.display_name,
        room: roomFor(assignment, psTeacher.room),
      };
    });

    const saved = repos.bookings.claim(items, { timeZone, availability: repos.availability });
    const meta = new Map(items.map((item) => [`${item.staff_id}:${item.service_id}:${item.start_time}`, item]));
    res.status(201).json({
      booking_batch_id: batchId,
      bookings: saved.map((row) => {
        const item = meta.get(`${row.staff_id}:${row.service_id}:${row.start_time}`);
        return presentBooking(row, { displayName: item.display_name, room: item.room });
      }),
    });
  }));

  router.patch('/bookings/:id/reschedule', asyncHandler(async (req, res) => {
    const id = parseRouteId(req.params.id, 'Booking id');
    const next = validateReschedule(req.body, timeZone);
    const booking = repos.bookings.findById(id);
    if (!booking || booking.status !== 'confirmed') throw new NotFoundError('Booking not found');
    const assignment = repos.staff.findAssignment(booking.staff_id, booking.service_id);
    assertCanChange(req, booking, assignment, repos.verifications);
    if (!assignment) {
      throw new ValidationError('That teacher is not on this conference', [{
        field: 'staff_id',
        message: 'That teacher is not on this conference',
      }]);
    }
    const event = repos.events.findById(booking.event_id);
    assertOpen(event);
    assertBeforeCutoff(event, timeZone);
    const moved = repos.bookings.move(booking, next.start_time, next.end_time, {
      timeZone,
      availability: repos.availability,
      slotDuration: assignment.slot_duration_minutes,
    });
    if (!moved) throw new NotFoundError('Booking not found');
    const room = await roomForBooking(psapi, moved, assignment);
    res.json({
      booking: presentBooking(moved, { displayName: assignment.display_name, room }),
    });
  }));

  router.delete('/bookings/batch/:batchId', asyncHandler(async (req, res) => {
    if (!BATCH_ID.test(req.params.batchId || '')) {
      throw new ValidationError('Visit id must be a UUID', [{
        field: 'batchId',
        message: 'Visit id must be a UUID',
      }]);
    }
    const rows = repos.bookings.listByBatch(req.params.batchId);
    if (rows.length === 0) throw new NotFoundError('Visit not found');
    const email = deviceEmail(req, repos.verifications);
    if (!email) throw new UnauthorizedError('Verify your email before continuing.');
    if (rows.some((row) => row.parent_email !== email)) {
      throw new ForbiddenError('You do not have access to this booking');
    }
    const event = repos.events.findById(rows[0].event_id);
    assertOpen(event);
    assertBeforeCutoff(event, timeZone);
    if (rows.some((row) => row.event_id !== event.id)) {
      throw new ConflictError('This visit covers more than one conference');
    }
    repos.bookings.cancelBatch(req.params.batchId);
    res.json({ ok: true });
  }));

  router.delete('/bookings/:id', asyncHandler(async (req, res) => {
    const id = parseRouteId(req.params.id, 'Booking id');
    const booking = repos.bookings.findById(id);
    if (!booking) throw new NotFoundError('Booking not found');
    const assignment = repos.staff.findAssignment(booking.staff_id, booking.service_id);
    assertCanChange(req, booking, assignment, repos.verifications);
    if (booking.status === 'cancelled') {
      res.json({ ok: true });
      return;
    }
    const event = repos.events.findById(booking.event_id);
    assertOpen(event);
    assertBeforeCutoff(event, timeZone);
    repos.bookings.cancel(id);
    res.json({ ok: true });
  }));

  return router;
}

function assertCanChange(req, booking, assignment, verifications) {
  const email = deviceEmail(req, verifications);
  const parentMatch = Boolean(email) && email === booking.parent_email;
  const teacherMatch = req.user?.role === 'teacher'
    && Boolean(req.user.teacherid)
    && assignment
    && req.user.teacherid === assignment.powerschool_teacher_id;
  if (parentMatch || teacherMatch) return;
  if (!email && !req.user) throw new UnauthorizedError('Verify your email before continuing.');
  throw new ForbiddenError('You do not have access to this booking');
}

async function roomForBooking(psapi, booking, assignment) {
  let psRoom = null;
  try {
    const students = await guardianStudents(psapi, booking.parent_email);
    const student = students.find((item) => item.student_powerschool_id === booking.student_powerschool_id);
    psRoom = student?.teachers.find((teacher) => (
      teacher.powerschool_teacher_id === assignment?.powerschool_teacher_id
    ))?.room || null;
  } catch (error) {
    console.error(error);
  }
  return roomFor(assignment, psRoom);
}
