import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { projectRoot } from '../src/config.js';
import { PsapiError } from '../src/errors.js';
import { createApp } from '../src/app.js';
import { clearGuardianCache } from '../src/psapi/guardian-cache.js';
import { todayInZone } from '../src/time.js';

const roleMap = {
  'it.admin@nis.ac.th': { role: 'it_admin' },
  'parent@nis.ac.th': { role: 'parent' },
};

function addDays(iso, days) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

const today = todayInZone(new Date(), 'Asia/Bangkok');
const future = addDays(today, 30);

let server;
let base;
let db;
let adminCookie;
let parentDevice;
let aroonId;
let mayaId;
let priyaId;

function cookieHeader(response) {
  const list = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  return list.map((item) => item.split(';')[0]).join('; ');
}

function deviceCookie(response) {
  const raw = (response.headers.getSetCookie?.() || []).join('\n') || response.headers.get('set-cookie') || '';
  const match = /nis_ptc_device=([^;]+)/.exec(raw);
  assert.ok(match, raw);
  assert.match(raw, /HttpOnly/i);
  assert.match(raw, /Secure/i);
  assert.match(raw, /SameSite=Lax/i);
  assert.match(raw, /Max-Age=15552000/);
  return `nis_ptc_device=${match[1]}`;
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
  return { status: response.status, json, headers: response.headers };
}

function latestCode(email) {
  return db.prepare(`
    SELECT code FROM verification_codes WHERE email = ? ORDER BY id DESC LIMIT 1
  `).get(email).code;
}

async function sendCode(email) {
  const sent = await api('/api/v1/auth/verification-codes', { method: 'POST', body: { email } });
  assert.equal(sent.status, 201, JSON.stringify(sent.json));
  assert.equal(sent.json.ok, true);
  assert.equal(sent.json.dev_code, undefined);
  return latestCode(email.trim().toLowerCase());
}

async function verify(email) {
  const code = await sendCode(email);
  const confirmed = await api('/api/v1/auth/verification-codes/confirm', {
    method: 'POST',
    body: { email, code },
  });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
  assert.deepEqual(confirmed.json, { ok: true });
  return deviceCookie(confirmed);
}

