import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { projectRoot } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { createPsapiClient, mapGuardianStudents, mapTeacherPayload } from '../src/psapi/client.js';
import { PsapiError } from '../src/errors.js';
import { chunkSlots } from '../src/slots.js';
import { verificationPayload } from '../src/mail/mailer.js';
import { StaffRepository } from '../src/repositories/StaffRepository.js';
import { mergeStaff } from '../src/staff-merge.js';
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
    }]);

    const flat = mapTeacherPayload({
      teachers: [{ id: 'T9', name: 'Maya Chen', email: 'm@nis.ac.th', room: '118' }],
    });
    assert.equal(flat[0].display_name, 'Maya Chen');
    assert.equal(flat[0].room, '118');
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
});

describe('guardian mapping and slots', () => {
  test('keeps students for the requested guardian email', () => {
    const students = mapGuardianStudents({
      record: [
        {
          guardian_email: 'Parent@NIS.ac.th',
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
          guardian_email: 'other@example.com',
          students: { id: 9, name: 'Other Child', grade: '1', teachers: [] },
        },
      ],
    }, 'parent@nis.ac.th');
    assert.deepEqual(students, [{
      student_powerschool_id: '501',
      name: 'Niran Srisuk',
      nickname: 'Nin',
      grade: '5',
      teachers: [{ powerschool_teacher_id: '1001', room: '204' }],
    }]);
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
      studentsPath: '/students',
      fetchImpl: async (url) => {
        if (String(url).includes('access_token')) {
          return { ok: true, json: async () => ({ access_token: 'token' }) };
        }
        return { ok: false, status: 500, json: async () => ({}) };
      },
    });
    await assert.rejects(() => live.studentsForGuardian('parent@nis.ac.th'), PsapiError);
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
});
