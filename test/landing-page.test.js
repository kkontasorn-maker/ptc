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
import {
  validateLandingBlockContent,
  validateLandingBlockCreate,
  validateLandingBlockPatch,
  validateLandingBlockReorder,
} from '../src/validate.js';
import { ValidationError } from '../src/errors.js';

const roleMap = {
  'it.admin@nis.ac.th': { role: 'it_admin' },
  'front.office@nis.ac.th': { role: 'front_office' },
  'teacher@nis.ac.th': { role: 'teacher', teacherid: 'T1001' },
  'parent@nis.ac.th': { role: 'parent' },
};

let server;
let base;
let db;
let admin;
let front;
let teacher;
let parent;

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

describe('landing page content validation', () => {
  test('accepts each block_type content shape', () => {
    assert.deepEqual(validateLandingBlockContent('header', {
      school_name: 'NIS',
      welcome_text: 'Welcome',
      logo_url: null,
    }), {
      school_name: 'NIS',
      welcome_text: 'Welcome',
      logo_url: null,
    });
    assert.equal(
      validateLandingBlockContent('login_tiles', {
        parent_label: 'Parent',
        parent_description: 'Book',
        teacher_label: 'Teacher',
        teacher_description: 'Manage',
      }).parent_label,
      'Parent',
    );
    assert.deepEqual(validateLandingBlockContent('announcement', {
      message: 'Cutoff Friday',
      tone: 'warning',
    }), { message: 'Cutoff Friday', tone: 'warning' });
    assert.deepEqual(validateLandingBlockContent('rich_text', {
      text: 'Bring your map.',
    }), { text: 'Bring your map.' });
  });

  test('rejects login_tiles links and rich_text HTML', () => {
    assert.throws(
      () => validateLandingBlockContent('login_tiles', {
        parent_label: 'Parent',
        parent_description: 'Go to https://example.com',
        teacher_label: 'Teacher',
        teacher_description: 'Manage',
      }),
      (error) => error instanceof ValidationError && error.code === 'VALIDATION',
    );
    assert.throws(
      () => validateLandingBlockContent('rich_text', { text: '<script>x</script>' }),
      (error) => error instanceof ValidationError,
    );
    assert.throws(
      () => validateLandingBlockContent('announcement', { message: 'Hi', tone: 'danger' }),
      (error) => error instanceof ValidationError,
    );
  });

  test('validates create, patch, and reorder bodies', () => {
    const created = validateLandingBlockCreate({
      block_type: 'announcement',
      content: { message: 'Note', tone: 'info' },
      visible: false,
    });
    assert.equal(created.visible, false);
    assert.equal(created.block_type, 'announcement');

    const patch = validateLandingBlockPatch({
      visible: true,
      content: { message: 'Updated', tone: 'warning' },
    }, 'announcement');
    assert.equal(patch.visible, true);
    assert.equal(patch.content.tone, 'warning');

    assert.deepEqual(
      validateLandingBlockReorder({ ordered_ids: [2, 1] }),
      { ordered_ids: [2, 1] },
    );
    assert.throws(
      () => validateLandingBlockReorder({ ordered_ids: [1, 1] }),
      (error) => error instanceof ValidationError,
    );
  });
});