describe('parent identity', { concurrency: false }, () => {
  before(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ptc-identity-'));
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
    const login = await api('/api/v1/auth/session', {
      method: 'POST',
      body: { email: 'it.admin@nis.ac.th' },
    });
    adminCookie = cookieHeader(login);
    const sync = await api('/api/v1/staff/sync', { method: 'POST', cookie: adminCookie, body: {} });
    assert.equal(sync.status, 200);
    aroonId = sync.json.staff.find((member) => member.powerschool_teacher_id === 'T1001').id;
    mayaId = sync.json.staff.find((member) => member.powerschool_teacher_id === 'T1002').id;
    priyaId = sync.json.staff.find((member) => member.powerschool_teacher_id === 'T1004').id;
  });

  after(async () => {
    server.close();
    await once(server, 'close');
    db.close();
  });

  test('issues a code, trusts the device, and rejects a bad or used code', async () => {
    const missing = await api('/api/v1/auth/device-status?email=parent@nis.ac.th');
    assert.equal(missing.status, 200);
    assert.deepEqual(missing.json, { verified: false });

    const invalid = await api('/api/v1/auth/device-status?email=not-an-email');
    assert.equal(invalid.status, 400);

    const blocked = await api('/api/v1/auth/verification-codes', {
      method: 'POST',
      body: { email: 'parent@nis.ac.th' },
      headers: { 'X-Requested-With': '' },
    });
    assert.equal(blocked.status, 403);

    const cookie = await verify('Parent@NIS.ac.th');
    parentDevice = cookie;
    const status = await api('/api/v1/auth/device-status?email=parent@nis.ac.th', { cookie });
    assert.deepEqual(status.json, { verified: true });
    const other = await api('/api/v1/auth/device-status?email=other@example.com', { cookie });
    assert.deepEqual(other.json, { verified: false });

    const again = await sendCode('parent@nis.ac.th');
    const wrong = await api('/api/v1/auth/verification-codes/confirm', {
      method: 'POST',
      cookie,
      body: { email: 'parent@nis.ac.th', code: again === '000000' ? '111111' : '000000' },
    });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.json.error.message, 'That code is not valid');

    const reused = await api('/api/v1/auth/verification-codes/confirm', {
      method: 'POST',
      cookie,
      body: { email: 'parent@nis.ac.th', code: again },
    });
    assert.equal(reused.status, 200);
    const reusedCookie = deviceCookie(reused);
    assert.equal(decodeURIComponent(reusedCookie.split('=')[1]), decodeURIComponent(cookie.split('=')[1]));
    const rows = db.prepare(`SELECT device_token FROM device_verifications WHERE email = ?`).all('parent@nis.ac.th');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].device_token, decodeURIComponent(cookie.split('=')[1]));

    const spent = await api('/api/v1/auth/verification-codes/confirm', {
      method: 'POST',
      cookie,
      body: { email: 'parent@nis.ac.th', code: again },
    });
    assert.equal(spent.status, 400);
  });

  test('rate-limits code sends and rejects an expired code', async () => {
    for (let n = 0; n < 3; n += 1) {
      const sent = await api('/api/v1/auth/verification-codes', {
        method: 'POST',
        body: { email: 'limit@example.com' },
      });
      assert.equal(sent.status, 201);
    }
    const limited = await api('/api/v1/auth/verification-codes', {
      method: 'POST',
      body: { email: 'limit@example.com' },
    });
    assert.equal(limited.status, 429);
    assert.equal(limited.json.error.code, 'RATE_LIMIT');
    const count = db.prepare(`SELECT COUNT(*) AS n FROM verification_codes WHERE email = ?`).get('limit@example.com');
    assert.equal(count.n, 3);

    const code = await sendCode('expired@example.com');
    db.prepare(`UPDATE verification_codes SET expires_at = ? WHERE email = ?`).run('2000-01-01T00:00:00.000Z', 'expired@example.com');
    const expired = await api('/api/v1/auth/verification-codes/confirm', {
      method: 'POST',
      body: { email: 'expired@example.com', code },
    });
    assert.equal(expired.status, 400);
    assert.equal(expired.json.error.message, 'That code is not valid');
  });

  test('returns matched children and NO_STUDENT_MATCH without an event', async () => {
    const anonymous = await api('/api/v1/parents/me/children?email=parent@nis.ac.th');
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.json.error.message, 'Verify your email before continuing.');

    const children = await api('/api/v1/parents/me/children?email=parent@nis.ac.th', { cookie: parentDevice });
    assert.equal(children.status, 200);
    assert.deepEqual(children.json.children, [
      { student_powerschool_id: 'S1001', name: 'Niran Srisuk', nickname: 'Nin', grade: '5' },
      { student_powerschool_id: 'S1002', name: 'Malee Srisuk', nickname: 'May', grade: '2' },
    ]);
    assert.equal(Object.hasOwn(children.json.children[0], 'teachers'), false);

    const stranger = await verify('or1eq1@example.com');
    const none = await api('/api/v1/parents/me/children?email=or1eq1@example.com', { cookie: stranger });
    assert.equal(none.status, 404);
    assert.equal(none.json.error.code, 'NO_STUDENT_MATCH');
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS n FROM verification_codes WHERE email = ?`).get('or1eq1@example.com').n,
      1,
    );
  });

  test('builds the parent view for an open event and hides unpublished events', async () => {
    const created = await api('/api/v1/events', {
      method: 'POST',
      cookie: adminCookie,
      body: { name: 'October conferences', event_date: future },
    });
    const eventId = created.json.event.id;
    const service = await api(`/api/v1/events/${eventId}/services`, {
      method: 'POST',
      cookie: adminCookie,
      body: { name: 'Elementary', slot_duration_minutes: 30 },
    });
    const serviceId = service.json.service.id;
    for (const staffId of [aroonId, mayaId, priyaId]) {
      const assigned = await api(`/api/v1/services/${serviceId}/staff`, {
        method: 'POST',
        cookie: adminCookie,
        body: { staff_id: staffId },
      });
      assert.equal(assigned.status, 201, JSON.stringify(assigned.json));
    }
    const window = await api(`/api/v1/events/${eventId}/staff/${aroonId}/availability`, {
      method: 'POST',
      cookie: adminCookie,
      body: {
        start_time: `${future}T08:00`,
        end_time: `${future}T09:10`,
        block_type: 'bookable',
      },
    });
    assert.equal(window.status, 201, JSON.stringify(window.json));
    const breakBlock = await api(`/api/v1/events/${eventId}/staff/${aroonId}/availability`, {
      method: 'POST',
      cookie: adminCookie,
      body: {
        start_time: `${future}T08:00`,
        end_time: `${future}T08:30`,
        block_type: 'break',
      },
    });
    assert.equal(breakBlock.status, 201, JSON.stringify(breakBlock.json));
    db.prepare(`UPDATE staff_services SET room_override = ? WHERE staff_id = ? AND service_id = ?`)
      .run('Gym', aroonId, serviceId);

    const hidden = await api(`/api/v1/events/${eventId}/parent-view?email=parent@nis.ac.th`, { cookie: parentDevice });
    assert.equal(hidden.status, 404);
    assert.equal(hidden.json.error.code, 'NOT_FOUND');
    assert.equal(hidden.json.error.message, 'Event not found');

    const stranger = await verify('closed@example.com');
    const hiddenStranger = await api(`/api/v1/events/${eventId}/parent-view?email=closed@example.com`, { cookie: stranger });
    assert.equal(hiddenStranger.json.error.code, 'NOT_FOUND');

    const opened = await api(`/api/v1/events/${eventId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { is_open_for_booking: true },
    });
    assert.equal(opened.status, 200);

    const probe = await api(`/api/v1/events/${eventId}/parent-view?email=parent@nis.ac.th`);
    assert.equal(probe.status, 401);
    const missingProbe = await api('/api/v1/events/999999/parent-view?email=parent@nis.ac.th');
    assert.equal(missingProbe.status, 401);
    const badId = await api('/api/v1/events/nope/parent-view?email=parent@nis.ac.th', { cookie: parentDevice });
    assert.equal(badId.status, 400);

    const view = await api(`/api/v1/events/${eventId}/parent-view?email=parent@nis.ac.th`, { cookie: parentDevice });
    assert.equal(view.status, 200, JSON.stringify(view.json));
    const [niran, malee] = view.json.children;
    assert.equal(niran.student_powerschool_id, 'S1001');
    assert.deepEqual(niran.teachers.map((teacher) => teacher.staff_id), [aroonId, mayaId]);
    const aroon = niran.teachers[0];
    assert.equal(aroon.display_name, 'Aroon Srisuk');
    assert.equal(aroon.photo_url, null);
    assert.equal(aroon.room, 'Gym');
    assert.equal(aroon.service_id, serviceId);
    assert.equal(aroon.slot_duration_minutes, 30);
    assert.equal(aroon.already_booked, null);
    assert.deepEqual(aroon.slots, [
      { start_time: `${future}T08:00:00+07:00`, end_time: `${future}T08:30:00+07:00`, available: true },
      { start_time: `${future}T08:30:00+07:00`, end_time: `${future}T09:00:00+07:00`, available: true },
    ]);
    assert.equal(niran.teachers[1].room, '118');
    assert.deepEqual(niran.teachers[1].slots, []);
    assert.equal(niran.teachers[1].already_booked, null);
    assert.equal(malee.teachers[0].display_name, 'Priya Nair');
    assert.equal(malee.teachers[0].room, '112');
    assert.equal(malee.teachers[0].already_booked, null);

    const slot = aroon.slots[0];
    const bookingId = Number(db.prepare(`
      INSERT INTO bookings (
        event_id, service_id, staff_id, start_time, end_time, booking_batch_id,
        student_powerschool_id, student_name, parent_email, parent_relationship
      ) VALUES (?, ?, ?, ?, ?, ?, 'S1001', 'Niran Srisuk', 'parent@nis.ac.th', 'mother')
    `).run(eventId, serviceId, aroonId, slot.start_time, slot.end_time, crypto.randomUUID()).lastInsertRowid);

    db.prepare(`
      INSERT INTO bookings (
        event_id, service_id, staff_id, start_time, end_time, booking_batch_id,
        student_powerschool_id, student_name, parent_email, parent_relationship
      ) VALUES (?, ?, ?, ?, ?, ?, 'S1001', 'Niran Srisuk', 'other@example.com', 'father')
    `).run(eventId, serviceId, aroonId, aroon.slots[1].start_time, aroon.slots[1].end_time, crypto.randomUUID());

    const booked = await api(`/api/v1/events/${eventId}/parent-view?email=parent@nis.ac.th`, { cookie: parentDevice });
    const updated = booked.json.children[0].teachers[0];
    assert.equal(updated.slots[0].available, false);
    assert.equal(updated.slots[1].available, false);
    assert.deepEqual(updated.already_booked, {
      booking_id: bookingId,
      start_time: slot.start_time,
      end_time: slot.end_time,
    });

    const gone = await api('/api/v1/events/999999/parent-view?email=parent@nis.ac.th', { cookie: parentDevice });
    assert.equal(gone.status, 404);
    assert.equal(gone.json.error.message, 'Event not found');

    const unmatched = await api(`/api/v1/events/${eventId}/parent-view?email=closed@example.com`, { cookie: stranger });
    assert.equal(unmatched.status, 404);
    assert.equal(unmatched.json.error.code, 'NO_STUDENT_MATCH');
  });
});

