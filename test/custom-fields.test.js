import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { after, before, describe, test } from 'node:test';
import { projectRoot } from '../src/config.js';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db.js';
import { todayInZone } from '../src/time.js';
import {
  validateCustomFieldCreate,
  validateCustomFieldPatch,
  validateCustomFieldReorder,
  validateBookingCreate,
} from '../src/validate.js';
import { ValidationError } from '../src/errors.js';

const roleMap = {
  'it.admin@nis.ac.th': { role: 'it_admin' },
  'front.office@nis.ac.th': { role: 'front_office' },
  'teacher@nis.ac.th': { role: 'teacher', teacherid: 'T1001' },
  'parent@nis.ac.th': { role: 'parent' },
};

function addDays(iso, days) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

const today = todayInZone(new Date(), 'Asia/Bangkok');
const future = addDays(today, 45);

let server;
let base;
let db;
let admin;
let front;
let teacher;
let parentCookie;
let eventId;
let otherEventId;
let serviceId;
let aroonId;

function cookieHeader(response) {
  const list = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  return list.map((item) => item.split(';')[0]).join('; ');
}

async function api(urlPath, { method = 'GET', cookie, body } = {}) {
  const response = await fetch(`${base}${urlPath}`, {
    method,
    headers: {
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: response.status, json };
}

async function login(email) {
  const response = await fetch(`${base}/api/v1/auth/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify({ email }),
  });
  const json = await response.json();
  assert.equal(response.status, 200, JSON.stringify(json));
  return { cookie: cookieHeader(response), user: json.user };
}

async function verify(email) {
  const sent = await api('/api/v1/auth/verification-codes', { method: 'POST', body: { email } });
  assert.equal(sent.status, 201, JSON.stringify(sent.json));
  const code = db.prepare(`
    SELECT code FROM verification_codes WHERE email = ? ORDER BY id DESC LIMIT 1
  `).get(email.toLowerCase()).code;
  const confirmed = await fetch(`${base}/api/v1/auth/verification-codes/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify({ email, code }),
  });
  assert.equal(confirmed.status, 200);
  return cookieHeader(confirmed);
}

describe('custom field validation', () => {
  test('create and patch validate label/required/position', () => {
    assert.deepEqual(
      validateCustomFieldCreate({ label: 'Preferred language', required: true }),
      { label: 'Preferred language', required: true },
    );
    assert.equal(validateCustomFieldCreate({ label: 'Notes' }).required, false);
    assert.throws(
      () => validateCustomFieldCreate({ label: '' }),
      (error) => error instanceof ValidationError,
    );
    assert.throws(
      () => validateCustomFieldPatch({}),
      (error) => error instanceof ValidationError,
    );
    assert.deepEqual(
      validateCustomFieldPatch({ required: false, label: 'Updated' }),
      { required: false, label: 'Updated' },
    );
    assert.deepEqual(
      validateCustomFieldReorder({ ordered_ids: [2, 1] }),
      { ordered_ids: [2, 1] },
    );
  });

  test('booking create accepts optional custom_field_values up to 500 chars', () => {
    const ok = validateBookingCreate({
      parent_email: 'parent@nis.ac.th',
      parent_relationship: 'mother',
      picks: [{
        student_powerschool_id: 'S1001',
        service_id: 1,
        staff_id: 1,
        start_time: `${future}T08:00:00+07:00`,
        end_time: `${future}T08:15:00+07:00`,
      }],
      custom_field_values: [{ field_id: 1, value: 'Thai' }],
    }, 'Asia/Bangkok');
    assert.equal(ok.custom_field_values[0].value, 'Thai');
    assert.throws(
      () => validateBookingCreate({
        parent_email: 'parent@nis.ac.th',
        parent_relationship: 'mother',
        picks: [{
          student_powerschool_id: 'S1001',
          service_id: 1,
          staff_id: 1,
          start_time: `${future}T08:00:00+07:00`,
          end_time: `${future}T08:15:00+07:00`,
        }],
        custom_field_values: [{ field_id: 1, value: 'x'.repeat(501) }],
      }, 'Asia/Bangkok'),
      (error) => error instanceof ValidationError,
    );
  });
});

describe('custom field schema migration', () => {
  test('creates custom field tables on an existing database', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ptc-cf-migrate-'));
    const dbPath = path.join(dir, 'legacy.sqlite');
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        event_date TEXT NOT NULL,
        created_by TEXT NOT NULL
      );
      CREATE TABLE bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER,
        staff_id INTEGER,
        start_time TEXT,
        status TEXT
      );
      INSERT INTO events (name, event_date, created_by)
      VALUES ('Existing', '2026-10-14', 'it.admin@nis.ac.th');
    `);
    legacy.close();

    const migrated = openDatabase(dbPath, path.join(projectRoot, 'db', 'schema.sql'));
    const defs = migrated.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'custom_field_definitions'
    `).get();
    const values = migrated.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'booking_batch_custom_values'
    `).get();
    assert.ok(defs);
    assert.ok(values);
    migrated.close();
  });
});

describe('custom fields API', { concurrency: false }, () => {
  before(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ptc-cf-'));
    const app = createApp({
      dbPath: path.join(dir, 'test.sqlite'),
      schemaPath: path.join(projectRoot, 'db', 'schema.sql'),
      publicDir: path.join(projectRoot, 'public'),
      sessionSecret: 'test-secret',
      timeZone: 'Asia/Bangkok',
      cookieSecure: false,
      localAuth: true,
      roleMap,
      google: { configured: false, clientId: '', clientSecret: '', redirectUri: '', hostedDomain: '' },
      psapi: {},
      exposeDevCode: false,
    });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
    db = app.locals.db;
    admin = await login('it.admin@nis.ac.th');
    front = await login('front.office@nis.ac.th');
    teacher = await login('teacher@nis.ac.th');
    const sync = await api('/api/v1/staff/sync', { method: 'POST', cookie: admin.cookie, body: {} });
    aroonId = sync.json.staff.find((member) => member.powerschool_teacher_id === 'T1001').id;
    const event = await api('/api/v1/events', {
      method: 'POST',
      cookie: admin.cookie,
      body: { name: 'Custom fields conference', event_date: future },
    });
    eventId = event.json.event.id;
    const other = await api('/api/v1/events', {
      method: 'POST',
      cookie: admin.cookie,
      body: { name: 'Other conference', event_date: future },
    });
    otherEventId = other.json.event.id;
    const service = await api(`/api/v1/events/${eventId}/services`, {
      method: 'POST',
      cookie: admin.cookie,
      body: { name: 'Elementary', slot_duration_minutes: 15 },
    });
    serviceId = service.json.service.id;
    await api(`/api/v1/services/${serviceId}/staff`, {
      method: 'POST',
      cookie: admin.cookie,
      body: { staff_id: aroonId },
    });
    await api(`/api/v1/events/${eventId}/staff/${aroonId}/availability`, {
      method: 'POST',
      cookie: admin.cookie,
      body: { start_time: `${future}T08:00`, end_time: `${future}T09:00`, block_type: 'bookable' },
    });
    await api(`/api/v1/events/${eventId}`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { is_open_for_booking: true },
    });
    parentCookie = await verify('parent@nis.ac.th');
  });

  after(async () => {
    server.close();
    await once(server, 'close');
    db.close();
  });

  test('it_admin CRUD and reorder; front_office can list; teacher cannot', async () => {
    const created = await api(`/api/v1/events/${eventId}/custom-fields`, {
      method: 'POST',
      cookie: admin.cookie,
      body: { label: 'Preferred language', required: true },
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const fieldA = created.json.custom_field;
    assert.equal(fieldA.label, 'Preferred language');
    assert.equal(fieldA.required, true);
    assert.equal(fieldA.position, 0);

    const second = await api(`/api/v1/events/${eventId}/custom-fields`, {
      method: 'POST',
      cookie: admin.cookie,
      body: { label: 'Parking note', required: false },
    });
    assert.equal(second.status, 201, JSON.stringify(second.json));
    const fieldB = second.json.custom_field;

    const frontList = await api(`/api/v1/events/${eventId}/custom-fields`, {
      cookie: front.cookie,
    });
    assert.equal(frontList.status, 200);
    assert.equal(frontList.json.custom_fields.length, 2);

    const teacherList = await api(`/api/v1/events/${eventId}/custom-fields`, {
      cookie: teacher.cookie,
    });
    assert.equal(teacherList.status, 403);

    const frontWrite = await api(`/api/v1/events/${eventId}/custom-fields`, {
      method: 'POST',
      cookie: front.cookie,
      body: { label: 'Nope' },
    });
    assert.equal(frontWrite.status, 403);

    const patched = await api(`/api/v1/events/${eventId}/custom-fields/${fieldB.id}`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { label: 'Parking / entry', required: true },
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.json));
    assert.equal(patched.json.custom_field.label, 'Parking / entry');
    assert.equal(patched.json.custom_field.required, true);

    const reordered = await api(`/api/v1/events/${eventId}/custom-fields/reorder`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { ordered_ids: [fieldB.id, fieldA.id] },
    });
    assert.equal(reordered.status, 200, JSON.stringify(reordered.json));
    assert.deepEqual(
      reordered.json.custom_fields.map((field) => field.id),
      [fieldB.id, fieldA.id],
    );

    const mismatch = await api(`/api/v1/events/${eventId}/custom-fields/reorder`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { ordered_ids: [fieldA.id] },
    });
    assert.equal(mismatch.status, 400);
  });

  test('parent-view includes definitions; booking validates and stores values', async () => {
    const fields = await api(`/api/v1/events/${eventId}/custom-fields`, { cookie: admin.cookie });
    const defs = fields.json.custom_fields;
    assert.ok(defs.length >= 2);
    const required = defs.filter((field) => field.required);
    assert.ok(required.length >= 1);

    const view = await api(
      `/api/v1/events/${eventId}/parent-view?email=parent@nis.ac.th`,
      { cookie: parentCookie },
    );
    assert.equal(view.status, 200, JSON.stringify(view.json));
    assert.ok(Array.isArray(view.json.custom_field_definitions));
    assert.equal(view.json.custom_field_definitions.length, defs.length);

    const slot = view.json.children[0].teachers[0].slots.find((item) => item.available);
    assert.ok(slot);

    const foreign = await api('/api/v1/bookings', {
      method: 'POST',
      cookie: parentCookie,
      body: {
        parent_email: 'parent@nis.ac.th',
        parent_relationship: 'mother',
        picks: [{
          student_powerschool_id: view.json.children[0].student_powerschool_id,
          service_id: serviceId,
          staff_id: aroonId,
          start_time: slot.start_time,
          end_time: slot.end_time,
        }],
        custom_field_values: [{ field_id: 999999, value: 'Nope' }],
      },
    });
    assert.equal(foreign.status, 400, JSON.stringify(foreign.json));

    const missing = await api('/api/v1/bookings', {
      method: 'POST',
      cookie: parentCookie,
      body: {
        parent_email: 'parent@nis.ac.th',
        parent_relationship: 'mother',
        picks: [{
          student_powerschool_id: view.json.children[0].student_powerschool_id,
          service_id: serviceId,
          staff_id: aroonId,
          start_time: slot.start_time,
          end_time: slot.end_time,
        }],
        custom_field_values: [],
      },
    });
    assert.equal(missing.status, 400, JSON.stringify(missing.json));

    const answers = defs.map((field) => ({
      field_id: field.id,
      value: field.required ? `Answer for ${field.label}` : 'optional',
    }));
    const booked = await api('/api/v1/bookings', {
      method: 'POST',
      cookie: parentCookie,
      body: {
        parent_email: 'parent@nis.ac.th',
        parent_relationship: 'mother',
        picks: [{
          student_powerschool_id: view.json.children[0].student_powerschool_id,
          service_id: serviceId,
          staff_id: aroonId,
          start_time: slot.start_time,
          end_time: slot.end_time,
        }],
        custom_field_values: answers,
      },
    });
    assert.equal(booked.status, 201, JSON.stringify(booked.json));
    assert.equal(booked.json.custom_field_values.length, answers.length);

    const report = await api(`/api/v1/events/${eventId}/bookings`, { cookie: front.cookie });
    assert.equal(report.status, 200, JSON.stringify(report.json));
    const row = report.json.bookings.find(
      (item) => item.booking_batch_id === booked.json.booking_batch_id,
    );
    assert.ok(row);
    assert.equal(row.custom_field_values.length, answers.length);

    // CASCADE: deleting a definition drops historical answers for that field.
    const deleteTarget = defs[0];
    const deleted = await api(`/api/v1/events/${eventId}/custom-fields/${deleteTarget.id}`, {
      method: 'DELETE',
      cookie: admin.cookie,
    });
    assert.equal(deleted.status, 200, JSON.stringify(deleted.json));
    const remaining = db.prepare(`
      SELECT COUNT(*) AS n FROM booking_batch_custom_values
      WHERE booking_batch_id = ? AND field_id = ?
    `).get(booked.json.booking_batch_id, deleteTarget.id);
    assert.equal(remaining.n, 0, 'ON DELETE CASCADE must drop historical answers');

    const otherField = await api(`/api/v1/events/${otherEventId}/custom-fields`, {
      method: 'POST',
      cookie: admin.cookie,
      body: { label: 'Other event only' },
    });
    assert.equal(otherField.status, 201);
    const listScoped = await api(`/api/v1/events/${eventId}/custom-fields`, {
      cookie: admin.cookie,
    });
    assert.ok(listScoped.json.custom_fields.every((field) => field.event_id === eventId));
    assert.ok(!listScoped.json.custom_fields.some((field) => field.id === otherField.json.custom_field.id));
  });
});
