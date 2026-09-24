function mapDefinition(row) {
  if (!row) return null;
  return {
    id: row.id,
    event_id: row.event_id,
    label: row.label,
    required: row.required === 1,
    position: row.position,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapValue(row) {
  return {
    field_id: row.field_id,
    value: row.value,
  };
}

export class CustomFieldRepository {
  constructor(db) {
    this.db = db;
    this.findStmt = db.prepare('SELECT * FROM custom_field_definitions WHERE id = ?');
    this.listForEventStmt = db.prepare(`
      SELECT * FROM custom_field_definitions
      WHERE event_id = ?
      ORDER BY position ASC, id ASC
    `);
    this.insertStmt = db.prepare(`
      INSERT INTO custom_field_definitions (event_id, label, required, position)
      VALUES (@event_id, @label, @required, @position)
    `);
    this.deleteStmt = db.prepare('DELETE FROM custom_field_definitions WHERE id = ? AND event_id = ?');
    this.maxPositionStmt = db.prepare(`
      SELECT COALESCE(MAX(position), -1) AS max_position
      FROM custom_field_definitions
      WHERE event_id = ?
    `);
    this.valuesForBatchStmt = db.prepare(`
      SELECT field_id, value
      FROM booking_batch_custom_values
      WHERE booking_batch_id = ?
      ORDER BY field_id ASC
    `);
    this.deleteBatchValuesStmt = db.prepare(`
      DELETE FROM booking_batch_custom_values WHERE booking_batch_id = ?
    `);
    this.insertValueStmt = db.prepare(`
      INSERT INTO booking_batch_custom_values (booking_batch_id, field_id, value)
      VALUES (?, ?, ?)
    `);
  }

  listForEvent(eventId) {
    return this.listForEventStmt.all(eventId).map(mapDefinition);
  }

  findById(id) {
    return mapDefinition(this.findStmt.get(id));
  }

  nextPosition(eventId) {
    return this.maxPositionStmt.get(eventId).max_position + 1;
  }

  create({ event_id: eventId, label, required = false, position }) {
    const pos = position === undefined ? this.nextPosition(eventId) : position;
    const info = this.insertStmt.run({
      event_id: eventId,
      label,
      required: required ? 1 : 0,
      position: pos,
    });
    return this.findById(Number(info.lastInsertRowid));
  }

  update(id, eventId, fields) {
    const existing = this.findById(id);
    if (!existing || existing.event_id !== eventId) return null;
    const allowed = ['label', 'required', 'position'];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (!Object.prototype.hasOwnProperty.call(fields, key)) continue;
      if (key === 'required') {
        sets.push('required = ?');
        params.push(fields.required ? 1 : 0);
      } else if (key === 'label') {
        sets.push('label = ?');
        params.push(fields.label);
      } else {
        sets.push('position = ?');
        params.push(fields.position);
      }
    }
    if (sets.length === 0) return existing;
    sets.push("updated_at = datetime('now')");
    params.push(id, eventId);
    const info = this.db.prepare(
      `UPDATE custom_field_definitions SET ${sets.join(', ')} WHERE id = ? AND event_id = ?`,
    ).run(...params);
    if (info.changes === 0) return null;
    return this.findById(id);
  }

  delete(id, eventId) {
    const info = this.deleteStmt.run(id, eventId);
    return info.changes === 1;
  }

  reorder(eventId, orderedIds) {
    return this.db.transaction((ids) => {
      const existing = this.listForEventStmt.all(eventId);
      if (existing.length !== ids.length) {
        return { mismatch: true };
      }
      const byId = new Map(existing.map((row) => [row.id, row]));
      for (const id of ids) {
        if (!byId.has(id)) return { mismatch: true };
      }
      const unique = new Set(ids);
      if (unique.size !== ids.length) return { mismatch: true };

      const temp = this.db.prepare(`
        UPDATE custom_field_definitions
        SET position = ?, updated_at = datetime('now')
        WHERE id = ? AND event_id = ?
      `);
      ids.forEach((id, index) => {
        temp.run(-(index + 1), id, eventId);
      });
      ids.forEach((id, index) => {
        temp.run(index, id, eventId);
      });
      return { fields: this.listForEvent(eventId) };
    })(orderedIds);
  }

  saveBatchValues(bookingBatchId, values) {
    this.deleteBatchValuesStmt.run(bookingBatchId);
    for (const item of values) {
      this.insertValueStmt.run(bookingBatchId, item.field_id, item.value);
    }
  }

  valuesForBatch(bookingBatchId) {
    return this.valuesForBatchStmt.all(bookingBatchId).map(mapValue);
  }

  valuesForBatches(bookingBatchIds) {
    const result = new Map();
    if (!bookingBatchIds || bookingBatchIds.length === 0) return result;
    const unique = [...new Set(bookingBatchIds)];
    const placeholders = unique.map(() => '?').join(', ');
    const rows = this.db.prepare(`
      SELECT booking_batch_id, field_id, value
      FROM booking_batch_custom_values
      WHERE booking_batch_id IN (${placeholders})
      ORDER BY booking_batch_id ASC, field_id ASC
    `).all(...unique);
    for (const id of unique) result.set(id, []);
    for (const row of rows) {
      result.get(row.booking_batch_id).push(mapValue(row));
    }
    return result;
  }
}
