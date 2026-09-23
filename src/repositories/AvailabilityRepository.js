function mapBlock(row) {
  if (!row) return null;
  return {
    id: row.id,
    staff_id: row.staff_id,
    event_id: row.event_id,
    start_time: row.start_time,
    end_time: row.end_time,
    block_type: row.block_type,
  };
}

export class AvailabilityRepository {
  constructor(db) {
    this.db = db;
    this.listStmt = db.prepare(`
      SELECT * FROM availability_blocks
      WHERE event_id = ? AND staff_id = ?
      ORDER BY start_time ASC, id ASC
    `);
    this.findStmt = db.prepare('SELECT * FROM availability_blocks WHERE id = ?');
    this.insertStmt = db.prepare(`
      INSERT INTO availability_blocks (staff_id, event_id, start_time, end_time, block_type)
      VALUES (@staff_id, @event_id, @start_time, @end_time, @block_type)
    `);
    this.deleteStmt = db.prepare('DELETE FROM availability_blocks WHERE id = ?');
    this.bookableForEventStmt = db.prepare(`
      SELECT * FROM availability_blocks
      WHERE event_id = ? AND block_type = 'bookable'
      ORDER BY staff_id ASC, start_time ASC, id ASC
    `);
    this.overlapStmt = db.prepare(`
      SELECT COUNT(*) AS n FROM bookings
      WHERE staff_id = ?
        AND event_id = ?
        AND status = 'confirmed'
        AND start_time < ?
        AND end_time > ?
    `);
  }

  listForStaffEvent(eventId, staffId) {
    return this.listStmt.all(eventId, staffId).map(mapBlock);
  }

  listBookableForEvent(eventId) {
    return this.bookableForEventStmt.all(eventId).map(mapBlock);
  }

  findById(id) {
    return mapBlock(this.findStmt.get(id));
  }

  create(fields) {
    const info = this.insertStmt.run(fields);
    return this.findById(Number(info.lastInsertRowid));
  }

  update(id, fields) {
    const info = this.db.prepare(`
      UPDATE availability_blocks
      SET start_time = ?, end_time = ?
      WHERE id = ?
    `).run(fields.start_time, fields.end_time, id);
    if (info.changes === 0) return null;
    return this.findById(id);
  }

  countConfirmedBookingsInside(block) {
    return this.overlapStmt.get(
      block.staff_id,
      block.event_id,
      block.end_time,
      block.start_time,
    ).n;
  }

  deleteIfNoConfirmedBooking(id) {
    return this.db.transaction((blockId) => {
      const block = this.findById(blockId);
      if (!block) return { missing: true };
      if (this.countConfirmedBookingsInside(block) > 0) return { conflict: true };
      this.deleteStmt.run(blockId);
      return { deleted: true };
    })(id);
  }
}
