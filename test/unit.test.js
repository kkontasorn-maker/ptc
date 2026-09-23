import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { projectRoot } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { mapTeacherPayload } from '../src/psapi/client.js';
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
