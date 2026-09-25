import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { projectRoot } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { createPsapiClient, mapGuardianStudents, mapTeacherPayload } from '../src/psapi/client.js';
import { MOCK_GUARDIAN_CHAIN } from '../src/psapi/mock-data.js';
import { PsapiError } from '../src/errors.js';
import { chunkSlots } from '../src/slots.js';
import { verificationPayload } from '../src/mail/mailer.js';
import { StaffRepository } from '../src/repositories/StaffRepository.js';
import { SchoolRepository } from '../src/repositories/SchoolRepository.js';
import { mergeStaff } from '../src/staff-merge.js';
import { mergeSchools } from '../src/school-merge.js';
import {
  computeEventStatus,
  formatCutoffMessage,
  parseDate,
  parseDateTime,
} from '../src/time.js';

describe('time and status', () => {
  test('canonicalizes school-local and offset datetimes', () => {
    assert.equal(parseDate('2026-10-14'), '2026-10-14');
    assert.equal(parseDate('2026-02-31'), null);
    assert.equal(parseDateTime('2026-10-14T17:00', 'Asia/Bangkok'), '2026-10-14T17:00:00+07:00');
    assert.equal(parseDateTime('2026-10-14T10:00:00Z', 'Asia/Bangkok'), '2026-10-14T17:00:00+07:00');
    assert.equal(parseDateTime('2026-02-31T10:00', 'Asia/Bangkok'), null);
    assert.equal(
      formatCutoffMessage('2026-10-14T17:00:00+07:00', 'Asia/Bangkok'),
      'Changes closed 14 Oct 2026 at 17:00',
    );
  });

  test('derives draft, upcoming, and past', () => {
    const now = new Date('2026-10-01T03:00:00Z');
    assert.equal(computeEventStatus({ event_date: '2026-10-14', is_open_for_booking: false }, now), 'draft');
    assert.equal(computeEventStatus({ event_date: '2026-10-14', is_open_for_booking: true }, now), 'upcoming');
    assert.equal(computeEventStatus({ event_date: '2026-09-01', is_open_for_booking: true }, now), 'past');
    assert.equal(computeEventStatus({ event_date: '2026-10-01', is_open_for_booking: true }, now), 'upcoming');
  });
});

describe('PowerSchool mapping', () => {
  test('reads schema-table records and a flat teacher list', () => {
    const fromSchema = mapTeacherPayload({
      record: [
        { tables: { teachers: { id: 42, lastfirst: 'Srisuk, Aroon', email_addr: 'A@nis.ac.th', homeroom: '204' } } },
      ],
    });
    assert.deepEqual(fromSchema, [{
      powerschool_teacher_id: '42',
      display_name: 'Srisuk, Aroon',
      email: 'a@nis.ac.th',
      photo_url: null,
      room: '204',
      powerschool_school_id: null,
    }]);

    const flat = mapTeacherPayload({
      teachers: [{ id: 'T9', name: 'Maya Chen', email: 'm@nis.ac.th', room: '118' }],
    });
    assert.equal(flat[0].display_name, 'Maya Chen');
    assert.equal(flat[0].room, '118');
  });

  test('captures schoolid from schoolstaff rows', () => {
    const mapped = mapTeacherPayload({
      record: [
        {
          tables: {
            schoolstaff: {
              id: 7,
              lastfirst: 'Chen, Maya',
              email_addr: 'maya@nis.ac.th',
              schoolid: 2,
              room: '118',
            },
          },
        },
      ],
    });
    assert.equal(mapped[0].powerschool_school_id, '2');
  });
});

