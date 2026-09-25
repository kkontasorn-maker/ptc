import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { projectRoot } from '../src/config.js';
import { createPsapiClient } from '../src/psapi/client.js';

const CLIENT_ID = 'psapi-client-id-do-not-leak';
const CLIENT_SECRET = 'psapi-client-secret-do-not-leak';

const PILOT_TEACHER = {
  id: 2957,
  lastfirst: 'Kontasorn, Kriengkrai',
  email_addr: 'KKontasorn@nis.ac.th',
  schoolid: 400,
  room: 'Office',
};

const OTHER_TEACHER = {
  id: 1001,
  lastfirst: 'Srisuk, Aroon',
  email_addr: 'aroon.srisuk@nis.ac.th',
  schoolid: 1,
  room: '204',
};

const roleMap = {
  'it.admin@nis.ac.th': { role: 'it_admin' },
};

function cookieHeader(response) {
  const list = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  return list.map((item) => item.split(';')[0]).join('; ');
}

async function login(base, email) {
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
  return cookieHeader(response);
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

function schemaTeacher(row) {
  return { tables: { teachers: row } };
}

describe('scoped staff sync', { concurrency: false }, () => {
  let server;
  let base;
  let db;
  let admin;
  let calls;

  before(async () => {
    calls = [];
    const psapi = createPsapiClient({
      baseUrl: 'https://ps.example.test',
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      teachersPath: '/ws/schema/table/teachers',
      fetchImpl: async (url) => {
        const href = String(url);
        calls.push(href);
        if (href.includes('oauth/access_token')) {
          return jsonResponse(200, { access_token: 'token-do-not-leak' });
        }
        const parsed = new URL(href);
        if (parsed.pathname === '/ws/schema/table/teachers/2957') {
          return jsonResponse(200, schemaTeacher(PILOT_TEACHER));
        }
        if (parsed.pathname === '/ws/schema/table/teachers') {
          return jsonResponse(200, {
            record: [schemaTeacher(PILOT_TEACHER), schemaTeacher(OTHER_TEACHER)],
          });
        }
        return jsonResponse(404, { message: 'not found' });
      },
    });
    const dir = mkdtempSync(path.join(tmpdir(), 'ptc-staff-sync-'));
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
      psapiClient: psapi,
    });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
    db = app.locals.db;
    admin = await login(base, 'it.admin@nis.ac.th');
  });

  after(async () => {
    server.close();
    await once(server, 'close');
    db.close();
  });

  async function hit(urlPath, { method = 'GET', body } = {}) {
    const response = await fetch(`${base}${urlPath}`, {
      method,
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        Cookie: admin,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    return { status: response.status, json, text };
  }

  test('syncs only teacher_id 2957 and leaves other PS teachers out of staff', async () => {
    db.prepare('DELETE FROM staff').run();
    const beforeCalls = calls.length;
    const response = await hit('/api/v1/staff/sync', {
      method: 'POST',
      body: { teacher_id: 2957 },
    });
    assert.equal(response.status, 200, response.text);
    assert.equal(response.json.source, 'powerschool');
    assert.equal(response.json.created, 1);
    assert.equal(response.json.skipped, 0);

    const rows = db.prepare('SELECT * FROM staff ORDER BY id').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].powerschool_teacher_id, '2957');
    assert.equal(rows[0].email, 'kkontasorn@nis.ac.th');
    assert.equal(rows[0].display_name, 'Kontasorn, Kriengkrai');
    assert.equal(rows[0].powerschool_school_id, '400');

    const syncedPaths = calls.slice(beforeCalls).map((href) => new URL(href).pathname);
    assert.ok(syncedPaths.includes('/ws/schema/table/teachers/2957'));
    assert.equal(syncedPaths.includes('/ws/schema/table/teachers'), false);

    const inResponse = response.json.staff.find((member) => member.powerschool_teacher_id === '2957');
    assert.ok(inResponse);
    assert.equal(inResponse.email, 'kkontasorn@nis.ac.th');
    assert.equal(inResponse.synced, true);
    assert.equal(
      response.json.staff.some((member) => member.powerschool_teacher_id === '1001'),
      false,
    );
  });

  test('rejects a non-positive teacher_id', async () => {
    const bad = await hit('/api/v1/staff/sync', {
      method: 'POST',
      body: { teacher_id: 0 },
    });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.code, 'VALIDATION');
  });

  test('omitting teacher_id still full-syncs every usable teacher', async () => {
    db.prepare('DELETE FROM staff').run();
    const response = await hit('/api/v1/staff/sync', {
      method: 'POST',
      body: {},
    });
    assert.equal(response.status, 200, response.text);
    assert.equal(response.json.source, 'powerschool');
    assert.equal(response.json.created, 2);

    const rows = db.prepare(`
      SELECT powerschool_teacher_id, email, powerschool_school_id
      FROM staff
      ORDER BY powerschool_teacher_id
    `).all();
    assert.deepEqual(rows, [
      {
        powerschool_teacher_id: '1001',
        email: 'aroon.srisuk@nis.ac.th',
        powerschool_school_id: '1',
      },
      {
        powerschool_teacher_id: '2957',
        email: 'kkontasorn@nis.ac.th',
        powerschool_school_id: '400',
      },
    ]);
  });
});

describe('scoped staff sync fallback list filter', { concurrency: false }, () => {
  test('falls back to listTeachers filter when singular GET is unavailable', async () => {
    const calls = [];
    const psapi = createPsapiClient({
      baseUrl: 'https://ps.example.test',
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      teachersPath: '/ws/schema/table/teachers',
      fetchImpl: async (url) => {
        const href = String(url);
        calls.push(href);
        if (href.includes('oauth/access_token')) {
          return jsonResponse(200, { access_token: 'token-do-not-leak' });
        }
        const parsed = new URL(href);
        if (parsed.pathname === '/ws/schema/table/teachers/2957') {
          return jsonResponse(404, { message: 'no singular' });
        }
        if (parsed.pathname === '/ws/schema/table/teachers') {
          return jsonResponse(200, {
            record: [schemaTeacher(PILOT_TEACHER), schemaTeacher(OTHER_TEACHER)],
          });
        }
        return jsonResponse(500, {});
      },
    });

    const result = await psapi.getTeacher(2957);
    assert.equal(result.source, 'powerschool');
    assert.deepEqual(result.teacher, {
      powerschool_teacher_id: '2957',
      display_name: 'Kontasorn, Kriengkrai',
      email: 'kkontasorn@nis.ac.th',
      photo_url: null,
      room: 'Office',
      powerschool_school_id: '400',
    });
    const paths = calls.map((href) => new URL(href).pathname);
    assert.ok(paths.includes('/ws/schema/table/teachers/2957'));
    assert.ok(paths.includes('/ws/schema/table/teachers'));
  });
});
