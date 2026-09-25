function mapService(row) {
  if (!row) return null;
  return {
    id: row.id,
    event_id: row.event_id,
    name: row.name,
    slot_duration_minutes: row.slot_duration_minutes,
    school_id: row.school_id ?? null,
    active: row.active === 1 || row.active === true,
    buffer_minutes: row.buffer_minutes ?? 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class ServiceRepository {
  constructor(db) {
    this.db = db;
    this.insertStmt = db.prepare(`
      INSERT INTO services (event_id, name, slot_duration_minutes, school_id, buffer_minutes)
      VALUES (@event_id, @name, @slot_duration_minutes, @school_id, @buffer_minutes)
    `);
    this.findStmt = db.prepare('SELECT * FROM services WHERE id = ?');
    this.listStmt = db.prepare('SELECT * FROM services WHERE event_id = ? ORDER BY id ASC');
    this.listForStaffEventStmt = db.prepare(`
      SELECT sv.id, sv.name, sv.slot_duration_minutes
      FROM services sv
      INNER JOIN staff_services ss ON ss.service_id = sv.id
      WHERE sv.event_id = ? AND ss.staff_id = ?
      ORDER BY sv.id ASC
    `);
    this.countBookingsStmt = db.prepare('SELECT COUNT(*) AS n FROM bookings WHERE service_id = ?');
    this.deleteStmt = db.prepare('DELETE FROM services WHERE id = ?');
  }

  listByEvent(eventId) {
    return this.listStmt.all(eventId).map(mapService);
  }

  listForStaffEvent(eventId, staffId) {
    return this.listForStaffEventStmt.all(eventId, staffId).map((row) => ({
      id: row.id,
      name: row.name,
      slot_duration_minutes: row.slot_duration_minutes,
    }));
  }

  findById(id) {
    return mapService(this.findStmt.get(id));
  }

  create({ event_id, name, slot_duration_minutes, school_id = null, buffer_minutes = 0 }) {
    const info = this.insertStmt.run({
      event_id,
      name,
      slot_duration_minutes,
      school_id: school_id ?? null,
      buffer_minutes: buffer_minutes ?? 0,
    });
    return this.findById(Number(info.lastInsertRowid));
  }

  update(id, fields) {
    const allowed = ['name', 'slot_duration_minutes', 'school_id', 'active', 'buffer_minutes'];
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
    const info = this.db.prepare(`UPDATE services SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    if (info.changes === 0) return null;
    return this.findById(id);
  }

  countBookings(serviceId) {
    // Any booking row blocks deletion, including cancelled.
    return this.countBookingsStmt.get(serviceId).n;
  }

  deleteIfNoBookings(id) {
    return this.db.transaction((serviceId) => {
      const service = this.findById(serviceId);
      if (!service) return { missing: true };
      if (this.countBookings(serviceId) > 0) return { conflict: true };
      this.deleteStmt.run(serviceId);
      return { deleted: true };
    })(id);
  }
}