describe('sqlite startup', () => {
  test('keeps rows when the schema already exists', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ptc-db-'));
    const dbPath = path.join(dir, 'keep.sqlite');
    const schemaPath = path.join(projectRoot, 'db', 'schema.sql');
    const first = openDatabase(dbPath, schemaPath);
    first.prepare(`
      INSERT INTO events (name, event_date, created_by)
      VALUES ('Keep', '2026-10-14', 'it.admin@nis.ac.th')
    `).run();
    first.close();

    const second = openDatabase(dbPath, schemaPath);
    const row = second.prepare('SELECT name FROM events').get();
    assert.equal(row.name, 'Keep');
    second.close();
  });

  test('replaces a booking overlap index that ignored the conference', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ptc-overlap-'));
    const dbPath = path.join(dir, 'old.sqlite');
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE events (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE bookings (
        id INTEGER PRIMARY KEY,
        event_id INTEGER,
        staff_id INTEGER,
        start_time TEXT,
        status TEXT
      );
      CREATE UNIQUE INDEX idx_bookings_no_overlap
        ON bookings(staff_id, start_time)
        WHERE status = 'confirmed';
      INSERT INTO events (name) VALUES ('Existing');
      INSERT INTO bookings (event_id, staff_id, start_time, status)
      VALUES (1, 7, '2026-10-14T08:00:00+07:00', 'confirmed');
    `);
    legacy.close();

    const db = openDatabase(dbPath, path.join(projectRoot, 'db', 'schema.sql'));
    const columns = db.prepare('PRAGMA index_info(idx_bookings_no_overlap)').all()
      .map((column) => column.name);
    assert.deepEqual(columns, ['staff_id', 'event_id', 'start_time']);
    db.prepare(`
      INSERT INTO bookings (event_id, staff_id, start_time, status)
      VALUES (2, 7, '2026-10-14T08:00:00+07:00', 'confirmed')
    `).run();
    assert.throws(() => {
      db.prepare(`
        INSERT INTO bookings (event_id, staff_id, start_time, status)
        VALUES (2, 7, '2026-10-14T08:00:00+07:00', 'confirmed')
      `).run();
    });
    assert.equal(db.prepare(`
      SELECT COUNT(*) AS n FROM bookings WHERE staff_id = 7 AND status = 'confirmed'
    `).get().n, 2);
    assert.equal(db.prepare('SELECT name FROM events').get().name, 'Existing');
    db.close();
  });
});

describe('staff sync overrides', () => {
  test('does not overwrite display name, photo, or active', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ptc-staff-'));
    const db = openDatabase(path.join(dir, 'staff.sqlite'), path.join(projectRoot, 'db', 'schema.sql'));
    const repo = new StaffRepository(db);
    repo.sync([{
      powerschool_teacher_id: 'T1',
      display_name: 'Original',
      email: 'a@nis.ac.th',
      photo_url: null,
    }]);
    const created = repo.findByTeacherId('T1');
    repo.updateOverrides(created.id, {
      display_name: 'Custom',
      photo_url: 'https://example.com/a.jpg',
      active: 0,
    });
    const counts = repo.sync([{
      powerschool_teacher_id: 'T1',
      display_name: 'From PowerSchool',
      email: 'b@nis.ac.th',
      photo_url: 'https://example.com/ps.jpg',
    }]);
    const after = repo.findByTeacherId('T1');
    assert.equal(counts.updated, 1);
    assert.equal(after.display_name, 'Custom');
    assert.equal(after.photo_url, 'https://example.com/a.jpg');
    assert.equal(after.active, false);
    assert.equal(after.email, 'b@nis.ac.th');

    const merged = mergeStaff([
      { powerschool_teacher_id: 'T1', display_name: 'From PowerSchool', email: 'b@nis.ac.th', room: '204' },
      { powerschool_teacher_id: 'T2', display_name: 'New Teacher', email: 'c@nis.ac.th', room: '118' },
    ], repo.list());
    assert.equal(merged.find((member) => member.powerschool_teacher_id === 'T1').display_name, 'Custom');
    assert.equal(merged.find((member) => member.powerschool_teacher_id === 'T2').synced, false);
    db.close();
  });

  test('captures and refreshes powerschool_school_id from PowerSchool', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ptc-staff-school-'));
    const db = openDatabase(path.join(dir, 'staff.sqlite'), path.join(projectRoot, 'db', 'schema.sql'));
    const repo = new StaffRepository(db);
    const created = repo.sync([{
      powerschool_teacher_id: 'T1',
      display_name: 'Aroon',
      email: 'a@nis.ac.th',
      powerschool_school_id: '1',
    }]);
    assert.equal(created.created, 1);
    assert.equal(repo.findByTeacherId('T1').powerschool_school_id, '1');

    const refreshed = repo.sync([{
      powerschool_teacher_id: 'T1',
      display_name: 'Ignored',
      email: 'a@nis.ac.th',
      powerschool_school_id: '2',
    }]);
    assert.equal(refreshed.updated, 1);
    assert.equal(repo.findByTeacherId('T1').powerschool_school_id, '2');

    const same = repo.sync([{
      powerschool_teacher_id: 'T1',
      display_name: 'Ignored',
      email: 'a@nis.ac.th',
      powerschool_school_id: '2',
    }]);
    assert.equal(same.unchanged, 1);
    db.close();
  });
});

describe('school sync', () => {
  test('creates, updates, and leaves schools unchanged', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ptc-schools-'));
    const db = openDatabase(path.join(dir, 'schools.sqlite'), path.join(projectRoot, 'db', 'schema.sql'));
    const repo = new SchoolRepository(db);

    const first = repo.sync([
      { powerschool_school_id: '1', name: 'Elementary' },
      { powerschool_school_id: '2', name: 'Middle' },
    ]);
    assert.deepEqual(first, { created: 2, updated: 0, unchanged: 0 });
    assert.equal(repo.findByPowerschoolId('1').name, 'Elementary');

    const second = repo.sync([
      { powerschool_school_id: '1', name: 'Elementary School' },
      { powerschool_school_id: '2', name: 'Middle' },
      { powerschool_school_id: '3', name: 'High' },
    ]);
    assert.deepEqual(second, { created: 1, updated: 1, unchanged: 1 });
    assert.equal(repo.findByPowerschoolId('1').name, 'Elementary School');
    assert.equal(repo.list().length, 3);
    assert.ok(repo.findById(repo.findByPowerschoolId('3').id));
    db.close();
  });
});

describe('school schema migration', () => {
  test('upgrades a pre-change database without corrupting rows or erroring on re-run', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ptc-school-mig-'));
    const dbPath = path.join(dir, 'legacy.sqlite');
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        event_date TEXT NOT NULL,
        cutoff_at TEXT,
        is_open_for_booking INTEGER NOT NULL DEFAULT 0,
        summary_sent_at TEXT,
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
      CREATE TABLE bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        service_id INTEGER NOT NULL,
        staff_id INTEGER NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        booking_batch_id TEXT NOT NULL,
        student_powerschool_id TEXT NOT NULL,
        student_name TEXT NOT NULL,
        parent_email TEXT NOT NULL,
        parent_relationship TEXT NOT NULL DEFAULT 'mother',
        status TEXT NOT NULL DEFAULT 'confirmed',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO events (name, event_date, created_by)
        VALUES ('Keep Event', '2026-10-14', 'it.admin@nis.ac.th');
      INSERT INTO services (event_id, name, slot_duration_minutes)
        VALUES (1, 'Homeroom', 15);
      INSERT INTO staff (powerschool_teacher_id, display_name, email)
        VALUES ('T1', 'Aroon', 'a@nis.ac.th');
    `);
    legacy.close();

    const schemaPath = path.join(projectRoot, 'db', 'schema.sql');
    const first = openDatabase(dbPath, schemaPath);
    const staffCols = first.prepare('PRAGMA table_info(staff)').all().map((c) => c.name);
    const serviceCols = first.prepare('PRAGMA table_info(services)').all().map((c) => c.name);
    assert.ok(staffCols.includes('powerschool_school_id'));
    assert.ok(serviceCols.includes('school_id'));
    assert.ok(serviceCols.includes('active'));
    assert.ok(serviceCols.includes('buffer_minutes'));
    assert.ok(first.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schools'",
    ).get());
    assert.equal(first.prepare('SELECT name FROM events').get().name, 'Keep Event');
    assert.equal(first.prepare('SELECT name FROM services').get().name, 'Homeroom');
    assert.equal(first.prepare('SELECT display_name FROM staff').get().display_name, 'Aroon');
    assert.equal(first.prepare('SELECT active FROM services').get().active, 1);
    assert.equal(first.prepare('SELECT buffer_minutes FROM services').get().buffer_minutes, 0);
    first.close();

    const second = openDatabase(dbPath, schemaPath);
    assert.equal(second.prepare('SELECT COUNT(*) AS n FROM events').get().n, 1);
    assert.equal(second.prepare('SELECT COUNT(*) AS n FROM staff').get().n, 1);
    assert.equal(second.prepare('SELECT COUNT(*) AS n FROM services').get().n, 1);
    second.close();
  });
});

