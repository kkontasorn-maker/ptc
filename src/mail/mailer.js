import nodemailer from 'nodemailer';

export function verificationPayload({ exposeDevCode, code }) {
  const body = { ok: true };
  if (exposeDevCode) body.dev_code = code;
  return body;
}

/**
 * EMAIL_ALLOWLIST is its own gate. Empty or missing means unset (send to
 * the real recipient). It does not read NODE_ENV or ALLOW_LOCAL_AUTH.
 * Returns null when the gate is off, otherwise lowercase addresses in order.
 */
export function parseEmailAllowlist(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const addresses = [];
  const seen = new Set();
  for (const part of raw.split(',')) {
    const address = part.trim().toLowerCase();
    if (!address || seen.has(address)) continue;
    seen.add(address);
    addresses.push(address);
  }
  return addresses.length ? addresses : null;
}

export function gateRecipient({ to, subject, text, allowlist }) {
  const intended = String(to ?? '').trim();
  if (!allowlist || allowlist.length === 0) {
    return { to: intended, subject, text, redirected: false };
  }
  if (allowlist.includes(intended.toLowerCase())) {
    return { to: intended, subject, text, redirected: false };
  }
  const sink = allowlist[0];
  return {
    to: sink,
    subject: `[TEST — would have gone to ${intended}] ${subject}`,
    text: `TEST — would have gone to ${intended}\nOriginal subject: ${subject}\n\n${text}`,
    redirected: true,
    intended,
  };
}

function createTransport(mail) {
  return nodemailer.createTransport({
    host: mail.host,
    port: mail.port,
    secure: Boolean(mail.secure),
    auth: mail.user ? { user: mail.user, pass: mail.pass } : undefined,
  });
}

/**
 * Every outbound message goes through here. Callers pass the intended
 * recipient; this function applies the allowlist before SMTP or the log.
 */
export async function sendMail({ mail, to, subject, text, transport }) {
  const gated = gateRecipient({
    to,
    subject,
    text,
    allowlist: mail?.allowlist ?? null,
  });
  if (!mail?.configured) {
    const redirect = gated.redirected ? ` redirected from ${gated.intended}` : '';
    console.info(`Email for ${gated.to}${redirect}\nSubject: ${gated.subject}\n${gated.text}`);
    return { delivered: false, ...gated };
  }
  const client = transport || createTransport(mail);
  await client.sendMail({
    from: mail.from,
    to: gated.to,
    subject: gated.subject,
    text: gated.text,
  });
  return { delivered: true, ...gated };
}

export async function deliverVerificationCode({ mail, email, code, transport }) {
  const text = `Your NIS conferences code is ${code}. It expires in 10 minutes.`;
  return sendMail({
    mail,
    to: email,
    subject: 'Your NIS conferences code',
    text,
    transport,
  });
}

export function summaryMessage({ eventName, bookings }) {
  const lines = [`Your conference times for ${eventName} are set.`, ''];
  for (const booking of bookings) {
    const nickname = booking.student_nickname ? ` (${booking.student_nickname})` : '';
    const grade = booking.student_grade ? `, grade ${booking.student_grade}` : '';
    lines.push(`${booking.student_name}${nickname}${grade}`);
    lines.push(`${booking.display_name}, ${booking.service_name}`);
    lines.push(booking.when);
    lines.push(booking.location);
    lines.push('');
  }
  return `${lines.join('\n').trim()}\n`;
}

export async function deliverSummary({ mail, email, eventName, bookings, transport }) {
  return sendMail({
    mail,
    to: email,
    subject: `Your NIS conferences — ${eventName}`,
    text: summaryMessage({ eventName, bookings }),
    transport,
  });
}
