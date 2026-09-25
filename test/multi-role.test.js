import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { describe, test, before, after } from 'node:test';
import { projectRoot, loadRoleMap } from '../src/config.js';
import { createApp } from '../src/app.js';
import {
  pickActiveRole,
  resolveRole,
  normalizeRolesEntry,
} from '../src/auth/roles.js';
import { todayInZone } from '../src/time.js';

function addDays(iso, days) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

const today = todayInZone(new Date(), 'Asia/Bangkok');
const future = addDays(today, 30);

const roleMap = {
  'it.admin@nis.ac.th': { roles: ['it_admin'] },
  'front.office@nis.ac.th': { roles: ['front_office'] },
  'teacher@nis.ac.th': { roles: ['teacher'], teacherid: 'T1001' },
  'dual@nis.ac.th': { roles: ['front_office', 'it_admin'] },
  'teacher.admin@nis.ac.th': { roles: ['teacher', 'front_office'], teacherid: 'T1001' },
};

function cookieHeader(response) {
  const list = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  return list.map((item) => item.split(';')[0]).join('; ');
}

describe('roles.json multi-role loading', () => {
  test('normalizes roles arrays and keeps teacherid', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ptc-roles-'));
    const file = path.join(dir, 'roles.json');
    writeFileSync(file, JSON.stringify({
      'a@nis.ac.th': { roles: ['it_admin', 'teacher'], teacherid: 'T9' },
      'legacy@nis.ac.th': { role: 'front_office' },
      'teach@nis.ac.th': { roles: ['teacher'], teacherid: 'T1' },
    }));
    const map = loadRoleMap(file);
    assert.deepEqual(map['a@nis.ac.th'], {
      roles: ['it_admin', 'teacher'],
      teacherid: 'T9',
    });
    assert.deepEqual(map['legacy@nis.ac.th'], { roles: ['front_office'] });
    assert.deepEqual(map['teach@nis.ac.th'], {
      roles: ['teacher'],
      teacherid: 'T1',
    });
  });

  test('pickActiveRole prefers it_admin over front_office over teacher', () => {
    assert.equal(pickActiveRole(['teacher', 'front_office', 'it_admin']), 'it_admin');
    assert.equal(pickActiveRole(['teacher', 'front_office']), 'front_office');
    assert.equal(pickActiveRole(['teacher']), 'teacher');
  });

  test('resolveRole defaults to highest priority and accepts legacy role string', () => {
    const dual = resolveRole('dual@nis.ac.th', roleMap);
    assert.equal(dual.activeRole, 'it_admin');
    assert.deepEqual(dual.roles, ['front_office', 'it_admin']);
    assert.equal(dual.role, 'it_admin');

    const legacy = resolveRole('solo@nis.ac.th', {
      'solo@nis.ac.th': { role: 'front_office' },
    });
    assert.equal(legacy.activeRole, 'front_office');
    assert.deepEqual(legacy.roles, ['front_office']);

    assert.equal(normalizeRolesEntry({ roles: ['teacher'] }), null);
  });
});