function schemaPage(table, rows) {
  return {
    record: rows.map((row) => ({ tables: { [table]: row } })),
  };
}

describe('guardian mapping and slots', () => {
  test('maps student records and leaves guardian matching to the lookup chain', () => {
    const students = mapGuardianStudents({
      record: [
        {
          tables: {
            students: {
              id: 501,
              first_name: 'Niran',
              last_name: 'Srisuk',
              nickname: 'Nin',
              grade_level: 5,
              sections: [{ teacherid: 1001, room: '204' }, { teacherid: 1001, room: '204' }],
            },
          },
        },
        {
          students: { id: 9, name: 'Other Child', grade: '1', teachers: [] },
        },
      ],
    });
    assert.deepEqual(students, [
      {
        student_powerschool_id: '501',
        name: 'Niran Srisuk',
        nickname: 'Nin',
        grade: '5',
        teachers: [{ powerschool_teacher_id: '1001', room: '204' }],
      },
      {
        student_powerschool_id: '9',
        name: 'Other Child',
        nickname: null,
        grade: '1',
        teachers: [],
      },
    ]);
    assert.equal(Object.hasOwn(students[0], 'guardian_email'), false);
  });

  test('uses the mock guardian list only when credentials are absent', async () => {
    const mock = createPsapiClient({});
    const first = await mock.studentsForGuardian('Parent@NIS.ac.th');
    assert.equal(first.source, 'mock');
    assert.equal(first.students.length, 2);
    first.students[0].name = 'Changed';
    const second = await mock.studentsForGuardian('parent@nis.ac.th');
    assert.equal(second.students[0].name, 'Niran Srisuk');
    assert.deepEqual(await mock.studentsForGuardian('nobody@example.com'), { source: 'mock', students: [] });

    const live = createPsapiClient({
      baseUrl: 'https://ps.example',
      clientId: 'id',
      clientSecret: 'secret',
      studentsPath: '/ws/schema/table/students',
      fetchImpl: async (url) => {
        if (String(url).includes('access_token')) {
          return { ok: true, json: async () => ({ access_token: 'token' }) };
        }
        return { ok: false, status: 500, json: async () => ({ message: 'secret token parent@nis.ac.th' }) };
      },
    });
    await assert.rejects(
      () => live.studentsForGuardian('parent@nis.ac.th'),
      (error) => {
        assert.ok(error instanceof PsapiError);
        assert.equal(error.message, 'PowerSchool email address request failed');
        assert.equal(error.message.includes('secret'), false);
        assert.equal(error.message.includes('token'), false);
        assert.equal(error.message.includes('parent@nis.ac.th'), false);
        return true;
      },
    );
  });

  test('narrows a guardian through the contact tables before loading students', async () => {
    const clientSource = readFileSync(path.join(projectRoot, 'src/psapi/client.js'), 'utf8');
    assert.equal(clientSource.includes('guardian_email'), false);

    const calls = [];
    const live = createPsapiClient({
      baseUrl: 'https://ps.example',
      clientId: 'client-id',
      clientSecret: 'ps-client-secret-xyz',
      studentsPath: '/ws/schema/table/students',
      fetchImpl: async (url) => {
        const href = String(url);
        calls.push(href);
        if (href.includes('access_token')) {
          return { ok: true, json: async () => ({ access_token: 'ps-access-token-xyz' }) };
        }
        const table = new URL(href).pathname.split('/').pop();
        const rows = MOCK_GUARDIAN_CHAIN[table] || [];
        return { ok: true, json: async () => schemaPage(table, rows) };
      },
    });

    const result = await live.studentsForGuardian('Parent@NIS.ac.th');
    assert.equal(result.source, 'powerschool');
    assert.deepEqual(result.students, [{
      student_powerschool_id: '501',
      name: 'Niran Srisuk',
      nickname: 'Nin',
      grade: '5',
      teachers: [{ powerschool_teacher_id: '1001', room: '204' }],
    }]);

    const tables = calls.map((href) => new URL(href).pathname);
    assert.deepEqual(tables, [
      '/oauth/access_token',
      '/ws/schema/table/emailaddress',
      '/ws/schema/table/personemailaddressassoc',
      '/ws/schema/table/studentcontactassoc',
      '/ws/schema/table/studentcontactdetail',
      '/ws/schema/table/students',
    ]);
    const query = (href) => new URL(href).searchParams;
    assert.equal(query(calls[1]).get('projection'), 'emailaddressid,emailaddress');
    assert.equal(query(calls[1]).get('q'), 'emailaddress==parent@nis.ac.th');
    assert.equal(query(calls[2]).get('projection'), 'personid,emailaddressid');
    assert.equal(query(calls[2]).get('q'), 'emailaddressid=in=(10)');
    assert.equal(query(calls[3]).get('projection'), 'studentdcid,studentcontactassocid,personid');
    assert.equal(query(calls[3]).get('q'), 'personid=in=(100)');
    assert.equal(query(calls[4]).get('projection'), 'studentcontactassocid,isactive');
    assert.equal(query(calls[4]).get('q'), 'studentcontactassocid=in=(900,901);isactive==1');
    assert.equal(query(calls[4]).get('q').includes('iscustodial'), false);
    assert.equal(query(calls[4]).get('q').includes('isemergency'), false);
    assert.equal(query(calls[5]).get('q'), 'dcid=in=(501)');
    assert.equal(query(calls[5]).has('projection'), false);
    for (const href of calls) {
      assert.equal(href.includes('guardian_email'), false);
      assert.equal(href.includes('ps-client-secret-xyz'), false);
      assert.equal(href.includes('ps-access-token-xyz'), false);
      assert.equal(href.includes('iscustodial'), false);
      assert.equal(href.includes('isemergency'), false);
    }

    const missed = [];
    const unmatched = createPsapiClient({
      baseUrl: 'https://ps.example',
      clientId: 'client-id',
      clientSecret: 'ps-client-secret-xyz',
      fetchImpl: async (url) => {
        const href = String(url);
        missed.push(new URL(href).pathname);
        if (href.includes('access_token')) {
          return { ok: true, json: async () => ({ access_token: 'ps-access-token-xyz' }) };
        }
        return { ok: true, json: async () => schemaPage('emailaddress', MOCK_GUARDIAN_CHAIN.emailaddress) };
      },
    });
    const none = await unmatched.studentsForGuardian('quiet@example.com');
    assert.deepEqual(none, { source: 'powerschool', students: [] });
    assert.deepEqual(missed, ['/oauth/access_token', '/ws/schema/table/emailaddress']);
  });

  test('stops the guardian chain when a later table fails', async () => {
    const calls = [];
    const live = createPsapiClient({
      baseUrl: 'https://ps.example',
      clientId: 'client-id',
      clientSecret: 'ps-client-secret-xyz',
      fetchImpl: async (url) => {
        const href = String(url);
        calls.push(new URL(href).pathname);
        if (href.includes('access_token')) {
          return { ok: true, json: async () => ({ access_token: 'ps-access-token-xyz' }) };
        }
        if (href.includes('/personemailaddressassoc')) {
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: 'ps-client-secret-xyz', token: 'ps-access-token-xyz', email: 'parent@nis.ac.th' }),
          };
        }
        const table = new URL(href).pathname.split('/').pop();
        return { ok: true, json: async () => schemaPage(table, MOCK_GUARDIAN_CHAIN[table] || []) };
      },
    });
    await assert.rejects(
      () => live.studentsForGuardian('parent@nis.ac.th'),
      (error) => {
        assert.ok(error instanceof PsapiError);
        assert.equal(error.message, 'PowerSchool person email request failed');
        assert.equal(error.message.includes('ps-client-secret-xyz'), false);
        assert.equal(error.message.includes('ps-access-token-xyz'), false);
        assert.equal(error.message.includes('parent@nis.ac.th'), false);
        return true;
      },
    );
    assert.deepEqual(calls, [
      '/oauth/access_token',
      '/ws/schema/table/emailaddress',
      '/ws/schema/table/personemailaddressassoc',
    ]);
    assert.equal(live.connectionStatus().error, 'PowerSchool person email request failed');

    let called = false;
    const rejected = createPsapiClient({
      baseUrl: 'https://ps.example',
      clientId: 'client-id',
      clientSecret: 'ps-client-secret-xyz',
      fetchImpl: async () => {
        called = true;
        return { ok: true, json: async () => ({}) };
      },
    });
    await assert.rejects(
      () => rejected.studentsForGuardian('parent@nis.ac.th;dcid==1'),
      (error) => {
        assert.equal(error.message, 'PowerSchool email address request failed');
        assert.equal(error.message.includes('dcid'), false);
        assert.equal(error.message.includes('ps-client-secret-xyz'), false);
        return true;
      },
    );
    assert.equal(called, false);
  });

  test('chunks bookable time and leaves break overlap in place', () => {
    const slots = chunkSlots([
      { block_type: 'bookable', start_time: '2026-10-23T08:00:00+07:00', end_time: '2026-10-23T09:10:00+07:00' },
      { block_type: 'break', start_time: '2026-10-23T08:00:00+07:00', end_time: '2026-10-23T08:30:00+07:00' },
    ], 30, [
      { start_time: '2026-10-23T08:00:00+07:00', end_time: '2026-10-23T08:30:00+07:00' },
    ], 'Asia/Bangkok');
    assert.deepEqual(slots, [
      { start_time: '2026-10-23T08:00:00+07:00', end_time: '2026-10-23T08:30:00+07:00', available: false },
      { start_time: '2026-10-23T08:30:00+07:00', end_time: '2026-10-23T09:00:00+07:00', available: true },
    ]);
    assert.equal(verificationPayload({ exposeDevCode: false, code: '123456' }).dev_code, undefined);
    assert.equal(verificationPayload({ exposeDevCode: true, code: '123456' }).dev_code, '123456');
  });

  test('buffer_minutes advances the cursor while slots stay duration long', () => {
    const blocks = [
      { block_type: 'bookable', start_time: '2026-10-23T08:00:00+07:00', end_time: '2026-10-23T08:45:00+07:00' },
    ];
    // 15-min duration + 10-min buffer on a block long enough for 3 → exactly 2 slots with a 10-min gap.
    const withBuffer = chunkSlots(blocks, 15, [], 'Asia/Bangkok', 10);
    assert.deepEqual(withBuffer, [
      { start_time: '2026-10-23T08:00:00+07:00', end_time: '2026-10-23T08:15:00+07:00', available: true },
      { start_time: '2026-10-23T08:25:00+07:00', end_time: '2026-10-23T08:40:00+07:00', available: true },
    ]);
    assert.equal(withBuffer.length, 2);

    const zeroExplicit = chunkSlots(blocks, 15, [], 'Asia/Bangkok', 0);
    const zeroDefault = chunkSlots(blocks, 15, [], 'Asia/Bangkok');
    assert.deepEqual(zeroExplicit, zeroDefault);
    assert.deepEqual(zeroDefault, [
      { start_time: '2026-10-23T08:00:00+07:00', end_time: '2026-10-23T08:15:00+07:00', available: true },
      { start_time: '2026-10-23T08:15:00+07:00', end_time: '2026-10-23T08:30:00+07:00', available: true },
      { start_time: '2026-10-23T08:30:00+07:00', end_time: '2026-10-23T08:45:00+07:00', available: true },
    ]);
  });

  test('mergeSchools joins PowerSchool and local by powerschool_school_id', () => {
    const merged = mergeSchools(
      [
        { powerschool_school_id: '1', name: 'Elementary PS' },
        { powerschool_school_id: '2', name: 'Middle' },
      ],
      [
        { id: 10, powerschool_school_id: '1', name: 'Elementary' },
        { id: 11, powerschool_school_id: '9', name: 'Campus Only' },
      ],
    );
    assert.deepEqual(merged.find((row) => row.powerschool_school_id === '1'), {
      id: 10,
      powerschool_school_id: '1',
      name: 'Elementary',
      synced: true,
      in_powerschool: true,
    });
    assert.equal(merged.find((row) => row.powerschool_school_id === '2').synced, false);
    assert.equal(merged.find((row) => row.powerschool_school_id === '2').id, null);
    assert.equal(merged.find((row) => row.powerschool_school_id === '9').in_powerschool, false);
  });
});
