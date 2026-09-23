import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export function openDatabase(dbPath, schemaPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  if (dbPath !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }
  db.pragma('busy_timeout = 5000');

  const existing = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'events'",
  ).get();
  if (!existing) {
    const sql = fs.readFileSync(schemaPath, 'utf8');
    db.exec(sql);
  }
  ensureConflictSchema(db);
  return db;
}

function ensureConflictSchema(db) {
  const columns = db.prepare('PRAGMA table_info(bookings)').all();
  if (!columns.some((column) => column.name === 'needs_attention')) {
    db.exec('ALTER TABLE bookings ADD COLUMN needs_attention INTEGER NOT NULL DEFAULT 0');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS booking_conflict_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL REFERENCES bookings(id),
      reason TEXT NOT NULL,
      created_by TEXT NOT NULL,
      notified_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_booking_conflict_log_booking ON booking_conflict_log(booking_id);
  `);
}