describe('verification extras', { concurrency: false }, () => {
  test('returns dev_code only when the server is allowed to expose it', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ptc-devcode-'));
    const app = createApp({
      dbPath: path.join(dir, 'test.sqlite'),
      schemaPath: path.join(projectRoot, 'db', 'schema.sql'),
      publicDir: path.join(projectRoot, 'public'),
      sessionSecret: 'test-secret',
      timeZone: 'Asia/Bangkok',
      cookieSecure: false,
      localAuth: false,
      roleMap,
      google: { configured: false, clientId: '', clientSecret: '', redirectUri: '', hostedDomain: '' },
      psapi: {},
      exposeDevCode: true,
    });
    const local = app.listen(0, '127.0.0.1');
    await once(local, 'listening');
    const url = `http://127.0.0.1:${local.address().port}/api/v1/auth/verification-codes`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({ email: 'parent@nis.ac.th' }),
    });
    const json = await response.json();
    const stored = app.locals.db.prepare(`SELECT code FROM verification_codes`).get().code;
    assert.equal(response.status, 201);
    assert.equal(json.dev_code, stored);
    local.close();
    await once(local, 'close');
    app.locals.db.close();
  });

  test('caches a successful guardian lookup and does not cache a failure', async () => {
    let calls = 0;
    let fail = false;
    const psapiClient = {
      configured: true,
      async studentsForGuardian() {
        calls += 1;
        if (fail) throw new PsapiError('PowerSchool student lookup failed');
        return {
          source: 'powerschool',
          students: [{
            student_powerschool_id: 'S9',
            name: 'Cached Child',
            nickname: null,
            grade: '3',
            teachers: [],
          }],
        };
      },
    };
    const dir = mkdtempSync(path.join(tmpdir(), 'ptc-cache-'));
    const app = createApp({
      dbPath: path.join(dir, 'test.sqlite'),
      schemaPath: path.join(projectRoot, 'db', 'schema.sql'),
      publicDir: path.join(projectRoot, 'public'),
      sessionSecret: 'test-secret',
      timeZone: 'Asia/Bangkok',
      cookieSecure: false,
      localAuth: false,
      roleMap,
      google: { configured: false, clientId: '', clientSecret: '', redirectUri: '', hostedDomain: '' },
      psapi: {},
      psapiClient,
      exposeDevCode: true,
    });
    const local = app.listen(0, '127.0.0.1');
    await once(local, 'listening');
    const root = `http://127.0.0.1:${local.address().port}`;
    const sent = await fetch(`${root}/api/v1/auth/verification-codes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ email: 'cache@example.com' }),
    });
    const sentJson = await sent.json();
    const confirmed = await fetch(`${root}/api/v1/auth/verification-codes/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ email: 'cache@example.com', code: sentJson.dev_code }),
    });
    const cookie = cookieHeader(confirmed);
    const first = await fetch(`${root}/api/v1/parents/me/children?email=cache@example.com`, {
      headers: { Cookie: cookie, 'X-Requested-With': 'XMLHttpRequest' },
    });
    const second = await fetch(`${root}/api/v1/parents/me/children?email=cache@example.com`, {
      headers: { Cookie: cookie, 'X-Requested-With': 'XMLHttpRequest' },
    });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(calls, 1);
    clearGuardianCache(psapiClient);
    fail = true;
    const third = await fetch(`${root}/api/v1/parents/me/children?email=cache@example.com`, {
      headers: { Cookie: cookie, 'X-Requested-With': 'XMLHttpRequest' },
    });
    const fourth = await fetch(`${root}/api/v1/parents/me/children?email=cache@example.com`, {
      headers: { Cookie: cookie, 'X-Requested-With': 'XMLHttpRequest' },
    });
    assert.equal(third.status, 502);
    assert.equal(fourth.status, 502);
    assert.equal(calls, 3);
    local.close();
    await once(local, 'close');
    app.locals.db.close();
  });
});
