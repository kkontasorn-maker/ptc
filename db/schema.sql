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

-- PowerSchool schools mirrored locally for school-scoped conferences.
CREATE TABLE schools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  powerschool_school_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slot_duration_minutes INTEGER NOT NULL CHECK (slot_duration_minutes > 0),
  school_id INTEGER REFERENCES schools(id),  -- NULL = legacy/ungrouped
  active INTEGER NOT NULL DEFAULT 1,
  buffer_minutes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  powerschool_teacher_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL,
  photo_url TEXT,
  powerschool_school_id TEXT,      -- refreshed from PowerSchool; not a local override
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
  needs_attention INTEGER NOT NULL DEFAULT 0,  -- set true when a teacher/staff change (§5.11) strands this booking
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_bookings_email_event ON bookings(parent_email, event_id);
CREATE INDEX idx_bookings_staff_event ON bookings(staff_id, event_id);
CREATE INDEX idx_bookings_batch ON bookings(booking_batch_id);

-- Prevents double-booking the same teacher slot in one conference.
-- The same clock time on a different event is a different visit.
CREATE UNIQUE INDEX idx_bookings_no_overlap
  ON bookings(staff_id, event_id, start_time)
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

CREATE TABLE booking_conflict_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,        -- the acting session's email (teacher or it_admin)
  notified_at TEXT,                -- set only once the parent notification email is CONFIRMED sent — same discipline as events.summary_sent_at (§5.5), never claimed on a console-log fallback
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_booking_conflict_log_booking ON booking_conflict_log(booking_id);

-- Delivery tracking for every outbound email (§5.12) — one row per send
-- attempt through the shared mail function (§5.10), updated by an ESP
-- webhook (or left at 'sent'/'unknown' if no webhook-capable ESP is in use).
CREATE TABLE email_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_email TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN
    ('verification_code','booking_confirmation','summary','conflict_notification')),
  related_id INTEGER,               -- booking_id / event_id / booking_conflict_log.id, depending on purpose; nullable
  provider_message_id TEXT,         -- id returned by the ESP at send time, matched against webhook callbacks
  status TEXT NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent','delivered','bounced','complained','unknown')),
  status_detail TEXT,               -- bounce/complaint reason from the ESP, nullable
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  status_updated_at TEXT
);
CREATE INDEX idx_email_deliveries_recipient ON email_deliveries(recipient_email);
CREATE INDEX idx_email_deliveries_status ON email_deliveries(status);

-- Optional fallback contact a parent can register during pre-validation
-- (§5.8) or any later visit, for the front office to use when email is
-- unreliable for that family (§5.12). One row per email; upsert on write.
CREATE TABLE parent_contact_preferences (
  email TEXT PRIMARY KEY,
  fallback_contact_type TEXT CHECK (fallback_contact_type IN ('line','phone','wechat','none')),
  fallback_contact_value TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Editable landing-page stack (§6 patterns; block naming from product DDL).
-- Seed INSERT runs only with this fresh-schema apply; startup migration seeds
-- existing databases when the table is empty.
CREATE TABLE landing_page_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  block_type TEXT NOT NULL CHECK (block_type IN ('header','login_tiles','announcement','rich_text')),
  position INTEGER NOT NULL,
  content TEXT NOT NULL DEFAULT '{}',
  visible INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_landing_blocks_position ON landing_page_blocks(position);

INSERT INTO landing_page_blocks (block_type, position, content) VALUES
  ('header', 0, '{"school_name":"Nakornpayap International School","welcome_text":"Welcome to Parent-Teacher Conferences","logo_url":null}'),
  ('login_tiles', 1, '{"parent_label":"Parent / Student","parent_description":"Verify your email to book a conference time.","teacher_label":"Teacher / Staff","teacher_description":"Sign in to manage your schedule."}');

-- IT-admin custom text fields for a conference visit (per event).
-- Deleting a definition CASCADE-deletes historical batch answers for that field.
CREATE TABLE custom_field_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_custom_field_defs_event ON custom_field_definitions(event_id);
CREATE UNIQUE INDEX idx_custom_field_defs_event_position
  ON custom_field_definitions(event_id, position);

CREATE TABLE booking_batch_custom_values (
  booking_batch_id TEXT NOT NULL,
  field_id INTEGER NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  PRIMARY KEY (booking_batch_id, field_id)
);
CREATE INDEX idx_batch_custom_values_batch ON booking_batch_custom_values(booking_batch_id);
