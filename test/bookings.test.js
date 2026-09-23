import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { projectRoot } from '../src/config.js';
import { todayInZone } from '../src/time.js';

const roleMap = {
  'it.admin@nis.ac.th': { role: 'it_admin' },
  'front.office@nis.ac.th': { role: 'front_office' },
  'teacher@nis.ac.th': { role: 'teacher', teacherid: 'T1001' },
  'other.teacher@nis.ac.th': { role: 'teacher', teacherid: 'T1002' },
};

function addDays(iso, days) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

const today = todayInZone(new Date(), 'Asia/Bangkok');
const future = addDays(today, 40);
const yesterday = addDays(today, -1);

let server;
let base;
let db;
let adminCookie;
let teacherCookie;
let otherTeacherCookie;
let frontCookie;
let parentCookie;
let aroonId;
let mayaId;
let priyaId;
let eventId;
let serviceId;
let hiddenServiceId;

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
  return cookieHeader(response);
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

function pick(studentId, staffId, slot) {
  return {
    student_powerschool_id: studentId,
    service_id: serviceId,
    staff_id: staffId,
    start_time: slot.start_time,
    end_time: slot.end_time,
  };
}

describe('booking submission', { concurrency: false }, () => {
  before(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ptc-book-'));
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
    adminCookie = await login('it.admin@nis.ac.th');
    teacherCookie = await login('teacher@nis.ac.th');
    otherTeacherCookie = await login('other.teacher@nis.ac.th');
    frontCookie = await login('front.office@nis.ac.th');
    const sync = await api('/api/v1/staff/sync', { method: 'POST', cookie: adminCookie, body: {} });
    aroonId = sync.json.staff.find((member) => member.powerschool_teacher_id === 'T1001').id;
    mayaId = sync.json.staff.find((member) => member.powerschool_teacher_id === 'T1002').id;
    priyaId = sync.json.staff.find((member) => member.powerschool_teacher_id === 'T1004').id;
    const event = await api('/api/v1/events', {
      method: 'POST',
      cookie: adminCookie,
      body: { name: 'October conferences', event_date: future },
    });
    eventId = event.json.event.id;
    const service = await api(`/api/v1/events/${eventId}/services`, {
      method: 'POST',
      cookie: adminCookie,
      body: { name: 'Elementary', slot_duration_minutes: 15 },
    });
    serviceId = service.json.service.id;
    for (const staffId of [aroonId, mayaId, priyaId]) {
      const assigned = await api(`/api/v1/services/${serviceId}/staff`, {
        method: 'POST',
        cookie: adminCookie,
        body: { staff_id: staffId },
      });
      assert.equal(assigned.status, 201, JSON.stringify(assigned.json));
    }
    for (const staffId of [aroonId, mayaId, priyaId]) {
      const block = await api(`/api/v1/events/${eventId}/staff/${staffId}/availability`, {
        method: 'POST',
        cookie: adminCookie,
        body: { start_time: `${future}T08:00`, end_time: `${future}T09:00`, block_type: 'bookable' },
      });
      assert.equal(block.status, 201, JSON.stringify(block.json));
    }
    const hidden = await api('/api/v1/events', {
      method: 'POST',
      cookie: adminCookie,
      body: { name: 'Hidden', event_date: future },
    });
    const hiddenService = await api(`/api/v1/events/${hidden.json.event.id}/services`, {
      method: 'POST',
      cookie: adminCookie,
      body: { name: 'Hidden service', slot_duration_minutes: 15 },
    });
    hiddenServiceId = hiddenService.json.service.id;
    await api(`/api/v1/services/${hiddenServiceId}/staff`, {
      method: 'POST',
      cookie: adminCookie,
      body: { staff_id: aroonId },
    });
    await api(`/api/v1/events/${eventId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { is_open_for_booking: true },
    });
    parentCookie = await verify('parent@nis.ac.th');
  });

  after(async () => {
    server.close();
    await once(server, 'close');
    db.close();
  });

  test('books a batch or nothing, then reschedules and cancels', async () => {
    const anon = await api('/api/v1/bookings', {
      method: 'POST',
      body: {
        parent_email: 'parent@nis.ac.th',
        parent_relationship: 'mother',
        picks: [],
      },
    });
    assert.equal(anon.status, 401);
    const empty = await api('/api/v1/bookings', {
      method: 'POST',
      cookie: parentCookie,
      body: { parent_email: 'parent@nis.ac.th', parent_relationship: 'mother', picks: [] },
    });
    assert.equal(empty.status, 400);

    const view = await api(`/api/v1/events/${eventId}/parent-view?email=parent@nis.ac.th`, { cookie: parentCookie });
    assert.equal(view.status, 200, JSON.stringify(view.json));
    const niran = view.json.children[0];
    const aroon = niran.teachers.find((teacher) => teacher.staff_id === aroonId);
    const maya = niran.teachers.find((teacher) => teacher.staff_id === mayaId);
    assert.equal(aroon.slots.length, 4);

    const badStudent = await api('/api/v1/bookings', {
      method: 'POST',
      cookie: parentCookie,
      body: {
        parent_email: 'parent@nis.ac.th',
        parent_relationship: 'mother',
        picks: [{ ...pick('S1001', aroonId, aroon.slots[0]), student_powerschool_id: 'S9999' }],
      },
    });
    assert.equal(badStudent.status, 400);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n, 0);

    const injected = await api('/api/v1/bookings', {
      method: 'POST',
      cookie: parentCookie,
      body: {
        parent_email: 'parent@nis.ac.th',
        parent_relationship: 'mother',
        picks: [{ ...pick('S1001', aroonId, aroon.slots[0]), student_powerschool_id: "S1001' OR '1'='1" }],
      },
    });
    assert.equal(injected.status, 400);

    const wrongTeacher = await api('/api/v1/bookings', {
      method: 'POST',
      cookie: parentCookie,
      body: {
        parent_email: 'parent@nis.ac.th',
        parent_relationship: 'mother',
        picks: [pick('S1001', priyaId, aroon.slots[0])],
      },
    });
    assert.equal(wrongTeacher.status, 400);
    assert.match(wrongTeacher.json.error.message, /not on this student's schedule/);

    const offGrid = await api('/api/v1/bookings', {
      method: 'POST',
      cookie: parentCookie,
      body: {
        parent_email: 'parent@nis.ac.th',
        parent_relationship: 'mother',
        picks: [{
          ...pick('S1001', aroonId, aroon.slots[0]),
          start_time: `${future}T08:01:00+07:00`,
          end_time: `${future}T08:16:00+07:00`,
        }],
      },
    });
    assert.equal(offGrid.status, 400);

    const hiddenPick = await api('/api/v1/bookings', {
      method: 'POST',
      cookie: parentCookie,
      body: {
        parent_email: 'parent@nis.ac.th',
        parent_relationship: 'mother',
        picks: [{ ...pick('S1001', aroonId, aroon.slots[0]), service_id: hiddenServiceId }],
      },
    });
    assert.equal(hiddenPick.status, 404);
    assert.equal(hiddenPick.json.error.message, 'Event not found');

    const other = await api('/api/v1/bookings', {
      method: 'POST',
      cookie: parentCookie,
      body: { parent_email: 'parent@nis.ac.th', parent_relationship: 'other', picks: [pick('S1001', aroonId, aroon.slots[0])] },
    });
    assert.equal(other.status, 400);

    const created = await api('/api/v1/bookings', {
      method: 'POST',
      cookie: parentCookie,
      body: {
        parent_email: 'Parent@NIS.ac.th',
        parent_relationship: 'mother',
        parent_first_name: 'Suda',
        picks: [pick('S1001', aroonId, aroon.slots[0]), pick('S1001', mayaId, maya.slots[0])],
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.equal(created.json.bookings.length, 2);
    assert.ok(created.json.booking_batch_id);
    assert.equal(created.json.bookings[0].student_name, 'Niran Srisuk');
    assert.equal(created.json.bookings[0].display_name, 'Aroon Srisuk');
    assert.equal(created.json.bookings[0].room, '204');
    assert.equal(created.json.bookings[0].parent_first_name, 'Suda');
    assert.equal(new Set(created.json.bookings.map((row) => row.booking_batch_id)).size, 1);
    const batchId = created.json.booking_batch_id;

    const partial = await api('/api/v1/bookings', {
      method: 'POST',
      cookie: parentCookie,
      body: {
        parent_email: 'parent@nis.ac.th',
        parent_relationship: 'father',
        picks: [pick('S1001', aroonId, aroon.slots[1]), pick('S1001', aroonId, aroon.slots[0])],
      },
    });
    assert.equal(partial.status, 409);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE status = 'confirmed'`).get().n, 2);

    const [first, second] = created.json.bookings;
    const moved = await api(`/api/v1/bookings/${first.id}/reschedule`, {
      method: 'PATCH',
      cookie: parentCookie,
      body: { start_time: aroon.slots[2].start_time, end_time: aroon.slots[2].end_time },
    });
    assert.equal(moved.status, 200, JSON.stringify(moved.json));
    assert.equal(moved.json.booking.start_time, aroon.slots[2].start_time);

    const teacherMove = await api(`/api/v1/bookings/${moved.json.booking.id}/reschedule`, {
      method: 'PATCH',
      cookie: teacherCookie,
      body: { start_time: aroon.slots[3].start_time, end_time: aroon.slots[3].end_time },
    });
    assert.equal(teacherMove.status, 200, JSON.stringify(teacherMove.json));

    const denied = await api(`/api/v1/bookings/${second.id}/reschedule`, {
      method: 'PATCH',
      cookie: teacherCookie,
      body: { start_time: maya.slots[1].start_time, end_time: maya.slots[1].end_time },
    });
    assert.equal(denied.status, 403);

    const front = await api(`/api/v1/bookings/${second.id}`, { method: 'DELETE', cookie: frontCookie });
    assert.equal(front.status, 403);

    const one = await api(`/api/v1/bookings/${second.id}`, { method: 'DELETE', cookie: parentCookie });
    assert.equal(one.status, 200);
    assert.equal(db.prepare(`SELECT status FROM bookings WHERE id = ?`).get(second.id).status, 'cancelled');

    const again = await api('/api/v1/bookings', {
      method: 'POST',
      cookie: parentCookie,
      body: {
        parent_email: 'parent@nis.ac.th',
        parent_relationship: 'mother',
        picks: [pick('S1001', mayaId, maya.slots[0])],
      },
    });
    assert.equal(again.status, 201, JSON.stringify(again.json));

    const whole = await api(`/api/v1/bookings/batch/${batchId}`, { method: 'DELETE', cookie: parentCookie });
    assert.equal(whole.status, 200);
    const left = db.prepare(`
      SELECT COUNT(*) AS n FROM bookings WHERE booking_batch_id = ? AND status = 'confirmed'
    `).get(batchId);
    assert.equal(left.n, 0);

    const stranger = await verify('closed@example.com');
    const foreign = await api(`/api/v1/bookings/batch/${again.json.booking_batch_id}`, {
      method: 'DELETE',
      cookie: stranger,
    });
    assert.equal(foreign.status, 403);
    assert.equal(db.prepare(`SELECT status FROM bookings WHERE id = ?`).get(again.json.bookings[0].id).status, 'confirmed');
  });

  test('locks create, reschedule, and cancel after cutoff', async () => {
    const view = await api(`/api/v1/events/${eventId}/parent-view?email=parent@nis.ac.th`, { cookie: parentCookie });
    const aroon = view.json.children[0].teachers.find((teacher) => teacher.staff_id === aroonId);
    const openSlot = aroon.slots.find((slot) => slot.available);
    const created = await api('/api/v1/bookings', {
      method: 'POST',
      cookie: parentCookie,
      body: {
        parent_email: 'parent@nis.ac.th',
        parent_relationship: 'guardian',
        picks: [pick('S1001', aroonId, openSlot)],
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const bookingId = created.json.bookings[0].id;

    const closed = await api(`/api/v1/events/${eventId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { cutoff_at: `${yesterday}T17:00` },
    });
    assert.equal(closed.status, 200, JSON.stringify(closed.json));

    const fresh = await api('/api/v1/bookings', {
      method: 'POST',
      cookie: parentCookie,
      body: {
        parent_email: 'parent@nis.ac.th',
        parent_relationship: 'guardian',
        picks: [pick('S1001', mayaId, view.json.children[0].teachers.find((teacher) => teacher.staff_id === mayaId).slots[2])],
      },
    });
    assert.equal(fresh.status, 423);
    assert.equal(fresh.json.error.code, 'LOCKED');
    assert.match(fresh.json.error.message, /^Changes closed /);

    const moved = await api(`/api/v1/bookings/${bookingId}/reschedule`, {
      method: 'PATCH',
      cookie: parentCookie,
      body: { start_time: aroon.slots[0].start_time, end_time: aroon.slots[0].end_time },
    });
    assert.equal(moved.status, 423);
    assert.match(moved.json.error.message, /^Changes closed /);

    const removed = await api(`/api/v1/bookings/${bookingId}`, { method: 'DELETE', cookie: parentCookie });
    assert.equal(removed.status, 423);
    const batch = await api(`/api/v1/bookings/batch/${created.json.booking_batch_id}`, {
      method: 'DELETE',
      cookie: parentCookie,
    });
    assert.equal(batch.status, 423);
    assert.equal(db.prepare(`SELECT status FROM bookings WHERE id = ?`).get(bookingId).status, 'confirmed');
  });

  test('only one of two concurrent claims keeps the slot', async () => {
    await api(`/api/v1/events/${eventId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { cutoff_at: null },
    });
    const view = await api(`/api/v1/events/${eventId}/parent-view?email=parent@nis.ac.th`, { cookie: parentCookie });
    const priya = view.json.children[1].teachers.find((teacher) => teacher.staff_id === priyaId);
    const slot = priya.slots.find((item) => item.available);
    const body = {
      parent_email: 'parent@nis.ac.th',
      parent_relationship: 'mother',
      picks: [pick('S1002', priyaId, slot)],
    };
    const [first, second] = await Promise.all([
      api('/api/v1/bookings', { method: 'POST', cookie: parentCookie, body }),
      api('/api/v1/bookings', { method: 'POST', cookie: parentCookie, body }),
    ]);
    const statuses = [first.status, second.status].sort();
    assert.deepEqual(statuses, [201, 409]);
    const rows = db.prepare(`
      SELECT COUNT(*) AS n FROM bookings
      WHERE staff_id = ? AND start_time = ? AND status = 'confirmed'
    `).get(priyaId, slot.start_time);
    assert.equal(rows.n, 1);
  });
});
