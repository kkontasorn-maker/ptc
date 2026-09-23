function mapBooking(row) {
  return {
    id: row.id,
    event_id: row.event_id,
    service_id: row.service_id,
    staff_id: row.staff_id,
    start_time: row.start_time,
    end_time: row.end_time,
    student_powerschool_id: row.student_powerschool_id,
    parent_email: String(row.parent_email || '').trim().toLowerCase(),
  };
}

export class BookingRepository {
  constructor(db) {
    this.confirmedForEventStmt = db.prepare(`
      SELECT id, event_id, service_id, staff_id, start_time, end_time,
             student_powerschool_id, parent_email
      FROM bookings
      WHERE event_id = ? AND status = 'confirmed'
      ORDER BY start_time ASC, id ASC
    `);
  }

  listConfirmedForEvent(eventId) {
    return this.confirmedForEventStmt.all(eventId).map(mapBooking);
  }
}
