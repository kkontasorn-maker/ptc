import { ConflictError, HttpError, ValidationError } from '../errors.js';
import { isScheduledSlot } from '../slots.js';

function affectedBooking(row) {
  return {
    id: row.id,
    student_name: row.student_name,
    parent_email: String(row.parent_email || '').trim().toLowerCase(),
    start_time: row.start_time,
    end_time: row.end_time,
  };
}

function mapBooking(row) {
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
    parent_email: String(row.parent_email || '').trim().toLowerCase(),
    parent_first_name: row.parent_first_name,
    parent_last_name: row.parent_last_name,
    parent_relationship: row.parent_relationship,
    parent_relationship_other: row.parent_relationship_other,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class BookingRepository {
  constructor(db) {
    this.db = db;
    this.confirmedForEventStmt = db.prepare(`
      SELECT id, event_id, service_id, staff_id, start_time, end_time,
             student_powerschool_id, parent_email
      FROM bookings
      WHERE event_id = ? AND status = 'confirmed'
      ORDER BY start_time ASC, id ASC
    `);
    this.confirmedForStaffEventStmt = db.prepare(`
      SELECT b.id, b.start_time, b.end_time, b.student_name, b.student_nickname,
             b.student_grade, b.parent_relationship, b.parent_relationship_other,
             b.service_id, sv.name AS service_name, sv.slot_duration_minutes
      FROM bookings b
      INNER JOIN services sv ON sv.id = b.service_id
      WHERE b.event_id = ? AND b.staff_id = ? AND b.status = 'confirmed'
      ORDER BY b.start_time ASC, b.id ASC
    `);
    this.findStmt = db.prepare('SELECT * FROM bookings WHERE id = ?');
    this.reportStmt = db.prepare(`
      SELECT b.id, b.event_id, b.service_id, b.staff_id, b.start_time, b.end_time,
             b.booking_batch_id, b.student_powerschool_id, b.student_name,
             b.student_nickname, b.student_grade, b.parent_email, b.parent_first_name,
             b.parent_last_name, b.parent_relationship, b.parent_relationship_other,
             b.status, b.needs_attention, sv.name AS service_name, s.display_name,
             s.powerschool_teacher_id, ss.room_override,
             (
               SELECT reason FROM booking_conflict_log
               WHERE booking_id = b.id
               ORDER BY id DESC
               LIMIT 1
             ) AS conflict_reason
      FROM bookings b
      INNER JOIN services sv ON sv.id = b.service_id
      INNER JOIN staff s ON s.id = b.staff_id
      LEFT JOIN staff_services ss ON ss.staff_id = b.staff_id AND ss.service_id = b.service_id
      WHERE b.event_id = ?
      ORDER BY b.start_time ASC, b.id ASC
    `);
    this.listBatchStmt = db.prepare(`
      SELECT * FROM bookings WHERE booking_batch_id = ? ORDER BY start_time ASC, id ASC
    `);
    this.overlapStmt = db.prepare(`
      SELECT COUNT(*) AS n FROM bookings
      WHERE staff_id = ?
        AND event_id = ?
        AND status = 'confirmed'
        AND start_time < ?
        AND end_time > ?
        AND id != ?
    `);
    this.insertStmt = db.prepare(`
      INSERT INTO bookings (
        event_id, service_id, staff_id, start_time, end_time, booking_batch_id,
        student_powerschool_id, student_name, student_nickname, student_grade,
        parent_email, parent_first_name, parent_last_name,
        parent_relationship, parent_relationship_other
      ) VALUES (
        @event_id, @service_id, @staff_id, @start_time, @end_time, @booking_batch_id,
        @student_powerschool_id, @student_name, @student_nickname, @student_grade,
        @parent_email, @parent_first_name, @parent_last_name,
        @parent_relationship, @parent_relationship_other
      )
    `);
    this.cancelStmt = db.prepare(`
      UPDATE bookings
      SET status = 'cancelled', needs_attention = 0, updated_at = datetime('now')
      WHERE id = ? AND status = 'confirmed'
    `);
    this.cancelBatchStmt = db.prepare(`
      UPDATE bookings
      SET status = 'cancelled', needs_attention = 0, updated_at = datetime('now')
      WHERE booking_batch_id = ? AND status = 'confirmed'
    `);
    this.moveStmt = db.prepare(`
      UPDATE bookings
      SET start_time = ?, end_time = ?, needs_attention = 0, updated_at = datetime('now')
      WHERE id = ? AND status = 'confirmed'
    `);
    this.overlapConfirmedStmt = db.prepare(`
      SELECT id, student_name, parent_email, start_time, end_time
      FROM bookings
      WHERE staff_id = ?
        AND event_id = ?
        AND status = 'confirmed'
        AND start_time < ?
        AND end_time > ?
      ORDER BY parent_email ASC, start_time ASC, id ASC
    `);
    this.serviceConfirmedStmt = db.prepare(`
      SELECT id, student_name, parent_email, start_time, end_time
      FROM bookings
      WHERE staff_id = ?
        AND service_id = ?
        AND status = 'confirmed'
      ORDER BY parent_email ASC, start_time ASC, id ASC
    `);
    this.flagStmt = db.prepare(`
      UPDATE bookings
      SET needs_attention = 1, updated_at = datetime('now')
      WHERE id = ? AND status = 'confirmed'
    `);
    this.insertConflictStmt = db.prepare(`
      INSERT INTO booking_conflict_log (booking_id, reason, created_by)
      VALUES (?, ?, ?)
    `);
    this.markNotifiedStmt = db.prepare(`
      UPDATE booking_conflict_log
      SET notified_at = datetime('now')
      WHERE id = ? AND notified_at IS NULL
    `);
  }

  listConfirmedForStaffEvent(eventId, staffId) {
    return this.confirmedForStaffEventStmt.all(eventId, staffId).map((row) => ({
      id: row.id,
      start_time: row.start_time,
      end_time: row.end_time,
      student_name: row.student_name,
      student_nickname: row.student_nickname,
      student_grade: row.student_grade,
      parent_relationship: row.parent_relationship,
      parent_relationship_other: row.parent_relationship_other,
      service_id: row.service_id,
      service_name: row.service_name,
      slot_duration_minutes: row.slot_duration_minutes,
    }));
  }

  listConfirmedForEvent(eventId) {
    return this.confirmedForEventStmt.all(eventId).map((row) => ({
      id: row.id,
      event_id: row.event_id,
      service_id: row.service_id,
      staff_id: row.staff_id,
      start_time: row.start_time,
      end_time: row.end_time,
      student_powerschool_id: row.student_powerschool_id,
      parent_email: String(row.parent_email || '').trim().toLowerCase(),
    }));
  }

  findById(id) {
    const row = this.findStmt.get(id);
    return row ? mapBooking(row) : null;
  }

  listForReport(eventId) {
    return this.reportStmt.all(eventId).map((row) => ({
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
      parent_email: String(row.parent_email || '').trim().toLowerCase(),
      parent_first_name: row.parent_first_name,
      parent_last_name: row.parent_last_name,
      parent_relationship: row.parent_relationship,
      parent_relationship_other: row.parent_relationship_other,
      status: row.status,
      needs_attention: Boolean(row.needs_attention),
      conflict_reason: row.conflict_reason || null,
      service_name: row.service_name,
      display_name: row.display_name,
      powerschool_teacher_id: row.powerschool_teacher_id,
      room_override: row.room_override,
    }));
  }

  listByBatch(batchId) {
    return this.listBatchStmt.all(batchId).map(mapBooking);
  }

  listConfirmedOverlapping(staffId, eventId, rangeEnd, rangeStart) {
    return this.overlapConfirmedStmt.all(staffId, eventId, rangeEnd, rangeStart).map(affectedBooking);
  }

  listConfirmedForStaffService(staffId, serviceId) {
    return this.serviceConfirmedStmt.all(staffId, serviceId).map(affectedBooking);
  }

  strandBookings(bookings, { reason, createdBy }) {
    const run = this.db.transaction(() => {
      const rows = [];
      for (const booking of bookings) {
        this.flagStmt.run(booking.id);
        const info = this.insertConflictStmt.run(booking.id, reason, createdBy);
        rows.push({ ...booking, log_id: Number(info.lastInsertRowid) });
      }
      return rows;
    });
    return run();
  }

  markConflictNotified(logIds) {
    const run = this.db.transaction(() => {
      for (const id of logIds) this.markNotifiedStmt.run(id);
    });
    run.immediate();
  }

  countOverlap(staffId, eventId, rangeEnd, rangeStart, excludeId = -1) {
    return this.overlapStmt.get(staffId, eventId, rangeEnd, rangeStart, excludeId).n;
  }

  claim(items, { timeZone, availability }) {
    const run = this.db.transaction(() => {
      for (const item of items) {
        this.assertSlotOpen(item, { timeZone, availability, excludeId: null });
        this.insertStmt.run(item);
      }
      return this.listByBatch(items[0].booking_batch_id);
    });
    return this.runImmediate(run);
  }

  move(booking, startTime, endTime, { timeZone, availability, slotDuration }) {
    const run = this.db.transaction(() => {
      const current = this.findById(booking.id);
      if (!current || current.status !== 'confirmed') return null;
      this.assertSlotOpen({
        staff_id: current.staff_id,
        event_id: current.event_id,
        start_time: startTime,
        end_time: endTime,
        slot_duration_minutes: slotDuration,
      }, { timeZone, availability, excludeId: current.id });
      this.moveStmt.run(startTime, endTime, current.id);
      return this.findById(current.id);
    });
    return this.runImmediate(run);
  }

  cancel(id) {
    const run = this.db.transaction(() => {
      const current = this.findById(id);
      if (!current || current.status !== 'confirmed') return current;
      this.cancelStmt.run(id);
      return this.findById(id);
    });
    return run.immediate();
  }

  cancelBatch(batchId) {
    const run = this.db.transaction(() => {
      this.cancelBatchStmt.run(batchId);
      return this.listByBatch(batchId);
    });
    return run.immediate();
  }

  assertSlotOpen(item, { timeZone, availability, excludeId }) {
    const blocks = availability.listBookableForStaffEvent(item.event_id, item.staff_id);
    if (!isScheduledSlot(blocks, item.slot_duration_minutes, item.start_time, item.end_time, timeZone)) {
      throw new ValidationError('Choose an open time from the schedule', [{
        field: 'picks',
        message: 'Choose an open time from the schedule',
      }]);
    }
    if (this.countOverlap(item.staff_id, item.event_id, item.end_time, item.start_time, excludeId ?? -1) > 0) {
      throw new ConflictError('That time was just taken. Choose another.');
    }
  }

  runImmediate(run) {
    try {
      return run.immediate();
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (typeof error?.code === 'string' && error.code.startsWith('SQLITE_CONSTRAINT')) {
        throw new ConflictError('That time was just taken. Choose another.');
      }
      throw error;
    }
  }
}
