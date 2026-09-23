-- Applied once on startup when the events table does not exist.
-- Statements below are the Phase 1 schema from the NIS PTC spec (§3).

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  event_date TEXT NOT NULL,        -- ISO date
  cutoff_at TEXT,                  -- ISO datetime, nullable
  is_open_for_booking INTEGER NOT NULL DEFAULT 0,
  summary_sent_at TEXT,            -- ISO datetime, set once the post-cutoff summary batch has run
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slot_duration_minutes INTEGER NOT NULL CHECK (slot_duration_minutes > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  powerschool_teacher_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL,
  photo_url TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE staff_services (
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  room_override TEXT,              -- event-scoped; null = use PowerSchool-sourced room
  PRIMARY KEY (staff_id, service_id)
);

CREATE TABLE availability_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  start_time TEXT NOT NULL,        -- ISO datetime
  end_time TEXT NOT NULL,
  block_type TEXT NOT NULL CHECK (block_type IN ('bookable','break')),
  CHECK (end_time > start_time)
);
CREATE INDEX idx_avail_staff_event ON availability_blocks(staff_id, event_id);

CREATE TABLE bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id),
  service_id INTEGER NOT NULL REFERENCES services(id),
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  booking_batch_id TEXT NOT NULL,  -- UUID shared by all bookings from one submission
  student_powerschool_id TEXT NOT NULL,  -- matched via PSAPI at booking time, not local FK
  student_name TEXT NOT NULL,
  student_nickname TEXT,
  student_grade TEXT,
  parent_email TEXT NOT NULL,
  parent_first_name TEXT,
  parent_last_name TEXT,
  parent_relationship TEXT NOT NULL
    CHECK (parent_relationship IN ('mother','father','guardian','other')),
  parent_relationship_other TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed','cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_bookings_email_event ON bookings(parent_email, event_id);
CREATE INDEX idx_bookings_staff_event ON bookings(staff_id, event_id);
CREATE INDEX idx_bookings_batch ON bookings(booking_batch_id);

-- Prevents double-booking the same teacher slot at the DB level as a
-- last line of defense (application layer should also check before insert)
CREATE UNIQUE INDEX idx_bookings_no_overlap
  ON bookings(staff_id, start_time)
  WHERE status = 'confirmed';

CREATE TABLE verification_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_verification_codes_email ON verification_codes(email);

CREATE TABLE device_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  device_token TEXT NOT NULL UNIQUE,
  verified_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_device_verifications_lookup ON device_verifications(email, device_token);
