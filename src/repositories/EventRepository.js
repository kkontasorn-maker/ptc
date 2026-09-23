function mapEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    event_date: row.event_date,
    cutoff_at: row.cutoff_at,
    is_open_for_booking: row.is_open_for_booking === 1,
    summary_sent_at: row.summary_sent_at,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class EventRepository {
  constructor(db) {
    this.db = db;
    this.insertStmt = db.prepare(`
      INSERT INTO events (name, event_date, cutoff_at, is_open_for_booking, created_by)
      VALUES (@name, @event_date, @cutoff_at, 0, @created_by)
    `);
    this.findStmt = db.prepare('SELECT * FROM events WHERE id = ?');
    this.listStmt = db.prepare('SELECT * FROM events ORDER BY event_date ASC, id ASC');
    this.countBookingsStmt = db.prepare('SELECT COUNT(*) AS n FROM bookings WHERE event_id = ?');
    this.deleteStmt = db.prepare('DELETE FROM events WHERE id = ?');
    this.claimSummaryStmt = db.prepare(`
      UPDATE events
      SET summary_sent_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND summary_sent_at IS NULL
    `);
    this.clearSummaryStmt = db.prepare(`
      UPDATE events
      SET summary_sent_at = NULL, updated_at = datetime('now')
      WHERE id = ?
    `);
  }

  list() {
    return this.listStmt.all().map(mapEvent);
  }

  findById(id) {
    return mapEvent(this.findStmt.get(id));
  }

  create({ name, event_date, cutoff_at, created_by }) {
    const info = this.insertStmt.run({ name, event_date, cutoff_at, created_by });
    return this.findById(Number(info.lastInsertRowid));
  }

  update(id, fields) {
    const allowed = ['name', 'event_date', 'cutoff_at', 'is_open_for_booking'];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(fields, key)) {
        sets.push(`${key} = ?`);
        params.push(fields[key]);
      }
    }
    if (sets.length === 0) return this.findById(id);
    sets.push("updated_at = datetime('now')");
    params.push(id);
    const info = this.db.prepare(`UPDATE events SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    if (info.changes === 0) return null;
    return this.findById(id);
  }

  countBookings(eventId) {
    // Any booking row blocks deletion, including cancelled. The spec says
    // "only if no bookings exist" and does not say to ignore cancelled rows.
    return this.countBookingsStmt.get(eventId).n;
  }

  claimSummary(id) {
    return this.claimSummaryStmt.run(id).changes === 1;
  }

  clearSummary(id) {
    this.clearSummaryStmt.run(id);
  }

  deleteIfNoBookings(id) {
    return this.db.transaction((eventId) => {
      const event = this.findById(eventId);
      if (!event) return { missing: true };
      const bookings = this.countBookings(eventId);
      if (bookings > 0) return { conflict: true };
      this.deleteStmt.run(eventId);
      return { deleted: true };
    })(id);
  }
}
