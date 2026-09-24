function parseContent(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function mapBlock(row) {
  if (!row) return null;
  return {
    id: row.id,
    block_type: row.block_type,
    position: row.position,
    content: parseContent(row.content),
    visible: row.visible === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class LandingPageRepository {
  constructor(db) {
    this.db = db;
    this.findStmt = db.prepare('SELECT * FROM landing_page_blocks WHERE id = ?');
    this.listAllStmt = db.prepare(`
      SELECT * FROM landing_page_blocks
      ORDER BY position ASC, id ASC
    `);
    this.listVisibleStmt = db.prepare(`
      SELECT * FROM landing_page_blocks
      WHERE visible = 1
      ORDER BY position ASC, id ASC
    `);
    this.insertStmt = db.prepare(`
      INSERT INTO landing_page_blocks (block_type, position, content, visible)
      VALUES (@block_type, @position, @content, @visible)
    `);
    this.deleteStmt = db.prepare('DELETE FROM landing_page_blocks WHERE id = ?');
    this.maxPositionStmt = db.prepare(`
      SELECT COALESCE(MAX(position), -1) AS max_position FROM landing_page_blocks
    `);
    this.countStmt = db.prepare('SELECT COUNT(*) AS n FROM landing_page_blocks');
  }

  listAll() {
    return this.listAllStmt.all().map(mapBlock);
  }

  listVisible() {
    return this.listVisibleStmt.all().map(mapBlock);
  }

  findById(id) {
    return mapBlock(this.findStmt.get(id));
  }

  nextPosition() {
    return this.maxPositionStmt.get().max_position + 1;
  }

  create({ block_type, content, position, visible = true }) {
    const info = this.insertStmt.run({
      block_type,
      position,
      content: JSON.stringify(content),
      visible: visible ? 1 : 0,
    });
    return this.findById(Number(info.lastInsertRowid));
  }

  update(id, fields) {
    const allowed = ['content', 'visible', 'position'];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      if (!Object.prototype.hasOwnProperty.call(fields, key)) continue;
      if (key === 'content') {
        sets.push('content = ?');
        params.push(JSON.stringify(fields.content));
      } else if (key === 'visible') {
        sets.push('visible = ?');
        params.push(fields.visible ? 1 : 0);
      } else {
        sets.push('position = ?');
        params.push(fields.position);
      }
    }
    if (sets.length === 0) return this.findById(id);
    sets.push("updated_at = datetime('now')");
    params.push(id);
    const info = this.db.prepare(
      `UPDATE landing_page_blocks SET ${sets.join(', ')} WHERE id = ?`,
    ).run(...params);
    if (info.changes === 0) return null;
    return this.findById(id);
  }

  reorder(orderedIds) {
    return this.db.transaction((ids) => {
      const existing = this.listAllStmt.all();
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
        UPDATE landing_page_blocks
        SET position = ?, updated_at = datetime('now')
        WHERE id = ?
      `);
      ids.forEach((id, index) => {
        temp.run(-(index + 1), id);
      });
      ids.forEach((id, index) => {
        temp.run(index, id);
      });
      return { blocks: this.listAll() };
    })(orderedIds);
  }

  delete(id) {
    const info = this.deleteStmt.run(id);
    return info.changes === 1;
  }

  count() {
    return this.countStmt.get().n;
  }
}
