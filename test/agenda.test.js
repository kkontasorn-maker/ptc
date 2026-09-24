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
  'missing.teacher@nis.ac.th': { role: 'teacher', teacherid: 'T9999' },
};

function addDays(iso, days) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

const today = todayInZone(new Date(), 'Asia/Bangkok');
const future = addDays(today, 50);

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
let eventId;
let serviceId;

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

describe('teacher agenda', { concurrency: false }, () => {
  before(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ptc-agenda-'));
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
    const event = await api('/api/v1/events', {
      method: 'POST',
      cookie: adminCookie,
      body: { name: 'Agenda day', event_date: future, cutoff_at: `${future}T17:00` },
    });
    eventId = event.json.event.id;
    const service = await api(`/api/v1/events/${eventId}/services`, {
      method: 'POST',
      cookie: adminCookie,
      body: { name: 'Elementary', slot_duration_minutes: 15 },
    });
    serviceId = service.json.service.id;
    for (const staffId of [aroonId, mayaId]) {
      const assigned = await api(`/api/v1/services/${serviceId}/staff`, {
        method: 'POST',
        cookie: adminCookie,
        body: { staff_id: staffId },
      });
      assert.equal(assigned.status, 201);
      const block = await api(`/api/v1/events/${eventId}/staff/${staffId}/availability`, {
        method: 'POST',
        cookie: adminCookie,
        body: { start_time: `${future}T08:00`, end_time: `${future}T09:00`, block_type: 'bookable' },
      });
      assert.equal(block.status, 201, JSON.stringify(block.json));
    }
    await api(`/api/v1/events/${eventId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { is_open_for_booking: true },
    });
    parentCookie = await verify('parent@nis.ac.th');
    const view = await api(`/api/v1/events/${eventId}/parent-view?email=parent@nis.ac.th`, { cookie: parentCookie });
    assert.equal(view.status, 200, JSON.stringify(view.json));
    const niran = view.json.children[0];
    const aroon = niran.teachers.find((teacher) => teacher.staff_id === aroonId);
    const maya = niran.teachers.find((teacher) => teacher.staff_id === mayaId);
    const booked = await api('/api/v1/bookings', {
      method: 'POST',
      cookie: parentCookie,
      body: {
        parent_email: 'parent@nis.ac.th',
        parent_relationship: 'mother',
        picks: [
          {
            student_powerschool_id: 'S1001',
            service_id: serviceId,
            staff_id: aroonId,
            start_time: aroon.slots[0].start_time,
            end_time: aroon.slots[0].end_time,
          },
          {
            student_powerschool_id: 'S1001',
            service_id: serviceId,
            staff_id: mayaId,
            start_time: maya.slots[1].start_time,
            end_time: maya.slots[1].end_time,
          },
        ],
      },
    });
    assert.equal(booked.status, 201, JSON.stringify(booked.json));
    const oddName = "Niran'); DROP TABLE bookings;--";
    db.prepare(`
      UPDATE bookings SET student_name = ? WHERE staff_id = ? AND status = 'confirmed'
    `).run(oddName, aroonId);
  });

  after(async () => {
    server.close();
    await once(server, 'close');
    db.close();
  });

  test('scopes the agenda to the session teacher and ignores staff_id', async () => {
    const anon = await api(`/api/v1/events/${eventId}/my-schedule`);
    assert.equal(anon.status, 401);

    const admin = await api(`/api/v1/events/${eventId}/my-schedule`, { cookie: adminCookie });
    assert.equal(admin.status, 403);
    const front = await api(`/api/v1/events/${eventId}/my-schedule`, { cookie: frontCookie });
    assert.equal(front.status, 403);

    const missing = await api(`/api/v1/events/${eventId}/my-schedule`, {
      cookie: await login('missing.teacher@nis.ac.th'),
    });
    assert.equal(missing.status, 404);

    const schedule = await api(`/api/v1/events/${eventId}/my-schedule?staff_id=${mayaId}`, {
      cookie: teacherCookie,
    });
    assert.equal(schedule.status, 200, JSON.stringify(schedule.json));
    assert.equal(schedule.json.staff.id, aroonId);
    assert.equal(schedule.json.staff.powerschool_teacher_id, 'T1001');
    assert.equal(schedule.json.bookings.length, 1);
    assert.equal(schedule.json.bookings[0].student_name, "Niran'); DROP TABLE bookings;--");
    assert.equal(Object.hasOwn(schedule.json.bookings[0], 'parent_email'), false);
    assert.equal(schedule.json.bookings[0].service_name, 'Elementary');
    assert.equal(schedule.json.bookings[0].slot_duration_minutes, 15);
    assert.equal(schedule.json.services.length, 1);
    assert.equal(schedule.json.blocks.length, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n, 2);

    const other = await api(`/api/v1/events/${eventId}/my-schedule?staff_id=${aroonId}`, {
      cookie: otherTeacherCookie,
    });
    assert.equal(other.status, 200);
    assert.equal(other.json.staff.id, mayaId);
    assert.equal(other.json.bookings.length, 1);
    assert.notEqual(other.json.bookings[0].student_name, schedule.json.bookings[0].student_name);
  });

  test('lets a teacher block a break and refuses another staff id', async () => {
    const own = await api(`/api/v1/events/${eventId}/staff/${aroonId}/availability`, {
      method: 'POST',
      cookie: teacherCookie,
      body: { start_time: `${future}T12:00`, end_time: `${future}T12:30`, block_type: 'break' },
    });
    assert.equal(own.status, 201, JSON.stringify(own.json));
    assert.equal(own.json.block.block_type, 'break');

    const stolen = await api(`/api/v1/events/${eventId}/staff/${mayaId}/availability`, {
      method: 'POST',
      cookie: teacherCookie,
      body: { start_time: `${future}T12:00`, end_time: `${future}T12:30`, block_type: 'break' },
    });
    assert.equal(stolen.status, 403);

    const schedule = await api(`/api/v1/events/${eventId}/my-schedule`, { cookie: teacherCookie });
    assert.equal(schedule.json.blocks.filter((block) => block.block_type === 'break').length, 1);
  });

  test('reschedule stays on the teacher agenda rules and locks after cutoff', async () => {
    const schedule = await api(`/api/v1/events/${eventId}/my-schedule`, { cookie: teacherCookie });
    const bookingId = schedule.json.bookings[0].id;
    const moved = await api(`/api/v1/bookings/${bookingId}/reschedule`, {
      method: 'PATCH',
      cookie: teacherCookie,
      body: { start_time: `${future}T08:15`, end_time: `${future}T08:30` },
    });
    assert.equal(moved.status, 200, JSON.stringify(moved.json));

    const otherMove = await api(`/api/v1/bookings/${bookingId}/reschedule`, {
      method: 'PATCH',
      cookie: otherTeacherCookie,
      body: { start_time: `${future}T08:30`, end_time: `${future}T08:45` },
    });
    assert.equal(otherMove.status, 403);

    await api(`/api/v1/events/${eventId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { cutoff_at: '2000-01-01T00:00:00+07:00' },
    });
    const lockedMove = await api(`/api/v1/bookings/${bookingId}/reschedule`, {
      method: 'PATCH',
      cookie: teacherCookie,
      body: { start_time: `${future}T08:30`, end_time: `${future}T08:45` },
    });
    assert.equal(lockedMove.status, 423);
    assert.equal(lockedMove.json.error.code, 'LOCKED');
    assert.match(lockedMove.json.error.message, /^Changes closed /);

    const lockedBreak = await api(`/api/v1/events/${eventId}/staff/${aroonId}/availability`, {
      method: 'POST',
      cookie: teacherCookie,
      body: { start_time: `${future}T13:00`, end_time: `${future}T13:15`, block_type: 'break' },
    });
    assert.equal(lockedBreak.status, 423);
  });
});
