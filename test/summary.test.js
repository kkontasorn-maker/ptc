import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { projectRoot } from '../src/config.js';
import { summaryMessage } from '../src/mail/mailer.js';
import { runCutoffSummaries } from '../src/summary-job.js';
import { todayInZone } from '../src/time.js';

const roleMap = {
  'it.admin@nis.ac.th': { role: 'it_admin' },
  'front.office@nis.ac.th': { role: 'front_office' },
  'teacher@nis.ac.th': { role: 'teacher', teacherid: 'T1001' },
};

function addDays(iso, days) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

const today = todayInZone(new Date(), 'Asia/Bangkok');
const future = addDays(today, 45);
const yesterday = addDays(today, -1);

let app;
let server;
let base;
let db;
let adminCookie;
let teacherCookie;
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

describe('cutoff summary and booking report', { concurrency: false }, () => {
  before(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ptc-summary-'));
    app = createApp({
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
    frontCookie = await login('front.office@nis.ac.th');
    const sync = await api('/api/v1/staff/sync', { method: 'POST', cookie: adminCookie, body: {} });
    aroonId = sync.json.staff.find((member) => member.powerschool_teacher_id === 'T1001').id;
    mayaId = sync.json.staff.find((member) => member.powerschool_teacher_id === 'T1002').id;
    const event = await api('/api/v1/events', {
      method: 'POST',
      cookie: adminCookie,
      body: { name: 'October conferences', event_date: future, cutoff_at: `${future}T17:00` },
    });
    eventId = event.json.event.id;
    const service = await api(`/api/v1/events/${eventId}/services`, {
      method: 'POST',
      cookie: adminCookie,
      body: { name: 'Elementary', slot_duration_minutes: 15 },
    });
    serviceId = service.json.service.id;
    for (const staffId of [aroonId, mayaId]) {
      assert.equal((await api(`/api/v1/services/${serviceId}/staff`, {
        method: 'POST',
        cookie: adminCookie,
        body: { staff_id: staffId },
      })).status, 201);
      assert.equal((await api(`/api/v1/events/${eventId}/staff/${staffId}/availability`, {
        method: 'POST',
        cookie: adminCookie,
        body: { start_time: `${future}T08:00`, end_time: `${future}T09:00`, block_type: 'bookable' },
      })).status, 201);
    }
    db.prepare(`
      UPDATE staff_services SET room_override = ? WHERE staff_id = ? AND service_id = ?
    `).run('Lab 1', aroonId, serviceId);
    await api(`/api/v1/events/${eventId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { is_open_for_booking: true },
    });
    parentCookie = await verify('parent@nis.ac.th');
    const view = await api(`/api/v1/events/${eventId}/parent-view?email=parent@nis.ac.th`, { cookie: parentCookie });
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
    db.prepare(`
      UPDATE bookings SET student_name = ? WHERE staff_id = ? AND status = 'confirmed'
    `).run("Niran'); DROP TABLE bookings;--", aroonId);
    db.prepare(`
      INSERT INTO bookings (
        event_id, service_id, staff_id, start_time, end_time, booking_batch_id,
        student_powerschool_id, student_name, parent_email, parent_relationship, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'father', 'cancelled')
    `).run(
      eventId, serviceId, aroonId,
      `${future}T08:30:00+07:00`, `${future}T08:45:00+07:00`,
      'cancelled-batch', 'S1001', 'Cancelled Child', 'parent@nis.ac.th',
    );
    db.prepare(`
      INSERT INTO bookings (
        event_id, service_id, staff_id, start_time, end_time, booking_batch_id,
        student_powerschool_id, student_name, parent_email, parent_relationship, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'guardian', 'confirmed')
    `).run(
      eventId, serviceId, mayaId,
      `${future}T08:45:00+07:00`, `${future}T09:00:00+07:00`,
      'other-batch', 'S9', 'Other Child', 'other.parent@example.com',
    );
  });

  after(async () => {
    server.close();
    await once(server, 'close');
    db.close();
  });

  test('gives front office the booking report and refuses their writes', async () => {
    const anon = await api(`/api/v1/events/${eventId}/bookings`);
    assert.equal(anon.status, 401);
    const teacher = await api(`/api/v1/events/${eventId}/bookings`, { cookie: teacherCookie });
    assert.equal(teacher.status, 403);
    assert.equal(teacher.json.bookings, undefined);

    const report = await api(`/api/v1/events/${eventId}/bookings`, { cookie: frontCookie });
    assert.equal(report.status, 200, JSON.stringify(report.json));
    assert.equal(report.json.bookings.length, 4);
    const named = report.json.bookings.find((row) => row.student_name.includes('DROP TABLE'));
    assert.equal(named.location, 'Room Lab 1');
    assert.equal(named.display_name.length > 0, true);
    const maya = report.json.bookings.find((row) => row.staff_id === mayaId && row.status === 'confirmed' && row.parent_email === 'parent@nis.ac.th');
    assert.equal(maya.location, 'Room 118');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n, 4);

    const writeBooking = await api('/api/v1/bookings', {
      method: 'POST',
      cookie: frontCookie,
      body: { parent_email: 'parent@nis.ac.th', parent_relationship: 'mother', picks: [] },
    });
    assert.equal(writeBooking.status, 403);
    const writeEvent = await api(`/api/v1/events/${eventId}`, {
      method: 'PATCH',
      cookie: frontCookie,
      body: { name: 'Renamed' },
    });
    assert.equal(writeEvent.status, 403);
    const blockId = db.prepare('SELECT id FROM availability_blocks WHERE staff_id = ?').get(aroonId).id;
    const writeBlock = await api(`/api/v1/availability/${blockId}`, {
      method: 'PATCH',
      cookie: frontCookie,
      body: { start_time: `${future}T08:00`, end_time: `${future}T08:30` },
    });
    assert.equal(writeBlock.status, 403);
  });

  test('locks a repeat cancel and an availability move after cutoff', async () => {
    const before = [];
    await runCutoffSummaries({
      repos: app.locals.repos,
      mail: { configured: true },
      psapi: app.locals.psapi,
      deliver: async (message) => { before.push(message); },
    });
    assert.equal(before.length, 0);
    assert.equal(db.prepare('SELECT summary_sent_at FROM events WHERE id = ?').get(eventId).summary_sent_at, null);

    const closed = await api(`/api/v1/events/${eventId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { cutoff_at: `${yesterday}T17:00` },
    });
    assert.equal(closed.status, 200);
    const blockId = db.prepare('SELECT id FROM availability_blocks WHERE staff_id = ?').get(aroonId).id;
    const moved = await api(`/api/v1/availability/${blockId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { start_time: `${future}T07:00`, end_time: `${future}T08:00` },
    });
    assert.equal(moved.status, 423);
    assert.match(moved.json.error.message, /^Changes closed /);
    const cancelledId = db.prepare(`
      SELECT id FROM bookings WHERE student_name = 'Cancelled Child'
    `).get().id;
    const again = await api(`/api/v1/bookings/${cancelledId}`, {
      method: 'DELETE',
      cookie: parentCookie,
    });
    assert.equal(again.status, 423);
    assert.equal(db.prepare('SELECT status FROM bookings WHERE id = ?').get(cancelledId).status, 'cancelled');
  });

  test('sends one summary per parent and does not send it twice', async () => {
    const sent = [];
    await runCutoffSummaries({
      repos: app.locals.repos,
      mail: { configured: true },
      psapi: app.locals.psapi,
      deliver: async (message) => { sent.push(message); },
    });
    assert.equal(sent.length, 2);
    const parent = sent.find((message) => message.email === 'parent@nis.ac.th');
    const other = sent.find((message) => message.email === 'other.parent@example.com');
    const parentText = summaryMessage({ eventName: 'October conferences', bookings: parent.bookings });
    const otherText = summaryMessage({ eventName: 'October conferences', bookings: other.bookings });
    assert.equal(parent.bookings.length, 2);
    assert.match(parentText, /DROP TABLE bookings/);
    assert.match(parentText, /Room Lab 1/);
    assert.match(parentText, /Room 118/);
    assert.doesNotMatch(parentText, /Cancelled Child/);
    assert.equal(other.bookings.length, 1);
    assert.match(otherText, /NIS Elementary Building/);
    assert.ok(db.prepare('SELECT summary_sent_at FROM events WHERE id = ?').get(eventId).summary_sent_at);

    const again = [];
    await runCutoffSummaries({
      repos: app.locals.repos,
      mail: { configured: true },
      psapi: app.locals.psapi,
      deliver: async (message) => { again.push(message); },
    });
    assert.equal(again.length, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n, 4);
  });

  test('retries a summary when the first send fails', async () => {
    const event = await api('/api/v1/events', {
      method: 'POST',
      cookie: adminCookie,
      body: { name: 'Retry conferences', event_date: future, cutoff_at: `${yesterday}T09:00` },
    });
    const retryId = event.json.event.id;
    db.prepare(`
      INSERT INTO bookings (
        event_id, service_id, staff_id, start_time, end_time, booking_batch_id,
        student_powerschool_id, student_name, parent_email, parent_relationship
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'mother')
    `).run(
      retryId, serviceId, aroonId,
      `${future}T12:00:00+07:00`, `${future}T12:15:00+07:00`,
      'retry-batch', 'S1001', 'Niran Srisuk', 'parent@nis.ac.th',
    );
    await runCutoffSummaries({
      repos: app.locals.repos,
      mail: { configured: true },
      psapi: app.locals.psapi,
      deliver: async () => { throw new Error('smtp down'); },
    });
    assert.equal(db.prepare('SELECT summary_sent_at FROM events WHERE id = ?').get(retryId).summary_sent_at, null);

    const sent = [];
    await runCutoffSummaries({
      repos: app.locals.repos,
      mail: { configured: true },
      psapi: app.locals.psapi,
      deliver: async (message) => { sent.push(message.email); },
    });
    assert.deepEqual(sent, ['parent@nis.ac.th']);
    assert.ok(db.prepare('SELECT summary_sent_at FROM events WHERE id = ?').get(retryId).summary_sent_at);
  });
});
