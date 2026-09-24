import crypto from 'node:crypto';

const ADAPTERS = {
  hmac: hmacAdapter,
  postmark: postmarkAdapter,
  mailgun: mailgunAdapter,
  sendgrid: sendgridAdapter,
  ses: sesAdapter,
};

function header(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) || '';
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
    }
  }
  return '';
}

function safeEqual(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue));
  const right = Buffer.from(String(rightValue));
  if (left.length === 0 || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function parseJson(rawBody) {
  try {
    const text = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody ?? '');
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function hmacHex(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function signatureMatches(provided, expected) {
  return safeEqual(String(provided).trim().toLowerCase(), String(expected).trim().toLowerCase());
}

export function normalizeDeliveryStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'delivery' || raw === 'delivered') return 'delivered';
  if (raw === 'bounce' || raw === 'bounced' || raw === 'permanent_fail') return 'bounced';
  if (raw === 'complaint' || raw === 'complained' || raw === 'spamcomplaint' || raw === 'spamreport' || raw === 'spam_report') {
    return 'complained';
  }
  if (raw === 'sent') return 'sent';
  if (raw === 'unknown') return 'unknown';
  return '';
}

function asEvent(providerMessageId, status, statusDetail) {
  const id = providerMessageId == null ? '' : String(providerMessageId).trim();
  if (!id || !status) return null;
  const detail = statusDetail == null || statusDetail === '' ? null : String(statusDetail);
  return { provider_message_id: id, status, status_detail: detail };
}

function hmacAdapter({ secret, rawBody, headers }) {
  const provided = header(headers, 'x-email-webhook-signature').replace(/^sha256=/i, '');
  const expected = hmacHex(secret, rawBody);
  if (!signatureMatches(provided, expected)) return { ok: false, reason: 'bad_signature' };
  return { ok: true, events: eventsFromGeneric(parseJson(rawBody)) };
}

function eventsFromGeneric(body) {
  if (!body || typeof body !== 'object') return [];
  const list = Array.isArray(body) ? body : (Array.isArray(body.events) ? body.events : [body]);
  return list.map((item) => asEvent(
    item?.provider_message_id || item?.message_id || item?.messageId,
    normalizeDeliveryStatus(item?.status || item?.event),
    item?.status_detail || item?.detail || item?.reason,
  )).filter(Boolean);
}

function postmarkAdapter({ secret, rawBody, headers }) {
  const token = header(headers, 'x-postmark-webhook-token') || header(headers, 'x-postmark-signature');
  const expected = hmacHex(secret, rawBody);
  const tokenOk = safeEqual(token, secret) || signatureMatches(token, expected);
  if (!tokenOk) return { ok: false, reason: 'bad_signature' };
  const body = parseJson(rawBody);
  if (!body || typeof body !== 'object') return { ok: true, events: [] };
  const record = String(body.RecordType || '').toLowerCase();
  let status = '';
  if (record === 'delivery') status = 'delivered';
  else if (record === 'bounce') status = 'bounced';
  else if (record === 'spamcomplaint') status = 'complained';
  const parsed = asEvent(
    body.MessageID || body.MessageId,
    status,
    body.Description || body.Name || body.Details,
  );
  return { ok: true, events: parsed ? [parsed] : [] };
}

function mailgunAdapter({ secret, rawBody }) {
  const body = parseJson(rawBody);
  const signature = body?.signature || {};
  const timestamp = String(signature.timestamp || '');
  const token = String(signature.token || '');
  const digest = String(signature.signature || '');
  const expected = hmacHex(secret, timestamp + token);
  if (!timestamp || !token || !signatureMatches(digest, expected)) {
    return { ok: false, reason: 'bad_signature' };
  }
  const data = body['event-data'] || body;
  const eventName = String(data.event || '').toLowerCase();
  let status = normalizeDeliveryStatus(eventName);
  if (eventName === 'failed') {
    status = String(data.severity || '').toLowerCase() === 'temporary' ? 'unknown' : 'bounced';
  }
  const messageId = data.message?.headers?.['message-id'] || data['message-id'] || data.message_id;
  const detail = data.reason || data['delivery-status']?.description || data['delivery-status']?.message || null;
  const parsed = asEvent(messageId, status, detail);
  return { ok: true, events: parsed ? [parsed] : [] };
}

function sendgridAdapter({ secret, rawBody, headers }) {
  const signature = header(headers, 'x-twilio-email-event-webhook-signature');
  const timestamp = header(headers, 'x-twilio-email-event-webhook-timestamp');
  if (!signature || !timestamp) return { ok: false, reason: 'bad_signature' };
  let verified = false;
  try {
    const key = crypto.createPublicKey(secret);
    const payload = Buffer.concat([
      Buffer.from(timestamp),
      Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody)),
    ]);
    verified = crypto.verify('sha256', payload, key, Buffer.from(signature, 'base64'));
  } catch {
    verified = false;
  }
  if (!verified) return { ok: false, reason: 'bad_signature' };
  const body = parseJson(rawBody);
  const list = Array.isArray(body) ? body : [];
  const events = list.map((item) => {
    const name = String(item?.event || '').toLowerCase();
    let status = normalizeDeliveryStatus(name);
    if (name === 'dropped' || name === 'bounce') status = 'bounced';
    if (name === 'spamreport') status = 'complained';
    return asEvent(item?.sg_message_id || item?.['smtp-id'], status, item?.reason || item?.status);
  }).filter(Boolean);
  return { ok: true, events };
}

function sesAdapter({ secret, rawBody, headers }) {
  const provided = header(headers, 'x-email-webhook-signature').replace(/^sha256=/i, '');
  const expected = hmacHex(secret, rawBody);
  if (!signatureMatches(provided, expected)) return { ok: false, reason: 'bad_signature' };
  let body = parseJson(rawBody);
  if (!body || typeof body !== 'object') return { ok: true, events: [] };
  if (body.Type === 'Notification' && typeof body.Message === 'string') {
    body = parseJson(body.Message) || {};
  }
  const note = String(body.notificationType || body.eventType || '').toLowerCase();
  let status = '';
  if (note === 'delivery') status = 'delivered';
  else if (note === 'bounce') status = 'bounced';
  else if (note === 'complaint') status = 'complained';
  const detail = body.bounce?.bouncedRecipients?.[0]?.diagnosticCode
    || body.complaint?.complaintFeedbackType
    || null;
  const parsed = asEvent(body.mail?.messageId, status, detail);
  return { ok: true, events: parsed ? [parsed] : [] };
}

/**
 * EMAIL_WEBHOOK_PROVIDER selects the adapter. An empty provider or secret
 * is unsupported: callers must reject the request. This does not pin the
 * app to one ESP.
 */
export function verifyEmailWebhook({ provider, secret, rawBody, headers }) {
  const name = String(provider || '').trim().toLowerCase();
  const key = String(secret || '');
  if (!name || !key) return { ok: false, reason: 'not_configured' };
  const adapter = ADAPTERS[name];
  if (!adapter) return { ok: false, reason: 'unsupported_provider' };
  return adapter({
    secret: key,
    rawBody: rawBody || Buffer.alloc(0),
    headers: headers || {},
  });
}
