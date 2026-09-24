import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { projectRoot } from '../src/config.js';
import { formatConferenceDate } from '../src/conflicts.js';
import { todayInZone } from '../src/time.js';

const roleMap = {
  'it.admin@nis.ac.th': { role: 'it_admin' },
  'teacher@nis.ac.th': { role: 'teacher', teacherid: 'T1001' },
};

const REASON = 'family emergency — do not forward';
const today = todayInZone(new Date(), 'Asia/Bangkok');
const future = addDays(today, 40);
const when = formatConferenceDate(future);

function addDays(iso, days) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function cookieHeader(response) {
  const list = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  return list.map((item) => item.split(';')[0]).join('; ');
}

function sentence(student) {
  return `Aroon Srisuk's availability for your ${when} Parent-Teacher Conference booking with ${student} has changed. Please check the app to reschedule, or contact front office for help.`;
}

describe('teacher unavailability overrides', { concurrency: false }, () => {
  let server;
  let base;
  let db;
  let admin;
  let teacher;
  let eventId;
  let serviceId;
  let staffId;
  const sent = [];
  const mail = {
    configured: true,
    from: 'conferences@nis.ac.th',
    allowlist: null,
    host: 'smtp.example.test',
    port: 587,
    transport: {
      async sendMail(message) {
        sent.push(message);
      },
    },
  };

  before(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ptc-conflict-'));
    const app = createApp({
      dbPath: path.join(dir, 'test.sqlite'),
      schemaPath: path.join(projectRoot, 'db', 'schema.sql'),
      publicDir: path.join(projectRoot, 'public'),
      sessionSecret: 'test-secret',
      timeZone: 'Asia/Bangkok',
      cookieSecure: false,
      localAuth: true,
      roleMap,
      google: { configured: false },
      psapi: {},
      mail,
    });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
    db = app.locals.db;
    admin = await login('it.admin@nis.ac.th');
    teacher = await login('teacher@nis.ac.th');
    const sync = await api('/api/v1/staff/sync', { method: 'POST', cookie: admin, body: {} });
    assert.equal(sync.status, 200, sync.text);
    staffId = sync.json.staff.find((member) => member.powerschool_teacher_id === 'T1001').id;
    const event = await api('/api/v1/events', {
      method: 'POST',
      cookie: admin,
      body: { name: 'October conferences', event_date: future, cutoff_at: `${future}T17:00` },
    });
    eventId = event.json.event.id;
    const service = await api(`/api/v1/events/${eventId}/services`, {
      method: 'POST',
      cookie: admin,
      body: { name: 'Elementary', slot_duration_minutes: 15 },
    });
    serviceId = service.json.service.id;
    const assigned = await api(`/api/v1/services/${serviceId}/staff`, {
      method: 'POST',
      cookie: admin,
      body: { staff_id: staffId },
    });
    assert.equal(assigned.status, 201, assigned.text);
    insertBooking({
      studentId: 'S1',
      student: 'Niran Srisuk',
      email: 'parent.a@example.com',
      start: `${future}T09:00:00+07:00`,
      end: `${future}T09:15:00+07:00`,
    });
    insertBooking({
      studentId: 'S2',
      student: 'Malee Srisuk',
      email: 'parent.a@example.com',
      start: `${future}T09:15:00+07:00`,
      end: `${future}T09:30:00+07:00`,
    });
    insertBooking({
      studentId: 'S3',
      student: 'Other Student',
      email: 'parent.b@example.com',
      start: `${future}T09:30:00+07:00`,
      end: `${future}T09:45:00+07:00`,
    });
  });

  after(async () => {
    server.close();
    await once(server, 'close');
    db.close();
  });

  function insertBooking({ studentId, student, email, start, end }) {
    db.prepare(`
      INSERT INTO bookings (
        event_id, service_id, staff_id, start_time, end_time, booking_batch_id,
        student_powerschool_id, student_name, parent_email, parent_relationship
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'mother')
    `).run(eventId, serviceId, staffId, start, end, `batch-${studentId}`, studentId, student, email);
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
    assert.equal(response.status, 200);
    return cookieHeader(response);
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
    return { status: response.status, json, text };
  }

  function logs() {
    return db.prepare(`
      SELECT booking_id, reason, created_by, notified_at
      FROM booking_conflict_log
      ORDER BY id
    `).all();
  }

  const breakBody = {
    start_time: `${future}T09:00`,
    end_time: `${future}T10:00`,
    block_type: 'break',
  };

  test('rejects a confirmed override with no reason', async () => {
    for (const body of [
      { ...breakBody, confirm_override: true },
      { ...breakBody, confirm_override: true, reason: '   ' },
    ]) {
      const response = await api(`/api/v1/events/${eventId}/staff/${staffId}/availability`, {
        method: 'POST',
        cookie: teacher,
        body,
      });
      assert.equal(response.status, 422, response.text);
      assert.equal(response.json.error.code, 'UNPROCESSABLE');
      assert.equal(response.text.includes(REASON), false);
    }
    const unassign = await api(`/api/v1/services/${serviceId}/staff/${staffId}`, {
      method: 'DELETE',
      cookie: admin,
      body: { confirm_override: true, reason: '' },
    });
    assert.equal(unassign.status, 422, unassign.text);
    assert.equal(logs().length, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM availability_blocks').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bookings WHERE needs_attention = 1').get().n, 0);
  });

  test('lists affected bookings and writes nothing until the reason is confirmed', async () => {
    const blocked = await api(`/api/v1/events/${eventId}/staff/${staffId}/availability`, {
      method: 'POST',
      cookie: teacher,
      body: breakBody,
    });
    assert.equal(blocked.status, 409, blocked.text);
    assert.equal(blocked.json.error.bookings.length, 3);
    assert.deepEqual(
      blocked.json.error.bookings.map((row) => row.parent_email),
      ['parent.a@example.com', 'parent.a@example.com', 'parent.b@example.com'],
    );
    const stillAssigned = await api(`/api/v1/services/${serviceId}/staff/${staffId}`, {
      method: 'DELETE',
      cookie: admin,
    });
    assert.equal(stillAssigned.status, 409, stillAssigned.text);
    assert.equal(stillAssigned.json.error.bookings.length, 3);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM staff_services').get().n, 1);
  });

  test('notifies each parent once, keeps the reason out of the email, and stamps notified_at only after a real send', async () => {
    const created = await api(`/api/v1/events/${eventId}/staff/${staffId}/availability`, {
      method: 'POST',
      cookie: teacher,
      body: { ...breakBody, confirm_override: true, reason: REASON },
    });
    assert.equal(created.status, 201, created.text);
    assert.equal(created.json.block.block_type, 'break');

    const flagged = db.prepare('SELECT id, needs_attention FROM bookings ORDER BY id').all();
    assert.equal(flagged.every((row) => row.needs_attention === 1), true);
    const written = logs();
    assert.equal(written.length, 3);
    assert.equal(written.every((row) => row.reason === REASON && row.created_by === 'teacher@nis.ac.th'), true);
    assert.equal(written.every((row) => row.notified_at), true);

    assert.equal(sent.length, 2);
    const parentA = sent.find((message) => message.to === 'parent.a@example.com');
    const parentB = sent.find((message) => message.to === 'parent.b@example.com');
    assert.ok(parentA);
    assert.ok(parentB);
    assert.equal(parentA.text, `${sentence('Niran Srisuk')}\n\n${sentence('Malee Srisuk')}\n`);
    assert.equal(parentB.text, `${sentence('Other Student')}\n`);
    assert.equal(sent.some((message) => `${message.subject}\n${message.text}`.includes(REASON)), false);
    assert.equal(sent.some((message) => message.text.includes('do not forward')), false);

    mail.transport = {
      async sendMail() {
        throw new Error('smtp down');
      },
    };
    const before = logs().length;
    const failed = await api(`/api/v1/services/${serviceId}/staff/${staffId}`, {
      method: 'DELETE',
      cookie: admin,
      body: { confirm_override: true, reason: REASON },
    });
    assert.equal(failed.status, 200, failed.text);
    const after = logs();
    assert.equal(after.length, before + 3);
    assert.equal(after.slice(before).every((row) => row.notified_at == null), true);
    assert.equal(after.slice(before).every((row) => row.created_by === 'it.admin@nis.ac.th'), true);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM staff_services').get().n, 0);
    assert.equal(sent.length, 2);

    mail.configured = false;
    insertBooking({
      studentId: 'S4',
      student: 'Logged Only',
      email: 'parent.c@example.com',
      start: `${future}T11:00:00+07:00`,
      end: `${future}T11:15:00+07:00`,
    });
    const logged = await api(`/api/v1/events/${eventId}/staff/${staffId}/availability`, {
      method: 'POST',
      cookie: teacher,
      body: {
        start_time: `${future}T11:00`,
        end_time: `${future}T11:15`,
        block_type: 'break',
        confirm_override: true,
        reason: REASON,
      },
    });
    assert.equal(logged.status, 201, logged.text);
    const consoleRow = logs().at(-1);
    assert.equal(consoleRow.notified_at, null);
    assert.equal(consoleRow.reason, REASON);
  });
});
