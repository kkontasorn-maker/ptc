import nodemailer from 'nodemailer';

export function verificationPayload({ exposeDevCode, code }) {
  const body = { ok: true };
  if (exposeDevCode) body.dev_code = code;
  return body;
}

export async function deliverVerificationCode({ mail, email, code }) {
  const text = `Your NIS conferences code is ${code}. It expires in 10 minutes.`;
  if (!mail?.configured) {
    console.info(`Verification code for ${email}: ${code}`);
    return { delivered: false };
  }
  const transport = nodemailer.createTransport({
    host: mail.host,
    port: mail.port,
    secure: Boolean(mail.secure),
    auth: mail.user ? { user: mail.user, pass: mail.pass } : undefined,
  });
  await transport.sendMail({
    from: mail.from,
    to: email,
    subject: 'Your NIS conferences code',
    text,
  });
  return { delivered: true };
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

export async function deliverSummary({ mail, email, eventName, bookings }) {
  const text = summaryMessage({ eventName, bookings });
  const subject = `Your NIS conferences — ${eventName}`;
  if (!mail?.configured) {
    console.info(`Summary email for ${email}\n${text}`);
    return { delivered: false, subject, text };
  }
  const transport = nodemailer.createTransport({
    host: mail.host,
    port: mail.port,
    secure: Boolean(mail.secure),
    auth: mail.user ? { user: mail.user, pass: mail.pass } : undefined,
  });
  await transport.sendMail({
    from: mail.from,
    to: email,
    subject,
    text,
  });
  return { delivered: true, subject, text };
}
