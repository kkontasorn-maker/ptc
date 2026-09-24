import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { projectRoot } from '../src/config.js';
import { sendMail } from '../src/mail/mailer.js';
import { verifyEmailWebhook } from '../src/mail/webhooks.js';

const roleMap = {
  'it.admin@nis.ac.th': { role: 'it_admin' },
  'front.office@nis.ac.th': { role: 'front_office' },
  'teacher@nis.ac.th': { role: 'teacher', teacherid: 'T1001' },
};

const webhookSecret = 'test-webhook-secret';

let server;
let base;
let db;
let admin;
let front;
let teacher;
let sent;

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

async function login(email) {
  const response = await api('/api/v1/auth/session', { method: 'POST', body: { email } });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  return { cookie: cookieHeader(response) };
}

function sign(payload) {
  return crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex');
}

async function postWebhook(payload, { signature = sign(payload) } = {}) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (signature) headers['X-Email-Webhook-Signature'] = signature;
  const response = await fetch(`${base}/api/v1/webhooks/email-status`, {
    method: 'POST',
    headers,
    body: payload,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: response.status, json };
}

describe('notification resilience', { concurrency: false }, () => {
  before(async () => {
    sent = [];
    const dir = mkdtempSync(path.join(tmpdir(), 'ptc-notify-'));
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
      deliveryIssueStaleHours: 24,
      webhook: { provider: 'hmac', secret: webhookSecret },
      mail: {
        configured: true,
        from: 'conferences@nis.ac.th',
        allowlist: ['you@nis.ac.th'],
        transport: {
          async sendMail(message) {
            sent.push(message);
            return { messageId: 'esp-100' };
          },
        },
      },
    });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
    db = app.locals.db;
    admin = await login('it.admin@nis.ac.th');
    front = await login('front.office@nis.ac.th');
    teacher = await login('teacher@nis.ac.th');
  });

  after(async () => {
    server.closeAllConnections?.();
    server.close();
    await once(server, 'close');
    db.close();
  });

  test('records a delivery row for an allowlist redirect and a console send', async () => {
    const sentCode = await api('/api/v1/auth/verification-codes', {
      method: 'POST',
      body: { email: 'parent@nis.ac.th' },
    });
    assert.equal(sentCode.status, 201, JSON.stringify(sentCode.json));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'you@nis.ac.th');
    assert.match(sent[0].subject, /^\[TEST — would have gone to parent@nis\.ac\.th\] /);

    const code = db.prepare(`
      SELECT id FROM verification_codes WHERE email = ? ORDER BY id DESC LIMIT 1
    `).get('parent@nis.ac.th');
    const row = db.prepare(`
      SELECT recipient_email, purpose, related_id, provider_message_id, status, status_updated_at
      FROM email_deliveries WHERE provider_message_id = 'esp-100'
    `).get();
    assert.deepEqual(row, {
      recipient_email: 'parent@nis.ac.th',
      purpose: 'verification_code',
      related_id: code.id,
      provider_message_id: 'esp-100',
      status: 'sent',
      status_updated_at: null,
    });

    const before = db.prepare('SELECT COUNT(*) AS n FROM email_deliveries').get().n;
    await assert.rejects(() => sendMail({
      mail: {
        configured: true,
        from: 'conferences@nis.ac.th',
        recordDelivery: (entry) => db.prepare(`
          INSERT INTO email_deliveries (recipient_email, purpose, status)
          VALUES (?, ?, 'sent')
        `).run(entry.recipientEmail, entry.purpose),
        transport: {
          async sendMail() {
            throw new Error('smtp down');
          },
        },
      },
      to: 'parent@nis.ac.th',
      subject: 'Should not record',
      text: 'nope',
      purpose: 'summary',
    }));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM email_deliveries').get().n, before);

    await sendMail({
      mail: {
        configured: false,
        recordDelivery(entry) {
          appRecord(entry);
        },
      },
      to: 'other@example.com',
      subject: 'Summary',
      text: 'Times',
      purpose: 'summary',
      relatedId: 9,
    });
    const logged = db.prepare(`
      SELECT recipient_email, purpose, related_id, provider_message_id, status
      FROM email_deliveries WHERE recipient_email = 'other@example.com'
    `).get();
    assert.deepEqual(logged, {
      recipient_email: 'other@example.com',
      purpose: 'summary',
      related_id: 9,
      provider_message_id: null,
      status: 'sent',
    });

    function appRecord(entry) {
      db.prepare(`
        INSERT INTO email_deliveries (recipient_email, purpose, related_id, provider_message_id, status)
        VALUES (?, ?, ?, ?, 'sent')
      `).run(
        entry.recipientEmail,
        entry.purpose,
        entry.relatedId ?? null,
        entry.providerMessageId,
      );
    }
  });

  test('updates a delivery from a signed webhook and ignores a bad or unknown id', async () => {
    const payload = JSON.stringify({
      provider_message_id: 'esp-100',
      status: 'bounced',
      status_detail: '550 mailbox unavailable',
    });
    const missingSignature = await postWebhook(payload, { signature: '' });
    assert.equal(missingSignature.status, 401);
    assert.equal(missingSignature.json.error.code, 'UNAUTHORIZED');
    assert.equal(
      db.prepare(`SELECT status FROM email_deliveries WHERE provider_message_id = 'esp-100'`).get().status,
      'sent',
    );

    const bad = await postWebhook(payload, { signature: 'not-the-signature' });
    assert.equal(bad.status, 401);
    assert.equal(bad.json.error.message, 'Invalid email webhook signature');
    assert.equal(
      db.prepare(`SELECT status FROM email_deliveries WHERE provider_message_id = 'esp-100'`).get().status,
      'sent',
    );

    const ok = await postWebhook(payload);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json, { ok: true, updated: 1 });
    const updated = db.prepare(`
      SELECT status, status_detail, status_updated_at
      FROM email_deliveries WHERE provider_message_id = 'esp-100'
    `).get();
    assert.equal(updated.status, 'bounced');
    assert.equal(updated.status_detail, '550 mailbox unavailable');
    assert.ok(updated.status_updated_at);

    const unknown = await postWebhook(JSON.stringify({
      provider_message_id: 'does-not-exist',
      status: 'delivered',
    }));
    assert.equal(unknown.status, 200);
    assert.deepEqual(unknown.json, { ok: true, updated: 0 });
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS n FROM email_deliveries WHERE provider_message_id = 'does-not-exist'`).get().n,
      0,
    );
  });

  test('rejects webhooks when the provider is unset', async () => {
    const raw = Buffer.from('{}');
    assert.equal(verifyEmailWebhook({ provider: '', secret: 'x', rawBody: raw, headers: {} }).reason, 'not_configured');
    assert.equal(
      verifyEmailWebhook({ provider: 'carrier-pigeon', secret: 'x', rawBody: raw, headers: {} }).reason,
      'unsupported_provider',
    );

    const dir = mkdtempSync(path.join(tmpdir(), 'ptc-webhook-'));
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
    const unset = app.listen(0, '127.0.0.1');
    await once(unset, 'listening');
    const body = JSON.stringify({ provider_message_id: 'esp-100', status: 'bounced' });
    const response = await fetch(`http://127.0.0.1:${unset.address().port}/api/v1/webhooks/email-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Email-Webhook-Signature': sign(body),
      },
      body,
    });
    const json = await response.json();
    assert.equal(response.status, 401);
    assert.equal(json.error.message, 'Email webhook verification is not configured');
    unset.closeAllConnections?.();
    unset.close();
    await once(unset, 'close');
    app.locals.db.close();
  });

  test('lists bounced, complained, and stale sent rows with fallback contact', async () => {
    db.prepare(`
      UPDATE email_deliveries
      SET sent_at = datetime('now', '-2 hours')
      WHERE provider_message_id = 'esp-100'
    `).run();
    db.prepare(`
      INSERT INTO parent_contact_preferences (email, fallback_contact_type, fallback_contact_value)
      VALUES ('parent@nis.ac.th', 'line', '@niran')
    `).run();
    db.prepare(`
      INSERT INTO email_deliveries (recipient_email, purpose, status, sent_at)
      VALUES ('parent@nis.ac.th', 'summary', 'complained', datetime('now', '-1 hours'))
    `).run();
    db.prepare(`
      INSERT INTO email_deliveries (recipient_email, purpose, status, sent_at)
      VALUES ('quiet@example.com', 'conflict_notification', 'sent', datetime('now', '-25 hours'))
    `).run();
    db.prepare(`
      INSERT INTO email_deliveries (recipient_email, purpose, status, sent_at)
      VALUES ('fresh@example.com', 'summary', 'sent', datetime('now'))
    `).run();
    db.prepare(`
      INSERT INTO email_deliveries (recipient_email, purpose, status, sent_at, status_updated_at)
      VALUES ('done@example.com', 'summary', 'delivered', datetime('now', '-3 hours'), datetime('now'))
    `).run();
    db.prepare(`
      INSERT INTO email_deliveries (recipient_email, purpose, status, sent_at, status_updated_at)
      VALUES ('acked@example.com', 'summary', 'sent', datetime('now', '-40 hours'), datetime('now', '-39 hours'))
    `).run();

    const listed = await api('/api/v1/admin/notifications/delivery-issues', { cookie: admin.cookie });
    assert.equal(listed.status, 200, JSON.stringify(listed.json));
    assert.deepEqual(listed.json.issues.map((issue) => issue.recipient_email), [
      'parent@nis.ac.th',
      'parent@nis.ac.th',
      'quiet@example.com',
    ]);
    assert.deepEqual(listed.json.issues.map((issue) => issue.status), ['complained', 'bounced', 'sent']);
    assert.equal(listed.json.issues[0].fallback_contact.fallback_contact_type, 'line');
    assert.equal(listed.json.issues[0].fallback_contact.fallback_contact_value, '@niran');
    assert.equal(listed.json.issues[1].status_detail, '550 mailbox unavailable');
    assert.equal(listed.json.issues[2].unconfirmed, true);
    assert.equal(listed.json.issues[2].fallback_contact, null);
    assert.equal(listed.json.issues[0].purpose, 'summary');
    assert.equal(listed.json.issues[2].purpose, 'conflict_notification');

    const anon = await api('/api/v1/admin/notifications/delivery-issues');
    assert.equal(anon.status, 401);
    const denied = await api('/api/v1/admin/notifications/delivery-issues', { cookie: teacher.cookie });
    assert.equal(denied.status, 403);
  });

  test('saves a fallback contact for a verified device and refuses a bad type', async () => {
    const code = db.prepare(`
      SELECT code FROM verification_codes WHERE email = ? ORDER BY id DESC LIMIT 1
    `).get('parent@nis.ac.th').code;
    const confirmed = await api('/api/v1/auth/verification-codes/confirm', {
      method: 'POST',
      body: { email: 'parent@nis.ac.th', code },
    });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
    const cookie = deviceCookie(confirmed);

    const unsigned = await api('/api/v1/parents/me/contact-preference', {
      method: 'PATCH',
      body: { email: 'parent@nis.ac.th', fallback_contact_type: 'line', fallback_contact_value: '@niran' },
    });
    assert.equal(unsigned.status, 401);
    assert.equal(unsigned.json.error.code, 'UNAUTHORIZED');

    const badType = await api('/api/v1/parents/me/contact-preference', {
      method: 'PATCH',
      cookie,
      body: { email: 'parent@nis.ac.th', fallback_contact_type: 'sms', fallback_contact_value: '0812345678' },
    });
    assert.equal(badType.status, 422);
    assert.equal(badType.json.error.code, 'UNPROCESSABLE');

    const saved = await api('/api/v1/parents/me/contact-preference', {
      method: 'PATCH',
      cookie,
      body: { email: 'Parent@NIS.ac.th', fallback_contact_type: 'phone', fallback_contact_value: '0812345678' },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.equal(saved.json.preference.email, 'parent@nis.ac.th');
    assert.equal(saved.json.preference.fallback_contact_type, 'phone');
    assert.equal(saved.json.preference.fallback_contact_value, '0812345678');

    const missing = await api('/api/v1/admin/parents/contact-preference?email=nobody@example.com', { cookie: front.cookie });
    assert.equal(missing.status, 200);
    assert.deepEqual(missing.json, { preference: null });

    const found = await api('/api/v1/admin/parents/contact-preference?email=parent@nis.ac.th', { cookie: front.cookie });
    assert.equal(found.status, 200);
    assert.equal(found.json.preference.fallback_contact_type, 'phone');

    const hidden = await api('/api/v1/admin/parents/contact-preference?email=parent@nis.ac.th', { cookie: teacher.cookie });
    assert.equal(hidden.status, 403);
    const closed = await api('/api/v1/admin/parents/contact-preference?email=parent@nis.ac.th');
    assert.equal(closed.status, 401);
  });

  test('lets front office read notification issues and refuses a write', async () => {
    const read = await api('/api/v1/admin/notifications/delivery-issues', { cookie: front.cookie });
    assert.equal(read.status, 200);
    assert.ok(read.json.issues.length >= 1);

    const write = await api('/api/v1/admin/notifications/delivery-issues', {
      method: 'POST',
      cookie: front.cookie,
      body: {},
    });
    assert.equal(write.status, 403);
    assert.equal(write.json.error.code, 'FORBIDDEN');
    assert.equal(write.json.error.message, 'You do not have access to this action');

    const adminWrite = await api('/api/v1/admin/notifications/delivery-issues', {
      method: 'POST',
      cookie: admin.cookie,
      body: {},
    });
    assert.equal(adminWrite.status, 403);
    assert.equal(adminWrite.json.error.message, 'Notification issues are read-only');
  });
});
