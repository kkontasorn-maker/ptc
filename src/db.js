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
  return db;
}
