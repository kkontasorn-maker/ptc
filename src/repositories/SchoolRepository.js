function mapSchool(row) {
  if (!row) return null;
  return {
    id: row.id,
    powerschool_school_id: row.powerschool_school_id,
    name: row.name,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class SchoolRepository {
  constructor(db) {
    this.db = db;
    this.listStmt = db.prepare('SELECT * FROM schools ORDER BY name COLLATE NOCASE, id ASC');
    this.findStmt = db.prepare('SELECT * FROM schools WHERE id = ?');
    this.findByPowerschoolStmt = db.prepare(
      'SELECT * FROM schools WHERE powerschool_school_id = ?',
    );
    this.insertStmt = db.prepare(`
      INSERT INTO schools (powerschool_school_id, name)
      VALUES (@powerschool_school_id, @name)
    `);
    this.updateNameStmt = db.prepare(`
      UPDATE schools
      SET name = ?, updated_at = datetime('now')
      WHERE id = ?
    `);
  }

  list() {
    return this.listStmt.all().map(mapSchool);
  }

  findById(id) {
    return mapSchool(this.findStmt.get(id));
  }

  findByPowerschoolId(powerschoolSchoolId) {
    return mapSchool(this.findByPowerschoolStmt.get(powerschoolSchoolId));
  }

  /**
   * Upsert schools from PowerSchool on powerschool_school_id.
   * Name is refreshed from PowerSchool.
   */
  sync(schools) {
    return this.db.transaction((rows) => {
      let created = 0;
      let updated = 0;
      let unchanged = 0;
      for (const school of rows) {
        const existing = this.findByPowerschoolStmt.get(school.powerschool_school_id);
        if (!existing) {
          this.insertStmt.run({
            powerschool_school_id: school.powerschool_school_id,
            name: school.name,
          });
          created += 1;
        } else if (existing.name !== school.name) {
          this.updateNameStmt.run(school.name, existing.id);
          updated += 1;
        } else {
          unchanged += 1;
        }
      }
      return { created, updated, unchanged };
    })(schools);
  }
}
