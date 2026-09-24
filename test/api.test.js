import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { projectRoot } from '../src/config.js';
import { createApp } from '../src/app.js';
import { resolveBookingRooms } from '../src/booking-rooms.js';
import { createPsapiClient } from '../src/psapi/client.js';
import { todayInZone } from '../src/time.js';

const roleMap = {
  'it.admin@nis.ac.th': { role: 'it_admin' },
  'front.office@nis.ac.th': { role: 'front_office' },
  'teacher@nis.ac.th': { role: 'teacher', teacherid: 'T1001' },
  'other.teacher@nis.ac.th': { role: 'teacher', teacherid: 'T1002' },
  'parent@nis.ac.th': { role: 'parent' },
};

function addDays(iso, days) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

const today = todayInZone(new Date(), 'Asia/Bangkok');
const future = addDays(today, 30);
const past = addDays(today, -10);

let server;
let base;
let db;
let admin;
let front;
let teacher;
let otherTeacher;
let parent;
let aroonId;
let mayaId;

function cookieHeader(response) {
  const list = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  return list.map((item) => item.split(';')[0]).join('; ');
}

async function api(urlPath, { method = 'GET', cookie, body, headers = {} } = {}) {
  const response = await fetch(`${base}${urlPath}`, {
    method,
    headers: {
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: response.status, json, text, headers: response.headers };
}

async function login(email) {
  const response = await fetch(`${base}/api/v1/auth/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify({ email }),
  });
  const json = await response.json();
  assert.equal(response.status, 200, JSON.stringify(json));
  return { cookie: cookieHeader(response), user: json.user };
}

async function createEvent(cookie, overrides = {}) {
  const response = await api('/api/v1/events', {
    method: 'POST',
    cookie,
    body: { name: 'Spring conferences', event_date: future, ...overrides },
  });
  assert.equal(response.status, 201, JSON.stringify(response.json));
  return response.json.event;
}

describe('admin API', { concurrency: false }, () => {
  before(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ptc-api-'));
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
    });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
    db = app.locals.db;
    admin = await login('it.admin@nis.ac.th');
    front = await login('front.office@nis.ac.th');
    teacher = await login('teacher@nis.ac.th');
    otherTeacher = await login('other.teacher@nis.ac.th');
    parent = await login('parent@nis.ac.th');
    const sync = await api('/api/v1/staff/sync', { method: 'POST', cookie: admin.cookie, body: {} });
    assert.equal(sync.status, 200, JSON.stringify(sync.json));
    assert.equal(sync.json.source, 'mock');
    assert.equal(sync.json.created, 8);
    aroonId = sync.json.staff.find((member) => member.powerschool_teacher_id === 'T1001').id;
    mayaId = sync.json.staff.find((member) => member.powerschool_teacher_id === 'T1002').id;
  });

  after(async () => {
    server.close();
    await once(server, 'close');
    db.close();
  });

  test('serves the admin shell with the NIS wordmark', async () => {
    const response = await fetch(`${base}/`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /NAKORNPAYAP/);
    assert.match(html, /INTERNATIONAL SCHOOL/);
    assert.match(html, /\/js\/app\.js/);
  });

  test('creates the spec tables and indexes once', () => {
    const tables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all().map((row) => row.name);
    assert.deepEqual(tables, [
      'availability_blocks',
      'booking_conflict_log',
      'bookings',
      'device_verifications',
      'email_deliveries',
      'events',
      'landing_page_blocks',
      'parent_contact_preferences',
      'services',
      'staff',
      'staff_services',
      'verification_codes',
    ]);
    const indexes = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND name LIKE 'idx_%'
      ORDER BY name
    `).all().map((row) => row.name);
    const overlap = db.prepare('PRAGMA index_info(idx_bookings_no_overlap)').all()
      .map((column) => column.name);
    assert.deepEqual(overlap, ['staff_id', 'event_id', 'start_time']);
    assert.deepEqual(indexes, [
      'idx_avail_staff_event',
      'idx_booking_conflict_log_booking',
      'idx_bookings_batch',
      'idx_bookings_email_event',
      'idx_bookings_no_overlap',
      'idx_bookings_staff_event',
      'idx_device_verifications_lookup',
      'idx_email_deliveries_recipient',
      'idx_email_deliveries_status',
      'idx_landing_blocks_position',
      'idx_verification_codes_email',
    ]);
  });

  test('rejects a missing session and a forged role cookie', async () => {
    const missing = await api('/api/v1/events');
    assert.equal(missing.status, 401);
    assert.equal(missing.json.error.code, 'UNAUTHORIZED');

    const forged = Buffer.from(JSON.stringify({
      email: 'it.admin@nis.ac.th',
      role: 'it_admin',
      exp: Date.now() + 60_000,
    })).toString('base64url');
    const rejected = await api('/api/v1/events', { cookie: `nis_ptc_session=${forged}.not-a-signature` });
    assert.equal(rejected.status, 401);
  });

  test('does not accept a role from the client', async () => {
    const claimed = await api('/api/v1/auth/session', {
      method: 'POST',
      body: { email: 'teacher@nis.ac.th', role: 'it_admin' },
    });
    assert.equal(claimed.status, 400);
    assert.equal(claimed.json.error.details[0].field, 'role');

    const blocked = await api('/api/v1/events', {
      method: 'POST',
      cookie: teacher.cookie,
      headers: { 'X-Role': 'it_admin' },
      body: { name: 'Should fail', event_date: future },
    });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.json.events, undefined);
    assert.equal(blocked.json.error.code, 'FORBIDDEN');
  });

  test('requires the app header on writes', async () => {
    const response = await fetch(`${base}/api/v1/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: admin.cookie,
      },
      body: JSON.stringify({ name: 'Nope', event_date: future }),
    });
    assert.equal(response.status, 403);
  });

  test('front office can read events and cannot write them', async () => {
    const event = await createEvent(admin.cookie, { name: 'Front office read' });
    const listed = await api('/api/v1/events', { cookie: front.cookie });
    assert.equal(listed.status, 200);
    assert.ok(listed.json.events.some((item) => item.id === event.id));

    const write = await api(`/api/v1/events/${event.id}`, {
      method: 'PATCH',
      cookie: front.cookie,
      body: { name: 'Changed' },
    });
    assert.equal(write.status, 403);
  });

  test('creates, updates, and derives status', async () => {
    const event = await createEvent(admin.cookie, { name: 'Status check', event_date: future });
    assert.equal(event.status, 'draft');
    assert.equal(event.is_open_for_booking, false);
    assert.equal(event.created_by, 'it.admin@nis.ac.th');

    const opened = await api(`/api/v1/events/${event.id}`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { is_open_for_booking: true },
    });
    assert.equal(opened.status, 200);
    assert.equal(opened.json.event.status, 'upcoming');
    assert.equal(opened.json.event.is_open_for_booking, true);

    const todayEvent = await createEvent(admin.cookie, { name: 'Today', event_date: today });
    assert.equal(todayEvent.status, 'draft');
    const pastEvent = await createEvent(admin.cookie, { name: 'Last season', event_date: past });
    const openedPast = await api(`/api/v1/events/${pastEvent.id}`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { is_open_for_booking: true },
    });
    assert.equal(openedPast.json.event.status, 'past');
  });

  test('hides unpublished events from parents with 404, not 500', async () => {
    const event = await createEvent(admin.cookie, { name: 'Still in setup' });
    await api(`/api/v1/events/${event.id}/services`, {
      method: 'POST',
      cookie: admin.cookie,
      body: { name: 'Secret service', slot_duration_minutes: 15 },
    });

    const hiddenServices = await api(`/api/v1/events/${event.id}/services`, { cookie: parent.cookie });
    assert.equal(hiddenServices.status, 404);
    assert.equal(JSON.stringify(hiddenServices.json).includes('Secret service'), false);

    const hidden = await api(`/api/v1/events/${event.id}`, { cookie: parent.cookie });
    assert.equal(hidden.status, 404);
    assert.equal(hidden.json.error.message, 'Event not found');
    assert.equal(JSON.stringify(hidden.json).includes('Still in setup'), false);
    assert.equal(JSON.stringify(hidden.json).includes('Secret service'), false);

    const missing = await api('/api/v1/events/999999', { cookie: parent.cookie });
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error.message, hidden.json.error.message);

    const list = await api('/api/v1/events', { cookie: parent.cookie });
    assert.equal(list.status, 200);
    assert.equal(list.json.events.some((item) => item.id === event.id), false);

    const badId = await api('/api/v1/events/nope', { cookie: admin.cookie });
    assert.equal(badId.status, 400);

    const opened = await api(`/api/v1/events/${event.id}`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { is_open_for_booking: true },
    });
    assert.equal(opened.status, 200);
    const visible = await api(`/api/v1/events/${event.id}`, { cookie: parent.cookie });
    assert.equal(visible.status, 200);
    assert.equal(visible.json.event.name, 'Still in setup');
    assert.equal(visible.json.event.services.length, 1);
  });

  test('stores names literally and keeps the events table', async () => {
    const name = "Fall'); DROP TABLE events;--";
    const event = await createEvent(admin.cookie, { name });
    assert.equal(event.name, name);
    const stillThere = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'events'").get();
    assert.ok(stillThere);
  });

  test('validates event input', async () => {
    const bad = await api('/api/v1/events', {
      method: 'POST',
      cookie: admin.cookie,
      body: { name: '  ', event_date: '2026-02-31', is_open_for_booking: true },
    });
    assert.equal(bad.status, 400);

    const malformed = await fetch(`${base}/api/v1/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        Cookie: admin.cookie,
      },
      body: '{',
    });
    assert.equal(malformed.status, 400);
  });

  test('manages services and staff assignment', async () => {
    const event = await createEvent(admin.cookie, { name: 'Service event' });
    const created = await api(`/api/v1/events/${event.id}/services`, {
      method: 'POST',
      cookie: admin.cookie,
      body: { name: 'Elementary', slot_duration_minutes: 15 },
    });
    assert.equal(created.status, 201);
    const serviceId = created.json.service.id;

    const badDuration = await api(`/api/v1/services/${serviceId}`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { slot_duration_minutes: 0 },
    });
    assert.equal(badDuration.status, 400);

    const renamed = await api(`/api/v1/services/${serviceId}`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { name: 'Elementary conferences' },
    });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.json.service.name, 'Elementary conferences');

    const assigned = await api(`/api/v1/services/${serviceId}/staff`, {
      method: 'POST',
      cookie: admin.cookie,
      body: { staff_id: aroonId },
    });
    assert.equal(assigned.status, 201);
    assert.equal(assigned.json.assignment.room_override, null);

    const duplicate = await api(`/api/v1/services/${serviceId}/staff`, {
      method: 'POST',
      cookie: admin.cookie,
      body: { staff_id: aroonId },
    });
    assert.equal(duplicate.status, 409);

    const detail = await api(`/api/v1/events/${event.id}`, { cookie: admin.cookie });
    assert.equal(detail.json.event.staff_summary.assigned_staff_count, 1);
    assert.equal(detail.json.event.services[0].staff[0].display_name, 'Aroon Srisuk');

    const removed = await api(`/api/v1/services/${serviceId}/staff/${aroonId}`, {
      method: 'DELETE',
      cookie: admin.cookie,
    });
    assert.equal(removed.status, 200);
    const gone = await api(`/api/v1/services/${serviceId}/staff/${aroonId}`, {
      method: 'DELETE',
      cookie: admin.cookie,
    });
    assert.equal(gone.status, 404);
  });

  test('lets IT admin set and clear room_override on an assignment', async () => {
    const event = await createEvent(admin.cookie, { name: 'Room override event' });
    const created = await api(`/api/v1/events/${event.id}/services`, {
      method: 'POST',
      cookie: admin.cookie,
      body: { name: 'Elementary', slot_duration_minutes: 15 },
    });
    assert.equal(created.status, 201);
    const serviceId = created.json.service.id;

    const assigned = await api(`/api/v1/services/${serviceId}/staff`, {
      method: 'POST',
      cookie: admin.cookie,
      body: { staff_id: aroonId },
    });
    assert.equal(assigned.status, 201);

    const patched = await api(`/api/v1/services/${serviceId}/staff/${aroonId}`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { room_override: '  Gym  ' },
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.json));
    assert.deepEqual(patched.json.assignment, {
      staff_id: aroonId,
      service_id: serviceId,
      room_override: 'Gym',
    });

    const detail = await api(`/api/v1/events/${event.id}`, { cookie: admin.cookie });
    assert.equal(detail.status, 200);
    const listed = detail.json.event.services[0].staff.find((member) => member.id === aroonId);
    assert.equal(listed.room_override, 'Gym');

    const clearedNull = await api(`/api/v1/services/${serviceId}/staff/${aroonId}`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { room_override: null },
    });
    assert.equal(clearedNull.status, 200);
    assert.equal(clearedNull.json.assignment.room_override, null);

    const setAgain = await api(`/api/v1/services/${serviceId}/staff/${aroonId}`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { room_override: 'Library' },
    });
    assert.equal(setAgain.status, 200);
    assert.equal(setAgain.json.assignment.room_override, 'Library');

    const clearedEmpty = await api(`/api/v1/services/${serviceId}/staff/${aroonId}`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { room_override: '' },
    });
    assert.equal(clearedEmpty.status, 200);
    assert.equal(clearedEmpty.json.assignment.room_override, null);

    const afterClear = await api(`/api/v1/events/${event.id}`, { cookie: admin.cookie });
    const clearedMember = afterClear.json.event.services[0].staff.find((member) => member.id === aroonId);
    assert.equal(clearedMember.room_override, null);

    const rooms = await resolveBookingRooms(createPsapiClient({}), [{
      parent_email: 'parent@nis.ac.th',
      student_powerschool_id: 'S1001',
      powerschool_teacher_id: 'T1001',
      room_override: clearedMember.room_override,
    }]);
    assert.equal(rooms[0], '204');

    const frontPatch = await api(`/api/v1/services/${serviceId}/staff/${aroonId}`, {
      method: 'PATCH',
      cookie: front.cookie,
      body: { room_override: 'Gym' },
    });
    assert.equal(frontPatch.status, 403);

    const teacherPatch = await api(`/api/v1/services/${serviceId}/staff/${aroonId}`, {
      method: 'PATCH',
      cookie: teacher.cookie,
      body: { room_override: 'Gym' },
    });
    assert.equal(teacherPatch.status, 403);

    const unknownService = await api(`/api/v1/services/999999/staff/${aroonId}`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { room_override: 'Gym' },
    });
    assert.equal(unknownService.status, 404);

    const unknownStaff = await api(`/api/v1/services/${serviceId}/staff/999999`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { room_override: 'Gym' },
    });
    assert.equal(unknownStaff.status, 404);

    const unassigned = await api(`/api/v1/services/${serviceId}/staff/${mayaId}`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { room_override: 'Gym' },
    });
    assert.equal(unassigned.status, 404);

    const tooLong = await api(`/api/v1/services/${serviceId}/staff/${aroonId}`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { room_override: 'x'.repeat(101) },
    });
    assert.equal(tooLong.status, 400);
  });

  test('preserves staff display overrides across sync', async () => {
    const patched = await api(`/api/v1/staff/${aroonId}`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { display_name: 'Custom Name', photo_url: 'https://example.com/a.jpg', active: false },
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.json.staff.display_name, 'Custom Name');

    const emailChange = await api(`/api/v1/staff/${aroonId}`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { email: 'other@nis.ac.th' },
    });
    assert.equal(emailChange.status, 400);

    const script = await api(`/api/v1/staff/${aroonId}`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { photo_url: 'javascript:alert(1)' },
    });
    assert.equal(script.status, 400);

    const again = await api('/api/v1/staff/sync', { method: 'POST', cookie: admin.cookie, body: {} });
    assert.equal(again.status, 200);
    assert.equal(again.json.created, 0);
    const custom = again.json.staff.find((member) => member.id === aroonId);
    assert.equal(custom.display_name, 'Custom Name');
    assert.equal(custom.photo_url, 'https://example.com/a.jpg');
    assert.equal(custom.active, false);
    assert.equal(custom.email, 'aroon.srisuk@nis.ac.th');

    await api(`/api/v1/staff/${aroonId}`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { display_name: 'Aroon Srisuk', photo_url: null, active: true },
    });
  });

  test('scopes availability and enforces cutoff and bookings', async () => {
    const event = await createEvent(admin.cookie, {
      name: 'Availability',
      cutoff_at: `${future}T17:00:00+07:00`,
    });
    const service = await api(`/api/v1/events/${event.id}/services`, {
      method: 'POST',
      cookie: admin.cookie,
      body: { name: 'Homeroom', slot_duration_minutes: 10 },
    });
    const serviceId = service.json.service.id;

    const own = await api(`/api/v1/events/${event.id}/staff/${aroonId}/availability`, {
      method: 'POST',
      cookie: teacher.cookie,
      body: {
        start_time: `${future}T08:00`,
        end_time: `${future}T12:00`,
        block_type: 'bookable',
      },
    });
    assert.equal(own.status, 201, JSON.stringify(own.json));
    assert.equal(own.json.block.start_time, `${future}T08:00:00+07:00`);
    const blockId = own.json.block.id;

    const otherWrite = await api(`/api/v1/events/${event.id}/staff/${aroonId}/availability`, {
      method: 'POST',
      cookie: otherTeacher.cookie,
      body: {
        start_time: `${future}T13:00`,
        end_time: `${future}T14:00`,
        block_type: 'break',
      },
    });
    assert.equal(otherWrite.status, 403);
    assert.equal(otherWrite.json.blocks, undefined);

    const otherRead = await api(`/api/v1/events/${event.id}/staff/${mayaId}/availability`, {
      cookie: teacher.cookie,
    });
    assert.equal(otherRead.status, 403);

    const frontRead = await api(`/api/v1/events/${event.id}/staff/${aroonId}/availability`, {
      cookie: front.cookie,
    });
    assert.equal(frontRead.status, 200);
    assert.equal(frontRead.json.blocks.length, 1);

    const frontWrite = await api(`/api/v1/events/${event.id}/staff/${aroonId}/availability`, {
      method: 'POST',
      cookie: front.cookie,
      body: {
        start_time: `${future}T13:00`,
        end_time: `${future}T14:00`,
        block_type: 'break',
      },
    });
    assert.equal(frontWrite.status, 403);

    const backwards = await api(`/api/v1/events/${event.id}/staff/${mayaId}/availability`, {
      method: 'POST',
      cookie: admin.cookie,
      body: {
        start_time: `${future}T15:00`,
        end_time: `${future}T14:00`,
        block_type: 'bookable',
      },
    });
    assert.equal(backwards.status, 400);

    db.prepare(`
      INSERT INTO bookings (
        event_id, service_id, staff_id, start_time, end_time, booking_batch_id,
        student_powerschool_id, student_name, parent_email, parent_relationship
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'mother')
    `).run(
      event.id,
      serviceId,
      aroonId,
      `${future}T09:00:00+07:00`,
      `${future}T09:10:00+07:00`,
      'batch-1',
      'S1',
      'Student One',
      'parent@nis.ac.th',
    );

    const blockedDelete = await api(`/api/v1/availability/${blockId}`, {
      method: 'DELETE',
      cookie: admin.cookie,
    });
    assert.equal(blockedDelete.status, 409);

    const eventDelete = await api(`/api/v1/events/${event.id}`, {
      method: 'DELETE',
      cookie: admin.cookie,
    });
    assert.equal(eventDelete.status, 409);

    const serviceDelete = await api(`/api/v1/services/${serviceId}`, {
      method: 'DELETE',
      cookie: admin.cookie,
    });
    assert.equal(serviceDelete.status, 409);

    db.prepare("UPDATE bookings SET status = 'cancelled' WHERE event_id = ?").run(event.id);
    const stillBlocked = await api(`/api/v1/events/${event.id}`, {
      method: 'DELETE',
      cookie: admin.cookie,
    });
    assert.equal(stillBlocked.status, 409);

    const removedBlock = await api(`/api/v1/availability/${blockId}`, {
      method: 'DELETE',
      cookie: teacher.cookie,
    });
    assert.equal(removedBlock.status, 200);

    const closed = await createEvent(admin.cookie, {
      name: 'Closed',
      cutoff_at: '2000-01-01T00:00:00+07:00',
    });
    const locked = await api(`/api/v1/events/${closed.id}/staff/${aroonId}/availability`, {
      method: 'POST',
      cookie: admin.cookie,
      body: {
        start_time: `${future}T08:00`,
        end_time: `${future}T09:00`,
        block_type: 'break',
      },
    });
    assert.equal(locked.status, 423);
    assert.equal(locked.json.error.message, 'Changes closed 1 Jan 2000 at 00:00');
  });

  test('deletes an event with no bookings and cascades services', async () => {
    const event = await createEvent(admin.cookie, { name: 'Disposable' });
    const service = await api(`/api/v1/events/${event.id}/services`, {
      method: 'POST',
      cookie: admin.cookie,
      body: { name: 'Temp', slot_duration_minutes: 20 },
    });
    await api(`/api/v1/events/${event.id}/staff/${mayaId}/availability`, {
      method: 'POST',
      cookie: admin.cookie,
      body: {
        start_time: `${future}T08:00`,
        end_time: `${future}T09:00`,
        block_type: 'bookable',
      },
    });
    const removed = await api(`/api/v1/events/${event.id}`, { method: 'DELETE', cookie: admin.cookie });
    assert.equal(removed.status, 200);
    const missing = await api(`/api/v1/services/${service.json.service.id}`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { name: 'Gone' },
    });
    assert.equal(missing.status, 404);
    const blocks = db.prepare('SELECT COUNT(*) AS n FROM availability_blocks WHERE event_id = ?').get(event.id);
    assert.equal(blocks.n, 0);
  });

  test('google sign-in reports that it is not configured', async () => {
    const response = await api('/api/v1/auth/google');
    assert.equal(response.status, 404);
    assert.match(response.json.error.message, /not configured/i);
  });
});
