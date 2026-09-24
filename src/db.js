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
  ensureNotificationSchema(db);
  ensureBookingOverlapIndex(db);
  ensureLandingPageSchema(db);
  return db;
}

function ensureLandingPageSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS landing_page_blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      block_type TEXT NOT NULL CHECK (block_type IN ('header','login_tiles','announcement','rich_text')),
      position INTEGER NOT NULL,
      content TEXT NOT NULL DEFAULT '{}',
      visible INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_landing_blocks_position ON landing_page_blocks(position);
  `);
  const count = db.prepare('SELECT COUNT(*) AS n FROM landing_page_blocks').get().n;
  if (count > 0) return;
  db.prepare(`
    INSERT INTO landing_page_blocks (block_type, position, content) VALUES
      ('header', 0, '{"school_name":"Nakornpayap International School","welcome_text":"Welcome to Parent-Teacher Conferences","logo_url":null}'),
      ('login_tiles', 1, '{"parent_label":"Parent / Student","parent_description":"Verify your email to book a conference time.","teacher_label":"Teacher / Staff","teacher_description":"Sign in to manage your schedule."}')
  `).run();
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

function ensureBookingOverlapIndex(db) {
  const bookings = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'bookings'",
  ).get();
  if (!bookings) return;
  const columns = db.prepare('PRAGMA index_info(idx_bookings_no_overlap)').all();
  const names = columns.map((column) => column.name);
  if (names.length === 3 && names[0] === 'staff_id' && names[1] === 'event_id' && names[2] === 'start_time') {
    return;
  }
  db.exec(`
    DROP INDEX IF EXISTS idx_bookings_no_overlap;
    CREATE UNIQUE INDEX idx_bookings_no_overlap
      ON bookings(staff_id, event_id, start_time)
      WHERE status = 'confirmed';
  `);
}

function ensureNotificationSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient_email TEXT NOT NULL,
      purpose TEXT NOT NULL CHECK (purpose IN
        ('verification_code','booking_confirmation','summary','conflict_notification')),
      related_id INTEGER,
      provider_message_id TEXT,
      status TEXT NOT NULL DEFAULT 'sent'
        CHECK (status IN ('sent','delivered','bounced','complained','unknown')),
      status_detail TEXT,
      sent_at TEXT NOT NULL DEFAULT (datetime('now')),
      status_updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_email_deliveries_recipient ON email_deliveries(recipient_email);
    CREATE INDEX IF NOT EXISTS idx_email_deliveries_status ON email_deliveries(status);

    CREATE TABLE IF NOT EXISTS parent_contact_preferences (
      email TEXT PRIMARY KEY,
      fallback_contact_type TEXT CHECK (fallback_contact_type IN ('line','phone','wechat','none')),
      fallback_contact_value TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
