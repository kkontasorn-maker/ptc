import { createApp } from './src/app.js';
import { loadConfig } from './src/config.js';
import { startSummaryJob } from './src/summary-job.js';

const config = loadConfig();
const app = createApp(config);
const server = app.listen(config.port, config.host, () => {
  const where = config.host === '0.0.0.0' ? '127.0.0.1' : config.host;
  console.log(`NIS Parent-Teacher Conferences listening on http://${where}:${config.port}`);
  console.log(config.psapi.baseUrl && config.psapi.clientId && config.psapi.clientSecret
    ? 'PowerSchool: live credentials configured'
    : 'PowerSchool: mock teacher list (credentials are not configured)');
  console.log(config.google.configured
    ? 'Sign-in: Google Workspace'
    : 'Sign-in: local email fallback (Google OAuth is not configured)');
  console.log(config.mail.configured
    ? 'Verification email: SMTP'
    : 'Verification email: codes logged on the server (SMTP is not configured)');
  console.log(config.mail.allowlist
    ? `Email allowlist: on, non-matches redirect to ${config.mail.allowlist[0]}`
    : 'Email allowlist: off (EMAIL_ALLOWLIST is unset — real recipients)');
  console.log(config.webhook.provider && config.webhook.secret
    ? `Email webhooks: ${config.webhook.provider}`
    : 'Email webhooks: not configured (POST /api/v1/webhooks/email-status returns 401 until EMAIL_WEBHOOK_PROVIDER and EMAIL_WEBHOOK_SECRET are set)');
  const every = Number.isFinite(config.summaryIntervalMs) && config.summaryIntervalMs > 0
    ? `then every ${Math.round(config.summaryIntervalMs / 1000)} seconds`
    : 'then not again until the next restart';
  console.log(`Summary email: checked at startup, ${every}`);
});

const stopSummary = startSummaryJob({
  repos: app.locals.repos,
  mail: app.locals.mail,
  psapi: app.locals.psapi,
  timeZone: config.timeZone,
  intervalMs: config.summaryIntervalMs,
});

function shutdown() {
  stopSummary();
  server.close(() => {
    app.locals.db.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