describe('multi-role sessions', { concurrency: false }, () => {
  let server;
  let base;
  let db;

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
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { status: response.status, json, headers: response.headers, response };
  }

  async function login(email) {
    const result = await api('/api/v1/auth/session', {
      method: 'POST',
      body: { email },
    });
    assert.equal(result.status, 200, JSON.stringify(result.json));
    return { cookie: cookieHeader(result.response), user: result.json.user };
  }

  before(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ptc-multirole-'));
    const app = createApp({
      dbPath: path.join(dir, 'test.sqlite'),
      schemaPath: path.join(projectRoot, 'db', 'schema.sql'),
      publicDir: path.join(projectRoot, 'public'),
      sessionSecret: 'test-secret-multi-role',
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
  });

  after(async () => {
    server.close();
    await once(server, 'close');
    db.close();
  });

  test('(a) single-role account behavior is unchanged', async () => {
    const admin = await login('it.admin@nis.ac.th');
    assert.equal(admin.user.activeRole, 'it_admin');
    assert.deepEqual(admin.user.roles, ['it_admin']);
    assert.equal(admin.user.role, 'it_admin');
    assert.equal(admin.user.teacherid, null);

    const created = await api('/api/v1/events', {
      method: 'POST',
      cookie: admin.cookie,
      body: { name: 'Single-role event', event_date: future },
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));

    const front = await login('front.office@nis.ac.th');
    assert.equal(front.user.activeRole, 'front_office');
    const denied = await api('/api/v1/events', {
      method: 'POST',
      cookie: front.cookie,
      body: { name: 'Should fail', event_date: future },
    });
    assert.equal(denied.status, 403);

    const teacher = await login('teacher@nis.ac.th');
    assert.equal(teacher.user.activeRole, 'teacher');
    assert.equal(teacher.user.teacherid, 'T1001');
    const teacherWrite = await api('/api/v1/events', {
      method: 'POST',
      cookie: teacher.cookie,
      body: { name: 'Teacher cannot', event_date: future },
    });
    assert.equal(teacherWrite.status, 403);
  });

  test('(b) dual-role account defaults to higher-priority role on sign-in', async () => {
    const dual = await login('dual@nis.ac.th');
    assert.equal(dual.user.activeRole, 'it_admin');
    assert.deepEqual(dual.user.roles, ['front_office', 'it_admin']);

    const session = await api('/api/v1/auth/session', { cookie: dual.cookie });
    assert.equal(session.status, 200);
    assert.equal(session.json.user.activeRole, 'it_admin');
    assert.deepEqual(session.json.user.roles, ['front_office', 'it_admin']);

    const teacherFront = await login('teacher.admin@nis.ac.th');
    assert.equal(teacherFront.user.activeRole, 'front_office');
    assert.deepEqual(teacherFront.user.roles, ['teacher', 'front_office']);
    assert.equal(teacherFront.user.teacherid, 'T1001');
  });

  test('(c) switching to an allowed role succeeds and gates subsequent routes', async () => {
    const dual = await login('dual@nis.ac.th');
    assert.equal(dual.user.activeRole, 'it_admin');

    const asAdmin = await api('/api/v1/events', {
      method: 'POST',
      cookie: dual.cookie,
      body: { name: 'Dual as admin', event_date: future },
    });
    assert.equal(asAdmin.status, 201, JSON.stringify(asAdmin.json));
    const eventId = asAdmin.json.event.id;

    const switched = await api('/api/v1/auth/switch-role', {
      method: 'POST',
      cookie: dual.cookie,
      body: { role: 'front_office' },
    });
    assert.equal(switched.status, 200, JSON.stringify(switched.json));
    assert.equal(switched.json.activeRole, 'front_office');
    assert.equal(switched.json.user.activeRole, 'front_office');
    assert.deepEqual(switched.json.roles, ['front_office', 'it_admin']);
    const frontCookie = cookieHeader(switched.response);

    const session = await api('/api/v1/auth/session', { cookie: frontCookie });
    assert.equal(session.json.user.activeRole, 'front_office');

    const blockedWrite = await api(`/api/v1/events/${eventId}`, {
      method: 'PATCH',
      cookie: frontCookie,
      body: { name: 'Blocked as front office' },
    });
    assert.equal(blockedWrite.status, 403);

    const listed = await api('/api/v1/events', { cookie: frontCookie });
    assert.equal(listed.status, 200);

    const back = await api('/api/v1/auth/switch-role', {
      method: 'POST',
      cookie: frontCookie,
      body: { role: 'it_admin' },
    });
    assert.equal(back.status, 200);
    const adminCookie = cookieHeader(back.response);
    const allowedWrite = await api(`/api/v1/events/${eventId}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { name: 'Back as admin' },
    });
    assert.equal(allowedWrite.status, 200, JSON.stringify(allowedWrite.json));
  });

  test('(d) switching to a role not in the list is rejected; activeRole unchanged', async () => {
    const dual = await login('dual@nis.ac.th');
    assert.equal(dual.user.activeRole, 'it_admin');

    const rejected = await api('/api/v1/auth/switch-role', {
      method: 'POST',
      cookie: dual.cookie,
      body: { role: 'teacher' },
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.json.error.code, 'VALIDATION');
    assert.equal(rejected.json.error.details[0].field, 'role');

    const session = await api('/api/v1/auth/session', { cookie: dual.cookie });
    assert.equal(session.status, 200);
    assert.equal(session.json.user.activeRole, 'it_admin');

    const stillAdmin = await api('/api/v1/events', {
      method: 'POST',
      cookie: dual.cookie,
      body: { name: 'Still admin after reject', event_date: future },
    });
    assert.equal(stillAdmin.status, 201, JSON.stringify(stillAdmin.json));

    const single = await login('front.office@nis.ac.th');
    const escalate = await api('/api/v1/auth/switch-role', {
      method: 'POST',
      cookie: single.cookie,
      body: { role: 'it_admin' },
    });
    assert.equal(escalate.status, 400);
    assert.equal(escalate.json.error.code, 'VALIDATION');
    const after = await api('/api/v1/auth/session', { cookie: single.cookie });
    assert.equal(after.json.user.activeRole, 'front_office');
  });
});
