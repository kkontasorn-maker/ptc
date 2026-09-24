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

const roleMap = {
  'it.admin@nis.ac.th': { role: 'it_admin' },
  'front.office@nis.ac.th': { role: 'front_office' },
  'teacher@nis.ac.th': { role: 'teacher', teacherid: 'T1001' },
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

describe('PowerSchool connection status', { concurrency: false }, () => {
  let server;
  let base;
  let db;
  let admin;
  let front;
  let teacher;
  let calls;
  const logged = [];

  before(async () => {
    calls = [];
    const psapi = createPsapiClient({
      baseUrl: 'https://ps.example.test',
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      fetchImpl: async (url) => {
        const href = String(url);
        calls.push(href);
        if (href.includes('oauth/access_token')) return jsonResponse(200, { access_token: 'token-do-not-leak' });
        if (calls.filter((item) => item.includes('/students')).length > 2) return jsonResponse(500, { message: CLIENT_SECRET });
        return jsonResponse(200, { record: [] });
      },
    });
    const dir = mkdtempSync(path.join(tmpdir(), 'ptc-ps-'));
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
    front = await login(base, 'front.office@nis.ac.th');
    teacher = await login(base, 'teacher@nis.ac.th');
  });

  after(async () => {
    server.close();
    await once(server, 'close');
    db.close();
  });

  async function hit(urlPath, { method = 'GET', cookie = admin, body } = {}) {
    const response = await fetch(`${base}${urlPath}`, {
      method,
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        Cookie: cookie,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    return { status: response.status, json, text };
  }

  test('reports the last outcome without calling PowerSchool', async () => {
    const before = calls.length;
    const response = await hit('/api/v1/admin/integrations/powerschool-status');
    assert.equal(response.status, 200);
    assert.deepEqual(response.json, {
      connected: false,
      last_successful_call_at: null,
      error: null,
    });
    assert.equal(calls.length, before);
    assert.equal(response.text.includes(CLIENT_ID), false);
    assert.equal(response.text.includes(CLIENT_SECRET), false);
  });

  test('refuses anyone who is not IT admin', async () => {
    assert.equal((await hit('/api/v1/admin/integrations/powerschool-status', { cookie: front })).status, 403);
    assert.equal((await hit('/api/v1/admin/integrations/powerschool-status', { cookie: teacher })).status, 403);
    const anon = await fetch(`${base}/api/v1/admin/integrations/powerschool-status`);
    assert.equal(anon.status, 401);
    assert.equal((await hit('/api/v1/admin/integrations/powerschool-status/test', {
      method: 'POST',
      cookie: front,
      body: {},
    })).status, 403);
  });

  test('rejects a body and never echoes credentials', async () => {
    const before = calls.length;
    const response = await hit('/api/v1/admin/integrations/powerschool-status/test', {
      method: 'POST',
      body: { client_id: CLIENT_ID, client_secret: CLIENT_SECRET },
    });
    assert.equal(response.status, 400);
    assert.equal(response.json.error.code, 'VALIDATION');
    assert.equal(response.text.includes(CLIENT_ID), false);
    assert.equal(response.text.includes(CLIENT_SECRET), false);
    assert.equal(response.text.includes('client_id'), false);
    assert.equal(response.text.includes('client_secret'), false);
    assert.equal(calls.length, before);
  });

  test('a successful test sets connected and a later failure keeps the last success', async () => {
    const ok = await hit('/api/v1/admin/integrations/powerschool-status/test', { method: 'POST', body: {} });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.connected, true);
    assert.match(ok.json.last_successful_call_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/);
    assert.equal(ok.json.error, null);
    assert.equal(ok.text.includes('token-do-not-leak'), false);
    assert.equal(calls.some((href) => href.includes('/oauth/access_token')), true);
    assert.equal(calls.some((href) => href.includes('/ws/schema/table/students')), true);

    const again = await hit('/api/v1/admin/integrations/powerschool-status/test', { method: 'POST', body: {} });
    assert.equal(again.json.connected, true);

    const original = console.error;
    console.error = (...args) => { logged.push(args.map(String).join(' ')); };
    let failed;
    try {
      failed = await hit('/api/v1/admin/integrations/powerschool-status/test', { method: 'POST', body: {} });
    } finally {
      console.error = original;
    }
    assert.equal(failed.status, 200);
    assert.equal(failed.json.connected, false);
    assert.equal(failed.json.last_successful_call_at, ok.json.last_successful_call_at);
    assert.equal(failed.json.error, 'PowerSchool student request failed');
    assert.equal(failed.text.includes(CLIENT_SECRET), false);
    assert.equal(logged.some((line) => line.includes(CLIENT_SECRET) || line.includes(CLIENT_ID)), false);

    const read = await hit('/api/v1/admin/integrations/powerschool-status');
    assert.equal(read.json.connected, false);
    assert.equal(read.json.last_successful_call_at, ok.json.last_successful_call_at);
  });

  test('stops a burst of test calls', async () => {
    let limited = null;
    for (let i = 0; i < 5; i += 1) {
      const response = await hit('/api/v1/admin/integrations/powerschool-status/test', { method: 'POST', body: {} });
      if (response.status === 429) limited = response;
    }
    assert.ok(limited);
    assert.equal(limited.json.error.code, 'RATE_LIMIT');
    assert.equal(limited.text.includes(CLIENT_SECRET), false);
  });
});

describe('unconfigured PowerSchool status', { concurrency: false }, () => {
  test('test records not configured and does not invent a connection', async () => {
    const psapi = createPsapiClient({});
    const listed = await psapi.listTeachers();
    assert.equal(listed.source, 'mock');
    assert.deepEqual(psapi.connectionStatus(), {
      connected: false,
      lastSuccessfulCallAt: null,
      error: null,
    });
    const status = await psapi.testConnection();
    assert.equal(status.connected, false);
    assert.equal(status.lastSuccessfulCallAt, null);
    assert.equal(status.error, 'PowerSchool is not configured');
  });
});
