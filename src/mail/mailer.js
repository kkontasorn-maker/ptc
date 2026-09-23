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