describe('landing page schema migration', () => {
  test('adds landing_page_blocks and seeds defaults on an existing database', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ptc-landing-migrate-'));
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
    const tables = migrated.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'landing_page_blocks'
    `).get();
    assert.ok(tables);
    const rows = migrated.prepare(`
      SELECT block_type, position FROM landing_page_blocks ORDER BY position ASC
    `).all();
    assert.deepEqual(rows, [
      { block_type: 'header', position: 0 },
      { block_type: 'login_tiles', position: 1 },
    ]);
    migrated.close();

    const again = openDatabase(dbPath, path.join(projectRoot, 'db', 'schema.sql'));
    assert.equal(again.prepare('SELECT COUNT(*) AS n FROM landing_page_blocks').get().n, 2);
    again.close();
  });
});

describe('landing page API', { concurrency: false }, () => {
  before(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ptc-landing-'));
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
    parent = await login('parent@nis.ac.th');
  });

  after(async () => {
    server.close();
    await once(server, 'close');
    db.close();
  });

  test('seeds default header and login_tiles blocks', () => {
    const rows = db.prepare(`
      SELECT block_type, position, visible FROM landing_page_blocks ORDER BY position
    `).all();
    assert.deepEqual(rows, [
      { block_type: 'header', position: 0, visible: 1 },
      { block_type: 'login_tiles', position: 1, visible: 1 },
    ]);
  });

  test('public list returns visible blocks with parsed content only', async () => {
    const created = await api('/api/v1/admin/landing-page/blocks', {
      method: 'POST',
      cookie: admin.cookie,
      body: {
        block_type: 'announcement',
        content: { message: 'Hidden note', tone: 'info' },
        visible: false,
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const hiddenId = created.json.block.id;

    const publicList = await api('/api/v1/landing-page/blocks');
    assert.equal(publicList.status, 200);
    assert.ok(Array.isArray(publicList.json.blocks));
    assert.equal(publicList.json.blocks.some((block) => block.id === hiddenId), false);
    assert.ok(publicList.json.blocks.every((block) => block.visible === true));
    const header = publicList.json.blocks.find((block) => block.block_type === 'header');
    assert.equal(typeof header.content, 'object');
    assert.equal(header.content.school_name, 'Nakornpayap International School');

    const adminList = await api('/api/v1/admin/landing-page/blocks', { cookie: admin.cookie });
    assert.equal(adminList.status, 200);
    assert.ok(adminList.json.blocks.some((block) => block.id === hiddenId));
  });

  test('it_admin can create, patch, reorder, and delete blocks', async () => {
    const listBefore = await api('/api/v1/admin/landing-page/blocks', { cookie: admin.cookie });
    const existingIds = listBefore.json.blocks.map((block) => block.id);

    const create = await api('/api/v1/admin/landing-page/blocks', {
      method: 'POST',
      cookie: admin.cookie,
      body: {
        block_type: 'rich_text',
        content: { text: 'Bring water bottles.' },
      },
    });
    assert.equal(create.status, 201, JSON.stringify(create.json));
    const richId = create.json.block.id;
    assert.equal(create.json.block.block_type, 'rich_text');
    assert.equal(create.json.block.content.text, 'Bring water bottles.');

    const patch = await api(`/api/v1/admin/landing-page/blocks/${richId}`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: {
        content: { text: 'Bring water and a map.' },
        visible: true,
      },
    });
    assert.equal(patch.status, 200, JSON.stringify(patch.json));
    assert.equal(patch.json.block.content.text, 'Bring water and a map.');

    const ordered = [richId, ...existingIds];
    const reorder = await api('/api/v1/admin/landing-page/blocks/reorder', {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { ordered_ids: ordered },
    });
    assert.equal(reorder.status, 200, JSON.stringify(reorder.json));
    assert.deepEqual(
      reorder.json.blocks.map((block) => block.id),
      ordered,
    );
    assert.deepEqual(
      reorder.json.blocks.map((block) => block.position),
      ordered.map((_, index) => index),
    );

    const dupPosition = await api(`/api/v1/admin/landing-page/blocks/${richId}`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { position: 1 },
    });
    assert.equal(dupPosition.status, 409);
    assert.equal(dupPosition.json.error.code, 'CONFLICT');

    const badReorder = await api('/api/v1/admin/landing-page/blocks/reorder', {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { ordered_ids: existingIds },
    });
    assert.equal(badReorder.status, 400);

    const remove = await api(`/api/v1/admin/landing-page/blocks/${richId}`, {
      method: 'DELETE',
      cookie: admin.cookie,
    });
    assert.equal(remove.status, 200);
    assert.equal(remove.json.ok, true);

    const after = await api('/api/v1/admin/landing-page/blocks', { cookie: admin.cookie });
    assert.equal(after.json.blocks.some((block) => block.id === richId), false);
  });

  test('rejects invalid content on write', async () => {
    const html = await api('/api/v1/admin/landing-page/blocks', {
      method: 'POST',
      cookie: admin.cookie,
      body: {
        block_type: 'rich_text',
        content: { text: '<b>nope</b>' },
      },
    });
    assert.equal(html.status, 400);
    assert.equal(html.json.error.code, 'VALIDATION');

    const links = await api('/api/v1/admin/landing-page/blocks', {
      method: 'POST',
      cookie: admin.cookie,
      body: {
        block_type: 'login_tiles',
        content: {
          parent_label: 'Parent',
          parent_description: 'Visit http://nis.ac.th',
          teacher_label: 'Teacher',
          teacher_description: 'Manage',
        },
      },
    });
    assert.equal(links.status, 400);
  });

  test('front_office and other roles get 403 on admin landing routes', async () => {
    const listFront = await api('/api/v1/admin/landing-page/blocks', { cookie: front.cookie });
    assert.equal(listFront.status, 403);
    assert.equal(listFront.json.error.code, 'FORBIDDEN');

    const createFront = await api('/api/v1/admin/landing-page/blocks', {
      method: 'POST',
      cookie: front.cookie,
      body: {
        block_type: 'announcement',
        content: { message: 'Nope', tone: 'info' },
      },
    });
    assert.equal(createFront.status, 403);

    const seed = db.prepare('SELECT id FROM landing_page_blocks ORDER BY id LIMIT 1').get();
    const patchFront = await api(`/api/v1/admin/landing-page/blocks/${seed.id}`, {
      method: 'PATCH',
      cookie: front.cookie,
      body: { visible: false },
    });
    assert.equal(patchFront.status, 403);

    const reorderTeacher = await api('/api/v1/admin/landing-page/blocks/reorder', {
      method: 'PATCH',
      cookie: teacher.cookie,
      body: { ordered_ids: [seed.id] },
    });
    assert.equal(reorderTeacher.status, 403);

    const deleteParent = await api(`/api/v1/admin/landing-page/blocks/${seed.id}`, {
      method: 'DELETE',
      cookie: parent.cookie,
    });
    assert.equal(deleteParent.status, 403);
  });
});
