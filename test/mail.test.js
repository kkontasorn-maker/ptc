import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  deliverSummary,
  deliverVerificationCode,
  gateRecipient,
  parseEmailAllowlist,
  sendMail,
} from '../src/mail/mailer.js';

const allowlist = ['you@nis.ac.th', 'ict@nis.ac.th'];

function captureTransport() {
  const sent = [];
  return {
    sent,
    async sendMail(message) {
      sent.push(message);
    },
  };
}

describe('email allowlist', () => {
  test('parses a comma-separated list and treats blank as unset', () => {
    assert.equal(parseEmailAllowlist(undefined), null);
    assert.equal(parseEmailAllowlist(''), null);
    assert.equal(parseEmailAllowlist('   '), null);
    assert.deepEqual(
      parseEmailAllowlist(' You@NIS.ac.th, ict@nis.ac.th ,you@nis.ac.th,'),
      ['you@nis.ac.th', 'ict@nis.ac.th'],
    );
  });

  test('sends to the real recipient when the allowlist is unset', () => {
    const gated = gateRecipient({
      to: 'parent@example.com',
      subject: 'Your NIS conferences code',
      text: 'code',
      allowlist: null,
    });
    assert.equal(gated.redirected, false);
    assert.equal(gated.to, 'parent@example.com');
    assert.equal(gated.subject, 'Your NIS conferences code');
  });

  test('sends normally when the recipient is on the list', () => {
    const gated = gateRecipient({
      to: 'ICT@nis.ac.th',
      subject: 'Your NIS conferences code',
      text: 'code',
      allowlist,
    });
    assert.equal(gated.redirected, false);
    assert.equal(gated.to, 'ICT@nis.ac.th');
    assert.equal(gated.subject, 'Your NIS conferences code');
    assert.equal(gated.text, 'code');
  });

  test('redirects a non-match to the first address and keeps the original visible', () => {
    const gated = gateRecipient({
      to: 'parent@example.com',
      subject: 'Your NIS conferences — October',
      text: 'Room 204',
      allowlist,
    });
    assert.equal(gated.redirected, true);
    assert.equal(gated.to, 'you@nis.ac.th');
    assert.notEqual(gated.to, 'parent@example.com');
    assert.equal(
      gated.subject,
      '[TEST — would have gone to parent@example.com] Your NIS conferences — October',
    );
    assert.match(gated.text, /^TEST — would have gone to parent@example.com\nOriginal subject: Your NIS conferences — October\n\nRoom 204$/);
  });

  test('verification and summary both use the shared sender', async () => {
    const mail = {
      configured: true,
      from: 'conferences@nis.ac.th',
      allowlist,
    };
    const codes = captureTransport();
    const summaries = captureTransport();
    await deliverVerificationCode({
      mail,
      email: 'parent@example.com',
      code: '123456',
      transport: codes,
    });
    await deliverSummary({
      mail,
      email: 'you@nis.ac.th',
      eventName: 'October',
      bookings: [],
      transport: summaries,
    });
    assert.equal(codes.sent.length, 1);
    assert.equal(codes.sent[0].to, 'you@nis.ac.th');
    assert.match(codes.sent[0].subject, /^\[TEST — would have gone to parent@example.com\] /);
    assert.match(codes.sent[0].text, /123456/);
    assert.equal(summaries.sent.length, 1);
    assert.equal(summaries.sent[0].to, 'you@nis.ac.th');
    assert.equal(summaries.sent[0].subject, 'Your NIS conferences — October');
  });

  test('does not consult NODE_ENV or ALLOW_LOCAL_AUTH', async () => {
    const previousNode = process.env.NODE_ENV;
    const previousLocal = process.env.ALLOW_LOCAL_AUTH;
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_LOCAL_AUTH = 'true';
    try {
      const transport = captureTransport();
      const result = await sendMail({
        mail: { configured: true, from: 'conferences@nis.ac.th', allowlist },
        to: 'parent@example.com',
        subject: 'Hello',
        text: 'body',
        transport,
      });
      assert.equal(result.to, 'you@nis.ac.th');
      assert.equal(transport.sent[0].to, 'you@nis.ac.th');
      assert.equal(result.delivered, true);
    } finally {
      if (previousNode == null) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNode;
      if (previousLocal == null) delete process.env.ALLOW_LOCAL_AUTH;
      else process.env.ALLOW_LOCAL_AUTH = previousLocal;
    }
  });
});
