function mapStaff(row) {
  if (!row) return null;
  return {
    id: row.id,
    powerschool_teacher_id: row.powerschool_teacher_id,
    display_name: row.display_name,
    email: row.email,
    photo_url: row.photo_url,
    active: row.active === 1,
  };
}

function mapAssignment(row) {
  return {
    id: row.id,
    powerschool_teacher_id: row.powerschool_teacher_id,
    display_name: row.display_name,
    email: row.email,
    photo_url: row.photo_url,
    active: row.active === 1,
    service_id: row.service_id,
    room_override: row.room_override,
  };
}

export class StaffRepository {
  constructor(db) {
    this.db = db;
    this.listStmt = db.prepare('SELECT * FROM staff ORDER BY display_name COLLATE NOCASE, id ASC');
    this.findStmt = db.prepare('SELECT * FROM staff WHERE id = ?');
    this.findByTeacherStmt = db.prepare('SELECT * FROM staff WHERE powerschool_teacher_id = ?');
    this.insertStmt = db.prepare(`
      INSERT INTO staff (powerschool_teacher_id, display_name, email, photo_url, active)
      VALUES (@powerschool_teacher_id, @display_name, @email, @photo_url, 1)
    `);
    this.updateEmailStmt = db.prepare('UPDATE staff SET email = ? WHERE id = ?');
    this.assignmentsForServicesStmt = db.prepare(`
      SELECT s.id, s.powerschool_teacher_id, s.display_name, s.email, s.photo_url, s.active,
             ss.service_id, ss.room_override
      FROM staff_services ss
      JOIN staff s ON s.id = ss.staff_id
      WHERE ss.service_id IN (SELECT id FROM services WHERE event_id = ?)
      ORDER BY s.display_name COLLATE NOCASE, s.id ASC
    `);
    this.assignmentStmt = db.prepare(`
      SELECT staff_id, service_id, room_override
      FROM staff_services
      WHERE staff_id = ? AND service_id = ?
    `);
    this.assignStmt = db.prepare(`
      INSERT INTO staff_services (staff_id, service_id, room_override)
      VALUES (?, ?, NULL)
    `);
    this.unassignStmt = db.prepare('DELETE FROM staff_services WHERE staff_id = ? AND service_id = ?');
  }

  list() {
    return this.listStmt.all().map(mapStaff);
  }

  findById(id) {
    return mapStaff(this.findStmt.get(id));
  }

  findByTeacherId(powerschoolTeacherId) {
    return mapStaff(this.findByTeacherStmt.get(powerschoolTeacherId));
  }

  listAssignmentsForEvent(eventId) {
    return this.assignmentsForServicesStmt.all(eventId).map(mapAssignment);
  }

  updateOverrides(id, fields) {
    const allowed = ['display_name', 'photo_url', 'active'];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(fields, key)) {
        sets.push(`${key} = ?`);
        params.push(fields[key]);
      }
    }
    if (sets.length === 0) return this.findById(id);
    params.push(id);
    const info = this.db.prepare(`UPDATE staff SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    if (info.changes === 0) return null;
    return this.findById(id);
  }

  /**
   * Upsert teachers from PowerSchool.
   * display_name and photo_url are local overrides and are not overwritten.
   * active is an admin control and is not overwritten.
   * email is refreshed from PowerSchool because it is not an admin override.
   */
  sync(teachers) {
    return this.db.transaction((rows) => {
      let created = 0;
      let updated = 0;
      let unchanged = 0;
      for (const teacher of rows) {
        const existing = this.findByTeacherStmt.get(teacher.powerschool_teacher_id);
        if (!existing) {
          this.insertStmt.run({
            powerschool_teacher_id: teacher.powerschool_teacher_id,
            display_name: teacher.display_name,
            email: teacher.email,
            photo_url: teacher.photo_url ?? null,
          });
          created += 1;
        } else if (existing.email !== teacher.email) {
          this.updateEmailStmt.run(teacher.email, existing.id);
          updated += 1;
        } else {
          unchanged += 1;
        }
      }
      return { created, updated, unchanged };
    })(teachers);
  }

  assign(serviceId, staffId) {
    return this.db.transaction(() => {
      const existing = this.assignmentStmt.get(staffId, serviceId);
      if (existing) return { conflict: true };
      this.assignStmt.run(staffId, serviceId);
      return {
        assignment: {
          staff_id: staffId,
          service_id: serviceId,
          room_override: null,
        },
      };
    })();
  }

  unassign(serviceId, staffId) {
    const info = this.unassignStmt.run(staffId, serviceId);
    return info.changes > 0;
  }
}
